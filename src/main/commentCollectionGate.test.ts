import { describe, expect, it } from 'vitest'
import commentFixture from '../shared/fixtures/douyin-comment-pages-r5.mock.json'
import type { BrowserCollectionEnvelope } from '../shared/contracts'
import type { PlatformAdapterContext } from '../shared/platformAdapter'
import type { StructuredCommentPage } from '../shared/commentAcquisition'
import { assertStructuredCommentEnvelopeForPersistence } from './commentCollectionGate'
import {
  DouyinCommentListAdapter,
  DouyinCommentReplyAdapter,
  type CommentRouteSource,
  type NormalizedDouyinComment,
  type ReplyRouteSource,
  type StructuredCommentReadRequest,
  type StructuredCommentRouteReadResult
} from './douyinCommentAdapters'

const observedAt = '2026-09-06T06:00:00.000Z'
const workId = commentFixture.workId
const creatorId = 'synthetic-creator-3001'
const rootCommentId = commentFixture.rootCommentId
const payload = { workId, creatorId, commentsPerWork: 30 }

function context(): PlatformAdapterContext {
  return {
    browserOrigin: 'https://www.douyin.com',
    sessionKind: 'browser-page',
    signal: new AbortController().signal,
    now: () => new Date(observedAt)
  }
}

function request(endpoint: 'comment-list' | 'comment-reply-list', input: {
  workId: string
  rootCommentId: string | null
  cursor: string
  count: number
}): StructuredCommentReadRequest {
  return {
    method: 'GET',
    path: endpoint === 'comment-list' ? '/aweme/v1/web/comment/list/' : '/aweme/v1/web/comment/list/reply/',
    parameters: {
      aweme_id: input.workId,
      ...(endpoint === 'comment-reply-list' ? { comment_id: input.rootCommentId } : {}),
      cursor: input.cursor,
      count: input.count
    },
    headers: { accept: 'application/json' }
  }
}

function rootSource(): CommentRouteSource {
  return {
    routeId: 'DY-COMMENT-NETWORK',
    sourceKind: 'network-response',
    readPage: async (input) => ({
      outcome: 'response', httpStatus: 200, contentType: 'application/json',
      payload: structuredClone(commentFixture.networkCommentPages[input.cursor as '0' | '20']),
      request: request('comment-list', input), durationMs: 5, observedAt
    })
  }
}

function replySource(): ReplyRouteSource {
  return {
    routeId: 'DY-REPLY-NETWORK',
    sourceKind: 'network-response',
    readPage: async (input) => ({
      outcome: 'response', httpStatus: 200, contentType: 'application/json',
      payload: structuredClone(commentFixture.networkReplyPages['0']),
      request: request('comment-reply-list', input), durationMs: 5, observedAt
    })
  }
}

function workItem() {
  return {
    entityType: 'work' as const,
    workId,
    creatorId,
    workType: 'video' as const,
    sourceUrl: `https://www.douyin.com/video/${workId}`,
    title: 'R5 合成作品',
    description: '',
    discoveredAt: observedAt
  }
}

function envelopeFromPage(page: StructuredCommentPage<NormalizedDouyinComment>): BrowserCollectionEnvelope {
  return {
    contract: 'browser-collection-envelope/v1',
    commandId: 'r5-comment-command',
    platform: 'douyin',
    collectedAt: page.sourceProof.collectedAt,
    sourceUrl: `https://www.douyin.com/video/${workId}`,
    completeness: 'complete',
    cursor: page.sourceProof.cursorOut,
    hasMore: page.sourceProof.hasMore,
    sourceProof: page.sourceProof,
    items: [
      workItem(),
      ...page.items.map((comment) => ({ entityType: 'comment' as const, ...comment }))
    ]
  }
}

async function validRootEnvelope(): Promise<BrowserCollectionEnvelope> {
  const page = await new DouyinCommentListAdapter([rootSource()]).collect({ workId }, context())
  return envelopeFromPage(page)
}

async function validReplyEnvelope(): Promise<BrowserCollectionEnvelope> {
  const page = await new DouyinCommentReplyAdapter([replySource()]).collect({ workId, rootCommentId }, context())
  return envelopeFromPage(page)
}

function commentsOf(envelope: BrowserCollectionEnvelope) {
  return envelope.items.filter((item) => item.entityType === 'comment')
}

