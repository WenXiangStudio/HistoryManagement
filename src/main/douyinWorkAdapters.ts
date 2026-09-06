import { z } from 'zod'
import {
  buildPlatformAdapterIssue,
  createPlatformAdapterPageSchema,
  douyinCreatorWorksStructuredProofSchema,
  douyinWorkDetailStructuredProofSchema,
  opaquePlatformIdSchema,
  workAuthorProofSchema,
  type PlatformAdapter,
  type PlatformAdapterContext,
  type PlatformAdapterIssue,
  type PlatformAdapterPage,
  type RouteTraceEntry
} from '../shared/platformAdapter'
import {
  STRUCTURED_ACQUISITION_ADAPTER_VERSION,
  createWorkAuthorProof,
  createWorkDetailVerification,
  publicWorkStatisticFieldSchema,
  publicWorkStatisticsSchema,
  registeredRoute,
  structuredWorkObservationSchema,
  workDetailVerificationSchema,
  type PublicWorkStatistics,
  type StructuredWorkObservation
} from '../shared/structuredAcquisition'
import {
  createResponseProjectionSha256,
  createSchemaFingerprint,
  validateSafeReadOnlyRequest
} from './platformAdapterSecurity'

export const CREATOR_WORK_ROUTE_ORDER = Object.freeze([
  'DY-WORKS-NETWORK',
  'DY-WORKS-EMBEDDED',
  'DY-WORKS-INPAGE'
] as const)

export const WORK_DETAIL_ROUTE_ORDER = Object.freeze([
  'DY-DETAIL-NETWORK',
  'DY-DETAIL-EMBEDDED',
  'DY-DETAIL-INPAGE'
] as const)

export type CreatorWorkRouteId = typeof CREATOR_WORK_ROUTE_ORDER[number]
export type WorkDetailRouteId = typeof WORK_DETAIL_ROUTE_ORDER[number]
export type StructuredWorkSourceKind = 'network-response' | 'embedded-json' | 'page-context-fetch'
export type StructuredWorkUnavailableReason = 'not-observed' | 'schema-missing' | 'schema-changed' | 'signature-unavailable' | 'signature-rejected'

export type StructuredWorkReadRequest = {
  method: 'GET'
  path: string
  parameters: Record<string, unknown>
  headers: Record<string, string>
}

export type StructuredWorkReadResult = {
  outcome: 'unavailable'
  reason: StructuredWorkUnavailableReason
  durationMs: number
  observedAt: string
} | {
  outcome: 'response'
  httpStatus: number
  retryAfterMs?: number | null
  contentType: string | null
  payload: unknown
  request: StructuredWorkReadRequest | null
  durationMs: number
  observedAt: string
}

export type CreatorWorksRouteSource = {
  routeId: CreatorWorkRouteId
  sourceKind: StructuredWorkSourceKind
  readPage(input: {
    creatorId: string
    cursor: string
    count: number
    signal: AbortSignal
  }): Promise<StructuredWorkReadResult>
}

export type WorkDetailRouteSource = {
  routeId: WorkDetailRouteId
  sourceKind: StructuredWorkSourceKind
  readDetail(input: {
    workId: string
    expectedCreatorId: string
    signal: AbortSignal
  }): Promise<StructuredWorkReadResult>
}

const nullableStatisticsSchema = z.object({
  list: publicWorkStatisticsSchema,
  detail: publicWorkStatisticsSchema,
  changedFields: z.array(publicWorkStatisticFieldSchema).max(5)
}).strict()

export const normalizedDouyinWorkSchema = z.object({
  workId: opaquePlatformIdSchema,
  creatorId: opaquePlatformIdSchema,
  authorSecId: opaquePlatformIdSchema.nullable(),
  nickname: z.string().max(200),
  workType: z.enum(['video', 'image']),
  title: z.string().max(1_000),
  description: z.string().max(4_000),
  publishedAt: z.string().datetime().nullable(),
  statistics: nullableStatisticsSchema,
  structuredObservation: structuredWorkObservationSchema,
  authorProof: workAuthorProofSchema,
  detailVerification: workDetailVerificationSchema
}).strict()

export type NormalizedDouyinWork = z.infer<typeof normalizedDouyinWorkSchema>

export const normalizedDouyinWorkDetailSchema = z.object({
  workId: opaquePlatformIdSchema,
  authorId: opaquePlatformIdSchema,
  authorSecId: opaquePlatformIdSchema.nullable(),
  nickname: z.string().max(200),
  workType: z.enum(['video', 'image']),
  title: z.string().max(1_000),
  description: z.string().max(4_000),
  publishedAt: z.string().datetime().nullable(),
  statistics: publicWorkStatisticsSchema,
  structuredObservation: structuredWorkObservationSchema
}).strict()

export type NormalizedDouyinWorkDetail = z.infer<typeof normalizedDouyinWorkDetailSchema>

export type CreatorWorksRequest = {
  followedCreatorId: string
  profileRouteCreatorId: string
  cursor?: string
  pageSize?: number
  maxPages?: number
}

export type WorkDetailRequest = {
  workId: string
  expectedCreatorId: string
}

export type StructuredWorkAcquisitionFailure = {
  ok: false
  completion: 'failed'
  items: []
  routeTrace: RouteTraceEntry[]
  issue: PlatformAdapterIssue
}

export type CreatorWorksAcquisitionOutcome = {
  ok: true
  page: PlatformAdapterPage<NormalizedDouyinWork>
} | StructuredWorkAcquisitionFailure

export type WorkDetailAcquisitionOutcome = {
  ok: true
  page: PlatformAdapterPage<NormalizedDouyinWorkDetail>
} | StructuredWorkAcquisitionFailure

