import { z } from 'zod'
import {
  buildPlatformAdapterIssue,
  opaquePlatformIdSchema,
  type PlatformAdapterContext,
  type PlatformAdapterIssue,
  type RouteTraceEntry
} from '../shared/platformAdapter'
import {
  nativeStructuredCommentItemSchema
} from '../shared/structuredAcquisition'
import {
  COMMENT_ACQUISITION_ADAPTER_VERSION,
  createStructuredCommentPageSchema,
  douyinCommentListStructuredProofSchema,
  douyinCommentReplyStructuredProofSchema,
  registeredCommentRoute,
  type StructuredCommentPage,
  type StructuredCommentSourceKind
} from '../shared/commentAcquisition'
import {
  createResponseProjectionSha256,
  createSchemaFingerprint,
  validateSafeReadOnlyRequest
} from './platformAdapterSecurity'

export const COMMENT_ROUTE_ORDER = Object.freeze([
  'DY-COMMENT-NETWORK',
  'DY-COMMENT-EMBEDDED',
  'DY-COMMENT-INPAGE',
  'DY-COMMENT-TRIGGER'
] as const)

export const REPLY_ROUTE_ORDER = Object.freeze([
  'DY-REPLY-NETWORK',
  'DY-REPLY-EMBEDDED',
  'DY-REPLY-INPAGE',
  'DY-REPLY-TRIGGER'
] as const)

export type CommentRouteId = typeof COMMENT_ROUTE_ORDER[number]
export type ReplyRouteId = typeof REPLY_ROUTE_ORDER[number]
export type StructuredCommentRouteId = CommentRouteId | ReplyRouteId
export type StructuredCommentUnavailableReason =
  | 'not-observed'
  | 'schema-missing'
  | 'schema-changed'
  | 'signature-unavailable'
  | 'signature-rejected'

export type StructuredCommentReadRequest = {
  method: 'GET'
  path: string
  parameters: Record<string, unknown>
  headers: Record<string, string>
}

export type StructuredCommentRouteReadResult = {
  outcome: 'unavailable'
  reason: StructuredCommentUnavailableReason
  durationMs: number
  observedAt: string
} | {
  outcome: 'response'
  httpStatus: number
  retryAfterMs?: number | null
  contentType: string | null
  payload: unknown
  request: StructuredCommentReadRequest | null
  durationMs: number
  observedAt: string
  observationKind?: 'network-observer'
}

type CommentReadInput = {
  workId: string
  rootCommentId: string | null
  cursor: string
  count: number
  signal: AbortSignal
}

type PassiveCommentRouteSource<RouteId extends StructuredCommentRouteId> = {
  routeId: Exclude<RouteId, 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER'>
  sourceKind: Exclude<StructuredCommentSourceKind, 'triggered-network-response'>
  readPage(input: CommentReadInput): Promise<StructuredCommentRouteReadResult>
}

type TriggerCommentRouteSource<RouteId extends StructuredCommentRouteId> = {
  routeId: Extract<RouteId, 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER'>
  sourceKind: 'triggered-network-response'
  observeAfterTrigger(input: CommentReadInput): Promise<StructuredCommentRouteReadResult>
}

export type CommentRouteSource = PassiveCommentRouteSource<CommentRouteId> | TriggerCommentRouteSource<CommentRouteId>
export type ReplyRouteSource = PassiveCommentRouteSource<ReplyRouteId> | TriggerCommentRouteSource<ReplyRouteId>

export const normalizedDouyinCommentSchema = z.object({
  commentId: opaquePlatformIdSchema,
  commentIdKind: z.literal('native-cid'),
  workId: opaquePlatformIdSchema,
  parentCommentId: opaquePlatformIdSchema.nullable(),
  rootCommentId: opaquePlatformIdSchema.nullable(),
  publicAuthorId: opaquePlatformIdSchema,
  publicAuthorName: z.string().min(1).max(200),
  body: z.string().min(1).max(5_000),
  likeCount: z.number().int().nonnegative().nullable(),
  replyCount: z.number().int().nonnegative().nullable(),
  publishedAt: z.string().datetime().nullable(),
  endpointKind: z.enum(['comment-list', 'comment-reply-list'])
}).strict()

export type NormalizedDouyinComment = z.infer<typeof normalizedDouyinCommentSchema>

export type DouyinCommentListRequest = {
  workId: string
  cursor?: string
  pageSize?: number
  maxPages?: number
}

export type DouyinCommentReplyRequest = DouyinCommentListRequest & {
  rootCommentId: string
}

