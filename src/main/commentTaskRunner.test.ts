import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import commentFixture from '../shared/fixtures/douyin-comment-pages-r5.mock.json'
import type { BrowserCollectionEnvelope, BrowserEventReceipt } from '../shared/contracts'
import type { PlatformAdapterContext } from '../shared/platformAdapter'
import type { BridgeServer, BrowserCommand } from './bridgeServer'
import { AppDatabase } from './database'
import { DouyinCommentListAdapter, DouyinCommentReplyAdapter, type CommentRouteSource, type ReplyRouteSource } from './douyinCommentAdapters'
import { createCollectionJobIdentity, TaskRunner } from './taskRunner'
import type { WorkerClient } from './workerClient'

const observedAt = '2026-09-06T06:00:00.000Z'
const workId = commentFixture.workId
const creatorId = 'synthetic-creator-3001'

class FakeBridge extends EventEmitter {
  envelopeHandler: ((envelope: BrowserCollectionEnvelope) => BrowserEventReceipt) | null = null
  isOnline(): boolean { return true }
  queueCommand(_command: BrowserCommand): void {}
  setEnvelopeHandler(handler: (envelope: BrowserCollectionEnvelope) => BrowserEventReceipt): void {
    this.envelopeHandler = handler
  }
  deliver(envelope: BrowserCollectionEnvelope): BrowserEventReceipt {
    if (!this.envelopeHandler) throw new Error('missing envelope handler')
    return this.envelopeHandler(envelope)
  }
}

let database: AppDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
})

function context(): PlatformAdapterContext {
  return {
    browserOrigin: 'https://www.douyin.com',
    sessionKind: 'browser-page',
    signal: new AbortController().signal,
    now: () => new Date(observedAt)
  }
}

function oneCommentPayload() {
  const page = structuredClone(commentFixture.networkCommentPages['0'])
  page.comments = [page.comments[0]]
  page.cursor = 0
  page.has_more = 0
  page.total = 1
  return page
}

function rootSource(): CommentRouteSource {
  return {
    routeId: 'DY-COMMENT-NETWORK',
    sourceKind: 'network-response',
    readPage: async (input) => ({
      outcome: 'response',
      httpStatus: 200,
      contentType: 'application/json',
      payload: oneCommentPayload(),
      request: {
        method: 'GET', path: '/aweme/v1/web/comment/list/',
        parameters: { aweme_id: input.workId, cursor: input.cursor, count: input.count },
        headers: { accept: 'application/json' }
      },
      durationMs: 5,
      observedAt
    })
  }
}

