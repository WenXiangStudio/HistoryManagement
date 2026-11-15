import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { CreatorListItem } from '../shared/contracts'
import type {FollowingAccount,FollowingAccountIdentity} from '../shared/followingDirectory'
import { followingDirectoryReportSchema, type FollowingDirectoryReport } from '../shared/followingDirectory'
import type {PlanCreator} from '../shared/followingPlan'

// This directory has its own versioned database. It does not change the v5 work database.
export class FollowingDirectoryStore {
  readonly db: DatabaseSync
  private accountSelected=false
  private selectedOwner:string|null=null
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
    if(!this.db.prepare('PRAGMA table_info(visible_directory_runs)').all().some(row=>row.name==='owner_sec_uid'))this.db.exec('ALTER TABLE visible_directory_runs ADD COLUMN owner_sec_uid TEXT')
    if(!this.db.prepare('PRAGMA table_info(visible_directory_creators)').all().some(row=>row.name==='native_uid'))this.db.exec('ALTER TABLE visible_directory_creators ADD COLUMN native_uid TEXT')
    this.db.exec('CREATE TABLE IF NOT EXISTS following_account_owners(sec_uid TEXT PRIMARY KEY,uid TEXT NOT NULL,legacy_label TEXT NOT NULL) STRICT')
    for(const name of ['nickname','label','chrome_profile']){
      if(!this.db.prepare('PRAGMA table_info(following_account_owners)').all().some(row=>row.name===name))this.db.exec(`ALTER TABLE following_account_owners ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`)
    }
  }
  accept(input: unknown): FollowingDirectoryReport {
    const report = followingDirectoryReportSchema.parse(input)
    const hash = createHash('sha256').update(JSON.stringify(report.creators)).digest('hex')
    if (hash !== report.projectionSha256) throw new Error('关注基础信息投影 hash 不匹配')
    if (report.contract === 'signaldesk-visible-following/v1'||report.contract==='signaldesk-structured-following/v1') {
      const prior = this.db.prepare('SELECT report_json FROM visible_directory_runs WHERE run_id=?').get(report.runId)
      if (prior) {
        if (prior.report_json !== JSON.stringify(report)) throw new Error('同一关注 run 收到了不同报告')
        return report
      }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const structured=report.contract==='signaldesk-structured-following/v1'
        if(structured)this.recordAccount({secUid:report.ownerSecUid,uid:report.ownerUid,nickname:report.ownerNickname},{
          adoptLegacy:this.db.prepare('SELECT COUNT(*) AS n FROM following_account_owners').get()!.n===0})
        this.db.prepare('INSERT INTO visible_directory_runs(run_id,collected_at,account_label,status,report_json,owner_sec_uid) VALUES(?,?,?,?,?,?)').run(report.runId,report.collectedAt,
          report.ownerNickname,report.creators.length >= 10 ? 'scope-limited' : 'partial',JSON.stringify(report),structured?report.ownerSecUid:null)
        const insert = this.db.prepare(`INSERT INTO visible_directory_creators(run_id,sec_uid,nickname,avatar_url,
          signature,profile_url,position,native_uid) VALUES(?,?,?,?,?,?,?,?)`)
        report.creators.forEach((item,index)=>insert.run(report.runId,item.secUid,item.nickname,item.avatarUrl,
          item.signature,item.profileUrl,index+1,structured?item.uid:null))
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
    if(this.accountSelected){
      if(!this.selectedOwner)return null
      const account=this.db.prepare('SELECT legacy_label FROM following_account_owners WHERE sec_uid=?').get(this.selectedOwner)
      const visible=this.db.prepare(`SELECT run_id AS runId,owner_sec_uid AS ownerSecUid,collected_at AS collectedAt
        FROM visible_directory_runs WHERE owner_sec_uid=? OR (owner_sec_uid IS NULL AND account_label=?) ORDER BY rowid DESC LIMIT 1`)
        .get(this.selectedOwner,account?.legacy_label||'') as {runId:string;ownerSecUid:string|null;collectedAt:string}|undefined
      return visible?{...visible,visible:true}:null
    }
    const visible = this.db.prepare(`SELECT run_id AS runId,owner_sec_uid AS ownerSecUid,collected_at AS collectedAt
      FROM visible_directory_runs ORDER BY rowid DESC LIMIT 1`).get() as {runId:string;ownerSecUid:null;collectedAt:string} | undefined
    const network = this.latestNetwork()
    if (visible && (!network || visible.collectedAt >= network.collectedAt)) return { ...visible, visible: true }
    return network
  }
  // The caller owns the page transaction. Append observations while retaining original IDs/annotations.
  savePlanRows(runId:string,owner:{uid:string;secUid:string;nickname:string},collectedAt:string,creators:PlanCreator[]):void{
    const priorOwner=this.account(owner.secUid)
    if(priorOwner&&priorOwner.uid!==owner.uid)throw Error('账号 UID 与主页身份冲突')
    this.recordAccount(owner,{adoptLegacy:this.accounts().length===0})
    const prior=this.db.prepare('SELECT report_json FROM visible_directory_runs WHERE run_id=?').get(runId)
    const priorRows=prior?JSON.parse(String(prior.report_json)).creators as PlanCreator[]:[]
    const existing=new Map(this.list().map(row=>[new URL(row.profileUrl).pathname.split('/').at(-1)!,row]))
    const merged=new Map(priorRows.map(row=>[row.secUid,row]))
    const updates:PlanCreator[]=[]
    for(const creator of creators){
      const saved=existing.get(creator.secUid)
      if(saved?.nativeUid&&saved.nativeUid!==creator.uid)throw Error('博主 UID 与主页身份冲突')
      const row={...creator,signature:creator.signature??saved?.signature??'',avatarUrl:creator.avatarUrl??saved?.avatarUrl??null}
      updates.push(row);merged.set(row.secUid,row)
    }
    this.db.prepare(`INSERT INTO visible_directory_runs(run_id,collected_at,account_label,status,report_json,owner_sec_uid)
      VALUES(?,?,?,'plan-observation',?,?) ON CONFLICT(run_id) DO UPDATE SET collected_at=excluded.collected_at,report_json=excluded.report_json`)
      .run(runId,collectedAt,owner.nickname,JSON.stringify({contract:'signaldesk-following-plan/v1',ownerSecUid:owner.secUid,creators:[...merged.values()]}),owner.secUid)
    const upsert=this.db.prepare(`INSERT INTO visible_directory_creators(run_id,sec_uid,nickname,avatar_url,signature,profile_url,position,native_uid)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,sec_uid) DO UPDATE SET nickname=excluded.nickname,avatar_url=excluded.avatar_url,signature=excluded.signature,native_uid=excluded.native_uid`)
    for(const row of updates)upsert.run(runId,row.secUid,row.nickname,row.avatarUrl,row.signature,row.profileUrl,[...merged.keys()].indexOf(row.secUid)+1,row.uid)
  }
  selectAccount(secUid:string|null):void{this.accountSelected=true;this.selectedOwner=secUid}
  recordAccount(owner:FollowingAccountIdentity,options:{adoptLegacy?:boolean;label?:string;chromeProfile?:string|null}={}):void{
    const existing=this.db.prepare('SELECT * FROM following_account_owners WHERE sec_uid=?').get(owner.secUid)
    if(existing&&existing.uid!==owner.uid)throw new Error('账号原生身份发生冲突')
    const legacy=existing?String(existing.legacy_label):options.adoptLegacy?owner.nickname:''
    this.db.prepare(`INSERT INTO following_account_owners(sec_uid,uid,legacy_label,nickname,label,chrome_profile) VALUES(?,?,?,?,?,?)
      ON CONFLICT(sec_uid) DO UPDATE SET nickname=excluded.nickname,label=excluded.label,chrome_profile=excluded.chrome_profile`)
      .run(owner.secUid,owner.uid,legacy,owner.nickname,options.label??String(existing?.label||owner.nickname),options.chromeProfile??String(existing?.chrome_profile||''))
  }
  account(secUid:string):FollowingAccount|undefined{return this.accounts().find(item=>item.secUid===secUid)}
  accounts():FollowingAccount[]{
    return this.db.prepare('SELECT * FROM following_account_owners ORDER BY rowid').all().map(row=>({
      secUid:String(row.sec_uid),uid:String(row.uid),nickname:String(row.nickname||row.legacy_label),label:String(row.label||row.nickname||row.legacy_label),
      chromeProfile:row.chrome_profile?String(row.chrome_profile):null,
      creatorCount:Number(this.db.prepare(`SELECT COUNT(DISTINCT c.sec_uid) AS n FROM visible_directory_creators c JOIN visible_directory_runs r ON r.run_id=c.run_id
        WHERE r.owner_sec_uid=? OR (r.owner_sec_uid IS NULL AND r.account_label=?)`).get(row.sec_uid,row.legacy_label)!.n)
    }))
  }
  private latestNetwork(): { runId: string; ownerSecUid: string; collectedAt: string } | null {
    return this.db.prepare(`SELECT run_id AS runId,owner_sec_uid AS ownerSecUid,collected_at AS collectedAt
      FROM directory_runs ORDER BY rowid DESC LIMIT 1`).get() as {runId:string;ownerSecUid:string;collectedAt:string} | undefined ?? null
  }
  list(search = '',secUid?:string): CreatorListItem[] {
    const latest = this.latest()
    if (!latest) return []
    if (latest.visible) {
      const query = search.normalize('NFKC').trim().toLocaleLowerCase()
      const account = this.db.prepare('SELECT account_label FROM visible_directory_runs WHERE run_id=?').get(latest.runId)!
      // A limited batch adds to the saved directory. Keep one card per profile,
      // using its latest public fields and its original ID and local annotations.
      // Unlabelled runs cannot establish a shared account scope.
      const native=(this.selectedOwner||latest.ownerSecUid)?this.db.prepare('SELECT legacy_label FROM following_account_owners WHERE sec_uid=?').get(this.selectedOwner||latest.ownerSecUid):null
      const scope = native?'(r.owner_sec_uid=? OR (r.owner_sec_uid IS NULL AND r.account_label=?))':account.account_label === null ? 'r.run_id=?' : 'r.account_label=?'
      const scopeValues=native?[this.selectedOwner||latest.ownerSecUid,native.legacy_label]:[account.account_label === null ? latest.runId : account.account_label]
      const rows = this.db.prepare(`WITH observed AS (
        SELECT c.*,r.collected_at,r.rowid AS run_order,
          FIRST_VALUE(c.id) OVER (PARTITION BY c.sec_uid ORDER BY r.rowid,c.position,c.id) AS saved_id,
          ROW_NUMBER() OVER (PARTITION BY c.sec_uid ORDER BY r.collected_at DESC,r.rowid DESC,c.id DESC) AS revision
        FROM visible_directory_creators c JOIN visible_directory_runs r ON r.run_id=c.run_id
        WHERE ${scope}${secUid?' AND c.sec_uid=?':''}
      ) SELECT observed.*,saved.is_starred AS saved_starred,saved.user_note AS saved_note
        FROM observed JOIN visible_directory_creators saved ON saved.id=observed.saved_id
        WHERE revision=1 ORDER BY saved_id`).all(...scopeValues,...(secUid?[secUid]:[]))
      return rows.map((row): CreatorListItem => ({ id: -1000000000-Number(row.saved_id), isDemo:false,
          nativeUid:row.native_uid?String(row.native_uid):null,
          platformCreatorId:`profile:${row.sec_uid}`, nickname:String(row.nickname),avatarUrl:row.avatar_url?String(row.avatar_url):null,
          signature:String(row.signature),profileUrl:String(row.profile_url),isFollowing:true,isStarred:Boolean(row.saved_starred),
          note:String(row.saved_note),domains:[],workCount:0,analyzedCount:0,lastPublishedAt:null }))
        .filter((item)=>!query || `${item.nickname} ${item.signature} ${item.note}`.normalize('NFKC').toLocaleLowerCase().includes(query))
    }
    const rows = this.db.prepare(`SELECT * FROM directory_creators WHERE owner_sec_uid=?${secUid?' AND sec_uid=?':''} ORDER BY id`).all(latest.ownerSecUid,...(secUid?[secUid]:[]))
    const query = search.normalize('NFKC').trim().toLocaleLowerCase()
    return rows.map((row): CreatorListItem => ({
      id: -Number(row.id), isDemo: false, platformCreatorId: String(row.uid), nickname: String(row.nickname),
      nativeUid:String(row.uid),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null, signature: String(row.signature),
      profileUrl: String(row.profile_url), isFollowing: true, isStarred: Boolean(row.is_starred), note: String(row.user_note),
      domains: [], workCount: 0, analyzedCount: 0, lastPublishedAt: null
    })).filter((item) => !query || `${item.nickname} ${item.signature} ${item.note}`.normalize('NFKC').toLocaleLowerCase().includes(query))
  }
  find(id:number):CreatorListItem|undefined{
    const row=id < -1000000000
      ?this.db.prepare('SELECT sec_uid FROM visible_directory_creators WHERE id=?').get(-id-1000000000)
      :this.db.prepare('SELECT sec_uid FROM directory_creators WHERE id=?').get(-id)
    return row?this.list('',String(row.sec_uid)).find(item=>item.id===id):undefined
  }
  update(id: number, input: { isStarred?: boolean; note?: string }): CreatorListItem {
    const current = this.find(id)
    if (!current) throw new Error('当前账号目录中没有这位博主')
    if (id < -1000000000) {
      this.db.prepare('UPDATE visible_directory_creators SET is_starred=?,user_note=? WHERE id=?').run(
        input.isStarred === undefined ? Number(current.isStarred) : Number(input.isStarred),input.note ?? current.note,-id-1000000000)
      return {...current,isStarred:input.isStarred??current.isStarred,note:input.note??current.note}
    }
    this.db.prepare('UPDATE directory_creators SET is_starred=?,user_note=? WHERE id=?').run(
      input.isStarred === undefined ? Number(current.isStarred) : Number(input.isStarred), input.note ?? current.note, -id)
    return {...current,isStarred:input.isStarred??current.isStarred,note:input.note??current.note}
  }
  close(): void { this.db.close() }
}
