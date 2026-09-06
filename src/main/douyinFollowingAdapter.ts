import { z } from 'zod'
import {
  buildPlatformAdapterIssue,
  createPlatformAdapterPageSchema,
  douyinFollowingStructuredProofSchema,
  opaquePlatformIdSchema,
  type PlatformAdapter,
  type PlatformAdapterContext,
  type PlatformAdapterIssue,
  type PlatformAdapterPage,
  type RouteTraceEntry
} from '../shared/platformAdapter'
import {
  ROUTE_REGISTRY,
  STRUCTURED_ACQUISITION_ADAPTER_VERSION,
  registeredRoute
} from '../shared/structuredAcquisition'
import {
  createResponseProjectionSha256,
  createSchemaFingerprint,
  validateSafeReadOnlyRequest
} from './platformAdapterSecurity'

export const FOLLOWING_ROUTE_ORDER = Object.freeze([
  'DY-FOLLOW-NETWORK',
  'DY-FOLLOW-EMBEDDED',
  'DY-FOLLOW-INPAGE'
] as const)

export type FollowingRouteId = typeof FOLLOWING_ROUTE_ORDER[number]
export type FollowingSourceKind = 'network-response' | 'embedded-json' | 'page-context-fetch'
export type FollowingUnavailableReason = 'not-observed' | 'schema-missing' | 'schema-changed' | 'signature-unavailable' | 'signature-rejected'

export type FollowingReadRequest = {
  method: 'GET'
  path: string
  parameters: Record<string, unknown>
  headers: Record<string, string>
}

export type FollowingRouteReadResult = {
  outcome: 'unavailable'
  reason: FollowingUnavailableReason
  durationMs: number
  observedAt: string
} | {
  outcome: 'response'
  httpStatus: number
  retryAfterMs?: number | null
  contentType: string | null
  payload: unknown
  request: FollowingReadRequest | null
  durationMs: number
  observedAt: string
}

export type FollowingRouteSource = {
  routeId: FollowingRouteId
  sourceKind: FollowingSourceKind
  readPage(input: {
    ownerAccountId: string
    cursor: string
    count: number
    signal: AbortSignal
  }): Promise<FollowingRouteReadResult>
}

export const normalizedFollowingCreatorSchema = z.object({
  creatorId: opaquePlatformIdSchema,
  secCreatorId: opaquePlatformIdSchema.nullable(),
  nickname: z.string().max(200),
  signature: z.string().max(1_000),
  relationship: z.literal('following')
}).strict()

export type NormalizedFollowingCreator = z.infer<typeof normalizedFollowingCreatorSchema>

export type DouyinFollowingRequest = {
  ownerAccountId: string
  cursor?: string
  pageSize?: number
  maxPages?: number
}

export type FollowingAcquisitionFailure = {
  ok: false
  completion: 'failed'
  items: []
  routeTrace: RouteTraceEntry[]
  issue: PlatformAdapterIssue
}

export type FollowingAcquisitionSuccess = {
  ok: true
  page: PlatformAdapterPage<NormalizedFollowingCreator>
}

export type FollowingAcquisitionOutcome = FollowingAcquisitionSuccess | FollowingAcquisitionFailure

const routeSourceKinds: Readonly<Record<FollowingRouteId, FollowingSourceKind>> = Object.freeze({
  'DY-FOLLOW-NETWORK': 'network-response',
  'DY-FOLLOW-EMBEDDED': 'embedded-json',
  'DY-FOLLOW-INPAGE': 'page-context-fetch'
})

const rawOpaqueIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9._-]+$/)
const rawFollowingCreatorSchema = z.object({
  uid: rawOpaqueIdSchema.optional(),
  sec_uid: rawOpaqueIdSchema.optional(),
  nickname: z.string().max(500).optional(),
  signature: z.string().max(5_000).optional(),
  is_following: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  follow_status: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional()
}).passthrough().superRefine((creator, context) => {
  if (!creator.uid && !creator.sec_uid) {
    context.addIssue({ code: 'custom', path: ['uid'], message: 'following creator requires a native uid or sec_uid' })
  }
  const following = creator.is_following === true
    || creator.is_following === 1
    || creator.follow_status === 1
    || creator.follow_status === 2
  if (!following) {
    context.addIssue({ code: 'custom', path: ['is_following'], message: 'creator lacks an explicit following relationship' })
  }
})