const creatorWorkSourceKinds: Readonly<Record<CreatorWorkRouteId, StructuredWorkSourceKind>> = Object.freeze({
  'DY-WORKS-NETWORK': 'network-response',
  'DY-WORKS-EMBEDDED': 'embedded-json',
  'DY-WORKS-INPAGE': 'page-context-fetch'
})

const workDetailSourceKinds: Readonly<Record<WorkDetailRouteId, StructuredWorkSourceKind>> = Object.freeze({
  'DY-DETAIL-NETWORK': 'network-response',
  'DY-DETAIL-EMBEDDED': 'embedded-json',
  'DY-DETAIL-INPAGE': 'page-context-fetch'
})

const rawOpaqueIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9._-]+$/)
const rawAuthorSchema = z.object({
  uid: rawOpaqueIdSchema.optional(),
  sec_uid: rawOpaqueIdSchema.optional(),
  nickname: z.string().max(500).optional()
}).passthrough().superRefine((author, context) => {
  if (!author.uid && !author.sec_uid) {
    context.addIssue({ code: 'custom', path: ['uid'], message: 'work author requires a native uid or sec_uid' })
  }
})

const rawStatisticsSchema = z.object({
  digg_count: z.unknown().optional(),
  comment_count: z.unknown().optional(),
  collect_count: z.unknown().optional(),
  share_count: z.unknown().optional(),
  play_count: z.unknown().optional()
}).passthrough()

const rawWorkSchema = z.object({
  aweme_id: rawOpaqueIdSchema,
  aweme_type: z.number().int().optional(),
  author: rawAuthorSchema,
  statistics: rawStatisticsSchema.optional(),
  title: z.string().max(5_000).optional(),
  desc: z.string().max(10_000).optional(),
  create_time: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  images: z.array(z.unknown()).max(100).optional()
}).passthrough()

const rawCursorSchema = z.union([z.string().max(240), z.number().int().nonnegative()])
const rawCreatorWorksPageSchema = z.object({
  status_code: z.literal(0),
  aweme_list: z.array(rawWorkSchema).max(1_000),
  profile_user: rawAuthorSchema.optional(),
  cursor: rawCursorSchema.nullable().optional(),
  max_cursor: rawCursorSchema.nullable().optional(),
  has_more: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  total: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional()
}).passthrough()

const rawWorkDetailPageSchema = z.object({
  status_code: z.literal(0),
  aweme_detail: rawWorkSchema
}).passthrough()

type RawAuthor = z.infer<typeof rawAuthorSchema>
type RawWork = z.infer<typeof rawWorkSchema>
type RawCreatorWorksPage = z.infer<typeof rawCreatorWorksPageSchema>

class StructuredWorkCollectionError extends Error {
  constructor(readonly failure: StructuredWorkAcquisitionFailure) {
    super(`${failure.issue.code}:${failure.issue.message}`)
    this.name = 'StructuredWorkCollectionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedStructuredCandidates(value: unknown, key: 'aweme_list' | 'aweme_detail'): unknown[] {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const candidates: unknown[] = []
  const seen = new Set<object>()
  let visited = 0
  while (queue.length > 0 && visited < 256) {
    const current = queue.shift()!
    if (!isRecord(current.value) || seen.has(current.value)) continue
    seen.add(current.value)
    visited += 1
    if ((key === 'aweme_list' && Array.isArray(current.value.aweme_list)) || (key === 'aweme_detail' && isRecord(current.value.aweme_detail))) {
      candidates.push(current.value)
    }
    if (current.depth >= 6) continue
    for (const entry of Object.values(current.value)) {
      if (isRecord(entry)) queue.push({ value: entry, depth: current.depth + 1 })
    }
  }
  return candidates
}

function candidatePayloads(payload: unknown, sourceKind: StructuredWorkSourceKind, key: 'aweme_list' | 'aweme_detail'): unknown[] {
  const direct = isRecord(payload) && isRecord(payload.data) ? [payload.data, payload] : [payload]
  return sourceKind === 'embedded-json' ? [...direct, ...boundedStructuredCandidates(payload, key)] : direct
}

function parseCreatorWorksPage(payload: unknown, sourceKind: StructuredWorkSourceKind): { raw: RawCreatorWorksPage; selected: unknown } | null {
  for (const candidate of candidatePayloads(payload, sourceKind, 'aweme_list')) {
    const parsed = rawCreatorWorksPageSchema.safeParse(candidate)
    if (parsed.success) return { raw: parsed.data, selected: candidate }
  }
  return null
}

function parseWorkDetailPage(payload: unknown, sourceKind: StructuredWorkSourceKind): { raw: z.infer<typeof rawWorkDetailPageSchema>; selected: unknown } | null {
  for (const candidate of candidatePayloads(payload, sourceKind, 'aweme_detail')) {
    const parsed = rawWorkDetailPageSchema.safeParse(candidate)
    if (parsed.success) return { raw: parsed.data, selected: candidate }
  }
  return null
}

function nativeAuthorIdentity(author: RawAuthor, expectedCreatorId: string, prefix: 'aweme_list[]' | 'aweme_detail' | 'embedded.profile_user') {
  if (author.uid === expectedCreatorId) {
    return { authorId: author.uid, authorSecId: author.sec_uid ?? null, sourcePath: `${prefix}.author.uid` as const }
  }
  if (author.sec_uid === expectedCreatorId) {
    return { authorId: author.sec_uid, authorSecId: author.sec_uid, sourcePath: `${prefix}.author.sec_uid` as const }
  }
  const authorId = author.uid ?? author.sec_uid!
  const field = author.uid ? 'uid' : 'sec_uid'
  return { authorId, authorSecId: author.sec_uid ?? null, sourcePath: `${prefix}.author.${field}` as const }
}

function embeddedProfileIdentity(author: RawAuthor, expectedCreatorId: string) {
  if (author.uid === expectedCreatorId) return { creatorId: author.uid, sourcePath: 'embedded.profile_user.uid' as const }
  if (author.sec_uid === expectedCreatorId) return { creatorId: author.sec_uid, sourcePath: 'embedded.profile_user.sec_uid' as const }
  return {
    creatorId: author.uid ?? author.sec_uid!,
    sourcePath: author.uid ? 'embedded.profile_user.uid' as const : 'embedded.profile_user.sec_uid' as const
  }
}

function nonnegativeIntegerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function projectStatistics(work: RawWork): PublicWorkStatistics {
  const statistics = work.statistics ?? {}
  return publicWorkStatisticsSchema.parse({
    likeCount: nonnegativeIntegerOrNull(statistics.digg_count),
    commentCount: nonnegativeIntegerOrNull(statistics.comment_count),
    collectCount: nonnegativeIntegerOrNull(statistics.collect_count),
    shareCount: nonnegativeIntegerOrNull(statistics.share_count),
    playCount: nonnegativeIntegerOrNull(statistics.play_count)
  })
}

function workType(work: RawWork): 'video' | 'image' {
  return work.aweme_type === 68 || Array.isArray(work.images) ? 'image' : 'video'
}

function publishedAt(work: RawWork): string | null {
  if (work.create_time === undefined) return null
  const seconds = Number(work.create_time)
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253_402_300_799) return null
  return new Date(seconds * 1_000).toISOString()
}

