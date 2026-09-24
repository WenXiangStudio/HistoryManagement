import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { relative, isAbsolute } from 'node:path'

const PUBLIC_ID = /^[A-Za-z0-9._-]{1,240}$/
const CATALOG_APPLICATION_ID = 0x53445238

function assertId(value, label) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value)) throw new Error(`${label} invalid`)
  return value
}
function assertTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('catalog time invalid')
  return value
}
function profileUrl(secUid) { return `https://www.douyin.com/user/${encodeURIComponent(secUid)}` }

export class VerifiedCreatorCatalog {
  constructor(path) {
    const fullPath = resolve(path)
    const withinTemp = relative(resolve(tmpdir()), fullPath)
    if (!withinTemp || withinTemp.startsWith('..') || isAbsolute(withinTemp)) {
      throw new Error('isolated catalog must stay under the system temporary directory')
    }
    this.db = new DatabaseSync(fullPath)
    const applicationId = Number(this.db.prepare('PRAGMA application_id').get().application_id)
    if (applicationId !== 0 && applicationId !== CATALOG_APPLICATION_ID) {
      this.db.close()
      throw new Error('catalog file belongs to another application')
    }
    this.db.exec(`PRAGMA application_id=${CATALOG_APPLICATION_ID}; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS owners (
        sec_uid TEXT PRIMARY KEY, verified_at TEXT NOT NULL, source TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS creators (
        id INTEGER PRIMARY KEY, owner_sec_uid TEXT NOT NULL REFERENCES owners(sec_uid),
        uid TEXT NOT NULL, sec_uid TEXT NOT NULL, profile_url TEXT NOT NULL,
        nickname TEXT NOT NULL, first_discovered_at TEXT NOT NULL,
        identity_verified_at TEXT NOT NULL, identity_source TEXT NOT NULL,
        following_verified_at TEXT NOT NULL, following_state TEXT NOT NULL
          CHECK(following_state IN ('active','stale','unfollowed','identity_conflict')),
        last_complete_refresh_id TEXT,
        UNIQUE(owner_sec_uid, uid), UNIQUE(owner_sec_uid, sec_uid)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_creators (
        legacy_key TEXT PRIMARY KEY, platform_creator_id TEXT NOT NULL,
        profile_url TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT 'pending'
      ) STRICT;
      CREATE TABLE IF NOT EXISTS checkpoints (
        owner_sec_uid TEXT NOT NULL, target_kind TEXT NOT NULL,
        native_id TEXT NOT NULL, sec_uid TEXT, adapter_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('complete','scope-limited','partial','blocked')),
        cursor_field TEXT, cursor_value_category TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(owner_sec_uid,target_kind,native_id,adapter_version)
      ) STRICT;`)
  }

