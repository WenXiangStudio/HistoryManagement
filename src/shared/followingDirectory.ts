import { z } from 'zod'

const publicId = z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
export const followingCreatorSchema = z.object({
  uid: publicId, secUid: publicId, nickname: z.string().min(1).max(200),
  avatarUrl: z.string().url().nullable(), signature: z.string().max(2000),
  profileUrl: z.string().url()
}).strict().refine((item) => item.profileUrl === `https://www.douyin.com/user/${encodeURIComponent(item.secUid)}`)
const networkFollowingReportSchema = z.object({
  contract: z.literal('signaldesk-following-directory/v1'), runId: z.string().min(1),
  collectedAt: z.string().datetime(), ownerSecUid: publicId,
  sourceUrl: z.literal('https://www.douyin.com/user/self'),
  endpointPath: z.literal('/aweme/v1/web/user/following/list/'),
  firstPage: z.literal(true), activeFollowingTab: z.literal(true),
  hasMore: z.boolean(), responseItemCount: z.number().int().nonnegative(),
  creators: z.array(followingCreatorSchema).max(10),
  projectionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  activeApiRequests: z.literal(0), workResponseBodiesRead: z.literal(0)
}).strict().refine((report) => new Set(report.creators.map((item) => item.uid)).size === report.creators.length
  && new Set(report.creators.map((item) => item.secUid)).size === report.creators.length
  && report.creators.length === Math.min(10, report.responseItemCount))
export const visibleFollowingReportSchema = z.object({
  contract: z.literal('signaldesk-visible-following/v1'), runId: z.string().min(1),
  collectedAt: z.string().datetime(), ownerSecUid: z.null(),
  ownerNickname: z.string().max(200).nullable(),
  sourceUrl: z.literal('https://www.douyin.com/user/self'),
  sourceKind: z.literal('visible-following-list'), activeFollowingTab: z.literal(true), listStartedAtTop: z.literal(true),
  hasMore: z.boolean(), visibleItemCount: z.number().int().nonnegative(),
  creators: z.array(z.object({
    uid: z.null(), secUid: publicId, nickname: z.string().min(1).max(200),
    avatarUrl: z.string().url().nullable(), signature: z.string().max(2000), profileUrl: z.string().url()
  }).strict().refine((item) => item.profileUrl === `https://www.douyin.com/user/${encodeURIComponent(item.secUid)}`)).max(10),
  projectionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  activeApiRequests: z.literal(0), workResponseBodiesRead: z.literal(0)
}).strict().refine((report) => new Set(report.creators.map((item) => item.secUid)).size === report.creators.length)
export const followingDirectoryReportSchema = z.union([networkFollowingReportSchema, visibleFollowingReportSchema])
export type FollowingDirectoryReport = z.infer<typeof followingDirectoryReportSchema>
export const followingDiagnosticSchema = z.object({
  stage: z.enum(['starting', 'opening-self', 'opening-following', 'waiting-response', 'verifying', 'saving', 'finished']),
  code: z.string().regex(/^[A-Z0-9_-]{1,100}$/).nullable(),
  detachReason: z.enum(['canceled_by_user', 'target_closed', 'unknown']).nullable(),
  firstRequestSeen: z.boolean(), followingBodiesRead: z.number().int().min(0).max(1),
  projectedCreatorCount: z.number().int().min(0).max(10),
  activeApiRequests: z.literal(0), workResponseBodiesRead: z.literal(0)
}).strict()
export type FollowingDiagnostic = z.infer<typeof followingDiagnosticSchema>
export type FollowingSyncState = {
  phase: 'idle' | 'awaiting-config' | 'running' | 'completed' | 'blocked' | 'cancelled'
  runId: string | null; message: string; count: number; ownerSecUid: string | null
  extensionDirectory: string | null; reportDirectory: string | null; databasePath: string
  setupUrl: string | null
  diagnostic?: FollowingDiagnostic
}
