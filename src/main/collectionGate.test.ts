import { describe, expect, it } from 'vitest'
import type { BrowserCollectionEnvelope, DouyinFollowingStructuredProof } from '../shared/contracts'
import { validateEnvelopeForJob } from './taskRunner'

function validFollowingEnvelope(): BrowserCollectionEnvelope {
  const collectedAt = '2026-09-02T08:00:00.000Z'
  const schemaFingerprint = 'a'.repeat(64)
  const creatorIds = ['creator-1', 'creator-2']
  return {
    contract: 'browser-collection-envelope/v1',
    commandId: 'following-command',
    platform: 'douyin',
    collectedAt,
    sourceUrl: 'https://www.douyin.com/user/self?showTab=follow',
    completeness: 'complete',
    cursor: '20',
    hasMore: false,
    sourceProof: {
      contract: 'douyin-following-structured-proof/v2',
      platform: 'douyin',
      adapterName: 'douyin.following',
      adapterVersion: '0.2.0-r3',
      schemaVersion: 2,
      routeId: 'DY-FOLLOW-NETWORK',
      sourceKind: 'network-response',
      endpointKind: 'following-list',
      relationship: 'following',
      ownerAccountId: 'synthetic-owner-1000',
      requestTargetCreatorId: 'synthetic-owner-1000',
      requestParameters: [
        { name: 'count', value: 20 },
        { name: 'cursor', value: '0' },
        { name: 'sec_user_id', value: 'synthetic-owner-1000' }
      ],
      cursorIn: '0',
      cursorOut: '20',
      hasMore: false,
      reportedTotal: 2,
      returnedIds: creatorIds,
      creatorIds,
      schemaFingerprint,
      responseProjectionSha256: 'b'.repeat(64),
      routeTrace: [{
        routeId: 'DY-FOLLOW-NETWORK',
        status: 'success',
        attempt: 1,
        durationMs: 12,
        schemaFingerprint,
        occurredAt: collectedAt
      }],
      collectedAt,
      browserOrigin: 'https://www.douyin.com',
      sessionUsed: true,
      validationResults: {
        http: 'valid',
        json: 'valid',
        platformStatus: 'valid',
        targetIdentity: 'valid',
        schema: 'valid',
        pagination: 'valid',
        sensitiveFields: 'removed'
      }
    },
    items: [
      { entityType: 'creator', creatorId: 'creator-1', nickname: '博主一', profileUrl: 'https://www.douyin.com/user/creator-1', signature: '', isFollowing: true },
      { entityType: 'creator', creatorId: 'creator-2', nickname: '博主二', profileUrl: 'https://www.douyin.com/user/creator-2', signature: '', isFollowing: true }
    ]
  }
}

function validCommentEnvelope(): BrowserCollectionEnvelope {
  return {
    contract: 'browser-collection-envelope/v1',
    commandId: 'comment-command',
    platform: 'douyin',
    collectedAt: '2026-09-04T09:34:04.669Z',
    sourceUrl: 'https://www.douyin.com/video/work-1',
    completeness: 'partial',
    hasMore: true,
    sourceProof: {
      contract: 'douyin-comment-source-proof/v1',
      pageKind: 'work-detail-comments',
      extractionScope: 'verified-comment-list-container',
      containerIdentity: 'data-e2e:comment-list',
      itemIdentity: 'data-e2e:comment-item',
      authorIdentity: 'class-token:comment-item-info-wrap',
      bodyIdentity: 'adjacent-visible-sibling-after-author',
      scrollRootKind: 'not-needed',
      scrollRootIdentity: 'not-needed',
      workId: 'work-1',
      commentIds: ['comment-page-1']
    },
    items: [
      {
        entityType: 'work', workId: 'work-1', creatorId: 'creator-1', workType: 'video',
        sourceUrl: 'https://www.douyin.com/video/work-1', title: '作品', description: '',
        discoveredAt: '2026-09-04T09:34:04.669Z'
      },
      {
        entityType: 'comment', commentId: 'comment-page-1', commentIdKind: 'page-attribute', workId: 'work-1',
        parentCommentId: null, publicAuthorId: 'viewer-1', publicAuthorName: 'FanFan', body: '哪个agent',
        likeCount: 2, publishedAt: null
      }
    ]
  }
}

