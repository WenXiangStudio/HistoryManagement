import {describe,it,expect,vi,afterEach} from 'vitest'
import {createHash} from 'node:crypto'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {CreatorActivityService} from './creatorActivityService'
import {calendarWeek,creatorActivityOwnerDiagnosticsSchema} from '../shared/creatorActivity'
function fixture(){
  const store=new FollowingDirectoryStore(':memory:')
  const creators=[{uid:null,secUid:'author-sec',nickname:'同一博主',avatarUrl:'https://example.com/a.jpg',signature:'原简介',profileUrl:'https://www.douyin.com/user/author-sec'}]
  store.accept({contract:'signaldesk-visible-following/v1',runId:'old',collectedAt:'2026-10-01T00:00:00.000Z',ownerSecUid:null,ownerNickname:'原账号',sourceUrl:'https://www.douyin.com/user/self',sourceKind:'visible-following-list',activeFollowingTab:true,listStartedAtTop:true,hasMore:true,visibleItemCount:1,creators,projectionSha256:createHash('sha256').update(JSON.stringify(creators)).digest('hex'),activeApiRequests:0,workResponseBodiesRead:0})
  store.recordAccount({secUid:'owner',uid:'owner-uid',nickname:'原账号'},{adoptLegacy:true});store.selectAccount('owner')
  const author=store.list()[0];store.update(author.id,{isStarred:true,note:'必须保留批注'})
  const target={id:author.id,secUid:'author-sec',uid:null,nickname:'同一博主'}
  const service=new CreatorActivityService(store.db,()=>{})
  const source=()=>{const week=calendarWeek();return {contract:'signaldesk-creator-activity/v2',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:'owner',requestedSecUid:'author-sec',profile:{uid:'native-author',secUid:'author-sec',workCount:224},checkedAt:new Date().toISOString(),weekStart:week.start,weekEndExclusive:week.endExclusive,pages:[{requestCursor:0,responseCursor:0,hasMore:false,excludedAuthors:[],items:[{workId:'700000001',authorUid:'native-author',authorSecUid:'author-sec',publishedAt:new Date(Date.now()-60000).toISOString(),pinned:false,publicVisible:true}]}],errorCode:null,activeApiRequests:2,acquisitionMs:20}}
  return {store,author,target,service,source}
}
afterEach(()=>vi.useRealTimers())
describe('persistent per-account metadata refresh',()=>{
  it('returns identical activity for a targeted cold read without replacing the full account publication cache',()=>{
    const f=fixture();try{
      f.store.savePlanRows('another', {uid:'owner-uid',secUid:'owner',nickname:'原账号'},new Date().toISOString(),[
        {uid:'other-uid',secUid:'other-sec',nickname:'另一位',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/other-sec'}])
      const rows=f.store.list(),other=rows.find(c=>c.profileUrl.endsWith('other-sec'))!
      const run=f.service.begin('owner',[f.target,{id:other.id,secUid:'other-sec',uid:'other-uid',nickname:other.nickname}])
      f.service.receive(run.runId,f.target.id,f.source())
      const capture=f.source()
      capture.requestedSecUid='other-sec';capture.profile={...capture.profile,uid:'other-uid',secUid:'other-sec'}
      capture.pages[0].items=capture.pages[0].items.map(item=>({...item,authorUid:'other-uid',authorSecUid:'other-sec',workId:'700000002'}))
      f.service.receive(run.runId,other.id,capture);f.service.progress(run.runId,{finished:true})
      const at=new Date(),full=f.service.decorate('owner',rows,at),fresh=new CreatorActivityService(f.store.db,()=>{})
      expect(fresh.decorate('owner',[rows[0]],at)).toEqual([full[0]])
      expect(fresh.decorate('owner',rows,at)).toEqual(full)
      expect(fresh.decorate('owner',[other],at)).toEqual(full.filter(c=>c.id===other.id))
      expect(fresh.decorate('owner',rows,at)).toEqual(full)
    }finally{f.store.close()}
  })
  it('persists bounded recovery phases, counts verification requests and preserves terminal events across restart',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]),started=Date.now(),old=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      expect(run.recoveryPolicy).toEqual({maxAttempts:2,delayMinMs:5000,delayMaxMs:10000})
      const value={creatorId:f.target.id,secUid:f.target.secUid,attempt:1,reason:'DEBUGGER_NOT_ATTACHED',startedAt:new Date(started).toISOString(),
        waitUntil:new Date(started+5000).toISOString(),preservedPages:2,phase:'waiting'} as const
      f.service.progress(run.runId,{recovery:value})
      expect(f.service.status('owner')).toMatchObject({recoveryAttempts:1,recovery:{phase:'waiting',preservedPages:2}})
      f.service.progress(run.runId,{recovery:{...value,phase:'reconnecting'}})
      const audit={contextSource:'first-author-page' as const,accountPageNavigations:0 as const,ownerVerificationGets:2,recoveryOwnerGets:1,authorHomepageNavigations:1,
        networkRequestsObserved:5,platformApiGetsObserved:4,selfGetsObserved:2,listGetsObserved:2,ownerVerificationSource:'active-get' as const,nativeOwnerRequestsObserved:0}
      f.service.progress(run.runId,{recovery:{...value,phase:'recovered',completedAt:new Date(started+5000).toISOString()},requestAudit:audit})
      expect(f.service.status('owner')).toMatchObject({recoveryAttempts:1,recoverySucceeded:1,requestAudit:{ownerVerificationGets:2,recoveryOwnerGets:1}})
      expect(()=>f.service.progress(run.runId,{recovery:value})).toThrow('倒退')
      expect(()=>f.service.progress(run.runId,{recovery:{...value,secUid:'wrong'}})).toThrow('不属于')
      expect(()=>f.service.progress(run.runId,{requestAudit:{...audit,ownerVerificationGets:3,recoveryOwnerGets:2}})).toThrow('超过恢复次数')
      f.service.progress(run.runId,{blocked:true,errorCode:'ACTIVITY_RECOVERY_EXHAUSTED'})
      const restarted=new CreatorActivityService(f.store.db,()=>{})
      expect(restarted.status('owner')).toMatchObject({recoveryAttempts:1,recoverySucceeded:1,phase:'blocked'})
      expect(f.store.db.prepare('SELECT COUNT(*) n FROM creator_activity_recoveries').get()?.n).toBe(1)
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'必须保留批注'})
    }finally{f.store.close()}
  })
  it('derives count baselines from retained complete raw pages and omits reused identities from supplementation',()=>{
    const f=fixture();try{
      const target={...f.target,uid:'native-author'},other={...target,id:-999,secUid:'other',nickname:'待补齐'}
      const run=f.service.begin('owner',[target],undefined,false,false,{baselineTrial:true})!
      const now=Date.now(),checkedAt=new Date(now).toISOString(),records=Array.from({length:65},(_,i)=>({workId:String(850000001+i),authorUid:target.uid,authorSecUid:target.secUid,
        profileOwner:{uid:target.uid,secUid:target.secUid},publishedAt:new Date(now-(400+i)*86400000).toISOString(),pinned:false,
        visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}}))
      const capture={contract:'signaldesk-creator-activity/v9',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:'owner',requestedSecUid:target.secUid,
        profile:{uid:target.uid,secUid:target.secUid,workCount:null},frontendCount:{count:999,text:'999',profileUrl:'https://www.douyin.com/user/'+target.secUid,secUid:target.secUid,checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
        checkedAt,weekStart:run.weekStart,weekEndExclusive:run.weekEndExclusive,pages:[{requestCursor:0,responseCursor:100,hasMore:true,items:[],excludedAuthors:[],excludedNonPublic:[],records,
          sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:target.secUid,requestCursor:0,httpStatus:200,observedAt:checkedAt}}],errorCode:null,activeApiRequests:1,reusedNativePages:0,nativeListRequests:0,acquisitionMs:10}
      f.service.receive(run.runId,target.id,capture);f.service.progress(run.runId,{finished:true})
      const stored=f.store.db.prepare('SELECT * FROM creator_activity_count_baselines').get()!
      // Reproduce a v1 sample whose original whole pages contain enough old works to satisfy v2.
      f.store.db.prepare('INSERT INTO creator_activity_baseline_samples VALUES(?,?,?,?)').run(stored.snapshot_id,'owner',target.secUid,JSON.stringify({creatorId:target.id,nickname:target.nickname,recentCount:0}))
      f.store.db.exec('DELETE FROM creator_activity_count_baselines')
      const oldSnapshots=f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all(),oldSamples=f.store.db.prepare('SELECT * FROM creator_activity_baseline_samples').all()
      const upgraded=new CreatorActivityService(f.store.db,()=>{})
      expect(upgraded.status('owner').baselineReadyCount).toBe(1)
      expect(upgraded.decorate('owner',f.store.list())[0].activity?.recentBaseline).toMatchObject({version:2,sampleCount:60,daysSinceLatest:400,
        interval:{meanHours:24},recentCounts:[{days:30,count:0,complete:true},{days:90,count:0,complete:true},{days:180,count:0,complete:true}]})
      expect(f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()).toEqual(oldSnapshots)
      expect(f.store.db.prepare('SELECT * FROM creator_activity_baseline_samples').all()).toEqual(oldSamples)
      new CreatorActivityService(f.store.db,()=>{})
      expect(f.store.db.prepare('SELECT COUNT(*) n FROM creator_activity_count_baselines').get()?.n).toBe(1)
      const supplement=upgraded.begin('owner',[target,other],undefined,false,false,{baselineTrial:true})!
      expect(supplement.targets.map(t=>t.id)).toEqual([other.id]);expect(supplement.baselinePolicy).toEqual({version:2,limit:60})
      expect(upgraded.status('owner')).toMatchObject({total:1,baselineTask:{reusedCount:1,directoryTotal:2}})
      expect(upgraded.status('different-owner').baselineReadyCount).toBe(0)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'必须保留批注'})
    }finally{f.store.close()}
  })
  it('stores a continuous sixty-work recent sample despite incomplete weekly coverage and resumes only remaining identities',()=>{
    const f=fixture();try{
      const other={...f.target,id:-999,secUid:'other',nickname:'下一位'},target={...f.target,uid:'native-author'}
      const run=f.service.begin('owner',[target,other],undefined,false,false,{baselineTrial:true})!
      const at=Date.now(),checkedAt=new Date(at).toISOString(),records=Array.from({length:60},(_,i)=>({workId:String(800000001+i),authorUid:'native-author',authorSecUid:target.secUid,
        profileOwner:{uid:'native-author',secUid:target.secUid},publishedAt:new Date(at-i*60000).toISOString(),pinned:false,
        visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}}))
      const capture={contract:'signaldesk-creator-activity/v9',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:'owner',requestedSecUid:target.secUid,
        profile:{uid:'native-author',secUid:target.secUid,workCount:null},frontendCount:{count:999,text:'999',profileUrl:'https://www.douyin.com/user/'+target.secUid,secUid:target.secUid,checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
        checkedAt,weekStart:run.weekStart,weekEndExclusive:run.weekEndExclusive,pages:[{requestCursor:0,responseCursor:100,hasMore:true,items:[],excludedAuthors:[],excludedNonPublic:[],records,
          sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:target.secUid,requestCursor:0,httpStatus:200,observedAt:checkedAt}}],errorCode:null,activeApiRequests:1,reusedNativePages:0,nativeListRequests:0,acquisitionMs:10}
      const saved=f.service.receive(run.runId,target.id,capture)
      expect(saved).toMatchObject({succeeded:1,failed:0,remainingIds:[other.id],baselineTask:{results:[{recentCount:60,stopReason:'limit'}]}})
      const decorated=f.service.decorate('owner',f.store.list())[0]
      expect(decorated.activity?.recentBaseline?.interval.meanHours).toBeCloseTo(1/60)
      expect(decorated).toMatchObject({isStarred:true,note:'必须保留批注',activity:{baselineStatus:'ready'}})
      expect(f.service.decorate('different-owner',f.store.list())[0].activity?.recentBaseline).toBeUndefined()
      f.service.cancel()
      const resumed=f.service.begin('owner',[target,other],undefined,true,false,{baselineTrial:true})!
      expect(resumed.targets.map(t=>t.id)).toEqual([other.id]);expect(resumed.pacing?.startIndex).toBe(1)
      expect(resumed.pacing?.batchSizes).toEqual([1,1]);expect(resumed.initialWaitUntil).toBeTruthy()
      f.service.receive(resumed.runId,other.id,undefined,'ACTIVITY_HTTP_429')
      f.service.progress(resumed.runId,{blocked:true,errorCode:'ACTIVITY_HTTP_429'})
      const restarted=new CreatorActivityService(f.store.db,()=>{})
      expect(restarted.status('owner').baselineTask?.results).toHaveLength(1)
      expect(restarted.status('owner').remainingIds).toEqual([other.id]);expect(restarted.decorate('owner',f.store.list())[0].activity?.recentBaseline?.recentCount).toBe(60)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'必须保留批注'})
    }finally{f.store.close()}
  })
  it('persists scoped observations across restart without granting author-write permission, and rejects secrets and finished-record rewrites',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target],undefined,false,true),time=new Date().toISOString()
      const observation={contract:'signaldesk-activity-observation/v1' as const,creatorId:f.target.id,secUid:f.target.secUid,capturedAt:time,
        phase:'prepared' as const,stage:'preparing-context' as const,strategy:'pending' as const,countSame:null,errorCode:null,
        milestones:[{step:'listener-ready' as const,at:time}],native:null,network:{events:[],documents:[],dropped:0,scriptExceptions:0},browser:{commands:[],connections:[],dropped:0}}
      expect(()=>f.service.progress(run.runId,{readObservation:{...observation,secUid:'other'}})).toThrow('不属于')
      expect(()=>f.service.progress(run.runId,{readObservation:{...observation,capturedAt:'2026-01-01T00:00:00.000Z'}})).toThrow('时间')
      expect(()=>f.service.progress(run.runId,{readObservation:{...observation,cookie:'secret'} as never})).toThrow()
      f.service.progress(run.runId,{readObservation:observation})
      expect(()=>f.service.receive(run.runId,f.target.id,f.source())).toThrow('尚未核验')
      const ended={...observation,phase:'failed' as const,strategy:'failed' as const,errorCode:'DEBUGGER_NOT_ATTACHED'}
      f.service.progress(run.runId,{readObservation:ended})
      expect(()=>f.service.progress(run.runId,{readObservation:observation})).toThrow('不得覆盖')
      expect(()=>f.service.progress(run.runId,{readObservation:{...ended,errorCode:'OTHER'}})).toThrow('不得覆盖')
      f.service.progress(run.runId,{blocked:true,errorCode:ended.errorCode})
      const restored=new CreatorActivityService(f.store.db,()=>{});expect(restored.status('owner').phase).toBe('blocked')
      expect(JSON.parse(String(f.store.db.prepare('SELECT observation_json FROM creator_activity_observations').get()?.observation_json))).toEqual(ended)
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_snapshots').get()?.n).toBe(0)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'必须保留批注'})
    }finally{f.store.close()}
  })
  it('accepts waiting-stage diagnostics and tells the user that a lost connection stopped remaining authors',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target],undefined,false,true)
      const failureDiagnostic={contract:'signaldesk-activity-failure/v1' as const,creatorId:f.target.id,secUid:f.target.secUid,capturedAt:new Date().toISOString(),
        errorCode:'DEBUGGER_NOT_ATTACHED',stage:'author-wait' as const,capturePhase:'frozen' as const,retainedTabId:null,
        page:null,pageError:null,screenshot:null,screenshotError:null,
        network:{events:[],documents:[],navigationRequests:[{at:new Date().toISOString(),frame:'child' as const,protocol:'custom' as const}],dropped:0,scriptExceptions:0},attempts:[],
        browser:{commands:[],connections:[{at:new Date().toISOString(),event:'detach-requested' as const,reason:null},{at:new Date().toISOString(),event:'detached' as const,reason:'target_closed' as const,expected:true}],dropped:0}}
      f.service.progress(run.runId,{failureDiagnostic})
      const state=f.service.progress(run.runId,{blocked:true,errorCode:'DEBUGGER_NOT_ATTACHED'})
      expect(state.phase).toBe('blocked');expect(state.message).toContain('浏览器读取连接已断开');expect(state.message).toContain('手动继续剩余博主')
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_snapshots').get()?.n).toBe(0)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'必须保留批注'})
    }finally{f.store.close()}
  })
  it('persists first failure immediately, then adds capture results without replacing original evidence',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target],undefined,false,true)
      const frozen={contract:'signaldesk-activity-failure/v1' as const,creatorId:f.target.id,secUid:f.target.secUid,capturedAt:new Date().toISOString(),
        errorCode:'ACTIVITY_PAGE_EXECUTION_FAILED',stage:'reading-list' as const,capturePhase:'frozen' as const,retainedTabId:2,
        page:null,pageError:null,screenshot:null,screenshotError:null,network:{events:[],documents:[],runtime:[],dropped:0,scriptExceptions:1},attempts:[]}
      f.service.progress(run.runId,{failureDiagnostic:frozen})
      expect(f.service.status('owner').message).toContain('正在保存失败现场')
      expect(JSON.parse(String(f.store.db.prepare('SELECT diagnostic_json FROM creator_activity_diagnostics').get()?.diagnostic_json)).capturePhase).toBe('frozen')
      const completed={...frozen,capturePhase:'complete' as const,completedAt:new Date().toISOString(),pageError:'UNAVAILABLE' as const,screenshot:'/9j/AA=='}
      expect(()=>f.service.progress(run.runId,{failureDiagnostic:{...completed,network:{...completed.network,scriptExceptions:2}}})).toThrow('首次失败现场')
      f.service.progress(run.runId,{failureDiagnostic:completed})
      expect(()=>f.service.progress(run.runId,{failureDiagnostic:frozen})).toThrow('完整失败现场')
      f.service.progress(run.runId,{blocked:true,errorCode:frozen.errorCode})
      const restored=new CreatorActivityService(f.store.db,()=>{}).status('owner')
      expect(restored.failureDiagnostic).toMatchObject({capturePhase:'complete',retainedTabId:2,screenshotSaved:true})
      expect(restored.message).toContain('故障网页已保留')
    }finally{f.store.close()}
  })
  it('persists bounded failure evidence before owner verification without author writes and restores its summary',()=>{
    const f=fixture();try{
      const old=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const run=f.service.begin('owner',[f.target],undefined,false,true)
      const failureDiagnostic={contract:'signaldesk-activity-failure/v1' as const,creatorId:f.target.id,secUid:f.target.secUid,capturedAt:new Date().toISOString(),
        errorCode:'ACCOUNT_NATIVE_NAVIGATION_MISMATCH',stage:'verifying-owner' as const,page:null,pageError:'UNAVAILABLE' as const,
        screenshot:'/9j/AA==',screenshotError:null,network:{events:[],documents:[],dropped:0,scriptExceptions:0},attempts:[],
        pageFailureReason:'DEBUGGER_NOT_ATTACHED' as const,
        browser:{commands:[{sequence:1,at:new Date().toISOString(),operation:'failure-page' as const,stage:'rejected' as const,elapsedMs:2,
          error:'DEBUGGER_NOT_ATTACHED' as const,exceptionClass:null,resultType:null}],connections:[{at:new Date().toISOString(),event:'detached' as const,reason:'target_closed' as const}],dropped:0}}
      expect(()=>f.service.progress(run.runId,{failureDiagnostic:{...failureDiagnostic,secUid:'other'}})).toThrow('本轮')
      expect(()=>f.service.progress(run.runId,{failureDiagnostic:{...failureDiagnostic,capturedAt:'2026-01-01T00:00:00.000Z'}})).toThrow('时间')
      expect(()=>f.service.progress(run.runId,{failureDiagnostic:{...failureDiagnostic,headers:{cookie:'secret'}} as never})).toThrow()
      f.service.progress(run.runId,{failureDiagnostic})
      expect(()=>f.service.receive(run.runId,f.target.id,f.source())).toThrow('尚未核验')
      f.service.progress(run.runId,{blocked:true,errorCode:failureDiagnostic.errorCode})
      const state=new CreatorActivityService(f.store.db,()=>{}).status('owner')
      expect(state.failureDiagnostic).toMatchObject({creatorId:f.target.id,screenshotSaved:true,pageSaved:false})
      expect(JSON.stringify(state)).not.toContain('/9j/')
      expect(state.message).toContain('部分网页现场未取得')
      expect(JSON.parse(String(f.store.db.prepare('SELECT diagnostic_json FROM creator_activity_diagnostics').get()?.diagnostic_json))).toEqual(failureDiagnostic)
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_snapshots').get()?.n).toBe(0)
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
    }finally{f.store.close()}
  })
  it('preserves source failure diagnostics across restart while refusing author writes without owner proof',()=>{
    const f=fixture();try{
      const old=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const run=f.service.begin('owner',[f.target],undefined,false,true)
      const diagnostics=creatorActivityOwnerDiagnosticsSchema.parse({contract:'signaldesk-activity-owner-diagnostics/v1',navigationBound:true,navigationFailed:false,
        navigationLoaderPresent:true,navigationFramePresent:true,observedRequests:1,documents:[],errorCode:'ACCOUNT_NATIVE_NAVIGATION_MISMATCH',
        currentDocument:{document:'first-author',committed:true,loader:'match',frame:'match'},transitions:[],
        requests:[{loader:'match',frame:'request-missing',currentLoader:'different',currentFrame:'match',document:'first-author',childSession:false,requestType:'XHR',stage:'identity-checked',
          json:'valid',identity:'matched',httpStatus:200,responseSource:'network'}]})
      const requestAudit={contextSource:'first-author-page' as const,accountPageNavigations:0 as const,ownerVerificationGets:0,authorHomepageNavigations:1,
        networkRequestsObserved:2,platformApiGetsObserved:2,selfGetsObserved:1,listGetsObserved:1,ownerVerificationSource:'pending' as const,nativeOwnerRequestsObserved:1,
        ownerSourceDiagnostics:diagnostics}
      // Diagnostics are observations; even matched IDs in them are not proof.
      f.service.progress(run.runId,{requestAudit})
      expect(()=>f.service.receive(run.runId,f.author.id,f.source())).toThrow('尚未核验')
      expect(()=>f.service.progress(run.runId,{requestAudit:{...requestAudit,nativeOwnerRequestsObserved:0}})).toThrow()
      expect(creatorActivityOwnerDiagnosticsSchema.safeParse({...diagnostics,url:'https://private.example/?cookie=secret'}).success).toBe(false)
      expect(creatorActivityOwnerDiagnosticsSchema.safeParse({...diagnostics,requests:[{...diagnostics.requests[0],loaderId:'raw-id'}]}).success).toBe(false)
      f.service.progress(run.runId,{blocked:true,errorCode:'ACCOUNT_NATIVE_NAVIGATION_MISMATCH',requestAudit})
      const reopened=new CreatorActivityService(f.store.db,()=>{}).status('owner')
      expect(reopened.requestAudit?.ownerSourceDiagnostics).toEqual(diagnostics)
      expect(reopened.phase).toBe('blocked');expect(reopened.ownerVerification).toBeUndefined()
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_snapshots').get()?.n).toBe(0)
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_attempts').get()?.n).toBe(0)
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
    }finally{f.store.close()}
  })
  it('requires a fresh run-bound owner proof before production author persistence and rejects conflicting IDs, time or counts',()=>{
    const f=fixture();try{
      const old=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const run=f.service.begin('owner',[f.target],undefined,false,true)
      expect(run.ownerUid).toBe('owner-uid')
      expect(()=>f.service.receive(run.runId,f.author.id,f.source())).toThrow('尚未核验')
      const now=new Date().toISOString(),ownerVerification={contract:'signaldesk-activity-owner/v1' as const,kind:'native-network' as const,
        runId:run.runId,uid:'owner-uid',secUid:'owner',endpoint:'/aweme/v1/web/user/profile/self/' as const,method:'GET' as const,httpStatus:200 as const,
        observedAt:now,navigationStartedAt:now,firstAuthorSecUid:f.target.secUid,tabId:2}
      const requestAudit={contextSource:'first-author-page' as const,accountPageNavigations:0 as const,ownerVerificationGets:0,authorHomepageNavigations:1,
        networkRequestsObserved:2,platformApiGetsObserved:2,selfGetsObserved:1,listGetsObserved:1,ownerVerificationSource:'native-network' as const,nativeOwnerRequestsObserved:1,
        ownerSourceDiagnostics:creatorActivityOwnerDiagnosticsSchema.parse({contract:'signaldesk-activity-owner-diagnostics/v1',navigationBound:true,navigationFailed:false,
          navigationLoaderPresent:true,navigationFramePresent:true,observedRequests:1,documents:[],transitions:[],
          currentDocument:{document:'first-author',committed:true,loader:'different',frame:'match'},
          requests:[{loader:'different',frame:'match',currentLoader:'match',currentFrame:'match',document:'first-author',childSession:false,
            requestType:'XHR',stage:'identity-checked',json:'valid',identity:'matched',httpStatus:200,responseSource:'network'}]})}
      for(const change of [{uid:'other'},{secUid:'other'},{runId:'old-run'},{firstAuthorSecUid:'other'},{observedAt:'2026-01-01T00:00:00.000Z'}]){
        expect(()=>f.service.progress(run.runId,{ownerVerification:{...ownerVerification,...change},requestAudit})).toThrow()
        expect(f.service.status('owner').ownerVerification).toBeUndefined()
      }
      expect(()=>f.service.progress(run.runId,{ownerVerification,requestAudit:{...requestAudit,ownerVerificationGets:1}})).toThrow()
      expect(()=>f.service.progress(run.runId,{ownerVerification,requestAudit:{...requestAudit,ownerSourceDiagnostics:undefined}})).toThrow('已提交')
      const validSource=requestAudit.ownerSourceDiagnostics
      for(const source of [
        {...validSource,currentDocument:{...validSource.currentDocument!,committed:false}},
        {...validSource,currentDocument:{...validSource.currentDocument!,document:'other-platform' as const}},
        {...validSource,requests:[{...validSource.requests[0],currentLoader:'different' as const}]},
        {...validSource,requests:[{...validSource.requests[0],childSession:true}]}
      ])expect(()=>f.service.progress(run.runId,{ownerVerification,requestAudit:{...requestAudit,ownerSourceDiagnostics:source}})).toThrow('已提交')
      f.service.progress(run.runId,{ownerVerification,requestAudit})
      f.service.receive(run.runId,f.author.id,f.source());f.service.progress(run.runId,{finished:true,requestAudit})
      expect(f.service.status('owner').ownerVerification).toEqual(ownerVerification)
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
      expect(new CreatorActivityService(f.store.db,()=>{}).status('owner').ownerVerification).toEqual(ownerVerification)
    }finally{f.store.close()}
  })
  it('stores bounded request counts and precise preparation messages without changing creator rows',()=>{
    const f=fixture();try{
      const before=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const command=f.service.begin('owner',[f.target])
      expect(f.service.progress(command.runId,{stage:'preparing-context'}).message).toContain('执行页面')
      expect(f.service.progress(command.runId,{stage:'verifying-owner'}).message).toContain('登录账号')
      const requestAudit={contextSource:'first-author-page' as const,accountPageNavigations:0 as const,ownerVerificationGets:1,authorHomepageNavigations:1,
        networkRequestsObserved:12,platformApiGetsObserved:3,selfGetsObserved:1,listGetsObserved:1}
      expect(f.service.progress(command.runId,{requestAudit}).requestAudit).toEqual(requestAudit)
      expect(()=>f.service.progress(command.runId,{requestAudit:{...requestAudit,authorHomepageNavigations:2}})).toThrow('超出本轮')
      expect(()=>f.service.progress(command.runId,{requestAudit:{...requestAudit,platformApiGetsObserved:99}})).toThrow()
      const blocked=f.service.progress(command.runId,{blocked:true,errorCode:'ACCOUNT_CONTEXT_TIMEOUT'})
      expect(blocked.message).toContain('执行页面未能准备完成')
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(before)
    }finally{f.store.close()}
  })
  it('persists native reuse and filters returned restrictions without modifying old rows or annotations',()=>{
    const f=fixture();try{
      const value=f.source(),old=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:68}
      const record={workId:'700000001',authorUid:'native-author',authorSecUid:'author-sec',publishedAt:value.pages[0].items[0].publishedAt,pinned:false,visibility}
      const input={...value,contract:'signaldesk-creator-activity/v6',activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,
        frontendCount:{count:18,text:'18',profileUrl:'https://www.douyin.com/user/author-sec',secUid:'author-sec',checkedAt:value.checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
        pages:[{requestCursor:0,responseCursor:0,hasMore:false,items:[],excludedAuthors:[],excludedNonPublic:[],records:[record,{...record,workId:'700000002',visibility:{...visibility,privateStatus:1}}],
          sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'author-sec',requestCursor:0,httpStatus:200,observedAt:value.checkedAt}}]}
      const run=f.service.begin('owner',[f.target]);f.service.receive(run.runId,f.author.id,input);f.service.progress(run.runId,{finished:true})
      expect(new CreatorActivityService(f.store.db,()=>{}).decorate('owner',f.store.list())[0]).toMatchObject({isStarred:true,note:'必须保留批注',activity:{workCount:18,weeklyUpdateCount:1,errorCode:null}})
      expect(f.service.status('owner')).toMatchObject({activeListRequests:0,reusedNativePages:1,observedNativeListRequests:1,excludedNonPublicCount:1})
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
    }finally{f.store.close()}
  })
  it('updates total and week together without changing original directory rows, IDs or annotations',()=>{
    const f=fixture();try{
      const before=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const run=f.service.begin('owner',[f.target]);f.service.receive(run.runId,f.author.id,f.source());f.service.progress(run.runId,{finished:true})
      expect(f.service.decorate('owner',f.store.list())[0]).toMatchObject({id:f.author.id,isStarred:true,note:'必须保留批注',activity:{workCount:1,weeklyUpdateCount:1,weeklyStatus:'updated',publicCountStatus:'complete'}})
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(before)
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM visible_directory_runs').get()?.n).toBe(1)
    }finally{f.store.close()}
  })
  it('retains last valid fields after failure, isolates owners, and resets only the current week on Monday',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]);f.service.receive(run.runId,f.author.id,f.source());f.service.progress(run.runId,{finished:true})
      const retry=f.service.begin('owner',[f.target]);f.service.receive(retry.runId,f.author.id,undefined,'ACTIVITY_HTTP_429');f.service.progress(retry.runId,{finished:true})
      expect(f.service.decorate('owner',f.store.list())[0].activity).toMatchObject({workCount:1,weeklyStatus:'updated',errorCode:'ACTIVITY_HTTP_429'})
      expect(f.service.decorate('another-owner',f.store.list())[0].activity).toMatchObject({workCount:null,weeklyStatus:'pending'})
      const next=calendarWeek().endExclusive
      expect(f.service.decorate('owner',f.store.list(),new Date(next))[0].activity).toMatchObject({workCount:1,weeklyStatus:'pending',weeklyUpdateCount:null,latestPublishedAt:null})
    }finally{f.store.close()}
  })
  it('persists unfinished targets, resumes after restart and rejects canceled or foreign reports',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]);f.service.cancel()
      expect(()=>f.service.receive(run.runId,f.author.id,f.source())).toThrow('会话')
      const restored=new CreatorActivityService(f.store.db,()=>{})
      expect(restored.status('owner')).toMatchObject({phase:'cancelled',remainingIds:[f.author.id]})
      const next=restored.begin('owner',[f.target],undefined,true),bad=f.source();bad.ownerSecUid='another-owner'
      expect(()=>restored.receive(next.runId,f.author.id,bad)).toThrow('归属')
      restored.receive(next.runId,f.author.id,f.source());restored.progress(next.runId,{finished:true})
      expect(restored.status('owner')).toMatchObject({phase:'completed',succeeded:1,remainingIds:[]})
      expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    }finally{f.store.close()}
  })
  it('derives a missing historical weekly count from stored source without rewriting rows or starting collection',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]);f.service.receive(run.runId,f.author.id,f.source());f.service.progress(run.runId,{finished:true})
      const row=f.store.db.prepare('SELECT id,snapshot_json FROM creator_activity_snapshots').get()!
      const legacy=JSON.parse(String(row.snapshot_json));delete legacy.weeklyUpdateCount
      f.store.db.prepare('UPDATE creator_activity_snapshots SET snapshot_json=? WHERE id=?').run(JSON.stringify(legacy),row.id)
      const before=f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()
      const reopened=new CreatorActivityService(f.store.db,()=>{})
      expect(reopened.decorate('owner',f.store.list())[0].activity).toMatchObject({weeklyUpdateCount:1,workCount:1})
      expect(f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()).toEqual(before)
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_runs').get()?.n).toBe(1)
    }finally{f.store.close()}
  })
  it('retains historical saved totals until a new frontend reading, without rewriting old rows',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]),value=f.source();value.pages[0].hasMore=true;value.pages[0].responseCursor=100
      value.pages[0].items.push({...value.pages[0].items[0],workId:'700000002',publishedAt:new Date(Date.parse(value.weekStart)-60000).toISOString()})
      f.service.receive(run.runId,f.author.id,value);f.service.progress(run.runId,{finished:true})
      const row=f.store.db.prepare('SELECT id,snapshot_json FROM creator_activity_snapshots').get()!
      const legacy=JSON.parse(String(row.snapshot_json));legacy.workCount=224;delete legacy.workCountSource
      f.store.db.prepare('UPDATE creator_activity_snapshots SET snapshot_json=? WHERE id=?').run(JSON.stringify(legacy),row.id)
      const before=f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()
      expect(new CreatorActivityService(f.store.db,()=>{}).decorate('owner',f.store.list())[0].activity).toMatchObject({
        workCount:224,publicCountStatus:'complete',weeklyUpdateCount:1,weeklyStatus:'updated'
      })
      expect(f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()).toEqual(before)
    }finally{f.store.close()}
  })
  it('confirms public zero from an ended list despite a positive profile total and clears the remaining target',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target]),value=f.source();value.profile.workCount=2;value.pages[0].items=[]
      value.contract='signaldesk-creator-activity/v3';f.service.receive(run.runId,f.author.id,value);f.service.progress(run.runId,{finished:true})
      expect(f.service.status('owner')).toMatchObject({succeeded:1,failed:0,remainingIds:[]})
      expect(f.service.decorate('owner',f.store.list())[0]).toMatchObject({isStarred:true,note:'必须保留批注',activity:{workCount:0,weeklyUpdateCount:0,weeklyStatus:'empty',errorCode:null}})
    }finally{f.store.close()}
  })
  it('saves a frontend total with its own observation time while weekly pagination stops early',()=>{
    const f=fixture();try{
      const value=f.source(),countTime=new Date(Date.now()-1000).toISOString()
      const input={...value,contract:'signaldesk-creator-activity/v4',activeApiRequests:1,
        frontendCount:{count:18,text:'18',profileUrl:'https://www.douyin.com/user/author-sec',secUid:'author-sec',checkedAt:countTime,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
        pages:[{...value.pages[0],hasMore:true,responseCursor:100,items:[...value.pages[0].items,
          {...value.pages[0].items[0],workId:'700000002',publishedAt:new Date(Date.parse(value.weekStart)-1000).toISOString()}]}]}
      const run=f.service.begin('owner',[f.target]);f.service.receive(run.runId,f.author.id,input);f.service.progress(run.runId,{finished:true})
      expect(f.service.status('owner')).toMatchObject({succeeded:1,failed:0,remainingIds:[]})
      const view=new CreatorActivityService(f.store.db,()=>{}).decorate('owner',f.store.list())[0]
      expect(view).toMatchObject({isStarred:true,note:'必须保留批注',activity:{workCount:18,countCheckedAt:countTime,weeklyUpdateCount:1,errorCode:null}})
    }finally{f.store.close()}
  })
})
