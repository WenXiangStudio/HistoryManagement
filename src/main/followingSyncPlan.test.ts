import {describe,it,expect,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
vi.mock('electron',()=>({app:{isPackaged:false,getAppPath:()=>process.cwd()},shell:{openPath:vi.fn()}}))
vi.mock('./followingConnection',()=>({FOLLOWING_VERSION:'0.7.0',deployFollowingConnection:async(_source:string,root:string)=>join(root,'following-extension')}))
vi.mock('./followingPreferences',async()=>{
  const original=await vi.importActual<typeof import('./followingPreferences')>('./followingPreferences')
  return {...original,followingBrowserProfiles:()=>[{directory:'Default',name:'测试配置',extensionInstalled:true}]}
})
import {FollowingSyncService} from './followingSync'
import {calendarWeek,type CreatorActivityCapture} from '../shared/creatorActivity'
import {DEFAULT_CREATOR_REFRESH_PACING} from '../shared/creatorRefreshPolicy'
const connector='11111111-1111-1111-1111-111111111111',owner={uid:'owner-uid',secUid:'owner',nickname:'当前账号'}
describe('local readiness and independent following actions',()=>{
  it('dispatches current-owner frequency groups from retained works, preserving all others and resuming the original selection',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-frequency-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      const hours=[0,7*24,7*24+1,14*24,30*24,null]
      service.store.savePlanRows('directory',owner,new Date().toISOString(),hours.map((_,i)=>({uid:`uid${i}`,secUid:`sec${i}`,nickname:`博主${i}`,avatarUrl:null,signature:'保留简介',profileUrl:`https://www.douyin.com/user/sec${i}`})))
      const targets=service.listCreators().map(row=>({id:row.id,uid:row.nativeUid!,secUid:new URL(row.profileUrl).pathname.split('/').at(-1)!,nickname:row.nickname}))
      const run=service.activity.begin(owner.secUid,targets)!,time=new Date().toISOString(),week=calendarWeek(),latest=Date.now()-86400000
      for(const target of targets){
        const h=hours[Number(target.secUid.slice(3))],record={workId:'700000001',authorUid:target.uid,authorSecUid:target.secUid,publishedAt:new Date(latest).toISOString(),pinned:false,visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}}
        const capture:CreatorActivityCapture={contract:'signaldesk-creator-activity/v8',ownerSecUid:owner.secUid,requestedSecUid:target.secUid,requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},profile:{uid:target.uid,secUid:target.secUid,workCount:null},
          frontendCount:{count:h===null?1:2,text:h===null?'1':'2',secUid:target.secUid,profileUrl:`https://www.douyin.com/user/${target.secUid}`,checkedAt:time,selector:'#semiTabpost [data-e2e="user-tab-count"]'},checkedAt:time,weekStart:week.start,weekEndExclusive:week.endExclusive,errorCode:null,acquisitionMs:1,activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,
          pages:[{requestCursor:0,responseCursor:0,hasMore:false,items:[],excludedAuthors:[],excludedNonPublic:[],records:h===null?[record]:[record,{...record,workId:'700000002',publishedAt:new Date(latest-h*3600000).toISOString()}],sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',secUid:target.secUid,requestCursor:0,method:'GET',httpStatus:200,observedAt:time}}]}
        service.activity.receive(run.runId,target.id,capture)
      }
      service.activity.progress(run.runId,{finished:true})
      service.store.update(targets[0].id,{isStarred:true,note:'保留批注'})
      const original=service.listCreators(),sourceRows=service.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()
      expect(Object.fromEntries(original.map(row=>[row.nickname,row.activity?.refreshSchedule?.tier]))).toEqual({'博主0':'active','博主1':'active','博主2':'regular','博主3':'regular','博主4':'inactive','博主5':'unknown'})
      expect(service.getCreatorDatabase().rows.map(row=>row.values.tier)).toEqual(original.map(row=>row.activity!.refreshSchedule!.tier))
      expect(original.every(row=>row.activity?.refreshSchedule?.due===false)).toBe(true)
      expect(original.every(row=>row.activity?.refreshSchedule?.latestKnownPublishedAt===new Date(latest).toISOString())).toBe(true)
      vi.spyOn(service,'status').mockReturnValue({connection:{online:true},basic:{phase:'idle'}} as any);(service as any).state.readiness={phase:'ready'}
      for(const [scope,names] of [['active',['sec0','sec1']],['regular',['sec2','sec3']],['all',['sec0','sec1','sec2','sec3','sec4','sec5']]] as const){
        service.startActivity(undefined,false,undefined,scope)
        expect((service as any).command.targets.map((target:any)=>target.secUid).sort()).toEqual([...names])
        expect((service as any).command.ownerSecUid).toBe(owner.secUid)
        expect((service as any).command.pacing).toEqual(DEFAULT_CREATOR_REFRESH_PACING)
        expect(service.activity.status(owner.secUid)).toMatchObject({scope,total:names.length,notDueCount:0})
        service.cancelActivity()
      }
      const boost=service.updateCreatorPriority({ownerSecUid:'owner',secUid:'sec2',mode:'boost',revision:0})
      const reduce=service.updateCreatorPriority({ownerSecUid:'owner',secUid:'sec0',mode:'reduce',revision:0})
      const unknown=service.updateCreatorPriority({ownerSecUid:'owner',secUid:'sec5',mode:'boost',revision:0})
      expect(boost.tier).toBe('active');expect(reduce.tier).toBe('regular');expect(unknown.tier).toBe('regular')
      for(const [scope,names] of [['active',['sec1','sec2']],['regular',['sec0','sec3','sec5']]] as const){
        service.startActivity(undefined,false,undefined,scope)
        expect((service as any).command.targets.map((target:any)=>target.secUid).sort()).toEqual([...names])
        service.cancelActivity()
      }
      const weighted=service.getCreatorDatabase().rows.find(row=>row.secUid==='sec2')!
      expect(weighted.values.tier).toBe('active');expect(weighted.refreshPriority?.mode).toBe('boost')
      for(const secUid of ['sec0','sec2','sec5'])service.updateCreatorPriority({ownerSecUid:'owner',secUid,mode:null,revision:1})
      expect(()=>service.updateCreatorPriority({ownerSecUid:'other',secUid:'sec2',mode:'boost',revision:2})).toThrow('账号已切换')
      service.startActivity(undefined,false,undefined,'active');service.cancelActivity()
      vi.spyOn(service,'listCreators').mockReturnValue(original.map(row=>({...row,activity:{...row.activity!,publicationInterval:{...row.activity!.publicationInterval!,meanHours:30*24}}})))
      expect(()=>service.startActivity(undefined,false,undefined,'active')).toThrow('没有符合条件')
      service.startActivity(undefined,true)
      expect((service as any).command.targets.map((target:any)=>target.secUid).sort()).toEqual(['sec0','sec1'])
      expect(service.activity.status(owner.secUid)).toMatchObject({scope:'active',mode:'resume',total:2})
      service.cancelActivity()
      expect(service.store.db.prepare('SELECT * FROM creator_activity_snapshots').all()).toEqual(sourceRows)
      expect(service.store.list().find(row=>row.id===targets[0].id)).toMatchObject({isStarred:true,note:'保留批注'})
      for(const args of [[undefined,false,undefined,'invalid'],[targets[0].id,false,undefined,'active'],[undefined,true,undefined,'active'],[undefined,false,[targets[0].id],'active']] as any[])expect(()=>service.startActivity(...args as [any,any,any,any])).toThrow('更新分组无效')
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('dispatches the entire account directory including not-due regular and inactive creators',async()=>{
    vi.useFakeTimers();vi.setSystemTime('2026-10-07T04:00:00.000Z')
    const root=mkdtempSync(join(tmpdir(),'following-all-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      const rows=[1,2,3].map(id=>({uid:`uid${id}`,secUid:`sec${id}`,nickname:`博主${id}`,avatarUrl:null,signature:'简介',profileUrl:`https://www.douyin.com/user/sec${id}`}))
      service.store.savePlanRows('directory',owner,new Date().toISOString(),rows)
      const targets=service.listCreators().map(item=>({id:item.id,secUid:new URL(item.profileUrl).pathname.split('/').at(-1)!,uid:item.nativeUid!,nickname:item.nickname}))
      const seeded=targets.filter(target=>target.secUid!=='sec3'),run=service.activity.begin(owner.secUid,seeded)!,week=calendarWeek(),time=new Date().toISOString()
      for(const target of seeded){
        const capture:CreatorActivityCapture={contract:'signaldesk-creator-activity/v8',ownerSecUid:owner.secUid,requestedSecUid:target.secUid,
          requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},profile:{uid:target.uid,secUid:target.secUid,workCount:null},
          frontendCount:{count:1,text:'1',secUid:target.secUid,profileUrl:`https://www.douyin.com/user/${target.secUid}`,checkedAt:time,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
          checkedAt:time,weekStart:week.start,weekEndExclusive:week.endExclusive,errorCode:null,acquisitionMs:1,activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,
          pages:[{requestCursor:0,responseCursor:0,hasMore:false,items:[],excludedAuthors:[],excludedNonPublic:[],
            records:[{workId:'700000001',authorUid:target.uid,authorSecUid:target.secUid,publishedAt:target.secUid==='sec1'?'2026-09-15T00:00:00.000Z':'2026-07-01T00:00:00.000Z',pinned:false,
              visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}}],
            sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',secUid:target.secUid,requestCursor:0,method:'GET',httpStatus:200,observedAt:time}}]}
        service.activity.receive(run.runId,target.id,capture)
      }
      service.activity.progress(run.runId,{finished:true})
      expect(service.listCreators().filter(item=>item.activity?.refreshSchedule?.due===false)).toHaveLength(2)
      vi.spyOn(service,'status').mockReturnValue({connection:{online:true},basic:{phase:'idle'}} as any)
      ;(service as any).state.readiness={phase:'ready'}
      service.startActivity()
      const command=(service as any).command
      expect(command.targets.map((target:any)=>target.id)).toEqual(targets.map(target=>target.id))
      expect(command.targets.filter((target:any)=>target.baseline)).toHaveLength(2)
      expect(command.pacing).toEqual(DEFAULT_CREATOR_REFRESH_PACING)
      expect(service.activity.status(owner.secUid)).toMatchObject({phase:'running',total:3,notDueCount:0,mode:'manual'})
    }finally{await service.stop();rmSync(root,{recursive:true,force:true});vi.useRealTimers()}
  })
  it('dispatches only the selected current-account creators and rejects stale or invalid selections',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-selected-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      vi.spyOn(service,'status').mockReturnValue({connection:{online:true},basic:{phase:'idle'}} as any)
      ;(service as any).state.readiness={phase:'ready'}
      vi.spyOn(service,'listCreators').mockReturnValue([-1,-2,-3].map(id=>({id,profileUrl:`https://www.douyin.com/user/sec${-id}`,nativeUid:`uid${-id}`,nickname:`博主${-id}`})) as any)
      expect(()=>service.startActivity(undefined,false,[])).toThrow('范围无效')
      expect(()=>service.startActivity(undefined,false,[-1,-1])).toThrow('范围无效')
      expect(()=>service.startActivity(undefined,false,[-1,2])).toThrow('范围无效')
      expect(()=>service.startActivity(undefined,true,[-1])).toThrow('范围无效')
      expect(()=>service.startActivity(undefined,false,[-1,-4])).toThrow('不属于当前账号')
      service.startActivity(undefined,false,[-1,-3])
      expect((service as any).command.targets.map((t:any)=>t.id)).toEqual([-1,-3])
      expect(service.activity.status(owner.secUid)).toMatchObject({total:2,remainingIds:[-1,-3]})
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('starts with no queued browser command; list pages save independently and never enqueue activity',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-service-')),service=new FollowingSyncService(root,()=>{})
    try{
      await service.prepare()
      const bridge=JSON.parse(readFileSync(join(root,'following-bridge.json'),'utf8'))
      const auth={authorization:'Bearer '+bridge.token,'content-type':'application/json'}
      const pollHeaders={...auth,'x-following-version':'0.7.0','x-following-instance':'test-instance','x-following-connector':connector}
      const initialPoll=fetch(bridge.origin+'/commands',{headers:pollHeaders}).catch(()=>null)
      for(let index=0;index<30&&!service.status().connection?.online;index++)await new Promise(resolve=>setTimeout(resolve,10))
      expect(service.status().connection?.online).toBe(true);expect((service as any).command).toBeNull()
      const state=await service.start(),poll=await initialPoll,command=await poll!.json()
      expect(command.command.action).toBe('list');expect(command.command.cursor).toBe(0)
      const post=async(path:string,body:unknown)=>{
        const response=await fetch(bridge.origin+path,{method:'POST',headers:auth,body:JSON.stringify(body)})
        return {status:response.status,value:await response.json()}
      }
      expect((await post('/list-owner',{runId:state.runId,owner})).status).toBe(200)
      const creator={uid:'uid',secUid:'sec',nickname:'博主',avatarUrl:'https://example.com/a.jpg',signature:'简介',profileUrl:'https://www.douyin.com/user/sec'}
      const saved=await post('/list-page',{runId:state.runId,page:{owner,position:1,requestCursor:0,requestOffset:0,nextCursor:null,nextOffset:null,
        hasMore:false,creators:[creator],collectedAt:new Date().toISOString(),activeApiRequests:1},acquisitionMs:10})
      expect(saved.status).toBe(200);expect(saved.value.phase).toBe('completed')
      expect(saved.value.plan).toMatchObject({complete:true,count:1});expect(saved.value.activity.phase).toBe('idle')
      expect((service as any).command).toBeNull();expect(service.store.list()).toHaveLength(1)
      expect((await post('/list-page',{runId:state.runId,page:{}})).status).toBe(400)
      expect(()=>service.startBasic()).toThrow('没有待补充')
      await service.prepare();expect((service as any).command).toBeNull()
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('never adopts an unexpected owner or writes rows for it',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-owner-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);(service as any).preferences.value.activeOwnerSecUid=owner.secUid;service.store.selectAccount(owner.secUid)
      await service.initialize();(service as any).extensionVersion='0.7.0';(service as any).lastSeen=Date.now()
      const state=await service.start(),bridge=JSON.parse(readFileSync(join(root,'following-bridge.json'),'utf8'))
      const response=await fetch(bridge.origin+'/list-owner',{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({runId:state.runId,owner:{...owner,secUid:'other'}})})
      expect(response.status).toBe(400);expect(service.store.list()).toEqual([])
      expect(service.configuration().activeOwnerSecUid).toBe(owner.secUid)
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
})
