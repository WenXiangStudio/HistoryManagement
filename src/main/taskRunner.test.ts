import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserCollectionEnvelope, BrowserEventReceipt, DouyinCommentSourceProof, DouyinFollowingStructuredProof } from '../shared/contracts'
import { syntheticCreatorWorksProof, syntheticR4WorkEvidence } from '../shared/fixtures/syntheticR4Proofs'
import { AppDatabase } from './database'
import type { BridgeServer, BrowserCommand } from './bridgeServer'
import { TaskRunner, createCollectionJobIdentity, validateCreatorLimit, validateWorksLimit, validateCommentsLimit } from './taskRunner'
import { applyFollowingSchemaV6Draft } from '../../poc/r8/following-schema-v6-draft.mjs'
import { VerifiedFollowingDirectory } from './verifiedFollowingDirectory'
import type { WorkerClient } from './workerClient'

class FakeBridge extends EventEmitter {
  commands: BrowserCommand[] = []
  online = true
  envelopeHandler: ((envelope: BrowserCollectionEnvelope) => BrowserEventReceipt) | null = null
  onQueue: ((command: BrowserCommand) => void) | null = null

  isOnline(): boolean {
    return this.online
  }

  queueCommand(command: BrowserCommand): void {
    this.onQueue?.(command)
    this.commands.push(command)
  }

  setEnvelopeHandler(handler: (envelope: BrowserCollectionEnvelope) => BrowserEventReceipt): void {
    this.envelopeHandler = handler
  }

  deliverEnvelope(envelope: BrowserCollectionEnvelope): BrowserEventReceipt {
    if (!this.envelopeHandler) throw new Error('Envelope handler is not registered')
    return this.envelopeHandler(envelope)
  }
}

let database: AppDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
})

function createRunner(structuredSyncEnabled = true): { runner: TaskRunner; bridge: FakeBridge } {
  database = new AppDatabase(':memory:')
  const bridge = new FakeBridge()
  const worker = { processMedia: async () => { throw new Error('media processing must not run during collection-only sample sync') } } as unknown as WorkerClient
  return { runner: new TaskRunner(database, bridge as unknown as BridgeServer, worker, 'D:\\signal-desk-test-cache', structuredSyncEnabled), bridge }
}

async function dispatchNext(runner: TaskRunner): Promise<void> {
  await (runner as unknown as { tick: () => Promise<void> }).tick()
}

function enqueueSyntheticWorks(creatorId: string, worksPerCreator = 2): number {
  const payload = { creatorId, profileUrl: `https://www.douyin.com/user/${creatorId}`,
    ownerAccountId: 'local-owner-account:1', worksPerCreator, collectionOnly: true }
  const identity = createCollectionJobIdentity('collection.creator_works', payload)
  return database!.enqueueCollectionJob('collection.creator_works', payload, identity, 30).jobId
}

