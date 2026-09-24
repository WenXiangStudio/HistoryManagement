import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(160)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const dateTimeSchema = z.string().datetime()
const confidenceSchema = z.number().min(0).max(1)
const failureSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean()
}).strict()

/**
 * R7 contracts deliberately describe artifacts by digest and stable ID. A
 * transient download URL or local cache path is execution state, not evidence.
 */
export const mediaArtifactSchema = z.object({
  contract: z.literal('media-artifact/v1'),
  artifactId: idSchema,
  workId: idSchema,
  kind: z.enum(['source-video', 'source-image', 'extracted-audio', 'key-frame']),
  contentSha256: sha256Schema,
  mimeType: z.string().trim().min(1).max(120),
  byteLength: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().nullable(),
  timeMs: z.number().int().nonnegative().nullable(),
  cacheDisposition: z.enum(['scheduled-for-deletion', 'deleted', 'retained-after-failure']),
  createdAt: dateTimeSchema
}).strict()
export type MediaArtifact = z.infer<typeof mediaArtifactSchema>

const mediaResultBase = {
  contract: z.literal('media-processing-result/v1'),
  resultId: idSchema,
  jobId: idSchema,
  workId: idSchema,
  provider: z.object({ id: z.literal('ffmpeg'), version: idSchema }).strict(),
  inputArtifactId: idSchema,
  startedAt: dateTimeSchema,
  finishedAt: dateTimeSchema
}

const mediaUsableResultSchema = z.object({
  ...mediaResultBase,
  status: z.enum(['succeeded', 'partial']),
  artifactRefs: z.array(idSchema).min(1).max(256),
  warnings: z.array(z.string().trim().min(1).max(500)).max(32),
  failure: z.null()
}).strict()

const mediaFailedResultSchema = z.object({
  ...mediaResultBase,
  status: z.enum(['failed', 'unavailable']),
  artifactRefs: z.array(idSchema).length(0),
  warnings: z.array(z.string().trim().min(1).max(500)).max(32),
  failure: failureSchema
}).strict()

export const mediaProcessingResultSchema = z.discriminatedUnion('status', [
  mediaUsableResultSchema,
  mediaFailedResultSchema
])
export type MediaProcessingResult = z.infer<typeof mediaProcessingResultSchema>

export const asrProviderSchema = z.discriminatedUnion('id', [
  z.object({
    id: z.literal('faster-whisper'),
    version: idSchema,
    model: z.string().trim().min(1).max(120),
    device: z.enum(['cpu', 'cuda']),
    computeType: z.enum(['int8', 'int8_float16', 'float16', 'float32'])
  }).strict(),
  z.object({
    id: z.literal('whisper.cpp'),
    version: idSchema,
    model: z.string().trim().min(1).max(120),
    device: z.enum(['cpu', 'cuda', 'vulkan', 'metal'])
  }).strict()
])
export type AsrProvider = z.infer<typeof asrProviderSchema>

export const transcriptSegmentSchema = z.object({
  segmentId: idSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().trim().min(1).max(10_000),
  language: z.string().trim().min(2).max(32),
  confidence: confidenceSchema.nullable()
}).strict().refine((segment) => segment.endMs > segment.startMs, {
  message: 'endMs must be greater than startMs',
  path: ['endMs']
})

const asrBase = {
  contract: z.literal('asr-result/v1'),
  resultId: idSchema,
  workId: idSchema,
  inputArtifactId: idSchema,
  inputSha256: sha256Schema,
  provider: asrProviderSchema,
  startedAt: dateTimeSchema,
  finishedAt: dateTimeSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(32)
}

const asrSucceededSchema = z.object({
  ...asrBase,
  status: z.literal('succeeded'),
  segments: z.array(transcriptSegmentSchema).min(1).max(20_000),
  failure: z.null()
}).strict()

const asrEmptySchema = z.object({
  ...asrBase,
  status: z.literal('verified-empty'),
  segments: z.array(transcriptSegmentSchema).length(0),
  emptyReason: z.enum(['no-speech-detected', 'audio-has-no-speech-track']),
  failure: z.null()
}).strict()

const asrFailedSchema = z.object({
  ...asrBase,
  status: z.enum(['failed', 'unavailable']),
  segments: z.array(transcriptSegmentSchema).length(0),
  failure: failureSchema
}).strict()

