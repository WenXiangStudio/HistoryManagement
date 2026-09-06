import { z } from 'zod'

export const platformAdapterNameSchema = z.string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, 'adapterName must be a stable lowercase identifier')

export const platformAdapterVersionSchema = z.string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, 'adapterVersion must be semantic-versioned')

export const platformOperationSchema = z.enum([
  'following',
  'creator-works',
  'work-detail',
  'comments',
  'comment-replies',
  'media-resolve'
])

export const adapterEndpointKindSchema = z.enum([
  'following-list',
  'creator-work-list',
  'work-detail',
  'comment-list',
  'comment-reply-list',
  'media-resource'
])

export const evidenceLevelSchema = z.enum([
  'E1-source',
  'E2-doc',
  'E3-local-poc',
  'E4-product'
])

export const opaquePlatformIdSchema = z.string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._-]+$/, 'platform identifiers must be opaque and path-safe')
  .refine((value) => value !== 'self', { message: 'self is not a native platform identifier' })

export const sha256DigestSchema = z.string()
  .regex(/^[a-f0-9]{64}$/, 'digest must be a lowercase SHA-256')

export const routeIdSchema = z.string()
  .min(3)
  .max(80)
  .regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/, 'routeId must be a stable uppercase identifier')

export const routeTraceStatusSchema = z.enum([
  'success',
  'not-observed',
  'schema-missing',
  'schema-changed',
  'unrecognized-path',
  'signature-unavailable',
  'signature-rejected',
  'login-required',
  'security-challenge',
  'rate-limited',
  'cursor-loop',
  'duplicate-native-id',
  'pagination-error',
  'target-id-mismatch',
  'author-proof-mismatch',
  'dom-mismatch',
  'stopped'
])

export const routeTraceEntrySchema = z.object({
  routeId: routeIdSchema,
  status: routeTraceStatusSchema,
  attempt: z.number().int().positive().max(10),
  durationMs: z.number().int().nonnegative().max(300_000),
  schemaFingerprint: sha256DigestSchema.nullable(),
  occurredAt: z.string().datetime()
}).strict()

export const routeTraceSchema = z.array(routeTraceEntrySchema).max(32)

export const routePolicySchema = z.object({
  routeId: routeIdSchema,
  adapterVersion: platformAdapterVersionSchema,
  evidenceLevel: evidenceLevelSchema,
  allowedMethods: z.tuple([z.literal('GET')]),
  maxAttempts: z.number().int().positive().max(3),
  timeoutMs: z.number().int().positive().max(120_000),
  switchOn: z.array(routeTraceStatusSchema).max(16),
  nextRouteId: routeIdSchema.nullable(),
  requiresNewUserApproval: z.boolean(),
  eligibleForFormalData: z.boolean()
}).strict()

export const workAuthorProofSchema = z.object({
  contract: z.literal('douyin-work-author-proof/v2'),
  followedCreatorId: opaquePlatformIdSchema,
  profileRouteCreatorId: opaquePlatformIdSchema,
  requestTargetCreatorId: opaquePlatformIdSchema.nullable(),
  observedWorkAuthorId: opaquePlatformIdSchema,
  observedWorkId: opaquePlatformIdSchema,
  authorProofSource: z.enum(['network-response', 'embedded-json', 'page-context-fetch']),
  endpointKind: z.enum(['creator-work-list', 'work-detail', 'follow-feed']),
  routeId: routeIdSchema,
  adapterVersion: platformAdapterVersionSchema,
  observedAt: z.string().datetime(),
  schemaFingerprint: sha256DigestSchema,
  responseProjectionSha256: sha256DigestSchema,
  routeTrace: routeTraceSchema
}).strict().superRefine((proof, context) => {
  const identities = [
    proof.profileRouteCreatorId,
    proof.requestTargetCreatorId,
    proof.observedWorkAuthorId
  ].filter((value): value is string => value !== null)
  if (identities.some((value) => value !== proof.followedCreatorId)) {
    context.addIssue({
      code: 'custom',
      path: ['observedWorkAuthorId'],
      message: 'AUTHOR_PROOF_MISMATCH: followed, profile, request, and observed author IDs must agree'
    })
  }
  if (proof.endpointKind === 'creator-work-list' && proof.requestTargetCreatorId === null) {
    context.addIssue({
      code: 'custom',
      path: ['requestTargetCreatorId'],
      message: 'creator-work-list proofs require an independently observed request target'
    })
  }
  const expectedRoute = {
    'DY-WORKS-NETWORK': { sourceKind: 'network-response', endpointKind: 'creator-work-list' },
    'DY-WORKS-EMBEDDED': { sourceKind: 'embedded-json', endpointKind: 'creator-work-list' },
    'DY-WORKS-INPAGE': { sourceKind: 'page-context-fetch', endpointKind: 'creator-work-list' },
    'DY-DETAIL-NETWORK': { sourceKind: 'network-response', endpointKind: 'work-detail' },
    'DY-DETAIL-EMBEDDED': { sourceKind: 'embedded-json', endpointKind: 'work-detail' },
    'DY-DETAIL-INPAGE': { sourceKind: 'page-context-fetch', endpointKind: 'work-detail' }
  }[proof.routeId]
  if (expectedRoute && (expectedRoute.sourceKind !== proof.authorProofSource || expectedRoute.endpointKind !== proof.endpointKind)) {
    context.addIssue({
      code: 'custom',
      path: ['routeId'],
      message: 'author proof route, source kind, and endpoint kind must agree'
    })
  }
  const successfulTrace = proof.routeTrace.find((entry) => entry.routeId === proof.routeId && entry.status === 'success')
  if (!successfulTrace || successfulTrace.schemaFingerprint !== proof.schemaFingerprint) {
    context.addIssue({
      code: 'custom',
      path: ['routeTrace'],
      message: 'author proof requires a successful matching route trace and schema fingerprint'
    })
  }
})

