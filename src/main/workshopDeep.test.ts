import {afterEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {WORKSHOP_DEEP_MODEL,type WorkshopSpeech} from '../shared/workshopDeep'
import {assertWorkshopDeepProvider,buildWorkshopAlignment,processWorkshopDeep,validateWorkshopReadings,validateWorkshopReport,validateWorkshopSpeech,type WorkshopDeepInput} from './workshopDeep'

const roots:string[]=[]
afterEach(()=>{vi.unstubAllGlobals();for(const directory of roots.splice(0))rmSync(directory,{recursive:true,force:true})})
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex')
const provider={kind:'cloud' as const,baseUrl:'https://api.siliconflow.cn/v1',model:WORKSHOP_DEEP_MODEL,apiKey:'synthetic-private-key',protocol:'chat-completions' as const}

function fixture(options:{audio?:boolean;duration?:number;frameTimes?:number[]}={}){
  const directory=mkdtempSync(join(tmpdir(),'workshop-deep-'));roots.push(directory)
  const mediaPath=join(directory,'source.mp4'),bytes=Buffer.from('synthetic source fixture'),sha256=hash(bytes),durationMs=options.duration??24000
  writeFileSync(mediaPath,bytes)
  const output=join(directory,'workshop-deep-v1'),frameDirectory=join(output,'frames');mkdirSync(frameDirectory,{recursive:true})
  const imageBytes=Buffer.from([0xff,0xd8,0xff,0x00,0x01])
  const frames=(options.frameTimes??[0,2033,9977,10010,20001]).map((timeMs,index)=>({id:'timeline-'+(index+1),timeMs,path:join(frameDirectory,`frame-${index+1}.jpg`),sha256:hash(imageBytes)}))
  for(const frame of frames)writeFileSync(frame.path,imageBytes)
  const metadata={sha256,durationMs,hasVideo:true,hasAudio:options.audio!==false}
  const worker={request:vi.fn(async(method:string)=>{if(method==='probe')return metadata;if(method==='frames')return {status:'succeeded',frames,metadata,sampleIntervalMs:2000,coverage:'sampled-whole-timeline'};throw Error('unexpected method')})}
  const speech:WorkshopSpeech={state:'transcribed',text:'作者介绍第一项。接着展示界面。最后总结。',sourceSha256:sha256,durationMs,model:'doubao-flash',requestId:'speech-1',segments:[
    {id:'speech-1',startMs:500,endMs:3500,text:'作者介绍第一项。'},
    {id:'speech-2',startMs:9000,endMs:11500,text:'接着展示界面。'},
    {id:'speech-3',startMs:22000,endMs:23500,text:'最后总结。'}]}
  const transcribe=vi.fn().mockResolvedValue(speech),signal=new AbortController().signal,onProgress=vi.fn()
  const input:WorkshopDeepInput={media:{mediaPath,directory,sha256,byteLength:bytes.length},durationMs,worker,provider,signal,transcribe,onProgress}
  return {input,frames,speech,metadata,worker,transcribe,output}
}

function completion(output:unknown,overrides:Record<string,unknown>={}){
  return new Response(JSON.stringify({id:'synthetic-request',model:WORKSHOP_DEEP_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50},...overrides}))
}
function responder(){return vi.fn(async(_url:string,options:RequestInit)=>{
  const body=JSON.parse(String(options.body)),content=body.messages[0].content
  if(Array.isArray(content))return completion({frames:content.filter((item:any)=>item.type==='text'&&item.text.startsWith('frameId=')).map((item:any)=>({frameId:item.text.slice(8),text:'原始文字\n第二行',description:'画面展示一个界面。',uncertainties:[]}))})
  if(content.includes('输入材料：')){
    const material=JSON.parse(content.split('输入材料：')[1])
    return completion({overview:'作者介绍界面设计方法。',sections:material.windows.map((window:any)=>({id:window.id,title:'界面设计',summary:'作者介绍本段的方法。',analysis:'口播说明方法，画面展示对应界面。'})),limitations:[]})
  }
  return completion({overview:'作者按顺序介绍多个界面设计方法。'})
})}

it('uses the requested Qwen model and refuses an absent key or substituted provider/model/protocol',()=>{
  expect(()=>assertWorkshopDeepProvider(provider)).not.toThrow()
  for(const change of [{kind:'local' as const},{model:'Qwen/Qwen3.5-4B'},{baseUrl:'https://other.example/v1'},{apiKey:''},{apiKey:'bad\r\nkey'},{protocol:'responses' as const}])expect(()=>assertWorkshopDeepProvider({...provider,...change})).toThrow('请在设置')
})

