import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { acceptCreatorActivity, calendarWeek, classifyActivityVisibility, creatorActivityProgressSchema, type CreatorActivityProgress, type CreatorActivitySnapshot, type CreatorActivityState, type CreatorActivityView } from '../shared/creatorActivity'
import type { CreatorListItem } from '../shared/contracts'

export type ActivityTarget = {id: number; secUid: string; uid: string | null; nickname: string}
export class CreatorActivityService {
  private state: CreatorActivityState
  private owner: string | null = null
  private targets: ActivityTarget[] = []
  private started = 0
  private received = new Set<number>()
  private readonly snapshotCache = new Map<number,CreatorActivitySnapshot>()
  private expectedOwnerUid:string|null=null
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
        PRIMARY KEY(run_id,creator_sec_uid)) STRICT;`)
  }
  status(owner: string | null): CreatorActivityState {
    if (owner !== this.owner) {
      this.owner = owner
      const row = owner ? this.db.prepare('SELECT state_json FROM creator_activity_runs WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(owner) : null
      if (row) {
        this.state = JSON.parse(String(row.state_json))
        if (this.state.phase === 'running') {this.state.phase='cancelled';this.state.currentName=null;this.state.message='上次刷新已中断，可继续剩余博主';this.persist()}
      } else {const week=calendarWeek();this.state={phase:'idle',runId:null,message:'更新作品总数与本周动态',total:0,done:0,succeeded:0,failed:0,currentName:null,remainingIds:[],startedAt:null,weekStart:week.start,weekEndExclusive:week.endExclusive}}
    }
    return {...this.state,remainingIds:[...this.state.remainingIds]}
  }
  private persist(): void {
    if(this.owner&&this.state.runId)this.db.prepare('INSERT INTO creator_activity_runs VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json')
      .run(this.state.runId,this.owner,JSON.stringify(this.state))
  }
  begin(owner: string, allTargets: ActivityTarget[], creatorId?: number, resume=false,requireOwnerVerification=false) {
    this.status(owner)
    if(this.state.phase==='running')throw new Error('本轮资料刷新正在进行')
    const remaining = new Set(this.state.remainingIds)
    this.targets = creatorId === undefined ? resume ? allTargets.filter(item=>remaining.has(item.id)) : allTargets : allTargets.filter(item=>item.id===creatorId)
    if(!this.targets.length)throw new Error('没有需要刷新的博主')
    this.expectedOwnerUid=String(this.db.prepare('SELECT uid FROM following_account_owners WHERE sec_uid=?').get(owner)?.uid||'')||null
    if(requireOwnerVerification&&!this.expectedOwnerUid)throw Error('账号原生身份尚未绑定')
    this.received.clear();this.started=performance.now()
    const week=calendarWeek()
    this.state={phase:'running',runId:'activity-'+randomBytes(12).toString('hex'),message:`正在读取 ${this.targets.length} 位博主的主页作品数与本周动态`,
      total:this.targets.length,done:0,succeeded:0,failed:0,currentName:null,remainingIds:this.targets.map(item=>item.id),startedAt:new Date().toISOString(),weekStart:week.start,weekEndExclusive:week.endExclusive,
      activeListRequests:0,reusedNativePages:0,observedNativeListRequests:0,excludedNonPublicCount:0,unverifiedVisibilityCount:0,ownerVerificationRequired:requireOwnerVerification}
    this.persist();this.changed()
    return {action:'activity' as const,runId:this.state.runId!,ownerSecUid:owner,ownerUid:this.expectedOwnerUid,targets:this.targets,weekStart:week.start,weekEndExclusive:week.endExclusive}
  }
  progress(runId: string, values: CreatorActivityProgress): CreatorActivityState {
    this.requireRun(runId)
    const input=creatorActivityProgressSchema.parse(values)
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
      this.state.requestAudit=input.requestAudit
    }
    if(input.ownerVerification)this.state.ownerVerification=input.ownerVerification
    if(input.stage==='preparing-context')this.state.message='正在复用或准备抖音执行页面…'
    if(input.stage==='verifying-owner')this.state.message='正在核验当前登录账号…'
    if(input.stage==='reading-author')this.state.message='正在读取博主主页作品数与本周动态…'
    if(input.currentId!==undefined){const target=this.targets.find(item=>item.id===input.currentId);if(!target)throw new Error('本轮没有该博主');this.state.currentName=target.nickname}
    if(input.finished){
      if(this.state.done!==this.state.total)throw new Error('本轮资料尚未全部检查')
      this.state.phase='completed';this.state.currentName=null;this.state.savedTotalMs=performance.now()-this.started
      this.state.message=`已确认 ${this.state.succeeded} 位，${this.state.failed} 位资料待补齐；原资料保留`
    }
    if(input.blocked){
      this.state.phase='blocked';this.state.currentName=null;this.state.savedTotalMs=performance.now()-this.started
      const code=input.errorCode||'READ_FAILED'
      this.state.message=code.startsWith('ACCOUNT_CONTEXT_')||code==='AUTHOR_CONTEXT_TIMEOUT'
        ?`抖音执行页面未能准备完成（${code}），已有资料保留`
        :code==='LOGIN_REQUIRED'?'抖音账号未登录，请登录后重新刷新；已有资料保留'
        :code==='OWNER_IDENTITY_MISMATCH'?'当前抖音账号与资料库不一致，请切回对应账号；已有资料保留'
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
    const accepted=input===undefined?null:acceptCreatorActivity(input,{ownerSecUid:this.owner!,secUid:target.secUid,uid:target.uid,weekStart:this.state.weekStart,weekEndExclusive:this.state.weekEndExclusive})
    const error=accepted ? accepted.snapshot.errorCode||(accepted.snapshot.workCount===null?'PROFILE_TAB_COUNT_UNAVAILABLE':null) : errorCode||'ACTIVITY_READ_FAILED'
    const succeeded=!!accepted&&accepted.snapshot.weeklyStatus!=='partial'&&accepted.snapshot.workCount!==null
    const before={...this.state,remainingIds:[...this.state.remainingIds]}
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(accepted)this.db.prepare('INSERT INTO creator_activity_snapshots(run_id,owner_sec_uid,creator_sec_uid,checked_at,snapshot_json,capture_json) VALUES(?,?,?,?,?,?)')
        .run(runId,this.owner!,target.secUid,accepted.snapshot.checkedAt,JSON.stringify(accepted.snapshot),JSON.stringify(accepted.capture))
      this.db.prepare('INSERT INTO creator_activity_attempts VALUES(?,?,?,?,?)').run(runId,this.owner!,target.secUid,new Date().toISOString(),error)
      this.state.done++;this.state.succeeded+=Number(succeeded);this.state.failed+=Number(!succeeded)
      if(accepted){
        this.state.activeListRequests=(this.state.activeListRequests||0)+accepted.capture.activeApiRequests
        this.state.reusedNativePages=(this.state.reusedNativePages||0)+(accepted.capture.reusedNativePages||0)
        this.state.observedNativeListRequests=(this.state.observedNativeListRequests||0)+(accepted.capture.nativeListRequests||0)
        const seen=new Set<string>()
        for(const page of accepted.capture.pages)for(const record of page.records||[]){
          if(seen.has(record.workId)||record.authorUid!==accepted.capture.profile.uid)continue
          seen.add(record.workId)
          const verdict=classifyActivityVisibility(record.visibility)
          if(verdict==='unknown')this.state.unverifiedVisibilityCount=(this.state.unverifiedVisibilityCount||0)+1
          else if(verdict!=='public')this.state.excludedNonPublicCount=(this.state.excludedNonPublicCount||0)+1
        }
      }
      if(succeeded)this.state.remainingIds=this.state.remainingIds.filter(id=>id!==creatorId)
      this.state.message=`已检查 ${this.state.done}/${this.state.total} 位 · 成功 ${this.state.succeeded} 位 · 待重试 ${this.state.failed} 位`
      this.persist();this.db.exec('COMMIT');this.received.add(creatorId)
    }catch(error){this.db.exec('ROLLBACK');this.state=before;throw error}
    this.changed();return this.status(this.owner)
  }
  cancel(): void {
    if(this.state.phase!=='running')return
    this.state.phase='cancelled';this.state.currentName=null;this.state.savedTotalMs=performance.now()-this.started
    this.state.message='资料刷新已取消，已成功更新的结果保留，可继续剩余博主'
    this.persist();this.changed()
  }
  rendered(runId: string): CreatorActivityState {
    if(this.started>0&&this.state.runId===runId&&this.state.phase==='completed'&&this.state.displayedTotalMs===undefined){
      this.state.displayedTotalMs=performance.now()-this.started;this.persist();this.changed()
    }
    return this.status(this.owner)
  }
  decorate(owner: string | null, creators: CreatorListItem[], at: Date = new Date()): CreatorListItem[] {
    const week=calendarWeek(at)
    const snapshots=new Map<string,CreatorActivitySnapshot[]>(),attempts=new Map<string,{time:string;error:string|null}>()
    if(owner){
      for(const row of this.db.prepare("SELECT id,creator_sec_uid,snapshot_json FROM creator_activity_snapshots WHERE owner_sec_uid=? AND json_extract(capture_json,'$.contract') IN ('signaldesk-creator-activity/v2','signaldesk-creator-activity/v3','signaldesk-creator-activity/v4','signaldesk-creator-activity/v6','signaldesk-creator-activity/v7') ORDER BY id DESC").all(owner)){
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
      for(const row of this.db.prepare('SELECT creator_sec_uid,attempted_at,error_code FROM creator_activity_attempts WHERE owner_sec_uid=? ORDER BY rowid DESC').all(owner)){
        const key=String(row.creator_sec_uid);if(!attempts.has(key))attempts.set(key,{time:String(row.attempted_at),error:row.error_code?String(row.error_code):null})
      }
    }
    return creators.map(creator=>{
      const secUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!,list=snapshots.get(secUid)||[]
      const count=list.find(item=>item.workCount!==null),current=list.find(item=>item.weekStart===week.start&&item.weeklyStatus!=='partial')||list.find(item=>item.weekStart===week.start)
      const attempt=attempts.get(secUid)
      const activity:CreatorActivityView={workCount:count?.workCount??null,countCheckedAt:count?.workCountCheckedAt??count?.checkedAt??null,checkedAt:current?.checkedAt??null,
        weeklyUpdateCount:current?.weeklyUpdateCount??null,
        publicCountStatus:count?'complete':'pending',
        weekStart:week.start,weekEndExclusive:week.endExclusive,latestPublishedAt:current?.latestPublishedAt??null,weeklyStatus:current?.weeklyStatus??'pending',
        lastAttemptAt:attempt?.time??null,errorCode:attempt?.error??current?.errorCode??null}
      return {...creator,nativeUid:creator.nativeUid??list[0]?.authorUid??null,activity}
    })
  }
}