export type StructuredCommentAcquisitionFailure = {
  ok: false
  completion: 'failed'
  items: []
  routeTrace: RouteTraceEntry[]
  issue: PlatformAdapterIssue
}

export type StructuredCommentAcquisitionOutcome = {
  ok: true
  page: StructuredCommentPage<NormalizedDouyinComment>
} | StructuredCommentAcquisitionFailure

const routeSourceKinds: Readonly<Record<StructuredCommentRouteId, StructuredCommentSourceKind>> = Object.freeze({
  'DY-COMMENT-NETWORK': 'network-response',
  'DY-COMMENT-EMBEDDED': 'embedded-json',
  'DY-COMMENT-INPAGE': 'page-context-fetch',
  'DY-COMMENT-TRIGGER': 'triggered-network-response',
  'DY-REPLY-NETWORK': 'network-response',
  'DY-REPLY-EMBEDDED': 'embedded-json',
  'DY-REPLY-INPAGE': 'page-context-fetch',
  'DY-REPLY-TRIGGER': 'triggered-network-response'
})

const rawOpaqueIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9._-]+$/)
const rawUserSchema = z.object({
  uid: rawOpaqueIdSchema.optional(),
  sec_uid: rawOpaqueIdSchema.optional(),
  nickname: z.string().min(1).max(500)
}).passthrough().superRefine((user, context) => {
  if (!user.uid && !user.sec_uid) {
    context.addIssue({ code: 'custom', path: ['uid'], message: 'comment author requires a native uid or sec_uid' })
  }
})

const rawCommentSchema = z.object({
  cid: rawOpaqueIdSchema,
  aweme_id: rawOpaqueIdSchema,
  text: z.string().max(10_000),
  user: rawUserSchema,
  digg_count: z.unknown().optional(),
  reply_comment_total: z.unknown().optional(),
  create_time: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  reply_to_comment_id: rawOpaqueIdSchema.nullable().optional(),
  parent_comment_id: rawOpaqueIdSchema.nullable().optional(),
  root_comment_id: rawOpaqueIdSchema.nullable().optional(),
  reply_id: rawOpaqueIdSchema.nullable().optional()
}).passthrough()

const rawCursorSchema = z.union([z.string().max(240), z.number().int().nonnegative()])
const rawCommentPageSchema = z.object({
  status_code: z.literal(0),
  comments: z.array(rawCommentSchema).max(1_000),
  cursor: rawCursorSchema.nullable().optional(),
  max_cursor: rawCursorSchema.nullable().optional(),
  has_more: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  total: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional(),
  target_aweme_id: rawOpaqueIdSchema.optional(),
  root_comment_id: rawOpaqueIdSchema.optional()
}).passthrough()

type RawComment = z.infer<typeof rawCommentSchema>
type RawCommentPage = z.infer<typeof rawCommentPageSchema>

