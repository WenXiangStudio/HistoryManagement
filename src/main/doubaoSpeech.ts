import {randomUUID,createHash} from 'node:crypto'
import {existsSync,readFileSync,mkdirSync,writeFileSync,statSync,createReadStream,renameSync} from 'node:fs'
import {join} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import {z} from 'zod'
import {mediaCommand} from './qwenVideo'
import type {FollowingSyncService} from './followingSync'
import type {VideoContentRuntimeClient} from './videoContentRuntime'
import type {DoubaoAuthMode,DoubaoSpeechSettings,DoubaoSpeechTrial,DoubaoSpeechView} from '../shared/doubaoSpeech'
import type {CloudConnectionResult} from '../shared/cloudConnection'
import type {SpeechSegment,WorkshopSpeech} from '../shared/workshopDeep'

export const DOUBAO_RESOURCE='volc.seedasr.auc' as const
export const DOUBAO_FLASH_RESOURCE='volc.bigasr.auc_turbo' as const
export const DOUBAO_ENDPOINT='https://openspeech.bytedance.com/api/v3/auc/bigmodel/'
export function materialAudioBitrate(durationMs:number){
  if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>7200000)throw Error('音轨超过豆包极速版2小时范围')
  return [64,48,32,24,16].find(kbps=>durationMs/1000*kbps*1000/8<=19*1024*1024)??16
}
const WORK_ID='7694535682575860393',SETTINGS='doubao-speech',TRIAL='doubao-speech-trial',FLASH_TRIAL='doubao-speech-flash-trial'
type Secret={getApiKey():string|null;setApiKey(value:string):void}
type StoredConfig={authMode:DoubaoAuthMode;appId:string;secretRef:string|null}
type StoredTrial=DoubaoSpeechTrial&{owner:string;secretRef:string;authMode:DoubaoAuthMode;appId:string;directory:string;sourceSha256:string;audioSha256:string}
function connectionSilence(){
  // One second of synthetic 16 kHz, mono, 16-bit PCM. Never read the user's media for a connection test.
  const bytes=Buffer.alloc(44+32000)
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8)
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22)
  bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34)
  bytes.write('data',36);bytes.writeUInt32LE(32000,40)
  return bytes
}
async function connectionResponseText(response:Response){
  const limit=64*1024
  if(Number(response.headers.get('content-length'))>limit)throw Error('服务端响应超过64 KB，未判定测试成功')
  if(!response.body)return ''
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  try{
    while(true){
      const part=await reader.read();if(part.done)break
      size+=part.value.byteLength;if(size>limit)throw Error('服务端响应超过64 KB，未判定测试成功')
      chunks.push(part.value)
    }
    return Buffer.concat(chunks,size).toString('utf8')
  }finally{void reader.cancel().catch(()=>{})}
}
export function doubaoHeaders(config:StoredConfig,secret:string,id:string,submit=false,resourceId:string=DOUBAO_RESOURCE):Record<string,string>{
  return {'content-type':'application/json','X-Api-Resource-Id':resourceId,'X-Api-Request-Id':id,
    ...(config.authMode==='api-key'?{'X-Api-Key':secret}:{'X-Api-App-Key':config.appId,'X-Api-Access-Key':secret}),
    ...(submit?{'X-Api-Sequence':'-1'}:{})}
}
export function doubaoSubmitBody(url:string){return {user:{uid:'signal-desk-transcription-test'},audio:{url,format:'mp3'},
  request:{model_name:'bigmodel',enable_itn:false,enable_punc:true,enable_ddc:false,show_utterances:true}}}
export function doubaoFlashBody(bytes:Buffer){return {user:{uid:'signal-desk-transcription-test'},audio:{data:bytes.toString('base64'),format:'mp3'},
  request:{model_name:'bigmodel',enable_itn:false,enable_punc:true,enable_ddc:false,show_utterances:true}}}
export function doubaoFlashFailure(httpStatus:number,statusCode:string,apiMessage:string){
  const prefix=`极速版请求未成功（HTTP ${httpStatus}，业务码 ${statusCode||'缺失'}）。`
  if(/invalid x-api-key/i.test(apiMessage))return prefix+'语音服务返回 Invalid X-Api-Key，当前保存的API Key未通过鉴权。请从语音技术控制台重新复制完整且有效的API Key，并在本页保存；此错误尚不能判断极速版权限。未自动重试。'
  return prefix+'请核对录音文件识别极速版的服务权限；原始回执已保存，未重试或切换模型。'
}
export function validateDoubaoAudioUrl(input:string):string{
  let u:URL;try{u=new URL(input.trim())}catch{throw Error('请填写已上传测试MP3的临时HTTPS链接')}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
    !['volces.com','aliyuncs.com','myqcloud.com'].some(h=>u.hostname.endsWith('.'+h)))throw Error('请使用TOS、OSS或COS的官方HTTPS对象链接，暂不支持自定义域名')
  return u.href
}
export function doubaoResult(body:any,expectedMs:number){
  if(typeof body?.result?.text!=='string'||!body.result.text.trim())throw Error('识别结果未包含完整文本，原始响应已保留')
  const duration=body.audio_info?.duration
  if(typeof duration!=='number'||!Number.isFinite(duration)||Math.abs(duration-expectedMs)>Math.max(1500,expectedMs*.02))throw Error('返回音频时长与测试文件不符，请核对原始响应')
  return {text:body.result.text as string,durationMs:duration as number,utterances:Array.isArray(body.result.utterances)?body.result.utterances:[]}
}