const rawCursorSchema = z.union([z.string().max(240), z.number().int().nonnegative()])
const rawFollowingPageSchema = z.object({
  status_code: z.literal(0),
  user_list: z.array(rawFollowingCreatorSchema).max(1_000),
  cursor: rawCursorSchema.nullable().optional(),
  max_cursor: rawCursorSchema.nullable().optional(),
  has_more: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  total: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional()
}).passthrough()

type RawFollowingPage = z.infer<typeof rawFollowingPageSchema>

class FollowingCollectionError extends Error {
  constructor(readonly failure: FollowingAcquisitionFailure) {
    super(`${failure.issue.code}:${failure.issue.message}`)
    this.name = 'FollowingCollectionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedEmbeddedCandidates(value: unknown): unknown[] {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const candidates: unknown[] = []
  const seen = new Set<object>()
  let visited = 0
  while (queue.length > 0 && visited < 256) {
    const current = queue.shift()!
    if (!isRecord(current.value) || seen.has(current.value)) continue
    seen.add(current.value)
    visited += 1
    if (Array.isArray(current.value.user_list)) candidates.push(current.value)
    if (current.depth >= 6) continue
    for (const entry of Object.values(current.value)) {
      if (isRecord(entry)) queue.push({ value: entry, depth: current.depth + 1 })
    }
  }
  return candidates
}

function candidatePayloads(payload: unknown, sourceKind: FollowingSourceKind): unknown[] {
  const direct = isRecord(payload) && isRecord(payload.data) ? [payload.data, payload] : [payload]
  if (sourceKind !== 'embedded-json') return direct
  return [...direct, ...boundedEmbeddedCandidates(payload)]
}

function parseFollowingPage(payload: unknown, sourceKind: FollowingSourceKind): { raw: RawFollowingPage; selected: unknown } | null {
  for (const candidate of candidatePayloads(payload, sourceKind)) {
    const parsed = rawFollowingPageSchema.safeParse(candidate)
    if (parsed.success) return { raw: parsed.data, selected: candidate }
  }
  return null
}

function routeTrace(
  routeId: string,
  status: RouteTraceEntry['status'],
  result: { durationMs: number; observedAt: string },
  schemaFingerprint: string | null = null
): RouteTraceEntry {
  return {
    routeId,
    status,
    attempt: 1,
    durationMs: Math.max(0, Math.min(300_000, Math.trunc(result.durationMs))),
    schemaFingerprint,
    occurredAt: result.observedAt
  }
}

function creatorFromRaw(raw: z.infer<typeof rawFollowingCreatorSchema>): NormalizedFollowingCreator {
  return normalizedFollowingCreatorSchema.parse({
    creatorId: raw.uid ?? raw.sec_uid,
    secCreatorId: raw.sec_uid ?? null,
    nickname: (raw.nickname ?? '').normalize('NFKC').trim().slice(0, 200),
    signature: (raw.signature ?? '').normalize('NFKC').trim().slice(0, 1_000),
    relationship: 'following'
  })
}

function cursorOf(page: RawFollowingPage): string | null {
  const value = page.cursor ?? page.max_cursor ?? null
  return value === null ? null : String(value)
}

function hasMore(page: RawFollowingPage): boolean {
  return page.has_more === true || page.has_more === 1
}

function totalOf(page: RawFollowingPage): number | null {
  return page.total ?? page.total_count ?? null
}

function issueForUnavailable(reason: FollowingUnavailableReason): Parameters<typeof buildPlatformAdapterIssue>[0]['code'] {
  if (reason === 'not-observed') return 'NOT_OBSERVED'
  if (reason === 'signature-unavailable') return 'SIGNATURE_UNAVAILABLE'
  if (reason === 'signature-rejected') return 'SIGNATURE_REJECTED'
  return 'SCHEMA_CHANGED'
}

function traceStatusForUnavailable(reason: FollowingUnavailableReason): RouteTraceEntry['status'] {
  return reason === 'schema-changed' ? 'schema-changed' : reason
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function normalizeResultTiming(result: FollowingRouteReadResult, context: PlatformAdapterContext): FollowingRouteReadResult {
  const observedAt = validDate(result.observedAt) ? new Date(result.observedAt).toISOString() : context.now().toISOString()
  const durationMs = Number.isFinite(result.durationMs) ? result.durationMs : 0
  return { ...result, observedAt, durationMs } as FollowingRouteReadResult
}

export class DouyinFollowingAdapter implements PlatformAdapter<DouyinFollowingRequest, NormalizedFollowingCreator> {
  readonly identity = {
    platform: 'douyin' as const,
    adapterName: 'douyin.following',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 1 as const
  }
  readonly operation = 'following' as const
  private readonly sources: ReadonlyMap<FollowingRouteId, FollowingRouteSource>

  constructor(routeSources: FollowingRouteSource[]) {
    const sources = new Map<FollowingRouteId, FollowingRouteSource>()
    let lastOrder = -1
    for (const source of routeSources) {
      const order = FOLLOWING_ROUTE_ORDER.indexOf(source.routeId)
      if (order < 0 || order <= lastOrder || sources.has(source.routeId)) {
        throw new Error('following route sources must be unique and ordered NETWORK → EMBEDDED → INPAGE')
      }
      registeredRoute(source.routeId)
      if (source.sourceKind !== routeSourceKinds[source.routeId]) {
        throw new Error(`following route ${source.routeId} has the wrong sourceKind`)
      }
      sources.set(source.routeId, source)
      lastOrder = order
    }
    this.sources = sources
  }

  async collect(request: DouyinFollowingRequest, context: PlatformAdapterContext): Promise<PlatformAdapterPage<NormalizedFollowingCreator>> {
    const outcome = await this.collectOutcome(request, context)
    if (!outcome.ok) throw new FollowingCollectionError(outcome)
    return outcome.page
  }

  async collectOutcome(requestInput: DouyinFollowingRequest, context: PlatformAdapterContext): Promise<FollowingAcquisitionOutcome> {
    const ownerAccountId = opaquePlatformIdSchema.parse(requestInput.ownerAccountId)
    const initialCursor = requestInput.cursor ?? '0'
    if (!/^\d{1,240}$/.test(initialCursor)) throw new Error('following cursor must be a non-negative integer string')
    const pageSize = requestInput.pageSize ?? 20
    const maxPages = requestInput.maxPages ?? 20
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('following pageSize must be from 1 to 100')
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('following maxPages must be from 1 to 100')
    if (context.browserOrigin !== 'https://www.douyin.com' || context.sessionKind !== 'browser-page') {
      throw new Error('following adapter requires the approved Douyin browser-page context')
    }

    const accumulatedTrace: RouteTraceEntry[] = []
    let lastUnavailable: { reason: FollowingUnavailableReason; result: FollowingRouteReadResult; routeId: FollowingRouteId } | null = null

    for (const routeId of FOLLOWING_ROUTE_ORDER) {
      const source = this.sources.get(routeId)
      if (!source) {
        const syntheticMissing = { durationMs: 0, observedAt: context.now().toISOString() }
        accumulatedTrace.push(routeTrace(routeId, routeId === 'DY-FOLLOW-NETWORK' ? 'not-observed' : 'schema-missing', syntheticMissing))
        lastUnavailable = {
          reason: routeId === 'DY-FOLLOW-NETWORK' ? 'not-observed' : 'schema-missing',
          result: { outcome: 'unavailable', reason: 'schema-missing', ...syntheticMissing },
          routeId
        }
        continue
      }

      const routeResult = await this.tryRoute(source, {
        ownerAccountId,
        initialCursor,
        pageSize,
        maxPages,
        context,
        priorTrace: accumulatedTrace
      })
      if (routeResult.ok) return routeResult
      if (routeResult.terminal) return routeResult.failure
      accumulatedTrace.splice(0, accumulatedTrace.length, ...routeResult.routeTrace)
      lastUnavailable = { reason: routeResult.reason, result: routeResult.result, routeId }
    }

    const stoppedAt = context.now().toISOString()
    accumulatedTrace.push(routeTrace('DY-FOLLOW-STOP', 'stopped', { durationMs: 0, observedAt: stoppedAt }))
    const reason = lastUnavailable?.reason ?? 'not-observed'
    return this.failure(
      issueForUnavailable(reason),
      reason === 'not-observed' ? '没有观察到任何结构化关注响应' : '所有结构化关注路线均不可用',
      'discovery',
      accumulatedTrace,
      context,
      null,
      null
    )
  }

  private async tryRoute(
    source: FollowingRouteSource,
    input: {
      ownerAccountId: string
      initialCursor: string
      pageSize: number
      maxPages: number
      context: PlatformAdapterContext
      priorTrace: RouteTraceEntry[]
    }
  ): Promise<
      | FollowingAcquisitionSuccess
      | { ok: false; terminal: true; failure: FollowingAcquisitionFailure }
      | { ok: false; terminal: false; reason: FollowingUnavailableReason; result: FollowingRouteReadResult; routeTrace: RouteTraceEntry[] }
    > {
    const items: NormalizedFollowingCreator[] = []
    const ids = new Set<string>()
    const cursors = new Set<string>([input.initialCursor])
    const selectedPayloads: unknown[] = []
    let cursor = input.initialCursor
    let finalCursor: string | null = input.initialCursor
    let reportedTotal: number | null = null
    let totalDurationMs = 0
    let firstRequestParameters: Array<{ name: string; value: string | number | boolean }> = []
    let latestObservedAt = input.context.now().toISOString()

    for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
      if (input.context.signal.aborted) throw new Error('following collection aborted')
      let rawResult: FollowingRouteReadResult
      try {
        rawResult = await source.readPage({
          ownerAccountId: input.ownerAccountId,
          cursor,
          count: input.pageSize,
          signal: input.context.signal
        })
      } catch {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', {
          durationMs: totalDurationMs,
          observedAt: input.context.now().toISOString()
        })]
        return {
          ok: false,
          terminal: true,
          // A browser/network exception can contain a full URL, headers, or a
          // signed query. Keep that untrusted diagnostic out of persisted issues.
          failure: this.failure('HTTP_TRANSIENT', '结构化关注路线读取失败', 'request', trace, input.context)
        }
      }
      const result = normalizeResultTiming(rawResult, input.context)
      latestObservedAt = result.observedAt
      totalDurationMs += Math.max(0, result.durationMs)