class StructuredCommentCollectionError extends Error {
  constructor(readonly failure: StructuredCommentAcquisitionFailure) {
    super(`${failure.issue.code}:${failure.issue.message}`)
    this.name = 'StructuredCommentCollectionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedCommentCandidates(value: unknown): unknown[] {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const candidates: unknown[] = []
  const seen = new Set<object>()
  let visited = 0
  while (queue.length > 0 && visited < 256) {
    const current = queue.shift()!
    if (!isRecord(current.value) || seen.has(current.value)) continue
    seen.add(current.value)
    visited += 1
    if (Array.isArray(current.value.comments)) candidates.push(current.value)
    if (current.depth >= 6) continue
    for (const entry of Object.values(current.value)) {
      if (isRecord(entry)) queue.push({ value: entry, depth: current.depth + 1 })
    }
  }
  return candidates
}

function candidatePayloads(payload: unknown, sourceKind: StructuredCommentSourceKind): unknown[] {
  const direct = isRecord(payload) && isRecord(payload.data) ? [payload.data, payload] : [payload]
  return sourceKind === 'embedded-json' ? [...direct, ...boundedCommentCandidates(payload)] : direct
}

function parseCommentPage(payload: unknown, sourceKind: StructuredCommentSourceKind): { raw: RawCommentPage; selected: unknown } | null {
  for (const candidate of candidatePayloads(payload, sourceKind)) {
    const parsed = rawCommentPageSchema.safeParse(candidate)
    if (parsed.success) return { raw: parsed.data, selected: candidate }
  }
  return null
}

function explicitCommentsDisabled(payload: unknown, sourceKind: StructuredCommentSourceKind): boolean {
  return candidatePayloads(payload, sourceKind).some((candidate) => isRecord(candidate) && (
    candidate.comments_disabled === true
    || candidate.comment_status === 'disabled'
  ))
}

function explicitApiStatus(payload: unknown, sourceKind: StructuredCommentSourceKind): number | null {
  for (const candidate of candidatePayloads(payload, sourceKind)) {
    if (isRecord(candidate) && Number.isInteger(candidate.status_code)) return Number(candidate.status_code)
  }
  return null
}

function trace(
  routeId: string,
  status: RouteTraceEntry['status'],
  timing: { durationMs: number; observedAt: string },
  schemaFingerprint: string | null = null
): RouteTraceEntry {
  return {
    routeId,
    status,
    attempt: 1,
    durationMs: Math.max(0, Math.min(300_000, Math.trunc(timing.durationMs))),
    schemaFingerprint,
    occurredAt: timing.observedAt
  }
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function normalizeTiming(result: StructuredCommentRouteReadResult, context: PlatformAdapterContext): StructuredCommentRouteReadResult {
  return {
    ...result,
    observedAt: validDate(result.observedAt) ? new Date(result.observedAt).toISOString() : context.now().toISOString(),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0
  } as StructuredCommentRouteReadResult
}

function issueCodeForUnavailable(reason: StructuredCommentUnavailableReason): Parameters<typeof buildPlatformAdapterIssue>[0]['code'] {
  if (reason === 'not-observed') return 'NOT_OBSERVED'
  if (reason === 'signature-unavailable') return 'SIGNATURE_UNAVAILABLE'
  if (reason === 'signature-rejected') return 'SIGNATURE_REJECTED'
  return 'SCHEMA_CHANGED'
}

function traceStatusForUnavailable(reason: StructuredCommentUnavailableReason): RouteTraceEntry['status'] {
  return reason === 'schema-changed' ? 'schema-changed' : reason
}

function cursorOf(page: RawCommentPage): string | null {
  const value = page.cursor ?? page.max_cursor ?? null
  return value === null ? null : String(value)
}

function hasMore(page: RawCommentPage): boolean {
  return page.has_more === true || page.has_more === 1
}

function totalOf(page: RawCommentPage): number | null {
  return page.total ?? page.total_count ?? null
}

function nonnegativeIntegerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function publishedAt(value: RawComment['create_time']): string | null {
  if (value === undefined) return null
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253_402_300_799) return null
  return new Date(seconds * 1_000).toISOString()
}

function normalizedText(value: string, maximum: number): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, maximum)
}

function relationOf(raw: RawComment): { parentCommentId: string | null; rootCommentId: string | null } {
  return {
    parentCommentId: raw.reply_to_comment_id ?? raw.parent_comment_id ?? null,
    rootCommentId: raw.root_comment_id ?? raw.reply_id ?? null
  }
}

function projectedComment(raw: RawComment, endpointKind: 'comment-list' | 'comment-reply-list'): NormalizedDouyinComment {
  const relation = relationOf(raw)
  return normalizedDouyinCommentSchema.parse({
    commentId: raw.cid,
    commentIdKind: 'native-cid',
    workId: raw.aweme_id,
    parentCommentId: relation.parentCommentId,
    rootCommentId: relation.rootCommentId,
    publicAuthorId: raw.user.uid ?? raw.user.sec_uid,
    publicAuthorName: normalizedText(raw.user.nickname, 200),
    body: normalizedText(raw.text, 5_000),
    likeCount: nonnegativeIntegerOrNull(raw.digg_count),
    replyCount: nonnegativeIntegerOrNull(raw.reply_comment_total),
    publishedAt: publishedAt(raw.create_time),
    endpointKind
  })
}

function failure(
  code: Parameters<typeof buildPlatformAdapterIssue>[0]['code'],
  message: string,
  phase: Parameters<typeof buildPlatformAdapterIssue>[0]['phase'],
  endpointKind: 'comment-list' | 'comment-reply-list',
  routeTrace: RouteTraceEntry[],
  context: PlatformAdapterContext,
  httpStatus: number | null = null,
  retryAfterMs: number | null = null
): StructuredCommentAcquisitionFailure {
  return {
    ok: false,
    completion: 'failed',
    items: [],
    routeTrace,
    issue: buildPlatformAdapterIssue({
      code,
      phase,
      message: message.slice(0, 2_000),
      endpointKind,
      httpStatus,
      retryAfterMs,
      safeContext: {},
      occurredAt: context.now().toISOString()
    })
  }
}

function validateContext(context: PlatformAdapterContext): void {
  if (context.browserOrigin !== 'https://www.douyin.com' || context.sessionKind !== 'browser-page') {
    throw new Error('Douyin comment adapters require the approved browser-page context')
  }
}

