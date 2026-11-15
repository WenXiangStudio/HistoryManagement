import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,writeFileSync,rmSync,unlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect,vi,afterEach} from 'vitest'
import {VideoInformationStore} from './videoInformationStore'
import {VideoContentStore} from './videoContentStore'
import {VideoContentService} from './videoContentService'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'
import * as qwen from './qwenVideo'
import * as frameCloud from './cloudFrameRecognition'
vi.mock('./cloudFrameRecognition',async original=>({...await original<typeof import('./cloudFrameRecognition')>(),prepareCloudFrames:vi.fn(),recognizeCloudFrames:vi.fn()}))
vi.mock('./qwenVideo',async original=>({...await original<typeof import('./qwenVideo')>(),prepareQwenMedia:vi.fn(),transcribeQwen:vi.fn(),readQwenFrames:vi.fn()}))

afterEach(()=>vi.unstubAllGlobals())
function setup(){
  const db=new DatabaseSync(':memory:'),videos=new VideoInformationStore(db),content=new VideoContentStore(db),fixture=videoInformationFixture()
  videos.save(fixture.command,fixture.capture,fixture.time)
  const root=mkdtempSync(join(tmpdir(),'content-service-')),mediaPath=join(root,'source.mp4');writeFileSync(mediaPath,'test')
  const following={videoContent:content,videoInformation:{store:videos},videoDiscovery:{running:false},contentRunning:()=>false,
    requireOwner:(owner:string)=>{if(owner!==fixture.command.ownerSecUid)throw Error('OWNER_CHANGED')},status:()=>({phase:'idle'}),
    captureWorkEvidence:vi.fn(async()=>({directory:root,mediaPath,byteLength:4,sha256:'media-hash',capturedAt:fixture.time}))}
  const runtime={status:()=>({pythonAvailable:true,asrAvailable:true,ocrAvailable:false,localSummaryValidated:true}),request:vi.fn(async()=>({segments:[{id:'speech-1',startMs:0,endMs:1000,text:'作者介绍如何使用一个工具。'}]})),
    summaryProvider:async()=>({kind:'local',baseUrl:'http://127.0.0.1:12345/v1',model:'test-model'}),stop:vi.fn(),stopSummary:vi.fn()}
  const service=new VideoContentService(following as any,runtime as any,root,()=>{throw Error('CLOUD_UNCONFIGURED')},()=>{})
  return {service,following,runtime,content,fixture,mediaPath,clean:()=>{service.stop();db.close();rmSync(root,{recursive:true,force:true})}}
}
it('runs the selected work continuously and reuses every successful stage without platform requests',async()=>{
  const x=setup(),summary={overview:'作者介绍一种工具用法。',overviewEvidenceIds:['speech-1'],topics:['工具'],keyPoints:[{text:'作者介绍工具的用法。',evidenceIds:['speech-1']}],sections:[],limitations:[]}
  const fetch=vi.fn(async()=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(summary)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}))
  vi.stubGlobal('fetch',fetch)
  try{
    const request={ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'local'}
    const first=x.service.start(request);await vi.waitFor(()=>expect(first.state).toBe('completed'))
    expect(x.content.detail(request.ownerSecUid,request.workIds[0]).summary?.overview).toBe(summary.overview)
    x.content.setInterest(request.ownerSecUid,request.workIds[0],'interested')
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    const second=x.service.start(request);await vi.waitFor(()=>expect(second.state).toBe('completed'))
    expect(x.following.captureWorkEvidence).toHaveBeenCalledTimes(1);expect(x.runtime.request).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1)
    expect(x.content.detail(request.ownerSecUid,request.workIds[0]).interest).toBe('interested')
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    // Expired original media must not force another platform download just to summarize saved text.
    unlinkSync(x.mediaPath)
    x.service['cloud']=()=>({kind:'cloud',baseUrl:'https://provider.invalid/v1',model:'cloud-test'})
    x.runtime.status=()=>({pythonAvailable:false,asrAvailable:false,ocrAvailable:false,localSummaryValidated:false})
    const cloud=x.service.start({...request,provider:'cloud'});await vi.waitFor(()=>expect(cloud.state).toBe('completed'))
    expect(x.following.captureWorkEvidence).toHaveBeenCalledTimes(1);expect(x.runtime.request).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body).response_format).toEqual({type:'json_object'})
  }finally{x.clean()}
})
it('does not start any work for an unconfigured cloud provider',()=>{const x=setup();try{
  expect(()=>x.service.start({ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'cloud'})).toThrow('CLOUD_UNCONFIGURED')
  expect(x.following.captureWorkEvidence).not.toHaveBeenCalled()
}finally{x.clean()}})
it('keeps an interrupted source stage and no generated summary when cancelled',async()=>{
  const x=setup();x.runtime.request.mockImplementation((_method?:any,_params?:any,signal?:any)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')))))
  try{const batch=x.service.start({ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'local'})
    await vi.waitFor(()=>expect(x.runtime.request).toHaveBeenCalled());x.service.cancel(x.fixture.command.ownerSecUid)
    await vi.waitFor(()=>expect(x.service.running).toBe(false));expect(batch.state).toBe('cancelled')
    const detail=x.content.detail(x.fixture.command.ownerSecUid,x.fixture.command.workId);expect(detail.summary).toBeNull();expect(detail.stages.find(s=>s.stage==='media')?.state).toBe('completed')
  }finally{x.clean()}
})
it('a local model that failed fidelity review never publishes a generated summary',async()=>{
  const x=setup();x.runtime.status=()=>({pythonAvailable:true,asrAvailable:true,ocrAvailable:false,localSummaryValidated:false})
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  try{const batch=x.service.start({ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'local'})
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(batch.state).toBe('partial');expect(batch.completedWorkIds).toEqual([x.fixture.command.workId]);expect(batch.failedWorkIds).toEqual([])
    expect(batch.pendingSummaryWorkIds).toEqual([x.fixture.command.workId]);expect(fetch).not.toHaveBeenCalled()
    expect(x.content.detail(x.fixture.command.ownerSecUid,x.fixture.command.workId).summary).toBeNull()
    expect(x.content.info(x.fixture.command.ownerSecUid).get(x.fixture.command.workId)?.overview).toBeUndefined()
  }finally{x.clean()}
})
it('a requested cloud visual failure remains a failed task with completed local speech preserved',async()=>{
  const x=setup();x.service['cloud']=()=>({kind:'cloud',baseUrl:'https://provider.invalid/v1',model:'vision-test',apiKey:'test-key'})
  x.runtime.request.mockImplementation(async(method?:any)=>method==='frames'?{frames:[{id:'frame-1',timeMs:0,path:x.mediaPath,sha256:'test'}]} as any:{segments:[{id:'speech-1',startMs:0,endMs:1000,text:'讲述内容'}]})
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:429})))
  try{const batch=x.service.start({ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'local',includeVision:true})
    await vi.waitFor(()=>expect(x.service.running).toBe(false));expect(batch.state).toBe('failed');expect(batch.completedWorkIds).toEqual([])
    expect(x.content.detail(x.fixture.command.ownerSecUid,x.fixture.command.workId).stages.find(s=>s.stage==='transcript')?.state).toBe('completed')
  }finally{x.clean()}
})

