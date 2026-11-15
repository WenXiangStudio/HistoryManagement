import {afterEach,describe,expect,it,vi} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import {DoubaoSpeechService,DOUBAO_FLASH_RESOURCE,doubaoHeaders,doubaoFlashBody,materialAudioBitrate} from './doubaoSpeech'

const cleanup:(()=>void)[]=[]
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();while(cleanup.length)cleanup.pop()!()})
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'signal-doubao-flash-')),db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT)')
  const secrets=new Map<string,string>(),following={videoLibraryView:()=>({ownerSecUid:'owner'}),requireOwner:vi.fn()}
  const create=()=>new DoubaoSpeechService(db,dir,ref=>({getApiKey:()=>secrets.get(ref)??null,setApiKey:v=>{secrets.set(ref,v)}}),following as any,{} as any,()=>{},()=>{})
  const service=create();service.save({authMode:'api-key',appId:'',secret:'synthetic-secret'})
  const bytes=Buffer.from('authorized-local-audio'),audioSha256=createHash('sha256').update(bytes).digest('hex')
  mkdirSync(dirname(service.audioPath),{recursive:true});writeFileSync(service.audioPath,bytes)
  const prepare=vi.spyOn(service as any,'prepareVerifiedAudio').mockResolvedValue({owner:'owner',workId:'7694535682575860393',
    sourceSha256:'source-hash',audioSha256,durationMs:76933,bytes:bytes.length})
  cleanup.push(()=>{service.close();db.close();rmSync(dir,{recursive:true,force:true})})
  const start=()=>service.startFlash({clickedAt:Date.now()})
  const folder=()=>join(dir,'speech-tests','doubao-flash',service.view().trial.requestId!)
  return {service,db,dir,bytes,prepare,following,create,start,folder}
}
const success=()=>new Response(JSON.stringify({result:{text:' 原始，文本。\n'},audio_info:{duration:76933}}),
  {headers:{'x-api-status-code':'20000000','x-tt-logid':'flash-log'}})

