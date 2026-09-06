import { z } from 'zod'
import {
  adapterSourceKindSchema,
  douyinWorkDetailStructuredProofSchema,
  opaquePlatformIdSchema,
  platformAdapterVersionSchema,
  routeIdSchema,
  routePolicySchema,
  routeTraceSchema,
  sha256DigestSchema,
  workAuthorProofSchema,
  type RoutePolicy,
  type RouteTraceEntry,
  type WorkAuthorProof
} from './platformAdapter'

export const STRUCTURED_ACQUISITION_ADAPTER_VERSION = '0.2.0-r4'

const policies = [
  {
    routeId: 'DY-FOLLOW-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-FOLLOW-EMBEDDED',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-FOLLOW-EMBEDDED',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 5_000,
    switchOn: ['schema-missing', 'schema-changed'],
    nextRouteId: 'DY-FOLLOW-INPAGE',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-FOLLOW-INPAGE',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['signature-unavailable', 'signature-rejected', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-FOLLOW-STOP',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-FOLLOW-STOP',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 1,
    switchOn: [],
    nextRouteId: null,
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-WORKS-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-WORKS-EMBEDDED',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-WORKS-EMBEDDED',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 5_000,
    switchOn: ['schema-missing', 'schema-changed'],
    nextRouteId: 'DY-WORKS-INPAGE',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-WORKS-INPAGE',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['signature-unavailable', 'signature-rejected', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-WORKS-STOP',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-WORKS-STOP',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 1,
    switchOn: [],
    nextRouteId: null,
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-DETAIL-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-DETAIL-EMBEDDED',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-DETAIL-EMBEDDED',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 5_000,
    switchOn: ['schema-missing', 'schema-changed'],
    nextRouteId: 'DY-DETAIL-INPAGE',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-DETAIL-INPAGE',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['signature-unavailable', 'signature-rejected', 'schema-missing', 'schema-changed'],
    nextRouteId: 'DY-DETAIL-STOP',
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-DETAIL-STOP',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 1,
    switchOn: [],
    nextRouteId: null,
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-COMMENT-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: null,
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-REPLY-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: null,
    requiresNewUserApproval: false,
    eligibleForFormalData: false
  },
  {
    routeId: 'DY-MEDIA-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    evidenceLevel: 'E2-doc',
    allowedMethods: ['GET'],
    maxAttempts: 1,
    timeoutMs: 20_000,
    switchOn: ['not-observed', 'schema-missing', 'schema-changed'],
    nextRouteId: null,
    requiresNewUserApproval: true,
    eligibleForFormalData: false
  }
] satisfies RoutePolicy[]

export const ROUTE_REGISTRY = Object.freeze(Object.fromEntries(
  policies.map((policy) => {
    const parsed = routePolicySchema.parse(policy)
    return [parsed.routeId, Object.freeze(parsed)]
  })
) as Readonly<Record<string, RoutePolicy>>)

const routeEndpointKinds = Object.freeze({
  'DY-FOLLOW-NETWORK': 'following-list',
  'DY-WORKS-NETWORK': 'creator-work-list',
  'DY-WORKS-EMBEDDED': 'creator-work-list',
  'DY-WORKS-INPAGE': 'creator-work-list',
  'DY-DETAIL-NETWORK': 'work-detail',
  'DY-DETAIL-EMBEDDED': 'work-detail',
  'DY-DETAIL-INPAGE': 'work-detail',
  'DY-COMMENT-NETWORK': 'comment-list',
  'DY-REPLY-NETWORK': 'comment-reply-list',
  'DY-MEDIA-NETWORK': 'media-resource'
} as const)

export const legacyPhaseBRouteSchema = z.object({
  version: z.enum(['0.2.3', '0.2.4']),
  status: z.enum(['frozen-failed', 'disabled']),
  executable: z.literal(false),
  benchmarkEligible: z.literal(false),
  reasonCode: z.enum(['AUTHOR_PROOF_CIRCULAR', 'LEGACY_ROUTE_PERMANENTLY_DISABLED'])
}).strict()