it('preserves source frame PTS and original ASR intervals while programmatically aligning exact report windows',async()=>{
  const f=fixture(),fetcher=responder();vi.stubGlobal('fetch',fetcher)
  const result=await processWorkshopDeep(f.input)
  expect(result.frames.map(frame=>frame.timeMs)).toEqual([0,2033,9977,10010,20001])
  expect(result.readings.map(frame=>frame.timeMs)).toEqual([0,2033,9977,10010,20001])
  expect(result.speech.segments).toEqual(f.speech.segments)
  expect(result.report.sections.map(({id,startMs,endMs,speechIds,frameIds})=>({id,startMs,endMs,speechIds,frameIds}))).toEqual([
    {id:'section-1',startMs:0,endMs:10000,speechIds:['speech-1','speech-2'],frameIds:['timeline-1','timeline-2','timeline-3']},
    {id:'section-2',startMs:10000,endMs:20000,speechIds:['speech-2'],frameIds:['timeline-4']},
    {id:'section-3',startMs:20000,endMs:24000,speechIds:['speech-3'],frameIds:['timeline-5']}])
  expect(fetcher).toHaveBeenCalledTimes(3)
  const vision=JSON.parse(String(fetcher.mock.calls[0][1].body))
  expect(vision.messages).toHaveLength(1);expect(vision.messages[0].role).toBe('user');expect(vision.messages[0].content.filter((part:any)=>part.type==='image_url')).toHaveLength(3)
  expect(vision).toMatchObject({model:WORKSHOP_DEEP_MODEL,stream:false,enable_thinking:false})
  expect(vision.response_format).toEqual({type:'json_object'})
  const report=JSON.parse(String(fetcher.mock.calls[2][1].body))
  expect(report.model).toBe(WORKSHOP_DEEP_MODEL);expect(report.messages[0].content).toContain('"startMs":9000');expect(report.messages[0].content).toContain('"timeMs":9977')
  expect(report).not.toHaveProperty('response_format');expect(report.max_tokens).toBe(8192)
  expect(f.worker.request).toHaveBeenCalledWith('frames',expect.objectContaining({frameIntervalSeconds:2,expectedSha256:f.metadata.sha256,expectedDurationMs:24000}),f.input.signal)
  expect(result.timing.processingMs).toBeGreaterThanOrEqual(result.timing.recognitionMs)
})

it('caches successful speech, frames, vision and report requests without sending again or exposing the key',async()=>{
  const f=fixture(),fetcher=responder();vi.stubGlobal('fetch',fetcher)
  await processWorkshopDeep(f.input)
  const second=await processWorkshopDeep(f.input)
  expect(fetcher).toHaveBeenCalledTimes(3);expect(f.transcribe).toHaveBeenCalledTimes(1)
  expect(f.worker.request.mock.calls.filter(([method])=>method==='frames')).toHaveLength(1)
  expect(second.requests.every(request=>request.cached)).toBe(true)
  const files=readdirSync(f.output,{recursive:true,withFileTypes:true}).filter(item=>item.isFile()&&item.name.endsWith('.json'))
  const contents=files.map(item=>readFileSync(join(item.parentPath,item.name),'utf8')).join('')
  expect(contents).not.toContain(provider.apiKey)
  expect(second.report.sections).toHaveLength(3)
})

it.each(['no-audio','no-speech'] as const)('continues image analysis when %s, keeping transcript empty',async state=>{
  const f=fixture({audio:state!=='no-audio'}),fetcher=responder();vi.stubGlobal('fetch',fetcher)
  if(state==='no-speech')f.transcribe.mockResolvedValue({...f.speech,state:'no-speech',text:'',segments:[]})
  const result=await processWorkshopDeep(f.input)
  expect(result.speech.state).toBe(state);expect(result.speech.segments).toEqual([])
  expect(result.report.sections.every(section=>section.speechIds.length===0)).toBe(true)
  expect(result.readings).toHaveLength(5)
  if(state==='no-audio')expect(f.transcribe).not.toHaveBeenCalled()
})

