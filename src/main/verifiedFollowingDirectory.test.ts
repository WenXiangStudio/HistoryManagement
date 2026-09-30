import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { migrateDatabase } from './schema'
import { applyFollowingSchemaV6Draft } from '../../poc/r8/following-schema-v6-draft.mjs'
import { VerifiedFollowingDirectory } from './verifiedFollowingDirectory'

let db: DatabaseSync | null = null
afterEach(() => { db?.close(); db = null })

it('plans saved authors before refresh and preserves their results after a partial refresh', () => {
  db = new DatabaseSync(':memory:')
  migrateDatabase(db)
  expect(() => new VerifiedFollowingDirectory(db!)).toThrow(/schema v6/)
  const at = '2026-09-29T00:00:00.000Z'
  db.prepare(`INSERT INTO creators(platform,platform_creator_id,nickname,profile_url,discovered_at,updated_at)
    VALUES('douyin','legacy-uid','历史作者','https://www.douyin.com/user/unknown',?,?)`).run(at, at)
  const legacyId = Number((db.prepare("SELECT id FROM creators WHERE platform_creator_id='legacy-uid'").get() as { id: number }).id)
  applyFollowingSchemaV6Draft(db)
  const directory = new VerifiedFollowingDirectory(db)
  const owner1 = Number((db.prepare("SELECT id FROM owner_accounts WHERE local_label='我的抖音'").get() as { id: number }).id)
  db.prepare("INSERT INTO owner_accounts(platform,local_label,created_at) VALUES('douyin','第二账号',?)").run(at)
  const owner2 = Number((db.prepare("SELECT id FROM owner_accounts WHERE local_label='第二账号'").get() as { id: number }).id)
  directory.bindOwner(owner1, 'owner-sec-1', at)
  directory.bindOwner(owner2, 'owner-sec-2', at)
  expect(() => directory.bindOwner(owner1, 'owner-sec-2', at)).toThrow(/OWNER_IDENTITY_CHANGED/)
  expect(directory.planCreatorWorksSync(owner1, 2)).toEqual([])
  expect(directory.planFollowingRefresh(owner1)).toEqual({
    kind: 'following.refresh', targetUid: null, targetSecUid: null, priority: 10
  })
  expect(directory.upsertFollowing(owner1, { uid: 'legacy-uid', secUid: 'verified-sec',
    nickname: '历史作者', isFollowing: true }, at)).toMatchObject({ status: 'active', creatorId: legacyId })
  directory.upsertFollowing(owner1, { uid: 'new-uid', secUid: 'new-sec', nickname: '新作者', isFollowing: true }, at)
  expect(directory.syncableAuthors(owner2)).toEqual([])
  expect(directory.planCreatorWorksSync(owner1, 2)).toEqual([
    { kind: 'creator.works.sync', targetUid: 'legacy-uid', targetSecUid: 'verified-sec', priority: 10 },
    { kind: 'creator.works.sync', targetUid: 'new-uid', targetSecUid: 'new-sec', priority: 10 }
  ])
  const partial = directory.finishRefresh(owner1, 'partial-run', ['legacy-uid'], { complete: false, failed: true })
  expect(partial).toEqual({ status: 'partial', unfollowed: 0 })
  expect(directory.syncableAuthors(owner1).map((author) => author.followingState)).toEqual(['active', 'stale'])
  expect(directory.planCreatorWorksSync(owner1, 2)).toHaveLength(2)
  expect(db.prepare('SELECT sec_uid,identity_verified_at FROM creators WHERE id=?').get(legacyId)).toMatchObject({
    sec_uid: 'verified-sec', identity_verified_at: at
  })
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('updates unfollowed only after a complete owner-scoped snapshot and isolates identity conflicts', () => {
  db = new DatabaseSync(':memory:')
  migrateDatabase(db)
  applyFollowingSchemaV6Draft(db)
  const directory = new VerifiedFollowingDirectory(db)
  const at = '2026-09-29T00:00:00.000Z'
  const owner = Number((db.prepare("SELECT id FROM owner_accounts WHERE local_label='我的抖音'").get() as { id: number }).id)
  directory.bindOwner(owner, 'owner-sec', at)
  directory.upsertFollowing(owner, { uid: 'uid-a', secUid: 'sec-a', nickname: '甲', isFollowing: true }, at)
  directory.upsertFollowing(owner, { uid: 'uid-b', secUid: 'sec-b', nickname: '乙', isFollowing: true }, at)
  expect(() => directory.finishRefresh(owner, 'bad-complete', ['unknown'], { complete: true })).toThrow(/未验证/)
  expect(directory.finishRefresh(owner, 'full-run', ['uid-a'], { complete: true })).toEqual({ status: 'complete', unfollowed: 1 })
  expect(directory.syncableAuthors(owner).map((author) => author.uid)).toEqual(['uid-a'])
  expect(db.prepare(`SELECT following_state FROM creator_owner_relationships r JOIN creators c
    ON c.id=r.creator_id WHERE r.owner_account_id=? AND c.platform_creator_id='uid-b'`).get(owner)).toEqual({ following_state: 'unfollowed' })
  expect(directory.upsertFollowing(owner, { uid: 'uid-a', secUid: 'changed-sec',
    nickname: '甲', isFollowing: true }, at).status).toBe('identity_conflict')
  expect(directory.syncableAuthors(owner)).toEqual([])
  expect(db.prepare("SELECT sec_uid FROM creators WHERE platform_creator_id='uid-a'").get()).toEqual({ sec_uid: 'sec-a' })
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