export const LEGACY_PHASE_B_ROUTES = Object.freeze({
  '0.2.3': legacyPhaseBRouteSchema.parse({
    version: '0.2.3',
    status: 'frozen-failed',
    executable: false,
    benchmarkEligible: false,
    reasonCode: 'AUTHOR_PROOF_CIRCULAR'
  }),
  '0.2.4': legacyPhaseBRouteSchema.parse({
    version: '0.2.4',
    status: 'disabled',
    executable: false,
    benchmarkEligible: false,
    reasonCode: 'LEGACY_ROUTE_PERMANENTLY_DISABLED'
  })
})

export function assertLegacyPhaseBRouteDisabled(version: string): never {
  const route = LEGACY_PHASE_B_ROUTES[version as keyof typeof LEGACY_PHASE_B_ROUTES]
  if (!route) throw new Error(`UNKNOWN_LEGACY_ROUTE:${version}`)
  throw new Error(`LEGACY_ROUTE_DISABLED:${route.version}:${route.reasonCode}`)
}

export function registeredRoute(routeId: string): RoutePolicy {
  const parsedId = routeIdSchema.parse(routeId)
  const policy = ROUTE_REGISTRY[parsedId]
  if (!policy) throw new Error(`UNREGISTERED_ROUTE:${parsedId}`)
  return policy
}

export const nativeStructuredWorkItemSchema = z.object({
  workId: opaquePlatformIdSchema,
  workIdKind: z.literal('native-aweme-id'),
  workIdSourcePath: z.enum([
    'aweme_list[].aweme_id',
    'aweme_detail.aweme_id',
    'follow_feed[].aweme_id'
  ]),
  authorId: opaquePlatformIdSchema,
  authorIdSourcePath: z.enum([
    'aweme_list[].author.uid',
    'aweme_list[].author.sec_uid',
    'aweme_detail.author.uid',
    'aweme_detail.author.sec_uid',
    'follow_feed[].author.uid',
    'follow_feed[].author.sec_uid'
  ])
}).strict()

export const nativeStructuredCommentItemSchema = z.object({
  commentId: opaquePlatformIdSchema,
  commentIdKind: z.literal('native-cid'),
  commentIdSourcePath: z.literal('comments[].cid'),
  workId: opaquePlatformIdSchema,
  workIdSourcePath: z.literal('comments[].aweme_id'),
  parentCommentId: opaquePlatformIdSchema.nullable(),
  rootCommentId: opaquePlatformIdSchema.nullable(),
  endpointKind: z.enum(['comment-list', 'comment-reply-list'])
}).strict().superRefine((comment, context) => {
  if (comment.endpointKind === 'comment-list' && (comment.parentCommentId !== null || comment.rootCommentId !== null)) {
    context.addIssue({ code: 'custom', path: ['endpointKind'], message: 'root comments cannot claim reply relationships' })
  }
  if (comment.endpointKind === 'comment-reply-list' && comment.parentCommentId === null && comment.rootCommentId === null) {
    context.addIssue({ code: 'custom', path: ['rootCommentId'], message: 'replies require a native parent or root comment relationship' })
  }
})

export function assertNativeStructuredCommentTarget(input: unknown, expectedWorkId: string) {
  const expected = opaquePlatformIdSchema.parse(expectedWorkId)
  const comment = nativeStructuredCommentItemSchema.parse(input)
  if (comment.workId !== expected) {
    throw new Error('NATIVE_ID_MISMATCH:comment aweme_id does not match the target work')
  }
  return comment
}

