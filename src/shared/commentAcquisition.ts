import { z } from 'zod'
import {
  adapterValidationResultsSchema,
  opaquePlatformIdSchema,
  persistedRequestParameterSchema,
  routePolicySchema,
  routeTraceSchema,
  sha256DigestSchema,
  type RoutePolicy,
  type RouteTraceEntry
} from './platformAdapter'

export const COMMENT_ACQUISITION_ADAPTER_VERSION = '0.2.0-r5'

const commentPolicies = [
  {
    routeId: 'DY-COMMENT-NETWORK', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-COMMENT-EMBEDDED',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-COMMENT-EMBEDDED', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 5_000,
    switchOn: ['schema-missing', 'schema-changed'], nextRouteId: 'DY-COMMENT-INPAGE',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-COMMENT-INPAGE', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['signature-unavailable', 'signature-rejected', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-COMMENT-TRIGGER',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-COMMENT-TRIGGER', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-COMMENT-STOP',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-COMMENT-STOP', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 1,
    switchOn: [], nextRouteId: null, requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-NETWORK', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-REPLY-EMBEDDED',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-EMBEDDED', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 5_000,
    switchOn: ['schema-missing', 'schema-changed'], nextRouteId: 'DY-REPLY-INPAGE',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-INPAGE', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['signature-unavailable', 'signature-rejected', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-REPLY-TRIGGER',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-TRIGGER', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'], nextRouteId: 'DY-REPLY-STOP',
    requiresNewUserApproval: false, eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-STOP', adapterVersion: COMMENT_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc', allowedMethods: ['GET'], maxAttempts: 1, timeoutMs: 1,
    switchOn: [], nextRouteId: null, requiresNewUserApproval: false, eligibleForFormalData: false
  }
] satisfies RoutePolicy[]

export const COMMENT_ROUTE_REGISTRY = Object.freeze(Object.fromEntries(
  commentPolicies.map((policy) => {
    const parsed = routePolicySchema.parse(policy)
    return [parsed.routeId, Object.freeze(parsed)]
  })
) as Readonly<Record<string, RoutePolicy>>)

export function registeredCommentRoute(routeId: string): RoutePolicy {
  const policy = COMMENT_ROUTE_REGISTRY[routeId]
  if (!policy) throw new Error(`UNREGISTERED_COMMENT_ROUTE:${routeId}`)
  return policy
}

export const structuredCommentSourceKindSchema = z.enum([
  'network-response',
  'embedded-json',
  'page-context-fetch',
  'triggered-network-response'
])

const persistedRequestParametersSchema = z.array(persistedRequestParameterSchema)
  .max(24)
  .refine((entries) => new Set(entries.map((entry) => entry.name)).size === entries.length, {
    message: 'request parameter names must be unique'
  })

const returnedIdsSchema = z.array(opaquePlatformIdSchema).max(1_000)
  .refine((values) => new Set(values).size === values.length, {
    message: 'returnedIds must not contain duplicates'
  })

const commentBindingSchema = z.object({
  commentId: opaquePlatformIdSchema,
  workId: opaquePlatformIdSchema,
  parentCommentId: opaquePlatformIdSchema.nullable(),
  rootCommentId: opaquePlatformIdSchema.nullable()
}).strict()

