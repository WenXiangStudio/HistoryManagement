import type {DatabaseSync} from 'node:sqlite'
import {acceptVideoInformation,type VideoInformationCommand,type VideoInformationCapture,type SavedVideoInformation,type VideoInformationState,videoInformationSchema} from '../shared/videoInformation'

export class VideoInformationStore {
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS video_information_runs(
      run_id TEXT PRIMARY KEY,owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,state_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS video_information_snapshots(
      snapshot_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,capture_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS creator_video_information(
      owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,author_uid TEXT NOT NULL,
      checked_at TEXT NOT NULL,first_collected_at TEXT NOT NULL,snapshot_id TEXT NOT NULL,
      PRIMARY KEY(owner_sec_uid,work_id),FOREIGN KEY(snapshot_id) REFERENCES video_information_snapshots(snapshot_id)) STRICT;`)
    this.migrateSnapshots()
  }
  private migrateSnapshots():void {
    const columns=this.db.prepare('PRAGMA table_info(video_information_snapshots)').all()
    if(columns.some(c=>c.name==='snapshot_id'))return
    try{this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE video_information_snapshots_next(snapshot_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,owner_sec_uid TEXT NOT NULL,
        creator_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,checked_at TEXT NOT NULL,capture_json TEXT NOT NULL) STRICT;
      INSERT INTO video_information_snapshots_next SELECT run_id,run_id,owner_sec_uid,creator_sec_uid,work_id,checked_at,capture_json FROM video_information_snapshots;
      CREATE TABLE creator_video_information_next(owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
        author_uid TEXT NOT NULL,checked_at TEXT NOT NULL,first_collected_at TEXT NOT NULL,snapshot_id TEXT NOT NULL,
        PRIMARY KEY(owner_sec_uid,work_id),FOREIGN KEY(snapshot_id) REFERENCES video_information_snapshots_next(snapshot_id)) STRICT;
      INSERT INTO creator_video_information_next SELECT owner_sec_uid,work_id,creator_sec_uid,author_uid,checked_at,first_collected_at,run_id FROM creator_video_information;
      DROP TABLE creator_video_information; DROP TABLE video_information_snapshots;
      ALTER TABLE video_information_snapshots_next RENAME TO video_information_snapshots;
      ALTER TABLE creator_video_information_next RENAME TO creator_video_information;
      COMMIT;`)}catch(error){this.db.exec('ROLLBACK');throw error}
  }
  saveDiscovered(owner:string,runId:string,work:unknown,checkedAt:string,sourceProof:unknown):void {
    const value=videoInformationSchema.parse(work)
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(runId)||!Number.isFinite(Date.parse(checkedAt)))throw Error('VIDEO_DISCOVERY_ID_INVALID')
    this.persist(owner,runId,value.authorSecUid,value.authorUid,value.workId,checkedAt,
      {contract:'signaldesk-discovered-video/v1',ownerSecUid:owner,work:value,checkedAt,sourceProof},runId+':'+value.workId)
  }
  private persist(owner:string,runId:string,authorSecUid:string,authorUid:string,workId:string,checkedAt:string,capture:unknown,snapshotId=runId):void {
    const prior=this.db.prepare('SELECT * FROM creator_video_information WHERE owner_sec_uid=? AND work_id=?').get(owner,workId)
    if(prior&&(prior.creator_sec_uid!==authorSecUid||prior.author_uid!==authorUid))throw Error('VIDEO_STORED_OWNER_MISMATCH')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const duplicate=this.db.prepare('SELECT capture_json FROM video_information_snapshots WHERE snapshot_id=?').get(snapshotId)
      if(duplicate&&duplicate.capture_json!==JSON.stringify(capture))throw Error('VIDEO_RECEIPT_CONFLICT')
      this.db.prepare('INSERT OR IGNORE INTO video_information_snapshots VALUES(?,?,?,?,?,?,?)').run(snapshotId,runId,owner,authorSecUid,workId,checkedAt,JSON.stringify(capture))
      this.db.prepare(`INSERT INTO creator_video_information VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_sec_uid,work_id)
        DO UPDATE SET checked_at=excluded.checked_at,snapshot_id=excluded.snapshot_id WHERE excluded.checked_at>=creator_video_information.checked_at`)
        .run(owner,workId,authorSecUid,authorUid,checkedAt,checkedAt,snapshotId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  saveState(command:VideoInformationCommand,state:VideoInformationState):void {
    this.db.prepare('INSERT INTO video_information_runs VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json')
      .run(command.runId,command.ownerSecUid,command.authorSecUid,JSON.stringify(state))
  }
  latestState(owner:string):VideoInformationState|undefined {
    const row=this.db.prepare('SELECT state_json FROM video_information_runs WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(owner)
    return row?JSON.parse(String(row.state_json)):undefined
  }
  interruptRuns():void {
    const rows=this.db.prepare("SELECT run_id,state_json FROM video_information_runs WHERE json_extract(state_json,'$.phase')='running'").all()
    for(const row of rows){const state=JSON.parse(String(row.state_json));this.db.prepare('UPDATE video_information_runs SET state_json=? WHERE run_id=?')
      .run(JSON.stringify({...state,phase:'blocked',errorCode:'VIDEO_APP_RESTARTED',message:'上次采集被应用退出中断，已有视频信息保留'}),String(row.run_id))}
  }
  save(command:VideoInformationCommand,input:unknown,startedAt:string):VideoInformationCapture {
    const capture=acceptVideoInformation(input,command,startedAt)
    this.persist(command.ownerSecUid,command.runId,command.authorSecUid,command.authorUid,command.workId,capture.checkedAt,capture)
    return capture
  }

  list(owner:string,creatorSecUid?:string):SavedVideoInformation[] {
    return this.db.prepare(`SELECT v.first_collected_at,s.capture_json,s.run_id FROM creator_video_information v
      JOIN video_information_snapshots s ON s.snapshot_id=v.snapshot_id
      WHERE v.owner_sec_uid=? ${creatorSecUid===undefined?'':'AND v.creator_sec_uid=?'} ORDER BY json_extract(s.capture_json,'$.work.publishedAt') DESC,v.work_id DESC`).all(...(creatorSecUid===undefined?[owner]:[owner,creatorSecUid]))
      .map(row=>{const capture=JSON.parse(String(row.capture_json)) as VideoInformationCapture
        return {...capture.work,checkedAt:capture.checkedAt,firstCollectedAt:String(row.first_collected_at),runId:String(row.run_id),sourceKind:capture.sourceProof.kind}})
  }
}