export const structuredReadRequestSchema = z.object({
  contract: z.literal('structured-read-request/v1'),
  method: z.literal('GET'),
  endpointKind: adapterEndpointKindSchema,
  path: z.string().min(1).max(512)
    .regex(/^\/(?!\/)[^?#\r\n]*$/, 'path must be a relative pathname without query or fragment'),
  requestParameters: z.array(z.object({
    name: z.string().min(1).max(64),
    value: z.union([z.string().max(512), z.number().finite(), z.boolean()])
  }).strict()).max(24)
}).strict()

export const adapterSourceKindSchema = z.enum([
  'network-response',
  'page-context-fetch',
  'embedded-json',
  'dom-fallback'
])

export const mediaSourceKindSchema = z.enum([
  'structured-detail',
  'media-element',
  'performance-resource',
  'network-response',
  'yt-dlp-extractor'
])

export const persistedRequestParameterNameSchema = z.enum([
  'aid',
  'aweme_id',
  'channel',
  'comment_id',
  'count',
  'cursor',
  'device_platform',
  'item_id',
  'max_cursor',
  'min_cursor',
  'sec_user_id'
])

const requestParameterValueSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean()
])

export const persistedRequestParameterSchema = z.object({
  name: persistedRequestParameterNameSchema,
  value: requestParameterValueSchema
}).strict().superRefine((entry, context) => {
  const numericNames = new Set(['aid', 'count', 'cursor', 'max_cursor', 'min_cursor'])
  const identifierNames = new Set(['aweme_id', 'comment_id', 'item_id', 'sec_user_id'])
  if (numericNames.has(entry.name)) {
    const valid = typeof entry.value === 'number'
      ? Number.isSafeInteger(entry.value) && entry.value >= 0
      : typeof entry.value === 'string' && /^\d+$/.test(entry.value)
    if (!valid) context.addIssue({ code: 'custom', path: ['value'], message: `${entry.name} must be a non-negative integer` })
  } else if (identifierNames.has(entry.name)) {
    if (typeof entry.value !== 'string' || !/^[A-Za-z0-9._-]{1,240}$/.test(entry.value)) {
      context.addIssue({ code: 'custom', path: ['value'], message: `${entry.name} must be an opaque platform identifier` })
    }
  } else if (typeof entry.value !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(entry.value)) {
    context.addIssue({ code: 'custom', path: ['value'], message: `${entry.name} must be a short public enum value` })
  }
})

const persistedRequestParametersSchema = z.array(persistedRequestParameterSchema)
  .max(24)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.name)).size === entries.length,
    { message: 'request parameter names must be unique' }
  )

export const adapterValidationResultsSchema = z.object({
  http: z.enum(['valid', 'not-applicable']),
  json: z.literal('valid'),
  platformStatus: z.enum(['valid', 'not-applicable']),
  targetIdentity: z.literal('valid'),
  schema: z.literal('valid'),
  pagination: z.enum(['valid', 'not-applicable']),
  sensitiveFields: z.literal('removed')
}).strict()

const returnedIdsSchema = z.array(z.string().min(1).max(240))
  .max(1_000)
  .refine((values) => new Set(values).size === values.length, {
    message: 'returnedIds must not contain duplicates'
  })

