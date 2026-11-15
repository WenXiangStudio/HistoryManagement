// User-authorized connectivity check: one bounded synthetic request using the active APP profile.
// Read-only access to daily settings; decrypted credentials remain in memory.
const {app,safeStorage}=require('electron')
const {DatabaseSync}=require('node:sqlite')
const {mkdirSync,copyFileSync,existsSync,writeFileSync}=require('node:fs')
const {join,resolve}=require('node:path')
const readActiveCloudConfig=require('./read-active-cloud-config.cjs')
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const out=resolve('local-data/siliconflow-deepseek-connection-20261012')
const isolated=join(out,'isolated-profile')
mkdirSync(isolated,{recursive:true})
if(existsSync(join(source,'Local State')))copyFileSync(join(source,'Local State'),join(isolated,'Local State'))
app.setPath('userData',isolated)
app.disableHardwareAcceleration()
let key=''
const redact=value=>String(value).split(key||'__no_key__').join('[REDACTED]')
  .replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')
const serialize=value=>JSON.stringify(value,(_,v)=>typeof v==='string'?redact(v):v,2)
app.whenReady().then(async()=>{
  const report={checkedAt:new Date().toISOString(),syntheticInput:true,requestCount:0,imageCount:0,
    audioUploaded:false,videoUploaded:false,localModelsUsed:false,settingsMutated:false}
  try{
    if(existsSync(join(out,'request-started.json')))throw Error('PROBE_ALREADY_ATTEMPTED_INSPECT_EVIDENCE')
    const db=new DatabaseSync(join(source,'signal-desk.sqlite'),{readOnly:true})
    let selected
    try{
      const state=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get().value_json)
      selected=state.profiles.find(p=>p.id===state.activeId)
      if(selected?.provider!=='siliconflow'||selected.providerSlot!==3||selected.settings.textModel!=='deepseek-ai/DeepSeek-V4-Flash')
        throw Error('EXPECTED_ACTIVE_SILICONFLOW_DEEPSEEK_PROFILE_UNAVAILABLE')
    }finally{db.close()}
    const active=readActiveCloudConfig(source,safeStorage)
    key=active.key
    if(active.profileId!==selected.id||active.settings.textModel!==selected.settings.textModel||
      active.settings.textBaseUrl!=='https://api.siliconflow.cn/v1'||active.settings.textApiProtocol!=='chat-completions')
      throw Error('ACTIVE_SETTINGS_DO_NOT_MATCH_SAVED_DEEPSEEK_PROFILE')
    const endpoint=active.settings.textBaseUrl+'/chat/completions'
    const expectedReply='SF-DEEPSEEK-CONNECT-7319'
    const body={model:active.settings.textModel,messages:[{role:'user',content:'Reply with exactly '+expectedReply+'. No explanation.'}],
      stream:false,max_tokens:256,enable_thinking:false}
    Object.assign(report,{profileId:active.profileId,profileName:selected.name,providerSlot:3,
      requestedModel:body.model,protocol:active.settings.textApiProtocol,endpoint,
      expectedReply,maxOutputTokens:body.max_tokens,requestedThinking:false,credentialsReadable:true})
    writeFileSync(join(out,'request-started.json'),serialize({at:new Date().toISOString(),profileId:active.profileId,endpoint,body,maxRequests:1}),{flag:'wx'})
    const start=performance.now()
    report.requestCount=1
    try{
      const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+key},
        body:JSON.stringify(body),signal:AbortSignal.timeout(90000)})
      report.httpStatus=response.status
      report.headersMs=Math.round(performance.now()-start)
      report.contentType=response.headers.get('content-type')
      const raw=await response.text()
      writeFileSync(join(out,'response.json'),redact(raw),{flag:'wx'})
      let payload
      try{payload=JSON.parse(raw)}catch{throw Error('NON_JSON_RESPONSE')}
      const choice=payload.choices?.[0]
      Object.assign(report,{responseId:payload.id,returnedModel:payload.model,finishReason:choice?.finish_reason,
        reply:choice?.message?.content,usage:payload.usage,
        ok:response.ok&&choice?.finish_reason==='stop'&&choice.message.content?.trim()===expectedReply})
      if(!response.ok)report.error=payload.error||payload
    }finally{report.requestElapsedMs=Math.round(performance.now()-start)}
  }catch(error){report.ok=false;report.error={message:error.message,networkCode:error.cause?.code}}
  const output=serialize(report)
  writeFileSync(join(out,report.requestCount?'connection-report.json':'preflight-report.json'),output,{flag:'wx'})
  console.log(output)
  key=''
  app.exit(report.ok?0:1)
}).catch(()=>{console.error('PROBE_INITIALIZATION_FAILED');app.exit(1)})
