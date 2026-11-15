import {describe,it,expect,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
vi.mock('electron',()=>({app:{isPackaged:false,getAppPath:()=>process.cwd()},shell:{openPath:vi.fn()}}))
vi.mock('./followingConnection',()=>({FOLLOWING_VERSION:'0.7.0',deployFollowingConnection:async(_source:string,root:string)=>join(root,'following-extension')}))
vi.mock('./followingPreferences',async()=>({...await vi.importActual<typeof import('./followingPreferences')>('./followingPreferences'),followingBrowserProfiles:()=>[]}))
import {FollowingSyncService} from './followingSync'
const id='7684211392850186216',input={url:`https://www.douyin.com/video/${id}`,expectedWorkId:id}
describe('workshop connector dispatch independent of creator directory',()=>{
  it('reads one exact video without a bound owner, retains the creator DB and never saves signed URLs',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-workshop-')),service=new FollowingSyncService(root,()=>{})
    try{
      await service.initialize();(service as any).extensionVersion='0.7.0';(service as any).lastSeen=Date.now();service.contentRunning=()=>true
      const {origin,token}=JSON.parse(readFileSync(join(root,'following-bridge.json'),'utf8')),headers={authorization:`Bearer ${token}`,'content-type':'application/json'}
      const before=service.store.db.prepare('SELECT total_changes() AS n').get()!.n
      const result=service.readWorkshopVideo(input,new AbortController().signal);await Promise.resolve()
      const command=(service as any).command
      expect(command).toMatchObject({action:'workshop-video',url:input.url,expectedWorkId:id})
      expect(command).not.toHaveProperty('ownerSecUid')
      const state=await fetch(origin+'/workshop-video-state',{headers}).then(r=>r.json())
      expect(state).toEqual({runId:command.runId,phase:'running'})
      const media={workId:id,pageUrl:input.url,mediaUrl:'https://v3.douyinvod.com/file.mp4',title:'指定视频'}
      const response=await fetch(origin+'/workshop-video-report',{method:'POST',headers,body:JSON.stringify({runId:command.runId,media})})
      expect(response.ok).toBe(true);expect(await result).toEqual(media)
      expect(service.activeOwner()).toBeNull();expect(service.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before)
      expect((service as any).command).toBeNull()
      expect(await fetch(origin+'/workshop-video-state',{headers}).then(r=>r.json())).toEqual({runId:null,phase:'idle'})
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
  it('rejects a busy browser and cancels only its own pending command',async()=>{
    const root=mkdtempSync(join(tmpdir(),'following-workshop-cancel-')),service=new FollowingSyncService(root,()=>{})
    try{
      await service.initialize();(service as any).extensionVersion='0.7.0';(service as any).lastSeen=Date.now()
      ;(service as any).command={action:'probe',probeId:'keep'}
      await expect(service.readWorkshopVideo(input,new AbortController().signal)).rejects.toThrow('正在运行')
      expect((service as any).command).toEqual({action:'probe',probeId:'keep'});(service as any).command=null
      const controller=new AbortController(),pending=service.readWorkshopVideo(input,controller.signal);await Promise.resolve()
      await expect(service.readWorkshopVideo(input,new AbortController().signal)).rejects.toThrow('正在运行')
      controller.abort();await expect(pending).rejects.toThrow('取消');expect((service as any).command).toBeNull()
    }finally{await service.stop();rmSync(root,{recursive:true,force:true})}
  })
})
