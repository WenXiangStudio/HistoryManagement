// Import the existing PS+AI sample result for the user's requested inbox review.
// Validate account, author, original media and provider receipts; never invoke a model.
import {backup,DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {effectiveVideoClass,validateResearchReport,WORKFLOW_TEXT_MODEL} from '../src/shared/videoWorkflow.ts'

const workId='7682043534987300106',userData=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const evidenceRoot=resolve('local-data/video-workflow-20261013')
const source=JSON.parse(readFileSync(join(evidenceRoot,'desktop-qa.json'),'utf8'))
assert.equal(source.workId,workId)
const owner=JSON.parse(readFileSync(join(userData,'following-settings.json'),'utf8')).activeOwnerSecUid
assert.equal(source.processingBatch.ownerSecUid,owner)
assert.equal(source.processingBatch.state,'completed')
const hash=value=>createHash('sha256').update(value).digest('hex')
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
const snapshot=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{
  const rows=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()
  return [name,{count:rows.length,hashes:rows.map(r=>hash(stable(r))).sort()}]
}))
const root=join(evidenceRoot,'inbox-import-'+Date.now());mkdirSync(root)
const production=new DatabaseSync(join(userData,'following-directory.sqlite'))
const qa=new DatabaseSync(join(source.qa,'following-directory.sqlite'),{readOnly:true})
const stage=(db,name)=>db.prepare("SELECT * FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage=? AND state='completed' ORDER BY id DESC LIMIT 1").get(owner,workId,name)
const identity=db=>db.prepare('SELECT * FROM creator_video_information WHERE owner_sec_uid=? AND work_id=?').get(owner,workId)
const settingsHash=hash(readFileSync(join(userData,'following-settings.json')))
const credentials=Object.fromEntries(readdirSync(join(userData,'credentials')).map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))]))
let report
try{
  const bridge=JSON.parse(readFileSync(join(userData,'following-bridge.json'),'utf8'))
  const origin=new URL(bridge.origin);assert.ok(['127.0.0.1','localhost'].includes(origin.hostname))
  const status=await fetch(new URL('/status',origin),{headers:{authorization:'Bearer '+bridge.token},signal:AbortSignal.timeout(5000)}).then(r=>r.json())
  assert.ok(![status.phase,status.activity?.phase,status.basic?.phase,status.videoInformation?.phase].includes('running'),'APP_BUSY')
  assert.equal(production.prepare("SELECT COUNT(*) n FROM video_content_batches WHERE state IN ('running','queued')").get().n,0)
  assert.deepEqual(identity(production),identity(qa),'Account/author/work identity changed')
  const formalWork=identity(production),media=JSON.parse(stage(production,'media').result_json),qaMedia=JSON.parse(stage(qa,'media').result_json)
  for(const value of [media,qaMedia]){
    assert.equal(statSync(value.mediaPath).size,value.byteLength)
    assert.equal(hash(readFileSync(value.mediaPath)),value.sha256)
    const proof=JSON.parse(readFileSync(join(value.directory,'proof.json'),'utf8'))
    assert.equal(proof.capture.ownerVerification.secUid,owner)
    assert.equal(proof.capture.work.workId,workId)
    assert.equal(proof.capture.work.authorUid,formalWork.author_uid)
    assert.equal(proof.capture.work.authorSecUid,formalWork.creator_sec_uid)
  }
  assert.equal(media.sha256,qaMedia.sha256)
  const classification=JSON.parse(stage(production,'classification').result_json)
  assert.equal(effectiveVideoClass(classification),'speech')
  assert.equal(classification.sourceSha256,media.sha256)
  const bodyRow=stage(qa,'body'),researchRow=stage(qa,'research')
  const body=JSON.parse(bodyRow.result_json),research=JSON.parse(researchRow.result_json)
  const routeHash=hash(JSON.stringify({source:media.sha256,code:'speech',version:'material-workflow/v1'}))
  assert.equal(body.source,'doubao-flash');assert.equal(body.sourceSha256,media.sha256)
  assert.equal(body.classificationHash,routeHash);assert.equal(research.modelVersion,WORKFLOW_TEXT_MODEL)
  assert.equal(research.bodyHash,hash(body.text));assert.equal(researchRow.input_hash,research.bodyHash)
  const {modelVersion,generatedAt,bodyHash,promptVersion,...reportContent}=research
  validateResearchReport(reportContent,body.text)
  const exported=JSON.parse(readFileSync(join(evidenceRoot,'qa-body-and-research.json'),'utf8'))
  assert.deepEqual(exported,{body,research})
  const receipt=JSON.parse(readFileSync(join(qaMedia.directory,'workflow-doubao-flash/receipt.json'),'utf8'))
  const speechResponse=JSON.parse(readFileSync(join(qaMedia.directory,'workflow-doubao-flash/response-original.json'),'utf8'))
  assert.equal(receipt.sourceSha256,media.sha256);assert.equal(receipt.text,body.text)
  assert.equal(receipt.requestId,body.requestId);assert.equal(speechResponse.requestId,body.requestId)
  assert.equal(speechResponse.statusCode,'20000000');assert.equal(JSON.parse(speechResponse.body).result.text,body.text)
  const researchFiles=readdirSync(join(qaMedia.directory,'workflow-research')).filter(f=>f.endsWith('-response.json'))
  assert.ok(researchFiles.length)
  const rawResearch=JSON.parse(readFileSync(join(qaMedia.directory,'workflow-research',researchFiles.at(-1)),'utf8'))
  const payload=JSON.parse(rawResearch.body)
  assert.equal(rawResearch.bodyHash,research.bodyHash);assert.equal(payload.model,WORKFLOW_TEXT_MODEL)
  assert.equal(payload.choices[0].finish_reason,'stop')
  assert.deepEqual(JSON.parse(payload.choices[0].message.content),reportContent)
  for(const name of ['body','research']){
    const previous=stage(production,name)
    if(previous)assert.equal(previous.result_json,name==='body'?bodyRow.result_json:researchRow.result_json,'Existing formal result differs; preserve it')
  }
  const before=snapshot(production)
  await backup(production,join(root,'following-directory-before.sqlite'))
  const appDb=new DatabaseSync(join(userData,'signal-desk.sqlite'),{readOnly:true})
  const appBefore=snapshot(appDb);await backup(appDb,join(root,'signal-desk-before.sqlite'));appDb.close()
  writeFileSync(join(root,'before.json'),JSON.stringify({before,appBefore,settingsHash,credentials},null,2))
  const files=[]
  for(const folder of ['workflow-doubao-flash','workflow-research']){
    const target=join(media.directory,folder);mkdirSync(target,{recursive:true})
    for(const file of readdirSync(join(qaMedia.directory,folder))){
      const src=join(qaMedia.directory,folder,file),dest=join(target,file),digest=hash(readFileSync(src))
      if(existsSync(dest))assert.equal(hash(readFileSync(dest)),digest,'Existing receipt differs')
      else copyFileSync(src,dest)
      files.push({path:dest,sha256:digest})
    }
  }
  const at=new Date().toISOString(),priorInterest=production.prepare('SELECT * FROM video_content_interest WHERE owner_sec_uid=? AND work_id=?').get(owner,workId)
  production.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  try{
    const insert=production.prepare("INSERT INTO video_content_stages(owner_sec_uid,work_id,stage,input_hash,state,updated_at,result_json,error) VALUES(?,?,?,?,'completed',?,?,NULL)")
    for(const [name,row] of [['body',bodyRow],['research',researchRow]])if(!stage(production,name))insert.run(owner,workId,name,row.input_hash,at,row.result_json)
    production.prepare("INSERT INTO video_content_interest VALUES(?,?,'interested',?) ON CONFLICT(owner_sec_uid,work_id) DO UPDATE SET interest='interested',updated_at=excluded.updated_at").run(owner,workId,at)
    production.prepare("INSERT INTO video_material_inbox VALUES(?,?,'unread') ON CONFLICT(owner_sec_uid,work_id) DO UPDATE SET state='unread'").run(owner,workId)
    production.exec('COMMIT')
  }catch(error){production.exec('ROLLBACK');throw error}
  const after=snapshot(production)
  for(const [table,rows] of Object.entries(before)){
    if(table==='video_content_stages')assert.ok(rows.hashes.every(h=>after[table].hashes.includes(h)))
    else if(!['video_content_interest','video_material_inbox'].includes(table))assert.deepEqual(rows,after[table],table+' changed')
  }
  const updatedApp=new DatabaseSync(join(userData,'signal-desk.sqlite'),{readOnly:true})
  assert.deepEqual(snapshot(updatedApp),appBefore);updatedApp.close()
  assert.equal(hash(readFileSync(join(userData,'following-settings.json'))),settingsHash)
  assert.deepEqual(Object.fromEntries(readdirSync(join(userData,'credentials')).map(f=>[f,hash(readFileSync(join(userData,'credentials',f)))])),credentials)
  assert.equal(production.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  assert.equal(production.prepare('PRAGMA foreign_key_check').all().length,0)
  report={at,workId,title:'PS+AI精准控图',sourceQa:source.qa,backupRoot:root,sourceSha256:media.sha256,
    bodyHash:research.bodyHash,bodyCharacters:body.text.length,reportModel:research.modelVersion,requestId:body.requestId,
    priorInterest:priorInterest?.interest??'unmarked',interest:'interested',inboxState:'unread',
    oldStageRowsRetained:true,otherTablesUnchanged:true,accountAndCredentialsUnchanged:true,newModelCalls:0,files}
  writeFileSync(join(root,'after.json'),JSON.stringify({report,after},null,2))
  writeFileSync(join(evidenceRoot,'inbox-import.json'),JSON.stringify(report,null,2))
}finally{qa.close();production.close()}
console.log(JSON.stringify({workId,backupRoot:root,bodyCharacters:report.bodyCharacters,reportModel:report.reportModel,
  interest:report.interest,inboxState:report.inboxState,oldStageRowsRetained:true,newModelCalls:0},null,2))
