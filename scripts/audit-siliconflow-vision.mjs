import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const mode=process.argv[2]||'status',out=resolve('local-data/siliconflow-vision-20261012'),userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview'),workId='7694535682575860393'
mkdirSync(out,{recursive:true});const hash=v=>createHash('sha256').update(v).digest('hex')
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)
const bridge=JSON.parse(readFileSync(join(userData,'following-bridge.json'),'utf8')),origin=new URL(bridge.origin)
if(!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Local bridge expected')
const raw=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
const status={phase:raw.phase,activity:raw.activity?.phase,basic:raw.basic?.phase,video:raw.videoInformation?.phase,online:raw.connection?.online,readiness:raw.readiness?.phase}
if(Object.values(status).includes('running'))throw Error('APP collection busy')
const report={at:new Date().toISOString(),status,databases:[],profiles:[],credentials:{},runtimeHash:hash(readFileSync(join(userData,'video-content','runtime.json'))),appAsarSha256:hash(readFileSync('release-following-background-final/win-unpacked/resources/app.asar'))}
let stageRows=[],batches=[],active
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(userData,name),{readOnly:true})
  try{
    const summary={},tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name)
    for(const table of tables){
      const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      if(table==='video_content_stages'){stageRows=rows;continue}
      if(table==='video_content_batches'){batches=rows;if(rows.some(r=>['running','queued'].includes(r.state)))throw Error('Content batch busy');continue}
      const retained=rows.filter(r=>table!=='app_settings'||!['settings','cloud-profiles'].includes(r.key))
      summary[table]={count:retained.length,sha256:hash(retained.map(stable).sort().join('\n'))}
    }
    if(name==='signal-desk.sqlite'){
      const cloud=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get().value_json)
      active=cloud.profiles.find(p=>p.id===cloud.activeId)
      report.profiles=cloud.profiles.map(p=>({id:p.id,name:p.name,model:p.settings.textModel,sha256:hash(stable(p))}))
      report.activeModel=active.settings.textModel
      const settings=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='settings'").get().value_json)
      report.localPreferences=Object.fromEntries(['asrModel','cacheLimitGb','retentionHours','interests'].map(k=>[k,settings[k]]))
      if(db.prepare("SELECT 1 FROM analysis_batches WHERE state='running' LIMIT 1").get())throw Error('Analysis busy')
    }
    report.databases.push({name,tables:summary,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length})
    if(mode==='before'){const target=join(out,'before',name);if(existsSync(target))throw Error('Backup exists');mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)}
  }finally{db.close()}
}
report.credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).sort().map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
report.stages=stageRows.map(r=>({id:r.id,sha256:hash(stable(r))}));report.batches=batches.map(r=>({id:r.id,sha256:hash(stable(r))}))
if(mode==='before'){
  cpSync(join(userData,'credentials'),join(out,'before','credentials'),{recursive:true,errorOnExist:true,force:false})
  for(const f of ['Local State','following-settings.json'])copyFileSync(join(userData,f),join(out,'before',f))
  copyFileSync('release-following-background-final/win-unpacked/resources/app.asar',join(out,'before','app.asar'))
  copyFileSync('release-following-background-final/win-unpacked/Signal Desk.exe',join(out,'before','Signal Desk.exe'))
  writeFileSync(join(out,'before.json'),JSON.stringify(report,null,2))
}else if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  const additions=stageRows.filter(r=>!before.stages.some(s=>s.id===r.id))
  const newBatches=batches.filter(r=>!before.batches.some(b=>b.id===r.id)).map(r=>JSON.parse(r.payload_json))
  report.retention={otherTablesUnchanged:stable(report.databases)===stable(before.databases),credentialsUnchanged:stable(report.credentials)===stable(before.credentials),
    profilesUnchanged:stable(report.profiles)===stable(before.profiles),runtimeUnchanged:report.runtimeHash===before.runtimeHash,localPreferencesUnchanged:stable(report.localPreferences)===stable(before.localPreferences),
    historicalStagesUnchanged:before.stages.every(s=>report.stages.some(n=>n.id===s.id&&n.sha256===s.sha256)),historicalBatchesUnchanged:before.batches.every(b=>report.batches.some(n=>n.id===b.id&&n.sha256===b.sha256)),
    onlySpecifiedVisualAdded:additions.every(r=>r.work_id===workId&&r.stage==='visual'),onlySpecifiedCloudBatchAdded:newBatches.every(b=>b.provider==='cloud-frames'&&b.workIds.length===1&&b.workIds[0]===workId)}
  report.addedStages=additions.map(r=>({id:r.id,stage:r.stage,state:r.state}));report.newBatches=newBatches.map(b=>({id:b.id,state:b.state,model:b.modelVersion,displayedTotalMs:b.displayedTotalMs}))
  writeFileSync(join(out,'after.json'),JSON.stringify(report,null,2))
  if(Object.values(report.retention).some(v=>!v))throw Error('Unexpected data mutation')
}
console.log(JSON.stringify({mode,status,activeModel:report.activeModel,retention:report.retention,addedStages:report.addedStages,newBatches:report.newBatches}))
