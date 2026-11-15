import {afterEach,describe,expect,it,vi} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DoubaoSpeechService,DOUBAO_ENDPOINT,DOUBAO_FLASH_RESOURCE} from './doubaoSpeech'

const cleanup:(()=>void)[]=[]
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();while(cleanup.length)cleanup.pop()!()})
function setup(saved=true){
  const directory=mkdtempSync(join(tmpdir(),'signal-doubao-connection-')),db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT)')
  const secrets=new Map<string,string>(),following={videoLibraryView:vi.fn(),requireOwner:vi.fn()},assertIdle=vi.fn(),changed=vi.fn()
  const service=new DoubaoSpeechService(db,directory,ref=>({getApiKey:()=>secrets.get(ref)??null,setApiKey:value=>{secrets.set(ref,value)}}),following as any,{} as any,assertIdle,changed)
  if(saved)service.save({authMode:'api-key',appId:'',secret:'synthetic-key-connection'})
  cleanup.push(()=>{service.close();db.close();rmSync(directory,{recursive:true,force:true})})
  const revision=()=>service.view().settings.revision
  const run=()=>service.testConnection(revision())
  return {service,db,directory,secrets,following,assertIdle,changed,revision,run}
}
const success=(text='',duration=1000)=>new Response(JSON.stringify({result:{text},audio_info:{duration}}),{headers:{'x-api-status-code':'20000000'}})

