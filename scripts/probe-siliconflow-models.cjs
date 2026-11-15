// Explicitly authorized two-model connectivity test. No real video, local models or settings writes.
const {app,safeStorage}=require('electron')
const {DatabaseSync}=require('node:sqlite')
const {mkdirSync,copyFileSync,existsSync,readFileSync,writeFileSync}=require('node:fs')
const {join,resolve}=require('node:path')
const {deflateSync}=require('node:zlib')
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview'),out=resolve('local-data/siliconflow-vision-20261012')
const profile=join(out,'probe-profile');mkdirSync(profile,{recursive:true})
if(existsSync(join(source,'Local State')))copyFileSync(join(source,'Local State'),join(profile,'Local State'))
app.setPath('userData',profile);app.disableHardwareAcceleration()
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([size,t,data,crc])}
function redImage(){const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=2
  const rows=Buffer.alloc(128*(128*3+1));for(let y=0;y<128;y++)for(let x=0;x<128;x++)rows[y*385+1+x*3]=255
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
app.whenReady().then(async()=>{
  const marker=join(out,'connection-started.json')
  if(existsSync(marker))throw Error('Probe already attempted; inspect evidence before another request')
  const db=new DatabaseSync(join(source,'signal-desk.sqlite'),{readOnly:true})
  const state=JSON.parse(db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('cloud-profiles').value_json);db.close()
  const expected=['zai-org/GLM-5.3-Flash','Qwen/Qwen3.5-4B']
  const selected=expected.map(model=>state.profiles.find(p=>p.provider==='siliconflow'&&p.settings.textModel===model))
  if(selected.some(p=>!p||p.settings.textBaseUrl!=='https://api.siliconflow.cn/v1'||!p.credentials.text))throw Error('Expected saved SiliconFlow models unavailable')
  writeFileSync(marker,JSON.stringify({at:new Date().toISOString(),models:expected,maxRequests:2}))
  const reports=[]
  for(const p of selected){
    let key='',report={at:new Date().toISOString(),requestedModel:p.settings.textModel,requestCount:0,synthetic:true}
    const started=performance.now()
    try{
      if(!/^[a-f0-9-]{36}$/.test(p.credentials.text))throw Error('Credential reference invalid')
      key=safeStorage.decryptString(readFileSync(join(source,'credentials',`cloud-profile-${p.credentials.text}.bin`)))
      const imageTest=p.settings.textModel==='Qwen/Qwen3.5-4B',expectedReply=imageTest?'RED':'SF-CONNECT-7319'
      const content=imageTest?[{type:'text',text:'Identify the dominant color of this image. Reply with only the uppercase English color name.'},
        {type:'image_url',image_url:{url:'data:image/png;base64,'+redImage().toString('base64')}}]:'Reply with exactly SF-CONNECT-7319. No explanation.'
      const body={model:p.settings.textModel,messages:[{role:'user',content}],stream:false,temperature:0,max_tokens:128,enable_thinking:false}
      report.imageCount=imageTest?1:0;report.requestCount=1
      const response=await fetch('https://api.siliconflow.cn/v1/chat/completions',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)})
      const raw=await response.text(),payload=JSON.parse(raw),choice=payload.choices?.[0]
      report={...report,httpStatus:response.status,responseId:payload.id,returnedModel:payload.model,finishReason:choice?.finish_reason,
        reply:choice?.message?.content,usage:payload.usage,ok:response.ok&&choice?.finish_reason==='stop'&&choice.message.content?.trim()===expectedReply,
        ...(response.ok?{}:{error:payload.error||payload})}
      writeFileSync(join(out,`connection-${imageTest?'qwen':'glm'}-response.json`),raw.split(key).join('[REDACTED]'))
    }catch(error){report.ok=false;report.error={message:String(error.message).split(key||'__no_key__').join('[REDACTED]'),networkCode:error.cause?.code}}
    report.elapsedMs=Math.round(performance.now()-started);reports.push(report);key=''
    writeFileSync(join(out,'connection-report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(report))
  }
  app.exit(reports.every(r=>r.ok)?0:1)
}).catch(error=>{console.error(error.message);app.exit(1)})
