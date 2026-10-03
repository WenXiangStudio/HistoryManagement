import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

const persistenceStartedAt = new Date().toISOString()
const persistenceStart = performance.now()

const capturePath = resolve(process.argv[2] || 'local-data/following-batch2-20261001/capture.json')
const outputDirectory = resolve(process.argv[3] || 'local-data/following-batch2-20261001')
const verifySaved = process.argv.includes('--verify-saved')
const capture = JSON.parse(readFileSync(capturePath, 'utf8').replace(/^\uFEFF/, ''))
const creators = capture.creators
const expectedCount = capture.requestedCount ?? 10
const batchNumber = capture.batchNumber ?? 2
assert.ok([10,20].includes(expectedCount), 'This test supports ten or twenty new authors')
assert.ok(Number.isInteger(batchNumber) && batchNumber >= 2, 'Invalid batch number')
assert.equal(capture.ok, true)
assert.equal(capture.sourceUrl, 'https://www.douyin.com/user/self')
assert.equal(capture.activeFollowingTab, true)
assert.equal(capture.listStartedAtTop, true)
assert.equal(capture.activeApiRequests, 0)
assert.equal(capture.workResponseBodiesRead, 0)
assert.equal(creators.length, expectedCount)
assert.equal(new Set(creators.map(item => item.secUid)).size, expectedCount)
assert.equal(capture.bindings.length, expectedCount)
if (capture.timing) {
  assert.equal(capture.timing.status, 'completed')
  assert.equal(capture.timing.requestedCount, expectedCount)
  assert.equal(capture.timing.successfulCount, expectedCount)
  assert.equal(capture.timing.records.length, expectedCount)
  assert.equal(capture.timing.averageMsPerCreator, capture.timing.totalMs / expectedCount)
  assert.deepEqual(capture.timing.records.map(item => item.secUid), creators.map(item => item.secUid))
  assert.ok(capture.timing.records.every(item => item.success && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0))
} else if (expectedCount === 20) throw new Error('The twenty-author test requires acquisition timing')
const bindings = new Map(capture.bindings.map(item => [item.secUid, item]))
const excluded = new Set(capture.excludedSecUids)
for (const [index, creator] of creators.entries()) {
  const binding = bindings.get(creator.secUid)
  assert.equal(creator.position, index + 1)
  assert.equal(creator.uid, null)
  assert.ok(!excluded.has(creator.secUid), `Previously saved author: ${creator.nickname}`)
  assert.match(creator.secUid, /^[A-Za-z0-9._-]+$/)
  assert.equal(creator.profileUrl, `https://www.douyin.com/user/${creator.secUid}`)
  assert.equal(binding?.nickname, creator.nickname)
  assert.equal(binding?.nicknameAnchorProfileUrl, creator.profileUrl)
  assert.equal(binding?.avatarUrl, creator.avatarUrl)
  assert.equal(binding?.signature, creator.signature)
  assert.equal(binding?.imageAlt, `${creator.nickname}头像`)
  assert.equal(binding?.imageLoaded, true)
  assert.match(binding.relationship, /^(已关注|相互关注)$/)
  assert.equal(binding.bindingMethod, 'image-and-signature-inside-exact-profile-card')
  const avatarLink = new URL(binding.avatarLinkUrl)
  if (binding.anchorProfileUrl) assert.equal(binding.anchorProfileUrl, creator.profileUrl)
  else assert.equal(avatarLink.origin, 'https://live.douyin.com')
  assert.equal(new URL(creator.avatarUrl).protocol, 'https:')
}

