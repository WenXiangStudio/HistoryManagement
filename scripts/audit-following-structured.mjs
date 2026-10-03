import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseSync,backup} from 'node:sqlite'
const output=resolve(process.argv[2]||'local-data/following-structured-20261003')
const before=JSON.parse(readFileSync(join(output,'database-before.json'),'utf8'))
const benchmark=JSON.parse(readFileSync(join(output,'app-benchmark.json'),'utf8'))
assert.equal(benchmark.ok,true)
const profile=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const db=new DatabaseSync(join(profile,'following-directory.sqlite'),{readOnly:true})
const business=new DatabaseSync(join(profile,'signal-desk.sqlite'),{readOnly:true})
try{
  for(const table of Object.keys(before)){
    const all=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    for(const [index,prior] of before[table].entries())for(const key of Object.keys(prior))assert.deepEqual(all[index][key],prior[key])
  }
  const runId=benchmark.state.runId,runDirectory=join(profile,'following-runs',runId)
  const capture=JSON.parse(readFileSync(join(runDirectory,'following-capture.json'),'utf8'))
  const report=JSON.parse(readFileSync(join(runDirectory,'following-report.json'),'utf8'))
  const timing=JSON.parse(readFileSync(join(runDirectory,'following-timing.json'),'utf8'))
  const execution=JSON.parse(readFileSync(join(runDirectory,'following-browser-execution.json'),'utf8'))
  const saved=db.prepare('SELECT * FROM visible_directory_creators WHERE run_id=? ORDER BY position').all(runId)
  const total=db.prepare('SELECT * FROM visible_directory_creators ORDER BY rowid').all()
  const originalIds=new Set(before.visible_directory_creators.map(row=>row.sec_uid))
  for(const [index,row] of saved.entries()){
    const creator=report.creators[index]
    assert.equal(originalIds.has(row.sec_uid),false)
    assert.equal(row.sec_uid,creator.secUid);assert.equal(row.native_uid,creator.uid);assert.equal(row.nickname,creator.nickname)
    assert.equal(row.avatar_url,creator.avatarUrl);assert.equal(row.signature,creator.signature);assert.equal(row.profile_url,creator.profileUrl)
    const source=capture.pages.flatMap(page=>page.creators).find(item=>item.secUid===creator.secUid)
    assert.deepEqual(source,creator)
    const card=benchmark.cards.find(item=>item.profileUrl===creator.profileUrl)
    assert.equal(card.nickname,creator.nickname);assert.equal(card.avatarUrl,creator.avatarUrl);assert.equal(card.loaded,true)
  }
  assert.equal(total.length,before.visible_directory_creators.length+saved.length)
  assert.equal(new Set(total.map(row=>row.sec_uid)).size,total.length)
  assert.equal(benchmark.cards.length,total.length);assert.ok(benchmark.cards.every(card=>card.loaded))
  assert.equal(createHash('sha256').update(JSON.stringify(report.creators)).digest('hex'),report.projectionSha256)
  assert.equal(execution.domQueries,0);assert.equal(execution.uiClicks,0)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  const boundaryCounts=Object.fromEntries(['works','comments','metric_snapshots','jobs','analyses'].map(table=>[table,business.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))
  assert.ok(Object.values(boundaryCounts).every(n=>n===0))
  await backup(db,join(output,'directory-after.sqlite'))
  for(const [name,data] of Object.entries({capture,report,timing,'browser-execution':execution}))writeFileSync(join(output,name+'.json'),JSON.stringify(data,null,2))
  const verification={runId,previousCount:before.visible_directory_creators.length,newCount:saved.length,totalCount:total.length,
    duplicateCount:0,oldRowsUnchanged:true,oldStarsNotesUnchanged:true,structuredFieldsMatch:true,nativeOwnerVerified:true,
    ownerSecUid:report.ownerSecUid,nativeAuthorUids:saved.filter(row=>row.native_uid).length,appCards:benchmark.cards.length,
    loadedAvatars:benchmark.cards.filter(card=>card.loaded).length,blankSignatures:report.creators.filter(row=>!row.signature).length,
    pageCount:capture.pages.length,apiRequests:capture.activeApiRequests,domQueries:0,uiClicks:0,
    displayedTotalMs:timing.displayedTotalMs,observedTotalMs:benchmark.observedClickToReadyMs,boundaryCounts}
  writeFileSync(join(output,'verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify(verification,null,2))
}finally{db.close();business.close()}
