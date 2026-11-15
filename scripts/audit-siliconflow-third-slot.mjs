// Backup and audit only. No secret decryption and no provider requests.
import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const mode=process.argv[2]||'status',out=resolve('local-data/siliconflow-third-slot-20261012'),userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
if(!['before','after','status'].includes(mode))throw Error('Unsupported mode')
mkdirSync(out,{recursive:true})
const hash=v=>createHash('sha256').update(v).digest('hex')
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)
const bridge=JSON.parse(readFileSync(join(userData,'following-bridge.json'),'utf8')),origin=new URL(bridge.origin)
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Expected local APP')
const raw=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
const status={phase:raw.phase,activity:raw.activity?.phase,basic:raw.basic?.phase,video:raw.videoInformation?.phase,online:raw.connection?.online,readiness:raw.readiness?.phase}
if(Object.values(status).includes('running'))throw Error('APP collection busy')
const report={at:new Date().toISOString(),status,databases:[],profiles:[],credentials:{},activeId:null,runtimeHash:hash(readFileSync(join(userData,'video-content','runtime.json'))),appAsarSha256:hash(readFileSync('release-following-background-final/win-unpacked/resources/app.asar'))}
let cloud
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(userData,name),{readOnly:true})
  try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),summary={}
    for(const table of tables){
      const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      if(table==='video_content_batches'&&rows.some(r=>['running','queued'].includes(r.state)))throw Error('Video task busy')
      if(table==='analysis_batches'&&rows.some(r=>r.state==='running'))throw Error('Analysis busy')
      const retained=rows.filter(r=>table!=='app_settings'||r.key!=='cloud-profiles')
      summary[table]={count:retained.length,sha256:hash(retained.map(stable).sort().join('\n'))}
    }
    if(name==='signal-desk.sqlite'){
      cloud=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get().value_json)
      report.activeId=cloud.activeId
      report.profiles=cloud.profiles.map(p=>({id:p.id,name:p.name,model:p.settings.textModel,provider:p.provider,slot:p.providerSlot,sha256:hash(stable(p))}))
      const trial=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='doubao-speech-flash-trial'").get().value_json)
      if(['running','preparing'].includes(trial.state))throw Error('Speech busy')
    }
    report.databases.push({name,tables:summary,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length})
    if(mode==='before'){
      const target=join(out,'before',name);if(existsSync(target))throw Error('Existing backup must be preserved')
      mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)
    }
  }finally{db.close()}
}
report.credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).sort().map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
if(mode==='before'){
  if(cloud.profiles.some(p=>p.provider==='siliconflow'&&p.providerSlot===3))throw Error('Third slot already exists')
  cpSync(join(userData,'credentials'),join(out,'before','credentials'),{recursive:true,errorOnExist:true,force:false})
  for(const f of ['Local State','following-settings.json'])copyFileSync(join(userData,f),join(out,'before',f))
  copyFileSync('release-following-background-final/win-unpacked/resources/app.asar',join(out,'before','app.asar'))
  copyFileSync('release-following-background-final/win-unpacked/Signal Desk.exe',join(out,'before','Signal Desk.exe'))
  writeFileSync(join(out,'before.json'),JSON.stringify(report,null,2))
}else if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  const added=cloud.profiles.filter(p=>!before.profiles.some(o=>o.id===p.id)),third=added[0]
  report.retention={otherTableRowsUnchanged:stable(report.databases)===stable(before.databases),encryptedCredentialsUnchanged:stable(report.credentials)===stable(before.credentials),
    oldProfilesUnchanged:before.profiles.every(p=>report.profiles.some(n=>n.id===p.id&&n.sha256===p.sha256)),activeProfileUnchanged:before.activeId===report.activeId,
    localRuntimeUnchanged:before.runtimeHash===report.runtimeHash,onlyBlankThirdSlotAdded:added.length===1&&third.provider==='siliconflow'&&third.providerSlot===3&&!third.settings.textModel&&!third.settings.visionModel,
    existingSiliconKeyReused:!!third?.credentials.text&&cloud.profiles.some(p=>p.provider==='siliconflow'&&p.providerSlot!==3&&p.credentials.text===third.credentials.text)}
  writeFileSync(join(out,'after.json'),JSON.stringify(report,null,2))
  if(Object.values(report.retention).some(v=>!v))throw Error('Unexpected data changes')
}
console.log(JSON.stringify({mode,status,profiles:report.profiles.map(p=>({name:p.name,model:p.model,slot:p.slot})),retention:report.retention}))