it('rejects altered video bytes or substituted metadata before any transcription or cloud request',async()=>{
  const f=fixture(),fetcher=responder();vi.stubGlobal('fetch',fetcher)
  writeFileSync(f.input.media.mediaPath,'changed')
  await expect(processWorkshopDeep(f.input)).rejects.toThrow('VIDEO_MEDIA_HASH_MISMATCH')
  expect(f.transcribe).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()
  const other=fixture();other.metadata.sha256='f'.repeat(64)
  await expect(processWorkshopDeep(other.input)).rejects.toThrow('VIDEO_MEDIA_DURATION_MISMATCH')
  expect(other.transcribe).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()
})

it('rejects escaped, corrupted and out-of-range frame evidence before cloud submission',async()=>{
  const fetcher=responder();vi.stubGlobal('fetch',fetcher)
  const escaped=fixture();escaped.frames[0].path=escaped.input.media.mediaPath
  await expect(processWorkshopDeep(escaped.input)).rejects.toThrow('WORKSHOP_DEEP_EVIDENCE_PATH_REJECTED')
  const corrupt=fixture();writeFileSync(corrupt.frames[0].path,'altered')
  await expect(processWorkshopDeep(corrupt.input)).rejects.toThrow('WORKSHOP_FRAME_HASH_MISMATCH')
  const late=fixture();late.frames[0].timeMs=late.input.durationMs
  await expect(processWorkshopDeep(late.input)).rejects.toThrow('WORKSHOP_FRAME_TIMESTAMPS_INVALID')
  expect(fetcher).not.toHaveBeenCalled()
})

it('validates speech source, states and true monotonic timestamps without rewriting small API overlaps',()=>{
  const f=fixture()
  const overlap={...f.speech,segments:[{id:'s1',startMs:1,endMs:2000,text:'一'},{id:'s2',startMs:1980,endMs:3000,text:'二'}]}
  expect(validateWorkshopSpeech(overlap,f.metadata.sha256,24000).segments[1].startMs).toBe(1980)
  for(const change of [{sourceSha256:'f'.repeat(64)},{durationMs:23000},{state:'no-speech'},
    {segments:[{id:'same',startMs:1,endMs:2000,text:'一'},{id:'same',startMs:2100,endMs:3000,text:'二'}]},
    {segments:[{id:'s',startMs:2000,endMs:2000,text:'一'}]},
    {segments:[{id:'s',startMs:1,endMs:25000,text:'一'}]},
    {segments:[{id:'s1',startMs:1,endMs:2000,text:'一'},{id:'s2',startMs:1900,endMs:3000,text:'二'}]}]){
    expect(()=>validateWorkshopSpeech({...f.speech,...change},f.metadata.sha256,24000)).toThrow()
  }
})

it('rejects invented, duplicated or omitted reading and report IDs and fabricated report timestamps',()=>{
  const f=fixture(),frames=f.frames.slice(0,2),reading=(frameId:string)=>({frameId,text:'文字',description:'界面',uncertainties:[]})
  for(const rows of [[reading('missing')],[reading(frames[0].id),reading(frames[0].id)],[]])expect(()=>validateWorkshopReadings({frames:rows},frames)).toThrow()
  const alignment=buildWorkshopAlignment(24000,f.speech,f.frames),section=(id:string)=>({id,title:'小标题',summary:'总结',analysis:'分析'})
  for(const sections of [[section('invented')],alignment.slice(1).map(a=>section(a.id)),alignment.map(()=>section(alignment[0].id)),alignment.map(a=>({...section(a.id),startMs:999}))]){
    expect(()=>validateWorkshopReport({overview:'概览',sections,limitations:[]},alignment)).toThrow()
  }
})