function normalizedText(value: string | undefined, maximum: number): string {
  return (value ?? '').normalize('NFKC').trim().slice(0, maximum)
}

function projectedWork(work: RawWork, expectedCreatorId: string, prefix: 'aweme_list[]' | 'aweme_detail') {
  const author = nativeAuthorIdentity(work.author, expectedCreatorId, prefix)
  return {
    workId: work.aweme_id,
    workIdKind: 'native-aweme-id' as const,
    workIdSourcePath: `${prefix}.aweme_id` as const,
    authorId: author.authorId,
    authorSecId: author.authorSecId,
    nickname: normalizedText(work.author.nickname, 200),
    authorIdSourcePath: author.sourcePath,
    workType: workType(work),
    statistics: projectStatistics(work)
  }
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

function normalizeTiming(result: StructuredWorkReadResult, context: PlatformAdapterContext): StructuredWorkReadResult {
  return {
    ...result,
    observedAt: validDate(result.observedAt) ? new Date(result.observedAt).toISOString() : context.now().toISOString(),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : 0
  } as StructuredWorkReadResult
}

function issueCodeForUnavailable(reason: StructuredWorkUnavailableReason): Parameters<typeof buildPlatformAdapterIssue>[0]['code'] {
  if (reason === 'not-observed') return 'NOT_OBSERVED'
  if (reason === 'signature-unavailable') return 'SIGNATURE_UNAVAILABLE'
  if (reason === 'signature-rejected') return 'SIGNATURE_REJECTED'
  return 'SCHEMA_CHANGED'
}

function traceStatusForUnavailable(reason: StructuredWorkUnavailableReason): RouteTraceEntry['status'] {
  return reason === 'schema-changed' ? 'schema-changed' : reason
}

function cursorOf(page: RawCreatorWorksPage): string | null {
  const value = page.cursor ?? page.max_cursor ?? null
  return value === null ? null : String(value)
}

function hasMore(page: RawCreatorWorksPage): boolean {
  return page.has_more === true || page.has_more === 1
}

function totalOf(page: RawCreatorWorksPage): number | null {
  return page.total ?? page.total_count ?? null
}

function failure(
  code: Parameters<typeof buildPlatformAdapterIssue>[0]['code'],
  message: string,
  phase: Parameters<typeof buildPlatformAdapterIssue>[0]['phase'],
  endpointKind: 'creator-work-list' | 'work-detail',
  routeTrace: RouteTraceEntry[],
  context: PlatformAdapterContext,
  httpStatus: number | null = null,
  retryAfterMs: number | null = null
): StructuredWorkAcquisitionFailure {
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
    throw new Error('Douyin work adapters require the approved browser-page context')
  }
}

export class DouyinWorkDetailAdapter implements PlatformAdapter<WorkDetailRequest, NormalizedDouyinWorkDetail> {
  readonly identity = {
    platform: 'douyin' as const,
    adapterName: 'douyin.work-detail',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 1 as const
  }
  readonly operation = 'work-detail' as const
  private readonly sources: ReadonlyMap<WorkDetailRouteId, WorkDetailRouteSource>

  constructor(routeSources: WorkDetailRouteSource[]) {
    const sources = new Map<WorkDetailRouteId, WorkDetailRouteSource>()
    let lastOrder = -1
    for (const source of routeSources) {
      const order = WORK_DETAIL_ROUTE_ORDER.indexOf(source.routeId)
      if (order < 0 || order <= lastOrder || sources.has(source.routeId)) {
        throw new Error('detail route sources must be unique and ordered NETWORK → EMBEDDED → INPAGE')
      }
      registeredRoute(source.routeId)
      if (source.sourceKind !== workDetailSourceKinds[source.routeId]) throw new Error(`detail route ${source.routeId} has the wrong sourceKind`)
      sources.set(source.routeId, source)
      lastOrder = order
    }
    this.sources = sources
  }