describe('Doubao saved configuration connection test',()=>{
  it.each(['api-key','app-token'] as const)('sends only one synthetic WAV using saved %s credentials and flash resource',async authMode=>{
    const x=setup();x.service.save({authMode,appId:'test-app-id',secret:'synthetic-auth-token'})
    const fetcher=vi.fn().mockResolvedValue(success());vi.stubGlobal('fetch',fetcher)
    const result=await x.run()
    expect(result).toMatchObject({ok:true,service:'speech',model:DOUBAO_FLASH_RESOURCE,httpStatus:200,code:'20000000'})
    expect(result.message).toContain('没有返回文字');expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(Date.parse(result.testedAt))).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [endpoint,request]=fetcher.mock.calls[0]
    expect(endpoint).toBe(DOUBAO_ENDPOINT+'recognize/flash');expect(request.redirect).toBe('error')
    expect(request.headers).toMatchObject({'X-Api-Resource-Id':DOUBAO_FLASH_RESOURCE,'X-Api-Sequence':'-1','X-Api-Request-Id':result.requestId})
    if(authMode==='api-key'){
      expect(request.headers['X-Api-Key']).toBe('synthetic-auth-token');expect(request.headers).not.toHaveProperty('X-Api-Access-Key')
    }else{
      expect(request.headers).toMatchObject({'X-Api-App-Key':'test-app-id','X-Api-Access-Key':'synthetic-auth-token'});expect(request.headers).not.toHaveProperty('X-Api-Key')
    }
    const body=JSON.parse(request.body),wav=Buffer.from(body.audio.data,'base64')
    expect(body).toEqual({user:{uid:'signal-desk-connection-test'},audio:{data:body.audio.data,format:'wav'},request:{model_name:'bigmodel'}})
    expect(wav.length).toBe(32044);expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.toString('ascii',8,16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(20)).toBe(1);expect(wav.readUInt16LE(22)).toBe(1);expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt16LE(34)).toBe(16);expect(wav.readUInt32LE(40)).toBe(32000);expect(wav.subarray(44).every(byte=>byte===0)).toBe(true)
  })
  it('recognizes the officially documented silence business code without claiming speech transcription quality',async()=>{
    const x=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'x-api-status-code':'20000003'}})))
    const result=await x.run();expect(result.ok).toBe(true);expect(result.code).toBe('20000003')
    expect(result.message).toContain('判定为静音');expect(result.message).toContain('未验证语音转写内容')
  })
  it('does not read account media or change settings, trials, evidence files, or callbacks',async()=>{
    const x=setup()
    x.db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('doubao-speech-trial',JSON.stringify({state:'completed',text:'existing verified transcript',message:'previous'}),'old')
    x.db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('doubao-speech-flash-trial',JSON.stringify({state:'failed',message:'previous error',requestId:'prior'}),'old')
    const before=x.db.prepare('SELECT * FROM app_settings ORDER BY key').all(),view=x.service.view()
    const prepare=vi.spyOn(x.service as any,'prepareVerifiedAudio'),material=vi.spyOn(x.service,'transcribeMaterial')
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(success()))
    expect((await x.run()).ok).toBe(true)
    expect(x.db.prepare('SELECT * FROM app_settings ORDER BY key').all()).toEqual(before)
    expect(x.service.view()).toEqual(view);expect(readdirSync(x.directory)).toEqual([])
    expect(prepare).not.toHaveBeenCalled();expect(material).not.toHaveBeenCalled();expect(x.following.videoLibraryView).not.toHaveBeenCalled()
    expect(x.changed).not.toHaveBeenCalled()
  })
  it('changes the revision on credential replacement or auth mode, keeps it stable when saving unchanged settings, and exposes no credential ref',()=>{
    const x=setup(),old=x.revision(),raw=JSON.parse(String(x.db.prepare("SELECT value_json FROM app_settings WHERE key='doubao-speech'").get()!.value_json))
    expect(old).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(x.service.view().settings)).not.toContain(raw.secretRef)
    x.service.save({authMode:'api-key',appId:'ignored',secret:''});expect(x.revision()).toBe(old)
    x.service.save({authMode:'api-key',appId:'',secret:'replacement'});expect(x.revision()).not.toBe(old)
    const replaced=x.revision();x.service.save({authMode:'app-token',appId:'app-id',secret:'replacement'});expect(x.revision()).not.toBe(replaced)
  })
  it('refuses stale revisions, missing saved credentials, missing secret files, and other active work before network I/O',async()=>{
    const x=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    const old=x.revision();x.service.save({authMode:'api-key',appId:'',secret:'changed'})
    expect(await x.service.testConnection(old)).toMatchObject({ok:false,message:expect.stringContaining('配置已改变')})
    x.secrets.clear();expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('凭据')})
    const empty=setup(false);expect(await empty.run()).toMatchObject({ok:false,message:expect.stringContaining('凭据')})
    x.assertIdle.mockImplementation(()=>{throw Error('当前采集任务正在运行')})
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('采集任务')})
    ;(x.service as any).preparing=true
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('正在运行')})
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('prevents duplicate tests and saves while a request is pending, then releases the lock',async()=>{
    const x=setup();let resolve!:(response:Response)=>void
    const fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(done=>{resolve=done}));vi.stubGlobal('fetch',fetcher)
    const first=x.run();expect(x.service.running).toBe(true)
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('正在运行')})
    expect(()=>x.service.save({authMode:'api-key',appId:'',secret:'changed'})).toThrow('请等待')
    await expect(x.service.transcribeMaterial({mediaPath:'unused',directory:'unused',sha256:'unused'},1000,new AbortController().signal)).rejects.toThrow('连通测试正在运行')
    resolve(success());expect((await first).ok).toBe(true);expect(x.service.running).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    [401,'45000010','Invalid X-Api-Key','未通过鉴权'],
    [200,'45000030','permission denied','资源权限'],
    [200,'45000002','empty audio','音频为空'],
    [200,'45000151','invalid audio format','WAV 格式'],
    [200,'45000001','invalid parameter','请求参数'],
    [429,'45000030','rate limit','额度'],
    [200,'20000002','processing','测试失败'],
    [200,'','missing code','缺失或无效']
  ])('rejects HTTP %s / business code %s instead of inferring success from HTTP alone',async(status,code,message,expected)=>{
    const x=setup(),fetcher=vi.fn().mockResolvedValue(new Response('{}',{status,headers:{'x-api-status-code':code,'x-api-message':message}}))
    vi.stubGlobal('fetch',fetcher);const result=await x.run()
    expect(result).toMatchObject({ok:false,httpStatus:status,message:expect.stringContaining(expected)});expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['','not JSON','{}',JSON.stringify({result:{text:''},audio_info:{duration:0}}),JSON.stringify({result:{text:''},audio_info:{duration:77000}})])('rejects malformed or unrelated successful response %s',async body=>{
    const x=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body,{headers:{'x-api-status-code':'20000000'}})))
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('未判定测试成功')})
  })
  it('redacts saved API keys and credential refs echoed in an error header or a network error',async()=>{
    const x=setup(),secret=[...x.secrets.values()][0],ref=[...x.secrets.keys()][0]
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401,headers:{'x-api-status-code':'45000010','x-api-message':`Invalid X-Api-Key ${secret}; ${ref}`}}))
      .mockRejectedValueOnce(Error(`failed ${secret}; ${ref}`))
    vi.stubGlobal('fetch',fetcher)
    for(let index=0;index<2;index++){
      const result=await x.run(),serialized=JSON.stringify(result)
      expect(result.ok).toBe(false);expect(serialized).not.toContain(secret);expect(serialized).not.toContain(ref);expect(serialized).toContain('已隐藏')
    }
  })
  it('bounds streamed and declared response bodies and does not retry network errors',async()=>{
    const x=setup(),fetcher=vi.fn().mockResolvedValueOnce(new Response('x'.repeat(65537),{headers:{'x-api-status-code':'20000000'}}))
      .mockResolvedValueOnce(new Response('{}',{headers:{'content-length':'65537','x-api-status-code':'20000000'}})).mockRejectedValueOnce(Error('offline'))
    vi.stubGlobal('fetch',fetcher)
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('64 KB')})
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('64 KB')})
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('offline')})
    expect(fetcher).toHaveBeenCalledTimes(3);expect(x.service.running).toBe(false)
  })
  it('returns a bounded failure after 30 seconds even when a response body never finishes',async()=>{
    const x=setup();vi.useFakeTimers()
    const fetcher=vi.fn().mockResolvedValue(new Response(new ReadableStream({start(){}}),{headers:{'x-api-status-code':'20000000'}}))
    vi.stubGlobal('fetch',fetcher);const pending=x.run();await vi.advanceTimersByTimeAsync(30000)
    expect(await pending).toMatchObject({ok:false,elapsedMs:30000,message:expect.stringContaining('测试超时'),httpStatus:200,code:'20000000'})
    expect(x.service.running).toBe(false);expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cancels an outstanding test on close and refuses later requests',async()=>{
    const x=setup(),fetcher=vi.fn().mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher)
    const pending=x.run();x.service.close()
    expect(await pending).toMatchObject({ok:false,message:expect.stringContaining('已取消')})
    expect(await x.run()).toMatchObject({ok:false,message:expect.stringContaining('应用正在退出')})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
