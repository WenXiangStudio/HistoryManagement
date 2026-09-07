import { opaquePlatformIdSchema } from '../shared/platformAdapter'
import {
  douyinCommentListStructuredProofSchema,
  douyinCommentReplyStructuredProofSchema,
  type StructuredCommentProof
} from '../shared/commentAcquisition'
import type { BrowserCollectionEnvelope } from '../shared/contracts'
import { createResponseProjectionSha256 } from './platformAdapterSecurity'

function normalizedPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function requireDouyinWorkUrl(value: string, expectedWorkId: string): URL {
  const url = new URL(value)
  const match = normalizedPath(url.pathname).match(/^\/(?:video|note)\/([^/]+)$/)
  if (url.origin !== 'https://www.douyin.com' || !match || decodeURIComponent(match[1]) !== expectedWorkId) {
    throw new Error('TARGET_ID_MISMATCH:评论来源页面与目标作品不一致')
  }
  return url
}

function parseProof(input: BrowserCollectionEnvelope['sourceProof']): StructuredCommentProof {
  if (input?.contract === 'douyin-comment-source-proof/v1') {
    throw new Error('DOM_ONLY_SOURCE_REJECTED:旧 DOM 评论证明只能作为 shadow 诊断，不能写入正式数据')
  }
  const root = douyinCommentListStructuredProofSchema.safeParse(input)
  if (root.success) return root.data
  const reply = douyinCommentReplyStructuredProofSchema.safeParse(input)
  if (reply.success) return reply.data
  throw new Error('DOM_ONLY_SOURCE_REJECTED:缺少 R5 结构化评论/回复来源证明')
}

