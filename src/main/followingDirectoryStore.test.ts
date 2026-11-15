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
function report(runId = 'real-run', ownerSecUid = 'owner-a'): Extract<FollowingDirectoryReport, { contract: 'signaldesk-following-directory/v1' }> {
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
function rehash<T extends FollowingDirectoryReport>(input: T): T {
  input.projectionSha256 = createHash('sha256').update(JSON.stringify(input.creators)).digest('hex')
  return input
}
describe('independent account following directory', () => {
  it('reads one identity with the same retained ID, latest public fields and original annotations as the full directory',()=>{
    const directory=store(),owner={uid:'owner-uid',secUid:'owner',nickname:'当前账号'}
    directory.recordAccount(owner);directory.selectAccount(owner.secUid)
    const creators=report().creators
    directory.savePlanRows('first',owner,'2026-10-01T00:00:00Z',creators)
    const first=directory.list()[3]
    directory.update(first.id,{isStarred:true,note:'保留原始批注'})
    directory.savePlanRows('second',owner,'2026-10-02T00:00:00Z',[{...creators[3],nickname:'最新昵称'}])
    directory.savePlanRows('empty',owner,'2026-10-03T00:00:00Z',[])
    const expected=directory.list().filter(c=>c.profileUrl===first.profileUrl)
    expect(directory.list('','sec-3')).toEqual(expected)
    expect(directory.list('最新昵称','sec-3')).toEqual(expected)
    expect(directory.list('不匹配','sec-3')).toEqual([])
    expect(directory.list('','foreign')).toEqual([])
    expect(expected[0]).toMatchObject({id:first.id,nickname:'最新昵称',isStarred:true,note:'保留原始批注'})
    expect(directory.list()).toHaveLength(10)
    const legacy=store();legacy.accept(report())
    expect(legacy.list('','sec-3')).toEqual([legacy.list()[3]])
  })
  it('persists ten ordered public profiles and creates no works or comments storage', () => {
    const directory = store(); const input = report(); directory.accept(input); directory.accept(input)
    expect(directory.list()).toHaveLength(10)
    expect(directory.list()[0]).toMatchObject({ nickname: '博主0', avatarUrl: input.creators[0].avatarUrl,
      profileUrl: input.creators[0].profileUrl, workCount: 0 })
    const tables = directory.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name)
    expect(tables).toEqual(['directory_runs','directory_creators','visible_directory_runs','visible_directory_creators','following_account_owners'])
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
  it('keeps all previously saved verified authors when later batches are partial or empty', () => {
    const directory = store()
    const first = report()
    directory.accept(first)
    const original = directory.list()[0]
    directory.update(original.id, { isStarred: true, note: '原有博主批注' })
    const second = report('new-network-batch')
    second.collectedAt = '2026-10-01T00:00:00.000Z'
    second.creators = [{ ...second.creators[0], uid:'new-uid', secUid:'new-sec', nickname:'新博主',
      profileUrl:'https://www.douyin.com/user/new-sec' }]
    second.responseItemCount = 1
    directory.accept(rehash(second))
    expect(directory.list()).toHaveLength(11)
    expect(directory.list().find(item=>item.id===original.id)).toMatchObject({ isStarred:true,note:'原有博主批注' })
    const empty = report('empty-network-batch')
    empty.collectedAt = '2026-10-01T01:00:00.000Z'
    empty.creators = []; empty.responseItemCount = 0; empty.hasMore = false
    directory.accept(rehash(empty))
    expect(directory.list()).toHaveLength(11)
    expect(directory.list('新博主')).toHaveLength(1)
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
  it('isolates visible account labels without inventing native IDs or carrying another account notes', () => {
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
  it('accumulates two distinct visible batches and retains authors and annotations across refresh and restart', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'signal-desk-retained-directory-'))
    directories.push(tempDirectory)
    const path = join(tempDirectory, 'following.sqlite')
    const directory = new FollowingDirectoryStore(path)
    let originalId = 0
    try {
      const first = visibleReport('first-batch')
      directory.accept(first)
      const firstRows = directory.db.prepare('SELECT * FROM visible_directory_creators ORDER BY id').all()
      originalId = directory.list()[0].id
      directory.update(originalId, { isStarred:true,note:'第一批批注' })
      const second = visibleReport('second-batch')
      second.collectedAt = '2026-10-01T00:00:00.000Z'
      second.creators = second.creators.map((item,index)=>({ ...item,secUid:`second-sec-${index}`,
        nickname:`新增博主${index}`,profileUrl:`https://www.douyin.com/user/second-sec-${index}` }))
      directory.accept(rehash(second))
      expect(directory.list()).toHaveLength(20)
      expect(directory.list().map(item=>item.profileUrl)).toEqual([...first.creators,...second.creators].map(item=>item.profileUrl))
      // Public fields on the first batch are untouched by an unrelated batch.
      expect(directory.db.prepare('SELECT * FROM visible_directory_creators WHERE run_id=? ORDER BY id').all(first.runId)
        .map(({is_starred,user_note,...item})=>item)).toEqual(firstRows.map(({is_starred,user_note,...item})=>item))
      expect(directory.list('第一批批注')).toEqual([expect.objectContaining({id:originalId,isStarred:true,note:'第一批批注'})])
      const refreshed = visibleReport('refresh-known-author')
      refreshed.collectedAt = '2026-10-01T01:00:00.000Z'
      refreshed.creators = [{ ...first.creators[0],nickname:'更新后的昵称',avatarUrl:'https://example.com/refreshed.jpg',signature:'新的简介' }]
      refreshed.visibleItemCount = 1
      directory.accept(rehash(refreshed))
      expect(directory.list()).toHaveLength(20)
      expect(directory.list().find(item=>item.id===originalId)).toMatchObject({
        nickname:'更新后的昵称',avatarUrl:'https://example.com/refreshed.jpg',signature:'新的简介',
        profileUrl:first.creators[0].profileUrl,isStarred:true,note:'第一批批注'
      })
      directory.update(originalId, { note:'更新批注',isStarred:false })
      const empty = visibleReport('empty-visible-batch')
      empty.collectedAt = '2026-10-01T02:00:00.000Z'; empty.creators = []; empty.visibleItemCount = 0
      directory.accept(rehash(empty))
      expect(directory.list()).toHaveLength(20)
    } finally { directory.close() }
    const reopened = store(path)
    expect(reopened.list()).toHaveLength(20)
    expect(new Set(reopened.list().map(item=>item.profileUrl)).size).toBe(20)
    expect(reopened.list('更新批注')).toEqual([expect.objectContaining({id:originalId,isStarred:false,note:'更新批注'})])
    expect(reopened.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('accepts a twenty-author visible batch without admitting twenty-one or removing prior authors', () => {
    const directory=store()
    directory.accept(visibleReport('existing-ten'))
    const input=visibleReport('twenty-new')
    input.collectedAt='2026-10-01T00:00:00.000Z'
    input.creators=Array.from({length:20},(_,index)=>({ ...input.creators[0],secUid:`third-sec-${index}`,
      nickname:`第三批博主${index}`,profileUrl:`https://www.douyin.com/user/third-sec-${index}` }))
    input.visibleItemCount=20
    directory.accept(rehash(input))
    expect(directory.list()).toHaveLength(30)
    expect(directory.db.prepare('SELECT status FROM visible_directory_runs WHERE run_id=?').get(input.runId)?.status).toBe('scope-limited')
    const extra={...input,runId:'too-many',creators:[...input.creators,{...input.creators[0],secUid:'extra-sec',profileUrl:'https://www.douyin.com/user/extra-sec'}]}
    expect(()=>directory.accept(rehash(extra))).toThrow()
    expect(directory.list()).toHaveLength(30)
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
