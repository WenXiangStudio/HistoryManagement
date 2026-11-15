type Provider={baseUrl:string;model:string;apiKey?:string}
type Usage={inputTokens:number;outputTokens:number}
type Result={text:string;usage:Usage;model?:string}
export type ResponsesInputPart={type:'input_text';text:string}|{type:'input_image';image_url:string;detail?:'high'|'low'|'auto'}
  |{type:'input_audio';audio_url:string;format:'wav'|'mp3'}|{type:'input_video';video_url:string}
const MAX_TEXT=100000,MAX_EVENT=1024*1024

function completedResult(response:any,streamed:string):Result{
  if(response?.status!=='completed')throw Error('RESPONSES_OUTPUT_INCOMPLETE')
  const pieces:string[]=[]
  for(const item of response.output??[]){
    if(item.type!=='message')continue
    for(const part of item.content??[]){
      if(part.type==='refusal')throw Error('RESPONSES_OUTPUT_REFUSED')
      if(part.type==='output_text'&&typeof part.text==='string')pieces.push(part.text)
    }
  }
  const text=pieces.length?pieces.join(''):streamed
  if(!text)throw Error('RESPONSES_OUTPUT_EMPTY')
  if(text.length>MAX_TEXT)throw Error('RESPONSES_OUTPUT_TOO_LARGE')
  const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0
  return {text,usage:{inputTokens:count(response.usage?.input_tokens),outputTokens:count(response.usage?.output_tokens)},...(typeof response.model==='string'?{model:response.model}:{})}
}

async function* events(body:ReadableStream<Uint8Array>,signal:AbortSignal):AsyncGenerator<any>{
  const decoder=new TextDecoder(),reader=body.getReader()
  let buffer=''
  const parse=(frame:string)=>{
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
    if(!data||data==='[DONE]')return null
    try{return JSON.parse(data)}catch{throw Error('RESPONSES_STREAM_MALFORMED')}
  }
  try{
    while(true){
      signal.throwIfAborted()
      const {value,done}=await reader.read()
      buffer+=done?decoder.decode():decoder.decode(value,{stream:true})
      let separator:RegExpExecArray|null
      while((separator=/\r?\n\r?\n/.exec(buffer))){
        if(separator.index>MAX_EVENT)throw Error('RESPONSES_EVENT_TOO_LARGE')
        const frame=buffer.slice(0,separator.index);buffer=buffer.slice(separator.index+separator[0].length)
        const event=parse(frame);if(event)yield event
      }
      if(buffer.length>MAX_EVENT)throw Error('RESPONSES_EVENT_TOO_LARGE')
      if(done){const event=parse(buffer);if(event)yield event;break}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}

/** Stateless text-only Responses request. Selected protocol never falls back to Chat Completions. */
export async function requestResponsesText(provider:Provider,instructions:string,input:string,signal:AbortSignal,options?:{timeoutMs?:number;reasoningEffort?:'low';maxOutputTokens?:number}):Promise<Result>{
  return requestResponsesContent(provider,instructions,[{type:'input_text',text:input}],signal,options?.timeoutMs,options)
}
/** Explicit media adapter; no protocol or model fallback. */
export async function requestResponsesContent(provider:Provider,instructions:string,content:ResponsesInputPart[],signal:AbortSignal,timeoutMs=120000,options?:{reasoningEffort?:'low';maxOutputTokens?:number}):Promise<Result>{
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])
  requestSignal.throwIfAborted()
  try{
  const response=await fetch(provider.baseUrl.replace(/\/+$/,'')+'/responses',{
    method:'POST',signal:requestSignal,redirect:'error',
    headers:{'content-type':'application/json',...(provider.apiKey?{authorization:'Bearer '+provider.apiKey}:{})},
    // Keep the task contract in a developer input item as well as the gateway-level instruction boundary.
    body:JSON.stringify({model:provider.model,instructions:'按开发者消息中的要求处理用户材料，只返回JSON对象。',
      input:[{role:'developer',content:[{type:'input_text',text:instructions}]},{role:'user',content}],
      store:false,stream:true,text:{format:{type:'json_object'}},...(options?.reasoningEffort?{reasoning:{effort:options.reasoningEffort}}:{}),
      ...(options?.maxOutputTokens?{max_output_tokens:options.maxOutputTokens}:{})})
  })
  if(!response.ok)throw Error('RESPONSES_PROVIDER_HTTP_'+response.status)
  if(response.headers.get('content-type')?.includes('application/json')){
    const raw=await response.text();requestSignal.throwIfAborted()
    if(raw.length>MAX_EVENT)throw Error('RESPONSES_EVENT_TOO_LARGE')
    return completedResult(JSON.parse(raw),'')
  }
  if(!response.body)throw Error('RESPONSES_OUTPUT_EMPTY')
  let text=''
  for await(const event of events(response.body,requestSignal)){
    requestSignal.throwIfAborted()
    if(event.type==='response.output_text.delta'){
      if(typeof event.delta!=='string')throw Error('RESPONSES_STREAM_MALFORMED')
      text+=event.delta
      if(text.length>MAX_TEXT)throw Error('RESPONSES_OUTPUT_TOO_LARGE')
    }
    if(event.type==='response.refusal.delta'||event.type==='response.refusal.done')throw Error('RESPONSES_OUTPUT_REFUSED')
    if(event.type==='response.incomplete')throw Error('RESPONSES_OUTPUT_INCOMPLETE')
    if(event.type==='error'||event.type==='response.failed')throw Error('RESPONSES_PROVIDER_FAILED')
    if(event.type==='response.completed')return completedResult(event.response,text)
  }
  throw Error('RESPONSES_OUTPUT_INCOMPLETE')
  }catch(error){if(requestSignal.aborted&&!signal.aborted)throw Error('RESPONSES_TIMEOUT');throw error}
}