it('runs the single-model route without local models or a local speech/OCR worker and persists cloud provenance',async()=>{
 const x=setup();x.runtime.status=()=>({pythonAvailable:false,asrAvailable:false,ocrAvailable:false,localSummaryValidated:false})
 ;(x.runtime as any).paths=()=>({ffmpeg:'ffmpeg',ffprobe:'ffprobe'})
 x.service['cloud']=()=>({kind:'cloud',baseUrl:'https://ws-test.cn-beijing.maas.aliyuncs.com/v1',model:'qwen3.8-omni-flash',protocol:'responses',apiKey:'test'})
 vi.mocked(qwen.prepareQwenMedia).mockResolvedValue({directory:join(x.mediaPath,'..'),durationMs:1000,hasAudio:true,frames:[],preprocessMs:1} as any)
 vi.mocked(qwen.transcribeQwen).mockResolvedValue({segments:[{id:'speech-cloud-1',startMs:0,endMs:1000,text:'作者说币值不是市值。'}],uncertainties:[],modelVersion:'qwen3.8-omni-flash',timestampPrecision:'chunk'} as any)
 vi.mocked(qwen.readQwenFrames).mockResolvedValue({frames:[],blocks:[],vision:{observations:[],limitations:[]}} as any)
 const summary={overview:'作者说明币值与市值不同。',overviewEvidenceIds:['speech-cloud-1'],topics:['币值'],keyPoints:[{text:'作者区分币值与市值。',evidenceIds:['speech-cloud-1']}],sections:[],limitations:[]}
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(summary)}]}]}})+'\n\n')))
 try{
  const batch=x.service.start({ownerSecUid:x.fixture.command.ownerSecUid,workIds:[x.fixture.command.workId],provider:'cloud-omni'})
  await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(batch.state).toBe('completed');expect(x.runtime.request).not.toHaveBeenCalled()
  const detail=x.content.detail(x.fixture.command.ownerSecUid,x.fixture.command.workId)
  expect(detail.summary?.modelVersion).toBe('qwen3.8-omni-flash');expect(detail.stages.find(s=>s.stage==='transcript')?.result).toMatchObject({timestampPrecision:'chunk'})
  expect(batch.cloudIdentity).toBeTruthy()
 }finally{x.clean()}
})
it('cloud frames run only the selected cloud visual stage with old speech, OCR and summary rows preserved',async()=>{
 const x=setup(),owner=x.fixture.command.ownerSecUid,id=x.fixture.command.workId
 x.runtime.status=()=>{throw Error('Must not inspect local model readiness')}
 ;(x.runtime as any).paths=()=>({ffmpeg:'ffmpeg',ffprobe:'ffprobe'})
 x.runtime.summaryProvider=vi.fn(async()=>{throw Error('Local summary prohibited')})
 x.service['cloud']=()=>({kind:'cloud',baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3.5-4B',apiKey:'key'})
 const root=join(x.mediaPath,'..');writeFileSync(join(root,'proof.json'),JSON.stringify({capture:{ownerVerification:{secUid:owner},work:x.fixture.capture.work}}))
 x.content.saveStage(owner,id,{stage:'media',state:'completed',inputHash:id,result:{directory:root,mediaPath:x.mediaPath,byteLength:4,sha256:'media-hash'}})
 x.content.saveStage(owner,id,{stage:'transcript',state:'completed',inputHash:'old-speech',result:{segments:[{text:'old audio'}]}})
 x.content.saveStage(owner,id,{stage:'visual',state:'completed',inputHash:'old-ocr',result:{blocks:[{text:'old OCR'}]}})
 const oldSpeech=x.content.stage(owner,id,'transcript',true)
 vi.mocked(frameCloud.prepareCloudFrames).mockResolvedValue({directory:root,frames:[],durationMs:1000,preparationMs:1} as any)
 vi.mocked(frameCloud.recognizeCloudFrames).mockResolvedValue({mode:'cloud-frames-only',readings:[{text:'new visual'}],frames:[],modelVersion:'Qwen/Qwen3.5-4B'} as any)
 try{
  const batch=x.service.start({ownerSecUid:owner,workIds:[id],provider:'cloud-frames',clickedAt:Date.now()})
  await vi.waitFor(()=>expect(x.service.running).toBe(false))
  expect(batch.state).toBe('completed');expect(x.runtime.request).not.toHaveBeenCalled();expect(x.runtime.summaryProvider).not.toHaveBeenCalled()
  expect(x.following.captureWorkEvidence).not.toHaveBeenCalled();expect(x.content.stage(owner,id,'transcript',true)).toEqual(oldSpeech)
  expect(x.content.stage(owner,id,'summary')).toBeUndefined();expect(x.content.stage(owner,id,'visual',true)?.result).toMatchObject({mode:'cloud-frames-only'})
 }finally{x.clean()}
})