function validWorkEnvelope(): BrowserCollectionEnvelope {
  const creatorId = 'creator-1'
  const workId = 'work-1'
  const schemaFingerprint = 'a'.repeat(64)
  return {
    contract: 'browser-collection-envelope/v1',
    commandId: 'work-command',
    platform: 'douyin',
    collectedAt: '2026-09-06T01:00:00.000Z',
    sourceUrl: `https://www.douyin.com/user/${creatorId}`,
    completeness: 'complete',
    hasMore: false,
    items: [{
      entityType: 'work',
      workId,
      creatorId,
      workType: 'video',
      sourceUrl: `https://www.douyin.com/video/${workId}`,
      title: '合成作品',
      description: '',
      discoveredAt: '2026-09-06T01:00:00.000Z',
      authorProof: {
        contract: 'douyin-work-author-proof/v2',
        followedCreatorId: creatorId,
        profileRouteCreatorId: creatorId,
        requestTargetCreatorId: creatorId,
        observedWorkAuthorId: creatorId,
        observedWorkId: workId,
        authorProofSource: 'network-response',
        endpointKind: 'creator-work-list',
        routeId: 'DY-WORKS-NETWORK',
        adapterVersion: '0.2.0-r2',
        observedAt: '2026-09-06T01:00:00.000Z',
        schemaFingerprint,
        responseProjectionSha256: 'b'.repeat(64),
        routeTrace: [{
          routeId: 'DY-WORKS-NETWORK',
          status: 'success',
          attempt: 1,
          durationMs: 12,
          schemaFingerprint,
          occurredAt: '2026-09-06T01:00:00.000Z'
        }]
      },
      structuredObservation: {
        contract: 'douyin-structured-work-observation/v1',
        sourceKind: 'network-response',
        routeId: 'DY-WORKS-NETWORK',
        endpointKind: 'creator-work-list',
        requestTargetCreatorId: creatorId,
        workId,
        authorId: creatorId,
        authorIdSourcePath: 'aweme_list[].author.uid',
        observedAt: '2026-09-06T01:00:00.000Z',
        schemaFingerprint,
        responseProjectionSha256: 'b'.repeat(64),
        routeTrace: [{
          routeId: 'DY-WORKS-NETWORK',
          status: 'success',
          attempt: 1,
          durationMs: 12,
          schemaFingerprint,
          occurredAt: '2026-09-06T01:00:00.000Z'
        }]
      }
    }]
  }
}

const followingPayload = { creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20, collectionOnly: true }

function followingProofOf(value: BrowserCollectionEnvelope): DouyinFollowingStructuredProof {
  if (value.sourceProof?.contract !== 'douyin-following-structured-proof/v2') throw new Error('expected structured following proof')
  return value.sourceProof
}