export const structuredWorkObservationSchema = z.object({
  contract: z.literal('douyin-structured-work-observation/v1'),
  sourceKind: z.enum(['network-response', 'embedded-json', 'page-context-fetch']),
  routeId: routeIdSchema,
  endpointKind: z.enum(['creator-work-list', 'work-detail', 'follow-feed']),
  requestTargetCreatorId: opaquePlatformIdSchema.nullable(),
  workId: opaquePlatformIdSchema,
  authorId: opaquePlatformIdSchema,
  authorIdSourcePath: z.enum([
    'aweme_list[].author.uid',
    'aweme_list[].author.sec_uid',
    'aweme_detail.author.uid',
    'aweme_detail.author.sec_uid',
    'follow_feed[].author.uid',
    'follow_feed[].author.sec_uid'
  ]),
  observedAt: z.string().datetime(),
  schemaFingerprint: sha256DigestSchema,
  responseProjectionSha256: sha256DigestSchema,
  routeTrace: routeTraceSchema
}).strict().superRefine((observation, context) => {
  const expected = routeEndpointKinds[observation.routeId as keyof typeof routeEndpointKinds]
  if (!expected) {
    context.addIssue({ code: 'custom', path: ['routeId'], message: 'work observation route is not registered for structured acquisition' })
  } else if (expected !== observation.endpointKind) {
    context.addIssue({ code: 'custom', path: ['endpointKind'], message: 'route and endpoint kind do not agree' })
  }
})

export const publicWorkStatisticsSchema = z.object({
  likeCount: z.number().int().nonnegative().nullable(),
  commentCount: z.number().int().nonnegative().nullable(),
  collectCount: z.number().int().nonnegative().nullable(),
  shareCount: z.number().int().nonnegative().nullable(),
  playCount: z.number().int().nonnegative().nullable()
}).strict()

export const publicWorkStatisticFieldSchema = z.enum([
  'likeCount',
  'commentCount',
  'collectCount',
  'shareCount',
  'playCount'
])

function changedStatisticFields(
  left: z.infer<typeof publicWorkStatisticsSchema>,
  right: z.infer<typeof publicWorkStatisticsSchema>
): Array<z.infer<typeof publicWorkStatisticFieldSchema>> {
  return publicWorkStatisticFieldSchema.options.filter((field) => left[field] !== right[field])
}

export const workDetailVerificationSchema = z.object({
  contract: z.literal('douyin-work-detail-verification/v1'),
  workId: opaquePlatformIdSchema,
  expectedCreatorId: opaquePlatformIdSchema,
  listObservation: structuredWorkObservationSchema,
  detailObservation: structuredWorkObservationSchema,
  detailSourceProof: douyinWorkDetailStructuredProofSchema,
  listStatistics: publicWorkStatisticsSchema,
  detailStatistics: publicWorkStatisticsSchema,
  changedStatisticFields: z.array(publicWorkStatisticFieldSchema).max(5).refine(
    (fields) => new Set(fields).size === fields.length,
    { message: 'changedStatisticFields must not contain duplicates' }
  ),
  verifiedAt: z.string().datetime()
}).strict().superRefine((verification, context) => {
  const list = verification.listObservation
  const detail = verification.detailObservation
  const detailProof = verification.detailSourceProof
  if (list.endpointKind !== 'creator-work-list' || detail.endpointKind !== 'work-detail') {
    context.addIssue({ code: 'custom', path: ['detailObservation'], message: 'detail verification requires independent list and detail endpoints' })
  }
  if (list.routeId === detail.routeId) {
    context.addIssue({ code: 'custom', path: ['detailObservation', 'routeId'], message: 'detail verification route must be independent from the list route' })
  }
  if (
    verification.workId !== list.workId
    || verification.workId !== detail.workId
    || verification.workId !== detailProof.targetWorkId
    || verification.workId !== detailProof.returnedWorkId
  ) {
    context.addIssue({ code: 'custom', path: ['workId'], message: 'TARGET_ID_MISMATCH:list and detail work IDs must agree' })
  }
  if (
    verification.expectedCreatorId !== list.authorId
    || verification.expectedCreatorId !== detail.authorId
    || verification.expectedCreatorId !== detailProof.expectedCreatorId
    || verification.expectedCreatorId !== detailProof.observedAuthorId
    || list.requestTargetCreatorId !== verification.expectedCreatorId
  ) {
    context.addIssue({ code: 'custom', path: ['expectedCreatorId'], message: 'AUTHOR_PROOF_MISMATCH:list target, list author, and detail author must agree' })
  }
  if (
    detail.routeId !== detailProof.routeId
    || detail.sourceKind !== detailProof.sourceKind
    || detail.schemaFingerprint !== detailProof.schemaFingerprint
    || detail.responseProjectionSha256 !== detailProof.responseProjectionSha256
    || detail.observedAt !== detailProof.collectedAt
    || JSON.stringify(detail.routeTrace) !== JSON.stringify(detailProof.routeTrace)
  ) {
    context.addIssue({ code: 'custom', path: ['detailSourceProof'], message: 'detail observation must be exactly bound to its request-target source proof' })
  }
  if (verification.verifiedAt !== detail.observedAt || verification.verifiedAt !== detailProof.collectedAt) {
    context.addIssue({ code: 'custom', path: ['verifiedAt'], message: 'detail verification time must be exactly bound to the detail observation and source proof' })
  }
  const expectedChanged = changedStatisticFields(verification.listStatistics, verification.detailStatistics)
  if (JSON.stringify(verification.changedStatisticFields) !== JSON.stringify(expectedChanged)) {
    context.addIssue({ code: 'custom', path: ['changedStatisticFields'], message: 'statistics differences must be reported exactly instead of silently merged' })
  }
})