const responseBodySha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'responseBodySha256 must be lowercase SHA-256')

const commonDouyinApiProofShape = {
  platform: z.literal('douyin'),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  schemaVersion: z.literal(1),
  sourceKind: adapterSourceKindSchema,
  requestParameters: persistedRequestParametersSchema,
  cursorIn: z.string().max(240).nullable(),
  cursorOut: z.string().max(240).nullable(),
  hasMore: z.boolean(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  returnedIds: returnedIdsSchema,
  responseBodySha256: responseBodySha256Schema,
  collectedAt: z.string().datetime(),
  browserOrigin: z.literal('https://www.douyin.com'),
  sessionUsed: z.literal(true),
  signatureProvider: z.enum(['page-frontierSign', 'observed-network-response', 'not-required']),
  validationResults: adapterValidationResultsSchema
} as const

function parameterValue(
  entries: Array<z.infer<typeof persistedRequestParameterSchema>>,
  name: z.infer<typeof persistedRequestParameterNameSchema>
): string | number | boolean | undefined {
  return entries.find((entry) => entry.name === name)?.value
}

export const douyinCommentApiProofSchema = z.object({
  contract: z.literal('douyin-comment-api-proof/v1'),
  ...commonDouyinApiProofShape,
  pageKind: z.literal('work-detail-comments'),
  endpointKind: z.enum(['comment-list', 'comment-reply-list']),
  awemeId: z.string().min(1).max(240)
}).strict().superRefine((proof, context) => {
  if (String(parameterValue(proof.requestParameters, 'aweme_id') ?? '') !== proof.awemeId) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'aweme_id must match proof.awemeId' })
  }
  if (proof.endpointKind === 'comment-list' && parameterValue(proof.requestParameters, 'comment_id') !== undefined) {
    context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'root comment pages must not contain comment_id' })
  }
})

export const douyinWorkApiProofSchema = z.object({
  contract: z.literal('douyin-work-api-proof/v1'),
  ...commonDouyinApiProofShape,
  pageKind: z.enum(['creator-profile-works', 'work-detail']),
  endpointKind: z.enum(['creator-work-list', 'work-detail']),
  creatorId: z.string().min(1).max(240).nullable(),
  workIds: returnedIdsSchema
}).strict().superRefine((proof, context) => {
  if (JSON.stringify(proof.workIds) !== JSON.stringify(proof.returnedIds)) {
    context.addIssue({ code: 'custom', path: ['workIds'], message: 'workIds must exactly match returnedIds' })
  }
})

const workAuthorBindingSchema = z.object({
  workId: opaquePlatformIdSchema,
  authorId: opaquePlatformIdSchema
}).strict()

const structuredWorkProofShape = {
  platform: z.literal('douyin'),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  schemaVersion: z.literal(2),
  sourceKind: z.enum(['network-response', 'embedded-json', 'page-context-fetch']),
  requestParameters: persistedRequestParametersSchema,
  schemaFingerprint: sha256DigestSchema,
  responseProjectionSha256: sha256DigestSchema,
  routeTrace: routeTraceSchema,
  collectedAt: z.string().datetime(),
  browserOrigin: z.literal('https://www.douyin.com'),
  sessionUsed: z.literal(true),
  validationResults: adapterValidationResultsSchema
} as const

