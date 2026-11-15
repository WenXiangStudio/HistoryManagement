import {randomUUID,createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {videoInterestSchema,type VideoContentBatch,type ContentStageResult,type ContentStage,type VideoContentInfo,type VideoContentDetail,type SavedContentSummary} from '../shared/videoContent'

/** Independent personal labels and immutable stage versions in the current-owner daily database. */
export class VideoContentStore{
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS video_content_interest(owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,interest TEXT NOT NULL,
      updated_at TEXT NOT NULL,PRIMARY KEY(owner_sec_uid,work_id),FOREIGN KEY(owner_sec_uid,work_id) REFERENCES creator_video_information(owner_sec_uid,work_id)) STRICT;
      CREATE TABLE IF NOT EXISTS video_content_batches(id TEXT PRIMARY KEY,owner_sec_uid TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS video_content_stages(id INTEGER PRIMARY KEY,owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,stage TEXT NOT NULL,
      input_hash TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,result_json TEXT NOT NULL,error TEXT,
      FOREIGN KEY(owner_sec_uid,work_id) REFERENCES creator_video_information(owner_sec_uid,work_id)) STRICT;
      CREATE INDEX IF NOT EXISTS video_content_stage_lookup ON video_content_stages(owner_sec_uid,work_id,stage,id);
      CREATE TABLE IF NOT EXISTS video_content_settings(owner_sec_uid TEXT PRIMARY KEY,payload_json TEXT NOT NULL) STRICT;`)
    db.exec(`CREATE TABLE IF NOT EXISTS video_material_inbox(owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,state TEXT NOT NULL,
      PRIMARY KEY(owner_sec_uid,work_id),FOREIGN KEY(owner_sec_uid,work_id) REFERENCES creator_video_information(owner_sec_uid,work_id)) STRICT;`)
  }
  owns(owner:string,workId:string):boolean{return !!this.db.prepare('SELECT 1 FROM creator_video_information WHERE owner_sec_uid=? AND work_id=?').get(owner,workId)}
  setInterest(owner:string,workId:string,input:unknown):void{
    const interest=videoInterestSchema.parse(input)
    if(!this.owns(owner,workId))throw Error('作品不属于当前账号')
    this.db.prepare(`INSERT INTO video_content_interest VALUES(?,?,?,?) ON CONFLICT(owner_sec_uid,work_id)
      DO UPDATE SET interest=excluded.interest,updated_at=excluded.updated_at`).run(owner,workId,interest,new Date().toISOString())
  }
  saveStage(owner:string,workId:string,value:Omit<ContentStageResult,'updatedAt'>):void{
    if(!this.owns(owner,workId))throw Error('作品不属于当前账号')
    this.db.prepare('INSERT INTO video_content_stages(owner_sec_uid,work_id,stage,input_hash,state,updated_at,result_json,error) VALUES(?,?,?,?,?,?,?,?)')
      .run(owner,workId,value.stage,value.inputHash,value.state,new Date().toISOString(),JSON.stringify(value.result),value.error??null)
  }
  stage(owner:string,workId:string,stage:ContentStage,successful=false):ContentStageResult|undefined{
    const row=this.db.prepare(`SELECT * FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage=?
      ${successful?"AND state IN ('completed','partial') AND result_json<>'null'":''} ORDER BY id DESC LIMIT 1`).get(owner,workId,stage)
    return row?{stage:row.stage as ContentStage,state:row.state as ContentStageResult['state'],inputHash:String(row.input_hash),updatedAt:String(row.updated_at),
      result:JSON.parse(String(row.result_json)),...(row.error?{error:String(row.error)}:{})}:undefined
  }
  info(owner:string):Map<string,VideoContentInfo>{
    const result=new Map<string,VideoContentInfo>()
    const get=(id:string)=>{if(!result.has(id))result.set(id,{interest:'unmarked',stages:{}});return result.get(id)!}
    for(const row of this.db.prepare('SELECT * FROM video_content_interest WHERE owner_sec_uid=?').all(owner))get(String(row.work_id)).interest=videoInterestSchema.parse(row.interest)
    const latest=this.db.prepare(`SELECT s.* FROM video_content_stages s JOIN
      (SELECT work_id,stage,MAX(id) id FROM video_content_stages WHERE owner_sec_uid=? GROUP BY work_id,stage) l ON s.id=l.id`).all(owner)
    for(const row of latest){const value=get(String(row.work_id));value.stages[row.stage as ContentStage]={state:row.state as ContentStageResult['state'],updatedAt:String(row.updated_at),...(row.error?{error:String(row.error)}:{})}}
    for(const row of this.db.prepare(`SELECT s.* FROM video_content_stages s JOIN
      (SELECT work_id,stage,MAX(id) id FROM video_content_stages WHERE owner_sec_uid=? AND stage IN ('classification','body','research') AND state='completed' AND result_json<>'null' GROUP BY work_id,stage) l ON s.id=l.id`).all(owner)){
      const value=get(String(row.work_id));(value as Record<string,unknown>)[String(row.stage)]=JSON.parse(String(row.result_json))
    }
    for(const row of this.db.prepare('SELECT * FROM video_material_inbox WHERE owner_sec_uid=?').all(owner))get(String(row.work_id)).inboxState=row.state as import('../shared/videoWorkflow').MaterialInboxState
    for(const info of result.values())if(info.research&&(!info.body||info.research.bodyHash!==createHash('sha256').update(info.body.text).digest('hex')))delete info.research
    const summaries=this.db.prepare(`SELECT s.work_id,s.result_json FROM video_content_stages s JOIN
      (SELECT work_id,MAX(id) id FROM video_content_stages WHERE owner_sec_uid=? AND stage='summary' AND state IN ('completed','partial') AND result_json<>'null' GROUP BY work_id) l ON s.id=l.id`).all(owner)
    for(const row of summaries){const summary=JSON.parse(String(row.result_json)) as SavedContentSummary|null,value=get(String(row.work_id));if(!summary)continue
      value.overview=summary.overview;value.topics=summary.topics;value.limitations=summary.limitations}
    return result
  }
  detail(owner:string,workId:string):VideoContentDetail{
    if(!this.owns(owner,workId))throw Error('作品不属于当前账号')
    const interest=this.db.prepare('SELECT interest FROM video_content_interest WHERE owner_sec_uid=? AND work_id=?').get(owner,workId)?.interest??'unmarked'
    const stages=(['media','transcript','visual','summary','classification','body','research'] as ContentStage[]).map((stage):ContentStageResult|undefined=>{
      const latest=this.stage(owner,workId,stage)
      return latest?{...latest,result:latest.result??this.stage(owner,workId,stage,true)?.result??null}:undefined
    }).filter((s):s is ContentStageResult=>!!s)
    return {ownerSecUid:owner,workId,interest:videoInterestSchema.parse(interest),stages,summary:(this.stage(owner,workId,'summary',true)?.result as SavedContentSummary|undefined)??null}
  }
  setInboxState(owner:string,workId:string,state:import('../shared/videoWorkflow').MaterialInboxState){
    if(!this.owns(owner,workId))throw Error('作品不属于当前账号')
    if(!['unread','read','later','saved'].includes(state))throw Error('无效的收件箱状态')
    this.db.prepare('INSERT INTO video_material_inbox VALUES(?,?,?) ON CONFLICT(owner_sec_uid,work_id) DO UPDATE SET state=excluded.state').run(owner,workId,state)
  }
  newBatch(owner:string,kind:VideoContentBatch['kind'],workIds:string[],extra:Partial<VideoContentBatch>={}):VideoContentBatch{
    const time=new Date().toISOString(),batch:VideoContentBatch={state:'queued',createdAt:time,updatedAt:time,
      workIds:[...new Set(workIds)],completedWorkIds:[],failedWorkIds:[],message:'等待开始',...extra,id:'content-'+randomUUID(),ownerSecUid:owner,kind}
    this.saveBatch(batch);return batch
  }
  saveBatch(batch:VideoContentBatch):void{
    batch.updatedAt=new Date().toISOString()
    this.db.prepare(`INSERT INTO video_content_batches VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,payload_json=excluded.payload_json WHERE video_content_batches.owner_sec_uid=excluded.owner_sec_uid`)
      .run(batch.id,batch.ownerSecUid,batch.state,batch.updatedAt,JSON.stringify(batch))
  }
  batches(owner:string):VideoContentBatch[]{return this.db.prepare('SELECT payload_json FROM video_content_batches WHERE owner_sec_uid=? ORDER BY updated_at DESC LIMIT 30').all(owner).map(r=>JSON.parse(String(r.payload_json)))}
  batch(owner:string,id:string):VideoContentBatch|undefined{const row=this.db.prepare('SELECT payload_json FROM video_content_batches WHERE owner_sec_uid=? AND id=?').get(owner,id);return row?JSON.parse(String(row.payload_json)):undefined}
  interrupt():void{
    for(const row of this.db.prepare("SELECT payload_json FROM video_content_batches WHERE state IN ('running','queued')").all()){
      const batch=JSON.parse(String(row.payload_json)) as VideoContentBatch
      this.saveBatch({...batch,state:'interrupted',message:'应用退出中断，可继续；已完成内容保留'})
    }
    this.db.prepare("UPDATE video_content_stages SET state='interrupted',error='应用退出中断' WHERE state IN ('running','queued')").run()
  }
}
