import {DatabaseSync} from 'node:sqlite'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--profile','--run','--output'].includes(key)||!process.argv[i+1])throw Error('Usage: node scripts/export-creator-activity-observations.mjs [--profile PATH] [--run RUN_ID] [--output FILE]');options[key]=process.argv[i+1]}
const profile=options['--profile']||join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview'),settings=JSON.parse(readFileSync(join(profile,'following-settings.json'),'utf8'))
const db=new DatabaseSync(join(profile,'following-directory.sqlite'),{readOnly:true})
try{
 const run=options['--run']?db.prepare('SELECT * FROM creator_activity_runs WHERE run_id=?').get(options['--run']):
   db.prepare('SELECT * FROM creator_activity_runs WHERE owner_sec_uid=? ORDER BY rowid DESC LIMIT 1').get(settings.activeOwnerSecUid)
 if(!run)throw Error('No matching creator refresh run')
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_activity_observations'").get()
 const observations=exists?db.prepare('SELECT creator_sec_uid,observation_json FROM creator_activity_observations WHERE run_id=? ORDER BY rowid').all(run.run_id).map(row=>({
   nickname:db.prepare('SELECT nickname FROM visible_directory_creators WHERE sec_uid=? ORDER BY id DESC LIMIT 1').get(row.creator_sec_uid)?.nickname??null,
   observation:JSON.parse(row.observation_json)})):[]
 const failures=db.prepare('SELECT diagnostic_json FROM creator_activity_diagnostics WHERE run_id=?').all(run.run_id).map(row=>{const value=JSON.parse(row.diagnostic_json);delete value.screenshot;return value})
 const report={exportedAt:new Date().toISOString(),runId:run.run_id,state:JSON.parse(run.state_json),observations,failures,
   summary:observations.map(({nickname,observation:o})=>({nickname,phase:o.phase,strategy:o.strategy,availability:o.native?.availability?.outcome??null,
     matchingNativeRequests:o.native?.matchedRequests??0,errorCode:o.errorCode,bodyErrors:o.native?.requests.filter(r=>r.bodyError).map(r=>r.bodyError)??[]}))}
 const output=resolve(options['--output']||join('local-data','activity-observations',String(run.run_id)+'-'+new Date().toISOString().replaceAll(':','-')+'.json'))
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'})
 console.log(JSON.stringify({output,runId:run.run_id,observations:observations.length,failures:failures.length}))
}finally{db.close()}
