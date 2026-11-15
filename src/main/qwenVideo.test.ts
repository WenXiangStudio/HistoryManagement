import {afterEach,it,expect,vi} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {audioWindows,frameTimes,assertQwenVideoProvider,qwenProviderIdentity,transcribeQwen,readQwenFrames,validateSpeech,validateFrameReading} from './qwenVideo'
import {parseModelJson} from './modelJson'
const provider={kind:'cloud' as const,model:'qwen3.8-omni-flash',protocol:'responses' as const,baseUrl:'https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'test-private-key'}
let root=''
afterEach(()=>{vi.unstubAllGlobals();if(root){rmSync(root,{recursive:true,force:true});root=''}})
function prepared(){root=mkdtempSync(join(tmpdir(),'qwen-media-test-'));const file=join(root,'audio.mp3'),image=join(root,'frame.jpg');writeFileSync(file,'synthetic-audio');writeFileSync(image,'synthetic-image')
 return {directory:root,durationMs:120000,hasAudio:true,sourceSha256:'source',preprocessMs:5,promptVersion:'test',chunks:[{id:'speech-cloud-1',startMs:0,endMs:60000,path:file,sha256:'hash1',byteLength:15},{id:'speech-cloud-2',startMs:60000,endMs:120000,path:file,sha256:'hash2',byteLength:15}],frames:[{id:'cloud-frame-1',timeMs:0,path:image,sha256:'frame-hash'}]}}
const response=(result:unknown)=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:provider.model,output:[{type:'message',content:[{type:'output_text',text:'```json\n'+JSON.stringify(result)+'\n```'}]}],usage:{input_tokens:10,output_tokens:20}}})+'\n\n')
it('covers every audio millisecond once and bounds static samples across the first and last seconds',()=>{
 const ranges=audioWindows(478725);expect(ranges).toHaveLength(8);expect(ranges[0].startMs).toBe(0);expect(ranges.at(-1)?.endMs).toBe(478725)
 expect(ranges.reduce((n,r)=>n+r.endMs-r.startMs,0)).toBe(478725)
 for(let i=1;i<ranges.length;i++)expect(ranges[i].startMs).toBe(ranges[i-1].endMs)
 const times=frameTimes(478725);expect(times).toHaveLength(18);expect(times[0]).toBe(0);expect(times.at(-1)).toBe(477725)
 expect(()=>audioWindows(NaN)).toThrow();expect(()=>audioWindows(7200001)).toThrow()
})
it('rejects wrong providers or protocols before sending attachments and binds caches to the endpoint and model',()=>{
 expect(()=>assertQwenVideoProvider(provider)).not.toThrow()
 expect(()=>assertQwenVideoProvider({...provider,model:'old-image-model'})).toThrow()
 expect(()=>assertQwenVideoProvider({...provider,protocol:'chat-completions'})).toThrow()
 expect(()=>assertQwenVideoProvider({...provider,baseUrl:'https://evil.example/v1'})).toThrow()
 expect(qwenProviderIdentity({...provider,baseUrl:provider.baseUrl+'/other'})).not.toBe(qwenProviderIdentity(provider))
})
it('transcribes only audio using one configured model and reuses completed chunk receipts after partial failure',async()=>{
 const input=prepared(),fetch=vi.fn().mockResolvedValueOnce(response({speechPresent:true,text:'不能把币值与市值混为一谈。',uncertainties:[]})).mockResolvedValueOnce(new Response('{}',{status:503}))
 vi.stubGlobal('fetch',fetch)
 await expect(transcribeQwen(provider,input,new AbortController().signal)).rejects.toThrow('RESPONSES_PROVIDER_HTTP_503')
 fetch.mockResolvedValueOnce(response({speechPresent:true,text:'这是第二段全部音轨内容。',uncertainties:[]}))
 const result=await transcribeQwen(provider,input,new AbortController().signal)
 expect(result.segments.map(s=>s.startMs)).toEqual([0,60000]);expect(result.requests).toMatchObject([{cached:true},{cached:false}]);expect(fetch).toHaveBeenCalledTimes(3)
 const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body.model).toBe(provider.model)
 expect(body.input[1].content[1]).toMatchObject({type:'input_audio',format:'mp3',audio_url:expect.stringMatching(/^data:audio\/mpeg;base64,/)})
 expect(JSON.stringify(body)).not.toContain('test-private-key');expect(body.input[1].content).toHaveLength(2)
 expect(result.timestampPrecision).toBe('chunk');expect(result.fullAudioSubmitted).toBe(true)
})
it('reads actual images without supplying an old transcript and rejects omitted or invented frame references',async()=>{
 const input=prepared(),fetch=vi.fn(async()=>response({frames:[{frameId:'cloud-frame-1',visibleText:'币值',observation:'人物在书架前讲话',uncertainties:[]}],limitations:[]}));vi.stubGlobal('fetch',fetch)
 const result=await readQwenFrames(provider,input,new AbortController().signal)
 expect(result.blocks[0].text).toBe('币值');expect(result.vision.observations[0].frameIds).toEqual(['cloud-frame-1'])
 const body=JSON.parse((fetch.mock.calls[0] as any)[1].body);expect(body.input[1].content[1].type).toBe('input_image')
 expect(()=>validateFrameReading({frames:[],limitations:[]},['f'])).toThrow('CLOUD_FRAME_REFERENCE_INVALID')
 expect(()=>validateFrameReading({frames:[{frameId:'wrong',visibleText:'',observation:'',uncertainties:[]}],limitations:[]},['f'])).toThrow('CLOUD_FRAME_REFERENCE_INVALID')
})
it('requires real transcript text when speech is reported and never treats prose outside a JSON fence as valid',()=>{
 expect(()=>validateSpeech({speechPresent:true,text:'',uncertainties:[]})).toThrow('CLOUD_TRANSCRIPT_INVALID')
 expect(()=>validateSpeech({speechPresent:false,text:'invented speech',uncertainties:[]})).toThrow('CLOUD_TRANSCRIPT_INVALID')
 expect(parseModelJson('```json\n{"ok":true}\n```')).toEqual({ok:true})
 expect(()=>parseModelJson('Here is a guess. {"ok":true}')).toThrow()
})
