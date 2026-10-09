import {describe,it,expect,vi,afterEach} from 'vitest'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {CreatorActivityService} from './creatorActivityService'
import {calendarWeek,type CreatorActivityCapture} from '../shared/creatorActivity'
import {DEFAULT_CREATOR_REFRESH_PACING} from '../shared/creatorRefreshPolicy'
const target={id:-1,secUid:'sec',uid:'uid',nickname:'测试博主'}
const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}
function fixture(published='2026-09-15T00:00:00.000Z'){
  vi.useFakeTimers();vi.setSystemTime('2026-10-06T04:00:00.000Z')
  const store=new FollowingDirectoryStore(':memory:'),service=new CreatorActivityService(store.db,()=>{})
  store.recordAccount({secUid:'owner',uid:'owner-uid',nickname:'账号'});store.selectAccount('owner')
  const creator={...target,avatarUrl:null,signature:'原简介',profileUrl:'https://www.douyin.com/user/sec'}
  store.savePlanRows('directory',{secUid:'owner',uid:'owner-uid',nickname:'账号'},new Date().toISOString(),[creator])
  store.update(store.list()[0].id,{isStarred:true,note:'保留批注'})
  const actualTarget={...target,id:store.list()[0].id},week=calendarWeek()
  const time=new Date().toISOString()
  const capture:CreatorActivityCapture={contract:'signaldesk-creator-activity/v8',ownerSecUid:'owner',requestedSecUid:'sec',
    requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},profile:{uid:'uid',secUid:'sec',workCount:null},
    frontendCount:{count:628,text:'628',secUid:'sec',profileUrl:'https://www.douyin.com/user/sec',checkedAt:time,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
    checkedAt:time,weekStart:week.start,weekEndExclusive:week.endExclusive,errorCode:null,acquisitionMs:1,
    activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,pages:[{requestCursor:0,responseCursor:0,hasMore:false,items:[],excludedAuthors:[],excludedNonPublic:[],
      records:[{workId:'700000001',authorUid:'uid',authorSecUid:'sec',publishedAt:published,pinned:false,visibility}],
      sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',secUid:'sec',requestCursor:0,method:'GET',httpStatus:200,observedAt:time}}]}
  const run=service.begin('owner',[actualTarget]);service.receive(run.runId,actualTarget.id,capture);service.progress(run.runId,{finished:true})
  vi.setSystemTime('2026-10-07T04:00:00.000Z')
  const optimized=()=>service.begin('owner',[actualTarget],undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
  const unchanged=(reason='count-unchanged')=>({contract:'signaldesk-activity-unchanged/v1',ownerSecUid:'owner',requestedSecUid:'sec',authorUid:'uid',
    baselineSnapshotId:1,checkedAt:new Date().toISOString(),frontendCount:{...capture.frontendCount,checkedAt:new Date().toISOString()},reason,nativeListRequests:reason==='latest-unchanged'?1:0,
    ...(reason==='latest-unchanged'?{firstPage:{...capture.pages[0],sourceProof:{...capture.pages[0].sourceProof,observedAt:new Date().toISOString()}}}:{})})
  return {store,service,target:actualTarget,capture,optimized,unchanged}
}
afterEach(()=>vi.useRealTimers())
describe('persistent optimized creator refresh',()=>{
  it('recomputes accumulated publication intervals after new snapshots and native check pages while retaining old works',()=>{
    const f=fixture();try{
      const interval=()=>f.service.decorate('owner',f.store.list())[0].activity!.publicationInterval!
      expect(interval()).toMatchObject({workCount:1,meanHours:null})
      for(const [workId,publishedAt] of [['700000002','2026-09-17T00:00:00.000Z'],['700000003','2026-09-19T00:00:00.000Z']]){
        const time=new Date().toISOString(),run=f.service.begin('owner',[f.target],f.target.id)!
        const capture={...f.capture,checkedAt:time,frontendCount:{...f.capture.frontendCount!,checkedAt:time},
          pages:[{...f.capture.pages[0],records:[{...f.capture.pages[0].records![0],workId,publishedAt},...(workId==='700000003'?[{...f.capture.pages[0].records![0],workId:'700000002',publishedAt:'2026-09-17T00:00:00.000Z'}]:[]),f.capture.pages[0].records![0]],
            sourceProof:{...f.capture.pages[0].sourceProof!,observedAt:time}}]}
        f.service.receive(run.runId,f.target.id,capture);f.service.progress(run.runId,{finished:true})
      }
      expect(interval()).toMatchObject({workCount:3,gapCount:2,meanHours:48})
      const run=f.optimized(),baseline=run.targets[0].baseline!,time=new Date().toISOString()
      const latest={...f.unchanged('latest-unchanged'),baselineSnapshotId:baseline.snapshotId,
        firstPage:{...f.capture.pages[0],sourceProof:{...f.capture.pages[0].sourceProof!,observedAt:time},records:[
          {...f.capture.pages[0].records![0],workId:'700000003',publishedAt:'2026-09-19T00:00:00.000Z'},
          {...f.capture.pages[0].records![0],workId:'700000004',publishedAt:'2026-09-14T00:00:00.000Z'}]}}
      f.service.receive(run.runId,f.target.id,latest);f.service.progress(run.runId,{finished:true})
      expect(interval()).toMatchObject({workCount:4,gapCount:3,meanHours:40})
      const restored=new CreatorActivityService(f.store.db,()=>{})
      expect(restored.decorate('owner',f.store.list())[0].activity!.publicationInterval).toEqual(interval())
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_snapshots').get()!.n).toBe(3)
      expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'保留批注'})
    }finally{f.store.close()}
  })
  it('includes not-due creators in batch refreshes while retaining their baselines and pacing',()=>{
    const f=fixture();try{
      vi.setSystemTime('2026-10-06T12:00:00.000Z')
      expect(f.service.decorate('owner',f.store.list())[0].activity?.refreshSchedule?.due).toBe(false)
      const manual=f.optimized();expect(manual.targets).toHaveLength(1);expect(manual.targets[0].baseline).toMatchObject({snapshotId:1,workCount:628})
      expect(manual.pacing).toEqual(DEFAULT_CREATOR_REFRESH_PACING)
      expect(f.service.status('owner')).toMatchObject({total:1,notDueCount:0,phase:'running',mode:'manual'})
      f.service.cancel()
      vi.setSystemTime('2026-10-09T04:00:00.000Z')
      expect(f.optimized().targets).toHaveLength(1)
    }finally{f.store.close()}
  })
  it('saves an unchanged check without creating a fake full snapshot or changing annotations',()=>{
    const f=fixture();try{
      const old=f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all(),creators=f.store.db.prepare('SELECT * FROM visible_directory_creators').all()
      const run=f.optimized();f.service.receive(run.runId,f.target.id,f.unchanged());f.service.progress(run.runId,{finished:true})
      expect(f.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()).toEqual(old)
      expect(f.store.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(creators)
      expect(f.service.status('owner')).toMatchObject({succeeded:1,unchangedCount:1,fullRefreshCount:0,activeListRequests:0})
      const view=f.service.decorate('owner',f.store.list())[0]
      expect(view.activity).toMatchObject({checkedAt:'2026-10-06T04:00:00.000Z',countCheckedAt:'2026-10-07T04:00:00.000Z',
        refreshCheck:{reason:'count-unchanged',lastFullCheckedAt:'2026-10-06T04:00:00.000Z'},refreshSchedule:{tier:'unknown',intervalDays:1,due:false}})
      expect(view).toMatchObject({isStarred:true,note:'保留批注'})
      const restored=new CreatorActivityService(f.store.db,()=>{})
      expect(restored.status('owner').unchangedCount).toBe(1)
      expect(restored.decorate('owner',f.store.list())[0].activity?.refreshCheck?.reason).toBe('count-unchanged')
    }finally{f.store.close()}
  })
  it('validates native latest-work proof and refuses a changed work, count, author, time or basis',()=>{
    const f=fixture();try{
      const run=f.optimized()
      for(const update of [{ownerSecUid:'other'},{authorUid:'other'},{baselineSnapshotId:2},{checkedAt:'2026-01-01T00:00:00.000Z'},
        {frontendCount:{...f.unchanged().frontendCount,count:629,text:'629'}}])expect(()=>f.service.receive(run.runId,f.target.id,{...f.unchanged(),...update})).toThrow()
      const latest=f.unchanged('latest-unchanged')
      const changed={...latest,firstPage:{...latest.firstPage,records:[{...f.capture.pages[0].records![0],workId:'700000002'}]}}
      expect(()=>f.service.receive(run.runId,f.target.id,changed)).toThrow('最新作品已变化')
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM creator_activity_checks').get()?.n).toBe(0)
      f.service.receive(run.runId,f.target.id,latest)
      expect(f.service.status('owner')).toMatchObject({unchangedCount:1,reusedNativePages:1})
      expect(()=>f.service.receive(run.runId,f.target.id,latest)).toThrow('已经保存')
    }finally{f.store.close()}
  })
  it('keeps full verification mandatory for a single-card refresh',()=>{
    const f=fixture();try{
      const run=f.service.begin('owner',[f.target],f.target.id,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
      expect(run.targets[0].baseline).toBeUndefined()
      expect(()=>f.service.receive(run.runId,f.target.id,f.unchanged())).toThrow()
    }finally{f.store.close()}
  })
  it('persists valid waits, refuses out-of-range intervals, and restores interrupted work for explicit resume',()=>{
    const f=fixture();try{
      const run=f.optimized(),wait={kind:'author' as const,until:new Date(Date.now()+3000).toISOString(),durationMs:3000,batchNumber:1,totalBatches:1}
      f.service.progress(run.runId,{wait});expect(f.service.status('owner').plannedWaitingMs).toBe(3000)
      expect(()=>f.service.progress(run.runId,{wait:{...wait,durationMs:500}})).toThrow('等待计划无效')
      const restored=new CreatorActivityService(f.store.db,()=>{})
      expect(restored.status('owner')).toMatchObject({phase:'cancelled',remainingIds:[f.target.id],waiting:null})
      const resumed=restored.begin('owner',[f.target],undefined,true,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
      expect(resumed.targets).toHaveLength(1);expect(resumed.initialWaitUntil).toBe(wait.until)
    }finally{f.store.close()}
  })
  it('can carry an unchanged historical basis across weeks without pretending to have performed a new full check',()=>{
    const f=fixture();try{
      vi.setSystemTime('2026-10-12T04:00:00.000Z')
      const run=f.optimized();f.service.receive(run.runId,f.target.id,f.unchanged());f.service.progress(run.runId,{finished:true})
      const view=f.service.decorate('owner',f.store.list())[0].activity!
      expect(view.weeklyUpdateCount).toBe(0);expect(view.weeklyStatus).toBe('empty');expect(view.checkedAt).toBeNull()
      expect(view.refreshCheck?.lastFullCheckedAt).toBe('2026-10-06T04:00:00.000Z')
    }finally{f.store.close()}
  })
})