type AdapterConfig<RouteId extends StructuredCommentRouteId> = {
  endpointKind: 'comment-list' | 'comment-reply-list'
  operation: 'comments' | 'comment-replies'
  routeOrder: readonly RouteId[]
  stopRouteId: 'DY-COMMENT-STOP' | 'DY-REPLY-STOP'
  sources: ReadonlyMap<RouteId, CommentRouteSource | ReplyRouteSource>
  workId: string
  rootCommentId: string | null
  initialCursor: string
  pageSize: number
  maxPages: number
  context: PlatformAdapterContext
  identity: {
    platform: 'douyin'
    adapterName: string
    adapterVersion: string
    schemaVersion: 1
  }
}

async function collectStructuredComments<RouteId extends StructuredCommentRouteId>(
  config: AdapterConfig<RouteId>
): Promise<StructuredCommentAcquisitionOutcome> {
  const accumulatedTrace: RouteTraceEntry[] = []
  let lastReason: StructuredCommentUnavailableReason = 'not-observed'

  for (const routeId of config.routeOrder) {
    const source = config.sources.get(routeId)
    if (!source) {
      const missingReason: StructuredCommentUnavailableReason = routeId.endsWith('NETWORK') || routeId.endsWith('TRIGGER')
        ? 'not-observed'
        : routeId.endsWith('INPAGE') ? 'signature-unavailable' : 'schema-missing'
      accumulatedTrace.push(trace(routeId, traceStatusForUnavailable(missingReason), {
        durationMs: 0,
        observedAt: config.context.now().toISOString()
      }))
      lastReason = missingReason
      continue
    }

    const routeResult = await collectCommentRoute(source, { ...config, priorTrace: accumulatedTrace })
    if (routeResult.ok) return routeResult
    if (routeResult.terminal) return routeResult.failure
    accumulatedTrace.splice(0, accumulatedTrace.length, ...routeResult.routeTrace)
    lastReason = routeResult.reason
  }

  accumulatedTrace.push(trace(config.stopRouteId, 'stopped', {
    durationMs: 0,
    observedAt: config.context.now().toISOString()
  }))
  return failure(
    issueCodeForUnavailable(lastReason),
    lastReason === 'not-observed' ? '没有观察到结构化评论响应' : '所有结构化评论路线均不可用',
    'discovery',
    config.endpointKind,
    accumulatedTrace,
    config.context
  )
}

async function collectCommentRoute<RouteId extends StructuredCommentRouteId>(
  source: CommentRouteSource | ReplyRouteSource,
  config: AdapterConfig<RouteId> & { priorTrace: RouteTraceEntry[] }
): Promise<
  | { ok: true; page: StructuredCommentPage<NormalizedDouyinComment> }
  | { ok: false; terminal: true; failure: StructuredCommentAcquisitionFailure }
  | { ok: false; terminal: false; reason: StructuredCommentUnavailableReason; routeTrace: RouteTraceEntry[] }
