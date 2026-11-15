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
function fixture(withBaseline=true){
 vi.useFakeTimers();vi.setSystemTime('2026-10-06T04:00:00.000Z')
 const store=new FollowingDirectoryStore(':memory:'),service=new CreatorActivityService(store.db,()=>{})
 const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'}
 store.recordAccount(owner);store.selectAccount('owner')
 store.savePlanRows('directory',owner,new Date().toISOString(),[{uid:'uid',secUid:'sec',nickname:'作者',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec'}])
 const target={id:store.list()[0].id,secUid:'sec',uid:'uid',nickname:'作者'}
 store.update(target.id,{isStarred:true,note:'不能丢失'})
 const begin=(single=false)=>service.begin('owner',[target],single?target.id:undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
 if(withBaseline){const run=begin();service.receive(run.runId,target.id,capture(638,[anchor,older]));service.progress(run.runId,{finished:true})}
 vi.setSystemTime('2026-10-09T04:00:00.000Z')
 const view=()=>service.decorate('owner',store.list())[0]
 return {store,service,target,begin,view}
}
afterEach(()=>vi.useRealTimers())
describe('creator anomaly quarantine and explicit continuity repair',()=>{
 it('builds an account baseline from its profile works even when the primary author differs, retains source authors and supports later time counting',()=>{
  const f=fixture(false);try{
   const ownList=(value:CreatorActivityCapture):CreatorActivityCapture=>({...value,contract:'signaldesk-creator-activity/v9',pages:value.pages.map(p=>({...p,
    records:p.records!.map(r=>({...r,authorUid:'primary-uid',authorSecUid:'primary-sec',profileOwner:{uid:'uid',secUid:'sec'}}))}))})
   let run=f.service.begin('owner',[f.target],undefined,false,false,{scope:'anomaly'})!
   const initial=ownList(capture(2,[anchor,older],true))
   f.service.receive(run.runId,f.target.id,initial);f.service.progress(run.runId,{finished:true})
   expect(f.view().activity).toMatchObject({baselineStatus:'ready',publicationInterval:{workCount:2},anomaly:null})
   expect(f.service.status('owner')).toMatchObject({succeeded:1,failed:0,remainingIds:[]})
   const timeline=f.service.workTimeline('owner','sec')
   expect(timeline.works).toHaveLength(2)
   expect(timeline.works[0].sourceAuthor).toEqual({uid:'primary-uid',secUid:'primary-sec'})
   const raw=JSON.parse(String(f.store.db.prepare('SELECT capture_json FROM creator_activity_snapshots ORDER BY id DESC LIMIT 1').get()!.capture_json))
   expect(raw.pages[0].records[0].authorUid).toBe('primary-uid')
   vi.setSystemTime('2026-10-10T04:00:00Z')
   run=f.begin();f.service.receive(run.runId,f.target.id,ownList(capture(3,[record(50,'2026-10-10T03:00:00Z'),anchor,older],true)));f.service.progress(run.runId,{finished:true})
   expect(f.view().activity?.workObservation).toMatchObject({newWorkIds:[String(700000050)],countChange:1})
   expect(f.view().activity?.publicationInterval?.workCount).toBe(3)
   const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'}
   f.store.savePlanRows('second-profile',owner,new Date().toISOString(),[{uid:'second-uid',secUid:'second-sec',nickname:'另一共创账号',avatarUrl:null,signature:'',profileUrl:'https://www.douyin.com/user/second-sec'}])
   const second=f.store.list().find(c=>c.profileUrl.endsWith('/second-sec'))!,secondTarget={id:second.id,secUid:'second-sec',uid:'second-uid',nickname:second.nickname}
   run=f.service.begin('owner',[secondTarget],second.id)!
   const shared=capture(2,[anchor,older],true)
   f.service.receive(run.runId,second.id,{...shared,contract:'signaldesk-creator-activity/v9',requestedSecUid:'second-sec',profile:{uid:'second-uid',secUid:'second-sec',workCount:null},
    frontendCount:{...shared.frontendCount!,secUid:'second-sec',profileUrl:'https://www.douyin.com/user/second-sec'},
    pages:shared.pages.map(p=>({...p,sourceProof:{...p.sourceProof!,secUid:'second-sec'},records:p.records!.map(r=>({...r,authorUid:'primary-uid',authorSecUid:'primary-sec',profileOwner:{uid:'second-uid',secUid:'second-sec'}}))}))})
   f.service.progress(run.runId,{finished:true})
   expect(f.service.workTimeline('owner','second-sec').works).toHaveLength(2)
   expect(f.service.workTimeline('owner','sec').works).toHaveLength(3)
   const restarted=new CreatorActivityService(f.store.db,()=>{})
   expect(restarted.decorate('owner',f.store.list())[0].activity?.baselineStatus).toBe('ready')
   expect(f.store.list().find(c=>c.id===f.target.id)).toMatchObject({isStarred:true,note:'不能丢失'})
  }finally{f.store.close()}
 })
 it('keeps a new creator in review through a failed first capture and restart, then creates a baseline without treating the first history as newly published',()=>{
  const f=fixture(false);try{
   expect(f.view().activity).toMatchObject({baselineStatus:'missing',anomaly:null})
   expect(creatorsForRefreshScope([f.view()],'anomaly')).toHaveLength(1)
   expect(creatorsForRefreshScope([f.view()],'all')).toEqual([])
   let run=f.service.begin('owner',[f.target],undefined,false,false,{scope:'anomaly'})!
   expect(run.targets[0]).toMatchObject({repair:true,needsBaseline:true})
   expect(run.targets[0].comparisonBaseline).toBeUndefined()
   f.service.receive(run.runId,f.target.id,capture(2,[anchor],true,'ACTIVITY_REQUEST_TIMEOUT'));f.service.progress(run.runId,{finished:true})
   expect(f.service.status('owner')).toMatchObject({succeeded:0,failed:1,remainingIds:[f.target.id]})
   const restored=new CreatorActivityService(f.store.db,()=>{})
   expect(restored.decorate('owner',f.store.list())[0].activity?.baselineStatus).toBe('missing')
   run=restored.begin('owner',[f.target],undefined,true,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
   expect(run.targets[0].comparisonBaseline).toBeUndefined()
   restored.receive(run.runId,f.target.id,capture(2,[anchor,older],true));restored.progress(run.runId,{finished:true})
   const result=restored.decorate('owner',f.store.list())[0]
   expect(result.activity).toMatchObject({baselineStatus:'ready',anomaly:null})
   expect(creatorsForRefreshScope([result],'anomaly')).toEqual([])
   expect(creatorsForRefreshScope([result],'all')).toHaveLength(1)
   expect(f.store.db.prepare('SELECT COUNT(*) n FROM creator_activity_reviews').get()?.n).toBe(0)
   expect(f.store.list()[0]).toMatchObject({isStarred:true,note:'不能丢失'})
  }finally{f.store.close()}
 })
 it.each([0,1])('accepts a verified %i-work initial baseline even though its average publication interval is unknown',count=>{
  const f=fixture(false);try{
   const run=f.service.begin('owner',[f.target],f.target.id)!
   expect(run.targets[0]).toMatchObject({repair:true,needsBaseline:true})
   f.service.receive(run.runId,f.target.id,capture(count,count?[anchor]:[],true));f.service.progress(run.runId,{finished:true})
   expect(f.view().activity).toMatchObject({baselineStatus:'ready',publicationInterval:{meanHours:null}})
   expect(creatorsForRefreshScope([f.view()],'anomaly')).toEqual([])
  }finally{f.store.close()}
 })
 it('does not establish a baseline from an empty result that disagrees with the homepage count',()=>{
  const f=fixture(false);try{
   const run=f.service.begin('owner',[f.target],f.target.id)!
   f.service.receive(run.runId,f.target.id,capture(10,[],true));f.service.progress(run.runId,{finished:true})
   expect(f.view().activity?.baselineStatus).toBe('missing')
   expect(f.service.status('owner')).toMatchObject({succeeded:0,failed:1,remainingIds:[f.target.id]})
  }finally{f.store.close()}
 })
 it('does not accept foreign-author publications as the creator baseline even when the list count matches the homepage',()=>{
  const f=fixture(false);try{
   const run=f.service.begin('owner',[f.target],f.target.id)!
   const value=capture(2,[anchor,older],true)
   value.pages[0].records=value.pages[0].records!.map(r=>({...r,authorUid:'foreign-uid',authorSecUid:'foreign-sec'}))
   f.service.receive(run.runId,f.target.id,value);f.service.progress(run.runId,{finished:true})
   expect(f.view().activity?.baselineStatus).toBe('missing')
   expect(f.service.status('owner')).toMatchObject({succeeded:0,failed:1})
  }finally{f.store.close()}
 })
 it('repairs multiple anomalies in one paced command, excludes normal creators, retains incomplete repairs for resume, and preserves directory annotations',()=>{
  const f=fixture();try{
   const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'}
   f.store.savePlanRows('added',owner,new Date().toISOString(),[
    {uid:'uid-two',secUid:'sec-two',nickname:'第二位',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec-two'},
    {uid:'uid-normal',secUid:'sec-normal',nickname:'正常作者',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec-normal'}])
   const second=f.store.list().find(c=>c.profileUrl.endsWith('/sec-two'))!,normal=f.store.list().find(c=>c.profileUrl.endsWith('/sec-normal'))!
   const target={id:second.id,secUid:'sec-two',uid:'uid-two',nickname:second.nickname}
   const normalTarget={id:normal.id,secUid:'sec-normal',uid:'uid-normal',nickname:normal.nickname}
   f.store.update(target.id,{isStarred:true,note:'第二位批注'})
   const secondCapture=(value:CreatorActivityCapture):CreatorActivityCapture=>({...value,requestedSecUid:'sec-two',profile:{...value.profile,uid:'uid-two',secUid:'sec-two'},
    frontendCount:value.frontendCount?.count!=null?{...value.frontendCount,secUid:'sec-two',profileUrl:'https://www.douyin.com/user/sec-two'}:value.frontendCount,
    pages:value.pages.map(page=>({...page,records:page.records?.map(r=>({...r,authorUid:'uid-two',authorSecUid:'sec-two'})),sourceProof:page.sourceProof?{...page.sourceProof,secUid:'sec-two'}:undefined}))})
   let run=f.service.begin('owner',[target],target.id)!
   f.service.receive(run.runId,target.id,secondCapture(capture(638,[anchor,older])));f.service.progress(run.runId,{finished:true})
   run=f.service.begin('owner',[normalTarget],normalTarget.id)!
   const normalCapture=capture(638,[anchor,older])
   f.service.receive(run.runId,normalTarget.id,{...normalCapture,requestedSecUid:'sec-normal',profile:{...normalCapture.profile,uid:'uid-normal',secUid:'sec-normal'},
    frontendCount:{...normalCapture.frontendCount!,secUid:'sec-normal',profileUrl:'https://www.douyin.com/user/sec-normal'},
    pages:normalCapture.pages.map(page=>({...page,records:page.records!.map(r=>({...r,authorUid:'uid-normal',authorSecUid:'sec-normal'})),sourceProof:{...page.sourceProof!,secUid:'sec-normal'}}))})
   f.service.progress(run.runId,{finished:true})
   const directoryBefore=f.store.db.prepare('SELECT * FROM visible_directory_creators ORDER BY id').all()
   run=f.service.begin('owner',[f.target,target],undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
   f.service.receive(run.runId,f.target.id,capture(680,newRecords.slice(0,18)))
   f.service.receive(run.runId,target.id,secondCapture(capture(680,newRecords.slice(0,18))))
   f.service.progress(run.runId,{finished:true})
   const targets=[f.target,target,normalTarget]
   run=f.service.begin('owner',targets,undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING,scope:'anomaly'})!
   expect(run.targets.map(t=>t.id)).toEqual([f.target.id,target.id])
   expect(run.pacing).toEqual(DEFAULT_CREATOR_REFRESH_PACING)
   for(const t of run.targets){expect(t.repair).toBe(true);expect(t.baseline).toBeUndefined();expect(t.comparisonBaseline?.workCount).toBe(680);expect(t.comparisonBaseline?.anchor?.workId).toBe(anchor.workId)}
   expect(f.service.status('owner')).toMatchObject({scope:'anomaly',repair:true,total:2})
   f.service.receive(run.runId,f.target.id,capture(680,[...newRecords,anchor,older]))
   f.service.receive(run.runId,target.id,secondCapture(capture(680,newRecords.slice(0,36))))
   f.service.progress(run.runId,{finished:true})
   expect(f.service.status('owner')).toMatchObject({succeeded:1,failed:1,fullRefreshCount:1,remainingIds:[target.id]})
   expect(f.service.status('owner').message).toContain('1 位核验通过，1 位未完成')
   expect(f.view().activity?.anomaly).toBeNull()
   expect(f.service.decorate('owner',f.store.list()).find(c=>c.id===target.id)?.activity?.anomaly).toBeTruthy()
   f.service.cancel()
   const restored=new CreatorActivityService(f.store.db,()=>{})
   const resumed=restored.begin('owner',targets,undefined,true,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
   expect(resumed.targets).toHaveLength(1);expect(resumed.targets[0]).toMatchObject({id:target.id,repair:true,comparisonBaseline:{workCount:680,anchor:{workId:anchor.workId}}})
   expect(restored.status('owner').scope).toBe('anomaly')
   restored.receive(resumed.runId,target.id,secondCapture(capture(680,[...newRecords,anchor,older])));restored.progress(resumed.runId,{finished:true})
   expect(restored.decorate('owner',f.store.list()).filter(c=>c.activity?.anomaly)).toHaveLength(0)
   expect(f.store.db.prepare('SELECT * FROM visible_directory_creators ORDER BY id').all()).toEqual(directoryBefore)
   expect(f.store.list().find(c=>c.id===target.id)).toMatchObject({isStarred:true,note:'第二位批注'})
  }finally{f.store.close()}
 })
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
   expect(repair.targets[0]).toMatchObject({repair:true,comparisonBaseline:{snapshotId:2,workCount:680,continuitySnapshotId:1,anchor:{workId:anchor.workId}}})
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
   expect(resume.targets[0]).toMatchObject({repair:true,comparisonBaseline:{snapshotId:3,continuitySnapshotId:1,anchor:{workId:anchor.workId}}});expect(resume.targets[0].baseline).toBeUndefined()
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