const databasePath = resolve('local-data/douyin-following.sqlite')
const appProfile = join(process.env.LOCALAPPDATA, 'SignalDeskFollowingReview')
const appDirectoryPath = join(appProfile, 'following-directory.sqlite')
const appBusinessPath = join(appProfile, 'signal-desk.sqlite')
const localBackup = join(outputDirectory, 'following-before.sqlite')
const appBackup = join(outputDirectory, 'app-directory-before.sqlite')
if (verifySaved && (!existsSync(localBackup) || !existsSync(appBackup))) throw new Error('Saved-run verification requires original before backups')
const sourceDatabase = new DatabaseSync(verifySaved ? localBackup : databasePath, { readOnly: true })
const sourceDirectory = new DatabaseSync(verifySaved ? appBackup : appDirectoryPath, { readOnly: true })
const business = new DatabaseSync(appBusinessPath, { readOnly: true })
const priorLocal = sourceDatabase.prepare('SELECT * FROM following_creators ORDER BY run_id,position').all()
const priorApp = sourceDirectory.prepare('SELECT * FROM visible_directory_creators ORDER BY run_id,position').all()
const priorAppRuns = sourceDirectory.prepare('SELECT * FROM visible_directory_runs ORDER BY run_id').all()
const existingIdentities = new Set([
  ...priorLocal.map(row => row.sec_uid), ...priorApp.map(row => row.sec_uid),
  ...sourceDirectory.prepare('SELECT sec_uid FROM directory_creators').all().map(row => row.sec_uid)
])
for (const creator of creators) assert.ok(!existingIdentities.has(creator.secUid), `Duplicate database identity: ${creator.nickname}`)
for (const identity of existingIdentities) assert.ok(excluded.has(identity), 'Baseline excluded list did not cover saved identities')
const readBoundaryCounts = () => Object.fromEntries(['works','comments','metric_snapshots','jobs','analyses']
  .map(table => [table, business.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))
const beforeCounts = verifySaved ? JSON.parse(readFileSync(join(outputDirectory,'database-before.json'),'utf8')).boundaryCounts : readBoundaryCounts()
const firstCapturePath = resolve('local-data/douyin-following-20260930.json')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const firstCaptureHash = verifySaved ? JSON.parse(readFileSync(join(outputDirectory,'database-before.json'),'utf8')).firstCaptureSha256 : sha256(readFileSync(firstCapturePath))
if (!verifySaved) {
  if (existsSync(localBackup) || existsSync(appBackup)) throw new Error('Before backups already exist; do not overwrite prior evidence')
  await backup(sourceDatabase, localBackup)
  await backup(sourceDirectory, appBackup)
}
sourceDatabase.close()
sourceDirectory.close()
if (!verifySaved) writeFileSync(join(outputDirectory, 'database-before.json'), JSON.stringify({ databasePath, appDirectoryPath,
  localRows: priorLocal.length, appRows: priorApp.length, distinctIdentities: existingIdentities.size,
  boundaryCounts: beforeCounts, firstCaptureSha256: firstCaptureHash }, null, 2))

const runId = `desktop-following-batch${batchNumber}-${capture.collectedAt.replace(/[^0-9]/g, '').slice(0,14)}`
const appCreators = creators.map(item => ({ uid: null, secUid: item.secUid, nickname: item.nickname,
  avatarUrl: item.avatarUrl, signature: item.signature, profileUrl: item.profileUrl }))
const report = { contract: 'signaldesk-visible-following/v1', runId, collectedAt: capture.collectedAt,
  ownerSecUid: null, ownerNickname: capture.ownerNickname, sourceUrl: capture.sourceUrl,
  sourceKind: 'visible-following-list', activeFollowingTab: true, listStartedAtTop: true,
  hasMore: capture.hasMore, visibleItemCount: capture.visibleItemCount, creators: appCreators,
  projectionSha256: sha256(JSON.stringify(appCreators)), activeApiRequests: 0, workResponseBodiesRead: 0 }
const database = new DatabaseSync(databasePath)
const appDirectory = new DatabaseSync(appDirectoryPath)
database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
appDirectory.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
if (!verifySaved) try {
  database.exec('BEGIN IMMEDIATE')
  appDirectory.exec('BEGIN IMMEDIATE')
  // Recheck while the write locks are held, so no concurrent save can add a duplicate.
  for (const creator of creators) {
    assert.equal(database.prepare('SELECT count(*) AS n FROM following_creators WHERE sec_uid=?').get(creator.secUid).n, 0)
    assert.equal(appDirectory.prepare('SELECT count(*) AS n FROM visible_directory_creators WHERE sec_uid=?').get(creator.secUid).n, 0)
    assert.equal(appDirectory.prepare('SELECT count(*) AS n FROM directory_creators WHERE sec_uid=?').get(creator.secUid).n, 0)
  }
  database.prepare('INSERT INTO following_runs VALUES(?,?,?,?,?)').run(runId, capture.collectedAt,
    capture.sourceUrl, capture.collectionMethod, expectedCount)
  const localInsert = database.prepare('INSERT INTO following_creators VALUES(?,?,?,?,?,?,?)')
  creators.forEach(item => localInsert.run(runId,item.position,item.nickname,item.secUid,item.profileUrl,item.avatarUrl,item.signature))
  appDirectory.prepare('INSERT INTO visible_directory_runs VALUES(?,?,?,?,?)').run(runId,capture.collectedAt,
    capture.ownerNickname,'scope-limited',JSON.stringify(report))
  const appInsert = appDirectory.prepare(`INSERT INTO visible_directory_creators
    (run_id,sec_uid,nickname,avatar_url,signature,profile_url,position) VALUES(?,?,?,?,?,?,?)`)
  creators.forEach(item => appInsert.run(runId,item.secUid,item.nickname,item.avatarUrl,item.signature,item.profileUrl,item.position))
  appDirectory.exec('COMMIT')
  database.exec('COMMIT')
} catch (error) {
  if (appDirectory.isTransaction) appDirectory.exec('ROLLBACK')
  if (database.isTransaction) database.exec('ROLLBACK')
  throw error
}
try {
  const localRows = database.prepare(`SELECT position,nickname,sec_uid AS secUid,profile_url AS profileUrl,
    avatar_url AS avatarUrl,signature FROM following_creators WHERE run_id=? ORDER BY position`).all(runId)
  const appRows = appDirectory.prepare(`SELECT position,nickname,sec_uid AS secUid,profile_url AS profileUrl,
    avatar_url AS avatarUrl,signature FROM visible_directory_creators WHERE run_id=? ORDER BY position`).all(runId)
  const expected = creators.map(({ sourceListPosition,uid,...item }) => item)
  // Compare parsed values, independent of JSON property order.
  assert.deepEqual(localRows.map(row=>({...row})), expected)
  assert.deepEqual(appRows.map(row=>({...row})), expected)
  assert.deepEqual(database.prepare('SELECT * FROM following_creators WHERE run_id<>? ORDER BY run_id,position').all(runId), priorLocal)
  assert.deepEqual(appDirectory.prepare('SELECT * FROM visible_directory_creators WHERE run_id<>? ORDER BY run_id,position').all(runId), priorApp)
  assert.deepEqual(appDirectory.prepare('SELECT * FROM visible_directory_runs WHERE run_id<>? ORDER BY run_id').all(runId), priorAppRuns)
  assert.equal(sha256(readFileSync(firstCapturePath)), firstCaptureHash)
  const afterCounts = readBoundaryCounts()
  assert.deepEqual(afterCounts, beforeCounts)
  const localIntegrity = database.prepare('PRAGMA integrity_check').get().integrity_check
  const appIntegrity = appDirectory.prepare('PRAGMA integrity_check').get().integrity_check
  assert.equal(localIntegrity, 'ok')
  assert.equal(appIntegrity, 'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal(appDirectory.prepare('PRAGMA foreign_key_check').all().length, 0)
  const allIdentities = database.prepare('SELECT sec_uid FROM following_creators').all().map(row => row.sec_uid)
  assert.equal(new Set(allIdentities).size, allIdentities.length)
  const verification = { runId, collectedAt: capture.collectedAt, databasePath, appDirectoryPath,
    savedCount: expectedCount, duplicateCountAgainstPriorRuns: 0, totalSavedCount: allIdentities.length,
    totalDistinctCount: new Set(allIdentities).size, avatarCount: expectedCount, loadedBrowserAvatarCount: expectedCount,
    nicknameProfileAvatarSignatureBindingsMatch: true, priorRowsUnchanged: true, firstCaptureUnchanged: true,
    localIntegrity, appIntegrity, boundaryCountsBefore: beforeCounts, boundaryCountsAfter: afterCounts,
    originalCaptureSha256: sha256(readFileSync(capturePath)), projectionSha256: report.projectionSha256,
    profileLinks: creators.map(({position,nickname,profileUrl}) => ({position,nickname,profileUrl})) }
  writeFileSync(join(outputDirectory, 'following-report.json'), JSON.stringify(report,null,2))
  writeFileSync(join(outputDirectory, 'verification.json'), JSON.stringify(verification,null,2))
  await backup(database, join(outputDirectory, 'following-after.sqlite'))
  await backup(appDirectory, join(outputDirectory, 'app-directory-after.sqlite'))
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]))
  writeFileSync(join(outputDirectory, 'result.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>第${batchNumber}批 ${expectedCount} 位关注博主</title>
  <style>body{font:16px/1.7 system-ui;max-width:1100px;margin:40px auto;background:#f4f1ea;color:#24392c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{background:#fff;border-radius:14px;padding:20px;display:flex;gap:16px}img{width:60px;height:60px;border-radius:50%}h2{font-size:20px;margin:0}p{margin:6px 0}a{font-size:12px;overflow-wrap:anywhere;color:#247641}</style>
  <h1>第${batchNumber}批 ${expectedCount} 位关注博主</h1><p>账号：${escape(capture.ownerNickname)} · 与此前批次重复 0 位 · 本地共保存 ${allIdentities.length} 位不同博主</p>
  <p>采集时间：${escape(capture.collectedAt)} · 昵称、头像、简介和主页按同一张作者卡片绑定</p><div class="grid">${creators.map(item => `<article><img src="${escape(item.avatarUrl)}" alt="${escape(item.nickname)}头像"><div><h2>${item.position}. ${escape(item.nickname)}</h2><p>${escape(item.signature)}</p><a href="${escape(item.profileUrl)}" target="_blank">${escape(item.profileUrl)}</a></div></article>`).join('')}</div></html>`)
  if (capture.timing && !verifySaved) {
    const transportPath = capturePath + '.command-timing.json'
    writeFileSync(join(outputDirectory, 'timing-summary.json'), JSON.stringify({ runId,
      acquisition: capture.timing,
      command: existsSync(transportPath) ? JSON.parse(readFileSync(transportPath,'utf8').replace(/^\uFEFF/,'')) : null,
      persistence: { startedAt:persistenceStartedAt, finishedAt:new Date().toISOString(),
        elapsedMs:performance.now()-persistenceStart, scope:'validation, backups, database append, readback and local artifacts' }
    },null,2))
  }
  console.log(JSON.stringify(verification,null,2))
} finally { database.close(); appDirectory.close(); business.close() }
