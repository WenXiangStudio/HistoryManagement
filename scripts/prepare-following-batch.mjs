import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const batchNumber = Number(process.argv[2])
const limit = Number(process.argv[3])
const outputDirectory = resolve(process.argv[4] || '')
assert.ok(Number.isInteger(batchNumber) && batchNumber >= 2)
assert.ok([10,20].includes(limit))
assert.ok(process.argv[4], 'An explicit new batch output directory is required')
assert.equal(existsSync(join(outputDirectory,'config.json')),false,'Do not overwrite an existing batch configuration')
const local = new DatabaseSync(resolve('local-data/douyin-following.sqlite'),{readOnly:true})
const directory = new DatabaseSync(join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','following-directory.sqlite'),{readOnly:true})
try {
  const latest = directory.prepare('SELECT account_label FROM visible_directory_runs ORDER BY rowid DESC LIMIT 1').get()
  assert.ok(latest?.account_label, 'A saved account label is required for the same-account test')
  const localRows = local.prepare('SELECT sec_uid FROM following_creators').all()
  const appRows = directory.prepare('SELECT sec_uid FROM visible_directory_creators').all()
  const networkRows = directory.prepare('SELECT sec_uid FROM directory_creators').all()
  const excludeSecUids=[...new Set([...localRows,...appRows,...networkRows].map(row=>row.sec_uid))]
  assert.ok(excludeSecUids.length)
  mkdirSync(outputDirectory,{recursive:true})
  const config={batchNumber,limit,ownerNickname:latest.account_label,excludeSecUids}
  writeFileSync(join(outputDirectory,'config.json'),JSON.stringify(config,null,2))
  writeFileSync(join(outputDirectory,'preparation.json'),JSON.stringify({
    preparedAt:new Date().toISOString(),status:'prepared-not-started',batchNumber,requestedCount:limit,
    excludedSavedCount:excludeSecUids.length,localRowCount:localRows.length,appRowCount:appRows.length,
    acquisitionTimer:'Starts when the page acquisition script begins; no elapsed acquisition time exists yet',
    capturePath:join(outputDirectory,'capture.json'),timingSummaryPath:join(outputDirectory,'timing-summary.json')
  },null,2))
  console.log(JSON.stringify({status:'prepared-not-started',batchNumber,requestedCount:limit,
    excludedSavedCount:excludeSecUids.length,outputDirectory}))
} finally {local.close();directory.close()}
