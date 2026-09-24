import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { migrateDatabase } from './schema'
import { applyFollowingSchemaV6Draft } from '../../poc/r8/following-schema-v6-draft.mjs'

let database: DatabaseSync | null = null
afterEach(() => { database?.close(); database = null })

it('draft v6 preserves unverified historical authors and requires explicit owner and identity binding', () => {
  database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const db = database
  const at = '2026-09-24T00:00:00.000Z'
  expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(5)
  db.prepare(`INSERT INTO creators(platform,platform_creator_id,nickname,profile_url,discovered_at,updated_at)
    VALUES('douyin','legacy-uid','历史作者','https://www.douyin.com/user/unknown-route',?,?)`).run(at,at)
  const oldId = Number((db.prepare('SELECT id FROM creators WHERE platform_creator_id=?').get('legacy-uid') as { id: number }).id)
  const jobsBefore = db.prepare('SELECT id,kind,state FROM jobs ORDER BY id').all()

  applyFollowingSchemaV6Draft(db)
  expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(6)
  expect(db.prepare('SELECT sec_uid,identity_verified_at FROM creators WHERE id=?').get(oldId))
    .toEqual({ sec_uid: null, identity_verified_at: null })
  expect(db.prepare('SELECT count(*) AS n FROM creator_owner_relationships').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT id,kind,state FROM jobs ORDER BY id').all()).toEqual(jobsBefore)

  const owner1 = Number((db.prepare("SELECT id FROM owner_accounts WHERE platform='douyin' LIMIT 1").get() as { id: number }).id)
  db.prepare('UPDATE owner_accounts SET platform_sec_uid=?,identity_verified_at=?,identity_source=? WHERE id=?')
    .run('owner-sec-1',at,'browser-following-route',owner1)
  db.prepare('INSERT INTO owner_accounts(platform,local_label,platform_sec_uid,identity_verified_at,identity_source,created_at) VALUES(?,?,?,?,?,?)')
    .run('douyin','第二账号','owner-sec-2',at,'browser-following-route',at)
  const owner2 = Number((db.prepare("SELECT id FROM owner_accounts WHERE local_label='第二账号'").get() as { id: number }).id)
  db.prepare(`INSERT INTO creators(platform,platform_creator_id,sec_uid,identity_verified_at,identity_source,
    nickname,profile_url,discovered_at,updated_at) VALUES('douyin','real-uid','real-sec',?,
    'following-list-structured-response','新作者','https://www.douyin.com/user/real-sec',?,?)`).run(at,at,at)
  const creatorId = Number((db.prepare('SELECT id FROM creators WHERE platform_creator_id=?').get('real-uid') as { id: number }).id)
  db.prepare(`INSERT INTO creator_owner_relationships(owner_account_id,creator_id,following_state,
    first_discovered_at,following_verified_at) VALUES(?,?,'active',?,?)`).run(owner1,creatorId,at,at)
  expect(db.prepare('SELECT count(*) AS n FROM creator_owner_relationships WHERE owner_account_id=?').get(owner2)).toEqual({ n: 0 })
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  expect(() => applyFollowingSchemaV6Draft(db)).toThrow(/schema-v5/)
})