function followingProof(creatorIds: string[], empty = false): DouyinFollowingStructuredProof {
  const collectedAt = '2026-09-02T08:00:00.000Z'
  const schemaFingerprint = 'a'.repeat(64)
  return {
    contract: 'douyin-following-structured-proof/v2',
    platform: 'douyin',
    adapterName: 'douyin.following',
    adapterVersion: '0.2.0-r4',
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
    cursorOut: empty ? '0' : '40',
    hasMore: false,
    reportedTotal: creatorIds.length,
    returnedIds: creatorIds,
    creatorIds,
    schemaFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: [{
      routeId: 'DY-FOLLOW-NETWORK',
      status: 'success',
      attempt: 1,
      durationMs: 10,
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
  }
}

function commentProof(workId: string, commentIds: string[]): DouyinCommentSourceProof {
  return {
    contract: 'douyin-comment-source-proof/v1',
    pageKind: 'work-detail-comments',
    extractionScope: 'verified-comment-list-container',
    containerIdentity: 'data-e2e:comment-list',
    itemIdentity: 'data-e2e:comment-item',
    authorIdentity: 'class-token:comment-item-info-wrap',
    bodyIdentity: 'adjacent-visible-sibling-after-author',
    scrollRootKind: 'not-needed',
    scrollRootIdentity: 'not-needed',
    workId,
    commentIds
  }
}

function envelope(
  commandId: string,
  sourceUrl: string,
  items: BrowserCollectionEnvelope['items'],
  sourceProof?: BrowserCollectionEnvelope['sourceProof']
): BrowserCollectionEnvelope {
  return {
    contract: 'browser-collection-envelope/v1', commandId, platform: 'douyin',
    collectedAt: '2026-09-02T08:00:00.000Z', sourceUrl,
    completeness: 'complete',
    hasMore: false,
    ...(sourceProof?.contract === 'douyin-following-structured-proof/v2' || sourceProof?.contract === 'douyin-creator-works-structured-proof/v2'
      ? { cursor: sourceProof.cursorOut }
      : {}),
    ...(sourceProof ? { sourceProof } : {}),
    items
  }
}

describe('bounded sample synchronization', () => {
  it('keeps production structured sync hard-disabled until the v2 connector bridge exists', () => {
    const { runner } = createRunner(false)
    expect(() => runner.startFollowingRefresh(1)).toThrow(/禁止启动真实采集/)
    expect(() => runner.startCreatorWorksSync('creator-1', 1)).toThrow(/尚未接入正式连接器/)
  })

  it('never dispatches an already queued collection job while the production capability gate is closed', async () => {
    const { runner, bridge } = createRunner(false)
    const payload = { creatorLimit: 1, ownerAccountId: 'local-owner-account:1', collectionOnly: true }
    const identity = createCollectionJobIdentity('collection.following', payload)
    const queued = database!.enqueueCollectionJob('collection.following', payload, identity)
    await dispatchNext(runner)
    expect(bridge.commands).toEqual([])
    expect(database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(queued.jobId)).toEqual({ state: 'queued' })
  })

  it('keeps legacy unscoped collection jobs immutable across dispatch, pause, envelope, and status paths', async () => {
    const { runner, bridge } = createRunner()
    const legacyPayload = { commandId: 'legacy-frozen-command', workId: 'legacy-work' }
    const legacyId = database!.enqueueJob('collection.work_comments', legacyPayload, 1)
    const before = database!.db.prepare('SELECT state, payload_json, checkpoint_json, status_message FROM jobs WHERE id=?').get(legacyId)

    await dispatchNext(runner)
    expect(bridge.commands).toHaveLength(0)
    database!.cancelActiveJobs()
    bridge.emit('status', { type: 'blocked', commandId: legacyPayload.commandId, message: '不得写入旧任务' })
    expect(bridge.deliverEnvelope({
      contract: 'browser-collection-envelope/v1',
      commandId: legacyPayload.commandId,
      platform: 'douyin',
      collectedAt: '2026-09-07T00:00:00.000Z',
      sourceUrl: 'https://www.douyin.com/video/legacy-work',
      completeness: 'complete',
      hasMore: false,
      items: []
    })).toMatchObject({ accepted: false, code: 'stale-command' })
    expect(database!.db.prepare('SELECT state, payload_json, checkpoint_json, status_message FROM jobs WHERE id=?').get(legacyId)).toEqual(before)
  })

  it('rejects limits outside the main-process hard boundary', () => {
    expect(validateCreatorLimit(3)).toBe(3)
    expect(validateWorksLimit(5)).toBe(5)
    expect(validateCommentsLimit(20)).toBe(20)
    expect(() => validateCreatorLimit(6)).toThrow(/1～5/)
    expect(() => validateWorksLimit(11)).toThrow(/1～10/)
    expect(() => validateCommentsLimit(31)).toThrow(/1～30/)

    const { runner, bridge } = createRunner()
    bridge.online = false
    expect(() => runner.startFollowingRefresh(3)).toThrow(/尚未在线/)
    bridge.online = true
    const started = runner.startFollowingRefresh(3)
    expect(started.creatorLimit).toBe(3)
    const payload = JSON.parse(String((database!.db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(started.jobId) as { payload_json: string }).payload_json))
    expect(payload).toMatchObject({ creatorLimit: 3, collectionOnly: true, purpose: 'following-directory-only' })
    expect(payload).not.toHaveProperty('worksPerCreator')
    expect(payload).not.toHaveProperty('commentsPerWork')
    expect(() => runner.startFollowingRefresh(3)).toThrow(/相同适配器版本和采集范围/)
    const independent = runner.startFollowingRefresh(1)
    expect(independent.jobId).not.toBe(started.jobId)
    database!.updateJob(started.jobId, 'completed')
    const rerun = runner.startFollowingRefresh(3)
    expect(rerun.jobId).not.toBe(started.jobId)
  })

  it('keeps each collection scope fingerprint independent of unrelated task limits', () => {
    const ownerAccountId = 'verified-owner'
    const following = createCollectionJobIdentity('collection.following', { ownerAccountId, creatorLimit: 2 })
    const unrelatedWorkAndComments = createCollectionJobIdentity('collection.following', {
      ownerAccountId, creatorLimit: 2, worksPerCreator: 10, commentsPerWork: 30
    })
    expect(following.scopeFingerprint).toBe(unrelatedWorkAndComments.scopeFingerprint)
    const works = createCollectionJobIdentity('collection.creator_works', {
      ownerAccountId, creatorId: 'uid-a', creatorSecUid: 'sec-a', worksPerCreator: 2
    })
    const unrelatedFollowingAndComments = createCollectionJobIdentity('collection.creator_works', {
      ownerAccountId, creatorId: 'uid-a', creatorSecUid: 'sec-a', creatorLimit: 5,
      worksPerCreator: 2, commentsPerWork: 30
    })
    expect(works.scopeFingerprint).toBe(unrelatedFollowingAndComments.scopeFingerprint)
    const changedIdentity = createCollectionJobIdentity('collection.creator_works', {
      ownerAccountId, creatorId: 'uid-a', creatorSecUid: 'different-sec-a', worksPerCreator: 2
    })
    expect(changedIdentity.scopeFingerprint).not.toBe(works.scopeFingerprint)
  })

  it('starts saved-author works only by explicit action against a verified v6 owner directory', async () => {
    const { runner, bridge } = createRunner()
    expect(() => runner.startCreatorWorksSync('uid-a', 1)).toThrow(/尚未迁入正式数据库/)
    applyFollowingSchemaV6Draft(database!.db)
    const directory = new VerifiedFollowingDirectory(database!.db)
    const owner = database!.db.prepare("SELECT id FROM owner_accounts WHERE local_label='我的抖音'").get() as { id: number }
    const at = '2026-09-30T00:00:00.000Z'
    directory.bindOwner(owner.id, 'owner-sec', at)
    directory.upsertFollowing(owner.id, { uid: 'uid-a', secUid: 'sec-a', nickname: '作者甲', isFollowing: true }, at)
    expect(() => runner.startCreatorWorksSync('uid-b', 1)).toThrow(/已验证关注目录/)
    const refresh = runner.startFollowingRefresh(1)
    database!.updateJob(refresh.jobId, 'blocked_user_action', { message: '独立关注刷新失败' })
    const started = runner.startCreatorWorksSync('uid-a', 1)
    expect(database!.db.prepare('SELECT kind FROM jobs WHERE id=?').get(started.jobId)).toEqual({ kind: 'collection.creator_works' })
    expect(database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(refresh.jobId)).toEqual({ state: 'blocked_user_action' })
    expect(Number(database!.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='collection.following'").get()!.n)).toBe(1)
    await dispatchNext(runner)
    expect(bridge.commands).toHaveLength(1)
    expect(bridge.commands[0].action).toBe('collect_creator_works')
    expect(bridge.commands[0].payload).toMatchObject({ creatorId: 'uid-a', creatorSecUid: 'sec-a',
      profileUrl: 'https://www.douyin.com/user/sec-a', purpose: 'saved-author-works-only' })
    expect(bridge.commands[0].payload).not.toHaveProperty('creatorLimit')
    expect(bridge.commands[0].payload).not.toHaveProperty('commentsPerWork')
  })

  it('keeps a following refresh catalog-only, then processes a separately requested work and comment job', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(1)
    await dispatchNext(runner)
    const followingCommand = bridge.commands.at(-1)!
    const followingItems = [
      { entityType: 'creator', creatorId: 'real-c1', nickname: '真实博主一', profileUrl: 'https://www.douyin.com/user/real-c1', signature: '', isFollowing: true },
      { entityType: 'creator', creatorId: 'real-c2', nickname: '真实博主二', profileUrl: 'https://www.douyin.com/user/real-c2', signature: '', isFollowing: true },
      { entityType: 'creator', creatorId: 'real-c3', nickname: '不应入库', profileUrl: 'https://www.douyin.com/user/real-c3', signature: '', isFollowing: true }
    ] satisfies BrowserCollectionEnvelope['items']
    expect(bridge.deliverEnvelope(envelope(
      followingCommand.commandId,
      'https://www.douyin.com/user/self?showTab=follow',
      followingItems,
      followingProof(['real-c1', 'real-c2', 'real-c3'])
    ))).toMatchObject({ accepted: true })

    expect(database!.getSummary()).toMatchObject({ followingCount: 1, workCount: 0, commentCount: 0 })
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.following' AND state='completed'`).get() as { count: number }).count)).toBe(1)
    const followingCheckpoint = JSON.parse(String((database!.db.prepare('SELECT checkpoint_json FROM jobs WHERE id=?').get(started.jobId) as { checkpoint_json: string }).checkpoint_json)) as {
      sourceProof: DouyinFollowingStructuredProof
    }
    expect(followingCheckpoint.sourceProof.creatorIds).toEqual(['real-c1', 'real-c2', 'real-c3'])
    expect(followingCheckpoint.sourceProof.returnedIds).toEqual(['real-c1', 'real-c2', 'real-c3'])
    expect(followingCheckpoint.sourceProof.responseProjectionSha256).toBe('b'.repeat(64))
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.creator_works'`).get() as { count: number }).count)).toBe(0)
    await dispatchNext(runner)
    expect(bridge.commands).toHaveLength(1)

    enqueueSyntheticWorks('real-c1')
    await dispatchNext(runner)
    const creatorJob = database!.db.prepare(`SELECT id, payload_json FROM jobs WHERE kind='collection.creator_works' ORDER BY id LIMIT 1`).get() as { id: number; payload_json: string }
    const creatorPayload = JSON.parse(creatorJob.payload_json) as Record<string, unknown>
    const creatorId = String(creatorPayload.creatorId)
    const workIds = [1, 2, 3].map((index) => `76622180430444168${index}1`)
    const workItems = workIds.map((workId, offset) => {
      const index = offset + 1
      const statistics = { likeCount: index, commentCount: null, collectCount: null, shareCount: null, playCount: null }
      return {
        entityType: 'work' as const, workId, creatorId, workType: index === 2 ? 'image' as const : 'video' as const,
        sourceUrl: `https://www.douyin.com/video/${workId}`, title: `真实作品 ${index}`, description: `作品 ${index}`,
        discoveredAt: '2026-09-02T08:00:00.000Z',
        metrics: { likeCount: index, commentCount: null, collectCount: null, shareCount: null,
          visibility: { like: 'visible' as const, comment: 'unknown' as const, collect: 'unknown' as const, share: 'unknown' as const } },
        ...syntheticR4WorkEvidence(creatorId, workId, statistics, { collectedAt: '2026-09-02T08:00:00.000Z' })
      }
    })
    const worksReceipt = bridge.deliverEnvelope(envelope(
      String(creatorPayload.commandId),
      `https://www.douyin.com/user/${creatorId}`,
      workItems,
      syntheticCreatorWorksProof(creatorId, workIds, { collectedAt: '2026-09-02T08:00:00.000Z', cursorOut: '20' })
    ))
    expect(worksReceipt, worksReceipt.error).toMatchObject({ accepted: true })

    expect(database!.getSummary().workCount).toBe(2)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(creatorJob.id) as { state: string }).state).toBe('completed')
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.work_comments'`).get() as { count: number }).count)).toBe(0)
    expect(() => runner.startCommentsSync('not-a-native-id', 2)).toThrow(/原生 ID/)
    const requested = runner.startCommentsSync(workIds[0], 2)
    expect(requested.jobId).toBeGreaterThan(0)
    expect(() => runner.startCommentsSync(workIds[0], 2)).toThrow(/已有同范围/)

    await dispatchNext(runner)
    const commentJob = database!.db.prepare(`SELECT id, payload_json FROM jobs WHERE kind='collection.work_comments' ORDER BY id LIMIT 1`).get() as { id: number; payload_json: string }
    const commentPayload = JSON.parse(commentJob.payload_json) as Record<string, unknown>
    const workId = String(commentPayload.workId)
    const sourceUrl = String(commentPayload.sourceUrl)
    const workItem = {
      entityType: 'work' as const, workId, creatorId: String(commentPayload.creatorId), workType: 'video' as const,
      sourceUrl, title: '真实作品详情', description: '真实详情', mediaUrl: 'https://example.com/video.mp4',
      discoveredAt: '2026-09-02T08:00:00.000Z', metrics: { likeCount: 10, commentCount: 3, collectCount: null, shareCount: null,
        visibility: { like: 'visible' as const, comment: 'visible' as const, collect: 'unknown' as const, share: 'unknown' as const } }
    }
    const commentIds = [1, 2, 3].map((index) => `${workId}-cm${index}`)
    const legacyReceipt = bridge.deliverEnvelope(envelope(String(commentPayload.commandId), sourceUrl, [
      workItem,
      ...[1, 2, 3].map((index) => ({ entityType: 'comment' as const, commentId: `${workId}-cm${index}`, commentIdKind: 'page-attribute' as const, workId, parentCommentId: null, publicAuthorId: null, publicAuthorName: `真实观众${index}`, body: `真实评论 ${index}`, likeCount: index, publishedAt: null }))
    ], commentProof(workId, commentIds)))
    expect(legacyReceipt).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect(legacyReceipt.error).toMatch(/DOM_ONLY_SOURCE_REJECTED/)

    expect(database!.getSummary()).toMatchObject({ followingCount: 1, workCount: 2, commentCount: 0 })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(commentJob.id) as { state: string }).state).toBe('blocked_user_action')
    const storedComments = database!.db.prepare('SELECT platform_comment_id, platform_comment_id_kind, public_author_name, body, source_verified, source_proof_json FROM comments WHERE work_id=(SELECT id FROM works WHERE platform_work_id=?) ORDER BY id').all(workId) as Array<Record<string, unknown>>
    expect(storedComments).toHaveLength(0)
    expect(database!.db.prepare('SELECT scope_type, scope_id FROM collection_checkpoints WHERE scope_type=? AND scope_id=?').get('work', workId)).toBeUndefined()
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind LIKE 'media.%' OR kind LIKE 'cloud.%'`).get() as { count: number }).count)).toBe(0)
    expect(database!.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects a legacy DOM-only following envelope before any database write', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(1)
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    const receipt = bridge.deliverEnvelope(envelope(command.commandId, 'https://www.douyin.com/user/self?showTab=follow', [
      { entityType: 'creator', creatorId: 'noise-user', nickname: '推荐账号', profileUrl: 'https://www.douyin.com/user/noise-user', signature: '', isFollowing: true }
    ], {
      contract: 'douyin-following-source-proof/v1',
      relationship: 'following',
      pageKind: 'owner-following-list',
      activeTab: 'following',
      extractionScope: 'verified-following-list-container',
      scrollRootKind: 'not-needed',
      containerIdentity: 'role:list|aria-label:关注账号列表',
      scrollRootIdentity: 'not-needed',
      creatorIds: ['noise-user']
    }))

    expect(receipt).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect(receipt.error).toMatch(/DOM_ONLY_SOURCE_REJECTED/)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('blocked_user_action')
    expect(database!.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0, lastSyncAt: null })
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM collection_checkpoints').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.creator_works'`).get() as { count: number }).count)).toBe(0)
  })

  it('rejects an R4 work without independent detail verification before any work-side database write', async () => {
    const { runner, bridge } = createRunner()
    runner.startFollowingRefresh(1)
    await dispatchNext(runner)
    const followingCommand = bridge.commands.at(-1)!
    const creatorId = 'synthetic-r4-creator'
    expect(bridge.deliverEnvelope(envelope(
      followingCommand.commandId,
      'https://www.douyin.com/user/self?showTab=follow',
      [{
        entityType: 'creator', creatorId, nickname: '合成 R4 博主',
        profileUrl: `https://www.douyin.com/user/${creatorId}`, signature: '', isFollowing: true
      }],
      followingProof([creatorId])
    ))).toMatchObject({ accepted: true })

    enqueueSyntheticWorks(creatorId, 1)
    await dispatchNext(runner)
    const creatorJob = database!.db.prepare(`SELECT id, payload_json FROM jobs WHERE kind='collection.creator_works' ORDER BY id LIMIT 1`).get() as { id: number; payload_json: string }
    const creatorPayload = JSON.parse(creatorJob.payload_json) as Record<string, unknown>
    const workId = 'synthetic-r4-work'
    const statistics = { likeCount: 12, commentCount: 3, collectCount: 4, shareCount: 5, playCount: 100 }
    const evidence = syntheticR4WorkEvidence(creatorId, workId, statistics, { collectedAt: '2026-09-02T08:00:00.000Z' })
    const receipt = bridge.deliverEnvelope(envelope(
      String(creatorPayload.commandId),
      `https://www.douyin.com/user/${creatorId}`,
      [{
        entityType: 'work', workId, creatorId, workType: 'video',
        sourceUrl: `https://www.douyin.com/video/${workId}`, title: '合成 R4 作品', description: '',
        discoveredAt: '2026-09-02T08:00:00.000Z',
        metrics: {
          likeCount: 12, commentCount: 3, collectCount: 4, shareCount: 5,
          visibility: { like: 'visible', comment: 'visible', collect: 'visible', share: 'visible' }
        },
        authorProof: evidence.authorProof,
        structuredObservation: evidence.structuredObservation
      }],
      syntheticCreatorWorksProof(creatorId, [workId], { collectedAt: '2026-09-02T08:00:00.000Z' })
    ))

    expect(receipt).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect(receipt.error).toMatch(/DOM_ONLY_SOURCE_REJECTED/)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(creatorJob.id) as { state: string }).state).toBe('blocked_user_action')
    expect(database!.getSummary()).toMatchObject({ followingCount: 1, workCount: 0, commentCount: 0 })
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM works').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM collection_checkpoints WHERE scope_id=?`).get(creatorId) as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.work_comments'`).get() as { count: number }).count)).toBe(0)
  })

  it('rejects proof whose creator list or profile identity does not match the returned items', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(2)
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    const receipt = bridge.deliverEnvelope(envelope(command.commandId, 'https://www.douyin.com/user/self?showTab=follow', [
      { entityType: 'creator', creatorId: 'real-c1', nickname: '真实博主', profileUrl: 'https://www.douyin.com/user/different-id', signature: '', isFollowing: true }
    ], followingProof(['real-c1', 'extra-id'])))

    expect(receipt).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('blocked_user_action')
    expect(database!.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0, lastSyncAt: null })
  })

  it('accepts a verified empty following list and writes the explicit following checkpoint', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(1)
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    const receipt = bridge.deliverEnvelope(envelope(
      command.commandId,
      'https://www.douyin.com/user/self?showTab=follow',
      [],
      followingProof([], true)
    ))

    expect(receipt).toMatchObject({ accepted: true })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('completed')
    expect(database!.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0, lastSyncAt: '2026-09-02T08:00:00.000Z' })
    expect(database!.db.prepare('SELECT scope_type, scope_id, completeness, has_more FROM collection_checkpoints').get()).toMatchObject({
      scope_type: 'creator', scope_id: 'following', completeness: 'complete', has_more: 0
    })
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.creator_works'`).get() as { count: number }).count)).toBe(0)
  })

  it('requeues a browser-blocked collection task after the user chooses resume', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(1)
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    bridge.emit('status', { type: 'blocked', commandId: command.commandId, message: '请完成登录验证' })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('blocked_user_action')

    const unrelatedJobId = database!.enqueueJob('media.process', { workId: 'unrelated' })
    database!.db.prepare(`UPDATE jobs SET state='paused' WHERE id=?`).run(unrelatedJobId)
    const legacyCollectionJobId = database!.enqueueJob('collection.work_comments', { workId: 'legacy-unversioned' })
    database!.db.prepare(`UPDATE jobs SET state='paused' WHERE id=?`).run(legacyCollectionJobId)
    expect(database!.resumeJob(legacyCollectionJobId)).toBe(false)
    expect(database!.resumeJob(started.jobId)).toBe(true)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('queued')
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(unrelatedJobId) as { state: string }).state).toBe('paused')
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(legacyCollectionJobId) as { state: string }).state).toBe('paused')
    expect(database!.getJobs().find((job) => job.id === legacyCollectionJobId)?.resumable).toBe(false)
    await dispatchNext(runner)
    expect(bridge.commands).toHaveLength(2)
    expect(bridge.commands[1].commandId).not.toBe(command.commandId)
    expect(bridge.commands[1].commandId).toBe(`job-${started.jobId}-attempt-2`)
    expect(bridge.deliverEnvelope(envelope(
      command.commandId,
      'https://www.douyin.com/user/self?showTab=follow',
      [],
      followingProof([], true)
    ))).toMatchObject({ accepted: false, code: 'unknown-command' })
    expect(database!.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0 })
  })

  it('continues an unrelated scope after one collection job is rejected', async () => {
    const { runner, bridge } = createRunner()
    const first = runner.startFollowingRefresh(1)
    const second = runner.startFollowingRefresh(2)
    database!.db.prepare('UPDATE jobs SET created_at=? WHERE id=?').run('2026-09-06T00:00:00.000Z', first.jobId)
    database!.db.prepare('UPDATE jobs SET created_at=? WHERE id=?').run('2026-09-06T00:00:01.000Z', second.jobId)

    await dispatchNext(runner)
    const firstCommand = bridge.commands.at(-1)!
    const rejected = bridge.deliverEnvelope(envelope(firstCommand.commandId, 'https://www.douyin.com/user/self?showTab=follow', [
      { entityType: 'creator', creatorId: 'dom-only', nickname: 'DOM 候选', profileUrl: 'https://www.douyin.com/user/dom-only', signature: '', isFollowing: true }
    ], {
      contract: 'douyin-following-source-proof/v1',
      relationship: 'following',
      pageKind: 'owner-following-list',
      activeTab: 'following',
      extractionScope: 'verified-following-list-container',
      scrollRootKind: 'not-needed',
      containerIdentity: 'synthetic',
      scrollRootIdentity: 'not-needed',
      creatorIds: ['dom-only']
    }))
    expect(rejected).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(first.jobId) as { state: string }).state).toBe('blocked_user_action')

    await dispatchNext(runner)
    expect(bridge.commands.at(-1)?.commandId).toBe(`job-${second.jobId}-attempt-1`)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(second.jobId) as { state: string }).state).toBe('running')
  })

  it('does not expose a cold-start command until the task is running', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startFollowingRefresh(1)

    bridge.online = false
    await dispatchNext(runner)

    expect(bridge.commands).toHaveLength(0)
    expect(database!.db.prepare('SELECT state, status_message FROM jobs WHERE id=?').get(started.jobId)).toMatchObject({
      state: 'blocked_user_action',
      status_message: '等待 Chrome/Edge 连接器在线'
    })

    bridge.online = true
    expect(database!.resumeJob(started.jobId)).toBe(true)
    const statesSeenByQueue: string[] = []
    bridge.onQueue = () => {
      const row = database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }
      statesSeenByQueue.push(row.state)
    }

    await dispatchNext(runner)
    await dispatchNext(runner)

    expect(statesSeenByQueue).toEqual(['running'])
    expect(bridge.commands).toHaveLength(1)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('running')
  })
})
