// Explicit connection probe. Reads saved settings/credentials without changing the daily APP.
// Only synthetic text is sent; keys never leave memory except in the intended Authorization header.
const {app,safeStorage}=require('electron')
const readActiveCloudConfig=require('./read-active-cloud-config.cjs')
const {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync}=require('node:fs')
const {join,resolve}=require('node:path')
const mode=process.argv[2]||'chat'
if(!['chat','responses','summary','summary-responses'].includes(mode))throw Error('Unknown probe mode')
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const output=resolve('local-data/cloud-text-check-20261011')
const profile=join(output,'isolated-profile')
mkdirSync(profile,{recursive:true})
if(existsSync(join(source,'Local State')))copyFileSync(join(source,'Local State'),join(profile,'Local State'))
app.setPath('userData',profile)
app.disableHardwareAcceleration()
let key=''
function redact(value){
  let text=String(value||'')
  if(key)text=text.split(key).join('[REDACTED]')
  return text.replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')
}
const safeMessage=value=>redact(value).slice(0,350)
function save(report){
  const serialized=JSON.stringify(report,(_key,value)=>typeof value==='string'?redact(value):value,2)
  writeFileSync(join(output,mode+'-probe.json'),serialized)
  process.stdout.write(serialized+'\n')
}
app.whenReady().then(async()=>{
  const started=performance.now()
  const report={checkedAt:new Date().toISOString(),mode,requestCount:0,syntheticInput:true}
  try{
    const active=readActiveCloudConfig(source,safeStorage),settings=active.settings
    key=active.key
    const base=new URL(settings.textBaseUrl)
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('PROBE_URL_REJECTED')
    if(!settings.textModel)throw Error('MODEL_NOT_CONFIGURED')
    if(!safeStorage.isEncryptionAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE')
    if(!key.trim())throw Error('TEXT_KEY_UNAVAILABLE')
    report.credentialsReadable=true
    if(mode==='summary'||mode==='summary-responses'){
      const originalFetch=globalThis.fetch
      globalThis.fetch=async(...args)=>{
        report.requestCount++
        ;(report.requestPaths??=[]).push(new URL(String(args[0])).pathname)
        const response=await originalFetch(...args)
        if(mode==='summary-responses'){
          const clone=response.clone()
          report.providerCapture=clone.text().then(raw=>{
            for(const line of raw.split('\n')){
              if(!line.startsWith('data:'))continue
              try{const event=JSON.parse(line.slice(5));if(event.type==='response.completed'){
                report.providerReply=(event.response?.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==='output_text').map(part=>part.text).join('')
                report.providerUsage=event.response?.usage?{inputTokens:event.response.usage.input_tokens,outputTokens:event.response.usage.output_tokens}:null
              }}catch{}
            }
          }).catch(()=>{})
        }
        return response
      }
      const {generateVideoSummary}=require(join(output,'video-summary.cjs'))
      const texts=[
        '今天演示如何用电子表格筛选重复记录。先复制原表备份，再按订单编号查找重复项。',
        '这里有一百条演示数据，其中五条订单编号重复。这只是演示样本，不能推断你自己的表格也有百分之五重复。',
        '确认重复的记录再删除；不同客户恰好同名不算重复。今天没有演示自动定时处理。'
      ]
      const evidence=texts.map((text,i)=>({id:'synthetic-speech-'+(i+1),kind:'speech',startMs:i*10000,endMs:(i+1)*10000,text}))
      report.requestedModel=safeMessage(settings.textModel);report.requestCount=0
      report.protocol=mode==='summary-responses'?'responses':settings.textApiProtocol||'chat-completions'
      const result=await generateVideoSummary({kind:'cloud',baseUrl:settings.textBaseUrl,model:settings.textModel,apiKey:key,protocol:report.protocol},
        evidence,['合成连接测试材料，不来自真实作品。'],AbortSignal.timeout(60000))
      Object.assign(report,{ok:true,productionSummaryFunction:true,schemaAndReferencesValidated:true,
        inputEvidenceCount:evidence.length,processedChunks:result.processedChunks,overview:result.overview,keyPoints:result.keyPoints,
        topics:result.topics,usage:result.usage,promptVersion:result.promptVersion,elapsedMs:Math.round(performance.now()-started)})
      if(report.providerCapture){await report.providerCapture;delete report.providerCapture}
      save(report);key='';app.exit(0);return
    }
    const endpoint=settings.textBaseUrl.replace(/\/$/,'')+(mode==='chat'?'/chat/completions':'/responses')
    report.endpoint=endpoint;report.requestedModel=safeMessage(settings.textModel)
    const body=mode==='chat'?{model:settings.textModel,temperature:0,max_tokens:64,stream:true,stream_options:{include_usage:true},
      messages:[{role:'system',content:'这是连接测试。只返回JSON对象，不要添加其他内容。'},{role:'user',content:'请返回 {"ok":true}。'}],response_format:{type:'json_object'}}:
      {model:settings.textModel,instructions:'这是连接测试。仅遵循用户提供的测试指令。',store:false,stream:true,
        input:[{role:'user',content:[{type:'input_text',text:'请只返回JSON对象 {"ok":true}。'}]}]}
    report.requestCount++
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:'error'})
    report.httpStatus=response.status;report.contentType=response.headers.get('content-type')
    if(!response.ok){
      const raw=await response.text()
      try{const data=JSON.parse(raw);report.error=safeMessage(data.error?.message||data.error?.code||data.message||'HTTP_'+response.status)}catch{report.error='HTTP_'+response.status+' (non-JSON response)'}
      report.ok=false
    }else{
      let buffer='',content='',completed=false,usage=null,returnedModel=null
      const decoder=new TextDecoder(),events=new Set()
      for await(const bytes of response.body){
        buffer+=decoder.decode(bytes,{stream:true})
        if(buffer.length>1024*1024)throw Error('PROBE_RESPONSE_TOO_LARGE')
        const lines=buffer.split('\n');buffer=lines.pop()||''
        for(const line of lines){
          if(!line.startsWith('data:'))continue
          const text=line.slice(5).trim();if(!text||text==='[DONE]')continue
          const item=JSON.parse(text)
          if(mode==='chat'){
            content+=item.choices?.[0]?.delta?.content||''
            completed ||= item.choices?.[0]?.finish_reason==='stop'
            usage=item.usage||usage;returnedModel=item.model||returnedModel
          }else{
            if(item.type)events.add(item.type)
            if(item.type==='response.output_text.delta')content+=item.delta||''
            if(item.type==='response.completed'){completed=true;usage=item.response?.usage||usage;returnedModel=item.response?.model||returnedModel}
            if(item.type==='error'||item.type==='response.failed')throw Error(safeMessage(item.error?.message||item.response?.error?.message||'PROVIDER_STREAM_FAILED'))
          }
        }
      }
      let parsed=null;try{parsed=JSON.parse(content)}catch{}
      report.ok=completed&&parsed?.ok===true;report.completed=completed;report.jsonValid=parsed!==null
      report.reply=safeMessage(content);report.returnedModel=safeMessage(returnedModel);report.usage=usage;report.events=[...events]
    }
  }catch(error){report.ok=false;report.error=safeMessage(error.message);if(error.cause?.code)report.networkCode=safeMessage(error.cause.code)}
  if(report.providerCapture){await report.providerCapture;delete report.providerCapture}
  report.elapsedMs=Math.round(performance.now()-started)
  save(report);key='';app.exit(report.ok?0:1)
}).catch(()=>{process.stderr.write('PROBE_INITIALIZATION_FAILED\n');app.exit(1)})