  async collect(request: WorkDetailRequest, context: PlatformAdapterContext): Promise<PlatformAdapterPage<NormalizedDouyinWorkDetail>> {
    const outcome = await this.collectOutcome(request, context)
    if (!outcome.ok) throw new StructuredWorkCollectionError(outcome)
    return outcome.page
  }

  async collectOutcome(requestInput: WorkDetailRequest, context: PlatformAdapterContext): Promise<WorkDetailAcquisitionOutcome> {
    validateContext(context)
    const workId = opaquePlatformIdSchema.parse(requestInput.workId)
    const expectedCreatorId = opaquePlatformIdSchema.parse(requestInput.expectedCreatorId)
    const accumulatedTrace: RouteTraceEntry[] = []
    let lastReason: StructuredWorkUnavailableReason = 'not-observed'

    for (const routeId of WORK_DETAIL_ROUTE_ORDER) {
      const source = this.sources.get(routeId)
      if (!source) {
        const reason = routeId === 'DY-DETAIL-NETWORK' ? 'not-observed' : 'schema-missing'
        accumulatedTrace.push(trace(routeId, traceStatusForUnavailable(reason), { durationMs: 0, observedAt: context.now().toISOString() }))
        lastReason = reason
        continue
      }
      if (context.signal.aborted) throw new Error('work detail collection aborted')
      let result: StructuredWorkReadResult
      try {
        result = normalizeTiming(await source.readDetail({ workId, expectedCreatorId, signal: context.signal }), context)
      } catch {
        const stoppedTrace = [...accumulatedTrace, trace(routeId, 'stopped', { durationMs: 0, observedAt: context.now().toISOString() })]
        return failure('HTTP_TRANSIENT', '结构化作品详情路线读取失败', 'request', 'work-detail', stoppedTrace, context)
      }
      if (result.outcome === 'unavailable') {
        accumulatedTrace.push(trace(routeId, traceStatusForUnavailable(result.reason), result))
        lastReason = result.reason
        continue
      }
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        return failure('LOGIN_REQUIRED', `HTTP ${result.httpStatus}`, 'response', 'work-detail', [...accumulatedTrace, trace(routeId, 'login-required', result)], context, result.httpStatus)
      }
      if (result.httpStatus === 429) {
        return failure('RATE_LIMITED', 'HTTP 429', 'response', 'work-detail', [...accumulatedTrace, trace(routeId, 'rate-limited', result)], context, 429, result.retryAfterMs ?? null)
      }
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        return failure('HTTP_TRANSIENT', `HTTP ${result.httpStatus}`, 'response', 'work-detail', [...accumulatedTrace, trace(routeId, 'stopped', result)], context, result.httpStatus)
      }
      if (source.sourceKind !== 'embedded-json' && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(result.contentType ?? '')) {
        return failure('INVALID_CONTENT_TYPE', '结构化作品详情响应不是 JSON', 'response', 'work-detail', [...accumulatedTrace, trace(routeId, 'schema-changed', result)], context)
      }

      let requestParameters: Array<{ name: string; value: string | number | boolean }> = []
      let targetWorkIdSourcePath: 'request.aweme_id' | 'request.item_id' | 'embedded.aweme_detail.aweme_id'
      if (source.sourceKind === 'embedded-json') {
        if (result.request !== null) {
          return failure('UNSAFE_REQUEST', 'embedded 详情路线不得伪造请求元数据', 'request', 'work-detail', [...accumulatedTrace, trace(routeId, 'stopped', result)], context)
        }
        targetWorkIdSourcePath = 'embedded.aweme_detail.aweme_id'
      } else {
        if (!result.request) {
          return failure('UNSAFE_REQUEST', 'Network/in-page 详情路线缺少安全请求证明', 'request', 'work-detail', [...accumulatedTrace, trace(routeId, 'stopped', result)], context)
        }
        let safeRequest
        try {
          safeRequest = validateSafeReadOnlyRequest({
            method: result.request.method,
            endpointKind: 'work-detail',
            path: result.request.path,
            parameters: result.request.parameters,
            headers: result.request.headers
          })
        } catch {
          return failure('UNSAFE_REQUEST', '作品详情请求未通过 GET/path/参数/header 白名单', 'request', 'work-detail', [...accumulatedTrace, trace(routeId, 'stopped', result)], context)
        }
        const parameters = new Map(safeRequest.requestParameters.map((entry) => [entry.name, String(entry.value)]))
        const awemeTarget = parameters.get('aweme_id')
        const itemTarget = parameters.get('item_id')
        if (
          safeRequest.path !== '/aweme/v1/web/aweme/detail/'
          || (awemeTarget === undefined) === (itemTarget === undefined)
          || (awemeTarget ?? itemTarget) !== workId
        ) {
          return failure('UNSAFE_REQUEST', '详情请求路径或唯一目标作品参数与受控请求不一致', 'request', 'work-detail', [...accumulatedTrace, trace(routeId, 'stopped', result)], context)
        }
        requestParameters = safeRequest.requestParameters
        targetWorkIdSourcePath = awemeTarget !== undefined ? 'request.aweme_id' : 'request.item_id'
      }

