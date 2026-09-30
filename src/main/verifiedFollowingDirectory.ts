import type { DatabaseSync } from 'node:sqlite'

const ID = /^[A-Za-z0-9._-]{1,240}$/
export type FollowingState = 'active' | 'stale' | 'unfollowed' | 'identity_conflict'
export type VerifiedAuthor = { uid: string; secUid: string; profileUrl: string;
  nickname: string; followingState: 'active' | 'stale'; followingVerifiedAt: string }
export type CreatorWorksTask = { kind: 'creator.works.sync'; targetUid: string;
  targetSecUid: string; priority: number }
export type FollowingRefreshTask = { kind: 'following.refresh'; targetUid: null;
  targetSecUid: null; priority: number }

function requiredId(value: string, label: string): string {
  if (!ID.test(value)) throw new Error(`${label} 无效`)
  return value
}
function requiredTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('时间无效')
  return value
}
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}

/** Repository for the v6 review schema. It is deliberately never opened by the v5 app. */
export class VerifiedFollowingDirectory {
  constructor(private readonly db: DatabaseSync) {
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (version !== 6) throw new Error('已验证关注目录需要隔离 schema v6')
  }

  bindOwner(ownerId: number, secUid: string, verifiedAt: string): void {
    requiredId(secUid, 'owner sec_uid')
    requiredTime(verifiedAt)
    const row = this.db.prepare("SELECT platform,platform_sec_uid FROM owner_accounts WHERE id=?").get(ownerId) as {
      platform: string; platform_sec_uid: string | null
    } | undefined
    if (!row || row.platform !== 'douyin' || (row.platform_sec_uid && row.platform_sec_uid !== secUid)) {
      throw new Error('OWNER_IDENTITY_CHANGED')
    }
    this.db.prepare(`UPDATE owner_accounts SET platform_sec_uid=?,identity_verified_at=?,
      identity_source='browser-following-route' WHERE id=?`).run(secUid, verifiedAt, ownerId)
  }

  private requireOwner(ownerId: number): string {
    const row = this.db.prepare('SELECT platform_sec_uid FROM owner_accounts WHERE id=? AND platform=?').get(ownerId, 'douyin') as {
      platform_sec_uid: string | null
    } | undefined
    if (!row?.platform_sec_uid || !ID.test(row.platform_sec_uid)) throw new Error('OWNER_IDENTITY_UNVERIFIED')
    return row.platform_sec_uid
  }

  upsertFollowing(ownerId: number, author: { uid: string; secUid: string;
    nickname: string; isFollowing: boolean }, verifiedAt: string): { status: FollowingState; creatorId: number | null } {
    this.requireOwner(ownerId)
    const uid = requiredId(author.uid, '作者 uid')
    const secUid = requiredId(author.secUid, '作者 sec_uid')
    requiredTime(verifiedAt)
    if (author.isFollowing !== true || !author.nickname?.trim()) throw new Error('关注关系未验证')
    const nickname = author.nickname.trim().slice(0, 200)
    const profileUrl = `https://www.douyin.com/user/${encodeURIComponent(secUid)}`
    return transaction(this.db, () => {
      const matches = this.db.prepare(`SELECT id,platform_creator_id,sec_uid FROM creators
        WHERE platform='douyin' AND (platform_creator_id=? OR sec_uid=?)`).all(uid, secUid) as Array<{
          id: number; platform_creator_id: string; sec_uid: string | null
        }>
      const conflict = matches.some((row) => row.platform_creator_id !== uid
        || (row.sec_uid !== null && row.sec_uid !== secUid)) || matches.length > 1
      if (conflict) {
        for (const row of matches) {
          this.db.prepare(`INSERT INTO creator_owner_relationships(owner_account_id,creator_id,
            following_state,first_discovered_at,following_verified_at)
            VALUES(?,?,'identity_conflict',?,?) ON CONFLICT(owner_account_id,creator_id)
            DO UPDATE SET following_state='identity_conflict'`).run(ownerId, row.id, verifiedAt, verifiedAt)
        }
        return { status: 'identity_conflict', creatorId: null }
      }
      this.db.prepare(`INSERT INTO creators(platform,platform_creator_id,sec_uid,identity_verified_at,
        identity_source,nickname,profile_url,discovered_at,updated_at)
        VALUES('douyin',?,?,?,'following-list-structured-response',?,?,?,?)
        ON CONFLICT(platform,platform_creator_id) DO UPDATE SET
          sec_uid=excluded.sec_uid,identity_verified_at=excluded.identity_verified_at,
          identity_source=excluded.identity_source,nickname=excluded.nickname,
          profile_url=excluded.profile_url,updated_at=excluded.updated_at`).run(
        uid, secUid, verifiedAt, nickname, profileUrl, verifiedAt, verifiedAt)
      const creator = this.db.prepare("SELECT id FROM creators WHERE platform='douyin' AND platform_creator_id=?").get(uid) as { id: number }
      this.db.prepare(`INSERT INTO creator_owner_relationships(owner_account_id,creator_id,
        following_state,first_discovered_at,following_verified_at)
        VALUES(?,?,'active',?,?) ON CONFLICT(owner_account_id,creator_id) DO UPDATE SET
          following_state='active',following_verified_at=excluded.following_verified_at`).run(
        ownerId, creator.id, verifiedAt, verifiedAt)
      return { status: 'active', creatorId: creator.id }
    })
  }