export const douyinCreatorWorksStructuredProofSchema = z.object({
  contract: z.literal('douyin-creator-works-structured-proof/v2'),
  ...structuredWorkProofShape,
  routeId: z.enum(['DY-WORKS-NETWORK', 'DY-WORKS-EMBEDDED', 'DY-WORKS-INPAGE']),
  endpointKind: z.literal('creator-work-list'),
  followedCreatorId: opaquePlatformIdSchema,
  profileRouteCreatorId: opaquePlatformIdSchema,
  requestTargetCreatorId: opaquePlatformIdSchema,
  targetCreatorIdSourcePath: z.enum([
    'request.sec_user_id',
    'embedded.profile_user.uid',
    'embedded.profile_user.sec_uid'
  ]),
  cursorIn: z.string().max(240).nullable(),
  cursorOut: z.string().max(240).nullable(),
  hasMore: z.boolean(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  returnedIds: returnedIdsSchema,
  workIds: returnedIdsSchema,
  authorBindings: z.array(workAuthorBindingSchema).max(1_000)
}).strict().superRefine((proof, context) => {
  if (
    proof.followedCreatorId !== proof.profileRouteCreatorId
    || proof.followedCreatorId !== proof.requestTargetCreatorId
  ) {
    context.addIssue({ code: 'custom', path: ['requestTargetCreatorId'], message: 'AUTHOR_PROOF_MISMATCH: followed, profile, and request target IDs must agree' })
  }
  if (JSON.stringify(proof.workIds) !== JSON.stringify(proof.returnedIds)) {
    context.addIssue({ code: 'custom', path: ['workIds'], message: 'workIds must exactly match returnedIds' })
  }
  if (JSON.stringify(proof.authorBindings.map((binding) => binding.workId)) !== JSON.stringify(proof.workIds)) {
    context.addIssue({ code: 'custom', path: ['authorBindings'], message: 'author bindings must exactly follow workIds order' })
  }
  if (proof.authorBindings.some((binding) => binding.authorId !== proof.followedCreatorId)) {
    context.addIssue({ code: 'custom', path: ['authorBindings'], message: 'AUTHOR_PROOF_MISMATCH: every observed author must match the followed creator' })
  }
  const expected = {
    'network-response': { routeId: 'DY-WORKS-NETWORK', targetPath: 'request.sec_user_id' },
    'embedded-json': { routeId: 'DY-WORKS-EMBEDDED', targetPath: null },
    'page-context-fetch': { routeId: 'DY-WORKS-INPAGE', targetPath: 'request.sec_user_id' }
  }[proof.sourceKind]
  if (proof.routeId !== expected.routeId) {
    context.addIssue({ code: 'custom', path: ['routeId'], message: 'creator works route must match its source kind' })
  }
  const success = proof.routeTrace.find((entry) => entry.routeId === proof.routeId && entry.status === 'success')
  if (!success || success.schemaFingerprint !== proof.schemaFingerprint) {
    context.addIssue({ code: 'custom', path: ['routeTrace'], message: 'creator works proof requires a successful matching route trace' })
  }
  if (proof.sourceKind === 'embedded-json') {
    if (proof.requestParameters.length !== 0 || proof.targetCreatorIdSourcePath === 'request.sec_user_id') {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'embedded creator works proof cannot claim request metadata' })
    }
  } else {
    if (proof.targetCreatorIdSourcePath !== expected.targetPath) {
      context.addIssue({ code: 'custom', path: ['targetCreatorIdSourcePath'], message: 'network creator target must come from request.sec_user_id' })
    }
    if (String(parameterValue(proof.requestParameters, 'sec_user_id') ?? '') !== proof.requestTargetCreatorId) {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'sec_user_id must match requestTargetCreatorId' })
    }
  }
})

export const douyinWorkDetailStructuredProofSchema = z.object({
  contract: z.literal('douyin-work-detail-structured-proof/v2'),
  ...structuredWorkProofShape,
  routeId: z.enum(['DY-DETAIL-NETWORK', 'DY-DETAIL-EMBEDDED', 'DY-DETAIL-INPAGE']),
  endpointKind: z.literal('work-detail'),
  targetWorkId: opaquePlatformIdSchema,
  returnedWorkId: opaquePlatformIdSchema,
  expectedCreatorId: opaquePlatformIdSchema,
  observedAuthorId: opaquePlatformIdSchema,
  authorIdSourcePath: z.enum(['aweme_detail.author.uid', 'aweme_detail.author.sec_uid']),
  targetWorkIdSourcePath: z.enum(['request.aweme_id', 'request.item_id', 'embedded.aweme_detail.aweme_id']),
  returnedIds: returnedIdsSchema
}).strict().superRefine((proof, context) => {
  if (proof.targetWorkId !== proof.returnedWorkId || proof.returnedIds.length !== 1 || proof.returnedIds[0] !== proof.returnedWorkId) {
    context.addIssue({ code: 'custom', path: ['returnedWorkId'], message: 'TARGET_ID_MISMATCH: detail work ID must match the requested work' })
  }
  if (proof.expectedCreatorId !== proof.observedAuthorId) {
    context.addIssue({ code: 'custom', path: ['observedAuthorId'], message: 'AUTHOR_PROOF_MISMATCH: detail author must match the expected creator' })
  }
  const expectedRoute = {
    'network-response': 'DY-DETAIL-NETWORK',
    'embedded-json': 'DY-DETAIL-EMBEDDED',
    'page-context-fetch': 'DY-DETAIL-INPAGE'
  }[proof.sourceKind]
  if (proof.routeId !== expectedRoute) {
    context.addIssue({ code: 'custom', path: ['routeId'], message: 'work detail route must match its source kind' })
  }
  const success = proof.routeTrace.find((entry) => entry.routeId === proof.routeId && entry.status === 'success')
  if (!success || success.schemaFingerprint !== proof.schemaFingerprint) {
    context.addIssue({ code: 'custom', path: ['routeTrace'], message: 'work detail proof requires a successful matching route trace' })
  }
  if (proof.sourceKind === 'embedded-json') {
    if (proof.requestParameters.length !== 0 || proof.targetWorkIdSourcePath !== 'embedded.aweme_detail.aweme_id') {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'embedded detail proof cannot claim request metadata' })
    }
  } else {
    if (proof.targetWorkIdSourcePath === 'embedded.aweme_detail.aweme_id') {
      context.addIssue({ code: 'custom', path: ['targetWorkIdSourcePath'], message: 'network detail target must come from an explicit request parameter' })
    }
    const parameterName = proof.targetWorkIdSourcePath === 'request.item_id' ? 'item_id' : 'aweme_id'
    if (String(parameterValue(proof.requestParameters, parameterName) ?? '') !== proof.targetWorkId) {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'detail request parameter must match targetWorkId' })
    }
  }
})

