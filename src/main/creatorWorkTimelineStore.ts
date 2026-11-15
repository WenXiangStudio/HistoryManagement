import type {DatabaseSync} from 'node:sqlite'
import type {CreatorActivityCapture,CreatorActivityUnchanged} from '../shared/creatorActivity'
import {emptyCreatorTimeline,observeCreatorTimeline,timelineBaseline,type CreatorTimelineState,type CreatorTimelineView} from '../shared/creatorWorkTimeline'
import {compareCreatorContinuity,type CreatorContinuityComparison} from '../shared/creatorActivityContinuity'
import type {CreatorRefreshBaseline} from '../shared/creatorRefreshPolicy'

type Event={baselineBefore:CreatorRefreshBaseline|null;baselineAfter:CreatorRefreshBaseline|null;comparison:CreatorContinuityComparison|null;
  observation:CreatorTimelineState['observation']}
/** Derived cumulative timeline. Raw snapshots/checks remain immutable and can rebuild every state. */
export class CreatorWorkTimelineStore {
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS creator_work_timeline_states(owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,author_uid TEXT NOT NULL,
      payload_json TEXT NOT NULL,PRIMARY KEY(owner_sec_uid,creator_sec_uid)) STRICT;
      CREATE TABLE IF NOT EXISTS creator_work_timeline_events(source_kind TEXT NOT NULL,source_id INTEGER NOT NULL,owner_sec_uid TEXT NOT NULL,
      creator_sec_uid TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(source_kind,source_id)) STRICT;`)
    this.backfill()
  }
  state(owner:string,secUid:string):CreatorTimelineState{
    const row=this.db.prepare('SELECT payload_json FROM creator_work_timeline_states WHERE owner_sec_uid=? AND creator_sec_uid=?').get(owner,secUid)
    return row?JSON.parse(String(row.payload_json)):emptyCreatorTimeline()
  }
  view(owner:string,secUid:string):CreatorTimelineView{return {...this.state(owner,secUid),ownerSecUid:owner,creatorSecUid:secUid}}
  baseline(owner:string,secUid:string){return timelineBaseline(this.state(owner,secUid))}
  event(kind:'snapshot'|'check',id:number):Event|null{
    const row=this.db.prepare('SELECT payload_json FROM creator_work_timeline_events WHERE source_kind=? AND source_id=?').get(kind,id)
    return row?JSON.parse(String(row.payload_json)):null
  }
  private record(kind:'snapshot'|'check',id:number,capture:CreatorActivityCapture,reference:number|null){
    if(this.event(kind,id))return
    const owner=capture.ownerSecUid,secUid=capture.profile.secUid
    if(capture.requestedSecUid!==secUid)throw Error('作品时间线作者身份不一致')
    const old=this.db.prepare('SELECT author_uid FROM creator_work_timeline_states WHERE owner_sec_uid=? AND creator_sec_uid=?').get(owner,secUid)
    if(old&&old.author_uid!==capture.profile.uid)throw Error('作品时间线作者原生身份不一致')
    const previous=this.state(owner,secUid),before=timelineBaseline(previous)
    const next=observeCreatorTimeline(previous,capture,reference)
    const event:Event={baselineBefore:before??null,baselineAfter:timelineBaseline(next)??null,
      comparison:before?compareCreatorContinuity(capture,before):null,observation:next.observation}
    this.db.prepare('INSERT INTO creator_work_timeline_states VALUES(?,?,?,?) ON CONFLICT(owner_sec_uid,creator_sec_uid) DO UPDATE SET payload_json=excluded.payload_json')
      .run(owner,secUid,capture.profile.uid,JSON.stringify(next))
    this.db.prepare('INSERT INTO creator_work_timeline_events VALUES(?,?,?,?,?)').run(kind,id,owner,secUid,JSON.stringify(event))
  }
  recordSnapshot(id:number,capture:CreatorActivityCapture){this.record('snapshot',id,capture,id)}
  recordCheck(id:number,check:CreatorActivityUnchanged){
    const at=check.checkedAt
    const capture={ownerSecUid:check.ownerSecUid,requestedSecUid:check.requestedSecUid,profile:{uid:check.authorUid,secUid:check.requestedSecUid,workCount:null},
      checkedAt:at,frontendCount:check.frontendCount,errorCode:null,pages:check.firstPage?[check.firstPage]:[]} as CreatorActivityCapture
    this.record('check',id,capture,null)
  }
  private backfill(){
    const rows=this.db.prepare(`SELECT 'snapshot' kind,id,checked_at at,id*2 ordinal,capture_json payload FROM creator_activity_snapshots
      WHERE NOT EXISTS(SELECT 1 FROM creator_work_timeline_events e WHERE e.source_kind='snapshot' AND e.source_id=creator_activity_snapshots.id)
      UNION ALL SELECT 'check' kind,id,checked_at at,baseline_snapshot_id*2+1 ordinal,check_json payload FROM creator_activity_checks
      WHERE NOT EXISTS(SELECT 1 FROM creator_work_timeline_events e WHERE e.source_kind='check' AND e.source_id=creator_activity_checks.id)
      ORDER BY at,ordinal,id`).all()
    if(!rows.length)return
    this.db.exec('BEGIN IMMEDIATE')
    try{
      for(const row of rows){
        const value=JSON.parse(String(row.payload))
        if(row.kind==='snapshot')this.recordSnapshot(Number(row.id),value)
        else this.recordCheck(Number(row.id),value)
      }
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}
