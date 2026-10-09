import {randomBytes} from 'node:crypto'
import type {FollowingDirectoryStore} from './followingDirectoryStore'
import {basicCaptureSchema,planOwnerSchema,planPageSchema,type BasicState,type PlanCreator,type FollowingPlanState} from '../shared/followingPlan'

export class FollowingPlanStore {
  private basic:BasicState={phase:'idle',runId:null,total:0,done:0,succeeded:0,failed:0,pending:0,currentName:null,message:'仅补全缺失的基础资料'}
  private basicOwner:string|null=null
  private basicTargets:PlanCreator[]=[]
  private received=new Set<string>()
  constructor(private readonly directory:FollowingDirectoryStore){
    directory.db.exec(`CREATE TABLE IF NOT EXISTS following_list_plans(
      run_id TEXT PRIMARY KEY,owner_sec_uid TEXT,owner_json TEXT,phase TEXT NOT NULL,page_count INTEGER NOT NULL DEFAULT 0,
      next_cursor INTEGER NOT NULL DEFAULT 0,next_offset INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT,started_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS following_list_pages(run_id TEXT NOT NULL REFERENCES following_list_plans(run_id),
      position INTEGER NOT NULL,capture_json TEXT NOT NULL,PRIMARY KEY(run_id,position)) STRICT;
      CREATE TABLE IF NOT EXISTS following_basic_fields(owner_sec_uid TEXT NOT NULL,sec_uid TEXT NOT NULL,uid TEXT NOT NULL,
      signature_status TEXT NOT NULL,avatar_status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,error_code TEXT,
      last_seen_run TEXT NOT NULL,position INTEGER NOT NULL,checked_at TEXT,PRIMARY KEY(owner_sec_uid,sec_uid),UNIQUE(owner_sec_uid,uid)) STRICT;
      CREATE TABLE IF NOT EXISTS following_basic_runs(run_id TEXT PRIMARY KEY,owner_sec_uid TEXT NOT NULL,state_json TEXT NOT NULL) STRICT;`)
    directory.db.prepare("UPDATE following_list_plans SET phase='cancelled' WHERE phase='running'").run()
    for(const row of directory.db.prepare('SELECT * FROM following_basic_runs').all()){
      const state=JSON.parse(String(row.state_json)) as BasicState
      if(state.phase==='running'){
        state.phase='cancelled';state.currentName=null;state.message='上次基础资料补充已中断，已完成记录保留'
        directory.db.prepare('UPDATE following_basic_runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state),row.run_id)
      }
    }
    directory.db.prepare("UPDATE following_basic_fields SET signature_status=CASE WHEN signature_status='running' THEN 'pending' ELSE signature_status END,avatar_status=CASE WHEN avatar_status='running' THEN 'pending' ELSE avatar_status END").run()
  }
  begin(runId:string,owner:string|null,resume=false){
    if(resume){
      const row=this.directory.db.prepare('SELECT * FROM following_list_plans WHERE run_id=?').get(runId)
      if(!row||row.complete||row.owner_sec_uid!==owner)throw Error('没有可以继续的关注清单')
      this.directory.db.prepare("UPDATE following_list_plans SET phase='running' WHERE run_id=?").run(runId)
      return {cursor:Number(row.next_cursor),offset:Number(row.next_offset),pageCount:Number(row.page_count)}
    }
    this.directory.db.prepare("INSERT INTO following_list_plans(run_id,owner_sec_uid,phase,started_at) VALUES(?,?,'running',?)").run(runId,owner,new Date().toISOString())
    return {cursor:0,offset:0,pageCount:0}
  }
  bindOwner(runId:string,input:unknown,expectedOwner:string|null){
    const owner=planOwnerSchema.parse(input),row=this.requireRunning(runId)
    if((expectedOwner&&owner.secUid!==expectedOwner)||(row.owner_sec_uid&&row.owner_sec_uid!==owner.secUid))throw Error('OWNER_IDENTITY_MISMATCH')
    if(row.owner_json&&JSON.parse(String(row.owner_json)).uid!==owner.uid)throw Error('OWNER_IDENTITY_MISMATCH')
    this.directory.db.prepare('UPDATE following_list_plans SET owner_sec_uid=?,owner_json=? WHERE run_id=?').run(owner.secUid,JSON.stringify(owner),runId)
    return owner
  }
  page(runId:string,input:unknown){
    const page=planPageSchema.parse(input),run=this.requireRunning(runId)
    if(!run.owner_json||JSON.parse(String(run.owner_json)).uid!==page.owner.uid||run.owner_sec_uid!==page.owner.secUid)throw Error('关注清单账号归属不一致')
    if(page.position!==Number(run.page_count)+1||page.requestCursor!==Number(run.next_cursor)||page.requestOffset!==Number(run.next_offset))throw Error('关注分页来源不连续')
    if(page.hasMore&&(page.nextCursor===null||page.nextCursor<=0||page.nextCursor===page.requestCursor||!page.creators.length))throw Error('关注分页没有推进')
    const previous=this.directory.db.prepare('SELECT capture_json FROM following_list_pages WHERE run_id=?').all(runId).map(row=>planPageSchema.parse(JSON.parse(String(row.capture_json))))
    if(page.hasMore&&previous.some(prior=>prior.requestCursor===page.nextCursor))throw Error('关注分页游标重复')
    const seen=new Map(previous.flatMap(prior=>prior.creators).map(row=>[row.secUid,row]))
    const uids=new Map([...seen.values()].map(row=>[row.uid,row.secUid]))
    let newCount=0
    for(const creator of page.creators){
      const prior=seen.get(creator.secUid)
      if(prior&&JSON.stringify(prior)!==JSON.stringify(creator))throw Error('同一博主的分页来源冲突')
      if(uids.has(creator.uid)&&uids.get(creator.uid)!==creator.secUid)throw Error('博主 UID 与主页身份冲突')
      const saved=this.directory.db.prepare('SELECT * FROM following_basic_fields WHERE owner_sec_uid=? AND (sec_uid=? OR uid=?)').all(page.owner.secUid,creator.secUid,creator.uid)
      if(saved.some(row=>row.sec_uid!==creator.secUid||row.uid!==creator.uid))throw Error('博主 UID 与主页身份冲突')
      if(!prior){newCount++;seen.set(creator.secUid,creator);uids.set(creator.uid,creator.secUid)}
    }
    if(page.hasMore&&!newCount)throw Error('关注分页没有新记录')
    const db=this.directory.db;db.exec('BEGIN IMMEDIATE')
    try{
      this.directory.savePlanRows(runId,page.owner,page.collectedAt,page.creators)
      const priorCount=previous.reduce((sum,prior)=>sum+prior.creators.length,0)
      page.creators.forEach((creator,index)=>{
        db.prepare(`INSERT INTO following_basic_fields(owner_sec_uid,sec_uid,uid,signature_status,avatar_status,last_seen_run,position,checked_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_sec_uid,sec_uid) DO UPDATE SET
          signature_status=CASE WHEN excluded.signature_status='done' THEN 'done' ELSE following_basic_fields.signature_status END,
          avatar_status=CASE WHEN excluded.avatar_status='done' THEN 'done' ELSE following_basic_fields.avatar_status END,
          last_seen_run=excluded.last_seen_run,position=excluded.position,checked_at=excluded.checked_at`)
          .run(page.owner.secUid,creator.secUid,creator.uid,creator.signature===null?'pending':'done',creator.avatarUrl===null?'pending':'done',runId,priorCount+index+1,page.collectedAt)
      })
      db.prepare('INSERT INTO following_list_pages VALUES(?,?,?)').run(runId,page.position,JSON.stringify(page))
      db.prepare('UPDATE following_list_plans SET page_count=?,next_cursor=?,next_offset=?,complete=?,phase=?,checked_at=? WHERE run_id=?')
        .run(page.position,page.nextCursor??page.requestCursor,page.nextOffset??0,page.hasMore?0:1,page.hasMore?'running':'completed',page.collectedAt,runId)
      db.exec('COMMIT')
    }catch(error){db.exec('ROLLBACK');throw error}
    return {count:seen.size,complete:!page.hasMore,pageCount:page.position}
  }
  plan(owner:string|null):FollowingPlanState{
    const row=owner?this.directory.db.prepare('SELECT * FROM following_list_plans WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(owner):undefined
    const empty={runId:null,complete:false,pageCount:0,count:0,nextCursor:0,nextOffset:0,resumable:false,checkedAt:null}
    if(!row)return empty
    const count=new Set(this.directory.db.prepare('SELECT capture_json FROM following_list_pages WHERE run_id=?').all(row.run_id)
      .flatMap(page=>planPageSchema.parse(JSON.parse(String(page.capture_json))).creators.map(creator=>creator.secUid))).size
    return {runId:String(row.run_id),complete:!!row.complete,pageCount:Number(row.page_count),count,nextCursor:Number(row.next_cursor),nextOffset:Number(row.next_offset),
      resumable:!row.complete&&Number(row.page_count)>0&&row.phase!=='running',checkedAt:row.checked_at?String(row.checked_at):null}
  }
  stop(runId:string,phase='cancelled'){
    this.directory.db.prepare('UPDATE following_list_plans SET phase=? WHERE run_id=? AND complete=0').run(phase,runId)
  }
  private pendingRows(owner:string){
    const plan=this.plan(owner)
    if(!plan.complete)return []
    return this.directory.db.prepare("SELECT * FROM following_basic_fields WHERE owner_sec_uid=? AND last_seen_run=? AND (signature_status<>'done' OR avatar_status<>'done') ORDER BY attempts,position,sec_uid")
      .all(owner,plan.runId)
  }
  basicStatus(owner:string|null):BasicState{
    if(this.basicOwner!==owner){
      const row=owner?this.directory.db.prepare('SELECT state_json FROM following_basic_runs WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(owner):null
      this.basic=row?JSON.parse(String(row.state_json)):{phase:'idle',runId:null,total:0,done:0,succeeded:0,failed:0,pending:0,currentName:null,message:'仅补全缺失的基础资料'}
      this.basicOwner=owner
    }
    return {...this.basic,pending:owner?this.pendingRows(owner).length:0}
  }
  beginBasic(owner:string){
    if(!this.plan(owner).complete)throw Error('请先完成关注清单同步')
    if(this.basicStatus(owner).phase==='running')throw Error('基础资料补充正在运行')
    const creators=new Map(this.directory.list().map(row=>[new URL(row.profileUrl).pathname.split('/').at(-1)!,row]))
    this.basicTargets=this.pendingRows(owner).slice(0,20).map(row=>{
      const creator=creators.get(String(row.sec_uid));if(!creator)throw Error('本地待办与博主资料不一致')
      return {uid:String(row.uid),secUid:String(row.sec_uid),nickname:creator.nickname,avatarUrl:creator.avatarUrl,signature:creator.signature,profileUrl:creator.profileUrl}
    })
    if(!this.basicTargets.length)throw Error('基础资料已完整，没有待补充的博主')
    this.received.clear();this.basicOwner=owner
    this.basic={phase:'running',runId:'basic-'+randomBytes(12).toString('hex'),total:this.basicTargets.length,done:0,succeeded:0,failed:0,pending:this.pendingRows(owner).length,currentName:null,message:`正在补全 ${this.basicTargets.length} 位博主的缺失基础资料`}
    this.persistBasic()
    return {action:'basic' as const,runId:this.basic.runId!,ownerSecUid:owner,targets:this.basicTargets}
  }
  basicProgress(runId:string,input:{secUid?:string;finished?:boolean;blocked?:boolean;errorCode?:string}){
    this.requireBasic(runId)
    if(input.secUid){const row=this.basicTargets.find(creator=>creator.secUid===input.secUid);if(!row)throw Error('本轮没有该博主');this.basic.currentName=row.nickname;this.basic.currentSecUid=row.secUid}
    if(input.finished){if(this.basic.done!==this.basic.total)throw Error('基础资料补充尚未完成');this.basic.phase='completed';this.basic.currentName=null;this.basic.message=`基础资料补充完成：成功 ${this.basic.succeeded} 位，未完成 ${this.basic.failed} 位`}
    if(input.blocked){this.basic.phase='blocked';this.basic.currentName=null;this.basic.errorCode=input.errorCode;this.basic.message='基础资料补充已停止，已完成记录保留'}
    this.persistBasic();return this.basicStatus(this.basicOwner)
  }
  receiveBasic(runId:string,secUid:string,input?:unknown,errorCode?:string){
    this.requireBasic(runId)
    const target=this.basicTargets.find(row=>row.secUid===secUid)
    if(!target||this.received.has(secUid))throw Error('基础资料回报对象无效或已完成')
    const capture=input===undefined?null:basicCaptureSchema.parse(input)
    if(capture&&(capture.ownerSecUid!==this.basicOwner||capture.creator.secUid!==target.secUid||capture.creator.uid!==target.uid))throw Error('基础资料作者或账号归属不一致')
    const db=this.directory.db;db.exec('BEGIN IMMEDIATE')
    try{
      if(capture){
        const owner=this.directory.account(this.basicOwner!)!;this.directory.savePlanRows(runId,owner,capture.collectedAt,[capture.creator])
        db.prepare(`UPDATE following_basic_fields SET signature_status=CASE WHEN ? IS NOT NULL THEN 'done' ELSE signature_status END,
          avatar_status=CASE WHEN ? IS NOT NULL THEN 'done' ELSE avatar_status END WHERE owner_sec_uid=? AND sec_uid=?`)
          .run(capture.creator.signature,capture.creator.avatarUrl,this.basicOwner!,secUid)
      }
      const row=db.prepare('SELECT * FROM following_basic_fields WHERE owner_sec_uid=? AND sec_uid=?').get(this.basicOwner!,secUid)!
      const complete=row.signature_status==='done'&&row.avatar_status==='done'
      db.prepare('UPDATE following_basic_fields SET attempts=attempts+1,error_code=? WHERE owner_sec_uid=? AND sec_uid=?').run(complete?null:errorCode||'BASIC_FIELDS_UNAVAILABLE',this.basicOwner!,secUid)
      db.exec('COMMIT');this.received.add(secUid);this.basic.done++;if(complete)this.basic.succeeded++;else this.basic.failed++
    }catch(error){db.exec('ROLLBACK');throw error}
    this.persistBasic();return this.basicStatus(this.basicOwner)
  }
  cancelBasic(){if(this.basic.phase==='running'){this.basic.phase='cancelled';this.basic.currentName=null;this.basic.message='基础资料补充已取消，已完成记录保留';this.persistBasic()}}
  private persistBasic(){if(this.basic.runId&&this.basicOwner)this.directory.db.prepare('INSERT INTO following_basic_runs VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json').run(this.basic.runId,this.basicOwner,JSON.stringify(this.basic))}
  private requireBasic(runId:string){if(this.basic.runId!==runId||this.basic.phase!=='running')throw Error('基础资料补充会话已结束')}
  private requireRunning(runId:string){const row=this.directory.db.prepare('SELECT * FROM following_list_plans WHERE run_id=?').get(runId);if(!row||row.phase!=='running'||row.complete)throw Error('关注清单会话已结束');return row}
}