      if (result.outcome === 'unavailable') {
        if (items.length > 0) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, traceStatusForUnavailable(result.reason), {
            durationMs: totalDurationMs,
            observedAt: result.observedAt
          })]
          return {
            ok: false,
            terminal: true,
            failure: this.failure(issueForUnavailable(result.reason), '结构化关注路线在分页完成前失效', 'pagination', trace, input.context)
          }
        }
        return {
          ok: false,
          terminal: false,
          reason: result.reason,
          result,
          routeTrace: [...input.priorTrace, routeTrace(source.routeId, traceStatusForUnavailable(result.reason), result)]
        }
      }

      if (result.httpStatus === 401 || result.httpStatus === 403) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'login-required', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('LOGIN_REQUIRED', `HTTP ${result.httpStatus}`, 'response', trace, input.context, result.httpStatus)
        }
      }
      if (result.httpStatus === 429) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'rate-limited', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('RATE_LIMITED', 'HTTP 429', 'response', trace, input.context, 429, result.retryAfterMs ?? null)
        }
      }
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('HTTP_TRANSIENT', `HTTP ${result.httpStatus}`, 'response', trace, input.context, result.httpStatus)
        }
      }
      if (source.sourceKind !== 'embedded-json' && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(result.contentType ?? '')) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'schema-changed', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('INVALID_CONTENT_TYPE', '结构化关注响应不是 JSON', 'response', trace, input.context)
        }
      }

      if (source.sourceKind === 'embedded-json') {
        if (result.request !== null) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', result)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('UNSAFE_REQUEST', 'embedded 路线不得伪造请求元数据', 'request', trace, input.context)
          }
        }
      } else {
        if (!result.request) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', result)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('UNSAFE_REQUEST', 'Network/in-page 路线缺少安全请求证明', 'request', trace, input.context)
          }
        }
        let safeRequest
        try {
          safeRequest = validateSafeReadOnlyRequest({
            method: result.request.method,
            endpointKind: 'following-list',
            path: result.request.path,
            parameters: result.request.parameters,
            headers: result.request.headers
          })
        } catch (error) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', result)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('UNSAFE_REQUEST', error instanceof Error ? error.message : String(error), 'request', trace, input.context)
          }
        }
        const parameters = new Map(safeRequest.requestParameters.map((entry) => [entry.name, String(entry.value)]))
        if (
          safeRequest.path !== '/aweme/v1/web/user/following/list/'
          || parameters.get('sec_user_id') !== input.ownerAccountId
          || parameters.get('cursor') !== cursor
          || parameters.get('count') !== String(input.pageSize)
        ) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'stopped', result)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('UNSAFE_REQUEST', '关注请求路径、目标、cursor 或 count 与受控请求不一致', 'request', trace, input.context)
          }
        }
        if (pageIndex === 0) firstRequestParameters = safeRequest.requestParameters
      }

      const parsed = parseFollowingPage(result.payload, source.sourceKind)
      if (!parsed) {
        const fingerprint = createSchemaFingerprint(result.payload)
        if (items.length > 0) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'schema-changed', result, fingerprint)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('SCHEMA_CHANGED', '关注响应 schema 在分页中发生变化', 'validation', trace, input.context)
          }
        }
        return {
          ok: false,
          terminal: false,
          reason: 'schema-changed',
          result,
          routeTrace: [...input.priorTrace, routeTrace(source.routeId, 'schema-changed', result, fingerprint)]
        }
      }

      selectedPayloads.push(parsed.selected)
      const pageItems = parsed.raw.user_list.map(creatorFromRaw)
      if (pageItems.length === 0 && hasMore(parsed.raw)) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'pagination-error', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('PAGINATION_PROTOCOL_ERROR', '空关注页不能声明 has_more=true', 'pagination', trace, input.context)
        }
      }
      for (const item of pageItems) {
        if (ids.has(item.creatorId)) {
          const trace = [...input.priorTrace, routeTrace(source.routeId, 'duplicate-native-id', result)]
          return {
            ok: false,
            terminal: true,
            failure: this.failure('DUPLICATE_NATIVE_ID', `重复 creatorId: ${item.creatorId}`, 'pagination', trace, input.context)
          }
        }
        ids.add(item.creatorId)
        items.push(item)
      }

      reportedTotal = totalOf(parsed.raw) ?? reportedTotal
      finalCursor = cursorOf(parsed.raw)
      if (!hasMore(parsed.raw)) break
      if (finalCursor === null || cursors.has(finalCursor)) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'cursor-loop', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('CURSOR_LOOP', '关注列表 cursor 未前进或形成循环', 'pagination', trace, input.context)
        }
      }
      cursors.add(finalCursor)
      cursor = finalCursor
      if (pageIndex === input.maxPages - 1) {
        const trace = [...input.priorTrace, routeTrace(source.routeId, 'pagination-error', result)]
        return {
          ok: false,
          terminal: true,
          failure: this.failure('PAGINATION_PROTOCOL_ERROR', '关注列表在 maxPages 内未闭合', 'pagination', trace, input.context)
        }
      }
    }

    if (reportedTotal !== null && reportedTotal < items.length) {
      const trace = [...input.priorTrace, routeTrace(source.routeId, 'pagination-error', {
        durationMs: totalDurationMs,
        observedAt: latestObservedAt
      })]
      return {
        ok: false,
        terminal: true,
        failure: this.failure('PAGINATION_PROTOCOL_ERROR', 'reportedTotal 小于返回的唯一 creator 数', 'pagination', trace, input.context)
      }
    }
    if (items.length === 0 && reportedTotal !== 0) {
      const trace = [...input.priorTrace, routeTrace(source.routeId, 'pagination-error', {
        durationMs: totalDurationMs,
        observedAt: latestObservedAt
      })]
      return {
        ok: false,
        terminal: true,
        failure: this.failure('PAGINATION_PROTOCOL_ERROR', 'verified-empty 要求 reportedTotal=0', 'pagination', trace, input.context)
      }
    }

    const projection = {
      endpointKind: 'following-list' as const,
      relationship: 'following' as const,
      ownerAccountId: input.ownerAccountId,
      cursorIn: input.initialCursor,
      cursorOut: finalCursor,
      hasMore: false,
      reportedTotal,
      returnedIds: items.map((item) => item.creatorId),
      items
    }
    const fingerprint = createSchemaFingerprint(selectedPayloads)
    const projectionHash = createResponseProjectionSha256(projection)
    const completedTrace = [...input.priorTrace, routeTrace(source.routeId, 'success', {
      durationMs: totalDurationMs,
      observedAt: latestObservedAt
    }, fingerprint)]
    const proof = douyinFollowingStructuredProofSchema.parse({
      contract: 'douyin-following-structured-proof/v2',
      platform: 'douyin',
      adapterName: this.identity.adapterName,
      adapterVersion: this.identity.adapterVersion,
      schemaVersion: 2,
      routeId: source.routeId,
      sourceKind: source.sourceKind,
      endpointKind: 'following-list',
      relationship: 'following',
      ownerAccountId: input.ownerAccountId,
      requestTargetCreatorId: source.sourceKind === 'embedded-json' ? null : input.ownerAccountId,
      requestParameters: source.sourceKind === 'embedded-json' ? [] : firstRequestParameters,
      cursorIn: input.initialCursor,
      cursorOut: finalCursor,
      hasMore: false,
      reportedTotal,
      returnedIds: projection.returnedIds,
      creatorIds: projection.returnedIds,
      schemaFingerprint: fingerprint,
      responseProjectionSha256: projectionHash,
      routeTrace: completedTrace,
      collectedAt: latestObservedAt,
      browserOrigin: input.context.browserOrigin,
      sessionUsed: true,
      validationResults: {
        http: source.sourceKind === 'embedded-json' ? 'not-applicable' : 'valid',
        json: 'valid',
        platformStatus: 'valid',
        targetIdentity: 'valid',
        schema: 'valid',
        pagination: 'valid',
        sensitiveFields: 'removed'
      }
    })
    const page = createPlatformAdapterPageSchema(normalizedFollowingCreatorSchema).parse({
      contract: 'platform-adapter-page/v1',
      identity: this.identity,
      operation: this.operation,
      completion: items.length === 0 ? 'verified-empty' : 'complete',
      pagination: {
        cursorIn: input.initialCursor,
        cursorOut: finalCursor,
        hasMore: false,
        reportedTotal,
        returnedCount: items.length,
        duplicateCount: 0
      },
      sourceProof: proof,
      items
    }) as PlatformAdapterPage<NormalizedFollowingCreator>
    return { ok: true, page }
  }

  private failure(
    code: Parameters<typeof buildPlatformAdapterIssue>[0]['code'],
    message: string,
    phase: Parameters<typeof buildPlatformAdapterIssue>[0]['phase'],
    trace: RouteTraceEntry[],
    context: PlatformAdapterContext,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null
  ): FollowingAcquisitionFailure {
    return {
      ok: false,
      completion: 'failed',
      items: [],
      routeTrace: trace,
      issue: buildPlatformAdapterIssue({
        code,
        phase,
        message: message.slice(0, 2_000),
        endpointKind: 'following-list',
        httpStatus,
        retryAfterMs,
        safeContext: {},
        occurredAt: context.now().toISOString()
      })
    }
  }
}

export function followingRouteIsRegistered(routeId: FollowingRouteId): boolean {
  return Boolean(ROUTE_REGISTRY[routeId])
}
