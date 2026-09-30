import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { CreatorListItem } from '../shared/contracts'
import { followingDirectoryReportSchema, type FollowingDirectoryReport } from '../shared/followingDirectory'

// This directory has its own versioned database. It does not change the v5 work database.
export class FollowingDirectoryStore {
  readonly db: DatabaseSync
  constructor(readonly path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS directory_runs(run_id TEXT PRIMARY KEY, owner_sec_uid TEXT NOT NULL,
        collected_at TEXT NOT NULL, status TEXT NOT NULL, report_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS directory_creators(id INTEGER PRIMARY KEY, owner_sec_uid TEXT NOT NULL,
        uid TEXT NOT NULL, sec_uid TEXT NOT NULL, nickname TEXT NOT NULL, avatar_url TEXT,
        signature TEXT NOT NULL, profile_url TEXT NOT NULL, position INTEGER NOT NULL,
        last_run_id TEXT NOT NULL REFERENCES directory_runs(run_id), is_starred INTEGER NOT NULL DEFAULT 0,
        user_note TEXT NOT NULL DEFAULT '', UNIQUE(owner_sec_uid,uid), UNIQUE(owner_sec_uid,sec_uid)) STRICT;
      PRAGMA user_version=1;`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS visible_directory_runs(run_id TEXT PRIMARY KEY,
      collected_at TEXT NOT NULL, account_label TEXT, status TEXT NOT NULL, report_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS visible_directory_creators(id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES visible_directory_runs(run_id), sec_uid TEXT NOT NULL,
      nickname TEXT NOT NULL, avatar_url TEXT, signature TEXT NOT NULL, profile_url TEXT NOT NULL,
      position INTEGER NOT NULL, is_starred INTEGER NOT NULL DEFAULT 0, user_note TEXT NOT NULL DEFAULT '',
      UNIQUE(run_id,sec_uid)) STRICT;`)
  }
  accept(input: unknown): FollowingDirectoryReport {
    const report = followingDirectoryReportSchema.parse(input)
    const hash = createHash('sha256').update(JSON.stringify(report.creators)).digest('hex')
    if (hash !== report.projectionSha256) throw new Error('关注基础信息投影 hash 不匹配')
    if (report.contract === 'signaldesk-visible-following/v1') {
      const prior = this.db.prepare('SELECT report_json FROM visible_directory_runs WHERE run_id=?').get(report.runId)
      if (prior) {
        if (prior.report_json !== JSON.stringify(report)) throw new Error('同一关注 run 收到了不同报告')
        return report
      }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.prepare('INSERT INTO visible_directory_runs VALUES(?,?,?,?,?)').run(report.runId,report.collectedAt,
          report.ownerNickname,report.creators.length === 10 ? 'scope-limited' : 'partial',JSON.stringify(report))
        const insert = this.db.prepare(`INSERT INTO visible_directory_creators(run_id,sec_uid,nickname,avatar_url,
          signature,profile_url,position) VALUES(?,?,?,?,?,?,?)`)
        report.creators.forEach((item,index)=>insert.run(report.runId,item.secUid,item.nickname,item.avatarUrl,
          item.signature,item.profileUrl,index+1))
        this.db.exec('COMMIT')
      } catch(error) { this.db.exec('ROLLBACK'); throw error }
      return report
    }
    const prior = this.db.prepare('SELECT report_json FROM directory_runs WHERE run_id=?').get(report.runId)
    if (prior) {
      if (prior.report_json !== JSON.stringify(report)) throw new Error('同一关注 run 收到了不同报告')
      return report
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO directory_runs VALUES(?,?,?,?,?)').run(report.runId, report.ownerSecUid,
        report.collectedAt, report.creators.length === 10 ? 'scope-limited' : report.hasMore ? 'partial' : 'complete', JSON.stringify(report))
      const insert = this.db.prepare(`INSERT INTO directory_creators(owner_sec_uid,uid,sec_uid,nickname,avatar_url,
        signature,profile_url,position,last_run_id) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(owner_sec_uid,uid) DO UPDATE SET sec_uid=excluded.sec_uid,nickname=excluded.nickname,
        avatar_url=excluded.avatar_url,signature=excluded.signature,profile_url=excluded.profile_url,
        position=excluded.position,last_run_id=excluded.last_run_id`)
      report.creators.forEach((item, index) => insert.run(report.ownerSecUid, item.uid, item.secUid,
        item.nickname, item.avatarUrl, item.signature, item.profileUrl, index + 1, report.runId))
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return report
  }
  latest(): { runId: string; ownerSecUid: string | null; collectedAt: string; visible?: boolean } | null {
    const visible = this.db.prepare(`SELECT run_id AS runId,NULL AS ownerSecUid,collected_at AS collectedAt
      FROM visible_directory_runs ORDER BY rowid DESC LIMIT 1`).get() as {runId:string;ownerSecUid:null;collectedAt:string} | undefined
    const network = this.latestNetwork()
    if (visible && (!network || visible.collectedAt >= network.collectedAt)) return { ...visible, visible: true }
    return network
  }
  private latestNetwork(): { runId: string; ownerSecUid: string; collectedAt: string } | null {
    return this.db.prepare(`SELECT run_id AS runId,owner_sec_uid AS ownerSecUid,collected_at AS collectedAt
      FROM directory_runs ORDER BY rowid DESC LIMIT 1`).get() as {runId:string;ownerSecUid:string;collectedAt:string} | undefined ?? null
  }
  list(search = ''): CreatorListItem[] {
    const latest = this.latest()
    if (!latest) return []
    if (latest.visible) {
      const query = search.normalize('NFKC').trim().toLocaleLowerCase()
      return this.db.prepare('SELECT * FROM visible_directory_creators WHERE run_id=? ORDER BY position').all(latest.runId)
        .map((row): CreatorListItem => ({ id: -1000000000-Number(row.id), isDemo:false,
          platformCreatorId:`profile:${row.sec_uid}`, nickname:String(row.nickname),avatarUrl:row.avatar_url?String(row.avatar_url):null,
          signature:String(row.signature),profileUrl:String(row.profile_url),isFollowing:true,isStarred:Boolean(row.is_starred),
          note:String(row.user_note),domains:[],workCount:0,analyzedCount:0,lastPublishedAt:null }))
        .filter((item)=>!query || `${item.nickname} ${item.signature} ${item.note}`.normalize('NFKC').toLocaleLowerCase().includes(query))
    }
    const rows = this.db.prepare(`SELECT * FROM directory_creators WHERE owner_sec_uid=? AND last_run_id=? ORDER BY position`).all(latest.ownerSecUid, latest.runId)
    const query = search.normalize('NFKC').trim().toLocaleLowerCase()
    return rows.map((row): CreatorListItem => ({
      id: -Number(row.id), isDemo: false, platformCreatorId: String(row.uid), nickname: String(row.nickname),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null, signature: String(row.signature),
      profileUrl: String(row.profile_url), isFollowing: true, isStarred: Boolean(row.is_starred), note: String(row.user_note),
      domains: [], workCount: 0, analyzedCount: 0, lastPublishedAt: null
    })).filter((item) => !query || `${item.nickname} ${item.signature} ${item.note}`.normalize('NFKC').toLocaleLowerCase().includes(query))
  }
  update(id: number, input: { isStarred?: boolean; note?: string }): void {
    const current = this.list().find((item) => item.id === id)
    if (!current) throw new Error('当前账号目录中没有这位博主')
    if (id < -1000000000) {
      this.db.prepare('UPDATE visible_directory_creators SET is_starred=?,user_note=? WHERE id=?').run(
        input.isStarred === undefined ? Number(current.isStarred) : Number(input.isStarred),input.note ?? current.note,-id-1000000000)
      return
    }
    this.db.prepare('UPDATE directory_creators SET is_starred=?,user_note=? WHERE id=?').run(
      input.isStarred === undefined ? Number(current.isStarred) : Number(input.isStarred), input.note ?? current.note, -id)
  }
  close(): void { this.db.close() }
}
