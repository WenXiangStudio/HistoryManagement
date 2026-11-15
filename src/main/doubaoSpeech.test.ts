import {afterEach,describe,expect,it,vi} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {DoubaoSpeechService,DOUBAO_RESOURCE,doubaoHeaders,doubaoSubmitBody,doubaoResult,validateDoubaoAudioUrl} from './doubaoSpeech'
const temporary:string[]=[];const databases:DatabaseSync[]=[]
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const db of databases.splice(0))db.close();for(const dir of temporary.splice(0))rmSync(dir,{recursive:true,force:true})})
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'signal-doubao-'));temporary.push(dir)
 const db=new DatabaseSync(':memory:');databases.push(db);db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT)')
 db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('settings',JSON.stringify({textModel:'existing'}),'old')
 const secrets=new Map<string,string>(),following={videoLibraryView:()=>({ownerSecUid:'owner'}),requireOwner:(owner:string)=>{if(owner!=='owner')throw Error('owner mismatch')}}
 const service=new DoubaoSpeechService(db,dir,ref=>({getApiKey:()=>secrets.get(ref)??null,setApiKey:v=>{secrets.set(ref,v)}}),following as any,{} as any,()=>{},()=>{})
 service.save({authMode:'api-key',appId:'',secret:'test-secret'})
 return {service,db,dir,secrets}
}
describe('Doubao recording 2.0 protocol',()=>{
 it('uses correct 2.0 resource with independent new or old authorization',()=>{
  const modern=doubaoHeaders({authMode:'api-key',appId:'',secretRef:null},'secret','request',true)
  expect(modern).toMatchObject({'X-Api-Resource-Id':DOUBAO_RESOURCE,'X-Api-Key':'secret','X-Api-Sequence':'-1'})
  expect(modern).not.toHaveProperty('Authorization');expect(modern).not.toHaveProperty('X-Api-Access-Key')
  const legacy=doubaoHeaders({authMode:'app-token',appId:'123',secretRef:null},'token','request')
  expect(legacy).toMatchObject({'X-Api-App-Key':'123','X-Api-Access-Key':'token'});expect(legacy).not.toHaveProperty('X-Api-Key')
 })
 it('submits only an audio URL with smoothing and ITN disabled',()=>{
  expect(doubaoSubmitBody('https://b.tos-cn-beijing.volces.com/a.mp3')).toEqual({user:{uid:'signal-desk-transcription-test'},audio:{url:'https://b.tos-cn-beijing.volces.com/a.mp3',format:'mp3'},request:{model_name:'bigmodel',enable_itn:false,enable_punc:true,enable_ddc:false,show_utterances:true}})
 })
 it('rejects local/private/custom hosts and embedded credentials without following redirects',()=>{
  for(const url of ['file:///audio','http://a.volces.com/a','https://localhost/a','https://127.0.0.1/a','https://a.volces.com.evil.test/a','https://user:password@a.volces.com/a'])expect(()=>validateDoubaoAudioUrl(url)).toThrow()
  expect(validateDoubaoAudioUrl('https://bucket.tos-cn-beijing.volces.com/a.mp3?signature=abc')).toContain('signature=abc')
 })
 it('keeps returned transcript characters and whitespace exactly and validates duration',()=>{
  const body={result:{text:' 原始，text。\n'},audio_info:{duration:76933}}
  expect(doubaoResult(body,76934).text).toBe(body.result.text)
  expect(()=>doubaoResult(body,30000)).toThrow(/时长/);expect(()=>doubaoResult({result:{text:''}},76933)).toThrow(/文本/)
 })
 it('stores only credential references; unrelated cloud settings remain intact',()=>{
  const {service,db}=setup();expect(service.view().settings).toMatchObject({hasSecret:true,authMode:'api-key'})
  expect(JSON.stringify(db.prepare('SELECT * FROM app_settings').all())).not.toContain('test-secret')
  expect(JSON.parse(String(db.prepare("SELECT value_json FROM app_settings WHERE key='settings'").get()!.value_json))).toEqual({textModel:'existing'})
  service.save({authMode:'api-key',appId:'',secret:''});expect(service.view().settings.hasSecret).toBe(true)
  expect(()=>service.save({authMode:'app-token',appId:'123',secret:''})).toThrow(/凭据/)
 })
 it('polls one submitted job without resubmission and never sends credentials to the audio host',async()=>{
  const {service,dir}=setup(),bytes=Buffer.from('authorized-audio'),hash=createHash('sha256').update(bytes).digest('hex')
  vi.spyOn(service,'prepareAudio').mockResolvedValue({owner:'owner',workId:'7694535682575860393',sourceSha256:'source',audioSha256:hash,durationMs:76933,bytes:bytes.length})
  const mock=vi.fn().mockResolvedValueOnce(new Response(bytes)).mockResolvedValueOnce(new Response('',{headers:{'x-api-status-code':'20000000','x-tt-logid':'submit-log'}})).mockResolvedValueOnce(new Response(JSON.stringify({result:{text:' 原文\n'},audio_info:{duration:76933}}),{headers:{'x-api-status-code':'20000000'}}))
  vi.stubGlobal('fetch',mock)
  await service.start('https://bucket.tos-cn-beijing.volces.com/a.mp3?secret=url-secret')
  await vi.waitFor(()=>expect(service.view().standardTrial?.state).toBe('completed'))
  expect(mock).toHaveBeenCalledTimes(3);expect(mock.mock.calls[0][1]).not.toHaveProperty('headers')
  expect(mock.mock.calls[1][0]).toContain('/submit');expect(mock.mock.calls[2][0]).toContain('/query')
  expect(service.view().standardTrial?.text).toBe(' 原文\n')
  const files=readFileSync(join(dir,'speech-tests','doubao',service.view().standardTrial!.requestId!,'transcript-original.txt'),'utf8')
  expect(files).toBe(' 原文\n')
  service.close()
 })
 it('rejects a wrong remote file before sending a billable ASR request',async()=>{
  const {service}=setup()
  vi.spyOn(service,'prepareAudio').mockResolvedValue({owner:'owner',workId:'7694535682575860393',sourceSha256:'source',audioSha256:'not-this-file',durationMs:76933,bytes:4})
  const mock=vi.fn().mockResolvedValue(new Response('wrong'));vi.stubGlobal('fetch',mock)
  await service.start('https://bucket.tos-cn-beijing.volces.com/a.mp3');await vi.waitFor(()=>expect(service.view().standardTrial?.state).toBe('failed'))
  expect(mock).toHaveBeenCalledTimes(1);service.close()
 })
 it('retains request ID after uncertain submission and resumes query without submitting again',async()=>{
  const {service,db}=setup(),bytes=Buffer.from('audio'),hash=createHash('sha256').update(bytes).digest('hex')
  vi.spyOn(service,'prepareAudio').mockResolvedValue({owner:'owner',workId:'7694535682575860393',sourceSha256:'source',audioSha256:hash,durationMs:76933,bytes:5})
  const mock=vi.fn().mockResolvedValueOnce(new Response(bytes)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({result:{text:'完成'},audio_info:{duration:76933}}),{headers:{'x-api-status-code':'20000000'}}))
  vi.stubGlobal('fetch',mock);await service.start('https://b.volces.com/a?signature=private')
  await vi.waitFor(()=>expect(service.view().standardTrial?.state).toBe('pending'));const id=service.view().standardTrial?.requestId
  await expect(service.start('https://b.volces.com/a')).rejects.toThrow(/原任务/)
  expect(JSON.stringify(db.prepare('SELECT * FROM app_settings').all())).not.toContain('signature=private')
  service.resume();await vi.waitFor(()=>expect(service.view().standardTrial?.state).toBe('completed'))
  expect(service.view().standardTrial?.requestId).toBe(id);expect(mock.mock.calls[2][0]).toContain('/query');service.close()
 })
})