      const parsed = parseWorkDetailPage(result.payload, source.sourceKind)
      if (!parsed) {
        const fingerprint = createSchemaFingerprint(result.payload)
        accumulatedTrace.push(trace(routeId, 'schema-changed', result, fingerprint))
        lastReason = 'schema-changed'
        continue
      }
      const projected = projectedWork(parsed.raw.aweme_detail, expectedCreatorId, 'aweme_detail')
      const fingerprint = createSchemaFingerprint(parsed.selected)
      if (projected.workId !== workId) {
        return failure('TARGET_ID_MISMATCH', '详情返回的 aweme_id 与目标作品不一致', 'validation', 'work-detail', [...accumulatedTrace, trace(routeId, 'target-id-mismatch', result, fingerprint)], context)
      }
      if (projected.authorId !== expectedCreatorId) {
        return failure('AUTHOR_PROOF_MISMATCH', '详情返回的作者 ID 与已证明关注博主不一致', 'validation', 'work-detail', [...accumulatedTrace, trace(routeId, 'author-proof-mismatch', result, fingerprint)], context)
      }

      const projection = {
        endpointKind: 'work-detail' as const,
        returnedIds: [projected.workId],
        item: projected
      }
      const projectionHash = createResponseProjectionSha256(projection)
      const completedTrace = [...accumulatedTrace, trace(routeId, 'success', result, fingerprint)]
      const observation = structuredWorkObservationSchema.parse({
        contract: 'douyin-structured-work-observation/v1',
        sourceKind: source.sourceKind,
        routeId,
        endpointKind: 'work-detail',
        requestTargetCreatorId: null,
        workId: projected.workId,
        authorId: projected.authorId,
        authorIdSourcePath: projected.authorIdSourcePath,
        observedAt: result.observedAt,
        schemaFingerprint: fingerprint,
        responseProjectionSha256: projectionHash,
        routeTrace: completedTrace
      })
      const proof = douyinWorkDetailStructuredProofSchema.parse({
        contract: 'douyin-work-detail-structured-proof/v2',
        platform: 'douyin',
        adapterName: this.identity.adapterName,
        adapterVersion: this.identity.adapterVersion,
        schemaVersion: 2,
        routeId,
        sourceKind: source.sourceKind,
        endpointKind: 'work-detail',
        targetWorkId: workId,
        returnedWorkId: projected.workId,
        expectedCreatorId,
        observedAuthorId: projected.authorId,
        authorIdSourcePath: projected.authorIdSourcePath,
        targetWorkIdSourcePath,
        requestParameters,
        returnedIds: [projected.workId],
        schemaFingerprint: fingerprint,
        responseProjectionSha256: projectionHash,
        routeTrace: completedTrace,
        collectedAt: result.observedAt,
        browserOrigin: context.browserOrigin,
        sessionUsed: true,
        validationResults: {
          http: source.sourceKind === 'embedded-json' ? 'not-applicable' : 'valid',
          json: 'valid',
          platformStatus: 'valid',
          targetIdentity: 'valid',
          schema: 'valid',
          pagination: 'not-applicable',
          sensitiveFields: 'removed'
        }
      })
      const item = normalizedDouyinWorkDetailSchema.parse({
        workId: projected.workId,
        authorId: projected.authorId,
        authorSecId: projected.authorSecId,
        nickname: projected.nickname,
        workType: projected.workType,
        title: normalizedText(parsed.raw.aweme_detail.title ?? parsed.raw.aweme_detail.desc, 1_000),
        description: normalizedText(parsed.raw.aweme_detail.desc, 4_000),
        publishedAt: publishedAt(parsed.raw.aweme_detail),
        statistics: projected.statistics,
        structuredObservation: observation
      })
      const page = createPlatformAdapterPageSchema(normalizedDouyinWorkDetailSchema).parse({
        contract: 'platform-adapter-page/v1',
        identity: this.identity,
        operation: this.operation,
        completion: 'complete',
        pagination: { cursorIn: null, cursorOut: null, hasMore: false, reportedTotal: 1, returnedCount: 1, duplicateCount: 0 },
        sourceProof: proof,
        items: [item]
      }) as PlatformAdapterPage<NormalizedDouyinWorkDetail>
      return { ok: true, page }
    }

    const stoppedAt = context.now().toISOString()
    accumulatedTrace.push(trace('DY-DETAIL-STOP', 'stopped', { durationMs: 0, observedAt: stoppedAt }))
    return failure(issueCodeForUnavailable(lastReason), '所有结构化作品详情路线均不可用', 'discovery', 'work-detail', accumulatedTrace, context)
  }
}

type CollectedListWork = {
  raw: RawWork
  projection: ReturnType<typeof projectedWork>
}

export class DouyinCreatorWorksAdapter implements PlatformAdapter<CreatorWorksRequest, NormalizedDouyinWork> {
  readonly identity = {
    platform: 'douyin' as const,
    adapterName: 'douyin.creator-works',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 1 as const
  }
  readonly operation = 'creator-works' as const
  private readonly sources: ReadonlyMap<CreatorWorkRouteId, CreatorWorksRouteSource>

  constructor(routeSources: CreatorWorksRouteSource[], private readonly detailAdapter: DouyinWorkDetailAdapter) {
    const sources = new Map<CreatorWorkRouteId, CreatorWorksRouteSource>()
    let lastOrder = -1
    for (const source of routeSources) {
      const order = CREATOR_WORK_ROUTE_ORDER.indexOf(source.routeId)
      if (order < 0 || order <= lastOrder || sources.has(source.routeId)) {
        throw new Error('creator-work route sources must be unique and ordered NETWORK → EMBEDDED → INPAGE')
      }
      registeredRoute(source.routeId)
      if (source.sourceKind !== creatorWorkSourceKinds[source.routeId]) throw new Error(`creator works route ${source.routeId} has the wrong sourceKind`)
      sources.set(source.routeId, source)
      lastOrder = order
    }
    this.sources = sources
  }

