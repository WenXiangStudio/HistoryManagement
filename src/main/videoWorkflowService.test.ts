import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect,vi,afterEach} from 'vitest'
import {VideoInformationStore} from './videoInformationStore'
import {VideoContentStore} from './videoContentStore'
import {VideoWorkflowService} from './videoWorkflowService'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'
import type {VideoClassification} from '../shared/videoWorkflow'
import {WORKFLOW_TEXT_MODEL,WORKFLOW_VISION_MODEL} from '../shared/videoWorkflow'
import {bodyHash,researchMaterial} from './materialResearch'
import {recognizeCloudFrames} from './cloudFrameRecognition'
vi.mock('./materialResearch',async original=>({...await original<typeof import('./materialResearch')>(),researchMaterial:vi.fn()}))
vi.mock('./cloudFrameRecognition',async original=>({...await original<typeof import('./cloudFrameRecognition')>(),recognizeCloudFrames:vi.fn()}))
afterEach(()=>vi.clearAllMocks())

function setup(code:VideoClassification['code']='speech',count=1){
  const db=new DatabaseSync(':memory:'),videos=new VideoInformationStore(db),store=new VideoContentStore(db),f=videoInformationFixture()
  const root=mkdtempSync(join(tmpdir(),'workflow-')),mediaPath=join(root,'source.mp4');writeFileSync(mediaPath,'sample')
  const sha256=createHash('sha256').update('sample').digest('hex'),media={mediaPath,directory:root,sha256,byteLength:6},owner=f.command.ownerSecUid,id=f.command.workId
  for(let i=0;i<count;i++){
    const workId=i===0?id:String(7100000000000000000n+BigInt(i)),command={...f.command,runId:f.command.runId+'-'+i,workId},capture={...f.capture,ownerVerification:{...f.capture.ownerVerification,runId:command.runId},work:{...f.capture.work,workId}}
    videos.save(command,capture,f.time)
    store.saveStage(owner,workId,{stage:'media',state:'completed',inputHash:sha256,result:media})
  }
  writeFileSync(join(root,'proof.json'),JSON.stringify({capture:f.capture}))
  const classification:VideoClassification={code,sourceSha256:sha256,ruleVersion:'existence-detection-triage-v1',strength:'较强',
    basis:{speechPercent:80,speechBinCoverage:1,retainedTextFrames:8,sampledFrames:8},frames:[],timing:{},asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false}
  store.saveStage(owner,id,{stage:'classification',state:'completed',inputHash:sha256,result:classification})
  const following={videoContent:store,videoInformation:{store:videos},videoDiscovery:{running:false},requireOwner:(o:string)=>{if(o!==owner)throw Error('OWNER_CHANGED')},
    status:()=>({phase:'idle'}),videoLibraryView:()=>({ownerSecUid:owner,records:videos.list(owner)}),
    setVideoInterest:(o:string,w:string,v:unknown)=>store.setInterest(o,w,v),captureWorkEvidence:vi.fn()}
  const runtime={status:()=>({triageAvailable:true}),request:vi.fn(async()=>({frames:[],metadata:{durationMs:1000}})),fork:vi.fn(),stop:vi.fn()}
  const speech={transcribeMaterial:vi.fn(async()=>({text:'作者认为应先验证字段归属，再完成展示。',requestId:'test',modelVersion:'豆包语音识别极速版'}))}
  const cloud=vi.fn((model:string)=>({kind:'cloud' as const,baseUrl:'https://api.siliconflow.cn/v1',model,apiKey:'test'}))
  vi.mocked(researchMaterial).mockImplementation(async(p,text)=>({overview:'作者介绍验证步骤。',analysis:'作者按先后顺序展开。',keyPoints:[{viewpoint:'先验证',explanation:'作者强调顺序',quotes:['先验证字段归属']}],
    domains:[{name:'软件工程',reasoning:'提到验证与展示',quotes:['完成展示']}],limitations:[],modelVersion:p.model,generatedAt:f.time,bodyHash:bodyHash(text),promptVersion:'test'}))
  const otherIdle=vi.fn()
  const service=new VideoWorkflowService(following as any,runtime as any,root,cloud,()=>speech as any,otherIdle,()=>{})
  return {db,videos,store,f,owner,id,classification,media,following,runtime,speech,cloud,service,root,otherIdle,
    start:()=>service.startProcessing({ownerSecUid:owner,workIds:[id]}),
    close:()=>{service.stop();db.close();rmSync(root,{recursive:true,force:true})}}
}
it.each(['speech','visual_text','pending','visual'] as const)('marking %s videos only saves interest even while other tasks are busy',async code=>{
  const x=setup(code);try{
    x.otherIdle.mockImplementation(()=>{throw Error('其他任务正在运行')})
    vi.spyOn(x.following,'status').mockReturnValue({phase:'running'})
    x.service.interest(x.owner,x.id,'interested');expect(x.service.running).toBe(false)
    expect(x.store.detail(x.owner,x.id).interest).toBe('interested')
    expect(x.store.batches(x.owner)).toEqual([])
    expect(x.store.stage(x.owner,x.id,'body')).toBeUndefined();expect(x.store.stage(x.owner,x.id,'research')).toBeUndefined()
    expect(x.otherIdle).not.toHaveBeenCalled()
    x.service.interest(x.owner,x.id,'not-interested')
    expect(x.store.detail(x.owner,x.id).interest).toBe('not-interested')
    expect(x.cloud).not.toHaveBeenCalled();expect(x.speech.transcribeMaterial).not.toHaveBeenCalled();expect(x.runtime.request).not.toHaveBeenCalled()
  }finally{x.close()}
})
it('speech route uses only Doubao then GLM, saves complete body and reuses successful results',async()=>{
  const x=setup();try{
    x.service.interest(x.owner,x.id,'interested');x.start();await vi.waitFor(()=>expect(x.service.running).toBe(false))
    const info=x.store.info(x.owner).get(x.id)!
    expect(info.body?.text).toBe('作者认为应先验证字段归属，再完成展示。');expect(info.research?.modelVersion).toBe(WORKFLOW_TEXT_MODEL)
    expect(x.cloud).toHaveBeenCalledTimes(1);expect(x.cloud).toHaveBeenCalledWith(WORKFLOW_TEXT_MODEL)
    expect(recognizeCloudFrames).not.toHaveBeenCalled();expect(x.runtime.request).not.toHaveBeenCalled()
    x.service.interest(x.owner,x.id,'interested');expect(x.start()).toEqual([]);expect(x.service.running).toBe(false);expect(x.speech.transcribeMaterial).toHaveBeenCalledTimes(1)
    x.service.inboxState(x.owner,x.id,'saved');expect(x.store.info(x.owner).get(x.id)?.inboxState).toBe('saved')
  }finally{x.close()}
})
it('graphics route uses Qwen frames then GLM, flags human review, and never submits speech',async()=>{
  const x=setup('visual_text')
  vi.mocked(recognizeCloudFrames).mockResolvedValue({readings:[{text:'画面文案第一段'},{text:'画面文案第一段'},{text:'第二段文案'}]} as any)
  try{
    x.service.interest(x.owner,x.id,'interested');x.start();await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.speech.transcribeMaterial).not.toHaveBeenCalled();expect(x.cloud.mock.calls).toEqual([[WORKFLOW_VISION_MODEL,true],[WORKFLOW_TEXT_MODEL]])
    expect(x.runtime.request).toHaveBeenCalledWith('frames',expect.objectContaining({frameIntervalSeconds:2}),expect.any(AbortSignal))
    expect(x.store.info(x.owner).get(x.id)?.body).toMatchObject({source:'qwen-vision',text:'画面文案第一段\n\n第二段文案',needsReview:true})
  }finally{x.close()}
})
it('removing interest during transcription prevents saving a new body and prevents research',async()=>{
  const x=setup();let complete:(value:any)=>void=()=>{}
  x.speech.transcribeMaterial.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
  try{
    x.service.interest(x.owner,x.id,'interested');x.start();await vi.waitFor(()=>expect(x.speech.transcribeMaterial).toHaveBeenCalled())
    x.service.interest(x.owner,x.id,'not-interested');complete({text:'late result',modelVersion:'doubao'})
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.store.stage(x.owner,x.id,'body',true)).toBeUndefined();expect(x.cloud).not.toHaveBeenCalled()
  }finally{x.close()}
})
it('failed report preserves body; continuing does not submit speech again; corrected body replaces report only after success',async()=>{
  const x=setup();try{
    vi.mocked(researchMaterial).mockRejectedValueOnce(Error('GLM_HTTP_429'))
    x.service.interest(x.owner,x.id,'interested');x.start();await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.store.info(x.owner).get(x.id)?.body?.text).toContain('作者认为');expect(x.store.stage(x.owner,x.id,'research')?.state).toBe('failed')
    const reportsBefore=vi.mocked(researchMaterial).mock.calls.length
    x.service.interest(x.owner,x.id,'interested');expect(x.service.running).toBe(false);expect(researchMaterial).toHaveBeenCalledTimes(reportsBefore)
    const failed=x.store.batches(x.owner)[0];x.service.resume(x.owner,failed.id);await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.speech.transcribeMaterial).toHaveBeenCalledTimes(1)
    vi.mocked(researchMaterial).mockRejectedValueOnce(Error('offline'))
    x.service.reviseBody(x.owner,x.id,'校对后的新正文。');await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.store.info(x.owner).get(x.id)?.body?.text).toBe('校对后的新正文。')
    expect(x.store.info(x.owner).get(x.id)?.research).toBeUndefined()
    expect(x.store.stage(x.owner,x.id,'research',true)?.result).toBeTruthy()
  }finally{x.close()}
})
it('manual classification correction controls routing and retains the original detection result',async()=>{
  const x=setup('pending');try{
    x.service.interest(x.owner,x.id,'interested');x.service.review(x.owner,x.id,{code:'speech',note:'观看确认是口播'})
    expect(x.service.running).toBe(false);expect(x.store.batches(x.owner)).toEqual([]);expect(x.speech.transcribeMaterial).not.toHaveBeenCalled()
    x.start()
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(x.store.stage(x.owner,x.id,'classification',true)?.result).toMatchObject({code:'pending',manualReview:{code:'speech',note:'观看确认是口播'}})
    expect(x.speech.transcribeMaterial).toHaveBeenCalledTimes(1)
    expect(()=>x.service.interest('foreign',x.id,'interested')).toThrow('OWNER_CHANGED')
  }finally{x.close()}
})
it.each(['completed','partial','cancelled'] as const)('releases running state before publishing the %s workflow result',async outcome=>{
  const x=setup(),notifications:{state:string;running:boolean}[]=[]
  ;(x.service as any).changed=()=>{const batch=x.store.batches(x.owner)[0];if(batch)notifications.push({state:batch.state,running:x.service.running})}
  if(outcome==='partial')vi.mocked(researchMaterial).mockRejectedValueOnce(Error('research failed'))
  if(outcome==='cancelled')vi.mocked(researchMaterial).mockImplementationOnce(async(_provider,_text,_directory,signal)=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})
  }))
  try{
    x.service.interest(x.owner,x.id,'interested')
    x.start()
    if(outcome==='cancelled'){
      await vi.waitFor(()=>expect(x.store.stage(x.owner,x.id,'research')?.state).toBe('running'))
      x.service.cancel(x.owner)
    }
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(notifications.filter(n=>n.state===outcome)).toEqual([{state:outcome,running:false}])
    expect(x.store.batches(x.owner)[0].state).toBe(outcome)
  }finally{x.close()}
})
it('runs at most eight detection workers, saves classifications without transcribing or calling the cloud',async()=>{
  const x=setup('speech',10),ids=x.videos.list(x.owner).map(w=>w.workId)
  let active=0,peak=0
  const request=vi.fn(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,20));active--;return x.classification})
  x.runtime.fork.mockImplementation(()=>({request,stop:vi.fn()}))
  vi.spyOn(x.service as any,'media').mockResolvedValue(x.media)
  try{
    x.service.interest(x.owner,ids.find(id=>id!==x.id)!,'interested')
    const batch=x.service.startTriage({ownerSecUid:x.owner,workIds:ids})
    await vi.waitFor(()=>expect(x.service.running).toBe(false))
    expect(batch.state).toBe('completed');expect(batch.completedWorkIds).toHaveLength(10);expect(peak).toBe(8)
    expect(x.runtime.fork).toHaveBeenCalledTimes(8);expect(x.cloud).not.toHaveBeenCalled();expect(x.speech.transcribeMaterial).not.toHaveBeenCalled()
    expect(x.store.batches(x.owner)).toHaveLength(1);expect(x.store.batches(x.owner)[0].provider).toBe('triage')
    x.service.rendered(x.owner,batch.id,ids)
    expect(x.store.batch(x.owner,batch.id)?.displayedTotalMs).toBeTypeOf('number')
  }finally{x.close()}
})
it('validates an explicit selection before queuing, requires interest and an actionable classification',()=>{
  const x=setup();try{
    expect(()=>x.start()).toThrow('请先标记感兴趣')
    x.service.interest(x.owner,x.id,'interested')
    expect(()=>x.service.startProcessing({ownerSecUid:'foreign',workIds:[x.id]})).toThrow('OWNER_CHANGED')
    expect(()=>x.service.startProcessing({ownerSecUid:x.owner,workIds:[x.id,'7000000000000000009']})).toThrow('不属于当前账号')
    expect(x.store.batches(x.owner)).toEqual([])
    x.otherIdle.mockImplementation(()=>{throw Error('其他任务正在运行')})
    expect(()=>x.start()).toThrow('其他任务正在运行')
  }finally{x.close()}
  for(const code of ['pending','visual'] as const){const x=setup(code);try{
    x.service.interest(x.owner,x.id,'interested')
    expect(()=>x.start()).toThrow(code==='pending'?'人工审核':'人工观看')
    expect(x.store.batches(x.owner)).toEqual([])
  }finally{x.close()}}
})
it('marking an unclassified work never starts classification or downstream processing',()=>{
  const x=setup();try{
    x.db.prepare("DELETE FROM video_content_stages WHERE stage='classification'").run()
    x.service.interest(x.owner,x.id,'interested')
    expect(x.runtime.fork).not.toHaveBeenCalled();expect(x.store.batches(x.owner)).toEqual([])
    expect(()=>x.start()).toThrow('请先完成本地分类')
  }finally{x.close()}
})