export const structuredWorkCandidateSchema = z.object({
  workId: opaquePlatformIdSchema,
  creatorId: opaquePlatformIdSchema,
  sourceKind: adapterSourceKindSchema,
  authorProof: workAuthorProofSchema.optional()
}).strict()

export type StructuredWorkObservation = z.infer<typeof structuredWorkObservationSchema>
export type StructuredWorkCandidate = z.infer<typeof structuredWorkCandidateSchema>
export type PublicWorkStatistics = z.infer<typeof publicWorkStatisticsSchema>
export type WorkDetailVerification = z.infer<typeof workDetailVerificationSchema>

function requireTraceBinding(observation: StructuredWorkObservation): RouteTraceEntry[] {
  const traces = routeTraceSchema.parse(observation.routeTrace)
  const success = traces.find((entry) => entry.routeId === observation.routeId && entry.status === 'success')
  if (!success || success.schemaFingerprint !== observation.schemaFingerprint) {
    throw new Error('SCHEMA_CHANGED:observation is not bound to a successful route trace')
  }
  return traces
}

export function createWorkDetailVerification(input: {
  workId: string
  expectedCreatorId: string
  listObservation: StructuredWorkObservation
  detailObservation: StructuredWorkObservation
  detailSourceProof: unknown
  listStatistics: PublicWorkStatistics
  detailStatistics: PublicWorkStatistics
  verifiedAt: string
}): WorkDetailVerification {
  const listStatistics = publicWorkStatisticsSchema.parse(input.listStatistics)
  const detailStatistics = publicWorkStatisticsSchema.parse(input.detailStatistics)
  const listObservation = structuredWorkObservationSchema.parse(input.listObservation)
  const detailObservation = structuredWorkObservationSchema.parse(input.detailObservation)
  requireTraceBinding(listObservation)
  requireTraceBinding(detailObservation)
  return workDetailVerificationSchema.parse({
    contract: 'douyin-work-detail-verification/v1',
    workId: input.workId,
    expectedCreatorId: input.expectedCreatorId,
    listObservation,
    detailObservation,
    detailSourceProof: douyinWorkDetailStructuredProofSchema.parse(input.detailSourceProof),
    listStatistics,
    detailStatistics,
    changedStatisticFields: changedStatisticFields(listStatistics, detailStatistics),
    verifiedAt: input.verifiedAt
  })
}

