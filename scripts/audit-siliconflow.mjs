// Read-only data audit and in-workspace backup; never decrypts credentials or calls model APIs.
import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const mode=process.argv[2]||'status',out=resolve('local-data/siliconflow-integration-20261012'),userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
mkdirSync(out,{recursive:true})
const hash=value=>createHash('sha256').update(value).digest('hex')
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
const bridge=JSON.parse(readFileSync(join(userData,'following-bridge.json'),'utf8')),origin=new URL(bridge.origin)
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Not local APP bridge')
const raw=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
const status={phase:raw.phase,basic:raw.basic?.phase,activity:raw.activity?.phase,video:raw.videoInformation?.phase,online:raw.connection?.online,readiness:raw.readiness?.phase}
if(Object.values(status).includes('running'))throw Error('APP collection is busy')
const databases=[];let cloud,trial
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(userData,name),{readOnly:true})
  try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),summary={}
    for(const table of tables){
      const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      summary[table]={count:rows.filter(r=>table!=='app_settings'||r.key!=='cloud-profiles').length,
        sha256:hash(rows.filter(r=>table!=='app_settings'||r.key!=='cloud-profiles').map(stable).sort().join('\n'))}
    }
    if(tables.includes('video_content_batches')&&db.prepare("SELECT 1 FROM video_content_batches WHERE state IN ('running','queued') LIMIT 1").get())throw Error('Video batch is busy')
    if(tables.includes('analysis_batches')&&db.prepare("SELECT 1 FROM analysis_batches WHERE state='running' LIMIT 1").get())throw Error('Analysis is busy')
    if(name==='signal-desk.sqlite'){
      cloud=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get().value_json)
      trial=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='doubao-speech-flash-trial'").get().value_json)
      if(['running','preparing'].includes(trial.state))throw Error('Speech is busy')
    }
    databases.push({name,tables:summary,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length})
    if(mode==='before'){
      const target=join(out,'before',name);if(existsSync(target))throw Error('Backup already exists; preserve it')
      mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)
    }
  }finally{db.close()}
}
const credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).sort().map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
const report={at:new Date().toISOString(),status,databases,credentials,cloud:{activeId:cloud.activeId,profiles:cloud.profiles.map(p=>({id:p.id,name:p.name,provider:p.provider,model:p.settings.textModel,
  sha256:hash(stable(p)),emptySilicon:p.provider==='siliconflow'&&!p.settings.textModel&&!p.settings.visionModel&&!p.credentials.text&&!p.credentials.vision}))},doubaoState:trial.state,
  appAsarSha256:hash(readFileSync('release-following-background-final/win-unpacked/resources/app.asar'))}
if(mode==='before'){
  cpSync(join(userData,'credentials'),join(out,'before','credentials'),{recursive:true,errorOnExist:true,force:false})
  for(const f of ['following-settings.json','Local State'])copyFileSync(join(userData,f),join(out,'before',f))
  copyFileSync('release-following-background-final/win-unpacked/resources/app.asar',join(out,'before','app.asar'))
  copyFileSync('release-following-background-final/win-unpacked/Signal Desk.exe',join(out,'before','Signal Desk.exe'))
  writeFileSync(join(out,'before.json'),JSON.stringify(report,null,2))
}else if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  const old=before.cloud.profiles
  report.retention={tablesUnchangedExceptCloudProfiles:stable(before.databases)===stable(databases),credentialsUnchanged:stable(before.credentials)===stable(credentials),
    oldProfilesUnchanged:old.every(p=>report.cloud.profiles.some(n=>n.id===p.id&&n.sha256===p.sha256)),activeProfileUnchanged:before.cloud.activeId===cloud.activeId,
    onlyTwoEmptySiliconProfilesAdded:report.cloud.profiles.filter(p=>!old.some(o=>o.id===p.id)).length===2&&report.cloud.profiles.filter(p=>!old.some(o=>o.id===p.id)).every(p=>p.emptySilicon)}
  writeFileSync(join(out,'after.json'),JSON.stringify(report,null,2))
  if(Object.values(report.retention).some(v=>!v))throw Error('Unexpected data changes; inspect local audit')
}
console.log(JSON.stringify({mode,status,tableCount:databases.reduce((n,d)=>n+Object.keys(d.tables).length,0),doubaoState:trial.state,profiles:report.cloud.profiles.map(p=>({name:p.name,model:p.model})),retention:report.retention}))
