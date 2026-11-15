import {it,expect,vi,afterEach} from 'vitest'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {CreatorActivityService} from './creatorActivityService'
import {calendarWeek,type CreatorActivityCapture} from '../shared/creatorActivity'
import {DEFAULT_CREATOR_REFRESH_PACING} from '../shared/creatorRefreshPolicy'
import {emptyCreatorTimeline,observeCreatorTimeline} from '../shared/creatorWorkTimeline'

const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}
const row=(day:string,pinned=false)=>({workId:'70000000'+day.replace('-',''),publishedAt:`2026-${day}T08:00:00.000Z`,authorUid:'uid',authorSecUid:'sec',pinned,visibility})
const original=[row('08-02',true),row('09-20',true),row('10-05'),row('10-01'),row('09-16'),row('08-14')]
const additions=[row('10-12'),row('10-10'),row('10-08')]
function capture(at:string,records:ReturnType<typeof row>[],count=records.length,hasMore=false):CreatorActivityCapture{
  const week=calendarWeek(at)
  return {contract:'signaldesk-creator-activity/v8',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:'owner',requestedSecUid:'sec',profile:{uid:'uid',secUid:'sec',workCount:null},
    checkedAt:at,weekStart:week.start,weekEndExclusive:week.endExclusive,frontendCount:{count,text:String(count),secUid:'sec',profileUrl:'https://www.douyin.com/user/sec',checkedAt:at,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
    pages:[{requestCursor:0,responseCursor:100,hasMore,records,items:[],excludedAuthors:[],excludedNonPublic:[],sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',secUid:'sec',method:'GET',httpStatus:200,requestCursor:0,observedAt:at}}],
    errorCode:null,activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,acquisitionMs:1}
}
afterEach(()=>vi.useRealTimers())
it('implements the user three-round example with 3/0/2 new publications, preserved inactive IDs and nonregressing M across restarts',()=>{
  vi.useFakeTimers();vi.setSystemTime('2026-10-06T10:00:00.000Z')
  const store=new FollowingDirectoryStore(':memory:');store.recordAccount({secUid:'owner',uid:'owner-uid',nickname:'账号'});store.selectAccount('owner')
  store.savePlanRows('directory',{secUid:'owner',uid:'owner-uid',nickname:'账号'},new Date().toISOString(),[{uid:'uid',secUid:'sec',nickname:'作者',avatarUrl:null,signature:'保留简介',profileUrl:'https://www.douyin.com/user/sec'}])
  const target={id:store.list()[0].id,secUid:'sec',uid:'uid',nickname:'作者'}
  store.update(target.id,{isStarred:true,note:'必须保留'})
  let service=new CreatorActivityService(store.db,()=>{})
  const collect=(at:string,records:ReturnType<typeof row>[],count=records.length)=>{
    vi.setSystemTime(at);const command=service.begin('owner',[target],undefined,false,false,{pacing:DEFAULT_CREATOR_REFRESH_PACING})!
    service.receive(command.runId,target.id,capture(at,records,count));service.progress(command.runId,{finished:true})
    return command
  }
  try{
    collect('2026-10-06T10:00:00.000Z',original)
    expect(service.workTimeline('owner','sec').latest?.publishedAt).toBe(row('10-05').publishedAt)
    collect('2026-10-13T10:00:00.000Z',[original[0],original[1],...additions,...original.slice(2)])
    let state=service.workTimeline('owner','sec')
    expect(state.observation).toMatchObject({previousCount:6,currentCount:9,countChange:3,timeBaseline:row('10-05').publishedAt,newWorkIds:[row('10-08').workId,row('10-10').workId,row('10-12').workId]})
    expect(state.works.map(w=>w.publishedAt)).toEqual([...state.works.map(w=>w.publishedAt)].sort())
    const before=service.decorate('owner',store.list())[0].activity!.publicationInterval!
    const survivors=[original[1],additions[0],additions[2],...original.slice(2)]
    collect('2026-10-14T10:00:00.000Z',survivors)
    state=service.workTimeline('owner','sec')
    expect(state.observation).toMatchObject({previousCount:9,currentCount:7,countChange:-2,newWorkIds:[],invalidatedWorkIds:[row('08-02').workId,row('10-10').workId]})
    expect(state.works).toHaveLength(9)
    expect(state.works.filter(w=>w.state==='invalid').map(w=>w.workId)).toEqual([row('08-02').workId,row('10-10').workId])
    expect(service.decorate('owner',store.list())[0].activity!.publicationInterval).toEqual(before)
    service=new CreatorActivityService(store.db,()=>{})
    expect(service.workTimeline('owner','sec')).toEqual(state)
    const next=collect('2026-10-19T10:00:00.000Z',[original[1],row('10-18'),row('10-16'),...survivors.slice(1)])
    state=service.workTimeline('owner','sec')
    expect(next.targets[0].baseline).toMatchObject({workCount:7,timeBaseline:row('10-12').publishedAt})
    expect(state.observation).toMatchObject({previousCount:7,currentCount:9,countChange:2,newWorkIds:[row('10-16').workId,row('10-18').workId]})
    expect(state.works).toHaveLength(11);expect(state.works.filter(w=>w.state==='invalid')).toHaveLength(2)
    expect(service.decorate('owner',store.list())[0].activity?.publicationInterval?.workCount).toBe(11)
    expect(store.list()[0]).toMatchObject({isStarred:true,note:'必须保留'})
    expect(store.db.prepare('SELECT COUNT(*) n FROM creator_activity_snapshots').get()?.n).toBe(4)
    const raw=store.db.prepare('SELECT * FROM creator_activity_snapshots ORDER BY id').all()
    // Rebuild only the derived tables in the isolated test; the raw chronological history is immutable.
    store.db.exec('DELETE FROM creator_work_timeline_events; DELETE FROM creator_work_timeline_states;')
    service=new CreatorActivityService(store.db,()=>{})
    expect(service.workTimeline('owner','sec')).toEqual(state)
    expect(store.db.prepare('SELECT * FROM creator_activity_snapshots ORDER BY id').all()).toEqual(raw)
  }finally{store.close()}
})
it('applies temporal counting and scoped invalidation to partial lists without guessing about older unread records',()=>{
  let state=observeCreatorTimeline(emptyCreatorTimeline(),capture('2026-10-06T10:00:00.000Z',original,600,true),1)
  state=observeCreatorTimeline(state,capture('2026-10-13T10:00:00.000Z',[original[0],...additions,original[2],original[3]],603,true),2)
  expect(state.observation?.newWorkIds).toHaveLength(3)
  const previous=state
  state=observeCreatorTimeline(state,capture('2026-10-14T10:00:00.000Z',[original[1],additions[0],additions[2],original[2],original[3]],601,true),3)
  expect(state.observation).toMatchObject({newWorkIds:[],countChange:-2,coverage:'time-range',invalidatedWorkIds:[row('10-10').workId]})
  // August 2 is earlier than the covered ordinary range; absence from this sample is no proof of invalidity.
  expect(state.works.find(w=>w.workId===row('08-02').workId)?.state).toBe('active')
  expect(previous.works.find(w=>w.workId===row('10-10').workId)?.state).toBe('active')
  state=observeCreatorTimeline(state,capture('2026-10-19T10:00:00.000Z',[row('10-18'),row('10-16'),original[1],...additions],603,true),4)
  expect(state.observation?.newWorkIds).toEqual([row('10-16').workId,row('10-18').workId])
})
it('does not regress the time watermark when the latest publication disappears, and excludes same-time/old pinned/restored works',()=>{
  let state=observeCreatorTimeline(emptyCreatorTimeline(),capture('2026-10-13T10:00:00.000Z',[...original,...additions]),1)
  state=observeCreatorTimeline(state,capture('2026-10-14T10:00:00.000Z',original),2)
  expect(state.latest?.publishedAt).toBe(row('10-12').publishedAt)
  state=observeCreatorTimeline(state,capture('2026-10-19T10:00:00.000Z',[row('10-18',true),row('10-16'),original[0],...original.slice(1),row('10-12')]),3)
  expect(state.observation?.newWorkIds).toEqual([row('10-16').workId,row('10-18').workId])
  expect(state.observation?.restoredWorkIds).toEqual([row('10-12').workId])
})
it('does not infer invalidity from failed, unordered or equal-time boundary samples',()=>{
  const initial=observeCreatorTimeline(emptyCreatorTimeline(),capture('2026-10-06T10:00:00.000Z',original),1)
  for(const c of [{...capture('2026-10-14T10:00:00.000Z',[]),errorCode:'DEBUGGER_NOT_ATTACHED'},capture('2026-10-14T10:00:00.000Z',[original[4],original[2]],100,true)]){
    expect(observeCreatorTimeline(initial,c,2).works.filter(w=>w.state==='invalid')).toHaveLength(0)
  }
  const peer={...row('10-05'),workId:'799999999'}
  const state=observeCreatorTimeline(initial,capture('2026-10-14T10:00:00.000Z',[row('10-12'),peer],100,true),2)
  expect(state.works.find(w=>w.workId===row('10-05').workId)?.state).toBe('active')
})