export const asrResultSchema = z.discriminatedUnion('status', [
  asrSucceededSchema,
  asrEmptySchema,
  asrFailedSchema
])
export type AsrResult = z.infer<typeof asrResultSchema>

export const ocrBlockSchema = z.object({
  blockId: idSchema,
  frameArtifactId: idSchema,
  frameRef: idSchema,
  timeMs: z.number().int().nonnegative().nullable(),
  text: z.string().trim().min(1).max(10_000),
  confidence: confidenceSchema,
  polygon: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4),
  reviewState: z.enum(['accepted', 'needs-review'])
}).strict().superRefine((block, context) => {
  if (block.confidence < 0.8 && block.reviewState !== 'needs-review') {
    context.addIssue({
      code: 'custom',
      path: ['reviewState'],
      message: 'OCR below 0.8 confidence must remain needs-review'
    })
  }
})

const ocrBase = {
  contract: z.literal('ocr-result/v1'),
  resultId: idSchema,
  workId: idSchema,
  inputFrameArtifactIds: z.array(idSchema).min(1).max(256),
  provider: z.object({
    id: z.literal('PaddleOCR'),
    version: idSchema,
    language: z.string().trim().min(1).max(32)
  }).strict(),
  startedAt: dateTimeSchema,
  finishedAt: dateTimeSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(32)
}

const ocrSucceededSchema = z.object({
  ...ocrBase,
  status: z.literal('succeeded'),
  blocks: z.array(ocrBlockSchema).min(1).max(20_000),
  failure: z.null()
}).strict()

const ocrEmptySchema = z.object({
  ...ocrBase,
  status: z.literal('verified-empty'),
  blocks: z.array(ocrBlockSchema).length(0),
  emptyReason: z.literal('no-text-detected'),
  failure: z.null()
}).strict()

const ocrFailedSchema = z.object({
  ...ocrBase,
  status: z.enum(['failed', 'unavailable']),
  blocks: z.array(ocrBlockSchema).length(0),
  failure: failureSchema
}).strict()

export const ocrResultSchema = z.discriminatedUnion('status', [
  ocrSucceededSchema,
  ocrEmptySchema,
  ocrFailedSchema
])
export type OcrResult = z.infer<typeof ocrResultSchema>

const evidenceBase = {
  evidenceId: idSchema,
  workId: idSchema,
  text: z.string().trim().min(1).max(20_000),
  confidence: confidenceSchema.nullable(),
  capturedAt: dateTimeSchema
}

export const evidenceAtomSchema = z.discriminatedUnion('kind', [
  z.object({
    ...evidenceBase,
    kind: z.literal('page'),
    sourceRef: idSchema
  }).strict(),
  z.object({
    ...evidenceBase,
    kind: z.literal('transcript'),
    providerResultId: idSchema,
    segmentId: idSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive()
  }).strict().refine((evidence) => evidence.endMs > evidence.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs']
  }),
  z.object({
    ...evidenceBase,
    kind: z.literal('ocr'),
    providerResultId: idSchema,
    blockId: idSchema,
    frameArtifactId: idSchema,
    frameRef: idSchema,
    timeMs: z.number().int().nonnegative().nullable(),
    reviewState: z.enum(['accepted', 'needs-review'])
  }).strict(),
  z.object({
    ...evidenceBase,
    kind: z.literal('frame'),
    frameArtifactId: idSchema,
    frameRef: idSchema,
    timeMs: z.number().int().nonnegative().nullable(),
    contentSha256: sha256Schema
  }).strict(),
  z.object({
    ...evidenceBase,
    kind: z.literal('metric'),
    metric: z.enum(['like', 'comment', 'collect', 'share', 'play']),
    value: z.number().int().nonnegative()
  }).strict(),
  z.object({
    ...evidenceBase,
    kind: z.literal('comment'),
    commentId: idSchema,
    publishedAt: dateTimeSchema.nullable()
  }).strict()
])
export type EvidenceAtom = z.infer<typeof evidenceAtomSchema>

export const evidenceSummaryPointSchema = z.object({
  pointId: idSchema,
  text: z.string().trim().min(1).max(4_000),
  evidenceIds: z.array(idSchema).min(1).max(64),
  inference: z.enum(['direct', 'synthesis', 'tentative']),
  confidence: confidenceSchema
}).strict()