describe('Doubao flash local audio',()=>{
  it('keeps long-video audio below the direct submission budget without truncating duration',()=>{
    expect(materialAudioBitrate(76933)).toBe(64)
    expect(materialAudioBitrate(46*60000+16000)).toBe(48)
    expect(materialAudioBitrate(7200000)).toBe(16)
    expect(()=>materialAudioBitrate(7200001)).toThrow('2小时')
  })
  it('uses flash resource, one audio.data and only transcription options for both auth modes',()=>{
    for(const authMode of ['api-key','app-token'] as const){
      const h=doubaoHeaders({authMode,appId:'app',secretRef:null},'key','request',true,DOUBAO_FLASH_RESOURCE)
      expect(h['X-Api-Resource-Id']).toBe('volc.bigasr.auc_turbo');expect(h['X-Api-Sequence']).toBe('-1')
      expect(h[authMode==='api-key'?'X-Api-Key':'X-Api-Access-Key']).toBe('key')
    }
    const body=doubaoFlashBody(Buffer.from('audio'))
    expect(body).toEqual({user:{uid:'signal-desk-transcription-test'},audio:{data:Buffer.from('audio').toString('base64'),format:'mp3'},
      request:{model_name:'bigmodel',enable_itn:false,enable_punc:true,enable_ddc:false,show_utterances:true}})
  })
  it('reads local bytes, sends exactly one POST, preserves original text and records click-to-visible separately',async()=>{
    const x=setup(),fetcher=vi.fn().mockResolvedValue(success());vi.stubGlobal('fetch',fetcher)
    x.start();expect(()=>x.start()).toThrow(/正在运行/)
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('completed'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [endpoint,request]=fetcher.mock.calls[0]
    expect(endpoint).toBe('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash')
    expect(Buffer.from(JSON.parse(request.body).audio.data,'base64')).toEqual(x.bytes)
    expect(x.service.view().trial.text).toBe(' 原始，文本。\n')
    expect(readFileSync(join(x.folder(),'transcript-original.txt'),'utf8')).toBe(' 原始，文本。\n')
    expect(x.service.view().trial.displayedTotalMs).toBeUndefined()
    x.service.markFlashDisplayed({requestId:x.service.view().trial.requestId!,displayedAt:Date.now()})
    const t=x.service.view().trial
    expect(t.displayedTotalMs).toBeGreaterThanOrEqual(t.elapsedMs!);expect(t.requestMs).toBeGreaterThanOrEqual(0)
    const evidence=readdirSync(x.folder()).map(f=>readFileSync(join(x.folder(),f),'utf8')).join('')
    expect(evidence).not.toContain('synthetic-secret');expect(evidence).not.toContain(x.bytes.toString('base64'))
    expect(evidence).not.toContain('secretRef');expect(()=>x.start()).toThrow(/已完成/)
  })
  it('rejects changed local bytes and switched account before any network request',async()=>{
    const x=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    writeFileSync(x.service.audioPath,'changed');x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('failed'))
    expect(fetcher).not.toHaveBeenCalled()
    x.prepare.mockResolvedValueOnce({owner:'different',bytes:1});x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.message).toContain('账号已改变'))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not treat HTTP 200 with a permission business error as success or retry',async()=>{
    const x=setup(),fetcher=vi.fn().mockResolvedValue(new Response('{"error":"permission denied"}',
      {headers:{'x-api-status-code':'45000030','x-tt-logid':'denied-log','x-api-message':'permission denied'}}))
    vi.stubGlobal('fetch',fetcher);x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('failed'))
    expect(x.service.view().trial).toMatchObject({httpStatus:200,statusCode:'45000030',logId:'denied-log'})
    expect(readFileSync(join(x.folder(),'response-original.json'),'utf8')).toContain('permission denied')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('blocks resubmission and standard query after uncertain flash network completion',async()=>{
    const x=setup(),fetcher=vi.fn().mockRejectedValue(new Error('timeout'));vi.stubGlobal('fetch',fetcher);x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('uncertain'))
    const id=x.service.view().trial.requestId
    expect(()=>x.start()).toThrow(/结果未知/);expect(()=>x.service.resume()).toThrow(/没有待查询/)
    const reopened=x.create();expect(reopened.view().trial.requestId).toBe(id)
    expect(()=>reopened.startFlash({clickedAt:Date.now()})).toThrow(/结果未知/);reopened.close()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('identifies invalid API Key precisely without claiming that flash service is not enabled',async()=>{
    const x=setup(),fetcher=vi.fn().mockResolvedValue(new Response('{"header":{"message":"Invalid X-Api-Key"}}',
      {status:401,headers:{'x-api-status-code':'45000010','x-tt-logid':'invalid-key-log','x-api-message':'Invalid X-Api-Key'}}))
    vi.stubGlobal('fetch',fetcher);x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('failed'))
    expect(x.service.view().trial.message).toContain('未通过鉴权')
    expect(x.service.view().trial.message).toContain('尚不能判断极速版权限')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains response header IDs on body interruption and never queries or retries',async()=>{
    const x=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({status:200,ok:true,
      headers:new Headers({'x-api-status-code':'20000000','x-tt-logid':'body-interrupted'}),text:async()=>{throw Error('body timeout')}}))
    x.start();await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('uncertain'))
    expect(x.service.view().trial.logId).toBe('body-interrupted');expect(()=>x.start()).toThrow(/结果未知/)
  })
  it('preserves raw response but refuses mismatched duration or invalid JSON',async()=>{
    const x=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({result:{text:'partial'},audio_info:{duration:1000}}),
      {headers:{'x-api-status-code':'20000000'}})).mockResolvedValueOnce(new Response('not json',{headers:{'x-api-status-code':'20000000'}})))
    x.start();await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('failed'))
    expect(x.service.view().trial.message).toContain('时长');expect(x.service.view().trial.text).toBeUndefined()
    const old=x.folder();x.start();await vi.waitFor(()=>expect(x.service.view().trial.message).toContain('JSON'))
    expect(readFileSync(join(old,'response-original.json'),'utf8')).toContain('partial')
  })
  it('keeps historical standard result labelled separately without modifying its row',async()=>{
    const x=setup(),old=JSON.stringify({state:'completed',text:'old standard text',message:'old result',requestId:'old-id'})
    x.db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('doubao-speech-trial',old,'old')
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(success()));x.start()
    await vi.waitFor(()=>expect(x.service.view().trial.state).toBe('completed'))
    expect(x.service.view().standardTrial).toMatchObject({text:'old standard text',resourceId:'volc.seedasr.auc'})
    expect(x.db.prepare("SELECT value_json FROM app_settings WHERE key='doubao-speech-trial'").get()?.value_json).toBe(old)
  })
  it('treats a previously submitted running record as uncertain after restart',()=>{
    const x=setup()
    x.db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('doubao-speech-flash-trial',JSON.stringify({state:'running',submittedAt:new Date().toISOString(),requestId:'old'}),'old')
    expect(x.service.view().trial.state).toBe('uncertain');expect(()=>x.start()).toThrow(/结果未知/)
  })
})
