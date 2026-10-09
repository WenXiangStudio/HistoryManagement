import {afterEach,describe,expect,it,vi} from 'vitest'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {CreatorActivityService} from './creatorActivityService'
import {calendarWeek,type CreatorActivityCapture} from '../shared/creatorActivity'
import {creatorsForRefreshScope,DEFAULT_CREATOR_REFRESH_PACING} from '../shared/creatorRefreshPolicy'
const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}
const record=(n:number,publishedAt:string,pinned=false)=>({workId:String(700000000+n),authorUid:'uid',authorSecUid:'sec',publishedAt,pinned,visibility})
const anchor=record(1,'2026-10-06T01:30:00.000Z'),older=record(0,'2026-10-04T00:00:00.000Z')
const newRecords=Array.from({length:42},(_,i)=>record(43-i,new Date(Date.parse('2026-10-09T03:06:00.000Z')-i*90*60000).toISOString()))
function capture(count:number,records:ReturnType<typeof record>[],ended=false,errorCode:string|null=null):CreatorActivityCapture{
 const time=new Date().toISOString(),week=calendarWeek(),groups=Array.from({length:Math.max(1,Math.ceil(records.length/18))},(_,i)=>records.slice(i*18,(i+1)*18))
 return {contract:'signaldesk-creator-activity/v8',ownerSecUid:'owner',requestedSecUid:'sec',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},
  profile:{uid:'uid',secUid:'sec',workCount:null},frontendCount:{count,text:String(count),secUid:'sec',profileUrl:'https://www.douyin.com/user/sec',checkedAt:time,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
  checkedAt:time,weekStart:week.start,weekEndExclusive:week.endExclusive,errorCode,acquisitionMs:1,activeApiRequests:groups.length-1,reusedNativePages:1,nativeListRequests:1,
  pages:groups.map((records,i)=>({requestCursor:i*100,responseCursor:(i+1)*100,hasMore:i<groups.length-1||!ended,items:[],excludedAuthors:[],excludedNonPublic:[],records,
   sourceProof:{kind:i===0?'native-network':'active-get',endpoint:'/aweme/v1/web/aweme/post/',secUid:'sec',requestCursor:i*100,method:'GET',httpStatus:200,observedAt:time}}))}
}
function fixture(){
 vi.useFakeTimers();vi.setSystemTime('2026-10-06T04:00:00.000Z')
 const store=new FollowingDirectoryStore(':memory:'),service=new CreatorActivityService(store.db,()=>{})
 const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'}
 store.recordAccount(owner);store.selectAccount('owner')
 store.savePlanRows('directory',owner,new Date().toISOString(),[{uid:'uid',secUid:'sec',nickname:'作者',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec'}])
 const target={id:store.list()[0].id,secUid:'sec',uid:'uid',nickname:'作者'}
 store.update(target.id,{isStarred:true,note:'不能丢失'})
 const begin=(single=false)=>service.begin('owner',[target],single?target.id:undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
 const run=begin();service.receive(run.runId,target.id,capture(638,[anchor,older]));service.progress(run.runId,{finished:true})
 vi.setSystemTime('2026-10-09T04:00:00.000Z')
 const view=()=>service.decorate('owner',store.list())[0]
 return {store,service,target,begin,view}
}
afterEach(()=>vi.useRealTimers())
describe('creator anomaly quarantine and explicit continuity repair',()=>{
 it('quarantines 638 to 680 with only 18 new IDs, preserves baseline across restart, and promotes only a verified 42-work repair',()=>{
  const f=fixture();try{
   const previous=f.view(),raw=f.store.db.prepare('SELECT * FROM creator_activity_snapshots WHERE id=1').get()
   const run=f.begin();f.service.receive(run.runId,f.target.id,capture(680,newRecords.slice(0,18)));f.service.progress(run.runId,{finished:true})
   expect(f.view().activity?.anomaly?.comparison).toMatchObject({previousCount:638,currentCount:680,increase:42,newPublicWorks:18,connected:false})
   expect(f.view().activity?.publicationInterval).toEqual(previous.activity?.publicationInterval)
   expect(f.view().activity?.recentActivity).toEqual(previous.activity?.recentActivity)
   expect(f.view().activity?.workCount).toBe(680)
   expect(f.service.status('owner')).toMatchObject({done:1,succeeded:1,failed:0,anomalyCount:1,remainingIds:[]})
   expect(creatorsForRefreshScope([f.view()],'all')).toEqual([])
   const restored=new CreatorActivityService(f.store.db,()=>{})
   expect(restored.decorate('owner',f.store.list())[0].activity?.anomaly).toEqual(f.view().activity?.anomaly)
   const repair=f.begin(true)
   expect(repair.targets[0]).toMatchObject({repair:true,comparisonBaseline:{snapshotId:1,workCount:638}})
   expect(repair.targets[0].baseline).toBeUndefined()
   f.service.receive(repair.runId,f.target.id,capture(680,[...newRecords,anchor,older]));f.service.progress(repair.runId,{finished:true})
   expect(f.view().activity?.anomaly).toBeNull()
   expect(f.view().activity?.publicationInterval?.workCount).toBe(44)
   expect(f.view().activity?.recentActivity?.latestPublishedAt).toBe(newRecords[0].publishedAt)
   expect(f.store.db.prepare('SELECT * FROM creator_activity_snapshots WHERE id=1').get()).toEqual(raw)
   expect(f.view()).toMatchObject({isStarred:true,note:'不能丢失'})
   const next=f.begin();expect(next.targets[0].baseline).toMatchObject({snapshotId:3,workCount:680});f.service.cancel()
  }finally{f.store.close()}
 })
 it('keeps a failed or incomplete repair quarantined and retains its original comparison baseline',()=>{
  const f=fixture();try{
   let run=f.begin();f.service.receive(run.runId,f.target.id,capture(680,newRecords.slice(0,18)));f.service.progress(run.runId,{finished:true})
   const previous=f.view().activity?.publicationInterval
   run=f.begin(true);f.service.receive(run.runId,f.target.id,capture(680,newRecords.slice(0,36),false,'DEBUGGER_NOT_ATTACHED'));f.service.progress(run.runId,{blocked:true,errorCode:'DEBUGGER_NOT_ATTACHED'})
   expect(f.view().activity?.anomaly).not.toBeNull();expect(f.view().activity?.publicationInterval).toEqual(previous)
   const resume=f.service.begin('owner',[f.target],undefined,true,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
   expect(resume.targets[0]).toMatchObject({repair:true,comparisonBaseline:{snapshotId:1}});expect(resume.targets[0].baseline).toBeUndefined()
   f.service.cancel();expect(f.view().activity?.anomaly).not.toBeNull()
  }finally{f.store.close()}
 })
 it('detects a history gap independently of count growth and does not use an old pinned overlap as its anchor',()=>{
  const f=fixture();try{
   const run=f.begin(),pinned={...older,pinned:true}
   f.service.receive(run.runId,f.target.id,capture(639,[record(50,'2026-10-08T00:00:00.000Z'),pinned,record(51,'2026-10-03T00:00:00.000Z')]))
   expect(f.view().activity?.anomaly?.comparison).toMatchObject({increase:1,overlapWorks:1,anchorFound:false,reasons:['history-gap']})
  }finally{f.store.close()}
 })
 it.each([9,10])('applies the inclusive 10-work warning even if a %i-work addition is already connected',increase=>{
  const f=fixture();try{
   const run=f.begin();f.service.receive(run.runId,f.target.id,capture(638+increase,[...newRecords.slice(0,increase),anchor,older]))
   expect(!!f.view().activity?.anomaly).toBe(increase>=10)
  }finally{f.store.close()}
 })
 it('allows more than ten pages only during an explicit repair and retains the usual limit otherwise',()=>{
  const f=fixture();try{
   const additions=Array.from({length:200},(_,i)=>record(201-i,new Date(Date.parse('2026-10-09T03:00:00.000Z')-i*5*60000).toISOString()))
   let run=f.begin()
   expect(()=>f.service.receive(run.runId,f.target.id,capture(838,[...additions,anchor,older]))).toThrow('超出读取范围')
   f.service.receive(run.runId,f.target.id,capture(838,additions.slice(0,18)));f.service.progress(run.runId,{finished:true})
   run=f.begin(true);expect(run.targets[0].repair).toBe(true)
   f.service.receive(run.runId,f.target.id,capture(838,[...additions,anchor,older]));f.service.progress(run.runId,{finished:true})
   expect(f.view().activity?.anomaly).toBeNull();expect(f.view().activity?.publicationInterval?.workCount).toBe(202)
  }finally{f.store.close()}
 })
})