> {
  const items: NormalizedDouyinComment[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>([config.initialCursor])
  const selectedPayloads: unknown[] = []
  let cursor = config.initialCursor
  let finalCursor: string | null = config.initialCursor
  let reportedTotal: number | null = null
  let totalDurationMs = 0
  let latestObservedAt = config.context.now().toISOString()
  let firstRequestParameters: Array<{ name: string; value: string | number | boolean }> = []

  for (let pageIndex = 0; pageIndex < config.maxPages; pageIndex += 1) {
    if (config.context.signal.aborted) throw new Error('comment collection aborted')
    let rawResult: StructuredCommentRouteReadResult
    try {
      const input = {
        workId: config.workId,
        rootCommentId: config.rootCommentId,
        cursor,
        count: config.pageSize,
        signal: config.context.signal
      }
      rawResult = 'observeAfterTrigger' in source
        ? await source.observeAfterTrigger(input)
        : await source.readPage(input)
    } catch {
      return {
        ok: false,
        terminal: true,
        failure: failure('HTTP_TRANSIENT', '结构化评论路线读取失败', 'request', config.endpointKind, [
          ...config.priorTrace,
          trace(source.routeId, 'stopped', { durationMs: totalDurationMs, observedAt: config.context.now().toISOString() })
        ], config.context)
      }
    }
    const result = normalizeTiming(rawResult, config.context)
    latestObservedAt = result.observedAt
    totalDurationMs += Math.max(0, result.durationMs)

    if (result.outcome === 'unavailable') {
      const routeTrace = [...config.priorTrace, trace(source.routeId, traceStatusForUnavailable(result.reason), {
        durationMs: totalDurationMs,
        observedAt: result.observedAt
      })]
      if (items.length > 0) {
        return {
          ok: false,
          terminal: true,
          failure: failure(issueCodeForUnavailable(result.reason), '评论路线在分页闭合前失效', 'pagination', config.endpointKind, routeTrace, config.context)
        }
      }
      return { ok: false, terminal: false, reason: result.reason, routeTrace }
    }

    if (source.sourceKind === 'triggered-network-response' && result.observationKind !== 'network-observer') {
      return {
        ok: false,
        terminal: true,
        failure: failure('DOM_ONLY_SOURCE_REJECTED', 'TRIGGER 只能接纳触发后由 Network Observer 观察到的结构化响应', 'validation', config.endpointKind, [
          ...config.priorTrace,
          trace(source.routeId, 'dom-mismatch', result)
        ], config.context)
      }
    }
    if (source.sourceKind !== 'triggered-network-response' && result.observationKind !== undefined) {
      return {
        ok: false,
        terminal: true,
        failure: failure('SCHEMA_CHANGED', '非 TRIGGER 路线不得伪造触发观察标记', 'validation', config.endpointKind, [
          ...config.priorTrace,
          trace(source.routeId, 'schema-changed', result)
        ], config.context)
      }
    }
    if (result.httpStatus === 401 || result.httpStatus === 403) {
      return { ok: false, terminal: true, failure: failure('LOGIN_REQUIRED', `HTTP ${result.httpStatus}`, 'response', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'login-required', result)
      ], config.context, result.httpStatus) }
    }
    if (result.httpStatus === 429) {
      return { ok: false, terminal: true, failure: failure('RATE_LIMITED', 'HTTP 429', 'response', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'rate-limited', result)
      ], config.context, 429, result.retryAfterMs ?? null) }
    }
    if (result.httpStatus < 200 || result.httpStatus >= 300) {
      return { ok: false, terminal: true, failure: failure('HTTP_TRANSIENT', `HTTP ${result.httpStatus}`, 'response', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'stopped', result)
      ], config.context, result.httpStatus) }
    }
    if (source.sourceKind !== 'embedded-json' && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(result.contentType ?? '')) {
      return { ok: false, terminal: true, failure: failure('INVALID_CONTENT_TYPE', '结构化评论响应不是 JSON', 'response', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'schema-changed', result)
      ], config.context) }
    }
    if (explicitCommentsDisabled(result.payload, source.sourceKind)) {
      return { ok: false, terminal: true, failure: failure('COMMENTS_DISABLED', '目标作品已明确关闭评论', 'validation', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'stopped', result, createSchemaFingerprint(result.payload))
      ], config.context) }
    }
    const platformStatus = explicitApiStatus(result.payload, source.sourceKind)
    if (platformStatus !== null && platformStatus !== 0) {
      return { ok: false, terminal: true, failure: failure('API_STATUS_ERROR', '结构化评论响应返回非零平台状态', 'response', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'stopped', result, createSchemaFingerprint(result.payload))
      ], config.context) }
    }

    if (source.sourceKind === 'embedded-json') {
      if (result.request !== null) {
        return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', 'embedded 评论路线不得伪造请求元数据', 'request', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'stopped', result)
        ], config.context) }
      }
    } else {
      if (!result.request) {
        return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', 'Network/in-page/trigger 路线缺少安全请求证明', 'request', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'stopped', result)
        ], config.context) }
      }
      let safeRequest
      try {
        safeRequest = validateSafeReadOnlyRequest({
          method: result.request.method,
          endpointKind: config.endpointKind,
          path: result.request.path,
          parameters: result.request.parameters,
          headers: result.request.headers
        })
      } catch {
        return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', '评论请求未通过 GET/path/参数/header 白名单', 'request', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'stopped', result)
        ], config.context) }
      }
      const parameters = new Map(safeRequest.requestParameters.map((entry) => [entry.name, String(entry.value)]))
      const expectedPath = config.endpointKind === 'comment-list'
        ? '/aweme/v1/web/comment/list/'
        : '/aweme/v1/web/comment/list/reply/'
      const validRoot = config.endpointKind === 'comment-list'
        ? !parameters.has('comment_id')
        : parameters.get('comment_id') === config.rootCommentId
      if (
        safeRequest.path !== expectedPath
        || parameters.get('aweme_id') !== config.workId
        || parameters.get('cursor') !== cursor
        || parameters.get('count') !== String(config.pageSize)
        || !validRoot
      ) {
        return { ok: false, terminal: true, failure: failure(
          config.endpointKind === 'comment-list' ? 'UNSAFE_REQUEST' : 'TARGET_ID_MISMATCH',
          '评论请求路径、作品、root comment、cursor 或 count 与受控目标不一致',
          'request',
          config.endpointKind,
          [...config.priorTrace, trace(source.routeId, config.endpointKind === 'comment-list' ? 'stopped' : 'target-id-mismatch', result)],
          config.context
        ) }
      }
      if (pageIndex === 0) firstRequestParameters = safeRequest.requestParameters
    }

    const parsed = parseCommentPage(result.payload, source.sourceKind)
    if (!parsed) {
      const fingerprint = createSchemaFingerprint(result.payload)
      const routeTrace = [...config.priorTrace, trace(source.routeId, 'schema-changed', result, fingerprint)]
      if (items.length > 0) {
        return { ok: false, terminal: true, failure: failure('SCHEMA_CHANGED', '评论响应 schema 在分页中发生变化', 'validation', config.endpointKind, routeTrace, config.context) }
      }
      return { ok: false, terminal: false, reason: 'schema-changed', routeTrace }
    }
    if (source.sourceKind === 'embedded-json') {
      if (parsed.raw.target_aweme_id !== config.workId) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', 'embedded 评论上下文与目标作品不一致', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'target-id-mismatch', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
      if (config.endpointKind === 'comment-reply-list' && parsed.raw.root_comment_id !== config.rootCommentId) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', 'embedded 回复上下文与目标 root comment 不一致', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'target-id-mismatch', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
    }

    selectedPayloads.push(parsed.selected)
    const pageItems: NormalizedDouyinComment[] = []
    for (const raw of parsed.raw.comments) {
      const relation = relationOf(raw)
      if (raw.aweme_id !== config.workId) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', '评论 aweme_id 与目标作品不一致', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'target-id-mismatch', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
      if (config.endpointKind === 'comment-list' && (relation.parentCommentId !== null || relation.rootCommentId !== null)) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', '一级评论不能携带回复关系', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'target-id-mismatch', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
      if (config.endpointKind === 'comment-reply-list' && (relation.parentCommentId === null || relation.rootCommentId !== config.rootCommentId)) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', '回复的 root/parent 关系与请求 comment_id 不一致', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'target-id-mismatch', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
      let item: NormalizedDouyinComment
      try {
        item = projectedComment(raw, config.endpointKind)
      } catch {
        return { ok: false, terminal: true, failure: failure('SCHEMA_CHANGED', '评论业务字段未通过严格投影', 'validation', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'schema-changed', result, createSchemaFingerprint(parsed.selected))
        ], config.context) }
      }
      if (ids.has(item.commentId)) {
        return { ok: false, terminal: true, failure: failure('DUPLICATE_NATIVE_ID', '评论分页包含重复原生 cid', 'pagination', config.endpointKind, [
          ...config.priorTrace, trace(source.routeId, 'duplicate-native-id', result)
        ], config.context) }
      }
      ids.add(item.commentId)
      pageItems.push(item)
    }
    if (pageItems.length === 0 && hasMore(parsed.raw)) {
      return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', '空评论页不能声明 has_more=true', 'pagination', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'pagination-error', result)
      ], config.context) }
    }
    items.push(...pageItems)
    reportedTotal = totalOf(parsed.raw) ?? reportedTotal
    finalCursor = cursorOf(parsed.raw)
    if (!hasMore(parsed.raw)) break
    if (finalCursor === null || cursors.has(finalCursor)) {
      return { ok: false, terminal: true, failure: failure('CURSOR_LOOP', '评论 cursor 未前进或形成循环', 'pagination', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'cursor-loop', result)
      ], config.context) }
    }
    cursors.add(finalCursor)
    cursor = finalCursor
    if (pageIndex === config.maxPages - 1) {
      return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', '评论列表在 maxPages 内未闭合', 'pagination', config.endpointKind, [
        ...config.priorTrace, trace(source.routeId, 'pagination-error', result)
      ], config.context) }
    }
  }

  if (reportedTotal !== null && reportedTotal < items.length) {
    return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', 'reportedTotal 小于返回的唯一 cid 数', 'pagination', config.endpointKind, [
      ...config.priorTrace, trace(source.routeId, 'pagination-error', { durationMs: totalDurationMs, observedAt: latestObservedAt })
    ], config.context) }
  }
  if (items.length === 0 && reportedTotal !== 0) {
    return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', 'verified-empty 评论要求 reportedTotal=0', 'pagination', config.endpointKind, [
      ...config.priorTrace, trace(source.routeId, 'pagination-error', { durationMs: totalDurationMs, observedAt: latestObservedAt })
    ], config.context) }
  }

  const bindings = items.map((item) => ({
    commentId: item.commentId,
    workId: item.workId,
    parentCommentId: item.parentCommentId,
    rootCommentId: item.rootCommentId
  }))
  const projection = {
    endpointKind: config.endpointKind,
    targetWorkId: config.workId,
    targetRootCommentId: config.rootCommentId,
    cursorIn: config.initialCursor,
    cursorOut: finalCursor,
    hasMore: false,
    reportedTotal,
    returnedIds: items.map((item) => item.commentId),
    items
  }
  const fingerprint = createSchemaFingerprint(selectedPayloads)
  const projectionHash = createResponseProjectionSha256(projection)
  const completedTrace = [...config.priorTrace, trace(source.routeId, 'success', {
    durationMs: totalDurationMs,
    observedAt: latestObservedAt
  }, fingerprint)]
  const baseProof = {
    platform: 'douyin' as const,
    adapterName: config.identity.adapterName,
    adapterVersion: config.identity.adapterVersion,
    schemaVersion: 2 as const,
    routeId: source.routeId,
    sourceKind: source.sourceKind,
    endpointKind: config.endpointKind,
    requestParameters: source.sourceKind === 'embedded-json' ? [] : firstRequestParameters,
    targetWorkId: config.workId,
    requestTargetWorkId: source.sourceKind === 'embedded-json' ? null : config.workId,
    targetWorkIdSourcePath: source.sourceKind === 'embedded-json' ? 'embedded.comment_context.aweme_id' as const : 'request.aweme_id' as const,
    cursorIn: config.initialCursor,
    cursorOut: finalCursor,
    hasMore: false,
    reportedTotal,
    returnedIds: projection.returnedIds,
    commentIds: projection.returnedIds,
    commentBindings: bindings,
    schemaFingerprint: fingerprint,
    responseProjectionSha256: projectionHash,
    routeTrace: completedTrace,
    collectedAt: latestObservedAt,
    browserOrigin: config.context.browserOrigin,
    sessionUsed: true as const,
    validationResults: {
      http: source.sourceKind === 'embedded-json' ? 'not-applicable' as const : 'valid' as const,
      json: 'valid' as const,
      platformStatus: 'valid' as const,
      targetIdentity: 'valid' as const,
      schema: 'valid' as const,
      pagination: 'valid' as const,
      sensitiveFields: 'removed' as const
    }
  }
  const proof = config.endpointKind === 'comment-list'
    ? douyinCommentListStructuredProofSchema.parse({
      contract: 'douyin-comment-list-structured-proof/v2',
      ...baseProof,
      endpointKind: 'comment-list'
    })
    : douyinCommentReplyStructuredProofSchema.parse({
      contract: 'douyin-comment-reply-structured-proof/v2',
      ...baseProof,
      endpointKind: 'comment-reply-list',
      targetRootCommentId: config.rootCommentId,
      requestTargetRootCommentId: source.sourceKind === 'embedded-json' ? null : config.rootCommentId,
      targetRootCommentIdSourcePath: source.sourceKind === 'embedded-json' ? 'embedded.reply_context.cid' : 'request.comment_id'
    })
  const page = createStructuredCommentPageSchema(normalizedDouyinCommentSchema).parse({
    contract: 'platform-adapter-page/v1',
    identity: config.identity,
    operation: config.operation,
    completion: items.length === 0 ? 'verified-empty' : 'complete',
    pagination: {
      cursorIn: config.initialCursor,
      cursorOut: finalCursor,
      hasMore: false,
      reportedTotal,
      returnedCount: items.length,
      duplicateCount: 0
    },
    sourceProof: proof,
    items
  }) as StructuredCommentPage<NormalizedDouyinComment>
  return { ok: true, page }
}

