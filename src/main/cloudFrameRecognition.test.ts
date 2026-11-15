import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assertCloudFrameProvider,cloudFrameTimes,recognizeCloudFrames,validateCloudFrameResult} from './cloudFrameRecognition'
const dirs:string[]=[]
afterEach(()=>{vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
const provider={kind:'cloud' as const,baseUrl:'https://api.siliconflow.cn/v1',model:'Qwen/Qwen3.5-4B',apiKey:'synthetic-key'}
function prepared(){const directory=mkdtempSync(join(tmpdir(),'cloud-frames-'));dirs.push(directory)
  const bytes=Buffer.from('synthetic image'),frames=Array.from({length:4},(_,i)=>({id:'sf-frame-'+(i+1),timeMs:i*1000,path:join(directory,`frame-${i+1}.jpg`),sha256:createHash('sha256').update(bytes).digest('hex')}))
  for(const f of frames)writeFileSync(f.path,bytes)
  return {directory,frames,durationMs:4000,preparationMs:2,framesReused:false,sourceSha256:'source'}
}
function response(ids:string[]){return new Response(JSON.stringify({id:'receipt-'+ids[0],model:provider.model,
  choices:[{finish_reason:'stop',message:{content:JSON.stringify({frames:ids.map(frameId=>({frameId,text:' 原始字幕\n',description:'图中可见一段文字。',uncertainties:[]}))})}}],usage:{prompt_tokens:100,completion_tokens:50}}))}
it('samples the whole timeline and refuses local or other provider/model routes',()=>{
  const times=cloudFrameTimes(76933);expect(times).toHaveLength(12);expect(times[0]).toBe(0);expect(times.at(-1)).toBe(76633)
  for(const p of [{...provider,kind:'local' as const},{...provider,baseUrl:'https://other.example/v1'},{...provider,model:'zai-org/GLM-5.3-Flash'}])expect(()=>assertCloudFrameProvider(p)).toThrow()
})
it('rejects missing, duplicate or invented frame IDs',()=>{
  for(const frames of [[],[{frameId:'unknown',text:'',description:'',uncertainties:[]}],[{frameId:'f1',text:'',description:'',uncertainties:[]},{frameId:'f1',text:'',description:'',uncertainties:[]}]]){
    expect(()=>validateCloudFrameResult({frames},['f1','f2'])).toThrow()
  }
})
it('submits only image groups, preserves text and raw receipts, then reuses success without repeat calls',async()=>{
  const p=prepared(),fetcher=vi.fn().mockResolvedValueOnce(response(p.frames.slice(0,3).map(f=>f.id))).mockResolvedValueOnce(response([p.frames[3].id]))
  vi.stubGlobal('fetch',fetcher)
  const r=await recognizeCloudFrames(provider,p,new AbortController().signal)
  expect(fetcher).toHaveBeenCalledTimes(2);expect(r.readings).toHaveLength(4);expect(r.readings[0].text).toBe(' 原始字幕\n')
  expect(r).toMatchObject({localModelsUsed:false,audioSubmitted:false,summaryGenerated:false,usage:{inputTokens:200,outputTokens:100}})
  const body=JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.enable_thinking).toBe(false);expect(body.messages[1].content.filter((x:any)=>x.type==='image_url')).toHaveLength(3)
  expect(JSON.stringify(body)).not.toContain('audio');expect(JSON.stringify(body)).not.toContain(p.directory)
  const cache=await recognizeCloudFrames(provider,p,new AbortController().signal)
  expect(cache.requests.every(r=>r.cached)).toBe(true);expect(cache.timing.requestMs).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2)
  const evidence=readdirSync(p.directory,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(e=>readFileSync(join(e.parentPath,e.name),'utf8')).join('')
  expect(evidence).not.toContain(provider.apiKey)
})
it('never silently resends a request whose completion is unknown',async()=>{
  const p=prepared(),fetcher=vi.fn().mockRejectedValue(new Error('network lost'));vi.stubGlobal('fetch',fetcher)
  await expect(recognizeCloudFrames(provider,p,new AbortController().signal)).rejects.toThrow('network lost')
  await expect(recognizeCloudFrames(provider,p,new AbortController().signal)).rejects.toThrow('CLOUD_FRAME_PREVIOUS_REQUEST_UNRESOLVED')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('blocks changed frame bytes before sending and rejects substituted model or truncated output',async()=>{
  const p=prepared(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);writeFileSync(p.frames[0].path,'changed')
  await expect(recognizeCloudFrames(provider,p,new AbortController().signal)).rejects.toThrow('VIDEO_FRAME_PATH_REJECTED');expect(fetcher).not.toHaveBeenCalled()
  for(const [model,finish] of [['other','stop'],[provider.model,'length']]){
    const v=prepared();fetcher.mockResolvedValueOnce(new Response(JSON.stringify({model,choices:[{finish_reason:finish,message:{content:'{}'}}]})))
    await expect(recognizeCloudFrames(provider,v,new AbortController().signal)).rejects.toThrow(/CLOUD_FRAME_(MODEL_MISMATCH|OUTPUT_INCOMPLETE)/)
  }
})
