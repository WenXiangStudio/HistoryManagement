import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from './database'

let database: AppDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
})

describe('AppDatabase', () => {
  it('ingests repeated entities idempotently while appending timestamped metrics', () => {
    database = new AppDatabase(':memory:')
    const base = {
      contract: 'browser-collection-envelope/v1' as const,
      commandId: 'test', platform: 'douyin' as const, sourceUrl: 'https://www.douyin.com/user/test',
      completeness: 'complete' as const, hasMore: false,
      items: [{
        entityType: 'creator' as const, creatorId: 'creator-1', nickname: '测试博主',
        profileUrl: 'https://www.douyin.com/user/creator-1', signature: '科技', isFollowing: true
      }]
    }
    database.ingestEnvelope({ ...base, collectedAt: '2026-08-27T00:00:00.000Z' })
    database.ingestEnvelope({ ...base, collectedAt: '2026-08-27T01:00:00.000Z' })
    expect(database.getSummary().followingCount).toBe(1)

    const work = {
      ...base, commandId: 'work', collectedAt: '2026-08-27T02:00:00.000Z',
      items: [{
        entityType: 'work' as const, workId: 'work-1', creatorId: 'creator-1', workType: 'video' as const,
        sourceUrl: 'https://www.douyin.com/video/work-1', title: '测试作品', description: '证据文本',
        publishedAt: '2026-08-26T00:00:00.000Z', discoveredAt: '2026-08-27T02:00:00.000Z',
        metrics: { likeCount: 10, commentCount: 2, collectCount: null, shareCount: null,
          visibility: { like: 'visible' as const, comment: 'visible' as const, collect: 'unknown' as const, share: 'unknown' as const } }
      }]
    }
    database.ingestEnvelope(work)
    database.ingestEnvelope({ ...work, collectedAt: '2026-08-27T03:00:00.000Z' })
    expect(database.getSummary().workCount).toBe(1)
    expect(Number((database.db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get() as { count: number }).count)).toBe(2)
  })

  it('generates a complete offline demo library', () => {
    database = new AppDatabase(':memory:')
    database.seedDemo()
    const summary = database.getSummary()
    expect(summary.followingCount).toBe(6)
    expect(summary.workCount).toBe(24)
    expect(summary.commentCount).toBe(120)
    expect(summary.analyzedCount).toBe(24)
    expect(database.getInbox({ state: 'unread' })).toHaveLength(24)

    expect(database.getInbox({ state: 'all', search: 'AI' }).length).toBeGreaterThan(0)
    expect(database.getInbox({ state: 'all', search: '金融' }).length).toBeGreaterThan(0)
    expect(database.getInbox({ state: 'all', search: '科技' }).length).toBeGreaterThan(0)
    expect(database.getCreators('AI').map((creator) => creator.nickname)).toContain('量子茶馆')
    expect(database.getCreators('金融').map((creator) => creator.nickname)).toContain('慢钱研究所')
    expect(database.getCreators('量子茶馆').map((creator) => creator.nickname)).toEqual(['量子茶馆'])

    const demoWorks = database.getInbox({ state: 'all', limit: 100 })
    const techWork = demoWorks.find((work) => work.platformWorkId === 'c-tech-w1')
    expect(techWork).toMatchObject({ isDemo: true })
    expect(techWork?.domains).toContain('科技')
    expect(techWork?.creatorDomains).toContain('科技')
    expect(demoWorks.find((work) => work.platformWorkId === 'c-tech-w2')?.collectCount).toBeNull()
    expect(demoWorks.find((work) => work.platformWorkId === 'c-finance-w3')?.commentCount).toBeNull()
    expect(demoWorks.find((work) => work.platformWorkId === 'c-history-w4')?.likeCount).toBeNull()

    const detail = database.getWorkDetail(techWork!.id)
    expect(detail?.is_demo).toBe(1)
    expect(detail?.workDomains).toContain('科技')
    expect(detail?.creatorDomains).toContain('科技')
  })

  it('clears only demo records and their non-foreign-key references while preserving real user data', () => {
    database = new AppDatabase(':memory:')
    database.seedDemo()
    const collectedAt = '2026-08-30T08:00:00.000Z'
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1', commandId: 'real-creator', platform: 'douyin', collectedAt,
      sourceUrl: 'https://www.douyin.com/user/real-creator', completeness: 'complete', hasMore: false,
      items: [{ entityType: 'creator', creatorId: 'real-creator', nickname: '真实博主', avatarUrl: null, signature: '真实资料', profileUrl: 'https://www.douyin.com/user/real-creator', isFollowing: true }]
    })
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1', commandId: 'real-work', platform: 'douyin', collectedAt,
      sourceUrl: 'https://www.douyin.com/video/real-work', completeness: 'complete', hasMore: false,
      items: [{
        entityType: 'work', workId: 'real-work', creatorId: 'real-creator', workType: 'video',
        sourceUrl: 'https://www.douyin.com/video/real-work', coverUrl: null, mediaUrl: null, imageUrls: [],
        title: '真实作品', description: '真实作品内容', publishedAt: collectedAt, discoveredAt: collectedAt,
        metrics: { likeCount: 12, commentCount: 1, collectCount: 3, shareCount: null, visibility: { like: 'visible', comment: 'visible', collect: 'visible', share: 'unknown' } }
      }]
    })
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1', commandId: 'real-comment', platform: 'douyin', collectedAt,
      sourceUrl: 'https://www.douyin.com/video/real-work', completeness: 'complete', hasMore: false,
      items: [{ entityType: 'comment', commentId: 'real-comment', workId: 'real-work', parentCommentId: null, publicAuthorId: 'real-viewer', publicAuthorName: '真实观众', body: '真实评论', likeCount: 2, publishedAt: collectedAt }]
    })
    database.saveAnalysis({
      contract: 'analysis-result/v1', subjectType: 'work', subjectId: 'real-work', summary: '真实摘要', keyPoints: ['真实要点'],
      coreExpression: '真实表达', domains: [{ id: 'technology', confidence: 0.8 }], keywords: ['真实关键词'],
      evidence: [{ kind: 'page', ref: 'https://www.douyin.com/video/real-work', quote: '真实作品内容' }], confidence: 0.8,
      modelId: 'real-model', promptVersion: 'work-analysis/v1', generatedAt: collectedAt
    })

    const demoCreators = database.db.prepare('SELECT id FROM creators WHERE is_demo=1 ORDER BY id').all() as Array<{ id: number }>
    const demoWorks = database.db.prepare('SELECT id FROM works WHERE is_demo=1 ORDER BY id').all() as Array<{ id: number }>
    const demoComments = database.db.prepare('SELECT c.id FROM comments c JOIN works w ON w.id=c.work_id WHERE w.is_demo=1 ORDER BY c.id').all() as Array<{ id: number }>
    const realCreator = database.db.prepare(`SELECT id FROM creators WHERE platform_creator_id='real-creator'`).get() as { id: number }
    const realWork = database.db.prepare(`SELECT id FROM works WHERE platform_work_id='real-work'`).get() as { id: number }
    const realComment = database.db.prepare(`SELECT id FROM comments WHERE platform_comment_id='real-comment'`).get() as { id: number }
    database.updateCreator(demoCreators[0].id, { isStarred: true, note: '演示批注' })
    database.updateInboxState(demoWorks[0].id, 'saved')
    database.updateInboxState(demoWorks[1].id, 'later')
    database.updateCreator(realCreator.id, { isStarred: true, note: '真实批注' })
    database.updateInboxState(realWork.id, 'saved')
    database.db.prepare(`INSERT INTO evidence_frames(work_id, frame_ref, time_ms, local_path, perceptual_hash) VALUES (?, 'demo-frame', 0, 'D:\\demo-frame.jpg', 'hash')`).run(demoWorks[0].id)
    database.enqueueJob('cloud.work_text', { workId: 'c-tech-w1' }, 100, 'work', demoWorks[0].id)
    database.enqueueJob('collection.creator_works', { creatorId: 'c-tech' }, 100)
    database.enqueueJob('cloud.work_text', { workId: 'real-work' }, 100, 'work', realWork.id)
    database.db.prepare(`INSERT INTO analysis_batches(batch_type, state, subject_count, estimated_input_tokens, estimated_output_tokens, image_count, estimated_cost, created_at, manifest_json) VALUES ('work_text','awaiting_approval',2,100,50,0,0.1,?,?)`).run(
      collectedAt,
      JSON.stringify({ version: 1, workIds: [demoWorks[0].id, realWork.id], commentIds: [demoComments[0].id, realComment.id], visionWorks: [] })
    )

    const before = database.getDemoDataSummary()
    expect(before).toMatchObject({
      creatorCount: 6, workCount: 24, commentCount: 120, analysisCount: 24, evidenceFrameCount: 1,
      savedCount: 1, laterCount: 1, starredCreatorCount: 1, notedCreatorCount: 1,
      relatedJobCount: 2, relatedBatchCount: 1, blockingOperationCount: 0
    })

    const removed = database.clearDemoData()
    expect(removed).toEqual(before)
    expect(database.getDemoDataSummary()).toMatchObject({ creatorCount: 0, workCount: 0, commentCount: 0 })
    expect(database.getSummary()).toMatchObject({ followingCount: 1, workCount: 1, commentCount: 1, analyzedCount: 1 })
    expect(database.getCreators('真实博主')[0]).toMatchObject({ nickname: '真实博主', isStarred: true, note: '真实批注' })
    expect(database.getInbox({ state: 'saved', search: '真实作品' })).toHaveLength(1)
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM analyses WHERE model_id='demo-local'`).get() as { count: number }).count)).toBe(0)
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM analyses WHERE model_id='real-model'`).get() as { count: number }).count)).toBe(1)
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE json_extract(payload_json, '$.workId')='real-work'`).get() as { count: number }).count)).toBe(1)
    expect(Number((database.db.prepare('SELECT COUNT(*) AS count FROM analysis_batches').get() as { count: number }).count)).toBe(0)
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type='demo.cleared'`).get() as { count: number }).count)).toBe(1)
  })

  it('refuses demo cleanup while a related operation is running', () => {
    database = new AppDatabase(':memory:')
    database.seedDemo()
    const work = database.db.prepare('SELECT id, platform_work_id FROM works WHERE is_demo=1 ORDER BY id LIMIT 1').get() as { id: number; platform_work_id: string }
    const jobId = database.enqueueJob('media.process', { workId: work.platform_work_id, mediaUrl: 'https://example.com/demo.mp4' }, 100, 'work', work.id)
    database.db.prepare(`UPDATE jobs SET state='running' WHERE id=?`).run(jobId)

    expect(database.getDemoDataSummary().blockingOperationCount).toBe(1)
    expect(() => database!.clearDemoData()).toThrow(/正在执行/)
    expect(database.getSummary()).toMatchObject({ followingCount: 6, workCount: 24, commentCount: 120 })
  })

  it('resets sync metadata after clearing a library that contains only demo records', () => {
    database = new AppDatabase(':memory:')
    database.seedDemo()

    expect((database.db.prepare(`SELECT last_sync_at FROM owner_accounts WHERE platform='douyin'`).get() as { last_sync_at: string | null }).last_sync_at).not.toBeNull()
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM collection_checkpoints WHERE scope_id='following'`).get() as { count: number }).count)).toBe(1)

    expect(database.clearDemoData()).toMatchObject({ creatorCount: 6, workCount: 24, commentCount: 120 })
    expect((database.db.prepare(`SELECT last_sync_at FROM owner_accounts WHERE platform='douyin'`).get() as { last_sync_at: string | null }).last_sync_at).toBeNull()
    expect(Number((database.db.prepare(`SELECT COUNT(*) AS count FROM collection_checkpoints WHERE scope_id='following'`).get() as { count: number }).count)).toBe(0)
    expect(database.getSummary()).toMatchObject({ followingCount: 0, workCount: 0, commentCount: 0, lastSyncAt: null })
    expect(database.getDemoDataSummary()).toMatchObject({ creatorCount: 0, workCount: 0, commentCount: 0, blockingOperationCount: 0 })
    expect(database.clearDemoData()).toEqual(database.getDemoDataSummary())
  })

  it('validates settings at the main-process persistence boundary', () => {
    database = new AppDatabase(':memory:')
    const saved = database.saveSettings({
      textBaseUrl: 'http://127.0.0.1:11434/v1',
      visionBaseUrl: 'https://vision.example.com/v1',
      contextWindow: 999,
      cacheLimitGb: 9_999,
      interests: [' AI ', 'AI', '金融']
    })
    expect(saved.contextWindow).toBe(8_000)
    expect(saved.cacheLimitGb).toBe(500)
    expect(saved.interests).toEqual(['AI', '金融'])
    expect(() => database!.saveSettings({ textBaseUrl: 'file:///secret' })).toThrow(/HTTP/)
    expect(() => database!.saveSettings({ visionBaseUrl: 'not a url' })).toThrow(/有效地址/)
    expect(() => database!.saveSettings({ imagePrice: -1 })).toThrow(/非负数/)
  })

  it('migrates the shared legacy cloud service into text settings only', () => {
    database = new AppDatabase(':memory:')
    database.db.prepare(`INSERT INTO app_settings(key, value_json, updated_at) VALUES ('settings', ?, ?)`)
      .run(JSON.stringify({
        cloudBaseUrl: 'https://legacy-text.example.com/v1',
        textModel: 'legacy-text-model',
        visionModel: 'legacy-vision-model',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 4.5
      }), new Date().toISOString())

    const migrated = database.getSettings()
    expect(migrated.textBaseUrl).toBe('https://legacy-text.example.com/v1')
    expect(migrated.textInputPricePerMillion).toBe(1.25)
    expect(migrated.textOutputPricePerMillion).toBe(4.5)
    expect(migrated.visionBaseUrl).toBe('')
    expect(migrated.visionInputPricePerMillion).toBeNull()
    expect(migrated.visionOutputPricePerMillion).toBeNull()
  })

  it('rebuilds historical work domains and search data after an upgrade', () => {
    const directory = mkdtempSync(join(tmpdir(), 'signal-desk-upgrade-'))
    const path = join(directory, 'library.sqlite')
    try {
      database = new AppDatabase(path)
      database.seedDemo()
      database.db.exec(`DELETE FROM work_tags; DELETE FROM search_index; UPDATE app_settings SET value_json='1' WHERE key='derived-data-version'`)
      database.close()
      database = new AppDatabase(path)

      expect(database.getCreators('科技').map((creator) => creator.nickname)).toContain('量子茶馆')
      const works = database.getInbox({ state: 'all', search: '金融' })
      expect(works.length).toBeGreaterThan(0)
      expect(works.some((work) => work.domains.includes('财经金融'))).toBe(true)
    } finally {
      database?.close()
      database = null
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