function validateRequest(input: DouyinCommentListRequest): { workId: string; initialCursor: string; pageSize: number; maxPages: number } {
  const workId = opaquePlatformIdSchema.parse(input.workId)
  const initialCursor = input.cursor ?? '0'
  if (!/^\d{1,240}$/.test(initialCursor)) throw new Error('comment cursor must be a non-negative integer string')
  const pageSize = input.pageSize ?? 20
  const maxPages = input.maxPages ?? 20
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('comment pageSize must be from 1 to 100')
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('comment maxPages must be from 1 to 100')
  return { workId, initialCursor, pageSize, maxPages }
}

function orderedSources<RouteId extends StructuredCommentRouteId>(
  sources: Array<CommentRouteSource | ReplyRouteSource>,
  order: readonly RouteId[],
  label: string
): ReadonlyMap<RouteId, CommentRouteSource | ReplyRouteSource> {
  const result = new Map<RouteId, CommentRouteSource | ReplyRouteSource>()
  let lastOrder = -1
  for (const source of sources) {
    const index = order.indexOf(source.routeId as RouteId)
    if (index < 0 || index <= lastOrder || result.has(source.routeId as RouteId)) {
      throw new Error(`${label} route sources must be unique and ordered NETWORK → EMBEDDED → INPAGE → TRIGGER`)
    }
    registeredCommentRoute(source.routeId)
    if (source.sourceKind !== routeSourceKinds[source.routeId]) throw new Error(`${source.routeId} has the wrong sourceKind`)
    result.set(source.routeId as RouteId, source)
    lastOrder = index
  }
  return result
}

