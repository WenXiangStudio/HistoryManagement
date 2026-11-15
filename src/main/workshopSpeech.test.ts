import {afterEach,describe,expect,it,vi} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {DoubaoSpeechService,DOUBAO_FLASH_RESOURCE,WORKSHOP_SPEECH_VERSION,workshopDoubaoResult} from './doubaoSpeech'
import {mediaCommand} from './qwenVideo'

vi.mock('./qwenVideo',()=>({mediaCommand:vi.fn()}))
const folders:string[]=[],databases:DatabaseSync[]=[]
const audioBase=resolve('E:\\AudioDownload','video-workshop'),videoBase=resolve('E:\\VideoDownload','video-workshop-tests')
afterEach(()=>{
  vi.restoreAllMocks();vi.unstubAllGlobals();vi.mocked(mediaCommand).mockReset()
  for(const db of databases.splice(0))db.close()
  for(const directory of folders.splice(0)){
    const target=resolve(directory)
    if(target.startsWith(audioBase+'\\')||target.startsWith(videoBase+'\\')||target.startsWith(resolve(tmpdir(),'signal-workshop-speech-')))rmSync(target,{recursive:true,force:true})
    else throw Error('Test cleanup escaped its intended directory')
  }
})
function fixture(options:{durationMs?:number;origin?:number;audioStart?:number;withSecret?:boolean}={}){
  mkdirSync(videoBase,{recursive:true})
  const dir=mkdtempSync(join(tmpdir(),'signal-workshop-speech-')),sourceDirectory=mkdtempSync(join(videoBase,'run-'))
  folders.push(dir,sourceDirectory)
  const db=new DatabaseSync(':memory:');databases.push(db)
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT)')
  db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('unrelated',JSON.stringify({stars:['keep'],notes:'keep'}),'old')
  const secrets=new Map<string,string>(),secret='workshop-secret-123'
  const sourcePath=join(sourceDirectory,'source.mp4');writeFileSync(sourcePath,randomUUID())
  const sha256=createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),durationMs=options.durationMs??10000
  const audioDirectory=join(audioBase,sha256,WORKSHOP_SPEECH_VERSION);folders.push(resolve(audioBase,sha256))
  const media={mediaPath:sourcePath,directory:sourceDirectory,sha256}
  const service=new DoubaoSpeechService(db,dir,ref=>({getApiKey:()=>secrets.get(ref)??null,setApiKey:v=>{secrets.set(ref,v)}}),{} as any,
    {paths:()=>({ffmpeg:'ffmpeg',ffprobe:'ffprobe'})} as any,()=>{},()=>{})
  if(options.withSecret!==false)service.save({authMode:'api-key',appId:'',secret})
  vi.mocked(mediaCommand).mockImplementation(async(executable,args,signal)=>{
    signal.throwIfAborted()
    if(executable==='ffprobe')return JSON.stringify({format:{duration:String(durationMs/1000),start_time:String(options.origin??0)},streams:[{codec_type:'video',index:0},{codec_type:'audio',index:1,start_time:String(options.audioStart??0)}]})
    writeFileSync(args.at(-1)!,Buffer.from('synthetic audio for request mock'))
    return ''
  })
  const snapshot=()=>JSON.stringify(db.prepare('SELECT * FROM app_settings ORDER BY key').all())
  return {service,db,dir,media,durationMs,audioDirectory,snapshot,secret}
}
const body=(durationMs=10000)=>({audio_info:{duration:durationMs},result:{text:' 原始语音，保留空格。\n',utterances:[{start_time:2000,end_time:4000,text:' 原始语音，'},{start_time:4500,end_time:8000,text:'保留空格。\n'}]}})
const response=(value:unknown=body(),code='20000000',status=200)=>new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'x-api-status-code':code,'x-tt-logid':'trace'}})

