import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { acceptCreatorActivity, calendarWeek, classifyActivityVisibility, creatorWorkBelongsTo, creatorActivityProgressSchema, creatorActivityUnchangedSchema, type CreatorActivityProgress, type CreatorActivitySnapshot, type CreatorActivityState, type CreatorActivityView, type CreatorActivityCapture, type CreatorActivityUnchanged } from '../shared/creatorActivity'
import type { CreatorListItem } from '../shared/contracts'
import { creatorRefreshSchedule, latestWorkFingerprint, assessRecentActivity, CREATOR_REFRESH_SCOPE_LABELS, type CreatorRefreshScope, type CreatorRefreshBaseline, type CreatorRefreshPacing } from '../shared/creatorRefreshPolicy'
import {nativeListUnavailableMessage} from '../shared/creatorActivityObservation'
import {creatorPublicationInterval,type CreatorPublicationSource,type CreatorPublicationInterval} from '../shared/creatorPublicationInterval'
import type {CreatorPriorityState} from '../shared/creatorPriority'
import {compareCreatorContinuity,currentPublicWorks,hasCompletePublicList} from '../shared/creatorActivityContinuity'
import {CreatorActivityIntegrityStore} from './creatorActivityIntegrityStore'
import {CreatorWorkTimelineStore} from './creatorWorkTimelineStore'
import {assessCreatorBaseline,baselineBatchSizes,baselinePacing,baselineSampleCount,type CreatorBaselinePolicy,type CreatorBaselineResult} from '../shared/creatorActivityBaseline'
import {CREATOR_ACTIVITY_RECOVERY_POLICY,type CreatorActivityRecoveryPolicy} from '../shared/creatorActivityRecovery'

export type ActivityTarget = {id: number; secUid: string; uid: string | null; nickname: string; baseline?:CreatorRefreshBaseline;comparisonBaseline?:CreatorRefreshBaseline;repair?:boolean;needsBaseline?:boolean}
type ActivityCommand={action:'activity';runId:string;ownerSecUid:string;ownerUid:string|null;targets:ActivityTarget[];
  pacing?:CreatorRefreshPacing;initialWaitUntil?:string;baselinePolicy?:CreatorBaselinePolicy;recoveryPolicy?:CreatorActivityRecoveryPolicy;weekStart:string;weekEndExclusive:string}