export const evidenceMapSchema = z.object({
  contract: z.literal('evidence-map/v1'),
  subjectType: z.literal('work'),
  subjectId: idSchema,
  summary: z.string().trim().min(1).max(12_000),
  summaryPoints: z.array(evidenceSummaryPointSchema).min(1).max(24),
  coreExpression: z.object({
    text: z.string().trim().min(1).max(4_000),
    evidenceIds: z.array(idSchema).min(1).max(64),
    confidence: confidenceSchema
  }).strict(),
  evidence: z.array(evidenceAtomSchema).min(1).max(10_000),
  conflicts: z.array(z.object({
    conflictId: idSchema,
    evidenceIds: z.array(idSchema).min(2).max(16),
    description: z.string().trim().min(1).max(2_000),
    resolution: z.enum(['unresolved', 'source-preferred', 'time-separated', 'human-reviewed'])
  }).strict()).max(100),
  generatedAt: dateTimeSchema,
  generator: z.object({ modelId: idSchema, promptVersion: idSchema }).strict()
}).strict().superRefine((map, context) => {
  const evidenceIds = new Set<string>()
  for (const [index, evidence] of map.evidence.entries()) {
    if (evidence.workId !== map.subjectId) {
      context.addIssue({ code: 'custom', path: ['evidence', index, 'workId'], message: 'evidence workId must match subjectId' })
    }
    if (evidenceIds.has(evidence.evidenceId)) {
      context.addIssue({ code: 'custom', path: ['evidence', index, 'evidenceId'], message: 'evidenceId must be unique' })
    }
    evidenceIds.add(evidence.evidenceId)
  }
  const pointIds = new Set<string>()
  for (const [index, point] of map.summaryPoints.entries()) {
    if (pointIds.has(point.pointId)) {
      context.addIssue({ code: 'custom', path: ['summaryPoints', index, 'pointId'], message: 'pointId must be unique' })
    }
    pointIds.add(point.pointId)
    for (const reference of point.evidenceIds) {
      if (!evidenceIds.has(reference)) context.addIssue({ code: 'custom', path: ['summaryPoints', index, 'evidenceIds'], message: `unknown evidenceId: ${reference}` })
    }
  }
  for (const reference of map.coreExpression.evidenceIds) {
    if (!evidenceIds.has(reference)) context.addIssue({ code: 'custom', path: ['coreExpression', 'evidenceIds'], message: `unknown evidenceId: ${reference}` })
  }
  for (const [index, conflict] of map.conflicts.entries()) {
    for (const reference of conflict.evidenceIds) {
      if (!evidenceIds.has(reference)) context.addIssue({ code: 'custom', path: ['conflicts', index, 'evidenceIds'], message: `unknown evidenceId: ${reference}` })
    }
  }
})
export type EvidenceMap = z.infer<typeof evidenceMapSchema>

export const claimSchema = z.object({
  contract: z.literal('claim/v1'),
  claimId: idSchema,
  subjectId: idSchema,
  text: z.string().trim().min(1).max(4_000),
  classification: z.enum(['factual', 'opinion', 'prediction', 'satire', 'unclear']),
  eligibleForVerification: z.boolean(),
  sourceEvidenceIds: z.array(idSchema).min(1).max(64),
  speaker: z.string().trim().min(1).max(240).nullable(),
  observedAt: dateTimeSchema
}).strict().superRefine((claim, context) => {
  if (claim.eligibleForVerification !== (claim.classification === 'factual')) {
    context.addIssue({
      code: 'custom',
      path: ['eligibleForVerification'],
      message: 'only factual claims are eligible for verification'
    })
  }
})
export type Claim = z.infer<typeof claimSchema>

export const claimEvidenceSchema = z.object({
  evidenceId: idSchema,
  sourceUrl: z.string().url(),
  sourceTitle: z.string().trim().min(1).max(500),
  quote: z.string().trim().min(1).max(8_000),
  sourcePublishedAt: dateTimeSchema.nullable(),
  retrievedAt: dateTimeSchema,
  reliability: confidenceSchema
}).strict()
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>

export const verdictLabelSchema = z.enum([
  'supported',
  'refuted',
  'mixed',
  'insufficient-evidence',
  'time-sensitive',
  'not-a-factual-claim'
])

