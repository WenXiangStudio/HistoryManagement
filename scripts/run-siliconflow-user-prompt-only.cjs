// User-authorized redo: one user message containing only the original transcript and verbatim user prompt.
// The daily APP is read-only. No media, retrieval, local inference, active-profile switch or retries.
const {app,safeStorage}=require('electron')
const {DatabaseSync}=require('node:sqlite')
const {createHash}=require('node:crypto')
const {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,copyFileSync,readdirSync}=require('node:fs')
const {join,resolve}=require('node:path')
const originalFs=require('original-fs')
const runStart=performance.now(),startedAt=new Date().toISOString()
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const out=resolve('local-data/siliconflow-text-user-prompt-only-20261012')
const expectedTextHash='316798ba2ceeccd1901a7f2963c78a2dc1b26da810942c3be2c5bd4fbb95c5f3'
const expectedModels=[{slot:1,slug:'glm',model:'zai-org/GLM-5.3-Flash'},{slot:3,slug:'deepseek',model:'deepseek-ai/DeepSeek-V4-Flash'}]
const requestedModels=expectedModels
const hash=value=>createHash('sha256').update(value).digest('hex')
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
const isolated=join(out,'isolated-profile')
mkdirSync(isolated,{recursive:true})
if(existsSync(join(source,'Local State')))copyFileSync(join(source,'Local State'),join(isolated,'Local State'))
app.setPath('userData',isolated)
app.disableHardwareAcceleration()
let keys=[]
function redact(value){let text=String(value);for(const key of keys)if(key)text=text.split(key).join('[REDACTED]');return text.replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')}
const serialized=value=>JSON.stringify(value,(_,v)=>typeof v==='string'?redact(v):v,2)
const save=(name,value)=>writeFileSync(join(out,name),serialized(value),{flag:'wx'})
function event(type,detail={}){const value={at:new Date().toISOString(),sinceRunStartMs:Math.round(performance.now()-runStart),type,...detail};appendFileSync(join(out,'timeline.jsonl'),serialized(value).replace(/\n\s*/g,'')+'\n');console.log(JSON.stringify(value))}
function audit(){
  const result={at:new Date().toISOString(),databases:[],credentials:{},runtimeHash:hash(readFileSync(join(source,'video-content','runtime.json'))),
    appAsarSha256:hash(originalFs.readFileSync(resolve('release-following-background-final/win-unpacked/resources/app.asar')))}
  for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
    const db=new DatabaseSync(join(source,name),{readOnly:true})
    try{
      db.exec('BEGIN')
      const tables={}
      for(const {name:table} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
        const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
        if(table==='video_content_batches'&&rows.some(r=>['running','queued'].includes(r.state)))throw Error('DAILY_APP_CONTENT_BUSY')
        if(table==='analysis_batches'&&rows.some(r=>r.state==='running'))throw Error('DAILY_APP_ANALYSIS_BUSY')
        tables[table]={count:rows.length,sha256:hash(rows.map(stable).sort().join('\n'))}
      }
      if(name==='signal-desk.sqlite'){
        const row=db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get()
        const state=JSON.parse(row.value_json)
        result.activeId=state.activeId
        result.activeModel=state.profiles.find(p=>p.id===state.activeId)?.settings.textModel
        const trial=db.prepare("SELECT value_json FROM app_settings WHERE key='doubao-speech-flash-trial'").get()
        if(trial&&['running','preparing'].includes(JSON.parse(trial.value_json).state))throw Error('DAILY_APP_SPEECH_BUSY')
      }
      result.databases.push({name,tables,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,
        foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length})
    }finally{db.close()}
  }
  result.credentials=Object.fromEntries(readdirSync(join(source,'credentials')).sort().map(name=>[name,hash(readFileSync(join(source,'credentials',name)))]))
  return result
}
async function appStatus(){
  const bridge=JSON.parse(readFileSync(join(source,'following-bridge.json'),'utf8')),origin=new URL(bridge.origin)
  if(!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('EXPECTED_LOCAL_APP_BRIDGE')
  const response=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)})
  if(!response.ok)throw Error('APP_STATUS_UNAVAILABLE')
  const raw=await response.json(),status={phase:raw.phase,activity:raw.activity?.phase,basic:raw.basic?.phase,
    video:raw.videoInformation?.phase,online:raw.connection?.online,readiness:raw.readiness?.phase}
  if(Object.values(status).includes('running'))throw Error('DAILY_APP_COLLECTION_BUSY')
  return status
}
// Verbatim task instructions from the user's original three-part request.
const userPrompt=[
  '严格参照以下格式处理转写文案：',
  ' - 对转写文案做内容的总结与概括 ；',
  ' — 对转写文案做分析，并展开文案内容的主要观点与原文依据；',
  ' - 根据文案内容和分析，推理推测此段文本内容涉及的领域、可能相关的事件；'
].join('\n')

