// Local backup/audit only. Never decrypt credentials or issue a speech request.
import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const evidenceName=process.argv[3]||'doubao-flash-integration-20261012'
if(!/^doubao-flash-[a-z0-9-]{1,90}$/.test(evidenceName))throw Error('Invalid local evidence directory')
const out=resolve('local-data',evidenceName),mode=process.argv[2]||'status'
mkdirSync(out,{recursive:true})
const hash=v=>createHash('sha256').update(v).digest('hex')
const bridge=JSON.parse(readFileSync(join(userData,'following-bridge.json'),'utf8'))
const endpoint=new URL(bridge.origin)
if(!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('Unexpected local bridge origin')
const state=await fetch(new URL('/status',endpoint),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
const status={phase:state.phase,basic:state.basic?.phase,activity:state.activity?.phase,videoInformation:state.videoInformation?.phase,
  online:state.connection?.online,readiness:state.readiness?.phase}
if(Object.values(status).includes('running'))throw Error('APP is busy')
const snapshots=[]
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(userData,name),{readOnly:true})
  try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name)
    const rows={}
    for(const table of tables){
      const records=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      // The one new trial row is the intended mutation; every other row must be preserved.
      const original=table==='app_settings'?records.filter(r=>r.key!=='doubao-speech-flash-trial'):records
      rows[table]={count:original.length,sha256:hash(original.map(r=>JSON.stringify(r)).sort().join('\n'))}
    }
    if(tables.includes('video_content_batches')&&db.prepare("SELECT 1 FROM video_content_batches WHERE state IN ('running','queued') LIMIT 1").get())throw Error('Content batch is busy')
    if(tables.includes('analysis_batches')&&db.prepare("SELECT 1 FROM analysis_batches WHERE state='running' LIMIT 1").get())throw Error('Analysis is busy')
    snapshots.push({name,tables:rows,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length})
    if(mode==='before'){
      const target=join(out,'before',name);if(existsSync(target))throw Error('Do not overwrite an existing backup')
      mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)
    }
  }finally{db.close()}
}
const credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).sort().map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
const audio=readFileSync(join(userData,'speech-tests','math-openai','math-openai-77s.mp3'))
if(hash(audio)!=='85579d548c8c457f4689c1632f4d58980631f91ed6294eb809088b6850e4bc48')throw Error('Specified audio hash changed')
const asar=resolve('release-following-background-final/win-unpacked/resources/app.asar')
const historyRoot=join(userData,'speech-tests','doubao-flash')
const speechEvidence=existsSync(historyRoot)?Object.fromEntries(readdirSync(historyRoot,{recursive:true,withFileTypes:true})
  .filter(f=>f.isFile()).map(f=>{const path=join(f.parentPath,f.name);return [path.slice(historyRoot.length+1),hash(readFileSync(path))]})):{}
const report={at:new Date().toISOString(),status,snapshots,credentials,speechEvidence,audio:{bytes:audio.length,sha256:hash(audio)},appAsarSha256:hash(readFileSync(asar))}
if(mode==='before'){
  cpSync(join(userData,'credentials'),join(out,'before','credentials'),{recursive:true,errorOnExist:true,force:false})
  for(const file of ['following-settings.json','Local State'])copyFileSync(join(userData,file),join(out,'before',file))
  copyFileSync(asar,join(out,'before','app.asar'))
  copyFileSync(resolve('release-following-background-final/win-unpacked/Signal Desk.exe'),join(out,'before','Signal Desk.exe'))
  writeFileSync(join(out,'before.json'),JSON.stringify(report,null,2))
}else if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  report.databasesUnchangedExceptNewFlashTrial=JSON.stringify(before.snapshots)===JSON.stringify(snapshots)
  report.encryptedCredentialsUnchanged=JSON.stringify(before.credentials)===JSON.stringify(credentials)
  report.historicalSpeechEvidenceUnchanged=Object.entries(before.speechEvidence??{}).every(([path,sha])=>speechEvidence[path]===sha)
  writeFileSync(join(out,'after.json'),JSON.stringify(report,null,2))
  if(!report.databasesUnchangedExceptNewFlashTrial||!report.encryptedCredentialsUnchanged||!report.historicalSpeechEvidenceUnchanged)throw Error('Unexpected persisted data changes; inspect local report')
}
console.log(JSON.stringify({mode,status,tables:snapshots.reduce((n,s)=>n+Object.keys(s.tables).length,0),audio:report.audio,
  databasesUnchangedExceptNewFlashTrial:report.databasesUnchangedExceptNewFlashTrial,encryptedCredentialsUnchanged:report.encryptedCredentialsUnchanged,
  historicalSpeechEvidenceUnchanged:report.historicalSpeechEvidenceUnchanged}))