const commonProofShape = {
  platform: z.literal('douyin'),
  adapterName: z.enum(['douyin.comment-list', 'douyin.comment-replies']),
  adapterVersion: z.literal(COMMENT_ACQUISITION_ADAPTER_VERSION),
  schemaVersion: z.literal(2),
  sourceKind: structuredCommentSourceKindSchema,
  requestParameters: persistedRequestParametersSchema,
  targetWorkId: opaquePlatformIdSchema,
  requestTargetWorkId: opaquePlatformIdSchema.nullable(),
  targetWorkIdSourcePath: z.enum(['request.aweme_id', 'embedded.comment_context.aweme_id']),
  cursorIn: z.string().max(240).nullable(),
  cursorOut: z.string().max(240).nullable(),
  hasMore: z.boolean(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  returnedIds: returnedIdsSchema,
  commentIds: returnedIdsSchema,
  commentBindings: z.array(commentBindingSchema).max(1_000),
  schemaFingerprint: sha256DigestSchema,
  responseProjectionSha256: sha256DigestSchema,
  routeTrace: routeTraceSchema,
  collectedAt: z.string().datetime(),
  browserOrigin: z.literal('https://www.douyin.com'),
  sessionUsed: z.literal(true),
  validationResults: adapterValidationResultsSchema
} as const

type CommonProof = {
  routeId: string
  sourceKind: z.infer<typeof structuredCommentSourceKindSchema>
  requestParameters: Array<z.infer<typeof persistedRequestParameterSchema>>
  targetWorkId: string
  requestTargetWorkId: string | null
  targetWorkIdSourcePath: 'request.aweme_id' | 'embedded.comment_context.aweme_id'
  cursorIn: string | null
  hasMore: boolean
  reportedTotal: number | null
  returnedIds: string[]
  commentIds: string[]
  commentBindings: Array<z.infer<typeof commentBindingSchema>>
  schemaFingerprint: string
  routeTrace: RouteTraceEntry[]
  collectedAt: string
}

function parameterValue(proof: CommonProof, name: string): string | number | boolean | undefined {
  return proof.requestParameters.find((entry) => entry.name === name)?.value
}

function validateRequestParameters(
  proof: CommonProof,
  context: z.RefinementCtx,
  allowed: ReadonlySet<string>
): void {
  if (proof.sourceKind === 'embedded-json') return
  const names = proof.requestParameters.map((entry) => entry.name)
  if (names.some((name) => !allowed.has(name))) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'comment request contains a parameter outside its endpoint allowlist' })
  }
  if (!names.includes('aweme_id') || !names.includes('cursor') || !names.includes('count')) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'comment requests require aweme_id, cursor, and count' })
  }
  if (proof.cursorIn === null || String(parameterValue(proof, 'cursor') ?? '') !== proof.cursorIn) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'request cursor must match proof.cursorIn' })
  }
  const count = Number(parameterValue(proof, 'count'))
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'comment request count must be from 1 to 100' })
  }
}

function validateCommon(
  proof: CommonProof,
  context: z.RefinementCtx,
  routeMap: Record<string, z.infer<typeof structuredCommentSourceKindSchema>>
): void {
  if (JSON.stringify(proof.commentIds) !== JSON.stringify(proof.returnedIds)) {
    context.addIssue({ code: 'custom', path: ['commentIds'], message: 'commentIds must exactly match returnedIds' })
  }
  if (JSON.stringify(proof.commentBindings.map((binding) => binding.commentId)) !== JSON.stringify(proof.commentIds)) {
    context.addIssue({ code: 'custom', path: ['commentBindings'], message: 'comment bindings must exactly follow commentIds order' })
  }
  if (proof.commentBindings.some((binding) => binding.workId !== proof.targetWorkId)) {
    context.addIssue({ code: 'custom', path: ['commentBindings'], message: 'TARGET_ID_MISMATCH: every comment aweme_id must match targetWorkId' })
  }
  if (routeMap[proof.routeId] !== proof.sourceKind) {
    context.addIssue({ code: 'custom', path: ['routeId'], message: 'comment route must match its source kind' })
  }
  const success = proof.routeTrace.find((entry) => entry.routeId === proof.routeId && entry.status === 'success')
  if (!success || success.schemaFingerprint !== proof.schemaFingerprint || success.occurredAt !== proof.collectedAt) {
    context.addIssue({ code: 'custom', path: ['routeTrace'], message: 'comment proof requires a successful matching route trace, fingerprint, and time' })
  }
  if (proof.commentIds.length === 0 && (proof.reportedTotal !== 0 || proof.hasMore)) {
    context.addIssue({ code: 'custom', path: ['reportedTotal'], message: 'verified-empty comments require total=0 and hasMore=false' })
  }
  if (proof.sourceKind === 'embedded-json') {
    if (
      proof.requestTargetWorkId !== null
      || proof.requestParameters.length !== 0
      || proof.targetWorkIdSourcePath !== 'embedded.comment_context.aweme_id'
    ) {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'embedded comment target must come only from structured embedded context' })
    }
  } else if (
    proof.requestTargetWorkId !== proof.targetWorkId
    || proof.targetWorkIdSourcePath !== 'request.aweme_id'
    || String(parameterValue(proof, 'aweme_id') ?? '') !== proof.targetWorkId
  ) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'aweme_id must independently match targetWorkId' })
  }
}

