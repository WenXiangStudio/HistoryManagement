import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {VideoWorkshopService} from './videoWorkshopService'
import type {WorkshopDownloader} from './workshopDownload'
import type {VideoClassification} from '../shared/videoWorkflow'

const cleanup:(()=>void)[]=[]
afterEach(()=>{for(const close of cleanup.splice(0))close()})
const id='7684211392850186216',url=`https://www.douyin.com/video/${id}`
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
function setup(){
  const root=mkdtempSync(join(tmpdir(),'workshop-')),userData=join(root,'app-data'),downloadRoot=join(root,'video'),source='genuine source fixture',digest=hash(source)
  const download=vi.fn<WorkshopDownloader>(async(input,output,signal,progress)=>{
    progress('正在下载测试视频');signal.throwIfAborted();mkdirSync(output,{recursive:true});const mediaPath=join(output,'source.mp4');writeFileSync(mediaPath,source)
    return {workId:id,title:'测试作品',authorName:'测试作者',mediaPath}
  })
  const request=vi.fn(async(method:string,params:Record<string,unknown>,signal:AbortSignal)=>{
    signal.throwIfAborted()
    if(method==='probe')return {hasVideo:true,hasAudio:true,sha256:digest,durationMs:1000}
    const frames=Array.from({length:8},(_,n)=>{
      const path=join(String(params.outputDir),`frame-${n}.jpg`),data='frame'+n;writeFileSync(path,data)
      return {id:'frame-'+n,timeMs:n*100,path,sha256:hash(data)}
    })
    return {code:'speech',sourceSha256:digest,ruleVersion:'existence-detection-triage-v1',strength:'较强',
      basis:{speechPercent:90,speechBinCoverage:1,retainedTextFrames:5,sampledFrames:8},frames,timing:{detectionTotalMs:10},
      asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false} satisfies VideoClassification
  })
  const worker={request,stop:vi.fn()},runtime={status:vi.fn(()=>({triageAvailable:true})),fork:vi.fn(()=>worker)},changed=vi.fn()
  const service=new VideoWorkshopService(userData,runtime,changed,{downloadRoot,download})
  cleanup.push(()=>{service.stop();rmSync(root,{recursive:true,force:true})})
  return {root,userData,downloadRoot,download,request,worker,runtime,changed,service,digest,
    done:async()=>{await vi.waitFor(()=>expect(service.running).toBe(false));return service.view().jobs[0]}}
}
it('starts the selected URL, verifies the actual downloaded video and all frame evidence, and persists a local-only classification',async()=>{
  const x=setup(),clickedAt=Date.now()-1000
  const immediate=x.service.start({url,clickedAt})
  expect(immediate.running).toBe(true);expect(immediate.jobs[0].phase).not.toBe('completed')
  const job=await x.done()
  expect(job).toMatchObject({phase:'completed',workId:id,title:'测试作品',authorName:'测试作者',byteLength:22,sha256:x.digest,durationMs:1000})
  expect(job.classification?.asrInvoked).toBe(false);expect(job.elapsedMs).toBeGreaterThanOrEqual(1000)
  expect(Object.keys(job.stageElapsedMs)).toEqual(['download','verify','classify'])
  expect(x.download).toHaveBeenCalledWith({url,expectedWorkId:id},join(x.downloadRoot,job.id),expect.any(AbortSignal),expect.any(Function))
  expect(x.request.mock.calls.map(([method])=>method)).toEqual(['probe','classify'])
  expect(JSON.parse(readFileSync(join(x.userData,'video-workshop','jobs.json'),'utf8'))[0]).toMatchObject({phase:'completed',workId:id})
  expect(x.worker.stop).toHaveBeenCalledOnce()
})
it('accepts a share URL and records the video identity returned by extraction',async()=>{
  const x=setup();x.service.start({url:'分享文案 https://v.douyin.com/37AhQbyGtpo/'});const job=await x.done()
  expect(x.download.mock.calls[0][0]).toEqual({url:'https://v.douyin.com/37AhQbyGtpo/',expectedWorkId:null})
  expect(job.phase).toBe('completed');expect(job.workId).toBe(id)
})
it('rejects a different returned video before running any worker',async()=>{
  const x=setup(),original=x.download.getMockImplementation()!
  x.download.mockImplementation(async(...args)=>({...await original(...args),workId:'7684211392850186217'}))
  x.service.start({url});const job=await x.done()
  expect(job.phase).toBe('failed');expect(job.message).toContain('作品编号不一致');expect(x.request).not.toHaveBeenCalled()
})
it('shows the real download failure and preserves earlier completed jobs across restart',async()=>{
  const x=setup();x.service.start({url});const first=await x.done()
  x.download.mockRejectedValueOnce(Error('抖音限制了该作品的公开下载，暂未取得视频文件'))
  x.service.start({url});const failed=await x.done()
  expect(failed).toMatchObject({phase:'failed',message:'抖音限制了该作品的公开下载，暂未取得视频文件'})
  const reopened=new VideoWorkshopService(x.userData,x.runtime,()=>{},{downloadRoot:x.downloadRoot,download:x.download})
  cleanup.push(()=>reopened.stop())
  expect(reopened.view().jobs.map(j=>j.id)).toEqual([failed.id,first.id]);expect(reopened.view().jobs[1].phase).toBe('completed')
})
it.each(['hash','no-video','duration'])('does not classify a downloaded file when probe %s fails validation',async failure=>{
  const x=setup();x.request.mockResolvedValueOnce({hasVideo:failure!=='no-video',sha256:failure==='hash'?'0'.repeat(64):x.digest,durationMs:failure==='duration'?Number.NaN:1000} as never)
  x.service.start({url});const job=await x.done()
  expect(job.phase).toBe('failed');expect(job.classification).toBeUndefined();expect(x.request).toHaveBeenCalledTimes(1)
})
it.each(['cloud','frame-time','frame-hash'])('never reports success with unverified %s classification evidence',async failure=>{
  const x=setup(),original=x.request.getMockImplementation()!
  x.request.mockImplementation(async(...args)=>{
    const value=await original(...args)
    if(args[0]==='classify'){
      if(failure==='cloud')(value as any).cloudInvoked=true
      if(failure==='frame-time')(value as any).frames[0].timeMs=1001
      if(failure==='frame-hash')writeFileSync((value as any).frames[0].path,'tampered')
    }
    return value
  })
  x.service.start({url});const job=await x.done()
  expect(job.phase).toBe('failed');expect(job.classification).toBeUndefined();expect(job.message).toContain('校验')
})
it('cancels acquisition without invoking the classifier and leaves the workspace history intact',async()=>{
  const x=setup()
  x.download.mockImplementation(async(_input,_output,signal)=>await new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})
  }))
  const job=x.service.start({url}).jobs[0]
  expect(()=>x.service.start({url})).toThrow('已有视频正在处理')
  x.service.cancel(job.id)
  const terminal=await x.done()
  expect(terminal.phase).toBe('cancelled');expect(x.request).not.toHaveBeenCalled();expect(existsSync(x.userData)).toBe(true)
})
it('rejects links and missing local runtime before starting downloads',()=>{
  const x=setup()
  expect(()=>x.service.start({url:'https://example.com/video/12345678'})).toThrow('抖音')
  x.runtime.status.mockReturnValue({triageAvailable:false})
  expect(()=>x.service.start({url})).toThrow('本地视频分类环境未就绪')
  expect(x.download).not.toHaveBeenCalled();expect(x.service.view().jobs).toEqual([])
})
it('rejects a downloader path outside the assigned job directory',async()=>{
  const x=setup(),outside=join(x.root,'outside.mp4');writeFileSync(outside,'outside')
  x.download.mockResolvedValue({workId:id,mediaPath:outside});x.service.start({url});const job=await x.done()
  expect(job.phase).toBe('failed');expect(job.message).toContain('本次下载目录');expect(x.request).not.toHaveBeenCalled()
})
it('marks interrupted jobs cancelled on restart and keeps every historical row',async()=>{
  const x=setup();x.service.start({url});await x.done()
  const path=join(x.userData,'video-workshop','jobs.json'),saved=JSON.parse(readFileSync(path,'utf8'))
  saved[0].phase='classifying';writeFileSync(path,JSON.stringify(saved))
  const reopened=new VideoWorkshopService(x.userData,x.runtime,()=>{},{downloadRoot:x.downloadRoot,download:x.download})
  cleanup.push(()=>reopened.stop())
  expect(reopened.view().running).toBe(false);expect(reopened.view().jobs).toHaveLength(1);expect(reopened.view().jobs[0].phase).toBe('cancelled')
})
