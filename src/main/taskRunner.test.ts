import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserCollectionEnvelope, BrowserEventReceipt, DouyinCommentSourceProof, DouyinFollowingSourceProof } from '../shared/contracts'
import { AppDatabase } from './database'
import type { BridgeServer, BrowserCommand } from './bridgeServer'
import { TaskRunner, validateSampleSyncOptions } from './taskRunner'
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

function createRunner(): { runner: TaskRunner; bridge: FakeBridge } {
  database = new AppDatabase(':memory:')
  const bridge = new FakeBridge()
  const worker = { processMedia: async () => { throw new Error('media processing must not run during collection-only sample sync') } } as unknown as WorkerClient
  return { runner: new TaskRunner(database, bridge as unknown as BridgeServer, worker, 'D:\\signal-desk-test-cache'), bridge }
}

async function dispatchNext(runner: TaskRunner): Promise<void> {
  await (runner as unknown as { tick: () => Promise<void> }).tick()
}

function followingProof(creatorIds: string[], empty = false): DouyinFollowingSourceProof {
  return {
    contract: 'douyin-following-source-proof/v1',
    relationship: 'following',
    pageKind: 'owner-following-list',
    activeTab: 'following',
    extractionScope: 'verified-following-list-container',
    scrollRootKind: 'not-needed',
    containerIdentity: 'role:list|aria-label:关注账号列表',
    scrollRootIdentity: empty ? 'verified-empty-state' : 'not-needed',
    creatorIds,
    ...(empty ? { emptyStateEvidence: 'verified-empty-state' as const } : {})
  }
}

function workAuthorProof(creatorId: string, workId: string) {
  const schemaFingerprint = 'a'.repeat(64)
  return {
    contract: 'douyin-work-author-proof/v2' as const,
    followedCreatorId: creatorId,
    profileRouteCreatorId: creatorId,
    requestTargetCreatorId: creatorId,
    observedWorkAuthorId: creatorId,
    observedWorkId: workId,
    authorProofSource: 'network-response' as const,
    endpointKind: 'creator-work-list' as const,
    routeId: 'DY-WORKS-NETWORK' as const,
    adapterVersion: '0.2.0-r2',
    observedAt: '2026-09-02T08:00:00.000Z',
    schemaFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: [{
      routeId: 'DY-WORKS-NETWORK' as const,
      status: 'success' as const,
      attempt: 1,
      durationMs: 10,
      schemaFingerprint,
      occurredAt: '2026-09-02T08:00:00.000Z'
    }]
  }
}