export const douyinCommentListStructuredProofSchema = z.object({
  contract: z.literal('douyin-comment-list-structured-proof/v2'),
  ...commonProofShape,
  adapterName: z.literal('douyin.comment-list'),
  routeId: z.enum(['DY-COMMENT-NETWORK', 'DY-COMMENT-EMBEDDED', 'DY-COMMENT-INPAGE', 'DY-COMMENT-TRIGGER']),
  endpointKind: z.literal('comment-list')
}).strict().superRefine((proof, context) => {
  validateCommon(proof, context, {
    'DY-COMMENT-NETWORK': 'network-response',
    'DY-COMMENT-EMBEDDED': 'embedded-json',
    'DY-COMMENT-INPAGE': 'page-context-fetch',
    'DY-COMMENT-TRIGGER': 'triggered-network-response'
  })
  validateRequestParameters(proof, context, new Set([
    'aid', 'aweme_id', 'channel', 'count', 'cursor', 'device_platform'
  ]))
  if (proof.commentBindings.some((binding) => binding.parentCommentId !== null || binding.rootCommentId !== null)) {
    context.addIssue({ code: 'custom', path: ['commentBindings'], message: 'root comments cannot claim parent or root relationships' })
  }
  if (parameterValue(proof, 'comment_id') !== undefined) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'root comment requests must not contain comment_id' })
  }
})

export const douyinCommentReplyStructuredProofSchema = z.object({
  contract: z.literal('douyin-comment-reply-structured-proof/v2'),
  ...commonProofShape,
  adapterName: z.literal('douyin.comment-replies'),
  routeId: z.enum(['DY-REPLY-NETWORK', 'DY-REPLY-EMBEDDED', 'DY-REPLY-INPAGE', 'DY-REPLY-TRIGGER']),
  endpointKind: z.literal('comment-reply-list'),
  targetRootCommentId: opaquePlatformIdSchema,
  requestTargetRootCommentId: opaquePlatformIdSchema.nullable(),
  targetRootCommentIdSourcePath: z.enum(['request.comment_id', 'embedded.reply_context.cid'])
}).strict().superRefine((proof, context) => {
  validateCommon(proof, context, {
    'DY-REPLY-NETWORK': 'network-response',
    'DY-REPLY-EMBEDDED': 'embedded-json',
    'DY-REPLY-INPAGE': 'page-context-fetch',
    'DY-REPLY-TRIGGER': 'triggered-network-response'
  })
  validateRequestParameters(proof, context, new Set([
    'aid', 'aweme_id', 'channel', 'comment_id', 'count', 'cursor', 'device_platform', 'item_id'
  ]))
  if (proof.commentBindings.some((binding) => binding.parentCommentId === null || binding.rootCommentId !== proof.targetRootCommentId)) {
    context.addIssue({ code: 'custom', path: ['commentBindings'], message: 'TARGET_ID_MISMATCH: replies require a parent and the requested root relationship' })
  }
  if (proof.sourceKind === 'embedded-json') {
    if (
      proof.requestTargetRootCommentId !== null
      || proof.targetRootCommentIdSourcePath !== 'embedded.reply_context.cid'
    ) {
      context.addIssue({ code: 'custom', path: ['targetRootCommentIdSourcePath'], message: 'embedded reply root must come from structured reply context' })
    }
  } else if (
    proof.requestTargetRootCommentId !== proof.targetRootCommentId
    || proof.targetRootCommentIdSourcePath !== 'request.comment_id'
    || String(parameterValue(proof, 'comment_id') ?? '') !== proof.targetRootCommentId
  ) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'TARGET_ID_MISMATCH: request comment_id must match targetRootCommentId' })
  }
})