export class DouyinCommentListAdapter {
  readonly identity = {
    platform: 'douyin' as const,
    adapterName: 'douyin.comment-list',
    adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 1 as const
  }
  readonly operation = 'comments' as const
  private readonly sources: ReadonlyMap<CommentRouteId, CommentRouteSource | ReplyRouteSource>

  constructor(sources: CommentRouteSource[]) {
    this.sources = orderedSources(sources, COMMENT_ROUTE_ORDER, 'comment')
  }

  async collect(request: DouyinCommentListRequest, context: PlatformAdapterContext): Promise<StructuredCommentPage<NormalizedDouyinComment>> {
    const outcome = await this.collectOutcome(request, context)
    if (!outcome.ok) throw new StructuredCommentCollectionError(outcome)
    return outcome.page
  }

  async collectOutcome(request: DouyinCommentListRequest, context: PlatformAdapterContext): Promise<StructuredCommentAcquisitionOutcome> {
    const parsed = validateRequest(request)
    validateContext(context)
    return collectStructuredComments({
      endpointKind: 'comment-list', operation: this.operation,
      routeOrder: COMMENT_ROUTE_ORDER, stopRouteId: 'DY-COMMENT-STOP', sources: this.sources,
      workId: parsed.workId, rootCommentId: null, initialCursor: parsed.initialCursor,
      pageSize: parsed.pageSize, maxPages: parsed.maxPages, context, identity: this.identity
    })
  }
}

