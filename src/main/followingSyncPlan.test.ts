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
const connector='11111111-1111-1111-1111-111111111111',owner={uid:'owner-uid',secUid:'owner',nickname:'当前账号'}
describe('local readiness and independent following actions',()=>{
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
