import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
const pipeline=vi.hoisted(()=>vi.fn())
vi.mock('./workshopDeep',()=>({processWorkshopDeep:pipeline}))
import {VideoWorkshopService} from './videoWorkshopService'
import {WORKSHOP_DEEP_MODEL,type WorkshopDeepResult} from '../shared/workshopDeep'
const cleanup:(()=>void)[]=[]
afterEach(()=>{while(cleanup.length)cleanup.pop()!();pipeline.mockReset()})
function setup(){
  const root=mkdtempSync(join(tmpdir(),'workshop-deep-service-')),userData=join(root,'app'),downloadRoot=join(root,'video'),id=randomUUID(),directory=join(downloadRoot,id)
  mkdirSync(directory,{recursive:true});mkdirSync(join(userData,'video-workshop'),{recursive:true})
  const bytes=Buffer.from([255,216,255,0,1]),framePath=join(directory,'frame.jpg');writeFileSync(framePath,bytes)
  const digest=createHash('sha256').update(bytes).digest('hex'),frame={id:'frame-1',timeMs:10,path:framePath,sha256:digest},sourceHash='a'.repeat(64)
  const job={id,url:'https://www.douyin.com/video/7684211392850186216',workId:'7684211392850186216',title:'已下载作品',authorName:'作者',
    phase:'completed',message:'已完成',createdAt:new Date().toISOString(),clickedAt:Date.now()-5000,stageElapsedMs:{download:1},
    mediaPath:join(directory,'source.mp4'),byteLength:10,sha256:sourceHash,durationMs:1000,classification:{code:'speech'}}
  writeFileSync(join(userData,'video-workshop','jobs.json'),JSON.stringify([job]))
  const worker={request:vi.fn(),stop:vi.fn()},runtime={status:()=>({triageAvailable:true}),fork:()=>worker},provider=vi.fn(()=>({kind:'cloud' as const,baseUrl:'https://api.siliconflow.cn/v1',model:WORKSHOP_DEEP_MODEL,apiKey:'synthetic'})),transcribe=vi.fn()
  const service=new VideoWorkshopService(userData,runtime,()=>{},{downloadRoot,deep:{provider,transcribe}})
  const result={sourceSha256:sourceHash,durationMs:1000,model:WORKSHOP_DEEP_MODEL,promptVersion:'v1',generatedAt:new Date().toISOString(),
    speech:{state:'no-speech',text:'',segments:[],sourceSha256:sourceHash,durationMs:1000,model:'豆包极速版'},frames:[frame],readings:[],
    report:{overview:'依据实际画面',sections:[],limitations:[]},requests:[],timing:{preparationMs:1,transcriptionMs:1,recognitionMs:1,reportMs:1,processingMs:4},usage:{inputTokens:1,outputTokens:1}} satisfies WorkshopDeepResult
  cleanup.push(()=>{service.stop();rmSync(root,{recursive:true,force:true})})
  return {service,id,result,worker,provider,transcribe,userData,downloadRoot,framePath,job}
}
it('starts deep processing for the selected completed job and retains the first-stage record',async()=>{
  const x=setup();pipeline.mockImplementation(async input=>{input.onProgress('recognizing','识别画面');return x.result})
  const view=x.service.deep({jobId:x.id,clickedAt:Date.now()})
  expect(view.running).toBe(true);expect(view.jobs[0].phase).toBe('completed')
  await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(pipeline).toHaveBeenCalledOnce();expect(pipeline.mock.calls[0][0]).toMatchObject({media:{mediaPath:x.job.mediaPath,sha256:x.job.sha256},provider:{model:WORKSHOP_DEEP_MODEL},durationMs:1000})
  expect(x.service.view().jobs[0]).toMatchObject({...x.job,deep:{phase:'completed',result:x.result}})
  expect(x.worker.stop).toHaveBeenCalledOnce()
  x.service.deep({jobId:x.id});expect(pipeline).toHaveBeenCalledOnce()
  expect(JSON.parse(readFileSync(join(x.userData,'video-workshop','jobs.json'),'utf8'))[0].deep.result).toEqual(x.result)
})
it('rejects missing records and provider prerequisites before launching the pipeline',()=>{
  const x=setup();expect(()=>x.service.deep({jobId:randomUUID()})).toThrow('请先完成')
  x.provider.mockImplementation(()=>{throw Error('请配置 Qwen 模型')})
  expect(()=>x.service.deep({jobId:x.id})).toThrow('请配置 Qwen');expect(pipeline).not.toHaveBeenCalled()
  expect(x.service.view().jobs[0].deep).toBeUndefined()
})
it('cancels one deep execution while preserving original downloaded media metadata',async()=>{
  const x=setup();pipeline.mockImplementation(input=>new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})))
  x.service.deep({jobId:x.id});expect(()=>x.service.deep({jobId:x.id})).toThrow('已有视频')
  x.service.cancel(x.id);await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(x.service.view().jobs[0]).toMatchObject({phase:'completed',mediaPath:x.job.mediaPath,classification:x.job.classification,deep:{phase:'cancelled'}})
})
it('keeps actionable failures on the selected job and permits an explicit deep retry',async()=>{
  const x=setup();pipeline.mockRejectedValueOnce(Error('HTTP 429：额度不足')).mockResolvedValueOnce(x.result)
  x.service.deep({jobId:x.id});await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(x.service.view().jobs[0].deep).toMatchObject({phase:'failed',message:'HTTP 429：额度不足'})
  x.service.deep({jobId:x.id});await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(x.service.view().jobs[0].deep?.phase).toBe('completed');expect(pipeline).toHaveBeenCalledTimes(2)
})
it('only serves source-bound verified report frames and refuses tampered files',async()=>{
  const x=setup();pipeline.mockResolvedValue(x.result);x.service.deep({jobId:x.id});await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(x.service.frame({jobId:x.id,frameId:'frame-1'})).toMatchObject({id:'frame-1',timeMs:10,dataUrl:expect.stringContaining('data:image/jpeg;base64,')})
  expect(()=>x.service.frame({jobId:randomUUID(),frameId:'frame-1'})).toThrow('不可用')
  writeFileSync(x.framePath,'tampered');expect(()=>x.service.frame({jobId:x.id,frameId:'frame-1'})).toThrow('内容校验失败')
})
it('persists live report display timing once and never attributes a historical reopen to a new click',async()=>{
  const x=setup();pipeline.mockResolvedValue(x.result);x.service.deep({jobId:x.id,clickedAt:Date.now()-500});await vi.waitFor(()=>expect(x.service.running).toBe(false))
  const view=x.service.displayed({jobId:x.id,displayedAt:Date.now()});expect(view.jobs[0].deep?.displayedTotalMs).toBeGreaterThanOrEqual(500)
  expect(x.service.displayed({jobId:x.id,displayedAt:0}).jobs[0].deep?.displayedTotalMs).toBe(view.jobs[0].deep?.displayedTotalMs)
  const reopened=new VideoWorkshopService(x.userData,{status:()=>({}),fork:()=>x.worker},()=>{},{downloadRoot:x.downloadRoot})
  cleanup.push(()=>reopened.stop());expect(reopened.displayed({jobId:x.id,displayedAt:Date.now()}).jobs[0].deep?.displayedTotalMs).toBe(view.jobs[0].deep?.displayedTotalMs)
})
