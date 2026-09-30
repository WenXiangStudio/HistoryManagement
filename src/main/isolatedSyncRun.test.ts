import { afterEach, expect, it } from 'vitest'
import { IsolatedSyncRun } from './isolatedSyncRun'

let run: IsolatedSyncRun | null = null
afterEach(() => { run?.close(); run = null })

function verifiedReport(): unknown {
  const at = '2026-09-29T00:00:00.000Z'
  return {
    contract: 'signaldesk-homepage-pilot-report/v1', runId: 'test-run', startedAt: at, finishedAt: at,
    observerIssueCodes: [], safety: { formalDatabaseTouched: false, activeApiRequests: 0,
      mediaProcessingStarted: false, externalProvidersCalled: false },
    result: {
      contract: 'signaldesk-homepage-pilot/v1', status: 'verified', stage: 'work-detail',
      creator: { uid: 'uid-a', secUid: 'sec-a', profileUrl: 'https://www.douyin.com/user/sec-a' },
      navigationCount: 2, activeApiRequests: 0,
      candidates: [{ workId: '7662218043044416811', url: 'https://www.douyin.com/video/7662218043044416811', status: 'page-visible-candidate' }],
      verifiedWork: {
        workId: '7662218043044416811', workIdKind: 'native-aweme-id', workIdSourcePath: 'aweme_detail.aweme_id',
        authorId: 'uid-a', authorSecId: 'sec-a', nickname: '甲', authorIdSourcePath: 'aweme_detail.author.uid',
        workType: 'video', title: '合成作品', description: '测试', publishedAt: null, durationMs: null,
        statistics: { likeCount: 1, commentCount: null, collectCount: null, shareCount: null, playCount: null }
      },
      workProof: { routeId: 'DY-WORKS-NETWORK', endpointKind: 'creator-work-list',
        schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64), observedAt: at },
      detailProof: { routeId: 'DY-DETAIL-NETWORK', endpointKind: 'work-detail',
        schemaFingerprint: 'c'.repeat(64), projectionSha256: 'd'.repeat(64), observedAt: at },
      comments: 'not-requested', replies: 'not-requested', reason: null
    }
  }
}

it('persists one verified work, proofs and a limited checkpoint while refresh failure preserves the result', () => {
  run = new IsolatedSyncRun(':memory:', 'test-run', 'owner-sec', {
    uid: 'uid-a', secUid: 'sec-a', nickname: '甲', profileUrl: 'https://www.douyin.com/user/sec-a', followingState: 'active'
  })
  expect(run.jobs().map((job) => job.kind)).toEqual(['collection.creator_works'])
  const report = verifiedReport()
  run.acceptReport(report)
  run.acceptReport(report)
  expect(run.database.getSummary().workCount).toBe(1)
  expect(run.database.db.prepare('SELECT status FROM verified_collection_checkpoints').get()).toEqual({ status: 'scope-limited' })
  expect(Number(run.database.db.prepare('SELECT COUNT(*) AS n FROM isolated_pilot_sources').get()!.n)).toBe(1)
  const ownerId = Number(run.database.db.prepare("SELECT id FROM owner_accounts WHERE local_label='我的抖音'").get()!.id)
  run.directory.finishRefresh(ownerId, 'separate-refresh', [], { complete: false, failed: true })
  expect(run.database.getSummary().workCount).toBe(1)
  expect(run.jobs().find((job) => job.kind === 'collection.creator_works')).toMatchObject({ state: 'completed' })
  expect(run.jobs().find((job) => job.kind === 'collection.following')).toBeUndefined()
  expect(Number(run.database.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='collection.work_comments' OR kind LIKE 'media.%' OR kind LIKE 'cloud.%'").get()!.n)).toBe(0)
  expect(run.database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('rejects wrong-author and incomplete proofs before any work is saved', () => {
  run = new IsolatedSyncRun(':memory:', 'test-run', 'owner-sec', {
    uid: 'uid-a', secUid: 'sec-a', nickname: '甲', profileUrl: 'https://www.douyin.com/user/sec-a', followingState: 'active'
  })
  const forged = verifiedReport() as { result: { verifiedWork: { authorSecId: string }; detailProof: unknown } }
  forged.result.verifiedWork.authorSecId = 'wrong-sec'
  expect(() => run!.acceptReport(forged)).toThrow()
  forged.result.verifiedWork.authorSecId = 'sec-a'
  forged.result.detailProof = null
  expect(() => run!.acceptReport(forged)).toThrow()
  expect(run.database.getSummary().workCount).toBe(0)
})

it('rolls back work and checkpoint when source-proof persistence fails', () => {
  run = new IsolatedSyncRun(':memory:', 'test-run', 'owner-sec', {
    uid: 'uid-a', secUid: 'sec-a', nickname: '甲', profileUrl: 'https://www.douyin.com/user/sec-a', followingState: 'active'
  })
  run.database.db.exec('DROP TABLE isolated_pilot_sources')
  expect(() => run!.acceptReport(verifiedReport())).toThrow(/isolated_pilot_sources/)
  expect(run.database.getSummary().workCount).toBe(0)
  expect(Number(run.database.db.prepare('SELECT COUNT(*) AS n FROM collection_checkpoints').get()!.n)).toBe(0)
  expect(run.jobs().find((job) => job.kind === 'collection.creator_works')).toMatchObject({ state: 'running' })
})