export const douyinFollowingApiProofSchema = z.object({
  contract: z.literal('douyin-following-api-proof/v1'),
  ...commonDouyinApiProofShape,
  pageKind: z.literal('owner-following-list'),
  endpointKind: z.literal('following-list'),
  relationship: z.literal('following'),
  creatorIds: returnedIdsSchema
}).strict().superRefine((proof, context) => {
  if (JSON.stringify(proof.creatorIds) !== JSON.stringify(proof.returnedIds)) {
    context.addIssue({ code: 'custom', path: ['creatorIds'], message: 'creatorIds must exactly match returnedIds' })
  }
})

export const douyinFollowingStructuredProofSchema = z.object({
  contract: z.literal('douyin-following-structured-proof/v2'),
  platform: z.literal('douyin'),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  schemaVersion: z.literal(2),
  routeId: routeIdSchema,
  sourceKind: z.enum(['network-response', 'embedded-json', 'page-context-fetch']),
  endpointKind: z.literal('following-list'),
  relationship: z.literal('following'),
  ownerAccountId: opaquePlatformIdSchema,
  requestTargetCreatorId: opaquePlatformIdSchema.nullable(),
  requestParameters: persistedRequestParametersSchema,
  cursorIn: z.string().max(240).nullable(),
  cursorOut: z.string().max(240).nullable(),
  hasMore: z.boolean(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  returnedIds: returnedIdsSchema,
  creatorIds: returnedIdsSchema,
  schemaFingerprint: sha256DigestSchema,
  responseProjectionSha256: sha256DigestSchema,
  routeTrace: routeTraceSchema,
  collectedAt: z.string().datetime(),
  browserOrigin: z.literal('https://www.douyin.com'),
  sessionUsed: z.literal(true),
  validationResults: adapterValidationResultsSchema
}).strict().superRefine((proof, context) => {
  if (JSON.stringify(proof.creatorIds) !== JSON.stringify(proof.returnedIds)) {
    context.addIssue({ code: 'custom', path: ['creatorIds'], message: 'creatorIds must exactly match returnedIds' })
  }
  const expectedRoute = {
    'network-response': 'DY-FOLLOW-NETWORK',
    'embedded-json': 'DY-FOLLOW-EMBEDDED',
    'page-context-fetch': 'DY-FOLLOW-INPAGE'
  }[proof.sourceKind]
  if (proof.routeId !== expectedRoute) {
    context.addIssue({ code: 'custom', path: ['routeId'], message: 'routeId must match the structured source kind' })
  }
  const successfulTrace = proof.routeTrace.find((entry) => entry.routeId === proof.routeId && entry.status === 'success')
  if (!successfulTrace || successfulTrace.schemaFingerprint !== proof.schemaFingerprint) {
    context.addIssue({ code: 'custom', path: ['routeTrace'], message: 'following proof requires a successful matching route trace' })
  }
  if (proof.sourceKind === 'embedded-json') {
    if (proof.requestTargetCreatorId !== null || proof.requestParameters.length !== 0) {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'embedded following proof cannot claim a network request' })
    }
  } else {
    if (proof.requestTargetCreatorId !== proof.ownerAccountId) {
      context.addIssue({ code: 'custom', path: ['requestTargetCreatorId'], message: 'following request target must match ownerAccountId' })
    }
    if (String(parameterValue(proof.requestParameters, 'sec_user_id') ?? '') !== proof.ownerAccountId) {
      context.addIssue({ code: 'custom', path: ['requestParameters'], message: 'sec_user_id must match ownerAccountId' })
    }
  }
})