type ActivityOptions={pacing?:CreatorRefreshPacing;scope?:CreatorRefreshScope;baselineTrial?:boolean}
export class CreatorActivityService {
  private readonly integrity:CreatorActivityIntegrityStore
  private readonly timeline:CreatorWorkTimelineStore
  private state: CreatorActivityState
  private owner: string | null = null
  private targets: ActivityTarget[] = []
  private started = 0
  private received = new Set<number>()
  private readonly snapshotCache = new Map<number,CreatorActivitySnapshot>()
  private expectedOwnerUid:string|null=null
  private readonly fingerprintCache=new Map<number,ReturnType<typeof latestWorkFingerprint>>()
  private readonly baselineCache=new Map<number,CreatorRefreshBaseline>()
  private publicationCache:{owner:string;revision:string;sources:Map<string,CreatorPublicationSource[]>;intervals:Map<string,CreatorPublicationInterval>}|undefined
  constructor(private readonly db: DatabaseSync, private readonly changed: () => void) {
    const week = calendarWeek()
    this.state = {phase:'idle',runId:null,message:'更新作品总数与本周动态',total:0,done:0,succeeded:0,failed:0,
      currentName:null,remainingIds:[],startedAt:null,weekStart:week.start,weekEndExclusive:week.endExclusive}
    db.exec(`CREATE TABLE IF NOT EXISTS creator_activity_runs(run_id TEXT PRIMARY KEY,owner_sec_uid TEXT NOT NULL,state_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS creator_activity_snapshots(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
        owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,checked_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,capture_json TEXT NOT NULL,
        UNIQUE(run_id,creator_sec_uid)) STRICT;
      CREATE TABLE IF NOT EXISTS creator_activity_attempts(run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
        owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,attempted_at TEXT NOT NULL,error_code TEXT,
        PRIMARY KEY(run_id,creator_sec_uid)) STRICT;
      CREATE TABLE IF NOT EXISTS creator_activity_diagnostics(run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
        owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,captured_at TEXT NOT NULL,diagnostic_json TEXT NOT NULL,
        PRIMARY KEY(run_id,creator_sec_uid)) STRICT;
      CREATE TABLE IF NOT EXISTS creator_activity_checks(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
        owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,checked_at TEXT NOT NULL,baseline_snapshot_id INTEGER NOT NULL REFERENCES creator_activity_snapshots(id),
        check_json TEXT NOT NULL,UNIQUE(run_id,creator_sec_uid)) STRICT;
      CREATE TABLE IF NOT EXISTS creator_activity_observations(run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
        owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,captured_at TEXT NOT NULL,observation_json TEXT NOT NULL,
        PRIMARY KEY(run_id,creator_sec_uid)) STRICT;`)
    this.integrity=new CreatorActivityIntegrityStore(db)
    this.timeline=new CreatorWorkTimelineStore(db)
    db.exec(`CREATE TABLE IF NOT EXISTS creator_activity_baseline_samples(snapshot_id INTEGER PRIMARY KEY REFERENCES creator_activity_snapshots(id),
      owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,result_json TEXT NOT NULL) STRICT;`)
    db.exec(`CREATE TABLE IF NOT EXISTS creator_activity_count_baselines(snapshot_id INTEGER PRIMARY KEY REFERENCES creator_activity_snapshots(id),
      owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,result_json TEXT NOT NULL) STRICT;`)
    this.reuseCountBaselines()
    db.exec(`CREATE TABLE IF NOT EXISTS creator_activity_recoveries(run_id TEXT NOT NULL REFERENCES creator_activity_runs(run_id),
      creator_sec_uid TEXT NOT NULL,attempt INTEGER NOT NULL,recovery_json TEXT NOT NULL,PRIMARY KEY(run_id,creator_sec_uid,attempt)) STRICT;`)
  }
  /** Derive a new version from verified whole pages. Legacy samples and run history remain immutable. */
  private reuseCountBaselines():void{
    const seen=new Set<string>()
    this.db.exec('BEGIN IMMEDIATE')
    try{
      for(const row of this.db.prepare(`SELECT b.snapshot_id,b.owner_sec_uid,b.creator_sec_uid,b.result_json,s.capture_json
        FROM creator_activity_baseline_samples b JOIN creator_activity_snapshots s ON s.id=b.snapshot_id
        WHERE b.snapshot_id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) ORDER BY b.snapshot_id DESC`).all()){
        const key=`${row.owner_sec_uid}:${row.creator_sec_uid}`
        if(seen.has(key))continue;seen.add(key)
        if(this.db.prepare('SELECT 1 FROM creator_activity_count_baselines WHERE owner_sec_uid=? AND creator_sec_uid=?').get(row.owner_sec_uid,row.creator_sec_uid))continue
        const old=JSON.parse(String(row.result_json)) as CreatorBaselineResult,capture=JSON.parse(String(row.capture_json)) as CreatorActivityCapture
        let result:CreatorBaselineResult
        try{
          const accepted=acceptCreatorActivity(capture,{ownerSecUid:String(row.owner_sec_uid),secUid:String(row.creator_sec_uid),uid:capture.profile.uid,
            weekStart:capture.weekStart,weekEndExclusive:capture.weekEndExclusive})
          result=assessCreatorBaseline(accepted.capture,{version:2,limit:60},old.creatorId,old.nickname)
        }catch{continue}
        this.db.prepare('INSERT INTO creator_activity_count_baselines VALUES(?,?,?,?)').run(row.snapshot_id,row.owner_sec_uid,row.creator_sec_uid,JSON.stringify(result))
      }
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  private countBaselines(owner:string,secUid?:string):Map<string,CreatorBaselineResult>{
    const results=new Map<string,CreatorBaselineResult>()
    for(const row of this.db.prepare(`SELECT creator_sec_uid,result_json FROM creator_activity_count_baselines WHERE owner_sec_uid=?${secUid?' AND creator_sec_uid=?':''} ORDER BY snapshot_id DESC`).all(owner,...(secUid?[secUid]:[]))){
      if(!results.has(String(row.creator_sec_uid)))results.set(String(row.creator_sec_uid),JSON.parse(String(row.result_json)))
    }
    return results
  }
  status(owner: string | null): CreatorActivityState {
    if (owner !== this.owner) {
      this.owner = owner
      const row = owner ? this.db.prepare('SELECT state_json FROM creator_activity_runs WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(owner) : null
      if (row) {
        this.state = JSON.parse(String(row.state_json))
        if (this.state.phase === 'running') {this.state.phase='cancelled';this.state.currentName=null;this.state.resumeWaitUntil=this.state.waiting?.until??null;this.state.waiting=null;this.state.message='上次刷新已中断，可继续剩余博主';this.persist()}
      } else {const week=calendarWeek();this.state={phase:'idle',runId:null,message:'更新作品总数与本周动态',total:0,done:0,succeeded:0,failed:0,currentName:null,remainingIds:[],startedAt:null,weekStart:week.start,weekEndExclusive:week.endExclusive}}
    }
    return {...this.state,remainingIds:[...this.state.remainingIds],baselineReadyCount:owner?Number(this.db.prepare('SELECT COUNT(DISTINCT creator_sec_uid) AS count FROM creator_activity_count_baselines WHERE owner_sec_uid=?').get(owner)!.count):0}
  }
  private persist(): void {
    if(this.owner&&this.state.runId)this.db.prepare('INSERT INTO creator_activity_runs VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json')
      .run(this.state.runId,this.owner,JSON.stringify(this.state))
  }
  private baseline(owner:string,secUid:string):CreatorRefreshBaseline|undefined{
    return this.timeline.baseline(owner,secUid)
  }
  workTimeline(owner:string,secUid:string){return this.timeline.view(owner,secUid)}
  private comparisonBaseline(owner:string,secUid:string){
    const latest=this.baseline(owner,secUid),pending=this.integrity.pending(owner,secUid)
    if(!latest||!pending)return latest
    const accepted=this.timeline.event('snapshot',pending.baselineSnapshotId)?.baselineAfter
    // Current M and homepage count come from chronological observations; repair still bridges the unresolved old anchor.
    return {...latest,anchor:accepted?.anchor??latest.anchor,continuitySnapshotId:pending.baselineSnapshotId}
  }
  private acceptedBaseline(owner:string,secUid:string):CreatorRefreshBaseline|undefined{
    const row=this.db.prepare("SELECT id,snapshot_json,capture_json FROM creator_activity_snapshots WHERE owner_sec_uid=? AND creator_sec_uid=? AND id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) AND json_extract(snapshot_json,'$.coverage')<>'partial' AND json_extract(snapshot_json,'$.errorCode') IS NULL AND json_extract(snapshot_json,'$.workCount') IS NOT NULL ORDER BY id DESC LIMIT 1").get(owner,secUid)
    if(!row)return
    const cached=this.baselineCache.get(Number(row.id));if(cached)return cached
    const capture=JSON.parse(String(row.capture_json)) as CreatorActivityCapture
    if(!['signaldesk-creator-activity/v6','signaldesk-creator-activity/v7','signaldesk-creator-activity/v8','signaldesk-creator-activity/v9'].includes(capture.contract))return
    let fingerprint=this.fingerprintCache.get(Number(row.id))
    if(!fingerprint){fingerprint=latestWorkFingerprint(capture);this.fingerprintCache.set(Number(row.id),fingerprint)}
    if(!fingerprint.ready)return
    if(!fingerprint.latest&&!hasCompletePublicList(capture))return
    const works=currentPublicWorks(capture),anchor=[...works.values()].filter(work=>work.pinned===false).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]
    const baseline:CreatorRefreshBaseline={snapshotId:Number(row.id),workCount:(JSON.parse(String(row.snapshot_json)) as CreatorActivitySnapshot).workCount!,latest:fingerprint.latest,
      knownWorkIds:[...works.keys()],anchor:anchor?{workId:anchor.workId,publishedAt:anchor.publishedAt}:null}
    this.baselineCache.set(Number(row.id),baseline);return baseline
  }
  private schedule(owner:string,secUid:string,interval:CreatorPublicationInterval,at:Date=new Date(),priority?:CreatorPriorityState){
    const baseline=this.acceptedBaseline(owner,secUid)
    const full=this.db.prepare("SELECT checked_at FROM creator_activity_snapshots WHERE owner_sec_uid=? AND creator_sec_uid=? AND id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) AND json_extract(snapshot_json,'$.coverage')<>'partial' AND json_extract(snapshot_json,'$.errorCode') IS NULL ORDER BY id DESC LIMIT 1").get(owner,secUid)
    const check=this.db.prepare('SELECT checked_at FROM creator_activity_checks WHERE owner_sec_uid=? AND creator_sec_uid=? ORDER BY id DESC LIMIT 1').get(owner,secUid)
    const checked=[full?.checked_at,check?.checked_at].filter(Boolean).map(String).sort().at(-1)??null
    const schedule=creatorRefreshSchedule(baseline?.latest?.publishedAt??null,checked,interval.meanHours,at,priority)
    if(!baseline)schedule.due=true
    return schedule
  }
  begin(owner:string,allTargets:ActivityTarget[],creatorId?:number,resume?:boolean,requireOwnerVerification?:boolean):ActivityCommand
  begin(owner:string,allTargets:ActivityTarget[],creatorId:number|undefined,resume:boolean,requireOwnerVerification:boolean,options:ActivityOptions):ActivityCommand|null
  begin(owner: string, allTargets: ActivityTarget[], creatorId?: number, resume=false,requireOwnerVerification=false,
    options?:ActivityOptions):ActivityCommand|null {
    this.status(owner)
    if(this.state.phase==='running')throw new Error('本轮资料刷新正在进行')
    if(resume&&this.state.baselineTask)return this.beginBaseline(owner,allTargets,true,requireOwnerVerification)
    if(options?.baselineTrial)return this.beginBaseline(owner,allTargets,false,requireOwnerVerification)
    const remaining = new Set(this.state.remainingIds)
    const initialWaitUntil=resume&&this.state.resumeWaitUntil&&Date.parse(this.state.resumeWaitUntil)>Date.now()?this.state.resumeWaitUntil:undefined
    this.targets = creatorId === undefined ? resume ? allTargets.filter(item=>remaining.has(item.id)) : allTargets : allTargets.filter(item=>item.id===creatorId)
    if(!this.targets.length)throw new Error('没有需要刷新的博主')
    const requiresVerification=(target:ActivityTarget)=>!!this.integrity.pending(owner,target.secUid)||!this.acceptedBaseline(owner,target.secUid)
    const repair=resume?!!this.state.repair:options?.scope==='anomaly'||creatorId!==undefined&&requiresVerification(this.targets[0])
    if(!resume&&options?.scope==='anomaly'){
      this.targets=this.targets.filter(requiresVerification)
      if(!this.targets.length)throw Error('当前账号没有需要核验并补齐的异常博主')
    }
    // M/count use the accumulated timeline; unresolved repairs keep their original continuity anchor.
    this.targets=this.targets.map(target=>{const baseline=this.baseline(owner,target.secUid),needsBaseline=repair&&!this.acceptedBaseline(owner,target.secUid);return {...target,
      comparisonBaseline:needsBaseline?undefined:this.comparisonBaseline(owner,target.secUid),
      ...(options&&creatorId===undefined&&!repair?{baseline}:{}),...(repair?{repair:true,needsBaseline}:{})}})
    this.expectedOwnerUid=String(this.db.prepare('SELECT uid FROM following_account_owners WHERE sec_uid=?').get(owner)?.uid||'')||null
    if(requireOwnerVerification&&!this.expectedOwnerUid)throw Error('账号原生身份尚未绑定')
    this.received.clear();this.started=performance.now()
    const week=calendarWeek()
    const scope=resume?this.state.scope:options?.scope
    this.state={phase:'running',runId:'activity-'+randomBytes(12).toString('hex'),scope,repair,anomalyCount:0,message:`${repair?'核验并补齐 · ':scope?CREATOR_REFRESH_SCOPE_LABELS[scope]+' · ':''}正在读取 ${this.targets.length} 位博主的主页作品数与更新状态`,
      total:this.targets.length,done:0,succeeded:0,failed:0,currentName:null,remainingIds:this.targets.map(item=>item.id),startedAt:new Date().toISOString(),weekStart:week.start,weekEndExclusive:week.endExclusive,
      activeListRequests:0,reusedNativePages:0,observedNativeListRequests:0,excludedNonPublicCount:0,unverifiedVisibilityCount:0,ownerVerificationRequired:requireOwnerVerification,
      pacing:options?.pacing,notDueCount:0,unchangedCount:0,fullRefreshCount:0,plannedWaitingMs:0,waiting:null,mode:resume?'resume':'manual'}
    this.persist();this.changed()
    return {action:'activity' as const,runId:this.state.runId!,ownerSecUid:owner,ownerUid:this.expectedOwnerUid,targets:this.targets,
      pacing:options?.pacing,initialWaitUntil,recoveryPolicy:CREATOR_ACTIVITY_RECOVERY_POLICY,weekStart:week.start,weekEndExclusive:week.endExclusive}
  }
  private beginBaseline(owner:string,allTargets:ActivityTarget[],resume:boolean,requireOwnerVerification:boolean):ActivityCommand|null{
    const previous=resume?this.state.baselineTask:undefined,results=previous?[...previous.results]:[]
    const saved=this.countBaselines(owner),reusedCount=previous?.reusedCount??allTargets.filter(t=>saved.has(t.secUid)).length
    const ids=previous?.targetIds??allTargets.filter(t=>!saved.has(t.secUid)).map(t=>t.id),completed=new Set(results.map(r=>r.creatorId)),byId=new Map(allTargets.map(t=>[t.id,t]))
    if(!ids.length)throw Error('所有博主均已有完整的最新60条或列表末尾基线，无需重复采集')
    if(ids.some(id=>!byId.has(id)))throw Error('基线任务中的部分博主不属于当前账号')
    this.targets=ids.filter(id=>!completed.has(id)).map(id=>({...byId.get(id)!,baseline:undefined,comparisonBaseline:undefined,repair:undefined,needsBaseline:undefined}))
    if(!this.targets.length)throw Error('本轮基线试采已全部完成')
    this.expectedOwnerUid=String(this.db.prepare('SELECT uid FROM following_account_owners WHERE sec_uid=?').get(owner)?.uid||'')||null
    if(requireOwnerVerification&&!this.expectedOwnerUid)throw Error('账号原生身份尚未绑定')
    const policy:CreatorBaselinePolicy=previous?.policy??{version:2,limit:60}
    const sizes=previous?.batchSizes??baselineBatchSizes(ids.length),pacing=baselinePacing(sizes,results.length),week=calendarWeek()
    let initialWaitUntil=resume?this.state.resumeWaitUntil??undefined:undefined
    if(resume&&(!initialWaitUntil||Date.parse(initialWaitUntil)<=Date.now())){
      const boundary=sizes.slice(0,-1).reduce<number[]>((a,n)=>[...a,(a.at(-1)??0)+n],[]).includes(results.length)
      initialWaitUntil=new Date(Date.now()+(boundary?pacing.batchDelayMaxMs:pacing.authorDelayMaxMs)).toISOString()
    }
    this.received.clear();this.started=performance.now()
    this.state={phase:'running',runId:'activity-'+randomBytes(12).toString('hex'),message:'正在补齐连续作品基线，不限制发布时间跨度',
      total:ids.length,done:results.length,succeeded:results.length,failed:0,currentName:null,remainingIds:this.targets.map(t=>t.id),startedAt:new Date().toISOString(),
      weekStart:week.start,weekEndExclusive:week.endExclusive,ownerVerificationRequired:requireOwnerVerification,pacing,waiting:null,
      baselineTask:{policy,targetIds:ids,batchSizes:sizes,results,reusedCount,directoryTotal:previous?.directoryTotal??allTargets.length},mode:resume?'resume':'manual',activeListRequests:0,reusedNativePages:0,plannedWaitingMs:0}
    this.persist();this.changed()
    return {action:'activity',runId:this.state.runId!,ownerSecUid:owner,ownerUid:this.expectedOwnerUid,targets:this.targets,
      pacing,initialWaitUntil,baselinePolicy:policy,recoveryPolicy:CREATOR_ACTIVITY_RECOVERY_POLICY,weekStart:week.start,weekEndExclusive:week.endExclusive}
  }
  progress(runId: string, values: CreatorActivityProgress): CreatorActivityState {
    this.requireRun(runId)
    const input=creatorActivityProgressSchema.parse(values)
    if(input.recovery){
      if(this.state.ownerVerificationRequired&&!this.state.ownerVerification)throw Error('本轮账号尚未核验，不能自动恢复读取')
      const value=input.recovery,target=this.targets.find(t=>t.id===value.creatorId)
      if(!target||target.secUid!==value.secUid||this.received.has(target.id))throw Error('恢复记录不属于本轮待采博主')
      const started=Date.parse(value.startedAt),until=Date.parse(value.waitUntil)
      if(started<Date.parse(this.state.startedAt!)||started>Date.now()+60000||until-started<5000||until-started>10000
        ||value.completedAt&&(Date.parse(value.completedAt)<started||value.phase==='recovered'&&Date.parse(value.completedAt)<until||Date.parse(value.completedAt)>Date.now()+60000))throw Error('恢复记录时间无效')
      const prior=this.db.prepare('SELECT recovery_json FROM creator_activity_recoveries WHERE run_id=? AND creator_sec_uid=? AND attempt=?').get(runId,target.secUid,value.attempt)
      const old=prior?JSON.parse(String(prior.recovery_json)):null
      const phases={waiting:0,reconnecting:1,recovered:2,failed:2}
      if(old){
        if(value.reason!==old.reason||value.startedAt!==old.startedAt||value.waitUntil!==old.waitUntil||value.preservedPages!==old.preservedPages
          ||phases[value.phase]<phases[old.phase as keyof typeof phases]||phases[old.phase as keyof typeof phases]===2&&JSON.stringify(old)!==JSON.stringify(value))throw Error('恢复记录不得倒退或覆盖已结束记录')
      }else{
        const priorCount=Number(this.db.prepare('SELECT COUNT(*) n FROM creator_activity_recoveries WHERE run_id=? AND creator_sec_uid=?').get(runId,target.secUid)!.n)
        if(value.phase!=='waiting'||value.attempt!==priorCount+1)throw Error('恢复尝试顺序无效')
        this.state.recoveryAttempts=(this.state.recoveryAttempts??0)+1
      }
      if(value.phase==='recovered'&&old?.phase!=='recovered')this.state.recoverySucceeded=(this.state.recoverySucceeded??0)+1
      this.db.prepare('INSERT INTO creator_activity_recoveries VALUES(?,?,?,?) ON CONFLICT(run_id,creator_sec_uid,attempt) DO UPDATE SET recovery_json=excluded.recovery_json').run(runId,target.secUid,value.attempt,JSON.stringify(value))
      this.state.recovery=value;this.state.currentName=target.nickname;this.state.currentSecUid=target.secUid
      this.state.message=value.phase==='waiting'?`读取连接暂时中断，正在等待第 ${value.attempt}/2 次恢复`:value.phase==='reconnecting'?'正在重新连接并核验账号与主页':value.phase==='recovered'?`读取连接已恢复，保留 ${value.preservedPages} 页结果继续采集`:'读取连接恢复未完成，正在保存现场'
    }
    if(input.readObservation){
      const value=input.readObservation,target=this.targets.find(t=>t.id===value.creatorId)
      if(!target||target.secUid!==value.secUid)throw Error('监听记录不属于本轮博主')
      const time=Date.parse(value.capturedAt)
      if(time<Date.parse(this.state.startedAt!)||time>Date.now()+60000)throw Error('监听记录时间无效')
      const prior=this.db.prepare('SELECT observation_json FROM creator_activity_observations WHERE run_id=? AND creator_sec_uid=?').get(runId,target.secUid)
      if(prior){
        const old=JSON.parse(String(prior.observation_json)),order={prepared:0,decision:1,saved:2,released:3,failed:3}
        if(['released','failed'].includes(old.phase)&&JSON.stringify(old)!==JSON.stringify(value))throw Error('已结束的监听记录不得覆盖')
        if(time<Date.parse(old.capturedAt)||order[value.phase]<order[old.phase as keyof typeof order])throw Error('监听阶段不得倒退')
      }
      // Observations explain acquisition, never authorize account/author data.
      this.db.prepare('INSERT INTO creator_activity_observations VALUES(?,?,?,?,?) ON CONFLICT(run_id,creator_sec_uid) DO UPDATE SET captured_at=excluded.captured_at,observation_json=excluded.observation_json')
        .run(runId,this.owner!,target.secUid,value.capturedAt,JSON.stringify(value))
    }
    if(input.wait!==undefined){
      if(input.wait){
        const pacing=this.state.pacing
        if(!pacing)throw Error('本轮未配置等待策略')
        const maximum=input.wait.kind==='author'?pacing.authorDelayMaxMs:pacing.batchDelayMaxMs
        const minimum=input.wait.kind==='resume'?0:input.wait.kind==='batch'?pacing.batchDelayMinMs:pacing.authorDelayMinMs
        if(input.wait.durationMs<minimum||input.wait.durationMs>maximum
          ||Date.parse(input.wait.until)>Date.now()+maximum+2000||Date.parse(input.wait.until)<Date.now()-2000
          ||input.wait.totalBatches!==(pacing.batchSizes?.length??Math.ceil(this.state.total/pacing.batchSize))||input.wait.batchNumber>input.wait.totalBatches)throw Error('等待计划无效')
        this.state.plannedWaitingMs=(this.state.plannedWaitingMs||0)+input.wait.durationMs
        this.state.message=input.wait.kind==='batch'?`第 ${input.wait.batchNumber-1} 批已完成，正在批间休息`:input.wait.kind==='resume'?'正在完成上次中断前的等待':'正在等待下一位博主'
        this.state.currentName=null
      }
      this.state.waiting=input.wait
    }
    if(input.failureDiagnostic){
      const diagnostic=input.failureDiagnostic,target=this.targets.find(item=>item.id===diagnostic.creatorId)
      if(!target||target.secUid!==diagnostic.secUid)throw Error('失败现场不属于本轮博主')
      const captured=Date.parse(diagnostic.capturedAt)
      if(captured<Date.parse(this.state.startedAt!)||captured>Date.now()+60000)throw Error('失败现场时间无效')
      // Diagnostics are not account/author proof and cannot authorize a snapshot.
      // Store the screenshot separately from the frequently broadcast UI state.
      const prior=this.db.prepare('SELECT diagnostic_json FROM creator_activity_diagnostics WHERE run_id=? AND creator_sec_uid=?').get(runId,target.secUid)
      if(prior){
        const old=JSON.parse(String(prior.diagnostic_json))
        if(old.capturedAt!==diagnostic.capturedAt||old.errorCode!==diagnostic.errorCode||JSON.stringify(old.network)!==JSON.stringify(diagnostic.network)
          ||JSON.stringify(old.browser)!==JSON.stringify(diagnostic.browser))throw Error('首次失败现场不得改写')
        if(old.capturePhase!=='frozen'&&JSON.stringify(old)!==JSON.stringify(diagnostic))throw Error('完整失败现场不得覆盖')
      }
      this.db.prepare('INSERT INTO creator_activity_diagnostics VALUES(?,?,?,?,?) ON CONFLICT(run_id,creator_sec_uid) DO UPDATE SET diagnostic_json=excluded.diagnostic_json')
        .run(runId,this.owner!,target.secUid,diagnostic.capturedAt,JSON.stringify(diagnostic))
      this.state.failureDiagnostic={creatorId:target.id,capturedAt:diagnostic.capturedAt,errorCode:diagnostic.errorCode,
        screenshotSaved:diagnostic.screenshot!==null,pageSaved:diagnostic.page!==null,capturePhase:diagnostic.capturePhase,retainedTabId:diagnostic.retainedTabId??undefined}
      if(diagnostic.capturePhase==='frozen')this.state.message='采集已停止，正在保存失败现场；故障网页保持打开'
    }
    if(input.diagnosticSaveFailed)this.state.diagnosticSaveFailed=true
    if(input.ownerVerification){
      const proof=input.ownerVerification,start=Date.parse(this.state.startedAt!),navigation=Date.parse(proof.navigationStartedAt),observed=Date.parse(proof.observedAt)
      if(proof.runId!==runId||proof.secUid!==this.owner||proof.uid!==this.expectedOwnerUid
        ||proof.firstAuthorSecUid!==this.targets[0].secUid)throw Error('账号核验来源或身份不一致')
      if(navigation<start||observed<navigation||observed>Date.now()+60000||observed< Date.now()-120000)throw Error('账号核验来源时间无效')
      if(this.state.ownerVerification&&JSON.stringify(this.state.ownerVerification)!==JSON.stringify(proof))throw Error('同一轮账号核验来源冲突')
      if(!input.requestAudit||input.requestAudit.ownerVerificationSource!==proof.kind)throw Error('账号核验来源与请求计数不一致')
      if(proof.kind==='native-network'&&this.state.ownerVerificationRequired){
        const source=input.requestAudit.ownerSourceDiagnostics
        if(!source?.navigationBound||source.navigationFailed||source.errorCode||!source.navigationFramePresent||!source.navigationLoaderPresent
          ||!source.currentDocument?.committed||source.currentDocument.document!=='first-author'||source.currentDocument.frame!=='match'
          ||!source.requests.length||source.requests.length!==source.observedRequests||source.requests.some(request=>
            request.currentLoader!=='match'||request.currentFrame!=='match'||request.frame!=='match'||request.document!=='first-author'
            ||request.childSession||request.httpStatus!==200||request.json!=='valid'||request.identity!=='matched'||request.errorCode)){
          throw Error('账号原生响应未绑定当前已提交的作者主页')
        }
      }
    }
    if(input.requestAudit){
      if(input.requestAudit.authorHomepageNavigations>this.state.total)throw Error('作者主页导航超出本轮范围')
      const proof=input.ownerVerification??this.state.ownerVerification
      if(proof&&input.requestAudit.ownerVerificationSource!==proof.kind)throw Error('账号核验来源与请求计数不一致')
      if((input.requestAudit.recoveryOwnerGets??0)>(this.state.recoveryAttempts??0))throw Error('恢复账号核验请求超过恢复次数')
      this.state.requestAudit=input.requestAudit
    }
    if(input.ownerVerification)this.state.ownerVerification=input.ownerVerification
    if(input.stage==='preparing-context')this.state.message='正在复用或准备抖音执行页面…'
    if(input.stage==='verifying-owner')this.state.message='正在核验当前登录账号…'
    if(input.stage==='reading-author')this.state.message=this.state.baselineTask?'正在连续采集最新作品与发布时间…':'正在读取博主主页作品数与本周动态…'
    if(input.currentId!==undefined){const target=this.targets.find(item=>item.id===input.currentId);if(!target)throw new Error('本轮没有该博主');this.state.currentName=target.nickname;this.state.currentSecUid=target.secUid}
    if(input.finished){
      if(this.state.done!==this.state.total)throw new Error('本轮资料尚未全部检查')
      this.state.phase='completed';this.state.currentName=null;this.state.savedTotalMs=performance.now()-this.started
      this.state.waiting=null
      this.state.message=this.state.repair
        ?`核验并补齐结束：${this.state.fullRefreshCount||0} 位核验通过，${this.state.failed} 位未完成${this.state.anomalyCount?`，其中 ${this.state.anomalyCount} 位仍在异常组`:''}`
        :`已处理 ${this.state.succeeded} 位，其中 ${this.state.unchangedCount||0} 位未更新，${this.state.fullRefreshCount||0} 位完整核验；${this.state.failed} 位资料待补齐${this.state.anomalyCount?`；${this.state.anomalyCount} 位进入异常组，需核验并补齐`:''}${this.state.notDueCount?`，${this.state.notDueCount} 位未到期`:''}`
      if(this.state.baselineTask)this.state.message=`活跃度基线试采完成：${this.state.succeeded}/${this.state.total} 位已保存，${this.state.failed} 位未完成`
    }
    if(input.blocked){
      this.state.phase='blocked';this.state.currentName=null;this.state.resumeWaitUntil=this.state.waiting?.until??null;this.state.waiting=null;this.state.savedTotalMs=performance.now()-this.started
      const code=input.errorCode||'READ_FAILED'
      this.state.message=code.startsWith('ACCOUNT_CONTEXT_')||code.startsWith('AUTHOR_CONTEXT_')
        ?`抖音执行页面未能准备完成（${code}），已有资料保留`
        :code==='LOGIN_REQUIRED'?'抖音账号未登录，请登录后重新刷新；已有资料保留'
        :code==='OWNER_IDENTITY_MISMATCH'?'当前抖音账号与资料库不一致，请切回对应账号；已有资料保留'
        :code==='CAPTCHA_OR_SECURITY_CHALLENGE'?'抖音出现安全验证，已停止全部后续博主和批次；请在保留的网页中处理后手动继续'
        :['ACTIVITY_HTTP_401','ACTIVITY_HTTP_403','ACTIVITY_HTTP_429'].includes(code)?`抖音限制了本次访问（${code}），已停止全部后续博主和批次；已有资料保留`
        :code==='ACTIVITY_WEEK_CHANGED'?'已进入新的一周，本轮停止；重新开始会使用新的记录周期'
        :['DEBUGGER_NOT_ATTACHED','TARGET_NAVIGATED_OR_CLOSED','TARGET_UNAVAILABLE'].includes(code)?`浏览器读取连接已断开（${code}），已停止后续博主；已保存资料保留，可手动继续剩余博主`
        :code==='DEBUGGER_BUSY'?'浏览器页面已有其他调试连接，已停止本轮；请结束该连接后手动继续，已有资料保留'
        :code==='ACTIVITY_PAGE_RELEASE_FAILED'?'已保存资料，但临时网页未能结束；已停止后续博主，请检查浏览器后手动继续'
        :code==='ACTIVITY_OBSERVATION_SAVE_FAILED'?'监听诊断未能保存，本轮已停止；已有资料保留，请检查本地存储后继续'
        :code==='ACTIVITY_RECOVERY_EXHAUSTED'?'本位博主两次连接恢复后仍未稳定，已停止后续任务；已保存资料保留，可手动继续'
        :code==='ACTIVITY_RECOVERY_REQUEST_UNCERTAIN'?'连接已恢复，但未能确认中断请求的结果，已停止以避免重复请求；已保存资料保留'
        :code==='ACTIVITY_RECOVERY_USER_DETACHED'?'浏览器读取连接被手动结束，已停止后续任务；已保存资料保留'
        :code==='ACTIVITY_RECOVERY_PAGE_CHANGED'?'恢复时发现主页已变化，已停止后续任务；已保存资料保留'
        :code==='ACTIVITY_RECOVERY_PAGE_UNAVAILABLE'?'恢复时目标主页不可用，已停止后续任务；已保存资料保留'
        :`资料刷新已停止（${code}），已有资料保留`
      if(this.state.diagnosticSaveFailed)this.state.message+='；失败现场保存未完成'
      else if(this.state.failureDiagnostic)this.state.message+=this.state.failureDiagnostic.screenshotSaved&&this.state.failureDiagnostic.pageSaved?'；失败现场已保存':'；失败诊断已保存，部分网页现场未取得'
      if(this.state.failureDiagnostic?.retainedTabId)this.state.message+='；故障网页已保留，请勿刷新或关闭'
    }
    this.persist();this.changed();return this.status(this.owner)
  }
  private requireRun(runId: string): void {if(this.state.phase!=='running'||this.state.runId!==runId)throw new Error('资料刷新会话已结束')}
  receive(runId: string, creatorId: number, input: unknown, errorCode?: string): CreatorActivityState {
    this.requireRun(runId)
    if(this.state.ownerVerificationRequired&&!this.state.ownerVerification)throw Error('本轮登录账号尚未核验，拒绝作者资料入库')
    const target=this.targets.find(item=>item.id===creatorId);if(!target)throw new Error('本轮没有该博主')
    if(this.received.has(creatorId))throw new Error('该博主的本轮结果已经保存')
    if(this.state.baselineTask)return this.receiveBaseline(runId,target,input,errorCode)
    if((input as {contract?:string})?.contract==='signaldesk-activity-unchanged/v1')return this.receiveUnchanged(runId,target,input)
    const accepted=input===undefined?null:acceptCreatorActivity(input,{ownerSecUid:this.owner!,secUid:target.secUid,uid:target.uid,weekStart:this.state.weekStart,weekEndExclusive:this.state.weekEndExclusive,repair:target.repair})
    const comparison=accepted&&target.comparisonBaseline?compareCreatorContinuity(accepted.capture,target.comparisonBaseline):null
    const fullSuccess=!!accepted&&!accepted.snapshot.errorCode&&accepted.snapshot.weeklyStatus!=='partial'&&accepted.snapshot.workCount!==null
    const fingerprint=target.needsBaseline&&accepted?latestWorkFingerprint(accepted.capture):null
    const baselineIncomplete=!!target.needsBaseline&&(!fullSuccess||!fingerprint?.ready||!fingerprint.latest&&!hasCompletePublicList(accepted!.capture))
    const quarantine=!!accepted&&!!comparison&&(target.repair?!(comparison.connected&&fullSuccess):comparison.reasons.length>0)
    const handledReview=quarantine&&!target.repair&&!!accepted&&!accepted.capture.errorCode&&accepted.snapshot.workCount!==null
    const error=target.repair&&quarantine?accepted?.snapshot.errorCode||'ACTIVITY_REPAIR_INCOMPLETE':baselineIncomplete?accepted?.snapshot.errorCode||errorCode||'ACTIVITY_BASELINE_INCOMPLETE':handledReview?null:accepted ? accepted.snapshot.errorCode||(accepted.snapshot.workCount===null?'PROFILE_TAB_COUNT_UNAVAILABLE':null) : errorCode||'ACTIVITY_READ_FAILED'
    const succeeded=!baselineIncomplete&&(handledReview||fullSuccess&&!quarantine)
    const before={...this.state,remainingIds:[...this.state.remainingIds]}
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(accepted){
        const saved=this.db.prepare('INSERT INTO creator_activity_snapshots(run_id,owner_sec_uid,creator_sec_uid,checked_at,snapshot_json,capture_json) VALUES(?,?,?,?,?,?)')
          .run(runId,this.owner!,target.secUid,accepted.snapshot.checkedAt,JSON.stringify(accepted.snapshot),JSON.stringify(accepted.capture))
        this.timeline.recordSnapshot(Number(saved.lastInsertRowid),accepted.capture)
        if(quarantine)this.integrity.quarantine(Number(saved.lastInsertRowid),this.owner!,target.secUid,target.comparisonBaseline!.continuitySnapshotId??target.comparisonBaseline!.snapshotId,accepted.snapshot.checkedAt,comparison!)
        else if(target.repair&&succeeded&&comparison?.connected)this.integrity.resolve(this.owner!,target.secUid,Number(saved.lastInsertRowid))
      }
      this.db.prepare('INSERT INTO creator_activity_attempts VALUES(?,?,?,?,?)').run(runId,this.owner!,target.secUid,new Date().toISOString(),error)
      this.state.done++;this.state.succeeded+=Number(succeeded);this.state.failed+=Number(!succeeded)
      if(quarantine)this.state.anomalyCount=(this.state.anomalyCount||0)+1
      else if(succeeded)this.state.fullRefreshCount=(this.state.fullRefreshCount||0)+1
      if(accepted){
        this.state.activeListRequests=(this.state.activeListRequests||0)+accepted.capture.activeApiRequests
        this.state.reusedNativePages=(this.state.reusedNativePages||0)+(accepted.capture.reusedNativePages||0)
        this.state.observedNativeListRequests=(this.state.observedNativeListRequests||0)+(accepted.capture.nativeListRequests||0)
        const seen=new Set<string>()
        for(const page of accepted.capture.pages)for(const record of page.records||[]){
          if(seen.has(record.workId)||!creatorWorkBelongsTo(record,accepted.capture.profile.uid,accepted.capture.profile.secUid))continue
          seen.add(record.workId)
          const verdict=classifyActivityVisibility(record.visibility)
          if(verdict==='unknown')this.state.unverifiedVisibilityCount=(this.state.unverifiedVisibilityCount||0)+1
          else if(verdict!=='public')this.state.excludedNonPublicCount=(this.state.excludedNonPublicCount||0)+1
        }
      }
      if(succeeded)this.state.remainingIds=this.state.remainingIds.filter(id=>id!==creatorId)
      this.state.message=this.state.repair
        ?`核验并补齐 ${this.state.done}/${this.state.total} 位 · 通过 ${this.state.fullRefreshCount||0} 位 · 待重试 ${this.state.failed} 位`
        :`已检查 ${this.state.done}/${this.state.total} 位 · 已处理 ${this.state.succeeded} 位 · 待重试 ${this.state.failed} 位${this.state.anomalyCount?` · 异常 ${this.state.anomalyCount} 位，待补齐`:''}`
      this.persist();this.db.exec('COMMIT');this.received.add(creatorId)
    }catch(error){this.db.exec('ROLLBACK');this.state=before;throw error}
    this.changed();return this.status(this.owner)
  }
  private receiveBaseline(runId:string,target:ActivityTarget,input:unknown,errorCode?:string):CreatorActivityState{
    const task=this.state.baselineTask!,before=structuredClone(this.state)
    const accepted=input===undefined?null:acceptCreatorActivity(input,{ownerSecUid:this.owner!,secUid:target.secUid,uid:target.uid,
      weekStart:this.state.weekStart,weekEndExclusive:this.state.weekEndExclusive})
    if(accepted&&Date.parse(accepted.capture.checkedAt)<Date.parse(this.state.startedAt!))throw Error('基线采集时间早于本轮开始')
    let result:CreatorBaselineResult|undefined,error=errorCode??null
    if(accepted){try{result=assessCreatorBaseline(accepted.capture,task.policy,target.id,target.nickname)}catch(e){error=e instanceof Error?e.message:'ACTIVITY_BASELINE_INCOMPLETE'}}
    else error??='ACTIVITY_BASELINE_INCOMPLETE'
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(accepted){
        const saved=this.db.prepare('INSERT INTO creator_activity_snapshots(run_id,owner_sec_uid,creator_sec_uid,checked_at,snapshot_json,capture_json) VALUES(?,?,?,?,?,?)')
          .run(runId,this.owner!,target.secUid,accepted.capture.checkedAt,JSON.stringify(accepted.snapshot),JSON.stringify(accepted.capture))
        // Failed/partial observations remain evidence; they never replace the last successful trial statistic.
        this.timeline.recordSnapshot(Number(saved.lastInsertRowid),accepted.capture)
        if(result){const table=result.version===2?'creator_activity_count_baselines':'creator_activity_baseline_samples'
          this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`).run(saved.lastInsertRowid,this.owner!,target.secUid,JSON.stringify(result))}
        this.state.activeListRequests=(this.state.activeListRequests??0)+accepted.capture.activeApiRequests
        this.state.reusedNativePages=(this.state.reusedNativePages??0)+(accepted.capture.reusedNativePages??0)
      }
      this.db.prepare('INSERT INTO creator_activity_attempts VALUES(?,?,?,?,?)').run(runId,this.owner!,target.secUid,new Date().toISOString(),result?null:error)
      this.state.done++;this.state.succeeded+=Number(!!result);this.state.failed+=Number(!result)
      if(result){task.results.push(result);this.state.remainingIds=this.state.remainingIds.filter(id=>id!==target.id)}
      this.state.message=`活跃度基线补采 ${this.state.succeeded}/${this.state.total} 位 · 已保存 ${task.results.reduce((n,r)=>n+baselineSampleCount(r),0)} 条统计样本${this.state.failed?` · ${this.state.failed} 位待继续`:''}`
      this.persist();this.db.exec('COMMIT');this.received.add(target.id)
    }catch(e){this.db.exec('ROLLBACK');this.state=before;throw e}
    this.changed();return this.status(this.owner)
  }
  private receiveUnchanged(runId:string,target:ActivityTarget,input:unknown):CreatorActivityState{
    const check=creatorActivityUnchangedSchema.parse(input),baseline=this.baseline(this.owner!,target.secUid)
    const proof=check.frontendCount,checked=Date.parse(check.checkedAt)
    if(!target.baseline||!baseline||check.baselineSnapshotId!==target.baseline.snapshotId||check.baselineSnapshotId!==baseline.snapshotId
      ||check.ownerSecUid!==this.owner||check.requestedSecUid!==target.secUid||check.authorUid!==target.uid
      ||proof.count===null||proof.count!==baseline.workCount||proof.secUid!==target.secUid
      ||proof.profileUrl!=='https://www.douyin.com/user/'+encodeURIComponent(target.secUid)||Number(proof.text.replaceAll(',',''))!==proof.count
      ||checked<Date.parse(this.state.startedAt!)||checked>Date.now()+60000||Date.parse(proof.checkedAt)<checked-120000||Date.parse(proof.checkedAt)>checked+60000)throw Error('未更新判断的计数、归属或快照不一致')
    if(check.reason==='latest-unchanged'){
      if(!check.firstPage||check.firstPage.requestCursor!==0||check.firstPage.sourceProof?.kind!=='native-network')throw Error('最新作品比对来源缺失')
      const result=acceptCreatorActivity({contract:check.firstPage.records?.some(r=>r.profileOwner)?'signaldesk-creator-activity/v9':'signaldesk-creator-activity/v8',ownerSecUid:this.owner,requestedSecUid:target.secUid,
        requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},profile:{uid:target.uid,secUid:target.secUid,workCount:null},
        frontendCount:proof,checkedAt:check.checkedAt,weekStart:this.state.weekStart,weekEndExclusive:this.state.weekEndExclusive,
        pages:[check.firstPage],errorCode:null,activeApiRequests:0,reusedNativePages:1,nativeListRequests:check.nativeListRequests,acquisitionMs:0},
        {ownerSecUid:this.owner!,secUid:target.secUid,uid:target.uid,weekStart:this.state.weekStart,weekEndExclusive:this.state.weekEndExclusive})
      const fingerprint=latestWorkFingerprint(result.capture)
      if(!fingerprint.ready||JSON.stringify(fingerprint.latest)!==JSON.stringify(baseline.latest))throw Error('最新作品已变化，不能跳过')
      const comparison=compareCreatorContinuity(result.capture,baseline)
      if(comparison&&!comparison.connected)throw Error('作品记录未衔接，不能跳过')
    }else if(check.firstPage)throw Error('仅计数比对不能附带列表证明')
    const before={...this.state,remainingIds:[...this.state.remainingIds]}
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const savedCheck=this.db.prepare('INSERT INTO creator_activity_checks(run_id,owner_sec_uid,creator_sec_uid,checked_at,baseline_snapshot_id,check_json) VALUES(?,?,?,?,?,?)')
        .run(runId,this.owner!,target.secUid,check.checkedAt,baseline.snapshotId,JSON.stringify(check))
      this.timeline.recordCheck(Number(savedCheck.lastInsertRowid),check)
      this.db.prepare('INSERT INTO creator_activity_attempts VALUES(?,?,?,?,?)').run(runId,this.owner!,target.secUid,new Date().toISOString(),null)
      this.state.done++;this.state.succeeded++;this.state.unchangedCount=(this.state.unchangedCount||0)+1
      if(check.reason==='latest-unchanged')this.state.reusedNativePages=(this.state.reusedNativePages||0)+1
      this.state.observedNativeListRequests=(this.state.observedNativeListRequests||0)+check.nativeListRequests
      this.state.remainingIds=this.state.remainingIds.filter(id=>id!==target.id)
      this.state.message=`已处理 ${this.state.done}/${this.state.total} 位 · ${this.state.unchangedCount} 位未更新，已跳过额外列表请求`
      this.persist();this.db.exec('COMMIT');this.received.add(target.id)
    }catch(error){this.db.exec('ROLLBACK');this.state=before;throw error}
    this.changed();return this.status(this.owner)
  }
  cancel(): void {
    if(this.state.phase!=='running')return
    this.state.phase='cancelled';this.state.currentName=null;this.state.resumeWaitUntil=this.state.waiting?.until??null;this.state.waiting=null;this.state.savedTotalMs=performance.now()-this.started
    this.state.message='资料刷新已取消，已成功更新的结果保留，可继续剩余博主'
    this.persist();this.changed()
  }
  rendered(runId: string): CreatorActivityState {
    if(this.started>0&&this.state.runId===runId&&this.state.phase==='completed'&&this.state.displayedTotalMs===undefined){
      this.state.displayedTotalMs=performance.now()-this.started;this.persist();this.changed()
    }
    return this.status(this.owner)
  }
  private publicationSources(owner:string,secUid?:string):NonNullable<CreatorActivityService['publicationCache']>{
    const latestSnapshot=this.db.prepare('SELECT MAX(id) AS id,COUNT(*) AS n FROM creator_activity_snapshots WHERE owner_sec_uid=?').get(owner)!
    const latestCheck=this.db.prepare('SELECT MAX(id) AS id,COUNT(*) AS n FROM creator_activity_checks WHERE owner_sec_uid=?').get(owner)!
    const reviews=this.db.prepare('SELECT COUNT(*) AS n,MAX(resolved_snapshot_id) AS resolved FROM creator_activity_reviews WHERE owner_sec_uid=?').get(owner)!
    const revision=`${latestSnapshot.id}:${latestSnapshot.n}:${latestCheck.id}:${latestCheck.n}:${reviews.n}:${reviews.resolved}`
    if(this.publicationCache?.owner===owner&&this.publicationCache.revision===revision)return this.publicationCache
    const sources=new Map<string,CreatorPublicationSource[]>()
    const add=(secUid:string,source:CreatorPublicationSource):void=>{const list=sources.get(secUid)??[];list.push(source);sources.set(secUid,list)}
    for(const row of this.db.prepare(`SELECT creator_sec_uid,capture_json FROM creator_activity_snapshots WHERE owner_sec_uid=?${secUid?' AND creator_sec_uid=?':''} AND id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) AND ((json_extract(snapshot_json,'$.coverage')<>'partial' AND json_extract(snapshot_json,'$.errorCode') IS NULL) OR id IN (SELECT snapshot_id FROM creator_activity_baseline_samples) OR id IN (SELECT snapshot_id FROM creator_activity_count_baselines)) AND json_extract(capture_json,'$.contract') IN ('signaldesk-creator-activity/v2','signaldesk-creator-activity/v3','signaldesk-creator-activity/v4','signaldesk-creator-activity/v6','signaldesk-creator-activity/v7','signaldesk-creator-activity/v8','signaldesk-creator-activity/v9') ORDER BY id`).all(owner,...(secUid?[secUid]:[]))){
      const capture=JSON.parse(String(row.capture_json)) as CreatorActivityCapture
      if(capture.ownerSecUid!==owner||capture.requestedSecUid!==row.creator_sec_uid)continue
      add(String(row.creator_sec_uid),{authorUid:capture.profile.uid,authorSecUid:capture.profile.secUid,observedAt:capture.checkedAt,pages:capture.pages,completePublicList:hasCompletePublicList(capture)})
    }
    for(const row of this.db.prepare(`SELECT creator_sec_uid,check_json FROM creator_activity_checks WHERE owner_sec_uid=?${secUid?' AND creator_sec_uid=?':''} ORDER BY id`).all(owner,...(secUid?[secUid]:[]))){
      const check=JSON.parse(String(row.check_json)) as CreatorActivityUnchanged
      if(check.ownerSecUid!==owner||check.requestedSecUid!==row.creator_sec_uid||!check.firstPage)continue
      add(String(row.creator_sec_uid),{authorUid:check.authorUid,authorSecUid:check.requestedSecUid,observedAt:check.checkedAt,pages:[check.firstPage]})
    }
    const result={owner,revision,sources,intervals:new Map<string,CreatorPublicationInterval>()}
    // A narrow read must never replace the complete account cache.
    if(!secUid)this.publicationCache=result
    return result
  }
  decorate(owner: string | null, creators: CreatorListItem[], at: Date = new Date()): CreatorListItem[] {
    const week=calendarWeek(at)
    const target=creators.length===1?new URL(creators[0].profileUrl).pathname.split('/').at(-1):undefined
    const filter=target?' AND creator_sec_uid=?':'',args=owner?[owner,...(target?[target]:[])]:[]
    const snapshots=new Map<string,CreatorActivitySnapshot[]>(),attempts=new Map<string,{time:string;error:string|null}>()
    if(owner){
      for(const row of this.db.prepare(`SELECT id,creator_sec_uid,snapshot_json FROM creator_activity_snapshots WHERE owner_sec_uid=?${filter} AND id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) AND json_extract(capture_json,'$.contract') IN ('signaldesk-creator-activity/v2','signaldesk-creator-activity/v3','signaldesk-creator-activity/v4','signaldesk-creator-activity/v6','signaldesk-creator-activity/v7','signaldesk-creator-activity/v8','signaldesk-creator-activity/v9') ORDER BY id DESC`).all(...args)){
        const key=String(row.creator_sec_uid),list=snapshots.get(key)||[]
        let snapshot=this.snapshotCache.get(Number(row.id))
        if(!snapshot){
          snapshot=JSON.parse(String(row.snapshot_json)) as CreatorActivitySnapshot
          // Retain last saved totals until a fresh frontend observation replaces them.
          // Only derive a missing legacy weekly field; do not reinterpret other stored fields.
          if(snapshot.weeklyUpdateCount===undefined){
            try{const source=this.db.prepare('SELECT capture_json FROM creator_activity_snapshots WHERE id=?').get(row.id)!
              snapshot={...snapshot,weeklyUpdateCount:acceptCreatorActivity(JSON.parse(String(source.capture_json)),{ownerSecUid:owner,secUid:key,
              uid:snapshot.authorUid,weekStart:snapshot.weekStart,weekEndExclusive:snapshot.weekEndExclusive}).snapshot.weeklyUpdateCount}}
            catch{snapshot={...snapshot,weeklyUpdateCount:null}}
          }
          this.snapshotCache.set(Number(row.id),snapshot)
        }
        list.push(snapshot);snapshots.set(key,list)
      }
      for(const row of this.db.prepare(`SELECT creator_sec_uid,attempted_at,error_code FROM creator_activity_attempts WHERE owner_sec_uid=?${filter} ORDER BY rowid DESC`).all(...args)){
        const key=String(row.creator_sec_uid);if(!attempts.has(key))attempts.set(key,{time:String(row.attempted_at),error:row.error_code?String(row.error_code):null})
      }
    }
    const publication=owner?this.publicationSources(owner,target):undefined
    const recentBaselines=new Map<string,CreatorBaselineResult>()
    if(owner)for(const row of this.db.prepare(`SELECT creator_sec_uid,result_json FROM creator_activity_baseline_samples WHERE owner_sec_uid=?${filter} ORDER BY snapshot_id DESC`).all(...args)){
      if(!recentBaselines.has(String(row.creator_sec_uid)))recentBaselines.set(String(row.creator_sec_uid),JSON.parse(String(row.result_json)))
    }
    if(owner)for(const [secUid,result] of this.countBaselines(owner,target))recentBaselines.set(secUid,result)
    return creators.map(creator=>{
      const secUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!,list=snapshots.get(secUid)||[]
      const count=list.find(item=>item.workCount!==null),current=list.find(item=>item.weekStart===week.start&&item.weeklyStatus!=='partial')||list.find(item=>item.weekStart===week.start)
      const attempt=attempts.get(secUid)
      const check=owner?this.db.prepare('SELECT run_id,checked_at,check_json,baseline_snapshot_id FROM creator_activity_checks WHERE owner_sec_uid=? AND creator_sec_uid=? ORDER BY id DESC LIMIT 1').get(owner,secUid):undefined
      const reuse=check&&(!count||String(check.checked_at)>count.checkedAt)?JSON.parse(String(check.check_json)) as {reason:'count-unchanged'|'latest-unchanged'}:null
      const basis=reuse?this.db.prepare('SELECT snapshot_json,capture_json FROM creator_activity_snapshots WHERE id=?').get(check!.baseline_snapshot_id):undefined
      const basisSnapshot=basis?JSON.parse(String(basis.snapshot_json)) as CreatorActivitySnapshot:undefined
      const observation=owner&&reuse?.reason==='count-unchanged'?this.db.prepare('SELECT observation_json FROM creator_activity_observations WHERE run_id=? AND owner_sec_uid=? AND creator_sec_uid=?').get(check!.run_id,owner,secUid):undefined
      const unavailable=observation?JSON.parse(String(observation.observation_json)).native?.availability:null
      const publicationUid=creator.nativeUid??list[0]?.authorUid??null,publicationKey=`${secUid}:${publicationUid}`
      let interval=publication?.intervals.get(publicationKey)
      if(!interval){interval=creatorPublicationInterval(publication?.sources.get(secUid)??[],publicationUid,secUid);publication?.intervals.set(publicationKey,interval)}
      const activity:CreatorActivityView={workCount:count?.workCount??null,countCheckedAt:count?.workCountCheckedAt??count?.checkedAt??null,checkedAt:current?.checkedAt??null,
        weeklyUpdateCount:current?.weeklyUpdateCount??null,
        publicCountStatus:count?'complete':'pending',
        weekStart:week.start,weekEndExclusive:week.endExclusive,latestPublishedAt:current?.latestPublishedAt??null,weeklyStatus:current?.weeklyStatus??'pending',
        lastAttemptAt:attempt?.time??null,errorCode:attempt?.error??current?.errorCode??null,
        refreshSchedule:owner?this.schedule(owner,secUid,interval,at,creator.refreshPriority):undefined,
        publicationInterval:interval,
        refreshCheck:reuse&&basisSnapshot?{checkedAt:String(check!.checked_at),reason:reuse.reason,lastFullCheckedAt:basisSnapshot.checkedAt,basisWeekStart:basisSnapshot.weekStart,
          nativeUnavailableReason:unavailable?.errorCode?nativeListUnavailableMessage(unavailable.errorCode):undefined}:undefined}
      const baseline=owner?this.acceptedBaseline(owner,secUid):undefined
      activity.baselineStatus=creator.isDemo||!owner?undefined:baseline?'ready':'missing'
      activity.recentActivity=assessRecentActivity(baseline?.latest?.publishedAt??null,activity.refreshSchedule?.lastCheckedAt??null,!!baseline&&!baseline.latest)
      const recent=recentBaselines.get(secUid)
      if(recent){
        activity.recentBaseline=recent
        const lastChecked=[recent.checkedAt,activity.refreshSchedule?.lastCheckedAt].filter(Boolean).map(String).sort().at(-1)!
        const latest=[recent.latestPublicAt,baseline?.latest?.publishedAt].filter(Boolean).map(String).sort().at(-1)??null
        activity.refreshSchedule=creatorRefreshSchedule(latest,lastChecked,recent.interval.meanHours,at,creator.refreshPriority)
        activity.recentActivity=assessRecentActivity(latest,lastChecked,!latest&&recent.stopReason==='list-end')
        activity.baselineStatus='ready'
      }
      activity.anomaly=owner?this.integrity.pending(owner,secUid):null
      if(activity.anomaly&&owner){
        const review=this.db.prepare('SELECT snapshot_id FROM creator_activity_reviews WHERE owner_sec_uid=? AND creator_sec_uid=? AND resolved_snapshot_id IS NULL ORDER BY snapshot_id DESC LIMIT 1').get(owner,secUid)
        const corrected=review?this.timeline.event('snapshot',Number(review.snapshot_id))?.comparison:null
        if(corrected)activity.anomaly={...activity.anomaly,comparison:{...activity.anomaly.comparison,previousCount:corrected.previousCount,currentCount:corrected.currentCount,
          increase:corrected.increase,newPublicWorks:corrected.newPublicWorks,overlapWorks:corrected.overlapWorks,timeBaseline:corrected.timeBaseline,sampledHistoricalWorks:corrected.sampledHistoricalWorks}}
      }
      const temporal=owner?this.timeline.state(owner,secUid):undefined
      activity.workObservation=temporal?.observation??undefined
      activity.invalidWorkCount=temporal?.works.filter(w=>w.state==='invalid').length??0
      if(activity.anomaly){activity.workCount=activity.anomaly.comparison.currentCount;activity.countCheckedAt=activity.anomaly.detectedAt}
      if(reuse&&check)activity.countCheckedAt=String(check.checked_at)
      // A new week's display can be projected from the retained baseline, but its full-check date is never advanced.
      if(reuse&&basisSnapshot&&!current){
        const capture=JSON.parse(String(basis!.capture_json)) as CreatorActivityCapture,ids=new Set<string>()
        let latest:string|null=null
        for(const page of capture.pages)for(const record of page.records||[]){
          if(!creatorWorkBelongsTo(record,basisSnapshot.authorUid,secUid)||classifyActivityVisibility(record.visibility)!=='public'||!record.publishedAt)continue
          const time=Date.parse(record.publishedAt)
          if(time>=Date.parse(week.start)&&time<Date.parse(week.endExclusive)&&time<=at.getTime()){
            ids.add(record.workId);if(!latest||time>Date.parse(latest))latest=record.publishedAt
          }
        }
        activity.weeklyUpdateCount=ids.size;activity.latestPublishedAt=latest;activity.weeklyStatus=latest?'updated':'empty'
      }
      return {...creator,nativeUid:creator.nativeUid??list[0]?.authorUid??null,activity}
    })
  }
}
