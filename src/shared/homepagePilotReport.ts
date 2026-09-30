import { z } from 'zod'

const publicId = z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
const workId = z.string().regex(/^[0-9]{8,30}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const metric = z.number().int().nonnegative().nullable()
const routeProof = z.object({
  routeId: z.enum(['DY-WORKS-NETWORK', 'DY-DETAIL-NETWORK']),
  endpointKind: z.enum(['creator-work-list', 'work-detail']),
  schemaFingerprint: hash, projectionSha256: hash, observedAt: z.string().datetime()
}).strict()

export const homepagePilotReportSchema = z.object({
  contract: z.literal('signaldesk-homepage-pilot-report/v1'),
  runId: publicId,
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(),
  observerIssueCodes: z.array(z.string().regex(/^[A-Z0-9_-]{2,100}$/)).max(20),
  safety: z.object({ formalDatabaseTouched: z.literal(false), activeApiRequests: z.literal(0),
    mediaProcessingStarted: z.literal(false), externalProvidersCalled: z.literal(false) }).strict(),
  result: z.object({
    contract: z.literal('signaldesk-homepage-pilot/v1'),
    creator: z.object({ uid: publicId, secUid: publicId, profileUrl: z.string() }).strict(),
    status: z.enum(['verified', 'candidate-only', 'blocked']),
    stage: z.enum(['profile', 'work-detail']), navigationCount: z.number().int().min(0).max(3),
    activeApiRequests: z.literal(0),
    candidates: z.array(z.object({ workId, url: z.string(),
      status: z.literal('page-visible-candidate') }).strict()).max(6),
    verifiedWork: z.object({
      workId, workIdKind: z.literal('native-aweme-id'),
      workIdSourcePath: z.literal('aweme_detail.aweme_id'),
      authorId: publicId, authorSecId: publicId, nickname: z.string().max(200),
      authorIdSourcePath: z.literal('aweme_detail.author.uid'),
      workType: z.enum(['video', 'image']), title: z.string().max(300), description: z.string().max(4000),
      publishedAt: z.string().datetime().nullable(), durationMs: z.number().nonnegative().nullable(),
      statistics: z.object({ likeCount: metric, commentCount: metric, collectCount: metric,
        shareCount: metric, playCount: metric }).strict()
    }).strict().nullable(),
    workProof: routeProof.nullable(), detailProof: routeProof.nullable(),
    comments: z.literal('not-requested'), replies: z.literal('not-requested'),
    reason: z.string().regex(/^[A-Z0-9_-]{3,100}$/).nullable()
  }).strict()
}).strict().superRefine((report, context) => {
  const result = report.result
  const error = (message: string): void => context.addIssue({ code: 'custom', message })
  if (Date.parse(report.finishedAt) < Date.parse(report.startedAt)) error('报告时间倒序')
  if (result.creator.profileUrl !== `https://www.douyin.com/user/${encodeURIComponent(result.creator.secUid)}`) error('作者主页与 sec_uid 不一致')
  if (new Set(result.candidates.map((item) => item.workId)).size !== result.candidates.length) error('候选作品重复')
  for (const candidate of result.candidates) {
    if (![`${'https://www.douyin.com/video/'}${candidate.workId}`,
      `${'https://www.douyin.com/note/'}${candidate.workId}`].includes(candidate.url)) error('候选 URL 与作品 ID 不一致')
  }
  if (result.workProof && (result.workProof.routeId !== 'DY-WORKS-NETWORK' || result.workProof.endpointKind !== 'creator-work-list')) error('作品列表证明 route 不一致')
  if (result.detailProof && (result.detailProof.routeId !== 'DY-DETAIL-NETWORK' || result.detailProof.endpointKind !== 'work-detail')) error('详情证明 route 不一致')
  if (result.status === 'verified') {
    const work = result.verifiedWork
    if (!work || !result.workProof || !result.detailProof || result.reason !== null
      || work.authorId !== result.creator.uid || work.authorSecId !== result.creator.secUid
      || !result.candidates.some((item) => item.workId === work.workId)) error('作品双 ID 或独立证明不匹配')
  } else if (result.verifiedWork !== null) error('未验证结果不能携带已验证作品')
})

export type HomepagePilotReport = z.infer<typeof homepagePilotReportSchema>