export const mediaResourceProofSchema = z.object({
  contract: z.literal('media-resource-proof/v1'),
  platform: z.enum(['douyin', 'bilibili', 'youtube', 'xiaohongshu', 'kuaishou']),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  schemaVersion: z.literal(1),
  sourceKind: mediaSourceKindSchema,
  endpointKind: z.literal('media-resource'),
  workId: z.string().min(1).max(240),
  resourceKind: z.enum(['video', 'audio', 'subtitle', 'image']),
  resourceUrlSha256: responseBodySha256Schema,
  collectedAt: z.string().datetime(),
  browserOrigin: z.string().url().nullable(),
  sessionUsed: z.boolean(),
  validationResults: z.object({
    targetIdentity: z.literal('valid'),
    resourceScheme: z.literal('https'),
    sensitiveFields: z.literal('removed')
  }).strict()
}).strict()

export const platformSourceProofSchema = z.union([
  douyinCommentApiProofSchema,
  douyinWorkApiProofSchema,
  douyinCreatorWorksStructuredProofSchema,
  douyinWorkDetailStructuredProofSchema,
  douyinFollowingApiProofSchema,
  douyinFollowingStructuredProofSchema,
  mediaResourceProofSchema
])

export const adapterIdentitySchema = z.object({
  platform: z.enum(['douyin', 'bilibili', 'youtube', 'xiaohongshu', 'kuaishou']),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  schemaVersion: z.literal(1)
}).strict()

export const adapterPaginationSchema = z.object({
  cursorIn: z.string().max(240).nullable(),
  cursorOut: z.string().max(240).nullable(),
  hasMore: z.boolean(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  returnedCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative()
}).strict()

export const adapterCompletionSchema = z.enum(['partial', 'complete', 'verified-empty'])

export function createPlatformAdapterPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    contract: z.literal('platform-adapter-page/v1'),
    identity: adapterIdentitySchema,
    operation: platformOperationSchema,
    completion: adapterCompletionSchema,
    pagination: adapterPaginationSchema,
    sourceProof: platformSourceProofSchema,
    items: z.array(itemSchema).max(1_000)
  }).strict().superRefine((page, context) => {
    if (page.pagination.returnedCount !== page.items.length) {
      context.addIssue({ code: 'custom', path: ['pagination', 'returnedCount'], message: 'returnedCount must equal items.length' })
    }
    if (page.completion === 'verified-empty') {
      if (page.items.length !== 0 || page.pagination.hasMore || page.pagination.reportedTotal !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['completion'],
          message: 'verified-empty requires zero items, hasMore=false, and reportedTotal=0'
        })
      }
    }
    if (page.completion === 'complete' && page.pagination.hasMore) {
      context.addIssue({ code: 'custom', path: ['completion'], message: 'complete pages cannot have hasMore=true' })
    }
    if (page.items.length === 0 && page.pagination.hasMore) {
      context.addIssue({ code: 'custom', path: ['pagination'], message: 'an empty page with hasMore=true is a protocol error' })
    }
  })
}

export const platformAdapterErrorCodeSchema = z.enum([
  'BROWSER_OFFLINE',
  'PAGE_NAVIGATION_TIMEOUT',
  'PAGE_CONTEXT_NOT_READY',
  'LOGIN_REQUIRED',
  'CAPTCHA_OR_SECURITY_CHALLENGE',
  'RATE_LIMITED',
  'HTTP_TRANSIENT',
  'API_STATUS_ERROR',
  'SIGNATURE_UNAVAILABLE',
  'SIGNATURE_REJECTED',
  'NOT_OBSERVED',
  'UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA',
  'SCHEMA_CHANGED',
  'AUTHOR_PROOF_MISMATCH',
  'DOM_ONLY_SOURCE_REJECTED',
  'UNSAFE_REQUEST',
  'RESPONSE_TOO_LARGE',
  'INVALID_CONTENT_TYPE',
  'MALFORMED_JSON',
  'BUFFER_LIMIT_REACHED',
  'CURSOR_LOOP',
  'DUPLICATE_NATIVE_ID',
  'PAGINATION_PROTOCOL_ERROR',
  'TARGET_ID_MISMATCH',
  'WORK_PRIVATE',
  'WORK_DELETED',
  'COMMENTS_DISABLED',
  'VERIFIED_EMPTY',
  'MEDIA_URL_EXPIRED',
  'MEDIA_DOWNLOAD_FAILED'
])

export const adapterErrorCategorySchema = z.enum([
  'transient',
  'authentication',
  'challenge',
  'throttling',
  'protocol',
  'access',
  'outcome'
])