describe('R5 structured comment database preflight gate', () => {
  it('accepts a root-comment envelope only when proof, projection hash, and every item are exact', async () => {
    const envelope = await validRootEnvelope()
    expect(assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toMatchObject({
      contract: 'douyin-comment-list-structured-proof/v2', targetWorkId: workId,
      commentIds: ['synthetic-comment-3001', 'synthetic-comment-3002', 'synthetic-comment-3003']
    })
  })

  it('accepts a reply envelope only when request root and every parent/root binding are exact', async () => {
    const envelope = await validReplyEnvelope()
    expect(assertStructuredCommentEnvelopeForPersistence(envelope, { ...payload, rootCommentId })).toMatchObject({
      contract: 'douyin-comment-reply-structured-proof/v2',
      targetWorkId: workId, targetRootCommentId: rootCommentId
    })
  })

  it('rejects a reply envelope unless the job is scoped to the exact root cid', async () => {
    const envelope = await validReplyEnvelope()
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/精确任务/)
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, {
      ...payload,
      rootCommentId: 'synthetic-other-root'
    })).toThrow(/精确任务/)
  })

  it('accepts a strictly verified-empty structured root result', async () => {
    const source = rootSource() as CommentRouteSource & {
      readPage: (input: { workId: string; rootCommentId: string | null; cursor: string; count: number; signal: AbortSignal }) => Promise<StructuredCommentRouteReadResult>
    }
    source.readPage = async (input) => ({
        outcome: 'response', httpStatus: 200, contentType: 'application/json',
        payload: structuredClone(commentFixture.verifiedEmptyComments),
        request: request('comment-list', input), durationMs: 5, observedAt
      })
    const page = await new DouyinCommentListAdapter([source]).collect({ workId }, context())
    const envelope = envelopeFromPage(page)
    expect(commentsOf(envelope)).toHaveLength(0)
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).not.toThrow()
  })

  it('rejects the legacy DOM comment proof before persistence', async () => {
    const envelope = await validRootEnvelope()
    envelope.sourceProof = {
      contract: 'douyin-comment-source-proof/v1', pageKind: 'work-detail-comments',
      extractionScope: 'verified-comment-list-container', containerIdentity: 'data-e2e:comment-list',
      itemIdentity: 'data-e2e:comment-item', authorIdentity: 'class-token:comment-item-info-wrap',
      bodyIdentity: 'adjacent-visible-sibling-after-author', scrollRootKind: 'not-needed',
      scrollRootIdentity: 'not-needed', workId, commentIds: commentsOf(envelope).map((item) => item.commentId)
    }
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/DOM_ONLY_SOURCE_REJECTED/)
  })

  it('rejects missing proof before persistence', async () => {
    const envelope = await validRootEnvelope()
    delete envelope.sourceProof
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/DOM_ONLY_SOURCE_REJECTED/)
  })

  it('rejects a forged projection hash before persistence', async () => {
    const envelope = await validRootEnvelope()
    const proof = envelope.sourceProof
    if (proof?.contract !== 'douyin-comment-list-structured-proof/v2') throw new Error('expected R5 root-comment proof')
    envelope.sourceProof = { ...proof, responseProjectionSha256: 'f'.repeat(64) }
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/projection hash/)
  })

  it('rejects a changed body even when proof and IDs are left untouched', async () => {
    const envelope = await validRootEnvelope()
    commentsOf(envelope)[0].body = '篡改后的正文'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/projection hash/)
  })

  it('rejects a cross-work comment before persistence', async () => {
    const envelope = await validRootEnvelope()
    commentsOf(envelope)[0].workId = 'synthetic-other-work'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/目标作品以外/)
  })

  it('rejects a reply whose item root relationship differs from proof', async () => {
    const envelope = await validReplyEnvelope()
    commentsOf(envelope)[0].rootCommentId = 'synthetic-other-root'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, { ...payload, rootCommentId })).toThrow(/root\/parent/)
  })

  it('rejects a reply without a native parent relationship', async () => {
    const envelope = await validReplyEnvelope()
    commentsOf(envelope)[0].parentCommentId = null
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, { ...payload, rootCommentId })).toThrow(/root\/parent/)
  })

  it('rejects a reply that uses its own cid as root or parent', async () => {
    const envelope = await validReplyEnvelope()
    const comment = commentsOf(envelope)[0]
    comment.commentId = rootCommentId
    comment.parentCommentId = rootCommentId
    comment.rootCommentId = rootCommentId
    const proof = envelope.sourceProof
    if (proof?.contract !== 'douyin-comment-reply-structured-proof/v2') throw new Error('expected reply proof')
    envelope.sourceProof = {
      ...proof,
      returnedIds: [rootCommentId, ...proof.returnedIds.slice(1)],
      commentIds: [rootCommentId, ...proof.commentIds.slice(1)],
      commentBindings: [{ commentId: rootCommentId, workId, parentCommentId: rootCommentId, rootCommentId }, ...proof.commentBindings.slice(1)]
    }
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, { ...payload, rootCommentId })).toThrow(/自己的 root 或 parent/)
  })

  it('rejects non-native IDs even if a legacy-looking ID string is present', async () => {
    const envelope = await validRootEnvelope()
    commentsOf(envelope)[0].commentIdKind = 'page-attribute'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/原生 cid/)
  })

  it('rejects item endpoint substitution before persistence', async () => {
    const envelope = await validRootEnvelope()
    commentsOf(envelope)[0].endpointKind = 'comment-reply-list'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/endpointKind/)
  })

  it('rejects a batch above commentsPerWork rather than silently truncating after proof validation', async () => {
    const envelope = await validRootEnvelope()
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, { ...payload, commentsPerWork: 2 })).toThrow(/不能在 proof 校验后静默截断/)
  })

  it('rejects proof/envelope time and pagination substitutions', async () => {
    const wrongTime = await validRootEnvelope()
    wrongTime.collectedAt = '2026-09-06T07:00:00.000Z'
    expect(() => assertStructuredCommentEnvelopeForPersistence(wrongTime, payload)).toThrow(/采集时间/)

    const wrongCursor = await validRootEnvelope()
    wrongCursor.cursor = '999'
    expect(() => assertStructuredCommentEnvelopeForPersistence(wrongCursor, payload)).toThrow(/分页状态/)
  })

  it('rejects a source URL for another work', async () => {
    const envelope = await validRootEnvelope()
    envelope.sourceUrl = 'https://www.douyin.com/video/synthetic-other-work'
    expect(() => assertStructuredCommentEnvelopeForPersistence(envelope, payload)).toThrow(/TARGET_ID_MISMATCH/)
  })
})