function replySource(): ReplyRouteSource {
  return {
    routeId: 'DY-REPLY-NETWORK',
    sourceKind: 'network-response',
    readPage: async (input) => ({
      outcome: 'response',
      httpStatus: 200,
      contentType: 'application/json',
      payload: structuredClone(commentFixture.networkReplyPages['0']),
      request: {
        method: 'GET', path: '/aweme/v1/web/comment/list/reply/',
        parameters: {
          aweme_id: input.workId,
          comment_id: input.rootCommentId,
          cursor: input.cursor,
          count: input.count
        },
        headers: { accept: 'application/json' }
      },
      durationMs: 5,
      observedAt
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

function count(sql: string, ...params: Array<string | number | null>): number {
  return Number((database!.db.prepare(sql).get(...params) as { count: number }).count)
}

describe('R6 TaskRunner native-cid database integration', () => {
  it('persists a valid structured comment exactly once with a scope-bound checkpoint', async () => {
    database = new AppDatabase(':memory:')
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1',
      commandId: 'seed-r5-work',
      platform: 'douyin',
      collectedAt: '2026-09-06T05:00:00.000Z',
      sourceUrl: `https://www.douyin.com/user/${creatorId}`,
      completeness: 'complete',
      hasMore: false,
      items: [workItem()]
    }, { scopeType: 'seed', scopeId: 'r5-work' })

    const bridge = new FakeBridge()
    const worker = { processMedia: async () => { throw new Error('media must not run') } } as unknown as WorkerClient
    new TaskRunner(database, bridge as unknown as BridgeServer, worker, 'D:\\signal-desk-test-cache')

    const commandId = 'r5-native-comment-command'
    const jobPayload = {
      commandId, workId, creatorId,
      creatorLimit: 1, worksPerCreator: 1, commentsPerWork: 5,
      collectionOnly: true,
      sourceUrl: `https://www.douyin.com/video/${workId}`
    }
    const identity = createCollectionJobIdentity('collection.work_comments', jobPayload)
    const { jobId } = database.enqueueCollectionJob(
      'collection.work_comments',
      jobPayload,
      identity,
      200
    )
    database.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(jobId)

    const page = await new DouyinCommentListAdapter([rootSource()]).collect({ workId }, context())
    const envelope: BrowserCollectionEnvelope = {
      contract: 'browser-collection-envelope/v1', commandId, platform: 'douyin',
      collectedAt: page.sourceProof.collectedAt,
      sourceUrl: `https://www.douyin.com/video/${workId}`,
      completeness: 'complete', cursor: page.sourceProof.cursorOut,
      hasMore: false, sourceProof: page.sourceProof,
      items: [workItem(), ...page.items.map((comment) => ({ entityType: 'comment' as const, ...comment }))]
    }
    const envelopeWork = envelope.items.find((item) => item.entityType === 'work')
    if (!envelopeWork || envelopeWork.entityType !== 'work') throw new Error('missing test work binding')
    envelopeWork.title = '不应由评论任务覆盖的标题'
    envelopeWork.description = '不应由评论任务覆盖的描述'

    const before = {
      comments: count('SELECT COUNT(*) AS count FROM comments'),
      checkpoint: count('SELECT COUNT(*) AS count FROM collection_checkpoints WHERE scope_type=? AND scope_id=?', 'work', workId),
      mediaOrCloud: count("SELECT COUNT(*) AS count FROM jobs WHERE kind LIKE 'media.%' OR kind LIKE 'cloud.%'")
    }
    const receipt = bridge.deliver(envelope)
    const after = {
      comments: count('SELECT COUNT(*) AS count FROM comments'),
      checkpoint: count('SELECT COUNT(*) AS count FROM collection_checkpoints WHERE scope_type=? AND scope_id=?', 'work', workId),
      mediaOrCloud: count("SELECT COUNT(*) AS count FROM jobs WHERE kind LIKE 'media.%' OR kind LIKE 'cloud.%'")
    }

    expect(receipt).toMatchObject({ accepted: true })
    expect(before).toEqual({ comments: 0, checkpoint: 0, mediaOrCloud: 0 })
    expect(after).toEqual({ comments: 1, checkpoint: 1, mediaOrCloud: 0 })
    expect(database.db.prepare('SELECT title, description FROM works WHERE platform_work_id=?').get(workId)).toEqual({
      title: 'R5 合成作品',
      description: ''
    })
    expect(database.db.prepare(`
      SELECT platform_comment_id_kind, source_verified, endpoint_kind, reply_count
      FROM comments
    `).get()).toMatchObject({
      platform_comment_id_kind: 'native-cid',
      source_verified: 1,
      endpoint_kind: 'comment-list'
    })
    expect(database.db.prepare(`
      SELECT job_id, scope_fingerprint, completeness, has_more
      FROM collection_checkpoints
      WHERE scope_type=? AND scope_id=?
    `).get('work', workId)).toMatchObject({
      job_id: jobId,
      scope_fingerprint: identity.scopeFingerprint,
      completeness: 'complete',
      has_more: 0
    })
    expect((database.db.prepare('SELECT state FROM jobs WHERE id=?').get(jobId) as { state: string }).state).toBe('completed')
    expect(bridge.deliver(envelope)).toMatchObject({ accepted: false, code: 'stale-command' })
    expect(count('SELECT COUNT(*) AS count FROM comments')).toBe(1)

    const rerunCommandId = 'r6-native-comment-rerun'
    const rerun = database.enqueueCollectionJob(
      'collection.work_comments',
      { ...jobPayload, commandId: rerunCommandId },
      identity,
      200
    )
    expect(rerun.created).toBe(true)
    database.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(rerun.jobId)
    expect(bridge.deliver({ ...envelope, commandId: rerunCommandId })).toMatchObject({ accepted: true })
    expect(count('SELECT COUNT(*) AS count FROM comments')).toBe(1)
    expect(database.db.prepare('SELECT job_id, scope_fingerprint FROM collection_checkpoints WHERE scope_type=? AND scope_id=?').get('work', workId)).toMatchObject({
      job_id: rerun.jobId,
      scope_fingerprint: identity.scopeFingerprint
    })

    const tamperedCommandId = 'r6-tampered-identity'
    const tampered = database.enqueueCollectionJob(
      'collection.work_comments',
      { ...jobPayload, commandId: tamperedCommandId },
      identity,
      200
    )
    database.db.prepare(`
      UPDATE jobs
      SET state='running', payload_json=json_set(payload_json, '$.adapterVersion', '0.0.0')
      WHERE id=?
    `).run(tampered.jobId)
    expect(bridge.deliver({ ...envelope, commandId: tamperedCommandId })).toMatchObject({
      accepted: false,
      code: 'invalid-collection-proof'
    })
    expect((database.db.prepare('SELECT state FROM jobs WHERE id=?').get(tampered.jobId) as { state: string }).state).toBe('blocked_user_action')
    expect(count('SELECT COUNT(*) AS count FROM comments')).toBe(1)
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('persists reply root and parent relationships under a reply-specific scope', async () => {
    database = new AppDatabase(':memory:')
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1',
      commandId: 'seed-r6-reply-work',
      platform: 'douyin',
      collectedAt: '2026-09-06T05:00:00.000Z',
      sourceUrl: `https://www.douyin.com/user/${creatorId}`,
      completeness: 'complete',
      hasMore: false,
      items: [workItem()]
    }, { scopeType: 'seed', scopeId: 'r6-reply-work' })

    const rootPage = await new DouyinCommentListAdapter([rootSource()]).collect({ workId }, context())
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1',
      commandId: 'seed-r6-root-comment',
      platform: 'douyin',
      collectedAt: rootPage.sourceProof.collectedAt,
      sourceUrl: `https://www.douyin.com/video/${workId}`,
      completeness: 'complete',
      cursor: rootPage.sourceProof.cursorOut,
      hasMore: false,
      sourceProof: rootPage.sourceProof,
      items: rootPage.items.map((comment) => ({ entityType: 'comment' as const, ...comment }))
    }, { scopeType: 'seed', scopeId: 'r6-root-comment' })

    const bridge = new FakeBridge()
    const worker = { processMedia: async () => { throw new Error('media must not run') } } as unknown as WorkerClient
    new TaskRunner(database, bridge as unknown as BridgeServer, worker, 'D:\\signal-desk-test-cache')
    const rootCommentId = commentFixture.rootCommentId
    const commandId = 'r6-native-reply-command'
    const jobPayload = {
      commandId,
      workId,
      creatorId,
      rootCommentId,
      creatorLimit: 1,
      worksPerCreator: 1,
      commentsPerWork: 5,
      collectionOnly: true,
      sourceUrl: `https://www.douyin.com/video/${workId}`
    }
    const identity = createCollectionJobIdentity('collection.work_comments', jobPayload)
    expect(identity.adapterName).toBe('douyin.comment-replies')
    const { jobId } = database.enqueueCollectionJob('collection.work_comments', jobPayload, identity, 200)
    database.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(jobId)

    const replyPage = await new DouyinCommentReplyAdapter([replySource()]).collect({ workId, rootCommentId }, context())
    const receipt = bridge.deliver({
      contract: 'browser-collection-envelope/v1',
      commandId,
      platform: 'douyin',
      collectedAt: replyPage.sourceProof.collectedAt,
      sourceUrl: `https://www.douyin.com/video/${workId}`,
      completeness: 'complete',
      cursor: replyPage.sourceProof.cursorOut,
      hasMore: false,
      sourceProof: replyPage.sourceProof,
      items: [
        workItem(),
        ...replyPage.items.map((comment) => ({ entityType: 'comment' as const, ...comment }))
      ]
    })

    expect(receipt).toMatchObject({ accepted: true })
    expect(database.db.prepare(`
      SELECT c.platform_comment_id, p.platform_comment_id AS parent_cid,
        r.platform_comment_id AS root_cid, c.endpoint_kind
      FROM comments c
      LEFT JOIN comments p ON p.id=c.parent_comment_id
      LEFT JOIN comments r ON r.id=c.root_comment_id
      WHERE c.platform_comment_id LIKE 'synthetic-reply-%'
      ORDER BY c.id
    `).all()).toEqual([
      {
        platform_comment_id: 'synthetic-reply-3001',
        parent_cid: rootCommentId,
        root_cid: rootCommentId,
        endpoint_kind: 'comment-reply-list'
      },
      {
        platform_comment_id: 'synthetic-reply-3002',
        parent_cid: 'synthetic-reply-3001',
        root_cid: rootCommentId,
        endpoint_kind: 'comment-reply-list'
      }
    ])
    expect(database.db.prepare(`
      SELECT scope_type, scope_id, scope_fingerprint, job_id
      FROM collection_checkpoints WHERE job_id=?
    `).get(jobId)).toMatchObject({
      scope_type: 'comment-replies',
      scope_id: workId + ':reply:' + rootCommentId,
      scope_fingerprint: identity.scopeFingerprint,
      job_id: jobId
    })
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