export const adapterTaskImpactSchema = z.enum(['item', 'batch', 'adapter'])

export type PlatformAdapterErrorCode = z.infer<typeof platformAdapterErrorCodeSchema>
export type AdapterErrorCategory = z.infer<typeof adapterErrorCategorySchema>
export type AdapterTaskImpact = z.infer<typeof adapterTaskImpactSchema>

type AdapterErrorPolicy = {
  category: AdapterErrorCategory
  retryable: boolean
  taskImpact: AdapterTaskImpact
  userActionRequired: boolean
}

export const PLATFORM_ADAPTER_ERROR_POLICIES = {
  BROWSER_OFFLINE: { category: 'transient', retryable: true, taskImpact: 'batch', userActionRequired: false },
  PAGE_NAVIGATION_TIMEOUT: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false },
  PAGE_CONTEXT_NOT_READY: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false },
  LOGIN_REQUIRED: { category: 'authentication', retryable: false, taskImpact: 'batch', userActionRequired: true },
  CAPTCHA_OR_SECURITY_CHALLENGE: { category: 'challenge', retryable: false, taskImpact: 'batch', userActionRequired: true },
  RATE_LIMITED: { category: 'throttling', retryable: true, taskImpact: 'batch', userActionRequired: false },
  HTTP_TRANSIENT: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false },
  API_STATUS_ERROR: { category: 'protocol', retryable: false, taskImpact: 'item', userActionRequired: false },
  SIGNATURE_UNAVAILABLE: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false },
  SIGNATURE_REJECTED: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  NOT_OBSERVED: { category: 'outcome', retryable: false, taskImpact: 'item', userActionRequired: false },
  UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  SCHEMA_CHANGED: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  AUTHOR_PROOF_MISMATCH: { category: 'protocol', retryable: false, taskImpact: 'batch', userActionRequired: false },
  DOM_ONLY_SOURCE_REJECTED: { category: 'protocol', retryable: false, taskImpact: 'item', userActionRequired: false },
  UNSAFE_REQUEST: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  RESPONSE_TOO_LARGE: { category: 'protocol', retryable: false, taskImpact: 'item', userActionRequired: false },
  INVALID_CONTENT_TYPE: { category: 'protocol', retryable: false, taskImpact: 'item', userActionRequired: false },
  MALFORMED_JSON: { category: 'protocol', retryable: false, taskImpact: 'item', userActionRequired: false },
  BUFFER_LIMIT_REACHED: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  CURSOR_LOOP: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  DUPLICATE_NATIVE_ID: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  PAGINATION_PROTOCOL_ERROR: { category: 'protocol', retryable: false, taskImpact: 'adapter', userActionRequired: false },
  TARGET_ID_MISMATCH: { category: 'protocol', retryable: false, taskImpact: 'batch', userActionRequired: false },
  WORK_PRIVATE: { category: 'access', retryable: false, taskImpact: 'item', userActionRequired: false },
  WORK_DELETED: { category: 'access', retryable: false, taskImpact: 'item', userActionRequired: false },
  COMMENTS_DISABLED: { category: 'access', retryable: false, taskImpact: 'item', userActionRequired: false },
  VERIFIED_EMPTY: { category: 'outcome', retryable: false, taskImpact: 'item', userActionRequired: false },
  MEDIA_URL_EXPIRED: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false },
  MEDIA_DOWNLOAD_FAILED: { category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false }
} as const satisfies Record<PlatformAdapterErrorCode, AdapterErrorPolicy>

const safeContextKeySchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .refine(
    (key) => !/(authorization|bearer|cookie|password|secret|token|apiKey|xBogus|signature|deviceId|browserProfile)/i.test(key),
    { message: 'sensitive context keys are forbidden' }
  )

const safeContextValueSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
  z.null()
])

