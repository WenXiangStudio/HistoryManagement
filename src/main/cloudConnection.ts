import {cloudConnectionInputSchema,type CloudConnectionInput,type CloudConnectionResult} from '../shared/cloudConnection'
import type {TextApiProtocol} from '../shared/contracts'

export type ConnectionProvider={baseUrl:string;model:string;apiKey:string;protocol:TextApiProtocol;service:'text'|'vision'}
export type ModelConnectionInput=Exclude<CloudConnectionInput,{kind:'doubao'}>
export class CloudConnectionError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='CloudConnectionError'}
}
type Options={fetch?:typeof fetch;timeoutMs?:number;maxResponseBytes?:number}
// Generated 32×32 white RGB PNG; no user material is sent by a connectivity test.
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR4nO3NMQ0AAAwDoPo33arYsQQMkB6LQCAQCAQCgUAg+BIMi1X0pjxKe0gAAAAASUVORK5CYII='

function endpoint(provider:ConnectionProvider):string{
  let url:URL
  try{url=new URL(provider.baseUrl)}catch{throw new CloudConnectionError('invalid_config','接口地址无效，请检查并保存配置后重试。')}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new CloudConnectionError('invalid_config','接口地址须为 HTTP 或 HTTPS 基础地址，不能包含账号、密码、查询参数或片段。')
  url.pathname=url.pathname.replace(/\/+$/,'')+(provider.protocol==='responses'?'/responses':'/chat/completions')
  return url.toString()
}
function payload(provider:ConnectionProvider):unknown{
  if(provider.protocol==='responses')return {model:provider.model,store:false,stream:false,max_output_tokens:256,input:[{role:'user',content:provider.service==='vision'
    ?[{type:'input_text',text:'这是一张连通测试图片。请只回复图片的颜色。'},{type:'input_image',image_url:IMAGE,detail:'low'}]
    :[{type:'input_text',text:'连通测试，请只回复 OK。'}]}]}
  return {model:provider.model,stream:false,max_tokens:256,messages:[{role:'user',content:provider.service==='vision'
    ?[{type:'text',text:'这是一张连通测试图片。请只回复图片的颜色。'},{type:'image_url',image_url:{url:IMAGE,detail:'low'}}]
    :'连通测试，请只回复 OK。'}]}
}
function assertOutput(value:any,protocol:TextApiProtocol):{truncated:boolean}{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new CloudConnectionError('invalid_response','接口返回的数据格式不符合所选协议，请检查接口地址与协议。')
  if(value.error)throw new CloudConnectionError('provider_error','接口返回了错误结果，请检查模型 ID、账号权限及云端服务状态。')
  if(value.model!==undefined&&typeof value.model!=='string')throw new CloudConnectionError('invalid_response','接口返回的模型标识格式无效，请检查服务兼容性。')
  if(protocol==='responses'){
    const truncated=value.status==='incomplete'&&value.incomplete_details?.reason==='max_output_tokens'
    if(value.status!=='completed'&&!truncated)throw new CloudConnectionError('incomplete_output','接口已响应，但模型未完成输出；请检查模型限制或服务状态后重试。')
    if(!Array.isArray(value.output))throw new CloudConnectionError('invalid_response','接口返回缺少 Responses 输出，请检查所选协议。')
    const messages=value.output.filter((item:any)=>item?.type==='message')
    if(messages.some((item:any)=>item.status&&item.status!=='completed'&&!(truncated&&item.status==='incomplete')))throw new CloudConnectionError('incomplete_output','接口已响应，但模型消息尚未完成。')
    const content=messages.flatMap((item:any)=>Array.isArray(item.content)?item.content:[])
    if(content.some((item:any)=>item?.type==='refusal'))throw new CloudConnectionError('refused','模型拒绝了连通测试请求，请检查模型或服务策略。')
    if(!content.some((item:any)=>item?.type==='output_text'&&typeof item.text==='string'&&item.text.trim()))throw new CloudConnectionError('empty_output','接口已响应，但未返回有效文字，尚不能确认模型可用。')
    return {truncated}
  }
  if(!Array.isArray(value.choices)||!value.choices.length)throw new CloudConnectionError('invalid_response','接口返回缺少 Chat Completions 输出，请检查所选协议。')
  const choice=value.choices[0]
  if(choice?.finish_reason!=='stop'&&choice?.finish_reason!=='length')throw new CloudConnectionError('incomplete_output','接口已响应，但模型输出未正常完成；请检查模型限制或服务状态后重试。')
  if(choice.message?.refusal)throw new CloudConnectionError('refused','模型拒绝了连通测试请求，请检查模型或服务策略。')
  const content=choice.message?.content
  const text=typeof content==='string'?content:Array.isArray(content)?content.filter((part:any)=>part?.type==='text'&&typeof part.text==='string').map((part:any)=>part.text).join(''):''
  if(!text.trim())throw new CloudConnectionError('empty_output','接口已响应，但未返回有效文字，尚不能确认模型可用。')
  return {truncated:choice.finish_reason==='length'}
}
function parseBody(raw:string,eventStream:boolean,protocol:TextApiProtocol):unknown{
  const parse=(text:string)=>{try{return JSON.parse(text)}catch{throw new CloudConnectionError('invalid_response','接口返回的不是有效 JSON，请检查基础地址与所选协议。')}}
  if(!eventStream)return parse(raw)
  const events:any[]=[]
  for(const frame of raw.split(/\r?\n\r?\n/)){
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
    if(data&&data!=='[DONE]')events.push(parse(data))
  }
  if(protocol==='responses'){
    const failed=events.some(event=>['error','response.failed'].includes(event?.type))
    if(failed)throw new CloudConnectionError('provider_error','接口返回了错误结果，请检查模型 ID、账号权限及云端服务状态。')
    const complete=[...events].reverse().find(event=>event?.type==='response.completed'||event?.type==='response.incomplete')
    if(!complete?.response)throw new CloudConnectionError('incomplete_output','接口已响应，但没有返回完整的 Responses 完成事件。')
    return complete.response
  }
  let content='',finish_reason:unknown,model:unknown,refusal=false
  for(const event of events){
    if(event?.error)throw new CloudConnectionError('provider_error','接口返回了错误结果，请检查模型 ID、账号权限及云端服务状态。')
    if(event?.model!==undefined){if(typeof event.model!=='string')throw new CloudConnectionError('invalid_response','接口返回的模型标识格式无效，请检查服务兼容性。');model=event.model}
    const choice=event?.choices?.find((item:any)=>item?.index===0)??event?.choices?.[0]
    if(choice?.delta?.content!==undefined){if(typeof choice.delta.content!=='string')throw new CloudConnectionError('invalid_response','接口的流式文字格式无效，请检查服务兼容性。');content+=choice.delta.content}
    if(choice?.delta?.refusal)refusal=true
    if(choice?.finish_reason)finish_reason=choice.finish_reason
  }
  return {model,choices:[{finish_reason,message:{content,...(refusal?{refusal:'refused'}:{})}}]}
}
function httpError(status:number):CloudConnectionError{
  if(status===401)return new CloudConnectionError('authentication_failed','认证失败（HTTP 401），请检查 API Key 是否正确、有效并已保存。')
  if(status===403)return new CloudConnectionError('permission_denied','访问被拒绝（HTTP 403），请检查 API Key 权限及该模型的访问资格。')
  if(status===404)return new CloudConnectionError('endpoint_or_model_not_found','接口或模型不存在（HTTP 404），请检查基础地址、所选协议和完整模型 ID。')
  if(status===429)return new CloudConnectionError('rate_limited','请求受限（HTTP 429），请检查余额、配额与频率限制，稍后重试。')
  if(status>=500)return new CloudConnectionError('provider_unavailable',`云端服务暂时异常（HTTP ${status}），请稍后重试。`)
  return new CloudConnectionError('request_rejected',`接口拒绝请求（HTTP ${status}），请检查所选协议、模型 ID 与账号权限。`)
}
async function readBody(response:Response,limit:number,signal:AbortSignal):Promise<string>{
  if(Number(response.headers.get('content-length'))>limit)throw new CloudConnectionError('response_too_large','接口返回内容超出连通测试限制，请检查接口地址。')
  if(!response.body)throw new CloudConnectionError('empty_output','接口未返回内容，尚不能确认模型可用。')
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text=''
  try{while(true){signal.throwIfAborted();const result=await reader.read();signal.throwIfAborted();if(result.done)break
    bytes+=result.value.byteLength;if(bytes>limit)throw new CloudConnectionError('response_too_large','接口返回内容超出连通测试限制，请检查接口地址。')
    text+=decoder.decode(result.value,{stream:true})
  }return text+decoder.decode()}finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
}
/** One saved target, one real request, no retries, protocol fallback, activation or writes. */
export class CloudConnectionService {
  private readonly pending=new Set<string>()
  constructor(private resolveProvider:(input:ModelConnectionInput)=>ConnectionProvider,private options:Options={}){}
  async test(input:unknown):Promise<CloudConnectionResult>{
    const started=Date.now(),base={testedAt:new Date().toISOString(),model:'',service:'text' as CloudConnectionResult['service']}
    const result=(ok:boolean,message:string,extra:Partial<CloudConnectionResult>={}):CloudConnectionResult=>({...base,ok,message,elapsedMs:Date.now()-started,...extra})
    const parsed=cloudConnectionInputSchema.safeParse(input)
    if(!parsed.success||parsed.data.kind==='doubao')return result(false,'连通测试参数无效，请重新打开设置后重试。',{code:'invalid_input'})
    const request=parsed.data,key=request.kind+':'+request.profileId+':'+(request.kind==='profile'?request.service:'model')
    if(this.pending.has(key))return result(false,'该模型正在进行连通测试，请等待本次结果。',{code:'already_running',service:request.kind==='profile'?request.service:'text'})
    this.pending.add(key)
    let provider:ConnectionProvider|undefined,httpStatus:number|undefined,requestId:string|undefined,timer:ReturnType<typeof setTimeout>|undefined
    const controller=new AbortController()
    try{
      provider=this.resolveProvider(request);base.model=provider.model;base.service=provider.service
      if(!provider.model.trim()||!provider.baseUrl.trim()||!provider.apiKey.trim())throw new CloudConnectionError('missing_config','请先填写并保存接口地址、完整模型 ID 和 API Key，再进行连通测试。')
      if(provider.protocol!=='responses'&&provider.protocol!=='chat-completions')throw new CloudConnectionError('invalid_config','所选接口协议无效，请重新保存云端配置。')
      if(/[\r\n]/.test(provider.apiKey))throw new CloudConnectionError('invalid_config','API Key 含有无效字符，请检查后重新保存。')
      const url=endpoint(provider),timeout=Math.max(1,Math.min(this.options.timeoutMs??45000,45000))
      const timeoutPromise=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CloudConnectionError('timeout','连通测试超时，请检查网络、代理与云端服务状态后重试。'))},timeout)})
      const operation=(async()=>{
        const response=await (this.options.fetch??fetch)(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json',authorization:'Bearer '+provider!.apiKey},body:JSON.stringify(payload(provider!))})
        httpStatus=response.status
        const id=response.headers.get('x-request-id')??response.headers.get('request-id')
        if(id&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)&&!id.includes(provider!.apiKey))requestId=id
        if(!response.ok){void response.body?.cancel().catch(()=>{});throw httpError(response.status)}
        const raw=await readBody(response,Math.min(this.options.maxResponseBytes??256*1024,256*1024),controller.signal)
        const body=parseBody(raw,!!response.headers.get('content-type')?.includes('text/event-stream'),provider!.protocol)
        return assertOutput(body,provider!.protocol)
      })()
      const output=await Promise.race([operation,timeoutPromise])
      return result(true,(provider.service==='vision'?'连通成功：模型已接收测试图片并返回文字':'连通成功：模型已返回有效文字')+(output.truncated?'（测试输出已截断）。':'。'),{httpStatus,requestId})
    }catch(error){
      const known=error instanceof CloudConnectionError?error:new CloudConnectionError(controller.signal.aborted?'timeout':'network_error',controller.signal.aborted?'连通测试超时，请检查网络、代理与云端服务状态后重试。':'无法连接云端接口，请检查网络、代理、证书与接口地址后重试。')
      // Only application-authored messages are returned; provider bodies/errors can contain credentials or URLs.
      return result(false,known.message,{code:known.code,...(httpStatus!==undefined?{httpStatus}:{}),...(requestId?{requestId}:{})})
    }finally{if(timer)clearTimeout(timer);controller.abort();this.pending.delete(key)}
  }
}