  async collect(request: CreatorWorksRequest, context: PlatformAdapterContext): Promise<PlatformAdapterPage<NormalizedDouyinWork>> {
    const outcome = await this.collectOutcome(request, context)
    if (!outcome.ok) throw new StructuredWorkCollectionError(outcome)
    return outcome.page
  }

  async collectOutcome(requestInput: CreatorWorksRequest, context: PlatformAdapterContext): Promise<CreatorWorksAcquisitionOutcome> {
    validateContext(context)
    const followedCreatorId = opaquePlatformIdSchema.parse(requestInput.followedCreatorId)
    const profileRouteCreatorId = opaquePlatformIdSchema.parse(requestInput.profileRouteCreatorId)
    if (followedCreatorId !== profileRouteCreatorId) {
      return failure('AUTHOR_PROOF_MISMATCH', '关注博主 ID 与主页路由 ID 不一致', 'validation', 'creator-work-list', [], context)
    }
    const initialCursor = requestInput.cursor ?? '0'
    if (!/^\d{1,240}$/.test(initialCursor)) throw new Error('creator works cursor must be a non-negative integer string')
    const pageSize = requestInput.pageSize ?? 20
    const maxPages = requestInput.maxPages ?? 20
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('creator works pageSize must be from 1 to 100')
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('creator works maxPages must be from 1 to 100')

    const accumulatedTrace: RouteTraceEntry[] = []
    let lastReason: StructuredWorkUnavailableReason = 'not-observed'
    for (const routeId of CREATOR_WORK_ROUTE_ORDER) {
      const source = this.sources.get(routeId)
      if (!source) {
        const reason = routeId === 'DY-WORKS-NETWORK' ? 'not-observed' : 'schema-missing'
        accumulatedTrace.push(trace(routeId, traceStatusForUnavailable(reason), { durationMs: 0, observedAt: context.now().toISOString() }))
        lastReason = reason
        continue
      }
      const routeResult = await this.tryListRoute(source, {
        followedCreatorId,
        profileRouteCreatorId,
        initialCursor,
        pageSize,
        maxPages,
        priorTrace: accumulatedTrace,
        context
      })
      if (routeResult.ok) return routeResult
      if (routeResult.terminal) return routeResult.failure
      accumulatedTrace.splice(0, accumulatedTrace.length, ...routeResult.routeTrace)
      lastReason = routeResult.reason
    }
    accumulatedTrace.push(trace('DY-WORKS-STOP', 'stopped', { durationMs: 0, observedAt: context.now().toISOString() }))
    return failure(issueCodeForUnavailable(lastReason), '所有结构化作品列表路线均不可用', 'discovery', 'creator-work-list', accumulatedTrace, context)
  }