describe('workshop timed Doubao speech',()=>{
  it('keeps exact original transcript and provider millisecond timestamps',()=>{
    const parsed=workshopDoubaoResult(body(),10000)
    expect(parsed).toEqual({state:'transcribed',durationMs:10000,text:' 原始语音，保留空格。\n',segments:[{id:'speech-1',startMs:2000,endMs:4000,text:' 原始语音，'},{id:'speech-2',startMs:4500,endMs:8000,text:'保留空格。\n'}]})
  })
  it.each([
    ['missing utterances',{audio_info:{duration:10000},result:{text:'word'}}],
    ['missing times',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'word'}]}}],
    ['decimal times',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'word',start_time:0.5,end_time:1000}]}}],
    ['negative times',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'word',start_time:-1,end_time:1000}]}}],
    ['past source end',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'word',start_time:0,end_time:10001}]}}],
    ['reversed times',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'word',start_time:500,end_time:500}]}}],
    ['nonmonotonic',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'one',start_time:1000,end_time:2000},{text:'two',start_time:500,end_time:2500}]}}],
    ['excess overlap',{audio_info:{duration:10000},result:{text:'word',utterances:[{text:'one',start_time:0,end_time:2000},{text:'two',start_time:1900,end_time:3000}]}}],
    ['duration mismatch',{audio_info:{duration:20000},result:{text:'word',utterances:[{text:'word',start_time:0,end_time:1000}]}}]
  ])('rejects %s without fabricating intervals',(_name,value)=>expect(()=>workshopDoubaoResult(value,10000)).toThrow())
  it('preserves genuine 50ms boundary overlap without changing times',()=>{
    const value=body();value.result.utterances[1].start_time=3950
    expect(workshopDoubaoResult(value,10000).segments[1].startMs).toBe(3950)
  })
  it('fails readiness before media work when credentials are absent',async()=>{
    const {service,media,durationMs}=fixture({withSecret:false}),fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    expect(()=>service.requireWorkshopReady()).toThrow(/凭据/)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/凭据/)
    expect(mediaCommand).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('sends one flash request, stores audio on E, and reuses a validated timed cache',async()=>{
    const {service,media,durationMs,audioDirectory,snapshot,secret}=fixture({origin:7,audioStart:9}),before=snapshot(),fetch=vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch',fetch)
    const result=await service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    expect(result).toMatchObject({state:'transcribed',sourceSha256:media.sha256,resourceId:DOUBAO_FLASH_RESOURCE,audioPath:join(audioDirectory,'audio.mp3')})
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error',headers:{'X-Api-Resource-Id':DOUBAO_FLASH_RESOURCE,'X-Api-Key':secret,'X-Api-Request-Id':result.requestId}})
    expect(JSON.parse(fetch.mock.calls[0][1].body).request.show_utterances).toBe(true)
    const command=vi.mocked(mediaCommand).mock.calls.find(([name])=>name==='ffmpeg')![1]
    expect(command).toContain('-copyts');expect(command).toContain('asetpts=PTS-(7)/TB,aresample=async=1:first_pts=0,apad')
    expect(command.at(-1)).toBe(join(audioDirectory,'audio.mp3'))
    expect(await service.transcribeWorkshop(media,durationMs,new AbortController().signal)).toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(1);expect(snapshot()).toBe(before)
    expect(readFileSync(join(audioDirectory,'receipt.json'),'utf8')).not.toContain(secret)
  })
  it('checks original media hash before trusting a cached transcript',async()=>{
    const {service,media,durationMs}=fixture(),fetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',fetch)
    await service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    writeFileSync(media.mediaPath,'different source')
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/原片内容/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not trust a receipt after the exported audio is changed',async()=>{
    const {service,media,durationMs,audioDirectory}=fixture(),fetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',fetch)
    await service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    writeFileSync(join(audioDirectory,'audio.mp3'),'changed')
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/缓存校验失败/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not reuse historical flat-text workflow receipts',async()=>{
    const {service,media,durationMs}=fixture(),legacy=join(media.directory,'workflow-doubao-flash');mkdirSync(legacy)
    writeFileSync(join(legacy,'receipt.json'),JSON.stringify({text:'old untimed text',sourceSha256:media.sha256}))
    const fetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',fetch)
    const result=await service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    expect(result.segments).toHaveLength(2);expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retains one stable request ID after a network uncertainty and blocks resubmission',async()=>{
    const {service,media,durationMs,audioDirectory}=fixture(),fetch=vi.fn().mockRejectedValue(Error('network failed'))
    vi.stubGlobal('fetch',fetch)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/结果未知/)
    const marker=readFileSync(join(audioDirectory,'submitted.json'),'utf8')
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/Request ID/)
    expect(readFileSync(join(audioDirectory,'submitted.json'),'utf8')).toBe(marker);expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not resubmit a success response missing genuine sentence timestamps',async()=>{
    const {service,media,durationMs}=fixture(),fetch=vi.fn().mockResolvedValue(response({audio_info:{duration:10000},result:{text:'untimed'}}));vi.stubGlobal('fetch',fetch)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/时间戳/)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/Request ID/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('accepts explicit no-speech business response and caches empty segments',async()=>{
    const {service,media,durationMs}=fixture(),fetch=vi.fn().mockResolvedValue(response({audio_info:{duration:10000},result:{text:''}},'20000003'));vi.stubGlobal('fetch',fetch)
    const result=await service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    expect(result).toMatchObject({state:'no-speech',segments:[],text:''})
    expect(await service.transcribeWorkshop(media,durationMs,new AbortController().signal)).toEqual(result);expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects a no-speech status that contradicts returned speech',async()=>{
    const {service,media,durationMs}=fixture();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(body(),'20000003')))
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/矛盾/)
  })
  it('bounds the response body and keeps the submission uncertain after truncation',async()=>{
    const {service,media,durationMs}=fixture(),fetch=vi.fn().mockResolvedValue(new Response('too big',{headers:{'content-length':String(4*1024*1024+1),'x-api-status-code':'20000000'}}));vi.stubGlobal('fetch',fetch)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/结果未知/)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/Request ID/);expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('redacts credentials echoed in the raw response or service message',async()=>{
    const {service,media,durationMs,audioDirectory,secret}=fixture(),fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:secret,escaped:encodeURIComponent(secret)}),{status:401,headers:{'x-api-status-code':'45000001','x-api-message':secret}}));vi.stubGlobal('fetch',fetch)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/失败/)
    const marker=JSON.parse(readFileSync(join(audioDirectory,'submitted.json'),'utf8')),raw=readFileSync(join(audioDirectory,`response-${marker.requestId}.json`),'utf8')
    expect(raw).not.toContain(secret);expect(raw).toContain('[已隐藏]')
  })
  it('cancels before submission without creating a billable marker',async()=>{
    const {service,media,durationMs,audioDirectory}=fixture(),controller=new AbortController(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);controller.abort()
    await expect(service.transcribeWorkshop(media,durationMs,controller.signal)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled();expect(existsSync(join(audioDirectory,'submitted.json'))).toBe(false)
  })
  it('locks configuration and new speech runs while the workshop request is pending',async()=>{
    const {service,media,durationMs}=fixture();let resolveRequest!:(value:Response)=>void
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{resolveRequest=resolve})))
    const pending=service.transcribeWorkshop(media,durationMs,new AbortController().signal)
    await vi.waitFor(()=>expect(resolveRequest).toBeTypeOf('function'))
    expect(service.running).toBe(true);expect(()=>service.save({authMode:'api-key',appId:'',secret:'other'})).toThrow(/等待/)
    await expect(service.transcribeWorkshop(media,durationMs,new AbortController().signal)).rejects.toThrow(/正在运行/)
    resolveRequest(response());await pending;expect(service.running).toBe(false)
  })
  it('preserves a real two-second delayed audio track on the original video timeline',async()=>{
    const {service,media,audioDirectory}=fixture({durationMs:6000})
    const ffmpeg=resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),ffprobe=resolve('node_modules/@ffprobe-installer/win32-x64/ffprobe.exe')
    execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=64x64:r=10:d=6','-itsoffset','2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-map','0:v','-map','1:a','-c:v','libx264','-c:a','aac','-t','6','-metadata',`comment=${randomUUID()}`,media.mediaPath],{windowsHide:true})
    const sha256=createHash('sha256').update(readFileSync(media.mediaPath)).digest('hex')
    const actual=await vi.importActual<typeof import('./qwenVideo')>('./qwenVideo')
    vi.mocked(mediaCommand).mockImplementation((name,args,signal)=>actual.mediaCommand(name==='ffmpeg'?ffmpeg:ffprobe,args,signal))
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({audio_info:{duration:6000},result:{text:'tone test',utterances:[{text:'tone test',start_time:2000,end_time:4000}]}})))
    const expectedDirectory=join(audioBase,sha256,WORKSHOP_SPEECH_VERSION);folders.push(resolve(audioBase,sha256))
    const result=await service.transcribeWorkshop({...media,sha256},6000,new AbortController().signal)
    expect(result.audioPath).toBe(join(expectedDirectory,'audio.mp3'))
    expect(result.audioPath).not.toBe(join(audioDirectory,'audio.mp3'))
    const pcm=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',result.audioPath!,'-f','s16le','-ac','1','-ar','16000','pipe:1'],{windowsHide:true})
    const rms=(fromMs:number,toMs:number)=>{let energy=0,count=0;for(let i=Math.round(fromMs*16)*2;i<Math.min(pcm.length,Math.round(toMs*16)*2);i+=2){energy+=pcm.readInt16LE(i)**2;count++}return Math.sqrt(energy/count)}
    expect(rms(100,1800)).toBeLessThan(20);expect(rms(2100,3800)).toBeGreaterThan(300);expect(rms(4300,5800)).toBeLessThan(20)
    expect(result.segments[0]).toMatchObject({startMs:2000,endMs:4000})
  },30000)
})