export const platformAdapterIssueSchema = z.object({
  contract: z.literal('platform-adapter-issue/v1'),
  code: platformAdapterErrorCodeSchema,
  category: adapterErrorCategorySchema,
  phase: z.enum(['session', 'navigation', 'discovery', 'signature', 'request', 'response', 'validation', 'pagination', 'media']),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
  taskImpact: adapterTaskImpactSchema,
  userActionRequired: z.boolean(),
  endpointKind: adapterEndpointKindSchema.nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  retryAfterMs: z.number().int().nonnegative().max(86_400_000).nullable(),
  safeContext: z.record(safeContextKeySchema, safeContextValueSchema),
  occurredAt: z.string().datetime()
}).strict().superRefine((issue, context) => {
  const policy = PLATFORM_ADAPTER_ERROR_POLICIES[issue.code]
  for (const field of ['category', 'retryable', 'taskImpact', 'userActionRequired'] as const) {
    if (issue[field] !== policy[field]) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} does not match the frozen policy for ${issue.code}` })
    }
  }
  if (issue.code !== 'RATE_LIMITED' && issue.retryAfterMs !== null) {
    context.addIssue({ code: 'custom', path: ['retryAfterMs'], message: 'retryAfterMs is reserved for RATE_LIMITED' })
  }
})

export function buildPlatformAdapterIssue(input: {
  code: PlatformAdapterErrorCode
  phase: z.infer<typeof platformAdapterIssueSchema>['phase']
  message: string
  endpointKind?: z.infer<typeof adapterEndpointKindSchema> | null
  httpStatus?: number | null
  retryAfterMs?: number | null
  safeContext?: Record<string, string | number | boolean | null>
  occurredAt: string
}): z.infer<typeof platformAdapterIssueSchema> {
  const policy = PLATFORM_ADAPTER_ERROR_POLICIES[input.code]
  return platformAdapterIssueSchema.parse({
    contract: 'platform-adapter-issue/v1',
    code: input.code,
    ...policy,
    phase: input.phase,
    message: input.message,
    endpointKind: input.endpointKind ?? null,
    httpStatus: input.httpStatus ?? null,
    retryAfterMs: input.retryAfterMs ?? null,
    safeContext: input.safeContext ?? {},
    occurredAt: input.occurredAt
  })
}

export const collectionScopeSchema = z.object({
  contract: z.literal('collection-scope/v1'),
  platform: z.enum(['douyin', 'bilibili', 'youtube', 'xiaohongshu', 'kuaishou']),
  ownerAccountId: z.string().min(1).max(120),
  operation: platformOperationSchema,
  entityId: z.string().min(1).max(240).nullable(),
  limits: z.object({
    creatorLimit: z.number().int().positive().nullable(),
    worksPerCreator: z.number().int().positive().nullable(),
    commentsPerWork: z.number().int().positive().nullable()
  }).strict(),
  collectionMode: z.enum(['collection-only', 'with-media']),
  adapterName: platformAdapterNameSchema,
  adapterVersion: platformAdapterVersionSchema,
  timeWindow: z.object({
    from: z.string().datetime().nullable(),
    to: z.string().datetime().nullable()
  }).strict().nullable()
}).strict().superRefine((scope, context) => {
  const { from, to } = scope.timeWindow ?? {}
  if (from && to && Date.parse(from) > Date.parse(to)) {
    context.addIssue({ code: 'custom', path: ['timeWindow'], message: 'timeWindow.from must not be after timeWindow.to' })
  }
})

export type AdapterIdentity = z.infer<typeof adapterIdentitySchema>
export type PlatformOperation = z.infer<typeof platformOperationSchema>
export type PlatformSourceProof = z.infer<typeof platformSourceProofSchema>
export type AdapterPagination = z.infer<typeof adapterPaginationSchema>
export type AdapterCompletion = z.infer<typeof adapterCompletionSchema>
export type PlatformAdapterIssue = z.infer<typeof platformAdapterIssueSchema>
export type CollectionScope = z.infer<typeof collectionScopeSchema>
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>
export type RouteTraceEntry = z.infer<typeof routeTraceEntrySchema>
export type RoutePolicy = z.infer<typeof routePolicySchema>
export type WorkAuthorProof = z.infer<typeof workAuthorProofSchema>
export type DouyinFollowingStructuredProof = z.infer<typeof douyinFollowingStructuredProofSchema>
export type DouyinCreatorWorksStructuredProof = z.infer<typeof douyinCreatorWorksStructuredProofSchema>
export type DouyinWorkDetailStructuredProof = z.infer<typeof douyinWorkDetailStructuredProofSchema>

export type PlatformAdapterPage<T> = {
  contract: 'platform-adapter-page/v1'
  identity: AdapterIdentity
  operation: PlatformOperation
  completion: AdapterCompletion
  pagination: AdapterPagination
  sourceProof: PlatformSourceProof
  items: T[]
}

export type PlatformAdapterContext = {
  browserOrigin: string
  sessionKind: 'browser-page'
  signal: AbortSignal
  now: () => Date
}

export interface PlatformAdapter<TRequest, TItem> {
  readonly identity: AdapterIdentity
  readonly operation: PlatformOperation
  collect(request: TRequest, context: PlatformAdapterContext): Promise<PlatformAdapterPage<TItem>>
}