  close() { this.db.close() }
  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = operation(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  bindOwner(ownerSecUid, verifiedAt, source = 'browser-following-route') {
    assertId(ownerSecUid, 'owner sec_uid')
    assertTime(verifiedAt)
    if (source !== 'browser-following-route') throw new Error('owner source unverified')
    const existing = this.db.prepare('SELECT sec_uid FROM owners LIMIT 1').get()
    if (existing && existing.sec_uid !== ownerSecUid) throw new Error('OWNER_IDENTITY_CHANGED')
    this.db.prepare('INSERT INTO owners(sec_uid,verified_at,source) VALUES(?,?,?) ON CONFLICT(sec_uid) DO UPDATE SET verified_at=excluded.verified_at').run(ownerSecUid, verifiedAt, source)
  }
  ownerSecUid() { return this.db.prepare('SELECT sec_uid FROM owners LIMIT 1').get()?.sec_uid ?? null }
  importLegacy(rows) {
    if (!Array.isArray(rows)) throw new Error('legacy rows invalid')
    return this.transaction(() => {
      for (const row of rows) {
        assertId(row.legacyKey, 'legacy key')
        assertId(row.platformCreatorId, 'legacy platform creator ID')
        const url = new URL(row.profileUrl)
        if (url.origin !== 'https://www.douyin.com' || !/^\/user\/[^/]+$/.test(url.pathname)) throw new Error('legacy profile invalid')
        this.db.prepare('INSERT OR IGNORE INTO legacy_creators(legacy_key,platform_creator_id,profile_url) VALUES(?,?,?)')
          .run(row.legacyKey, row.platformCreatorId, url.toString())
      }
    })
  }
  upsertFollowing(ownerSecUid, creator, verifiedAt) {
    if (this.ownerSecUid() !== ownerSecUid) throw new Error('OWNER_IDENTITY_CHANGED')
    const uid = assertId(creator?.uid, 'creator uid')
    const secUid = assertId(creator?.secUid, 'creator sec_uid')
    assertTime(verifiedAt)
    if (creator.isFollowing !== true || typeof creator.nickname !== 'string' || !creator.nickname.trim()) {
      throw new Error('following relationship unverified')
    }
    const nickname = creator.nickname.trim().slice(0, 200)
    return this.transaction(() => {
      const collision = this.db.prepare('SELECT id,uid,sec_uid FROM creators WHERE owner_sec_uid=? AND (uid=? OR sec_uid=?)').all(ownerSecUid, uid, secUid)
      if (collision.some((row) => row.uid !== uid || row.sec_uid !== secUid)) {
        for (const row of collision) this.db.prepare("UPDATE creators SET following_state='identity_conflict' WHERE id=?").run(row.id)
        return { status: 'identity_conflict' }
      }
      this.db.prepare(`INSERT INTO creators(owner_sec_uid,uid,sec_uid,profile_url,nickname,
        first_discovered_at,identity_verified_at,identity_source,following_verified_at,following_state)
        VALUES(?,?,?,?,?,?,?,?,?,'active')
        ON CONFLICT(owner_sec_uid,uid) DO UPDATE SET
          nickname=excluded.nickname, identity_verified_at=excluded.identity_verified_at,
          following_verified_at=excluded.following_verified_at, following_state='active'`)
        .run(ownerSecUid,uid,secUid,profileUrl(secUid),nickname,verifiedAt,verifiedAt,
          'following-list-structured-response',verifiedAt)
      return { status: 'active' }
    })
  }
  finishRefresh(ownerSecUid, refreshId, seenUids, { complete, failed, scopeLimited } = {}) {
    if (this.ownerSecUid() !== ownerSecUid) throw new Error('OWNER_IDENTITY_CHANGED')
    assertId(refreshId, 'refresh ID')
    if (!Array.isArray(seenUids) || seenUids.some((uid) => !PUBLIC_ID.test(uid))) throw new Error('seen UIDs invalid')
    if (!complete || failed || scopeLimited) {
      this.db.prepare("UPDATE creators SET following_state='stale' WHERE owner_sec_uid=? AND following_state='active'").run(ownerSecUid)
      return { status: 'partial', unfollowed: 0 }
    }
    return this.transaction(() => {
      const seen = new Set(seenUids)
      const rows = this.db.prepare("SELECT id,uid FROM creators WHERE owner_sec_uid=? AND following_state IN ('active','stale')").all(ownerSecUid)
      let unfollowed = 0
      for (const row of rows) {
        if (!seen.has(row.uid)) {
          this.db.prepare("UPDATE creators SET following_state='unfollowed' WHERE id=?").run(row.id)
          unfollowed += 1
        } else {
          this.db.prepare("UPDATE creators SET following_state='active',last_complete_refresh_id=? WHERE id=?").run(refreshId,row.id)
        }
      }
      return { status: 'complete', unfollowed }
    })
  }
  syncableCreators(ownerSecUid) {
    if (this.ownerSecUid() !== ownerSecUid) throw new Error('OWNER_IDENTITY_CHANGED')
    return this.db.prepare(`SELECT uid,sec_uid AS secUid,nickname,profile_url AS profileUrl,
      following_state AS followingState,following_verified_at AS followingVerifiedAt
      FROM creators WHERE owner_sec_uid=? AND following_state IN ('active','stale')
      ORDER BY CASE following_state WHEN 'active' THEN 0 ELSE 1 END, id`).all(ownerSecUid)
  }
  recordCheckpoint({ ownerSecUid, targetKind, nativeId, secUid = null, adapterVersion,
    status, cursorField = null, cursorValueCategory = null, updatedAt }) {
    if (this.ownerSecUid() !== ownerSecUid) throw new Error('OWNER_IDENTITY_CHANGED')
    if (!['creator-works','work-comments','work-replies'].includes(targetKind)
      || !['complete','scope-limited','partial','blocked'].includes(status)) throw new Error('checkpoint shape invalid')
    assertId(nativeId, 'checkpoint native ID')
    assertId(adapterVersion, 'adapter version')
    if (secUid !== null) assertId(secUid, 'checkpoint sec_uid')
    assertTime(updatedAt)
    this.db.prepare(`INSERT INTO checkpoints(owner_sec_uid,target_kind,native_id,sec_uid,adapter_version,
      status,cursor_field,cursor_value_category,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_sec_uid,target_kind,native_id,adapter_version) DO UPDATE SET
      status=excluded.status,cursor_field=excluded.cursor_field,
      cursor_value_category=excluded.cursor_value_category,updated_at=excluded.updated_at`)
      .run(ownerSecUid,targetKind,nativeId,secUid,adapterVersion,status,cursorField,cursorValueCategory,updatedAt)
  }
}
