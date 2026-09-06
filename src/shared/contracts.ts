import { z } from 'zod'
import { douyinCreatorWorksStructuredProofSchema, douyinFollowingStructuredProofSchema, workAuthorProofSchema } from './platformAdapter'
import { structuredWorkObservationSchema, workDetailVerificationSchema } from './structuredAcquisition'

export const platformSchema = z.literal('douyin')
export type Platform = z.infer<typeof platformSchema>

export const visibilitySchema = z.enum(['visible', 'hidden', 'unknown'])
export const completenessSchema = z.enum(['complete', 'partial', 'blocked', 'unavailable', 'failed'])

const publicMetricsSchema = z.object({
  likeCount: z.number().int().nonnegative().nullable().default(null),
  commentCount: z.number().int().nonnegative().nullable().default(null),
  collectCount: z.number().int().nonnegative().nullable().default(null),
  shareCount: z.number().int().nonnegative().nullable().default(null),
  visibility: z.object({
    like: visibilitySchema.default('unknown'),
    comment: visibilitySchema.default('unknown'),
    collect: visibilitySchema.default('unknown'),
    share: visibilitySchema.default('unknown')
  }).default({ like: 'unknown', comment: 'unknown', collect: 'unknown', share: 'unknown' })
})

const creatorPayloadSchema = z.object({
  entityType: z.literal('creator'),
  creatorId: z.string().min(1),
  nickname: z.string().min(1),
  profileUrl: z.string().url(),
  avatarUrl: z.string().url().nullable().optional(),
  signature: z.string().default(''),
  isFollowing: z.boolean()
})

export const douyinFollowingSourceProofSchema = z.object({
  contract: z.literal('douyin-following-source-proof/v1'),
  relationship: z.literal('following'),
  pageKind: z.literal('owner-following-list'),
  activeTab: z.literal('following'),
  extractionScope: z.literal('verified-following-list-container'),
  scrollRootKind: z.enum(['element', 'document', 'not-needed']),
  containerIdentity: z.string().min(1).max(240),
  scrollRootIdentity: z.string().min(1).max(240),
  creatorIds: z.array(z.string().min(1)).max(5).refine(
    (values) => new Set(values).size === values.length,
    { message: 'creatorIds must not contain duplicates' }
  ),
  emptyStateEvidence: z.literal('verified-empty-state').optional()
}).strict()
export type DouyinFollowingSourceProof = z.infer<typeof douyinFollowingSourceProofSchema>
export type DouyinFollowingStructuredProof = z.infer<typeof douyinFollowingStructuredProofSchema>

export const douyinCommentSourceProofSchema = z.object({
  contract: z.literal('douyin-comment-source-proof/v1'),
  pageKind: z.literal('work-detail-comments'),
  extractionScope: z.literal('verified-comment-list-container'),
  containerIdentity: z.literal('data-e2e:comment-list'),
  itemIdentity: z.literal('data-e2e:comment-item'),
  authorIdentity: z.literal('class-token:comment-item-info-wrap'),
  bodyIdentity: z.literal('adjacent-visible-sibling-after-author'),
  scrollRootKind: z.enum(['element', 'document', 'not-needed']),
  scrollRootIdentity: z.string().min(1).max(240),
  workId: z.string().min(1),
  commentIds: z.array(z.string().min(1)).max(30).refine(
    (values) => new Set(values).size === values.length,
    { message: 'commentIds must not contain duplicates' }
  )
}).strict()
export type DouyinCommentSourceProof = z.infer<typeof douyinCommentSourceProofSchema>

export const collectionSourceProofSchema = z.union([
  douyinFollowingStructuredProofSchema,
  douyinCreatorWorksStructuredProofSchema,
  douyinFollowingSourceProofSchema,
  douyinCommentSourceProofSchema
])

const workPayloadSchema = z.object({
  entityType: z.literal('work'),
  workId: z.string().min(1),
  creatorId: z.string().min(1),
  workType: z.enum(['video', 'image']),
  sourceUrl: z.string().url(),
  coverUrl: z.string().url().nullable().optional(),
  title: z.string().default(''),
  description: z.string().default(''),
  mediaUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(100).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  discoveredAt: z.string().datetime(),
  metrics: publicMetricsSchema.optional(),
  authorProof: workAuthorProofSchema.optional(),
  structuredObservation: structuredWorkObservationSchema.optional(),
  detailVerification: workDetailVerificationSchema.optional()
})

const commentPayloadSchema = z.object({
  entityType: z.literal('comment'),
  commentId: z.string().min(1),
  commentIdKind: z.enum(['page-attribute', 'synthetic-content-hash', 'legacy-unknown']).default('legacy-unknown'),
  workId: z.string().min(1),
  parentCommentId: z.string().nullable().optional(),
  publicAuthorId: z.string().nullable().optional(),
  publicAuthorName: z.string().default(''),
  body: z.string(),
  likeCount: z.number().int().nonnegative().nullable().default(null),
  publishedAt: z.string().datetime().nullable().optional()
})