export const claimEvidenceVerdictSchema = z.object({
  contract: z.literal('claim-evidence-verdict/v1'),
  claim: claimSchema,
  verdict: verdictLabelSchema,
  evidence: z.array(claimEvidenceSchema).max(100),
  justification: z.string().trim().min(1).max(8_000),
  confidence: confidenceSchema,
  generatedAt: dateTimeSchema,
  verifier: z.object({ modelId: idSchema, promptVersion: idSchema }).strict()
}).strict().superRefine((result, context) => {
  const evidenceRequired = ['supported', 'refuted', 'mixed', 'time-sensitive'].includes(result.verdict)
  if (evidenceRequired && result.evidence.length === 0) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: `${result.verdict} requires external evidence` })
  }
  if (result.evidence.length === 0 && result.claim.classification === 'factual' && result.verdict !== 'insufficient-evidence') {
    context.addIssue({ code: 'custom', path: ['verdict'], message: 'a factual claim without evidence must abstain as insufficient-evidence' })
  }
  if (result.claim.classification !== 'factual' && result.verdict !== 'not-a-factual-claim') {
    context.addIssue({ code: 'custom', path: ['verdict'], message: 'a non-factual claim must use not-a-factual-claim' })
  }
  if (result.claim.classification === 'factual' && result.verdict === 'not-a-factual-claim') {
    context.addIssue({ code: 'custom', path: ['verdict'], message: 'a factual claim cannot use not-a-factual-claim' })
  }
})
export type ClaimEvidenceVerdict = z.infer<typeof claimEvidenceVerdictSchema>

const offlineAuthorizationSchema = z.object({
  state: z.literal('offline-fixture'),
  networkAllowed: z.literal(false),
  costApproved: z.literal(false)
}).strict()

const disabledAuthorizationSchema = z.object({
  state: z.literal('disabled'),
  networkAllowed: z.literal(false),
  costApproved: z.literal(false),
  reason: z.string().trim().min(1).max(500)
}).strict()

const approvedAuthorizationSchema = z.object({
  state: z.literal('approved'),
  networkAllowed: z.literal(true),
  costApproved: z.literal(true),
  approvalId: idSchema,
  approvedAt: dateTimeSchema,
  maximumCost: z.number().nonnegative(),
  currency: z.string().trim().min(3).max(12)
}).strict()

export const externalCallAuthorizationSchema = z.discriminatedUnion('state', [
  offlineAuthorizationSchema,
  disabledAuthorizationSchema,
  approvedAuthorizationSchema
])
export type ExternalCallAuthorization = z.infer<typeof externalCallAuthorizationSchema>

export const factCheckRequestSchema = z.object({
  contract: z.literal('fact-check-request/v1'),
  requestId: idSchema,
  claim: claimSchema,
  executionMode: z.enum(['offline-fixture', 'external']),
  authorization: externalCallAuthorizationSchema,
  createdAt: dateTimeSchema
}).strict().superRefine((request, context) => {
  if (request.executionMode === 'external' && request.authorization.state !== 'approved') {
    context.addIssue({ code: 'custom', path: ['authorization'], message: 'external fact checking requires explicit network and cost approval' })
  }
  if (request.executionMode === 'offline-fixture' && request.authorization.state !== 'offline-fixture') {
    context.addIssue({ code: 'custom', path: ['authorization'], message: 'offline fixtures cannot carry live-call authorization' })
  }
})
export type FactCheckRequest = z.infer<typeof factCheckRequestSchema>

export const r7UiStateSchema = z.object({
  media: z.enum(['contract-only', 'ready', 'running', 'partial', 'failed']),
  asr: z.enum(['unchecked', 'ready', 'verified-empty', 'unavailable', 'failed']),
  ocr: z.enum(['unchecked', 'ready', 'verified-empty', 'unavailable', 'failed']),
  evidenceMap: z.enum(['pending', 'traceable', 'needs-review', 'conflict', 'blocked']),
  factCheck: z.enum(['not-requested', 'awaiting-approval', 'running', 'supported', 'refuted', 'mixed', 'abstained', 'failed']),
  externalCallsAllowed: z.boolean()
}).strict()
export type R7UiState = z.infer<typeof r7UiStateSchema>

export const R7_CONTRACT_ONLY_UI_STATE: R7UiState = {
  media: 'contract-only',
  asr: 'unchecked',
  ocr: 'unchecked',
  evidenceMap: 'pending',
  factCheck: 'not-requested',
  externalCallsAllowed: false
}

export function verdictToUiState(verdict: ClaimEvidenceVerdict['verdict']): R7UiState['factCheck'] {
  if (verdict === 'supported' || verdict === 'refuted' || verdict === 'mixed') return verdict
  return 'abstained'
}