app.whenReady().then(async()=>{
  const reports=[]
  let before,manifest
  try{
    if(existsSync(join(out,'run-started.json')))throw Error('COMPARISON_ALREADY_STARTED_INSPECT_RECORDS_DO_NOT_RESEND')
    save('run-started.json',{startedAt,maxRequests:2,models:expectedModels.map(x=>x.model)})
    event('run_started',{scope:'Original transcript plus verbatim user task prompt only'})
    const status=await appStatus()
    before=audit();save('before.json',{...before,status})
    const textBytes=readFileSync('docs/evidence/doubao-flash-20261012/transcript-original.txt'),text=textBytes.toString('utf8')
    if(hash(textBytes)!==expectedTextHash)throw Error('VERIFIED_TRANSCRIPT_HASH_CHANGED')
    const original=JSON.parse(readFileSync('docs/evidence/doubao-flash-20261012/response-original.json','utf8'))
    const transcriptPayload=typeof original.body==='string'?JSON.parse(original.body):original.body
    // The exact APP artifact filename is selected only when it matches the immutable verified bytes.
    const artifactDir=join(source,'speech-tests','doubao-flash','8bdba001-a1a0-461b-ba11-b752eca0d491')
    const candidates=readdirSync(artifactDir).filter(name=>name.endsWith('.txt'))
    const matching=candidates.find(name=>hash(readFileSync(join(artifactDir,name)))===expectedTextHash)
    if(transcriptPayload.result?.text!==text||!matching)throw Error('SOURCE_APP_AND_ORIGINAL_RESPONSE_MISMATCH')
    const review=JSON.parse(readFileSync('docs/evidence/doubao-flash-20261012/success-verification.json','utf8'))
    if(review.humanReview?.transcriptionAccuracyPercent!==100||review.transcriptSha256!==expectedTextHash)throw Error('HUMAN_REVIEW_SOURCE_UNAVAILABLE')
    const db=new DatabaseSync(join(source,'signal-desk.sqlite'),{readOnly:true})
    let profiles
    try{
      const state=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get().value_json)
      profiles=requestedModels.map(expected=>{
        const p=state.profiles.find(p=>p.provider==='siliconflow'&&p.providerSlot===expected.slot&&p.settings.textModel===expected.model)
        if(!p||p.settings.textBaseUrl!=='https://api.siliconflow.cn/v1'||p.settings.textApiProtocol!=='chat-completions'||!p.credentials.text||!/^[a-f0-9-]{36}$/.test(p.credentials.text))throw Error('EXPECTED_MODEL_PROFILE_UNAVAILABLE')
        return {...expected,profile:p}
      })
    }finally{db.close()}
    if(!safeStorage.isEncryptionAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE')
    keys=profiles.map(({profile})=>safeStorage.decryptString(readFileSync(join(source,'credentials',`cloud-profile-${profile.credentials.text}.bin`))))
    if(keys.some(key=>!key.trim()))throw Error('MODEL_KEY_UNAVAILABLE')
    const inputContent=text+'\n\n'+userPrompt
    const messages=[{role:'user',content:inputContent}]
    const parameters={stream:true,stream_options:{include_usage:true},temperature:0,max_tokens:16384,enable_thinking:false,thinking_budget:1024}
    if(messages.length!==1||messages[0].role!=='user'||messages[0].content!==text+'\n\n'+userPrompt)throw Error('INPUT_MUST_BE_ONLY_TRANSCRIPT_AND_USER_PROMPT')
    manifest={startedAt,workId:'7694535682575860393',title:'数学彻底怒openai了',author:'口罩哥研报60秒',
      source:{service:'豆包录音文件识别极速版',resource:'volc.bigasr.auc_turbo',requestId:'8bdba001-a1a0-461b-ba11-b752eca0d491',
        sha256:expectedTextHash,utf8Bytes:textBytes.length,characters:[...text].length,appArtifactName:matching,humanReview:review.humanReview},
      endpoint:'https://api.siliconflow.cn/v1/chat/completions',protocol:'chat-completions',expectedModels:requestedModels,
      messagesSha256:hash(JSON.stringify(messages)),inputSha256:hash(inputContent),userPromptSha256:hash(userPrompt),parameters,maxRequests:2,
      inputAudit:{messageCount:1,roles:['user'],systemMessages:0,developerMessages:0,assistantMessages:0,additionalInstructionCharacters:0,
        composition:'Exact verified transcript + two line feeds + exact user three-part task prompt',userPromptCharacters:[...userPrompt].length},
      order:'Sequential: GLM then DeepSeek',externalRetrieval:false,imageCount:0,audioCount:0,videoCount:0,
      localModelsUsed:false,activeProfileSwitch:false,automaticRetries:false,
      timingScope:'Independent experiment program start to both results saved; per-request time includes network and full response. No APP click-to-display timing.'}
    writeFileSync(join(out,'transcript-original.txt'),textBytes,{flag:'wx'})
    writeFileSync(join(out,'user-prompt.txt'),userPrompt,{flag:'wx'})
    writeFileSync(join(out,'input-exact.txt'),inputContent,{flag:'wx'})
    save('messages-exact.json',messages)
    save('manifest.json',manifest)
    event('preparation_complete',{sourceCharacters:manifest.source.characters,sourceSha256:expectedTextHash,messagesSha256:manifest.messagesSha256,models:expectedModels.map(x=>x.model)})
    for(let index=0;index<profiles.length;index++){
      const {slug,model,profile}=profiles[index],key=keys[index],body={model,...parameters,messages}
      const report={model,slug,profileId:profile.id,providerSlot:profile.providerSlot,sourceSha256:expectedTextHash,
        messagesSha256:manifest.messagesSha256,requestCount:0,stream:true,parameters,startedAt:new Date().toISOString(),
        usage:null,replyCharacters:0,reasoningCharacters:0,receivedBytes:0,streamDone:false,finishReason:null}
      const requestStart=performance.now()
      const decoder=new TextDecoder(),rawPath=join(out,slug+'-response.sse')
      let buffer='',content='',reasoning='',chunks=0
      const readFrame=frame=>{
        const payload=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
        if(!payload)return
        if(payload==='[DONE]'){report.streamDone=true;return}
        const item=JSON.parse(payload)
        if(item.error)throw Error(item.error.message||'PROVIDER_STREAM_ERROR')
        report.responseId=item.id||report.responseId
        report.returnedModel=item.model||report.returnedModel
        if(item.usage)report.usage=item.usage
        for(const choice of item.choices||[]){
          if(choice.index!==0)continue
          const delta=choice.delta||choice.message||{}
          if(typeof delta.content==='string'&&delta.content){
            if(report.firstContentMs===undefined){report.firstContentMs=Math.round(performance.now()-requestStart);event('first_content',{model,elapsedMs:report.firstContentMs})}
            content+=delta.content
          }
          if(typeof delta.reasoning_content==='string'&&delta.reasoning_content){
            if(report.firstReasoningMs===undefined){report.firstReasoningMs=Math.round(performance.now()-requestStart);event('first_reasoning',{model,elapsedMs:report.firstReasoningMs})}
            reasoning+=delta.reasoning_content
          }
          if(choice.finish_reason)report.finishReason=choice.finish_reason
        }
      }
      try{
        save(slug+'-request.json',{endpoint:manifest.endpoint,profileId:profile.id,body})
        save(slug+'-request-started.json',{at:report.startedAt,sourceSha256:expectedTextHash,maxRequests:1})
        writeFileSync(rawPath,'',{flag:'wx'})
        report.requestCount=1
        event('request_started',{model,maxOutputTokens:parameters.max_tokens})
        const response=await fetch(manifest.endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+key},
          body:JSON.stringify(body),signal:AbortSignal.timeout(180000)})
        report.httpStatus=response.status
        report.headersMs=Math.round(performance.now()-requestStart)
        report.responseHeaders=Object.fromEntries(['content-type','date','x-request-id','request-id','trace-id'].map(name=>[name,response.headers.get(name)]).filter(([,value])=>value!==null))
        event('response_headers',{model,httpStatus:response.status,elapsedMs:report.headersMs})
        const sse=response.headers.get('content-type')?.includes('text/event-stream')
        for await(const bytes of response.body){
          chunks++;report.receivedBytes+=bytes.length
          if(report.receivedBytes>12*1024*1024)throw Error('RESPONSE_BUDGET_EXCEEDED')
          const text=decoder.decode(bytes,{stream:true})
          appendFileSync(rawPath,redact(text))
          event('response_chunk',{model,chunk:chunks,bytes:bytes.length,elapsedMs:Math.round(performance.now()-requestStart)})
          buffer+=text
          if(sse){
            const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop()||''
            for(const frame of frames)readFrame(frame)
          }
        }
        const tail=decoder.decode();if(tail){appendFileSync(rawPath,redact(tail));buffer+=tail}
        if(sse){if(buffer.trim())readFrame(buffer)}
        else{
          const payload=JSON.parse(buffer)
          if(!response.ok){report.providerError=payload.error||payload;throw Error('HTTP_'+response.status)}
          const choice=payload.choices?.[0]
          content=choice?.message?.content||'';reasoning=choice?.message?.reasoning_content||''
          report.finishReason=choice?.finish_reason;report.responseId=payload.id;report.returnedModel=payload.model;report.usage=payload.usage||null
        }
        if(!response.ok)throw Error('HTTP_'+response.status)
        report.requestCompletedAt=new Date().toISOString()
        report.complete=report.finishReason==='stop'&&(sse?report.streamDone:true)&&report.returnedModel===model&&content.length>0
        if(!report.complete)report.error={message:'Response incomplete, truncated, empty, or model identifier mismatch; no retry was sent.'}
      }catch(error){report.complete=false;report.error={message:redact(error.message),networkCode:error.cause?.code};event('request_failed',{model,message:redact(error.message)})}
      report.requestElapsedMs=Math.round(performance.now()-requestStart)
      const saveStart=performance.now()
      report.replyCharacters=[...content].length;report.reasoningCharacters=[...reasoning].length
      report.replySha256=hash(content);report.reasoningSha256=hash(reasoning)
      writeFileSync(join(out,slug+'-output.txt'),redact(content),{flag:'wx'})
      writeFileSync(join(out,slug+'-reasoning.txt'),redact(reasoning),{flag:'wx'})
      report.resultsSavedAt=new Date().toISOString()
      report.resultSaveMs=Math.round(performance.now()-saveStart)
      report.requestToResultSavedMs=Math.round(performance.now()-requestStart)
      save(slug+'-report.json',report)
      reports.push(report)
      event('model_result_saved',{model,complete:report.complete,requestElapsedMs:report.requestElapsedMs,replyCharacters:report.replyCharacters,
        reasoningCharacters:report.reasoningCharacters,usage:report.usage})
    }
    const after=audit();save('after.json',after)
    const retention={databaseRowsUnchanged:stable(before.databases)===stable(after.databases),
      encryptedCredentialsUnchanged:stable(before.credentials)===stable(after.credentials),activeProfileUnchanged:before.activeId===after.activeId,
      localRuntimeUnchanged:before.runtimeHash===after.runtimeHash,appPackageUnchanged:before.appAsarSha256===after.appAsarSha256}
    const comparison={startedAt,completedAt:new Date().toISOString(),source:manifest.source,
      messagesSha256:manifest.messagesSha256,totalRequestCount:reports.reduce((n,r)=>n+r.requestCount,0),reports,retention,
      executionElapsedMs:Math.round(performance.now()-runStart),timingScope:manifest.timingScope,
      bothComplete:reports.length===2&&reports.every(r=>r.complete),requestedModelsComplete:reports.length===requestedModels.length&&reports.every(r=>r.complete),appStatus:await appStatus()}
    save('comparison.json',comparison)
    event('comparison_saved',{bothComplete:comparison.bothComplete,totalRequestCount:comparison.totalRequestCount,
      executionElapsedMs:comparison.executionElapsedMs,retention})
    keys=[]
    app.exit(comparison.requestedModelsComplete&&Object.values(retention).every(Boolean)?0:1)
  }catch(error){
    const failure={at:new Date().toISOString(),error:redact(error.message),requestCount:reports.reduce((n,r)=>n+r.requestCount,0),partialReports:reports}
    save('run-failure.json',failure);event('run_failed',{message:failure.error});keys=[];app.exit(1)
  }
}).catch(()=>{console.error('COMPARISON_INITIALIZATION_FAILED');app.exit(1)})
