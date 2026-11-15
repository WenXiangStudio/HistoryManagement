// Read-only state retention audit and reversible backup for the one-click repair update.
import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const mode=process.argv[2]??'status',out=resolve('local-data/anomaly-batch-repair-20261013'),root=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
assert.ok(['before','after','status'].includes(mode));mkdirSync(out,{recursive:true})
const hash=v=>createHash('sha256').update(v).digest('hex')
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)
const bridge=JSON.parse(readFileSync(join(root,'following-bridge.json'),'utf8')),origin=new URL(bridge.origin)
assert.ok(['127.0.0.1','localhost'].includes(origin.hostname))
const state=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
const phases=[state.phase,state.basic?.phase,state.activity?.phase,state.videoInformation?.phase]
assert.ok(!phases.includes('running'),'APP_BUSY')
const report={at:new Date().toISOString(),tables:{},credentials:{},runtime:hash(readFileSync(join(root,'video-content/runtime.json'))),preferences:hash(readFileSync(join(root,'following-settings.json'))),
  status:{phase:state.phase,activity:state.activity?.phase,online:state.connection?.online,readiness:state.readiness?.phase}}
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const db=new DatabaseSync(join(root,name),{readOnly:true})
  try{
    const tables={}
    for(const {name:table} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      const rows=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all()
      if(['video_content_batches','analysis_batches'].includes(table))assert.ok(!rows.some(r=>['queued','running'].includes(r.state)),'CONTENT_BUSY')
      tables[table]={rows:rows.length,sha256:hash(rows.map(stable).sort().join('\n'))}
    }
    report.tables[name]=tables
    if(mode==='before'){
      const target=join(out,'before',name);assert.ok(!existsSync(target),'Preserve existing backup')
      mkdirSync(join(out,'before'),{recursive:true});await backup(db,target)
    }
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{db.close()}
}
report.credentials=Object.fromEntries(readdirSync(join(root,'credentials')).sort().map(f=>[f,hash(readFileSync(join(root,'credentials',f)))]))
if(mode==='before'){
  copyFileSync('release-following-background-final/win-unpacked/resources/app.asar',join(out,'before/app.asar'))
  copyFileSync('release-following-background-final/win-unpacked/Signal Desk.exe',join(out,'before/Signal Desk.exe'))
}else if(mode==='after'){
  const before=JSON.parse(readFileSync(join(out,'before.json'),'utf8'))
  report.retention={allDatabaseRowsUnchanged:stable(before.tables)===stable(report.tables),credentialsUnchanged:stable(before.credentials)===stable(report.credentials),
    runtimeUnchanged:before.runtime===report.runtime,accountPreferencesUnchanged:before.preferences===report.preferences}
  assert.ok(Object.values(report.retention).every(Boolean),JSON.stringify(report.retention))
}
writeFileSync(join(out,mode+'.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({mode,status:report.status,retention:report.retention},null,2))
