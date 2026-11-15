import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync,copyFileSync,cpSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const mode=process.argv[2]??'status',out=resolve('local-data/video-workflow-20261013'),userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
if(!['before','after','status'].includes(mode))throw Error('Invalid audit mode')
mkdirSync(out,{recursive:true})
const hash=v=>createHash('sha256').update(v).digest('hex')
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)
const report={at:new Date().toISOString(),databases:{},credentials:{},runtimeHash:hash(readFileSync(join(userData,'video-content/runtime.json'))),preferencesHash:hash(readFileSync(join(userData,'following-settings.json')))}
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(userData,name),{readOnly:true})
  try{
    const tables={}
    for(const {name:table} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      if(['video_content_batches','analysis_batches'].includes(table)&&rows.some(r=>['running','queued'].includes(r.state)))throw Error('Content task busy')
      tables[table]={count:rows.length,sha256:hash(rows.map(stable).sort().join('\n')),rowHashes:rows.map(r=>hash(stable(r))).sort()}
    }
    report.databases[name]={tables,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length}
    if(mode==='before'){
      const target=join(out,'before',name)
      if(existsSync(target))throw Error('Backup already exists')
      mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)
    }
  }finally{db.close()}
}
report.credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).filter(f=>!f.endsWith('.tmp')).sort().map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
if(mode==='before'){
  cpSync(join(userData,'credentials'),join(out,'before/credentials'),{recursive:true})
  for(const f of ['Local State','following-settings.json'])if(existsSync(join(userData,f)))copyFileSync(join(userData,f),join(out,'before',f))
  mkdirSync(join(out,'before/video-content'),{recursive:true});copyFileSync(join(userData,'video-content/runtime.json'),join(out,'before/video-content/runtime.json'))
  copyFileSync('release-following-background-final/win-unpacked/resources/app.asar',join(out,'before/app.asar'))
  copyFileSync('release-following-background-final/win-unpacked/Signal Desk.exe',join(out,'before/Signal Desk.exe'))
}
if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  const retention={oldRowsRetained:true,otherTablesUnchanged:true,credentialsUnchanged:stable(report.credentials)===stable(before.credentials),runtimeUnchanged:report.runtimeHash===before.runtimeHash,preferencesUnchanged:report.preferencesHash===before.preferencesHash}
  for(const [name,old] of Object.entries(before.databases))for(const [table,previous] of Object.entries(old.tables)){
    const current=report.databases[name].tables[table]
    if(['video_content_stages','video_content_batches'].includes(table))retention.oldRowsRetained&&=previous.rowHashes.every(h=>current.rowHashes.includes(h))
    else retention.otherTablesUnchanged&&=previous.sha256===current?.sha256
  }
  report.retention=retention
  writeFileSync(join(out,'after.json'),JSON.stringify(report,null,2))
  assert.ok(Object.values(retention).every(Boolean),JSON.stringify(retention))
}else writeFileSync(join(out,mode+'.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({mode,tableCounts:Object.fromEntries(Object.entries(report.databases).map(([name,d])=>[name,Object.keys(d.tables).length])),retention:report.retention},null,2))