export const structuredCommentProofSchema = z.union([
  douyinCommentListStructuredProofSchema,
  douyinCommentReplyStructuredProofSchema
])

export type StructuredCommentProof = z.infer<typeof structuredCommentProofSchema>
export type DouyinCommentListStructuredProof = z.infer<typeof douyinCommentListStructuredProofSchema>
export type DouyinCommentReplyStructuredProof = z.infer<typeof douyinCommentReplyStructuredProofSchema>
export type StructuredCommentSourceKind = z.infer<typeof structuredCommentSourceKindSchema>

export function createStructuredCommentPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    contract: z.literal('platform-adapter-page/v1'),
    identity: z.object({
      platform: z.literal('douyin'),
      adapterName: z.enum(['douyin.comment-list', 'douyin.comment-replies']),
      adapterVersion: z.literal(COMMENT_ACQUISITION_ADAPTER_VERSION),
      schemaVersion: z.literal(1)
    }).strict(),
    operation: z.enum(['comments', 'comment-replies']),
    completion: z.enum(['partial', 'complete', 'verified-empty']),
    pagination: z.object({
      cursorIn: z.string().max(240).nullable(),
      cursorOut: z.string().max(240).nullable(),
      hasMore: z.boolean(),
      reportedTotal: z.number().int().nonnegative().nullable(),
      returnedCount: z.number().int().nonnegative(),
      duplicateCount: z.number().int().nonnegative()
    }).strict(),
    sourceProof: structuredCommentProofSchema,
    items: z.array(itemSchema).max(1_000)
  }).strict().superRefine((page, context) => {
    if (page.pagination.returnedCount !== page.items.length) {
      context.addIssue({ code: 'custom', path: ['pagination', 'returnedCount'], message: 'returnedCount must equal items.length' })
    }
    if (page.completion === 'verified-empty' && (
      page.items.length !== 0 || page.pagination.hasMore || page.pagination.reportedTotal !== 0
    )) {
      context.addIssue({ code: 'custom', path: ['completion'], message: 'verified-empty requires zero items, hasMore=false, and reportedTotal=0' })
    }
    if (page.completion === 'complete' && page.pagination.hasMore) {
      context.addIssue({ code: 'custom', path: ['completion'], message: 'complete pages cannot have hasMore=true' })
    }
    if (page.items.length === 0 && page.pagination.hasMore) {
      context.addIssue({ code: 'custom', path: ['pagination'], message: 'an empty page with hasMore=true is a protocol error' })
    }
  })
}

export type StructuredCommentPage<T> = {
  contract: 'platform-adapter-page/v1'
  identity: {
    platform: 'douyin'
    adapterName: 'douyin.comment-list' | 'douyin.comment-replies'
    adapterVersion: typeof COMMENT_ACQUISITION_ADAPTER_VERSION
    schemaVersion: 1
  }
  operation: 'comments' | 'comment-replies'
  completion: 'partial' | 'complete' | 'verified-empty'
  pagination: {
    cursorIn: string | null
    cursorOut: string | null
    hasMore: boolean
    reportedTotal: number | null
    returnedCount: number
    duplicateCount: number
  }
  sourceProof: StructuredCommentProof
  items: T[]
}