export const WORKSHOP_SPEECH_VERSION='doubao-flash-timed-v1'
/** Preserve the ASR's true intervals. Missing timing must never become guessed timing. */
export function workshopDoubaoResult(body:any,expectedMs:number):Pick<WorkshopSpeech,'state'|'text'|'segments'|'durationMs'>{
  if(!Number.isSafeInteger(expectedMs)||expectedMs<=0||expectedMs>7200000)throw Error('视频时长超出豆包极速版范围')
  const result=doubaoResult(body,expectedMs)
  if(!Array.isArray(body.result.utterances)||!body.result.utterances.length||body.result.utterances.length>10000)throw Error('豆包未返回可校验的逐句时间戳，不能生成时间对齐报告')
  const segments:SpeechSegment[]=[]
  for(const [index,part] of body.result.utterances.entries()){
    if(typeof part?.text!=='string'||!part.text.trim()||!Number.isSafeInteger(part.start_time)||!Number.isSafeInteger(part.end_time)
      ||part.start_time<0||part.end_time<=part.start_time||part.end_time>expectedMs)throw Error('豆包逐句时间戳无效或超出原片范围，不能生成时间对齐报告')
    const previous=segments.at(-1)
    if(previous&&(part.start_time<previous.startMs||part.end_time<=previous.endMs||previous.endMs-part.start_time>50))throw Error('豆包逐句时间戳倒序或重叠超过50毫秒，不能生成时间对齐报告')
    segments.push({id:`speech-${index+1}`,startMs:part.start_time,endMs:part.end_time,text:part.text})
  }
  return {state:'transcribed',text:result.text,segments,durationMs:expectedMs}
}
async function workshopFileHash(path:string,signal:AbortSignal){
  const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal}))hash.update(chunk)
  return hash.digest('hex')
}
function workshopWrite(path:string,value:unknown){
  const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(value,null,2),'utf8');renameSync(temporary,path)
}
function workshopRedact(value:string,secret:string){
  for(const variant of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)]))if(variant)value=value.split(variant).join('[已隐藏]')
  return value
}
async function workshopResponseText(response:Response){
  const limit=4*1024*1024
  if(Number(response.headers.get('content-length'))>limit)throw Error('豆包响应超过4MB，未完整接收')
  if(!response.body)return ''
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit)throw Error('豆包响应超过4MB，未完整接收');chunks.push(next.value)}return Buffer.concat(chunks,size).toString('utf8')}
  finally{void reader.cancel().catch(()=>{})}
}