  finishRefresh(ownerId: number, refreshId: string, seenUids: string[],
    outcome: { complete: boolean; failed?: boolean; scopeLimited?: boolean }): {
      status: 'complete' | 'partial'; unfollowed: number
    } {
    this.requireOwner(ownerId)
    requiredId(refreshId, '刷新 ID')
    if (!Array.isArray(seenUids) || seenUids.some((uid) => !ID.test(uid))
      || new Set(seenUids).size !== seenUids.length) throw new Error('关注快照 ID 无效')
    return transaction(this.db, () => {
      if (!outcome.complete || outcome.failed || outcome.scopeLimited) {
        const seen = new Set(seenUids)
        const active = this.db.prepare(`SELECT r.creator_id,c.platform_creator_id AS uid
          FROM creator_owner_relationships r JOIN creators c ON c.id=r.creator_id
          WHERE r.owner_account_id=? AND r.following_state='active'`).all(ownerId) as Array<{
            creator_id: number; uid: string
          }>
        for (const row of active) {
          if (!seen.has(row.uid)) this.db.prepare(`UPDATE creator_owner_relationships
            SET following_state='stale' WHERE owner_account_id=? AND creator_id=?`).run(ownerId, row.creator_id)
        }
        return { status: 'partial', unfollowed: 0 }
      }
      const rows = this.db.prepare(`SELECT r.creator_id,c.platform_creator_id AS uid
        FROM creator_owner_relationships r JOIN creators c ON c.id=r.creator_id
        WHERE r.owner_account_id=? AND r.following_state IN ('active','stale')`).all(ownerId) as Array<{
          creator_id: number; uid: string
        }>
      const known = new Set(rows.map((row) => row.uid))
      if (seenUids.some((uid) => !known.has(uid))) throw new Error('完整快照包含未验证的作者')
      const seen = new Set(seenUids)
      let unfollowed = 0
      for (const row of rows) {
        if (seen.has(row.uid)) {
          this.db.prepare(`UPDATE creator_owner_relationships SET following_state='active',
            last_complete_refresh_id=? WHERE owner_account_id=? AND creator_id=?`).run(
            refreshId, ownerId, row.creator_id)
        } else {
          this.db.prepare(`UPDATE creator_owner_relationships SET following_state='unfollowed',
            last_complete_refresh_id=? WHERE owner_account_id=? AND creator_id=?`).run(
            refreshId, ownerId, row.creator_id)
          unfollowed += 1
        }
      }
      return { status: 'complete', unfollowed }
    })
  }

  syncableAuthors(ownerId: number): VerifiedAuthor[] {
    this.requireOwner(ownerId)
    const rows = this.db.prepare(`SELECT c.platform_creator_id AS uid,c.sec_uid AS secUid,
      c.profile_url AS profileUrl,c.nickname,r.following_state AS followingState,
      r.following_verified_at AS followingVerifiedAt FROM creator_owner_relationships r
      JOIN creators c ON c.id=r.creator_id WHERE r.owner_account_id=?
      AND r.following_state IN ('active','stale') AND c.sec_uid IS NOT NULL
      AND c.identity_verified_at IS NOT NULL ORDER BY
      CASE r.following_state WHEN 'active' THEN 0 ELSE 1 END,c.id`).all(ownerId) as VerifiedAuthor[]
    return rows.filter((row) => row.profileUrl === `https://www.douyin.com/user/${encodeURIComponent(row.secUid)}`)
  }

  planCreatorWorksSync(ownerId: number, creatorLimit: number): CreatorWorksTask[] {
    if (!Number.isSafeInteger(creatorLimit) || creatorLimit < 1 || creatorLimit > 5) {
      throw new Error('作者上限必须是 1～5')
    }
    const authors = this.syncableAuthors(ownerId).slice(0, creatorLimit)
    return authors.map((author) => ({ kind: 'creator.works.sync', targetUid: author.uid,
      targetSecUid: author.secUid, priority: 10 }))
  }

  planFollowingRefresh(ownerId: number): FollowingRefreshTask {
    this.requireOwner(ownerId)
    return { kind: 'following.refresh', targetUid: null, targetSecUid: null, priority: 10 }
  }
}
