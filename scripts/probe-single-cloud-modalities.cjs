// Explicit, isolated experiment. Uses only the saved model and saved Responses route.
const {app,safeStorage}=require('electron')
const readActiveCloudConfig=require('./read-active-cloud-config.cjs')
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const out=path.resolve('local-data/single-cloud-video-20261011')
const source=path.join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const profile=path.join(out,'isolated-profile');fs.mkdirSync(profile,{recursive:true})
fs.copyFileSync(path.join(source,'Local State'),path.join(profile,'Local State'))
app.setPath('userData',profile);app.disableHardwareAcceleration()
let key=''
const redact=s=>String(s).split(key||'__NO_SECRET__').join('[REDACTED]').replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [REDACTED]')
const save=(name,data)=>fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(data,(_,v)=>typeof v==='string'?redact(v):v,2))
app.whenReady().then(async()=>{
 try{
  const active=readActiveCloudConfig(source,safeStorage),settings=active.settings
  key=active.key
  if(settings.textApiProtocol!=='responses')throw Error('Saved protocol changed')
  const base=new URL(settings.textBaseUrl)
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Invalid configured URL')
  const manifest=JSON.parse(fs.readFileSync(path.join(out,process.argv[2]||'probe-manifest.json'),'utf8'))
  for(const probe of manifest.probes){
   const parts=[],inputs=[]
   for(const attachment of probe.attachments){
    const full=path.resolve(out,attachment.path)
    if(!full.startsWith(out+path.sep))throw Error('Invalid input path')
    const data=fs.readFileSync(full),b64=data.toString('base64')
    inputs.push({...attachment,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')})
    if(attachment.label)parts.push({type:'input_text',text:attachment.label})
    if(attachment.type==='input_image')parts.push({type:'input_image',image_url:'data:'+attachment.mime+';base64,'+b64,detail:'high'})
    else if(attachment.type==='input_audio')parts.push({type:'input_audio',input_audio:{data:b64,format:attachment.format}})
    else if(attachment.type==='input_file')parts.push({type:'input_file',filename:path.basename(full),file_data:'data:'+attachment.mime+';base64,'+b64})
    else if(attachment.type==='input_video')parts.push({type:'input_video',video_url:'data:'+attachment.mime+';base64,'+b64})
    else throw Error('Unsupported probe type')
   }
   parts.push({type:'input_text',text:probe.prompt})
   const body={model:settings.textModel,instructions:'按开发者消息要求完成媒体能力验证，只返回JSON对象。',store:false,stream:true,
    input:[{role:'developer',content:[{type:'input_text',text:probe.instructions}]},{role:'user',content:parts}],text:{format:{type:'json_object'}}}
   const start=performance.now(),report={name:probe.name,startedAt:new Date().toISOString(),requestedModel:settings.textModel,protocol:'responses',endpointPath:base.pathname.replace(/\/$/,'')+'/responses',inputs,prompt:probe.prompt,instructions:probe.instructions,otherAiModelsUsed:false}
   console.log(JSON.stringify({event:'start',name:probe.name,attachments:inputs.length,bytes:inputs.reduce((n,i)=>n+i.bytes,0)}))
   try{
    const r=await fetch(settings.textBaseUrl.replace(/\/+$/,'')+'/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(150000),redirect:'error'})
    report.httpStatus=r.status;report.headersMs=Math.round(performance.now()-start)
    const raw=await r.text();if(raw.length>4*1024*1024)throw Error('Response too large')
    if(!r.ok){try{const d=JSON.parse(raw);report.error=d.error||d}catch{report.error=raw.slice(0,1800)}}
    else if(r.headers.get('content-type')?.includes('application/json')){const d=JSON.parse(raw);report.response=d}
    else{
     report.events=[];let text=''
     for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;const s=line.slice(5).trim();if(!s||s==='[DONE]')continue
      const e=JSON.parse(s);if(!report.events.includes(e.type))report.events.push(e.type)
      if(e.type==='response.output_text.delta')text+=e.delta||''
      if(e.type==='response.completed')report.response=e.response
      if(e.type==='error'||e.type==='response.failed'||e.type==='response.incomplete')report.error=e
     }
     report.streamedText=text
    }
    report.completed=report.response?.status==='completed'
    report.reply=(report.response?.output||[]).flatMap(x=>x.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('')||report.streamedText||''
    report.returnedModel=report.response?.model;report.usage=report.response?.usage
    delete report.response;delete report.streamedText
   }catch(e){report.error={message:e.message,networkCode:e.cause?.code}}
   report.elapsedMs=Math.round(performance.now()-start);save(probe.name,report)
   console.log(JSON.stringify(report,(_,v)=>typeof v==='string'?redact(v):v))
  }
  key='';app.exit(0)
 }catch(e){console.error(redact(e.message));key='';app.exit(1)}
})