export function assertStructuredCommentEnvelopeForPersistence(
  envelope: BrowserCollectionEnvelope,
  payload: Record<string, unknown>
): StructuredCommentProof {
  const workId = opaquePlatformIdSchema.parse(payload.workId)
  const creatorId = opaquePlatformIdSchema.parse(payload.creatorId)
  const source = requireDouyinWorkUrl(envelope.sourceUrl, workId)
  const proof = parseProof(envelope.sourceProof)
  if (
    (typeof payload.adapterName === 'string' && proof.adapterName !== payload.adapterName)
    || (typeof payload.adapterVersion === 'string' && proof.adapterVersion !== payload.adapterVersion)
  ) {
    throw new Error('结构化评论 proof 的 adapter identity 与任务不一致')
  }

  if (proof.targetWorkId !== workId) {
    throw new Error('TARGET_ID_MISMATCH:结构化评论证明的目标作品与任务不一致')
  }
  if (proof.collectedAt !== envelope.collectedAt || proof.browserOrigin !== source.origin) {
    throw new Error('结构化评论证明与 envelope 的采集时间或来源 origin 不一致')
  }
  if (proof.hasMore !== envelope.hasMore || proof.cursorOut !== (envelope.cursor ?? null)) {
    throw new Error('结构化评论证明与 envelope 的分页状态不一致')
  }
  if (proof.hasMore || envelope.completeness !== 'complete') {
    throw new Error('PAGINATION_PROTOCOL_ERROR:R5 评论结果必须在单一路线内完整闭合')
  }

  const works = envelope.items.filter((item) => item.entityType === 'work')
  if (works.length !== 1 || works[0].workId !== workId || works[0].creatorId !== creatorId) {
    throw new Error('评论结果缺少唯一且匹配的作品实体')
  }
  if (!envelope.items.every((item) => item.entityType === 'work' || (item.entityType === 'comment' && item.workId === workId))) {
    throw new Error('TARGET_ID_MISMATCH:评论结果包含目标作品以外的数据')
  }

  const comments = envelope.items.filter((item) => item.entityType === 'comment')
  const scopeLimit = payload.commentsPerWork
  if (typeof scopeLimit === 'number' && Number.isSafeInteger(scopeLimit) && comments.length > scopeLimit) {
    throw new Error('PAGINATION_PROTOCOL_ERROR:结构化评论结果超过任务范围，不能在 proof 校验后静默截断')
  }
  const commentIds = comments.map((comment) => comment.commentId)
  if (new Set(commentIds).size !== commentIds.length) throw new Error('DUPLICATE_NATIVE_ID:评论结果包含重复 cid')
  if (
    JSON.stringify(proof.commentIds) !== JSON.stringify(commentIds)
    || JSON.stringify(proof.returnedIds) !== JSON.stringify(commentIds)
  ) {
    throw new Error('结构化评论证明与 comment/cid 清单不一致')
  }
  if (comments.length === 0) {
    if (proof.reportedTotal !== 0) {
      throw new Error('PAGINATION_PROTOCOL_ERROR:空评论结果缺少 total=0 的结构化闭合证明')
    }
  } else if (proof.reportedTotal !== null && proof.reportedTotal < comments.length) {
    throw new Error('PAGINATION_PROTOCOL_ERROR:reportedTotal 小于返回的唯一 cid 数')
  }

  const endpointKind = proof.endpointKind
  const targetRootCommentId = proof.contract === 'douyin-comment-reply-structured-proof/v2'
    ? proof.targetRootCommentId
    : null
  const jobRootCommentId = typeof payload.rootCommentId === 'string' ? payload.rootCommentId : null
  if (targetRootCommentId !== jobRootCommentId) {
    throw new Error('TARGET_ID_MISMATCH:回复 proof 与精确任务的 root comment id 不一致')
  }
  const projectedItems = comments.map((comment) => {
    if (comment.commentIdKind !== 'native-cid') {
      throw new Error('DOM_ONLY_SOURCE_REJECTED:R5 评论必须使用结构化响应中的原生 cid')
    }
    if (comment.endpointKind !== endpointKind) {
      throw new Error('结构化评论 item 的 endpointKind 与 proof 不一致')
    }
    opaquePlatformIdSchema.parse(comment.commentId)
    opaquePlatformIdSchema.parse(comment.workId)
    const publicAuthorId = opaquePlatformIdSchema.parse(comment.publicAuthorId)
    const body = comment.body.normalize('NFKC').trim().replace(/\s+/g, ' ')
    const publicAuthorName = comment.publicAuthorName.normalize('NFKC').trim()
    if (!body || body.length > 5_000 || /^[\d\s.,，。+万亿]+$/.test(body)) {
      throw new Error('评论正文缺失、超长或只有数字控件内容')
    }
    if (!publicAuthorName || publicAuthorName.length > 200 || publicAuthorName === '公开用户' || /^\d+$/.test(publicAuthorName)) {
      throw new Error('评论缺少明确的公开作者结构')
    }
    const parentCommentId = comment.parentCommentId ?? null
    const rootCommentId = comment.rootCommentId ?? null
    if (endpointKind === 'comment-list' && (parentCommentId !== null || rootCommentId !== null)) {
      throw new Error('TARGET_ID_MISMATCH:一级评论不能携带回复关系')
    }
    if (endpointKind === 'comment-reply-list' && (parentCommentId === null || rootCommentId !== targetRootCommentId)) {
      throw new Error('TARGET_ID_MISMATCH:回复的 root/parent 关系与请求 comment_id 不一致')
    }
    if (endpointKind === 'comment-reply-list' && (comment.commentId === parentCommentId || comment.commentId === rootCommentId)) {
      throw new Error('TARGET_ID_MISMATCH:回复 cid 不能同时充当自己的 root 或 parent')
    }
    return {
      commentId: comment.commentId,
      commentIdKind: comment.commentIdKind,
      workId: comment.workId,
      parentCommentId,
      rootCommentId,
      publicAuthorId,
      publicAuthorName,
      body,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount ?? null,
      publishedAt: comment.publishedAt ?? null,
      endpointKind
    }
  })

  const expectedBindings = projectedItems.map((comment) => ({
    commentId: comment.commentId,
    workId: comment.workId,
    parentCommentId: comment.parentCommentId,
    rootCommentId: comment.rootCommentId
  }))
  if (JSON.stringify(proof.commentBindings) !== JSON.stringify(expectedBindings)) {
    throw new Error('TARGET_ID_MISMATCH:结构化评论 proof 的 work/root/parent binding 与 items 不一致')
  }

  const projection = {
    endpointKind,
    targetWorkId: workId,
    targetRootCommentId,
    cursorIn: proof.cursorIn,
    cursorOut: proof.cursorOut,
    hasMore: proof.hasMore,
    reportedTotal: proof.reportedTotal,
    returnedIds: commentIds,
    items: projectedItems
  }
  if (createResponseProjectionSha256(projection) !== proof.responseProjectionSha256) {
    throw new Error('SCHEMA_CHANGED:结构化评论白名单 projection hash 与 proof 不一致')
  }
  return proof
}