  private async tryListRoute(
    source: CreatorWorksRouteSource,
    input: {
      followedCreatorId: string
      profileRouteCreatorId: string
      initialCursor: string
      pageSize: number
      maxPages: number
      priorTrace: RouteTraceEntry[]
      context: PlatformAdapterContext
    }
  ): Promise<
    | { ok: true; page: PlatformAdapterPage<NormalizedDouyinWork> }
    | { ok: false; terminal: true; failure: StructuredWorkAcquisitionFailure }
    | { ok: false; terminal: false; reason: StructuredWorkUnavailableReason; routeTrace: RouteTraceEntry[] }
  > {
    const items: CollectedListWork[] = []
    const ids = new Set<string>()
    const cursors = new Set<string>([input.initialCursor])
    const selectedPayloads: unknown[] = []
    let cursor = input.initialCursor
    let finalCursor: string | null = input.initialCursor
    let reportedTotal: number | null = null
    let totalDurationMs = 0
    let latestObservedAt = input.context.now().toISOString()
    let firstRequestParameters: Array<{ name: string; value: string | number | boolean }> = []
    let requestTargetCreatorId = input.followedCreatorId
    let targetCreatorIdSourcePath: 'request.sec_user_id' | 'embedded.profile_user.uid' | 'embedded.profile_user.sec_uid' = 'request.sec_user_id'

    for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
      if (input.context.signal.aborted) throw new Error('creator works collection aborted')
      let result: StructuredWorkReadResult
      try {
        result = normalizeTiming(await source.readPage({ creatorId: input.followedCreatorId, cursor, count: input.pageSize, signal: input.context.signal }), input.context)
      } catch {
        const stoppedTrace = [...input.priorTrace, trace(source.routeId, 'stopped', { durationMs: totalDurationMs, observedAt: input.context.now().toISOString() })]
        return { ok: false, terminal: true, failure: failure('HTTP_TRANSIENT', '结构化作品列表路线读取失败', 'request', 'creator-work-list', stoppedTrace, input.context) }
      }
      latestObservedAt = result.observedAt
      totalDurationMs += Math.max(0, result.durationMs)
      if (result.outcome === 'unavailable') {
        const routeTrace = [...input.priorTrace, trace(source.routeId, traceStatusForUnavailable(result.reason), { durationMs: totalDurationMs, observedAt: result.observedAt })]
        if (items.length > 0) {
          return { ok: false, terminal: true, failure: failure(issueCodeForUnavailable(result.reason), '作品列表路线在分页闭合前失效', 'pagination', 'creator-work-list', routeTrace, input.context) }
        }
        return { ok: false, terminal: false, reason: result.reason, routeTrace }
      }
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        return { ok: false, terminal: true, failure: failure('LOGIN_REQUIRED', `HTTP ${result.httpStatus}`, 'response', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'login-required', result)], input.context, result.httpStatus) }
      }
      if (result.httpStatus === 429) {
        return { ok: false, terminal: true, failure: failure('RATE_LIMITED', 'HTTP 429', 'response', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'rate-limited', result)], input.context, 429, result.retryAfterMs ?? null) }
      }
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        return { ok: false, terminal: true, failure: failure('HTTP_TRANSIENT', `HTTP ${result.httpStatus}`, 'response', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'stopped', result)], input.context, result.httpStatus) }
      }
      if (source.sourceKind !== 'embedded-json' && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(result.contentType ?? '')) {
        return { ok: false, terminal: true, failure: failure('INVALID_CONTENT_TYPE', '结构化作品列表响应不是 JSON', 'response', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'schema-changed', result)], input.context) }
      }

      if (source.sourceKind === 'embedded-json') {
        if (result.request !== null) {
          return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', 'embedded 作品路线不得伪造请求元数据', 'request', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'stopped', result)], input.context) }
        }
      } else {
        if (!result.request) {
          return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', 'Network/in-page 作品路线缺少安全请求证明', 'request', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'stopped', result)], input.context) }
        }
        let safeRequest
        try {
          safeRequest = validateSafeReadOnlyRequest({
            method: result.request.method,
            endpointKind: 'creator-work-list',
            path: result.request.path,
            parameters: result.request.parameters,
            headers: result.request.headers
          })
        } catch {
          return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', '作品列表请求未通过 GET/path/参数/header 白名单', 'request', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'stopped', result)], input.context) }
        }
        const parameters = new Map(safeRequest.requestParameters.map((entry) => [entry.name, String(entry.value)]))
        if (
          safeRequest.path !== '/aweme/v1/web/aweme/post/'
          || parameters.get('sec_user_id') !== input.followedCreatorId
          || parameters.get('cursor') !== cursor
          || parameters.get('count') !== String(input.pageSize)
        ) {
          return { ok: false, terminal: true, failure: failure('UNSAFE_REQUEST', '作品请求路径、作者目标、cursor 或 count 与受控请求不一致', 'request', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'stopped', result)], input.context) }
        }
        if (pageIndex === 0) firstRequestParameters = safeRequest.requestParameters
      }

      const parsed = parseCreatorWorksPage(result.payload, source.sourceKind)
      if (!parsed) {
        const fingerprint = createSchemaFingerprint(result.payload)
        const routeTrace = [...input.priorTrace, trace(source.routeId, 'schema-changed', result, fingerprint)]
        if (items.length > 0) {
          return { ok: false, terminal: true, failure: failure('SCHEMA_CHANGED', '作品列表 schema 在分页中发生变化', 'validation', 'creator-work-list', routeTrace, input.context) }
        }
        return { ok: false, terminal: false, reason: 'schema-changed', routeTrace }
      }
      if (source.sourceKind === 'embedded-json') {
        if (!parsed.raw.profile_user) {
          const fingerprint = createSchemaFingerprint(parsed.selected)
          return { ok: false, terminal: false, reason: 'schema-missing', routeTrace: [...input.priorTrace, trace(source.routeId, 'schema-missing', result, fingerprint)] }
        }
        const profileIdentity = embeddedProfileIdentity(parsed.raw.profile_user, input.followedCreatorId)
        requestTargetCreatorId = profileIdentity.creatorId
        targetCreatorIdSourcePath = profileIdentity.sourcePath
        if (requestTargetCreatorId !== input.followedCreatorId) {
          const fingerprint = createSchemaFingerprint(parsed.selected)
          return { ok: false, terminal: true, failure: failure('AUTHOR_PROOF_MISMATCH', 'embedded 主页 owner 与关注博主 ID 不一致', 'validation', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'author-proof-mismatch', result, fingerprint)], input.context) }
        }
      }

      selectedPayloads.push(parsed.selected)
      if (parsed.raw.aweme_list.length === 0 && hasMore(parsed.raw)) {
        return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', '空作品页不能声明 has_more=true', 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'pagination-error', result)], input.context) }
      }
      for (const raw of parsed.raw.aweme_list) {
        const projection = projectedWork(raw, input.followedCreatorId, 'aweme_list[]')
        if (projection.authorId !== input.followedCreatorId) {
          return { ok: false, terminal: true, failure: failure('AUTHOR_PROOF_MISMATCH', '作品列表混入目标关注博主之外的结构化作者', 'validation', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'author-proof-mismatch', result, createSchemaFingerprint(parsed.selected))], input.context) }
        }
        if (ids.has(projection.workId)) {
          return { ok: false, terminal: true, failure: failure('DUPLICATE_NATIVE_ID', `重复 aweme_id: ${projection.workId}`, 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'duplicate-native-id', result)], input.context) }
        }
        ids.add(projection.workId)
        items.push({ raw, projection })
      }
      reportedTotal = totalOf(parsed.raw) ?? reportedTotal
      finalCursor = cursorOf(parsed.raw)
      if (!hasMore(parsed.raw)) break
      if (finalCursor === null || cursors.has(finalCursor)) {
        return { ok: false, terminal: true, failure: failure('CURSOR_LOOP', '作品列表 cursor 未前进或形成循环', 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'cursor-loop', result)], input.context) }
      }
      cursors.add(finalCursor)
      cursor = finalCursor
      if (pageIndex === input.maxPages - 1) {
        return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', '作品列表在 maxPages 内未闭合', 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'pagination-error', result)], input.context) }
      }
    }

    if (reportedTotal !== null && reportedTotal < items.length) {
      return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', 'reportedTotal 小于返回的唯一作品数', 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'pagination-error', { durationMs: totalDurationMs, observedAt: latestObservedAt })], input.context) }
    }
    if (items.length === 0 && reportedTotal !== 0) {
      return { ok: false, terminal: true, failure: failure('PAGINATION_PROTOCOL_ERROR', 'verified-empty 作品列表要求 reportedTotal=0', 'pagination', 'creator-work-list', [...input.priorTrace, trace(source.routeId, 'pagination-error', { durationMs: totalDurationMs, observedAt: latestObservedAt })], input.context) }
    }

    const listProjection = {
      endpointKind: 'creator-work-list' as const,
      cursorIn: input.initialCursor,
      cursorOut: finalCursor,
      hasMore: false,
      reportedTotal,
      returnedIds: items.map(({ projection }) => projection.workId),
      items: items.map(({ projection }) => projection)
    }
    const fingerprint = createSchemaFingerprint(selectedPayloads)
    const projectionHash = createResponseProjectionSha256(listProjection)
    const completedTrace = [...input.priorTrace, trace(source.routeId, 'success', { durationMs: totalDurationMs, observedAt: latestObservedAt }, fingerprint)]
    const observations = items.map(({ projection }) => structuredWorkObservationSchema.parse({
      contract: 'douyin-structured-work-observation/v1',
      sourceKind: source.sourceKind,
      routeId: source.routeId,
      endpointKind: 'creator-work-list',
      requestTargetCreatorId,
      workId: projection.workId,
      authorId: projection.authorId,
      authorIdSourcePath: projection.authorIdSourcePath,
      observedAt: latestObservedAt,
      schemaFingerprint: fingerprint,
      responseProjectionSha256: projectionHash,
      routeTrace: completedTrace
    }))
    const proof = douyinCreatorWorksStructuredProofSchema.parse({
      contract: 'douyin-creator-works-structured-proof/v2',
      platform: 'douyin',
      adapterName: this.identity.adapterName,
      adapterVersion: this.identity.adapterVersion,
      schemaVersion: 2,
      routeId: source.routeId,
      sourceKind: source.sourceKind,
      endpointKind: 'creator-work-list',
      followedCreatorId: input.followedCreatorId,
      profileRouteCreatorId: input.profileRouteCreatorId,
      requestTargetCreatorId,
      targetCreatorIdSourcePath,
      requestParameters: source.sourceKind === 'embedded-json' ? [] : firstRequestParameters,
      cursorIn: input.initialCursor,
      cursorOut: finalCursor,
      hasMore: false,
      reportedTotal,
      returnedIds: listProjection.returnedIds,
      workIds: listProjection.returnedIds,
      authorBindings: items.map(({ projection }) => ({ workId: projection.workId, authorId: projection.authorId })),
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

    const normalizedItems: NormalizedDouyinWork[] = []
    for (let index = 0; index < items.length; index += 1) {
      const collected = items[index]
      const listObservation = observations[index]
      const detailOutcome = await this.detailAdapter.collectOutcome({
        workId: collected.projection.workId,
        expectedCreatorId: input.followedCreatorId
      }, input.context)
      if (!detailOutcome.ok) {
        return {
          ok: false,
          terminal: true,
          failure: {
            ...detailOutcome,
            routeTrace: [...completedTrace, ...detailOutcome.routeTrace].slice(-32)
          }
        }
      }
      const detail = detailOutcome.page.items[0]
      if (!detail) {
        return { ok: false, terminal: true, failure: failure('TARGET_ID_MISMATCH', '详情适配器未返回唯一作品', 'validation', 'work-detail', completedTrace, input.context) }
      }
      const detailVerification = createWorkDetailVerification({
        workId: collected.projection.workId,
        expectedCreatorId: input.followedCreatorId,
        listObservation,
        detailObservation: detail.structuredObservation,
        detailSourceProof: detailOutcome.page.sourceProof,
        listStatistics: collected.projection.statistics,
        detailStatistics: detail.statistics,
        verifiedAt: detail.structuredObservation.observedAt
      })
      const authorProof = createWorkAuthorProof({
        followedCreatorId: input.followedCreatorId,
        profileRouteCreatorId: input.profileRouteCreatorId,
        observation: listObservation
      })
      normalizedItems.push(normalizedDouyinWorkSchema.parse({
        workId: collected.projection.workId,
        creatorId: input.followedCreatorId,
        authorSecId: collected.projection.authorSecId,
        nickname: collected.projection.nickname,
        workType: detail.workType,
        title: detail.title || normalizedText(collected.raw.title ?? collected.raw.desc, 1_000),
        description: detail.description || normalizedText(collected.raw.desc, 4_000),
        publishedAt: detail.publishedAt ?? publishedAt(collected.raw),
        statistics: {
          list: collected.projection.statistics,
          detail: detail.statistics,
          changedFields: detailVerification.changedStatisticFields
        },
        structuredObservation: listObservation,
        authorProof,
        detailVerification
      }))
    }

    const page = createPlatformAdapterPageSchema(normalizedDouyinWorkSchema).parse({
      contract: 'platform-adapter-page/v1',
      identity: this.identity,
      operation: this.operation,
      completion: normalizedItems.length === 0 ? 'verified-empty' : 'complete',
      pagination: {
        cursorIn: input.initialCursor,
        cursorOut: finalCursor,
        hasMore: false,
        reportedTotal,
        returnedCount: normalizedItems.length,
        duplicateCount: 0
      },
      sourceProof: proof,
      items: normalizedItems
    }) as PlatformAdapterPage<NormalizedDouyinWork>
    return { ok: true, page }
  }
}

export function workRouteIsRegistered(routeId: CreatorWorkRouteId | WorkDetailRouteId): boolean {
  return Boolean(registeredRoute(routeId))
}