export class DoubaoSpeechService{
  private abort:AbortController|null=null
  private connectionAbort:AbortController|null=null
  private workshopAbort:AbortController|null=null
  private closed=false
  private preparing=false
  private flashActive:StoredTrial|null=null
  private displayRequestId:string|null=null
  readonly audioPath:string
  constructor(private db:DatabaseSync,private userData:string,private secrets:(ref:string)=>Secret,
    private following:FollowingSyncService,private runtime:VideoContentRuntimeClient,private assertIdle:()=>void,private changed:()=>void){
    this.audioPath=join(userData,'speech-tests','math-openai','math-openai-77s.mp3')
  }
  get running(){return !!this.abort||this.preparing||!!this.connectionAbort||!!this.workshopAbort}
  private read<T>(key:string):T|null{const row=this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);return row?JSON.parse(String(row.value_json)) as T:null}
  private write(key:string,value:unknown){this.db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(key,JSON.stringify(value),new Date().toISOString())}
  private config():StoredConfig{return this.read<StoredConfig>(SETTINGS)??{authMode:'api-key',appId:'',secretRef:null}}
  private revision(c:StoredConfig){return createHash('sha256').update(JSON.stringify({authMode:c.authMode,appId:c.appId,secretRef:c.secretRef})).digest('hex')}
  private workshopCredentials(){
    if(this.closed)throw Error('应用正在退出，未启动视频语音转写')
    let config:StoredConfig,secret:string|null
    try{config=this.config();secret=config.secretRef?this.secrets(config.secretRef).getApiKey():null}
    catch{throw Error('无法读取已保存的豆包语音配置或凭据，请在设置重新保存')}
    if(!['api-key','app-token'].includes(config.authMode)||config.authMode==='app-token'&&!/^[a-zA-Z0-9_-]+$/.test(config.appId))throw Error('请在设置保存有效的豆包语音鉴权配置')
    if(!secret||/[\r\n]/.test(secret))throw Error('请先在设置保存有效的豆包语音识别极速版凭据')
    return {config,secret}
  }
  requireWorkshopReady(){
    if(this.running)throw Error('豆包语音任务或连通测试正在运行，请等待完成后再深度处理')
    this.workshopCredentials()
  }
  async transcribeWorkshop(media:{mediaPath:string;directory:string;sha256:string},durationMs:number,signal:AbortSignal):Promise<WorkshopSpeech>{
    this.requireWorkshopReady();signal.throwIfAborted()
    const {config,secret}=this.workshopCredentials(),controller=new AbortController()
    this.workshopAbort=controller
    try{return await this.executeWorkshop(media,durationMs,AbortSignal.any([signal,controller.signal]),config,secret)}
    finally{if(this.workshopAbort===controller)this.workshopAbort=null}
  }
  private async executeWorkshop(media:{mediaPath:string;directory:string;sha256:string},durationMs:number,signal:AbortSignal,config:StoredConfig,secret:string):Promise<WorkshopSpeech>{
    const bitrate=materialAudioBitrate(durationMs)
    if(!Number.isSafeInteger(durationMs)||!/^[a-f0-9]{64}$/.test(media.sha256)||!existsSync(media.mediaPath)||!statSync(media.mediaPath).isFile())throw Error('视频语音转写的本地原片或时长无效')
    if(await workshopFileHash(media.mediaPath,signal)!==media.sha256)throw Error('原片内容与下载记录不符，未提交语音识别')
    const paths=this.runtime.paths(),metadata=JSON.parse(await mediaCommand(paths.ffprobe,['-v','error','-show_format','-show_streams','-of','json',media.mediaPath],signal))
    const sourceDuration=Math.round(Number(metadata.format?.duration)*1000),audio=metadata.streams?.find((s:any)=>s.codec_type==='audio')
    if(!Number.isSafeInteger(sourceDuration)||Math.abs(sourceDuration-durationMs)>100||!audio||!Number.isSafeInteger(audio.index))throw Error('原片音轨或时长校验失败，未提交语音识别')
    const origin=Number(metadata.format?.start_time??0)
    if(!Number.isFinite(origin)||Math.abs(origin)>86400)throw Error('原片时间轴起点无法校验，未提交语音识别')
    // Audio media never enters the project workspace or its application data directories.
    const directory=join('E:\\AudioDownload','video-workshop',media.sha256,WORKSHOP_SPEECH_VERSION)
    mkdirSync(directory,{recursive:true})
    const receiptPath=join(directory,'receipt.json'),markerPath=join(directory,'submitted.json'),audioPath=join(directory,'audio.mp3')
    if(existsSync(receiptPath)){
      const saved=JSON.parse(readFileSync(receiptPath,'utf8'))
      if(saved.version!==WORKSHOP_SPEECH_VERSION||saved.sourceSha256!==media.sha256||saved.durationMs!==durationMs||saved.resourceId!==DOUBAO_FLASH_RESOURCE
        ||!Array.isArray(saved.segments)||saved.audioPath!==audioPath||!existsSync(audioPath)||await workshopFileHash(audioPath,signal)!==saved.audioSha256)throw Error('视频语音缓存校验失败，请核对本地回执；未重复提交')
      const validated=saved.state==='transcribed'?workshopDoubaoResult({result:{text:saved.text,utterances:saved.segments.map((s:SpeechSegment)=>({text:s.text,start_time:s.startMs,end_time:s.endMs}))},audio_info:{duration:durationMs}},durationMs)
        :saved.state==='no-speech'&&saved.text===''&&Array.isArray(saved.segments)&&!saved.segments.length?{state:'no-speech' as const,text:'',segments:[],durationMs}:null
      if(!validated||typeof saved.requestId!=='string'||!saved.requestId)throw Error('视频语音缓存内容不完整，未重复提交')
      const {version,...publicResult}=saved
      return {...publicResult,...validated} as WorkshopSpeech
    }
    if(existsSync(markerPath)){
      const marker=JSON.parse(readFileSync(markerPath,'utf8'))
      if(marker.sourceSha256!==media.sha256||marker.version!==WORKSHOP_SPEECH_VERSION||!marker.responseComplete||!/^\d{8}$/.test(marker.statusCode??'')
        ||marker.httpOk&&['20000000','20000003'].includes(marker.statusCode))throw Error('上次视频语音请求结果待核对，请按 submitted.json 的 Request ID 核对服务记录；未自动重发')
    }
    // -copyts keeps actual packet timestamps; subtract only the container origin.
    // first_pts=0 inserts silence for a late audio stream and trims audio preceding video time zero.
    await mediaCommand(paths.ffmpeg,['-hide_banner','-loglevel','error','-y','-copyts','-i',media.mediaPath,'-map',`0:${audio.index}`,'-vn',
      '-af',`asetpts=PTS-(${origin})/TB,aresample=async=1:first_pts=0,apad`,'-t',String(durationMs/1000),'-ac','1','-ar','16000','-c:a','libmp3lame','-b:a',`${bitrate}k`,audioPath],signal)
    const audioMeta=JSON.parse(await mediaCommand(paths.ffprobe,['-v','error','-show_format','-show_streams','-of','json',audioPath],signal))
    if(!audioMeta.streams?.some((s:any)=>s.codec_type==='audio')||!Number.isFinite(Number(audioMeta.format?.duration))||Math.abs(Number(audioMeta.format.duration)*1000-durationMs)>150)throw Error('导出音轨时长无法与原片对齐，未提交语音识别')
    const bytes=readFileSync(audioPath)
    if(!bytes.length||bytes.length>20*1024*1024)throw Error('音轨超出豆包极速版20MB直接提交范围，未提交语音识别')
    if(await workshopFileHash(media.mediaPath,signal)!==media.sha256)throw Error('原片在音轨准备期间发生变化，未提交语音识别')
    const audioSha256=createHash('sha256').update(bytes).digest('hex'),requestId=randomUUID(),submittedAt=new Date().toISOString()
    workshopWrite(join(directory,'audio-manifest.json'),{version:WORKSHOP_SPEECH_VERSION,sourceSha256:media.sha256,audioSha256,durationMs,sourceOriginSeconds:origin,audioStartSeconds:Number(audio.start_time??origin),byteLength:bytes.length,bitrateKbps:bitrate})
    signal.throwIfAborted()
    const marker={version:WORKSHOP_SPEECH_VERSION,sourceSha256:media.sha256,audioSha256,requestId,submittedAt}
    workshopWrite(markerPath,marker)
    let response:Response,raw:string
    try{
      response=await fetch(DOUBAO_ENDPOINT+'recognize/flash',{method:'POST',redirect:'error',headers:doubaoHeaders(config,secret,requestId,true,DOUBAO_FLASH_RESOURCE),
        body:JSON.stringify({...doubaoFlashBody(bytes),user:{uid:'signal-desk-video-workshop'}}),signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])})
      raw=await workshopResponseText(response)
    }catch{throw Error('豆包极速版未完整返回，服务端结果未知；Request ID 已保存，请核对服务记录，未自动重发')}
    const rawCode=response.headers.get('x-api-status-code')??'',statusCode=/^\d{8}$/.test(rawCode)?rawCode:'',apiMessage=workshopRedact(response.headers.get('x-api-message')??'',secret).slice(0,2000)
    workshopWrite(join(directory,`response-${requestId}.json`),{requestId,httpStatus:response.status,statusCode,rawStatusCode:workshopRedact(rawCode,secret).slice(0,2000),
      logId:workshopRedact(response.headers.get('x-tt-logid')??'',secret).slice(0,2000),apiMessage,body:workshopRedact(raw,secret)})
    workshopWrite(markerPath,{...marker,responseComplete:true,httpOk:response.ok,statusCode,finishedAt:new Date().toISOString()})
    signal.throwIfAborted()
    if(!response.ok||!['20000000','20000003'].includes(statusCode))throw Error(`豆包极速版语音识别失败（HTTP ${response.status}，业务码 ${/^\d{8}$/.test(statusCode)?statusCode:'缺失或无效'}），请核对已保存的凭据、极速版权限及额度；未自动重试`)
    let body:any
    try{body=raw.trim()?JSON.parse(raw):{}}catch{throw Error('豆包返回内容不是有效JSON，原始回执已保存，未自动重发')}
    if(statusCode==='20000003'&&(typeof body?.result?.text==='string'&&body.result.text.trim()||Array.isArray(body?.result?.utterances)&&body.result.utterances.length))throw Error('豆包静音状态与返回文字矛盾，原始回执已保存，未自动重发')
    if(statusCode==='20000003'&&body.audio_info?.duration!==undefined&&(typeof body.audio_info.duration!=='number'||!Number.isFinite(body.audio_info.duration)||Math.abs(body.audio_info.duration-durationMs)>Math.max(1500,durationMs*.02)))throw Error('豆包静音结果的音频时长与原片不符，未自动重发')
    const result:WorkshopSpeech={...(statusCode==='20000003'?{state:'no-speech' as const,text:'',segments:[],durationMs}:workshopDoubaoResult(body,durationMs)),
      sourceSha256:media.sha256,model:'豆包语音识别极速版',resourceId:DOUBAO_FLASH_RESOURCE,requestId,audioPath,audioSha256,generatedAt:new Date().toISOString()}
    workshopWrite(receiptPath,{...result,version:WORKSHOP_SPEECH_VERSION});return result
  }
  async testConnection(expectedRevision:string):Promise<CloudConnectionResult>{
    const started=Date.now(),sensitive:string[]=[]
    const safe=(value:unknown)=>{
      let text=String(value??'')
      for(const value of sensitive.filter(Boolean))for(const variant of [value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)])text=text.split(variant).join('[已隐藏]')
      return text.replace(/[\r\n\u0000-\u001f\u007f]+/g,' ').slice(0,400)
    }
    const finish=(ok:boolean,message:string,extra:Partial<CloudConnectionResult>={}):CloudConnectionResult=>({
      ok,message:safe(message),elapsedMs:Math.max(0,Date.now()-started),testedAt:new Date().toISOString(),model:DOUBAO_FLASH_RESOURCE,service:'speech',...extra})
    let c:StoredConfig,secret:string|null
    try{
      c=this.config();if(c.secretRef)sensitive.push(c.secretRef)
      if(this.closed)return finish(false,'应用正在退出，未发送测试请求')
      if(expectedRevision!==this.revision(c))return finish(false,'豆包语音配置已改变，请刷新设置并保存后再测试')
      if(this.running)return finish(false,'豆包语音任务或连通测试正在运行，请等待完成后再测试')
      this.assertIdle()
      if(!['api-key','app-token'].includes(c.authMode)||c.authMode==='app-token'&&!/^[a-zA-Z0-9_-]+$/.test(c.appId))return finish(false,'已保存的豆包鉴权配置无效，请核对 APP ID 和鉴权方式后保存')
      secret=c.secretRef?this.secrets(c.secretRef).getApiKey():null
      if(!secret)return finish(false,'尚未保存可用的豆包语音凭据，请先保存配置')
      sensitive.push(secret)
      if(/[\r\n]/.test(secret))return finish(false,'已保存的豆包凭据格式无效，请重新保存完整凭据')
    }catch(error){return finish(false,error instanceof Error?error.message:'无法读取已保存的豆包配置')}
    const controller=new AbortController(),requestId=randomUUID();this.connectionAbort=controller
    let timedOut=false,httpStatus:number|undefined,code:string|undefined
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},30000)
    let rejectAbort:(()=>void)|undefined
    try{
      const operation=(async()=>{
        const response=await fetch(DOUBAO_ENDPOINT+'recognize/flash',{method:'POST',redirect:'error',
          headers:doubaoHeaders(c,secret!,requestId,true,DOUBAO_FLASH_RESOURCE),signal:controller.signal,
          body:JSON.stringify({user:{uid:'signal-desk-connection-test'},audio:{data:connectionSilence().toString('base64'),format:'wav'},request:{model_name:'bigmodel'}})})
        httpStatus=response.status
        const rawCode=response.headers.get('x-api-status-code')??''
        code=/^\d{8}$/.test(rawCode)?rawCode:undefined
        const raw=await connectionResponseText(response)
        const details={httpStatus,code,requestId}
        if(!response.ok||!['20000000','20000003'].includes(code??'')){
          const apiMessage=response.headers.get('x-api-message')??''
          const reason=response.status===401||/invalid x-api-key|unauthorized/i.test(apiMessage)?'凭据未通过鉴权，请核对已保存的 API Key 或 Access Token。'
            :response.status===403||/permission|resource.*(denied|not|invalid)/i.test(apiMessage)?'请核对录音文件识别极速版的资源权限。'
            :response.status===429?'请求受限，请核对账户额度和服务限流。'
            :code==='45000002'?'服务端判定音频为空，连通测试未通过。'
            :code==='45000151'?'服务端未接受测试 WAV 格式，连通测试未通过。'
            :code==='45000001'?'服务端拒绝测试请求参数，连通测试未通过。'
            :'请核对凭据、极速版资源权限和账户服务状态。'
          return finish(false,`豆包极速版测试失败（HTTP ${httpStatus}，业务码 ${code??'缺失或无效'}）。${reason}${apiMessage?' 服务端：'+safe(apiMessage):''}`,details)
        }
        // Official flash API documents 20000003 as “静音音频”: https://www.volcengine.com/docs/6561/1631584
        if(code==='20000003')return finish(true,'连通测试通过：鉴权及极速版调用已通过，服务端将 1 秒合成样本判定为静音（业务码 20000003）；未验证语音转写内容。',details)
        let body:any
        try{body=JSON.parse(raw)}catch{return finish(false,'服务端返回成功业务码，但响应不是有效 JSON，未判定测试成功',details)}
        if(typeof body?.result?.text!=='string'||typeof body?.audio_info?.duration!=='number'||!Number.isFinite(body.audio_info.duration)||Math.abs(body.audio_info.duration-1000)>250)return finish(false,'服务端返回成功业务码，但识别结果或音频时长无效，未判定测试成功',details)
        return finish(true,`连通测试通过：豆包极速版已完成 1 秒合成静音样本的识别请求${body.result.text.trim()?'':'，没有返回文字'}；未验证真实语音转写内容。`,details)
      })()
      return await Promise.race([operation,new Promise<CloudConnectionResult>((_,reject)=>{
        rejectAbort=()=>reject(Error('连通测试已中止'))
        if(controller.signal.aborted)rejectAbort();else controller.signal.addEventListener('abort',rejectAbort,{once:true})
      })])
    }catch(error){return finish(false,timedOut?'豆包连通测试在 30 秒内未完整返回，测试超时；未自动重试。'
      :controller.signal.aborted?'豆包连通测试已取消；未自动重试。':`豆包连通测试未完成：${safe(error instanceof Error?error.message:'网络请求失败')}。请检查网络及服务状态；未自动重试。`,{httpStatus,code,requestId})
    }finally{clearTimeout(timer);if(rejectAbort)controller.signal.removeEventListener('abort',rejectAbort);if(this.connectionAbort===controller)this.connectionAbort=null}
  }
  async transcribeMaterial(media:{mediaPath:string;directory:string;sha256:string},durationMs:number,signal:AbortSignal){
    if(this.connectionAbort)throw Error('豆包连通测试正在运行，请等待完成后再转写')
    const c=this.config(),secret=c.secretRef?this.secrets(c.secretRef).getApiKey():null
    if(!secret)throw Error('请先在设置保存豆包语音识别极速版凭据')
    const directory=join(media.directory,'workflow-doubao-flash');mkdirSync(directory,{recursive:true})
    const receiptPath=join(directory,'receipt.json'),markerPath=join(directory,'submitted.json'),audioPath=join(directory,'audio.mp3')
    if(existsSync(receiptPath)){
      const saved=JSON.parse(readFileSync(receiptPath,'utf8'))
      if(saved.sourceSha256!==media.sha256)throw Error('语音转写缓存与原片不符')
      return saved as {text:string;requestId:string;modelVersion:string;sourceSha256:string}
    }
    if(existsSync(markerPath)){
      const marker=JSON.parse(readFileSync(markerPath,'utf8'))
      if(!(marker.responseComplete&&(!marker.httpOk||marker.statusCode!=='20000000')))throw Error('上次豆包极速版请求结果待核对，请按本地 submitted.json 中的 Request ID 人工核对；未自动重发')
    }
    const bitrate=materialAudioBitrate(durationMs)
    await mediaCommand(this.runtime.paths().ffmpeg,['-hide_banner','-loglevel','error','-y','-i',media.mediaPath,'-vn',
      '-af','aresample=async=1:first_pts=0,apad','-t',String(durationMs/1000),'-ac','1','-ar','16000','-c:a','libmp3lame','-b:a',`${bitrate}k`,audioPath],signal)
    if(statSync(audioPath).size>20*1024*1024)throw Error('音轨超过豆包极速版20MB直接提交范围')
    const bytes=readFileSync(audioPath),requestId=randomUUID()
    signal.throwIfAborted()
    writeFileSync(markerPath,JSON.stringify({requestId,sourceSha256:media.sha256,submittedAt:new Date().toISOString()},null,2))
    let response:Response,raw:string
    try{
      response=await fetch(DOUBAO_ENDPOINT+'recognize/flash',{method:'POST',redirect:'error',
        headers:doubaoHeaders(c,secret,requestId,true,DOUBAO_FLASH_RESOURCE),body:JSON.stringify(doubaoFlashBody(bytes)),
        signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])})
      raw=await response.text()
    }catch{throw Error('豆包极速版未完整返回，服务端结果未知；Request ID 已保存，未自动重发')}
    const status=response.headers.get('x-api-status-code')??''
    writeFileSync(join(directory,'response-original.json'),JSON.stringify({requestId,httpStatus:response.status,statusCode:status,
      logId:response.headers.get('x-tt-logid'),body:raw.split(secret).join('[REDACTED]')},null,2))
    writeFileSync(join(directory,`response-${requestId}.json`),JSON.stringify({requestId,httpStatus:response.status,statusCode:status,body:raw.split(secret).join('[REDACTED]')},null,2))
    writeFileSync(markerPath,JSON.stringify({requestId,sourceSha256:media.sha256,responseComplete:true,httpOk:response.ok,statusCode:status,finishedAt:new Date().toISOString()},null,2))
    if(!response.ok||status!=='20000000')throw Error(doubaoFlashFailure(response.status,status,response.headers.get('x-api-message')??''))
    const result=doubaoResult(JSON.parse(raw),durationMs)
    const saved={text:result.text,requestId,sourceSha256:media.sha256,modelVersion:'豆包语音识别极速版 · '+DOUBAO_FLASH_RESOURCE}
    writeFileSync(receiptPath,JSON.stringify(saved,null,2));return saved
  }
  private storedTrial(){return this.read<StoredTrial>(TRIAL)}
  private publicTrial(t:StoredTrial):DoubaoSpeechTrial{
    const {owner,secretRef,authMode,appId,directory,sourceSha256,audioSha256,...trial}=t
    return trial
  }
  private flashTrial(){return this.read<StoredTrial>(FLASH_TRIAL)}
  view():DoubaoSpeechView{
    const legacy=this.standardView(),stored=this.flashTrial()
    let trial:DoubaoSpeechTrial=stored?this.publicTrial(stored):{state:'idle',message:'本地音轨可直接提交；尚未调用极速版',resourceId:DOUBAO_FLASH_RESOURCE}
    if(stored?.state==='failed'&&stored.httpStatus&&/invalid x-api-key/i.test(stored.apiMessage??'')){
      trial={...trial,message:doubaoFlashFailure(stored.httpStatus,stored.statusCode??'',stored.apiMessage??'')}
    }
    if(stored&&!this.flashActive&&['preparing','running'].includes(stored.state)){
      trial={...trial,state:stored.submittedAt?'uncertain':'failed',message:stored.submittedAt
        ?'上次请求被中断，服务端结果未知；已保留Request ID，请核对服务记录。极速版不支持继续查询，程序不会自动重发。'
        :'上次准备被中断，尚未提交音频，可重新开始。'}
    }
    return {...legacy,trial,...(legacy.trial.state!=='idle'?{standardTrial:{...legacy.trial,resourceId:DOUBAO_RESOURCE}}:{})}
  }
  private standardView():DoubaoSpeechView{
    const c=this.config(),t=this.storedTrial()
    const settings:DoubaoSpeechSettings={authMode:c.authMode,appId:c.appId,hasSecret:!!c.secretRef&&!!this.secrets(c.secretRef).getApiKey(),resourceId:DOUBAO_FLASH_RESOURCE,revision:this.revision(c)}
    const trial:DoubaoSpeechTrial=t?{state:!this.abort&&!this.preparing&&['preparing','running'].includes(t.state)?'pending':t.state,message:t.message,
      requestId:t.requestId,startedAt:t.startedAt,finishedAt:t.finishedAt,elapsedMs:t.elapsedMs,audioDurationMs:t.audioDurationMs,
      text:t.text,statusCode:t.statusCode,logId:t.logId}:{state:'idle',message:'尚未提交豆包识别任务'}
    return {settings,trial,audioReady:existsSync(this.audioPath)}
  }
  save(input:unknown){
    if(this.running)throw Error('请等待当前豆包任务或连通测试结束再修改凭据')
    const request=z.object({authMode:z.enum(['api-key','app-token']),appId:z.string().trim().max(120),secret:z.string().trim().max(2000)}).strict().parse(input)
    if(request.authMode==='app-token'&&!/^[a-zA-Z0-9_-]+$/.test(request.appId))throw Error('旧版鉴权需要填写APP ID')
    if(/[\r\n]/.test(request.secret))throw Error('凭据不能包含换行')
    const old=this.config();let ref=old.authMode===request.authMode?old.secretRef:null
    if(request.secret){ref=randomUUID();this.secrets(ref).setApiKey(request.secret)}
    if(!ref)throw Error('请填写此鉴权方式对应的凭据')
    this.write(SETTINGS,{authMode:request.authMode,appId:request.authMode==='app-token'?request.appId:'',secretRef:ref});return this.view()
  }
  async prepareAudio(){
    if(this.running)throw Error('豆包任务正在运行')
    this.preparing=true
    try{return await this.prepareVerifiedAudio(AbortSignal.timeout(120000))}finally{this.preparing=false}
  }
  private async prepareVerifiedAudio(signal:AbortSignal){
    this.assertIdle()
    const owner=this.following.videoLibraryView().ownerSecUid
    if(!owner)throw Error('请先选择已保存视频的资料账号')
    this.following.requireOwner(owner)
    const work=this.following.videoInformation.store.list(owner).find(w=>w.workId===WORK_ID)
    const media=this.following.videoContent.stage(owner,WORK_ID,'media',true)?.result as any
    if(!work||!media?.mediaPath||!existsSync(media.mediaPath))throw Error('本机未找到《数学彻底怒openai了》的已保存原片')
    const hash=createHash('sha256').update(readFileSync(media.mediaPath)).digest('hex')
    if(hash!==media.sha256||statSync(media.mediaPath).size!==media.byteLength)throw Error('原片校验失败')
    const proof=JSON.parse(readFileSync(join(media.directory,'proof.json'),'utf8'))
    if(proof.capture.work.workId!==WORK_ID||proof.capture.work.authorUid!==work.authorUid||proof.capture.ownerVerification.secUid!==owner)throw Error('视频归属校验失败')
    const paths=this.runtime.paths()
    const meta=JSON.parse(await mediaCommand(paths.ffprobe,['-v','error','-show_format','-show_streams','-of','json',media.mediaPath],signal))
    const durationMs=Math.round(Number(meta.format.duration)*1000)
    if(!meta.streams.some((s:any)=>s.codec_type==='audio')||!Number.isFinite(durationMs)||Math.abs(durationMs-(work.durationMs??0))>1500)throw Error('原片时长或音轨不符')
    const dir=join(this.userData,'speech-tests','math-openai');mkdirSync(dir,{recursive:true})
    const manifestPath=join(dir,'audio-manifest.json')
    let old:any;try{old=JSON.parse(readFileSync(manifestPath,'utf8'))}catch{}
    if(!(old?.owner===owner&&old?.workId===WORK_ID&&old?.sourceSha256===hash&&old?.durationMs===durationMs&&existsSync(this.audioPath)
      &&statSync(this.audioPath).size===old.bytes&&createHash('sha256').update(readFileSync(this.audioPath)).digest('hex')===old.audioSha256)){
      await mediaCommand(paths.ffmpeg,['-hide_banner','-loglevel','error','-y','-i',media.mediaPath,'-vn','-af','aresample=async=1:first_pts=0,apad','-t',String(durationMs/1000),'-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','64k',this.audioPath],signal)
    }
    const value={owner,workId:WORK_ID,sourceSha256:hash,audioSha256:createHash('sha256').update(readFileSync(this.audioPath)).digest('hex'),durationMs,bytes:statSync(this.audioPath).size}
    writeFileSync(manifestPath,JSON.stringify(value,null,2));return value
  }
  private updateFlash(t:StoredTrial){
    if(this.closed)return
    // No auth headers, credential references, account identity or audio Base64 in evidence files.
    writeFileSync(join(t.directory,'request-metadata.json'),JSON.stringify({...this.publicTrial(t),workId:WORK_ID,
      endpoint:DOUBAO_ENDPOINT+'recognize/flash',sourceSha256:t.sourceSha256,audioSha256:t.audioSha256},null,2))
    this.write(FLASH_TRIAL,t);this.changed()
  }
  startFlash(input:unknown){
    if(this.running)throw Error('豆包转写正在运行')
    this.assertIdle()
    const {clickedAt}=z.object({clickedAt:z.number().finite()}).strict().parse(input),now=Date.now()
    if(clickedAt>now+1000||now-clickedAt>60000)throw Error('开始时间无效，请重新点击')
    const prior=this.view().trial
    if(prior.state==='uncertain')throw Error('上次极速版请求结果未知，请先按Request ID核对服务记录；不能继续查询或自动重发')
    if(prior.state==='completed')throw Error('本条极速版转写已完成，原文已保存，无需重复提交')
    const legacy=this.storedTrial()
    if(legacy&&['preparing','running','pending'].includes(legacy.state))throw Error('还有标准版历史任务待核对，不能重复提交此样本')
    const c=this.config();if(!c.secretRef||!this.secrets(c.secretRef).getApiKey())throw Error('请先保存豆包语音凭据')
    const owner=this.following.videoLibraryView().ownerSecUid;if(!owner)throw Error('请先选择已保存视频的资料账号')
    this.following.requireOwner(owner)
    const id=randomUUID(),directory=join(this.userData,'speech-tests','doubao-flash',id);mkdirSync(directory,{recursive:true})
    const t:StoredTrial={state:'preparing',message:'正在校验本地音轨与视频归属',requestId:id,resourceId:DOUBAO_FLASH_RESOURCE,
      startedAt:new Date(Math.min(clickedAt,now)).toISOString(),owner,secretRef:c.secretRef,authMode:c.authMode,appId:c.appId,directory,sourceSha256:'',audioSha256:''}
    const controller=new AbortController();this.abort=controller;this.flashActive=t;this.displayRequestId=id;this.updateFlash(t)
    void this.executeFlash(t,controller.signal).catch(error=>{
      t.state=t.submittedAt&&!t.httpStatus?'uncertain':'failed'
      t.finishedAt=new Date().toISOString();t.elapsedMs=Date.now()-Date.parse(t.startedAt!)
      t.message=controller.signal.aborted?(t.submittedAt?'已停止等待，服务端结果未知；极速版不能继续查询，程序不会自动重发。':'已取消本地准备，尚未提交音频。')
        :error instanceof Error?error.message:'极速版未完成，原始记录已保留'
      this.updateFlash(t)
    }).finally(()=>{this.abort=null;this.flashActive=null;if(!this.closed)this.changed()})
    return this.view()
  }
  private async executeFlash(t:StoredTrial,signal:AbortSignal){
    const prepared=await this.prepareVerifiedAudio(AbortSignal.any([signal,AbortSignal.timeout(120000)]))
    signal.throwIfAborted();this.following.requireOwner(t.owner)
    if(prepared.owner!==t.owner)throw Error('资料账号已改变，未提交音频')
    t.sourceSha256=prepared.sourceSha256;t.audioSha256=prepared.audioSha256;t.audioDurationMs=prepared.durationMs
    if(prepared.bytes<=0||prepared.bytes>20*1024*1024||prepared.durationMs<=0||prepared.durationMs>7200000)throw Error('本地音轨超出直接提交范围（20MB、2小时）')
    const bytes=readFileSync(this.audioPath)
    if(bytes.length!==prepared.bytes||createHash('sha256').update(bytes).digest('hex')!==prepared.audioSha256)throw Error('本地音轨在校验后发生变化，未提交音频')
    const secret=this.secrets(t.secretRef).getApiKey();if(!secret)throw Error('豆包凭据不可用')
    const body=JSON.stringify(doubaoFlashBody(bytes))
    signal.throwIfAborted()
    t.preparationMs=Date.now()-Date.parse(t.startedAt!);t.state='running';t.message='正在识别本地音轨，等待极速版一次返回完整转写'
    t.submittedAt=new Date().toISOString();this.updateFlash(t)
    const requestStarted=Date.now()
    let response:Response,raw:string
    try{
      response=await fetch(DOUBAO_ENDPOINT+'recognize/flash',{method:'POST',redirect:'error',
        headers:doubaoHeaders(t,secret,t.requestId!,true,DOUBAO_FLASH_RESOURCE),body,
        signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])})
      t.statusCode=response.headers.get('x-api-status-code')??'';t.logId=response.headers.get('x-tt-logid')??''
      t.apiMessage=(response.headers.get('x-api-message')??'').split(secret).join('[redacted]')
      // Persist headers even if the response body is interrupted. Do not infer completion from HTTP 200.
      this.updateFlash(t)
      raw=await response.text()
    }catch{
      t.requestMs=Date.now()-requestStarted
      throw Error('极速版网络请求未完整返回，服务端结果未知；已保留Request ID。不能继续查询，程序不会自动重发。')
    }
    t.requestMs=Date.now()-requestStarted;t.httpStatus=response.status
    const savingStarted=Date.now()
    writeFileSync(join(t.directory,'response-original.json'),JSON.stringify({httpStatus:response.status,statusCode:t.statusCode,
      logId:t.logId,apiMessage:t.apiMessage,receivedAt:new Date().toISOString(),body:raw},null,2))
    if(!response.ok||t.statusCode!=='20000000')throw Error(doubaoFlashFailure(response.status,t.statusCode??'',t.apiMessage??''))
    if(raw.length>4000000)throw Error('极速版响应过大，原始回执已保存')
    let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw Error('极速版响应不是有效JSON，原始回执已保存')}
    const result=doubaoResult(parsed,t.audioDurationMs!)
    writeFileSync(join(t.directory,'transcript-original.txt'),result.text,'utf8')
    t.text=result.text;t.returnedDurationMs=result.durationMs;t.saveMs=Date.now()-savingStarted
    t.state='completed';t.finishedAt=new Date().toISOString();t.elapsedMs=Date.now()-Date.parse(t.startedAt!)
    t.message='录音文件识别极速版已完成，以下为未经修改的返回原文';this.updateFlash(t)
  }
  markFlashDisplayed(input:unknown){
    const {requestId,displayedAt}=z.object({requestId:z.string().uuid(),displayedAt:z.number().finite()}).strict().parse(input)
    const t=this.flashTrial(),now=Date.now()
    if(!t||t.requestId!==requestId||t.state!=='completed'||t.displayedAt)return this.view()
    if(this.displayRequestId!==requestId)return this.view()
    // Only the live request can claim click-to-visible timing; reopening a historical result cannot.
    if(displayedAt<Date.parse(t.finishedAt!)||displayedAt>now+1000||now-displayedAt>10000)throw Error('展示时间无效')
    t.displayedAt=new Date(displayedAt).toISOString();t.displayedTotalMs=displayedAt-Date.parse(t.startedAt!)
    this.updateFlash(t);return this.view()
  }
  private update(t:StoredTrial){if(this.closed)return;this.write(TRIAL,t);this.changed()}
  async start(input:unknown){
    if(this.running)throw Error('豆包转写正在运行')
    const url=validateDoubaoAudioUrl(z.string().max(16000).parse(input))
    const prior=this.storedTrial()
    if(prior&&['preparing','running','pending'].includes(prior.state))throw Error('已有任务待确认，请继续查询原任务，避免重复提交')
    const c=this.config();if(!c.secretRef||!this.secrets(c.secretRef).getApiKey())throw Error('请先保存豆包语音凭据')
    // Acquire the media synchronously before awaiting network work; renderer also disables duplicate clicks.
    const preparing=this.prepareAudio();this.preparing=true
    let media:Awaited<ReturnType<DoubaoSpeechService['prepareAudio']>>
    try{media=await preparing}finally{this.preparing=false}
    if(this.closed)throw Error('应用正在退出')
    const id=randomUUID(),directory=join(this.userData,'speech-tests','doubao',id);mkdirSync(directory,{recursive:true})
    const t:StoredTrial={state:'preparing',message:'正在核对临时链接中的MP3是否为指定样本',requestId:id,startedAt:new Date().toISOString(),
      audioDurationMs:media.durationMs,owner:media.owner,secretRef:c.secretRef,authMode:c.authMode,appId:c.appId,directory,sourceSha256:media.sourceSha256,audioSha256:media.audioSha256}
    this.launch(t,url);return this.standardView()
  }
  resume(){
    if(this.running)throw Error('豆包转写正在运行')
    this.assertIdle();const t=this.storedTrial();if(!t?.requestId||!['pending','running','preparing'].includes(t.state))throw Error('没有待查询的原任务')
    this.following.requireOwner(t.owner);this.launch(t);return this.standardView()
  }
  private launch(t:StoredTrial,url?:string){
    this.abort=new AbortController();const signal=this.abort.signal;this.update(t)
    void this.execute(t,signal,url).catch(error=>{
      t.state=['preparing','failed'].includes(t.state)?'failed':'pending';t.message=signal.aborted?'已停止本地查询；服务端任务可能仍在运行，可继续查询原任务':error instanceof Error?error.message:'豆包请求未完成';this.update(t)
    }).finally(()=>{this.abort=null;if(!this.closed)this.changed()})
  }
  private async request(t:StoredTrial,action:'submit'|'query',body:unknown,signal:AbortSignal){
    const secret=this.secrets(t.secretRef).getApiKey();if(!secret)throw Error('豆包凭据不可用')
    let response:Response
    try{response=await fetch(DOUBAO_ENDPOINT+action,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),
      headers:doubaoHeaders(t,secret,t.requestId!,action==='submit'),body:JSON.stringify(body)})}catch{throw Error('网络请求未完成；请查询原任务，不要重新提交')}
    const code=response.headers.get('x-api-status-code')??'',logId=response.headers.get('x-tt-logid')??''
    // Never persist auth headers or the signed audio URL.
    const raw=await response.text();if(raw.length>4000000)throw Error('服务端响应过大')
    writeFileSync(join(t.directory,`${action}-${Date.now()}.json`),JSON.stringify({httpStatus:response.status,statusCode:code,logId,body:raw},null,2))
    t.statusCode=code;t.logId=logId
    if(!response.ok||!code){t.state='failed';this.update(t);throw Error(`豆包接口拒绝请求（HTTP ${response.status}，业务码 ${code||'缺失'}）。请核对语音服务API Key、项目权限和2.0开通状态。`)}
    return {code,raw}
  }
  private async execute(t:StoredTrial,signal:AbortSignal,url?:string){
    if(url){
      let downloaded:Response
      try{downloaded=await fetch(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])})}catch{throw Error('音频临时链接不可读取，请重新生成可读链接')}
      if(!downloaded.ok||!downloaded.body)throw Error('音频链接未返回文件，请检查有效期和对象权限')
      const reader=downloaded.body.getReader(),hash=createHash('sha256');let bytes=0
      try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>8*1024*1024)throw Error('链接文件超过本次样本大小边界');hash.update(chunk.value)}}finally{await reader.cancel().catch(()=>{})}
      if(hash.digest('hex')!==t.audioSha256)throw Error('链接中的文件与本次导出的MP3不一致；未提交豆包')
      this.following.requireOwner(t.owner);t.state='running';t.message='正在提交录音文件识别2.0，仅转写音频';this.update(t)
      const response=await this.request(t,'submit',doubaoSubmitBody(url),signal)
      if(response.code!=='20000000'){t.state='failed';this.update(t);throw Error(`提交失败，豆包业务码 ${response.code}；未切换其他模型`)}
    }
    const deadline=Date.now()+300000
    while(Date.now()<deadline){
      signal.throwIfAborted();this.following.requireOwner(t.owner)
      const response=await this.request(t,'query',{},signal)
      if(response.code==='20000000'){
        let body:any;try{body=JSON.parse(response.raw)}catch{throw Error('识别响应不是有效JSON，原始结果已保存')}
        const result=doubaoResult(body,t.audioDurationMs!)
        writeFileSync(join(t.directory,'transcript-original.txt'),result.text,'utf8')
        t.state='completed';t.text=result.text;t.finishedAt=new Date().toISOString();t.elapsedMs=Date.now()-Date.parse(t.startedAt!);t.message='录音文件识别2.0转写完成，以下为原始返回文本';this.update(t);return
      }
      if(!['20000001','20000002'].includes(response.code)){t.state='failed';t.message=`查询结束，豆包业务码 ${response.code}；原始回执已保存`;this.update(t);return}
      t.state='running';t.message=response.code==='20000002'?'任务已提交，服务端排队中':'服务端正在识别音频';this.update(t)
      await new Promise<void>(resolve=>{const timer=setTimeout(done,5000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve()}signal.addEventListener('abort',done,{once:true})})
    }
    t.state='pending';t.message='任务仍在服务端处理，稍后继续查询即可，不会重新提交';this.update(t)
  }
  stop(){this.abort?.abort();this.connectionAbort?.abort();this.workshopAbort?.abort()}
  close(){this.closed=true;this.stop()}
}
