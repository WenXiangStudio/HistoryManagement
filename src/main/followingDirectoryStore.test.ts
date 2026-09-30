import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FollowingDirectoryStore } from './followingDirectoryStore'
import type { FollowingDirectoryReport } from '../shared/followingDirectory'

const stores: FollowingDirectoryStore[] = []
const directories: string[] = []
afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})
function store(path = ':memory:'): FollowingDirectoryStore { const value = new FollowingDirectoryStore(path); stores.push(value); return value }
function report(runId = 'real-run', ownerSecUid = 'owner-a'): FollowingDirectoryReport {
  const creators = Array.from({ length: 10 }, (_, index) => ({ uid: `uid-${index}`, secUid: `sec-${index}`,
    nickname: `博主${index}`, avatarUrl: `https://example.com/avatar-${index}.jpg`, signature: '简介',
    profileUrl: `https://www.douyin.com/user/sec-${index}` }))
  return { contract: 'signaldesk-following-directory/v1', runId, collectedAt: '2026-09-30T00:00:00.000Z',
    ownerSecUid, sourceUrl: 'https://www.douyin.com/user/self', endpointPath: '/aweme/v1/web/user/following/list/',
    firstPage: true, activeFollowingTab: true, hasMore: true, responseItemCount: 20, creators,
    projectionSha256: createHash('sha256').update(JSON.stringify(creators)).digest('hex'),
    activeApiRequests: 0, workResponseBodiesRead: 0 }
}
function visibleReport(runId = 'visible-run'): Extract<FollowingDirectoryReport, { contract: 'signaldesk-visible-following/v1' }> {
  const creators = report().creators.map((creator) => ({ ...creator, uid: null }))
  return {
    contract: 'signaldesk-visible-following/v1', runId, collectedAt: '2026-09-30T02:00:00.000Z',
    ownerSecUid: null, ownerNickname: '当前账号', sourceUrl: 'https://www.douyin.com/user/self',
    sourceKind: 'visible-following-list', activeFollowingTab: true, listStartedAtTop: true,
    hasMore: true, visibleItemCount: 10, creators,
    projectionSha256: createHash('sha256').update(JSON.stringify(creators)).digest('hex'),
    activeApiRequests: 0, workResponseBodiesRead: 0
  }
}
describe('independent account following directory', () => {
  it('persists ten ordered public profiles and creates no works or comments storage', () => {
    const directory = store(); const input = report(); directory.accept(input); directory.accept(input)
    expect(directory.list()).toHaveLength(10)
    expect(directory.list()[0]).toMatchObject({ nickname: '博主0', avatarUrl: input.creators[0].avatarUrl,
      profileUrl: input.creators[0].profileUrl, workCount: 0 })
    const tables = directory.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name)
    expect(tables).toEqual(['directory_runs','directory_creators','visible_directory_runs','visible_directory_creators'])
    expect(directory.db.prepare('SELECT status FROM directory_runs').get()?.status).toBe('scope-limited')
  })
  it('rejects work fields, incorrect profile binding, altered hashes and replays with changed content', () => {
    const directory = store(); const input = report();
    expect(() => directory.accept({ ...input, works: [] })).toThrow()
    expect(() => directory.accept({ ...input, workResponseBodiesRead: 1 })).toThrow()
    expect(() => directory.accept({ ...input, projectionSha256: '0'.repeat(64) })).toThrow(/hash/)
    expect(() => directory.accept({ ...input, creators: [{ ...input.creators[0], profileUrl: 'https://www.douyin.com/video/123' }] })).toThrow()
    directory.accept(input)
    expect(() => directory.accept({ ...input, collectedAt: '2026-09-30T01:00:00.000Z' })).toThrow(/不同报告/)
  })
  it('isolates current accounts and preserves local notes when a saved author is refreshed', () => {
    const directory = store(); directory.accept(report())
    directory.update(directory.list()[0].id, { isStarred: true, note: '我的批注' })
    directory.accept(report('second-run'))
    expect(directory.list()[0]).toMatchObject({ isStarred: true, note: '我的批注' })
    directory.accept(report('other-account', 'owner-b'))
    expect(directory.list()).toHaveLength(10)
    expect(directory.list()[0]).toMatchObject({ isStarred: false, note: '' })
    expect(directory.db.prepare('SELECT count(*) AS n FROM directory_creators').get()?.n).toBe(20)
  })
  it('persists visible profiles with each avatar and homepage still bound after reopening SQLite', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'signal-desk-visible-directory-'))
    directories.push(tempDirectory)
    const path = join(tempDirectory, 'following.sqlite')
    const directory = new FollowingDirectoryStore(path)
    const input = visibleReport()
    // Deliberately store a different display order; links and avatars must travel with the author.
    input.creators = [...input.creators].reverse()
    input.projectionSha256 = createHash('sha256').update(JSON.stringify(input.creators)).digest('hex')
    try { directory.accept(input) } finally { directory.close() }
    const reopened = store(path)
    expect(reopened.list().map(({ nickname, avatarUrl, profileUrl }) => ({ nickname, avatarUrl, profileUrl })))
      .toEqual(input.creators.map(({ nickname, avatarUrl, profileUrl }) => ({ nickname, avatarUrl, profileUrl })))
    expect(reopened.latest()).toMatchObject({ runId: input.runId, ownerSecUid: null, visible: true })
    expect(reopened.list().every((creator) => creator.platformCreatorId.startsWith('profile:') && creator.workCount === 0)).toBe(true)
    expect(reopened.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('reads the latest visible run without inventing native IDs or carrying another run notes', () => {
    const directory = store()
    directory.accept(report())
    const first = visibleReport()
    directory.accept(first)
    directory.accept(first)
    expect(directory.list()).toHaveLength(10)
    const creator = directory.list()[0]
    directory.update(creator.id, { note: '头像已核对', isStarred: true })
    expect(directory.list('头像已核对')).toEqual([expect.objectContaining({
      nickname: creator.nickname, avatarUrl: first.creators[0].avatarUrl, profileUrl: first.creators[0].profileUrl,
      note: '头像已核对', isStarred: true
    })])
    const second = { ...visibleReport('another-visible-run'), ownerNickname: '另一次页面账号', collectedAt: '2026-09-30T03:00:00.000Z' }
    directory.accept(second)
    expect(directory.latest()?.runId).toBe(second.runId)
    expect(directory.list()).toHaveLength(10)
    expect(directory.list()[0]).toMatchObject({ note: '', isStarred: false })
    expect(() => directory.update(creator.id, { note: '旧记录不应改动新目录' })).toThrow(/当前账号目录/)
    expect(directory.db.prepare('SELECT count(*) AS n FROM visible_directory_creators').get()?.n).toBe(20)
  })
  it('rejects mismatched visible profiles and altered avatars without changing saved rows', () => {
    const directory = store()
    const input = visibleReport()
    directory.accept(input)
    const saved = directory.list()
    const other = visibleReport('invalid-visible-run')
    expect(() => directory.accept({ ...other, creators: other.creators.map((creator, index) => index === 0
      ? { ...creator, profileUrl: other.creators[1].profileUrl } : creator) })).toThrow()
    expect(() => directory.accept({ ...other, creators: other.creators.map((creator, index) => index === 0
      ? { ...creator, avatarUrl: 'https://example.com/altered-avatar.jpg' } : creator) })).toThrow(/hash/)
    expect(() => directory.accept({ ...input, ownerNickname: '更改同一报告' })).toThrow(/不同报告/)
    expect(directory.list()).toEqual(saved)
    expect(directory.db.prepare('SELECT count(*) AS n FROM visible_directory_runs').get()?.n).toBe(1)
  })
})