export function assertWorkDetailVerificationForPersistence(
  verificationInput: unknown,
  expected: { workId: string; creatorId: string; listObservation: StructuredWorkObservation }
): WorkDetailVerification {
  const verification = workDetailVerificationSchema.parse(verificationInput)
  const listObservation = structuredWorkObservationSchema.parse(expected.listObservation)
  requireTraceBinding(verification.listObservation)
  requireTraceBinding(verification.detailObservation)
  if (
    verification.workId !== expected.workId
    || verification.expectedCreatorId !== expected.creatorId
    || JSON.stringify(verification.listObservation) !== JSON.stringify(listObservation)
  ) {
    throw new Error('AUTHOR_PROOF_MISMATCH:persisted work is not bound to its independent detail verification')
  }
  return verification
}

export function createWorkAuthorProof(input: {
  followedCreatorId: string
  profileRouteCreatorId: string
  observation: StructuredWorkObservation
}): WorkAuthorProof {
  const observation = structuredWorkObservationSchema.parse(input.observation)
  const policy = registeredRoute(observation.routeId)
  const routeTrace = requireTraceBinding(observation)
  return workAuthorProofSchema.parse({
    contract: 'douyin-work-author-proof/v2',
    followedCreatorId: input.followedCreatorId,
    profileRouteCreatorId: input.profileRouteCreatorId,
    requestTargetCreatorId: observation.requestTargetCreatorId,
    observedWorkAuthorId: observation.authorId,
    observedWorkId: observation.workId,
    authorProofSource: observation.sourceKind,
    endpointKind: observation.endpointKind,
    routeId: observation.routeId,
    adapterVersion: policy.adapterVersion,
    observedAt: observation.observedAt,
    schemaFingerprint: observation.schemaFingerprint,
    responseProjectionSha256: observation.responseProjectionSha256,
    routeTrace
  })
}

export function acceptStructuredWorkCandidate(
  candidateInput: StructuredWorkCandidate,
  independentObservationInput: StructuredWorkObservation
): StructuredWorkCandidate & { authorProof: WorkAuthorProof } {
  const candidate = structuredWorkCandidateSchema.parse(candidateInput)
  if (candidate.sourceKind === 'dom-fallback' || !candidate.authorProof) {
    throw new Error('DOM_ONLY_SOURCE_REJECTED:work candidates require a structured WorkAuthorProof/v2')
  }
  const proof = workAuthorProofSchema.parse(candidate.authorProof)
  const observation = structuredWorkObservationSchema.parse(independentObservationInput)
  registeredRoute(proof.routeId)
  requireTraceBinding(observation)

  if (
    candidate.workId !== proof.observedWorkId
    || candidate.creatorId !== proof.followedCreatorId
    || proof.routeId !== observation.routeId
    || proof.endpointKind !== observation.endpointKind
    || proof.observedWorkId !== observation.workId
    || proof.observedWorkAuthorId !== observation.authorId
    || proof.requestTargetCreatorId !== observation.requestTargetCreatorId
    || proof.schemaFingerprint !== observation.schemaFingerprint
    || proof.responseProjectionSha256 !== observation.responseProjectionSha256
  ) {
    throw new Error('AUTHOR_PROOF_MISMATCH:candidate proof does not match the independent structured observation')
  }

  return { ...candidate, authorProof: proof }
}

export function assertWorkAuthorProofForPersistence(
  proofInput: unknown,
  expected: { workId: string; creatorId: string }
): WorkAuthorProof {
  const proof = workAuthorProofSchema.parse(proofInput)
  registeredRoute(proof.routeId)
  if (proof.observedWorkId !== expected.workId || proof.followedCreatorId !== expected.creatorId) {
    throw new Error('AUTHOR_PROOF_MISMATCH:persisted work identity is not bound to its author proof')
  }
  return proof
}