export class DouyinCommentReplyAdapter {
  readonly identity = {
    platform: 'douyin' as const,
    adapterName: 'douyin.comment-replies',
    adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 1 as const
  }
  readonly operation = 'comment-replies' as const
  private readonly sources: ReadonlyMap<ReplyRouteId, CommentRouteSource | ReplyRouteSource>

  constructor(sources: ReplyRouteSource[]) {
    this.sources = orderedSources(sources, REPLY_ROUTE_ORDER, 'reply')
  }

  async collect(request: DouyinCommentReplyRequest, context: PlatformAdapterContext): Promise<StructuredCommentPage<NormalizedDouyinComment>> {
    const outcome = await this.collectOutcome(request, context)
    if (!outcome.ok) throw new StructuredCommentCollectionError(outcome)
    return outcome.page
  }

  async collectOutcome(request: DouyinCommentReplyRequest, context: PlatformAdapterContext): Promise<StructuredCommentAcquisitionOutcome> {
    const parsed = validateRequest(request)
    const rootCommentId = opaquePlatformIdSchema.parse(request.rootCommentId)
    validateContext(context)
    return collectStructuredComments({
      endpointKind: 'comment-reply-list', operation: this.operation,
      routeOrder: REPLY_ROUTE_ORDER, stopRouteId: 'DY-REPLY-STOP', sources: this.sources,
      workId: parsed.workId, rootCommentId, initialCursor: parsed.initialCursor,
      pageSize: parsed.pageSize, maxPages: parsed.maxPages, context, identity: this.identity
    })
  }
}

export function assertNormalizedCommentIsNative(input: unknown): NormalizedDouyinComment {
  const comment = normalizedDouyinCommentSchema.parse(input)
  nativeStructuredCommentItemSchema.parse({
    commentId: comment.commentId,
    commentIdKind: comment.commentIdKind,
    commentIdSourcePath: 'comments[].cid',
    workId: comment.workId,
    workIdSourcePath: 'comments[].aweme_id',
    parentCommentId: comment.parentCommentId,
    rootCommentId: comment.rootCommentId,
    endpointKind: comment.endpointKind
  })
  return comment
}