export const collectionItemSchema = z.discriminatedUnion('entityType', [
  creatorPayloadSchema,
  workPayloadSchema,
  commentPayloadSchema
])

export const browserCollectionEnvelopeSchema = z.object({
  contract: z.literal('browser-collection-envelope/v1'),
  commandId: z.string().min(1),
  platform: platformSchema,
  collectedAt: z.string().datetime(),
  sourceUrl: z.string().url(),
  completeness: completenessSchema,
  cursor: z.string().nullable().optional(),
  hasMore: z.boolean().default(false),
  reason: z.string().nullable().optional(),
  sourceProof: collectionSourceProofSchema.optional(),
  items: z.array(collectionItemSchema)
})
export type BrowserCollectionEnvelope = z.infer<typeof browserCollectionEnvelopeSchema>

export type BrowserEventReceipt = {
  contract: 'browser-event-receipt/v1'
  accepted: boolean
  commandId: string | null
  code?: 'invalid-envelope' | 'unknown-command' | 'stale-command' | 'invalid-collection-proof' | 'ingest-failed'
  error?: string
}

export const evidenceRefSchema = z.object({
  kind: z.enum(['transcript', 'ocr', 'frame', 'metric', 'comment', 'page']),
  ref: z.string(),
  quote: z.string().optional()
})

export const analysisResultSchema = z.object({
  contract: z.literal('analysis-result/v1'),
  subjectType: z.enum(['work', 'creator', 'comments']),
  subjectId: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).max(12),
  coreExpression: z.string().min(1),
  domains: z.array(z.object({ id: z.string(), confidence: z.number().min(0).max(1) })).max(8),
  keywords: z.array(z.string()).min(1).max(15),
  evidence: z.array(evidenceRefSchema),
  confidence: z.number().min(0).max(1),
  modelId: z.string(),
  promptVersion: z.string(),
  generatedAt: z.string().datetime()
})
export type AnalysisResult = z.infer<typeof analysisResultSchema>

export const jobStateSchema = z.enum([
  'queued',
  'running',
  'paused',
  'blocked_user_action',
  'pending_cloud',
  'retryable_failed',
  'permanent_failed',
  'completed'
])
export type JobState = z.infer<typeof jobStateSchema>

export type InboxItem = {
  id: number
  platformWorkId: string
  creatorId: number
  creatorName: string
  creatorAvatar: string | null
  workType: 'video' | 'image'
  sourceUrl: string
  coverUrl: string | null
  title: string
  description: string
  publishedAt: string | null
  discoveredAt: string
  summary: string | null
  coreExpression: string | null
  keywords: string[]
  domains: string[]
  creatorDomains: string[]
  isDemo: boolean
  likeCount: number | null
  commentCount: number | null
  collectCount: number | null
  readState: 'unread' | 'read' | 'later' | 'saved'
  interestScore: number
  analysisStatus: string
  performance: 'high' | 'low' | 'normal' | 'insufficient'
}

export type CreatorListItem = {
  id: number
  platformCreatorId: string
  nickname: string
  avatarUrl: string | null
  signature: string
  profileUrl: string
  isFollowing: boolean
  isStarred: boolean
  note: string
  domains: string[]
  workCount: number
  analyzedCount: number
  lastPublishedAt: string | null
}

export type DashboardSummary = {
  followingCount: number
  workCount: number
  unreadCount: number
  commentCount: number
  analyzedCount: number
  queuedJobs: number
  connectorOnline: boolean
  lastSyncAt: string | null
}

export type DemoDataSummary = {
  creatorCount: number
  workCount: number
  commentCount: number
  analysisCount: number
  evidenceFrameCount: number
  savedCount: number
  laterCount: number
  starredCreatorCount: number
  notedCreatorCount: number
  relatedJobCount: number
  relatedBatchCount: number
  blockingOperationCount: number
}

export type SampleSyncOptions = {
  creatorLimit: number
  worksPerCreator: number
  commentsPerWork: number
}

export type AppSettings = {
  textBaseUrl: string
  textModel: string
  visionBaseUrl: string
  visionModel: string
  contextWindow: number
  textInputPricePerMillion: number | null
  textOutputPricePerMillion: number | null
  visionInputPricePerMillion: number | null
  visionOutputPricePerMillion: number | null
  imagePrice: number | null
  asrModel: 'small' | 'medium'
  cacheLimitGb: number
  retentionHours: number
  interests: string[]
  hasTextApiKey: boolean
  hasVisionApiKey: boolean
}

export const DEFAULT_DOMAINS = [
  ['technology', '科技'], ['military', '军事'], ['finance', '财经金融'], ['emotion', '情感'],
  ['humanities', '人文历史'], ['education', '教育'], ['business', '职场商业'], ['society', '时事社会'],
  ['entertainment', '娱乐'], ['film', '影视'], ['music', '音乐'], ['gaming', '游戏'],
  ['sports', '体育'], ['health', '健康'], ['lifestyle', '生活'], ['home', '家居'],
  ['parenting', '母婴'], ['food', '美食'], ['travel', '旅行'], ['automotive', '汽车'],
  ['fashion', '时尚美妆'], ['other', '其他']
] as const