it('refuses substituted models, incomplete completions and hallucinated frame references',async()=>{
  for(const variant of ['model','length','reference']){
    const f=fixture(),fetcher=vi.fn().mockResolvedValue(completion({frames:[{frameId:'invented',text:'',description:'',uncertainties:[]}]},
      variant==='model'?{model:'other-model'}:variant==='length'?{choices:[{finish_reason:'length',message:{content:'{}'}}]}:{}))
    vi.stubGlobal('fetch',fetcher)
    await expect(processWorkshopDeep(f.input)).rejects.toThrow(variant==='model'?'WORKSHOP_CLOUD_MODEL_MISMATCH':variant==='length'?'WORKSHOP_CLOUD_OUTPUT_INCOMPLETE':'WORKSHOP_VISION_REFERENCE_INVALID')
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
})

it('does not replay an unresolved network request on a later attempt',async()=>{
  const f=fixture(),fetcher=vi.fn().mockRejectedValue(Error('network down'));vi.stubGlobal('fetch',fetcher)
  await expect(processWorkshopDeep(f.input)).rejects.toThrow('WORKSHOP_CLOUD_NETWORK_FAILED')
  await expect(processWorkshopDeep(f.input)).rejects.toThrow('WORKSHOP_CLOUD_PREVIOUS_REQUEST_UNRESOLVED')
  expect(fetcher).toHaveBeenCalledTimes(1);expect(f.transcribe).toHaveBeenCalledTimes(1)
})

it('allows an explicit later attempt after a known HTTP failure and retains successful prior stages',async()=>{
  const f=fixture(),respond=responder(),fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockImplementation(respond);vi.stubGlobal('fetch',fetcher)
  await expect(processWorkshopDeep(f.input)).rejects.toThrow('API Key 无效')
  const result=await processWorkshopDeep(f.input)
  expect(result.report.sections).toHaveLength(3);expect(f.transcribe).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(4)
})

it('retries only a truncated report, reuses successful speech and vision, and retains every raw response attempt',async()=>{
  const f=fixture(),respond=responder(),fetcher=vi.fn(async(url:string,options:RequestInit)=>{
    const body=JSON.parse(String(options.body)),content=body.messages[0].content
    if(typeof content==='string'&&content.includes('输入材料：'))return completion({},
      {choices:[{finish_reason:'length',message:{content:'{"overview":"截断的报告'+ '\\t'.repeat(1000)}}]})
    return respond(url,options)
  })
  vi.stubGlobal('fetch',fetcher)
  await expect(processWorkshopDeep(f.input)).rejects.toThrow('图文分析报告返回内容未完整结束')
  expect(fetcher).toHaveBeenCalledTimes(3);expect(f.transcribe).toHaveBeenCalledTimes(1)
  const firstFile=readdirSync(f.output).find(name=>/^report-.+-response\.json$/.test(name))!
  const firstRaw=readFileSync(join(f.output,firstFile),'utf8')
  expect(firstRaw).toContain('length');expect(readdirSync(f.output).filter(name=>name.startsWith('vision-')&&/-response\.json$/.test(name))).toHaveLength(2)
  fetcher.mockImplementation(respond)
  const result=await processWorkshopDeep(f.input)
  expect(fetcher).toHaveBeenCalledTimes(4);expect(f.transcribe).toHaveBeenCalledTimes(1)
  expect(result.requests.filter(request=>request.stage==='vision').every(request=>request.cached)).toBe(true)
  expect(result.requests.find(request=>request.stage==='report')?.cached).toBe(false)
  const attempts=readdirSync(f.output).filter(name=>name.startsWith('report-')&&name.includes('-response-attempt-'))
  const previous=readdirSync(f.output).filter(name=>name.startsWith('report-')&&name.includes('-response-previous-'))
  expect(attempts).toHaveLength(2);expect(previous).toHaveLength(1)
  expect(readFileSync(join(f.output,previous[0]),'utf8')).toBe(firstRaw)
  expect(attempts.map(name=>readFileSync(join(f.output,name),'utf8')).some(raw=>raw===firstRaw)).toBe(true)
})

it('covers a longer video with bounded report chunks and the same Qwen overview model',async()=>{
  const f=fixture({audio:false,duration:180000,frameTimes:Array.from({length:18},(_,index)=>index*10000)}),fetcher=responder();vi.stubGlobal('fetch',fetcher)
  const result=await processWorkshopDeep(f.input)
  expect(result.report.sections).toHaveLength(18);expect(result.report.sections.at(-1)?.endMs).toBe(180000)
  const bodies=fetcher.mock.calls.map(call=>JSON.parse(String(call[1].body)))
  expect(bodies.every(body=>body.model===WORKSHOP_DEEP_MODEL)).toBe(true)
  expect(bodies.filter(body=>typeof body.messages[0].content==='string').every(body=>!('response_format' in body))).toBe(true)
  expect(bodies.every(body=>body.max_tokens===8192)).toBe(true)
  expect(result.requests.filter(request=>request.stage==='report')).toHaveLength(3)
  expect(result.requests.filter(request=>request.stage==='overview')).toHaveLength(1)
  expect(result.frames.at(-1)?.timeMs).toBe(170000)
})

it('stops promptly when cancelled and does not send a new cloud request',async()=>{
  const f=fixture(),controller=new AbortController(),fetcher=responder();controller.abort();vi.stubGlobal('fetch',fetcher)
  await expect(processWorkshopDeep({...f.input,signal:controller.signal})).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled();expect(f.worker.request).not.toHaveBeenCalled()
})
