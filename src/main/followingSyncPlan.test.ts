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
import {DatabaseSync} from 'node:sqlite'
const connector='11111111-1111-1111-1111-111111111111',owner={uid:'owner-uid',secUid:'owner',nickname:'当前账号'}
describe('local readiness and independent following actions',()=>{
  it('saves interest membership with a scoped event and patches the read model without re-decorating activity or touching annotations',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-local-interest-')),changed=vi.fn(),service=new FollowingSyncService(root,changed)
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      service.store.savePlanRows('directory',owner,new Date().toISOString(),[1,2].map(i=>({uid:`uid${i}`,secUid:`sec${i}`,nickname:'同名博主',avatarUrl:null,signature:'简介',profileUrl:`https://www.douyin.com/user/sec${i}`})))
      const initial=service.listCreators(),decorate=vi.spyOn(service.activity,'decorate')
      const input={ownerSecUid:owner.secUid,secUid:'sec1',tier:'medium',revision:0}
      const saved=service.updateCreatorInterest(input)
      expect(changed).toHaveBeenLastCalledWith({source:'creator-interest',ownerSecUid:owner.secUid,secUid:'sec1',interest:saved})
      const next=service.listCreators()
      expect(next[0].interest).toEqual({tier:'medium',revision:1});expect(next[1]).toBe(initial[1]);expect(decorate).not.toHaveBeenCalled()
      expect(next[0].note).toBe(initial[0].note);expect(next[0].refreshPriority).toEqual(initial[0].refreshPriority)
      expect(()=>service.updateCreatorInterest({...input,ownerSecUid:'foreign'})).toThrow('账号已切换')
      expect(()=>service.updateCreatorInterest({...input,secUid:'foreign'})).toThrow('不属于当前账号')
      expect(()=>service.updateCreatorInterest(input)).toThrow('已发生变化')
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('reuses a directory read model and invalidates it for own writes, external commits, accounts and Beijing dates',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-read-model-')),service=new FollowingSyncService(root,()=>{})
    const date=new Date('2026-10-14T15:59:59Z');vi.useFakeTimers();vi.setSystemTime(date)
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      const row={uid:'uid1',secUid:'sec1',nickname:'读模型博主',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec1'}
      service.store.savePlanRows('directory',owner,date.toISOString(),[row])
      const decorate=vi.spyOn(service.activity,'decorate'),first=service.listCreators()
      expect(service.listCreators('博主')).toEqual(first);expect(service.listCreators('','sec1')).toEqual(first)
      expect(decorate).toHaveBeenCalledOnce()
      service.store.update(first[0].id,{note:'直接写入'})
      expect(service.listCreators()[0].note).toBe('直接写入');expect(decorate).toHaveBeenCalledTimes(2)
      const external=new DatabaseSync(join(root,'following-directory.sqlite'))
      external.prepare('UPDATE visible_directory_creators SET user_note=?').run('外部提交');external.close()
      expect(service.listCreators()[0].note).toBe('外部提交');expect(decorate).toHaveBeenCalledTimes(3)
      vi.setSystemTime(new Date('2026-10-14T16:00:01Z'));service.listCreators();expect(decorate).toHaveBeenCalledTimes(4)
      const other={...owner,uid:'other-uid',secUid:'other-owner'};service.store.recordAccount(other);service.store.selectAccount(other.secUid)
      ;(service as any).preferences.value.activeOwnerSecUid=other.secUid
      expect(service.listCreators()).toEqual([]);expect(decorate).toHaveBeenCalledTimes(5)
    }finally{vi.useRealTimers();await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('saves owner-scoped annotations without re-reading activity and patches the cached snapshot only after the write',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-local-annotation-')),changed=vi.fn(),service=new FollowingSyncService(root,changed)
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      service.store.savePlanRows('directory',owner,new Date().toISOString(),[{uid:'uid1',secUid:'sec1',nickname:'博主',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec1'}])
      const id=service.listCreators()[0].id,decorate=vi.spyOn(service.activity,'decorate')
      const saved=service.updateCreatorAnnotation(owner.secUid,id,{isStarred:true,note:'保留批注'})
      expect(saved).toMatchObject({source:'creator-annotation',ownerSecUid:owner.secUid,secUid:'sec1',isStarred:true,note:'保留批注',revision:1})
      expect(changed).toHaveBeenLastCalledWith(saved);expect(service.listCreators()[0]).toMatchObject({isStarred:true,note:'保留批注'})
      expect(decorate).not.toHaveBeenCalled()
      expect(()=>service.updateCreatorAnnotation('foreign',id,{note:'不能覆盖'})).toThrow('账号已切换')
      expect(()=>service.updateCreatorAnnotation(owner.secUid,-999,{note:'不能覆盖'})).toThrow('没有这位博主')
      expect(()=>service.updateCreatorAnnotation(owner.secUid,id,{isStarred:'yes'})).toThrow()
      expect(service.store.find(id)?.note).toBe('保留批注')
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('decorates only the selected creator for a priority save and publishes the committed owner-scoped change',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-priority-target-')),changed=vi.fn(),service=new FollowingSyncService(root,changed)
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      service.store.savePlanRows('directory',owner,new Date().toISOString(),[1,2].map(i=>({uid:`uid${i}`,secUid:`sec${i}`,nickname:'同名博主',avatarUrl:null,signature:'简介',profileUrl:`https://www.douyin.com/user/sec${i}`})))
      const decorate=vi.spyOn(service.activity,'decorate').mockImplementation((_owner,creators)=>creators.map(c=>({...c,activity:{baselineStatus:'ready'}})) as any)
      const directory=vi.spyOn(service.store,'list')
      const priority=service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec2',mode:'boost',revision:0})
      expect(decorate).toHaveBeenCalledTimes(1)
      expect(directory).toHaveBeenCalledWith('','sec2')
      expect(decorate.mock.calls[0][1].map(c=>c.profileUrl)).toEqual(['https://www.douyin.com/user/sec2'])
      expect(changed).toHaveBeenLastCalledWith({source:'creator-priority',ownerSecUid:owner.secUid,secUid:'sec2',priority})
      expect(service.store.db.prepare('SELECT creator_sec_uid FROM creator_refresh_priorities').all()).toEqual([{creator_sec_uid:'sec2'}])
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('allows local priority changes during unrelated video work, preserves account-switch protection and blocks only creator collection',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-priority-idle-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      service.store.savePlanRows('directory',owner,new Date().toISOString(),[{uid:'uid1',secUid:'sec1',nickname:'博主1',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec1'}])
      service.store.update(service.listCreators()[0].id,{isStarred:true,note:'保留批注'})
      const creators=service.listCreators().map(c=>({...c,activity:{...c.activity!,baselineStatus:'ready' as const}}))
      vi.spyOn(service,'listCreators').mockReturnValue(creators)
      const status=vi.spyOn(service,'status').mockReturnValue({...service.status(),phase:'completed',basic:{phase:'completed'},activity:{phase:'completed'}} as any)
      const video=vi.spyOn(service.videoInformation,'running','get').mockReturnValue(true)
      const discovery=vi.spyOn(service.videoDiscovery,'running','get').mockReturnValue(true)
      service.contentRunning=()=>true
      expect(service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec1',mode:'boost',revision:0}).mode).toBe('boost')
      expect(service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec1',mode:'reduce',revision:1}).mode).toBe('reduce')
      await expect(service.switchAccount(owner.secUid)).rejects.toThrow('切换账号')
      expect(()=>service.updateCreatorPriority({ownerSecUid:'other',secUid:'sec1',mode:null,revision:2})).toThrow('账号已切换')
      expect(()=>service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec1',mode:null,revision:0})).toThrow('权重已发生变化')
      video.mockReturnValue(false);discovery.mockReturnValue(false);service.contentRunning=()=>false
      for(const [phase,basic,activity,message] of [
        ['running','completed','completed','关注同步'],['awaiting-config','completed','completed','关注同步'],
        ['completed','running','completed','基础资料'],['completed','completed','running','博主资料刷新']
      ]){
        status.mockReturnValue({...service.status(),phase,basic:{phase:basic},activity:{phase:activity}} as any)
        ;(service as any).state.phase=phase
        expect(()=>service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec1',mode:null,revision:2})).toThrow(message)
      }
      ;(service as any).state.phase='completed'
      status.mockReturnValue({...service.status(),phase:'completed',basic:{phase:'completed'},activity:{phase:'completed'}} as any)
      expect(service.updateCreatorPriority({ownerSecUid:owner.secUid,secUid:'sec1',mode:null,revision:2}).mode).toBeNull()
      expect(service.store.list()[0]).toMatchObject({isStarred:true,note:'保留批注'})
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('dispatches one account-scoped anomaly repair batch and rejects an empty group without starting collection',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-anomaly-')),service=new FollowingSyncService(root,()=>{})
    try{
      service.store.recordAccount(owner);service.store.selectAccount(owner.secUid);(service as any).preferences.value.activeOwnerSecUid=owner.secUid
      service.store.savePlanRows('directory',owner,new Date().toISOString(),[0,1,2].map(i=>({uid:`uid${i}`,secUid:`sec${i}`,nickname:`博主${i}`,avatarUrl:null,signature:'简介',profileUrl:`https://www.douyin.com/user/sec${i}`})))
      const creators=service.listCreators().map(c=>({...c,activity:{...c.activity!,baselineStatus:'ready' as const}})),pending=creators.map((c,i)=>({...c,activity:i<2?{...c.activity,anomaly:{detectedAt:new Date().toISOString()}}:c.activity}))
      vi.spyOn(service,'listCreators').mockReturnValue(pending as any)
      vi.spyOn(service,'status').mockReturnValue({connection:{online:true},basic:{phase:'idle'}} as any);(service as any).state.readiness={phase:'ready'}
      const begin=vi.spyOn(service.activity,'begin').mockImplementation(((o:string,targets:any[],creatorId:number|undefined,resume:boolean,requireOwner:boolean,options:any)=>({
        action:'activity',runId:'synthetic-anomaly-run',ownerSecUid:o,ownerUid:owner.uid,targets,weekStart:calendarWeek().start,weekEndExclusive:calendarWeek().endExclusive,
        pacing:options.pacing})) as any)
      service.startActivity(undefined,false,undefined,'anomaly')
      expect(begin).toHaveBeenCalledWith(owner.secUid,expect.arrayContaining([expect.objectContaining({id:creators[0].id}),expect.objectContaining({id:creators[1].id})]),undefined,false,true,{scope:'anomaly',pacing:DEFAULT_CREATOR_REFRESH_PACING})
      expect((service as any).command.targets).toHaveLength(2)
      expect((service as any).command.ownerSecUid).toBe(owner.secUid)
      service.cancelActivity()
      vi.mocked(service.listCreators).mockReturnValue(creators)
      expect(()=>service.startActivity(undefined,false,undefined,'anomaly')).toThrow('没有符合条件')
      expect(begin).toHaveBeenCalledTimes(1)
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
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
  it('dispatches ordinary account creators including not-due ones while reserving uninitialized baselines for review',async()=>{
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
      expect(command.targets.map((target:any)=>target.id)).toEqual(seeded.map(target=>target.id))
      expect(command.targets.filter((target:any)=>target.baseline)).toHaveLength(2)
      expect(command.pacing).toEqual(DEFAULT_CREATOR_REFRESH_PACING)
      expect(service.activity.status(owner.secUid)).toMatchObject({phase:'running',total:2,notDueCount:0,mode:'manual'})
      service.cancelActivity()
      expect(service.listCreators().find(c=>c.profileUrl.endsWith('/sec3'))?.activity?.baselineStatus).toBe('missing')
      service.startActivity(undefined,false,undefined,'anomaly')
      expect((service as any).command.targets.map((target:any)=>target.secUid)).toEqual(['sec3'])
      expect((service as any).command.targets[0]).toMatchObject({repair:true,needsBaseline:true})
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