describe('collection source semantic gate', () => {
  it('accepts a following envelope only when the source proof is bound to every returned creator', () => {
    expect(() => validateEnvelopeForJob(validFollowingEnvelope(), 'collection.following', followingPayload)).not.toThrow()
  })

  it.each([
    ['missing proof', (value: BrowserCollectionEnvelope) => { delete value.sourceProof }],
    ['wrong source route', (value: BrowserCollectionEnvelope) => { value.sourceUrl = 'https://www.douyin.com/' }],
    ['wrong source host', (value: BrowserCollectionEnvelope) => { value.sourceUrl = 'https://www.douyin.com.example.test/user/self?showTab=follow' }],
    ['proof id mismatch', (value: BrowserCollectionEnvelope) => { followingProofOf(value).creatorIds = ['creator-1'] }],
    ['proof route/source mismatch', (value: BrowserCollectionEnvelope) => { followingProofOf(value).routeId = 'DY-FOLLOW-EMBEDDED' }],
    ['proof pagination mismatch', (value: BrowserCollectionEnvelope) => { followingProofOf(value).hasMore = true }],
    ['profile id mismatch', (value: BrowserCollectionEnvelope) => {
      const creator = value.items[0]
      if (creator.entityType === 'creator') creator.profileUrl = 'https://www.douyin.com/user/different'
    }],
    ['false following relationship', (value: BrowserCollectionEnvelope) => {
      const creator = value.items[0]
      if (creator.entityType === 'creator') creator.isFollowing = false
    }],
    ['duplicate creator', (value: BrowserCollectionEnvelope) => {
      value.items[1] = structuredClone(value.items[0])
      followingProofOf(value).creatorIds = ['creator-1', 'creator-1']
    }],
    ['mixed work entity', (value: BrowserCollectionEnvelope) => {
      value.items.push({
        entityType: 'work', workId: 'noise-work', creatorId: 'creator-1', workType: 'video',
        sourceUrl: 'https://www.douyin.com/video/noise-work', title: '噪声作品', description: '',
        discoveredAt: '2026-09-02T08:00:00.000Z'
      })
    }],
    ['blocked result with data', (value: BrowserCollectionEnvelope) => { value.completeness = 'blocked' }]
  ])('rejects %s before persistence', (_label, mutate) => {
    const value = validFollowingEnvelope()
    mutate(value)
    expect(() => validateEnvelopeForJob(value, 'collection.following', followingPayload)).toThrow()
  })

  it('rejects an unproved empty list but accepts an explicit verified empty state', () => {
    const value = validFollowingEnvelope()
    value.items = []
    followingProofOf(value).creatorIds = []
    followingProofOf(value).returnedIds = []
    value.completeness = 'complete'
    value.hasMore = false
    expect(() => validateEnvelopeForJob(value, 'collection.following', followingPayload)).toThrow(/空关注列表/)

    followingProofOf(value).reportedTotal = 0
    expect(() => validateEnvelopeForJob(value, 'collection.following', followingPayload)).not.toThrow()
  })

  it('rejects the legacy DOM following proof even when it returns creator rows', () => {
    const value = validFollowingEnvelope()
    value.sourceProof = {
      contract: 'douyin-following-source-proof/v1',
      relationship: 'following',
      pageKind: 'owner-following-list',
      activeTab: 'following',
      extractionScope: 'verified-following-list-container',
      scrollRootKind: 'not-needed',
      containerIdentity: 'role:list|aria-label:关注账号列表',
      scrollRootIdentity: 'not-needed',
      creatorIds: ['creator-1', 'creator-2']
    }
    expect(() => validateEnvelopeForJob(value, 'collection.following', followingPayload)).toThrow(/DOM_ONLY_SOURCE_REJECTED/)
  })

  it('rejects creator entities returned by non-following jobs', () => {
    expect(() => validateEnvelopeForJob(validFollowingEnvelope(), 'collection.creator_works', { creatorId: 'creator-1' })).toThrow(/不能返回博主实体/)
  })

  it('accepts creator works only with WorkAuthorProof/v2 and rejects the former DOM-only shape', () => {
    const value = validWorkEnvelope()
    expect(() => validateEnvelopeForJob(value, 'collection.creator_works', { creatorId: 'creator-1' })).not.toThrow()

    const domOnly = validWorkEnvelope()
    const work = domOnly.items[0]
    if (work.entityType === 'work') delete work.authorProof
    expect(() => validateEnvelopeForJob(domOnly, 'collection.creator_works', { creatorId: 'creator-1' })).toThrow(/DOM_ONLY_SOURCE_REJECTED/)
  })

  it('rejects a creator-loop author value when the proof reports a different observed author', () => {
    const value = validWorkEnvelope()
    const work = value.items[0]
    if (work.entityType !== 'work' || !work.authorProof) throw new Error('expected synthetic author proof')
    if (!work.structuredObservation) throw new Error('expected independent observation')
    work.structuredObservation.authorId = 'other-author'
    expect(() => validateEnvelopeForJob(value, 'collection.creator_works', { creatorId: 'creator-1' })).toThrow(/AUTHOR_PROOF_MISMATCH/)
  })

  it('accepts a comment envelope only when its strict source proof is bound to the target work and every comment', () => {
    expect(() => validateEnvelopeForJob(validCommentEnvelope(), 'collection.work_comments', { workId: 'work-1', creatorId: 'creator-1' })).not.toThrow()
  })

  it.each([
    ['missing proof', (value: BrowserCollectionEnvelope) => { delete value.sourceProof }],
    ['wrong proof work', (value: BrowserCollectionEnvelope) => {
      if (value.sourceProof?.contract === 'douyin-comment-source-proof/v1') value.sourceProof.workId = 'other-work'
    }],
    ['proof id mismatch', (value: BrowserCollectionEnvelope) => {
      if (value.sourceProof?.contract === 'douyin-comment-source-proof/v1') value.sourceProof.commentIds = ['other-comment']
    }],
    ['numeric control body', (value: BrowserCollectionEnvelope) => {
      const comment = value.items.find((item) => item.entityType === 'comment')
      if (comment?.entityType === 'comment') comment.body = '32'
    }],
    ['placeholder author', (value: BrowserCollectionEnvelope) => {
      const comment = value.items.find((item) => item.entityType === 'comment')
      if (comment?.entityType === 'comment') comment.publicAuthorName = '公开用户'
    }],
    ['legacy id source', (value: BrowserCollectionEnvelope) => {
      const comment = value.items.find((item) => item.entityType === 'comment')
      if (comment?.entityType === 'comment') comment.commentIdKind = 'legacy-unknown'
    }],
    ['missing work entity', (value: BrowserCollectionEnvelope) => { value.items = value.items.filter((item) => item.entityType !== 'work') }]
  ])('rejects comment result with %s before persistence', (_label, mutate) => {
    const value = validCommentEnvelope()
    mutate(value)
    expect(() => validateEnvelopeForJob(value, 'collection.work_comments', { workId: 'work-1', creatorId: 'creator-1' })).toThrow()
  })
})