function structuredWorkObservation(creatorId: string, workId: string) {
  const schemaFingerprint = 'a'.repeat(64)
  return {
    contract: 'douyin-structured-work-observation/v1' as const,
    sourceKind: 'network-response' as const,
    routeId: 'DY-WORKS-NETWORK' as const,
    endpointKind: 'creator-work-list' as const,
    requestTargetCreatorId: creatorId,
    workId,
    authorId: creatorId,
    authorIdSourcePath: 'aweme_list[].author.uid' as const,
    observedAt: '2026-09-02T08:00:00.000Z',
    schemaFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: [{
      routeId: 'DY-WORKS-NETWORK' as const,
      status: 'success' as const,
      attempt: 1,
      durationMs: 10,
      schemaFingerprint,
      occurredAt: '2026-09-02T08:00:00.000Z'
    }]
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
  sourceProof?: DouyinFollowingSourceProof | DouyinCommentSourceProof
): BrowserCollectionEnvelope {
  return {
    contract: 'browser-collection-envelope/v1', commandId, platform: 'douyin',
    collectedAt: '2026-09-02T08:00:00.000Z', sourceUrl,
    completeness: 'complete', hasMore: false, ...(sourceProof ? { sourceProof } : {}), items
  }
}

describe('bounded sample synchronization', () => {
  it('rejects limits outside the main-process hard boundary', () => {
    expect(validateSampleSyncOptions({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })).toEqual({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })
    expect(() => validateSampleSyncOptions({ creatorLimit: 6, worksPerCreator: 5, commentsPerWork: 20 })).toThrow(/1～5/)
    expect(() => validateSampleSyncOptions({ creatorLimit: 3, worksPerCreator: 11, commentsPerWork: 20 })).toThrow(/1～10/)
    expect(() => validateSampleSyncOptions({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 31 })).toThrow(/1～30/)

    const { runner, bridge } = createRunner()
    bridge.online = false
    expect(() => runner.startSampleSync({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })).toThrow(/尚未在线/)
    bridge.online = true
    const started = runner.startSampleSync({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })
    expect(started.scope).toEqual({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })
    const payload = JSON.parse(String((database!.db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(started.jobId) as { payload_json: string }).payload_json))
    expect(payload).toMatchObject({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20, collectionOnly: true })
    expect(() => runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 1 })).toThrow(/已有采集任务/)
  })

  it('enforces every limit again before persistence and completes collection jobs without starting media or cloud work', async () => {
    const { runner, bridge } = createRunner()
    runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 2, commentsPerWork: 2 })
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
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.creator_works' AND state='queued'`).get() as { count: number }).count)).toBe(1)

    await dispatchNext(runner)
    const creatorJob = database!.db.prepare(`SELECT id, payload_json FROM jobs WHERE kind='collection.creator_works' ORDER BY id LIMIT 1`).get() as { id: number; payload_json: string }
    const creatorPayload = JSON.parse(creatorJob.payload_json) as Record<string, unknown>
    const creatorId = String(creatorPayload.creatorId)
    const worksReceipt = bridge.deliverEnvelope(envelope(String(creatorPayload.commandId), `https://www.douyin.com/user/${creatorId}`, [1, 2, 3].map((index) => ({
      entityType: 'work' as const, workId: `${creatorId}-w${index}`, creatorId, workType: index === 2 ? 'image' as const : 'video' as const,
      sourceUrl: `https://www.douyin.com/video/${creatorId}-w${index}`, title: `真实作品 ${index}`, description: `作品 ${index}`,
      discoveredAt: '2026-09-02T08:00:00.000Z', authorProof: workAuthorProof(creatorId, `${creatorId}-w${index}`),
      structuredObservation: structuredWorkObservation(creatorId, `${creatorId}-w${index}`), metrics: { likeCount: index, commentCount: null, collectCount: null, shareCount: null,
        visibility: { like: 'visible' as const, comment: 'unknown' as const, collect: 'unknown' as const, share: 'unknown' as const } }
    }))))
    expect(worksReceipt, worksReceipt.error).toMatchObject({ accepted: true })

    expect(database!.getSummary().workCount).toBe(2)
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(creatorJob.id) as { state: string }).state).toBe('completed')
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.work_comments'`).get() as { count: number }).count)).toBe(2)

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
    expect(bridge.deliverEnvelope(envelope(String(commentPayload.commandId), sourceUrl, [
      workItem,
      ...[1, 2, 3].map((index) => ({ entityType: 'comment' as const, commentId: `${workId}-cm${index}`, commentIdKind: 'page-attribute' as const, workId, parentCommentId: null, publicAuthorId: null, publicAuthorName: `真实观众${index}`, body: `真实评论 ${index}`, likeCount: index, publishedAt: null }))
    ], commentProof(workId, commentIds)))).toMatchObject({ accepted: true })

    expect(database!.getSummary()).toMatchObject({ followingCount: 1, workCount: 2, commentCount: 2 })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(commentJob.id) as { state: string }).state).toBe('completed')
    const storedComments = database!.db.prepare('SELECT platform_comment_id, platform_comment_id_kind, public_author_name, body, source_verified, source_proof_json FROM comments WHERE work_id=(SELECT id FROM works WHERE platform_work_id=?) ORDER BY id').all(workId) as Array<Record<string, unknown>>
    expect(storedComments).toHaveLength(2)
    expect(storedComments[0]).toMatchObject({ platform_comment_id_kind: 'page-attribute', public_author_name: '真实观众1', body: '真实评论 1', source_verified: 1 })
    expect(JSON.parse(String(storedComments[0].source_proof_json))).toMatchObject({ contract: 'douyin-comment-source-proof/v1', workId, commentIds: commentIds.slice(0, 2) })
    expect(database!.db.prepare('SELECT scope_type, scope_id FROM collection_checkpoints WHERE scope_type=? AND scope_id=?').get('work', workId)).toMatchObject({ scope_type: 'work', scope_id: workId })
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind LIKE 'media.%' OR kind LIKE 'cloud.%'`).get() as { count: number }).count)).toBe(0)
    expect(database!.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects an old or unproven following envelope before any database write', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 1 })
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    const receipt = bridge.deliverEnvelope(envelope(command.commandId, 'https://www.douyin.com/user/self?showTab=follow', [
      { entityType: 'creator', creatorId: 'noise-user', nickname: '推荐账号', profileUrl: 'https://www.douyin.com/user/noise-user', signature: '', isFollowing: true }
    ]))

    expect(receipt).toMatchObject({ accepted: false, code: 'invalid-collection-proof' })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('blocked_user_action')
    expect(database!.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0, lastSyncAt: null })
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare('SELECT COUNT(*) AS count FROM collection_checkpoints').get() as { count: number }).count)).toBe(0)
    expect(Number((database!.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE kind='collection.creator_works'`).get() as { count: number }).count)).toBe(0)
  })

  it('rejects proof whose creator list or profile identity does not match the returned items', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startSampleSync({ creatorLimit: 2, worksPerCreator: 1, commentsPerWork: 1 })
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
    const started = runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 1 })
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
    const started = runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 1 })
    await dispatchNext(runner)
    const command = bridge.commands.at(-1)!
    bridge.emit('status', { type: 'blocked', commandId: command.commandId, message: '请完成登录验证' })
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('blocked_user_action')

    database!.resumePausedJobs()
    expect((database!.db.prepare('SELECT state FROM jobs WHERE id=?').get(started.jobId) as { state: string }).state).toBe('queued')
    await dispatchNext(runner)
    expect(bridge.commands).toHaveLength(2)
    expect(bridge.commands[1].commandId).toBe(command.commandId)
  })

  it('does not expose a cold-start command until the task is running', async () => {
    const { runner, bridge } = createRunner()
    const started = runner.startSampleSync({ creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 1 })

    bridge.online = false
    await dispatchNext(runner)

    expect(bridge.commands).toHaveLength(0)
    expect(database!.db.prepare('SELECT state, status_message FROM jobs WHERE id=?').get(started.jobId)).toMatchObject({
      state: 'blocked_user_action',
      status_message: '等待 Chrome/Edge 连接器在线'
    })

    bridge.online = true
    database!.resumePausedJobs()
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
