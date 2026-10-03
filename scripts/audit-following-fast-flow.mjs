import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {DatabaseSync,backup} from 'node:sqlite'
const output=resolve(process.argv[2]||'local-data/following-fast-flow-20261001')
const before=JSON.parse(readFileSync(join(output,'database-before.json'),'utf8'))
const benchmark=JSON.parse(readFileSync(join(output,'app-benchmark.json'),'utf8'))
assert.equal(benchmark.ok,true)
const profile=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
const directory=new DatabaseSync(join(profile,'following-directory.sqlite'),{readOnly:true})
const business=new DatabaseSync(join(profile,'signal-desk.sqlite'),{readOnly:true})
try{
  const oldIds=new Set(before.visible_directory_creators.map(item=>item.id))
  const all=directory.prepare('SELECT * FROM visible_directory_creators ORDER BY rowid').all()
  assert.deepEqual(JSON.parse(JSON.stringify(all.filter(item=>oldIds.has(item.id)))),before.visible_directory_creators)
  for(const table of ['directory_runs','directory_creators','visible_directory_runs']){
    const original=before[table]
    const rows=directory.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    assert.deepEqual(JSON.parse(JSON.stringify(rows.slice(0,original.length))),original)
  }
  const previousCount=before.visible_directory_creators.length,newCount=benchmark.added.length,totalCount=previousCount+newCount
  assert.equal(all.length,totalCount)
  assert.equal(new Set(all.map(item=>item.sec_uid)).size,totalCount)
  const runId=benchmark.state.runId
  const report=JSON.parse(readFileSync(join(profile,'following-runs',runId,'following-report.json'),'utf8'))
  const capture=JSON.parse(readFileSync(join(profile,'following-runs',runId,'following-capture.json'),'utf8'))
  const timing=JSON.parse(readFileSync(join(profile,'following-runs',runId,'following-timing.json'),'utf8'))
  assert.equal(report.creators.length,newCount)
  assert.ok(report.creators.every(item=>!before.visible_directory_creators.some(old=>old.sec_uid===item.secUid)))
  const saved=directory.prepare('SELECT * FROM visible_directory_creators WHERE run_id=? ORDER BY position').all(runId)
  const byId=new Map(capture.bindings.map(item=>[item.secUid,item]))
  for(const [index,row] of saved.entries()){
    const creator=report.creators[index],binding=byId.get(row.sec_uid),card=benchmark.cards.find(item=>item.profileUrl===row.profile_url)
    assert.equal(row.sec_uid,creator.secUid);assert.equal(row.nickname,creator.nickname)
    assert.equal(row.avatar_url,creator.avatarUrl);assert.equal(row.signature,creator.signature);assert.equal(row.profile_url,creator.profileUrl)
    assert.equal(binding.avatarUrl,row.avatar_url);assert.equal(binding.nickname,row.nickname);assert.equal(binding.nicknameAnchorProfileUrl,row.profile_url)
    assert.equal(binding.imageAlt,`${row.nickname}头像`);assert.equal(binding.imageLoaded,true)
    assert.equal(card.nickname,row.nickname);assert.equal(card.avatarUrl,row.avatar_url);assert.equal(card.loaded,true)
  }
  assert.equal(benchmark.cards.length,totalCount);assert.equal(benchmark.cards.filter(item=>item.loaded).length,totalCount)
  assert.equal(createHash('sha256').update(JSON.stringify(report.creators)).digest('hex'),report.projectionSha256)
  assert.equal(directory.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  assert.equal(directory.prepare('PRAGMA foreign_key_check').all().length,0)
  const boundaryCounts=Object.fromEntries(['works','comments','metric_snapshots','jobs','analyses'].map(table=>[table,business.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))
  assert.ok(Object.values(boundaryCounts).every(value=>value===0))
  await backup(directory,join(output,'directory-after.sqlite'))
  writeFileSync(join(output,'capture.json'),JSON.stringify(capture,null,2))
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))
  writeFileSync(join(output,'timing.json'),JSON.stringify(timing,null,2))
  const verification={runId,verifiedAt:new Date().toISOString(),previousCount,newCount,totalDistinctCount:totalCount,
    duplicateCount:0,priorRowsUnchanged:true,bindingsMatch:true,appCardCount:totalCount,appLoadedAvatarCount:totalCount,
    blankSignatureCount:report.creators.filter(item=>!item.signature).length,
    directoryIntegrity:'ok',foreignKeyViolations:0,boundaryCounts,
    clickToAllDisplayedMs:timing.displayedTotalMs,observedClickToReadyMs:benchmark.observedClickToReadyMs,
    averageDisplayedMsPerNewAuthor:timing.averageDisplayedMs,acquisitionMs:timing.acquisitionMs,
    persistenceMs:timing.persistenceMs,productionWorksGateEnabled:false}
  writeFileSync(join(output,'verification.json'),JSON.stringify(verification,null,2))
  console.log(JSON.stringify(verification,null,2))
}finally{directory.close();business.close()}
