// Explicit synthetic connection check of the active saved profile. No settings mutations.
const {app,safeStorage}=require('electron')
const {mkdirSync,copyFileSync,existsSync,writeFileSync}=require('node:fs')
const {resolve,join}=require('node:path')
const readActiveCloudConfig=require('./read-active-cloud-config.cjs')
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const out=resolve('local-data/qwen-connection-20261011')
const profile=join(out,'isolated-profile');mkdirSync(profile,{recursive:true})
if(existsSync(join(source,'Local State')))copyFileSync(join(source,'Local State'),join(profile,'Local State'))
app.setPath('userData',profile);app.disableHardwareAcceleration()
let key=''
const redact=value=>String(value).split(key||'__no_key__').join('[REDACTED]').replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')
app.whenReady().then(async()=>{
 const started=performance.now(),report={checkedAt:new Date().toISOString(),syntheticInput:true,requestCount:0}
 try{
  const active=readActiveCloudConfig(source,safeStorage);key=active.key
  const settings=active.settings,base=new URL(settings.textBaseUrl)
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('PROBE_URL_REJECTED')
  const requested=process.argv[2]||'saved',protocol=requested==='saved'?settings.textApiProtocol:requested
  if(!['responses','chat-completions'].includes(protocol))throw Error('PROBE_PROTOCOL_UNSUPPORTED')
  if(!settings.textModel)throw Error('MODEL_NOT_CONFIGURED')
  Object.assign(report,{profileId:active.profileId,requestedModel:settings.textModel,savedProtocol:settings.textApiProtocol,testedProtocol:protocol,credentialsReadable:true})
  const endpoint=base.href.replace(/\/+$/,'')+(protocol==='responses'?'/responses':'/chat/completions')
  report.endpointHost=base.hostname;report.endpointPath=new URL(endpoint).pathname
  const prompt='这是一次最小连接测试。请仅返回JSON对象 {"ok":true,"check":"QWEN-CONNECT-7319"}，不添加解释。'
  const body=protocol==='responses'?{model:settings.textModel,store:false,stream:true,input:[{role:'user',content:[{type:'input_text',text:prompt}]}]}:
   {model:settings.textModel,stream:true,stream_options:{include_usage:true},modalities:['text'],messages:[{role:'user',content:prompt}]}
  report.requestCount++
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)})
  report.httpStatus=response.status;report.headersMs=Math.round(performance.now()-started);report.contentType=response.headers.get('content-type')
  const raw=await response.text();if(raw.length>2*1024*1024)throw Error('PROBE_RESPONSE_TOO_LARGE')
  if(!response.ok){
   try{const d=JSON.parse(raw);report.error={code:d.error?.code||d.code,message:d.error?.message||d.message||'HTTP_'+response.status,type:d.error?.type}}catch{report.error={message:'HTTP_'+response.status+' non-JSON response'}}
   report.ok=false
  }else{
   let content='',completed=false,usage=null,returnedModel=null;const events=new Set()
   const read=item=>{
    if(protocol==='chat-completions'){
     if(item.error)throw Error(item.error.message||'STREAM_ERROR')
     content+=item.choices?.[0]?.delta?.content||item.choices?.[0]?.message?.content||''
     completed ||= item.choices?.[0]?.finish_reason==='stop';usage=item.usage||usage;returnedModel=item.model||returnedModel
    }else{
     if(item.type)events.add(item.type)
     if(item.type==='response.output_text.delta')content+=item.delta||''
     if(item.type==='response.completed'||item.object==='response'){
      const r=item.response||item;completed=r.status==='completed';usage=r.usage||usage;returnedModel=r.model||returnedModel
      const text=(r.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');if(text)content=text
     }
     if(item.type==='error'||item.type==='response.failed'||item.type==='response.incomplete')throw Error(item.error?.message||item.response?.error?.message||'RESPONSES_FAILED')
    }
   }
   if(response.headers.get('content-type')?.includes('application/json'))read(JSON.parse(raw))
   else for(const frame of raw.split(/\r?\n\r?\n/)){
    const payload=frame.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n').trim()
    if(payload&&payload!=='[DONE]')read(JSON.parse(payload))
   }
   let parsed;try{parsed=JSON.parse(content)}catch{}
   Object.assign(report,{ok:completed&&parsed?.ok===true&&parsed?.check==='QWEN-CONNECT-7319',completed,reply:content,returnedModel,usage,events:[...events]})
  }
 }catch(error){report.ok=false;report.error={message:error.message,networkCode:error.cause?.code}}
 report.elapsedMs=Math.round(performance.now()-started)
 const serialized=JSON.stringify(report,(_,value)=>typeof value==='string'?redact(value):value,2)
 writeFileSync(join(out,Date.now()+'-'+(report.testedProtocol||'failed')+'.json'),serialized)
 console.log(serialized);key='';app.exit(report.ok?0:1)
}).catch(()=>{console.error('PROBE_INITIALIZATION_FAILED');app.exit(1)})
