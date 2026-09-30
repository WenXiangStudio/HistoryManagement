import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const runDirectory = resolve(process.argv[2] || '')
const runId = basename(runDirectory)
assert.match(runId, /^r8-homepage-client-\d{14}-[a-f0-9]{8}$/)
const report = JSON.parse(await readFile(join(runDirectory, 'pilot-report.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(runDirectory, 'manifest.json'), 'utf8'))
assert.equal(report.contract, 'signaldesk-homepage-pilot-report/v1')
assert.equal(report.runId, runId)
assert.equal(manifest.runId, runId)
assert.equal(manifest.status, report.result.status)
assert.equal(report.safety.formalDatabaseTouched, false)
assert.equal(report.safety.activeApiRequests, 0)
assert.equal(report.safety.mediaProcessingStarted, false)
assert.equal(report.safety.externalProvidersCalled, false)
assert.equal(report.result.activeApiRequests, 0)
assert.ok(report.result.navigationCount <= 3)

const db = new DatabaseSync(join(runDirectory, 'isolated-sync.sqlite'), { readOnly: true })
try {
  const version = Number(db.prepare('PRAGMA user_version').get().user_version)
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  const author = db.prepare(`SELECT c.platform_creator_id AS uid,c.sec_uid AS secUid,
    c.profile_url AS profileUrl,r.following_state AS followingState
    FROM creators c JOIN creator_owner_relationships r ON r.creator_id=c.id`).get()
  const works = db.prepare('SELECT platform_work_id AS workId,title,collection_status AS collectionStatus FROM works').all()
  const sources = db.prepare(`SELECT work_id,run_id,owner_sec_uid,creator_uid,creator_sec_uid,proof_json
    FROM isolated_pilot_sources`).all()
  const checkpoints = db.prepare(`SELECT target_kind AS targetKind,native_id AS nativeId,
    status FROM verified_collection_checkpoints`).all()
  const jobs = db.prepare('SELECT kind,state,status_message AS message FROM jobs ORDER BY id').all()
  const commentCount = Number(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n)
  const cloudMediaCount = Number(db.prepare(`SELECT COUNT(*) AS n FROM jobs
    WHERE kind LIKE 'media.%' OR kind LIKE 'cloud.%'`).get().n)
  assert.equal(version, 6)
  assert.equal(integrity, 'ok')
  assert.deepEqual(foreignKeys, [])
  assert.equal(author.uid, report.result.creator.uid)
  assert.equal(author.secUid, report.result.creator.secUid)
  assert.equal(author.profileUrl, report.result.creator.profileUrl)
  const jobKinds = jobs.map((job) => job.kind)
  const legacyPlannedRefresh = jobKinds.length === 2 && jobKinds[1] === 'collection.following'
  assert.deepEqual(jobKinds, legacyPlannedRefresh
    ? ['collection.creator_works', 'collection.following']
    : ['collection.creator_works'])
  if (legacyPlannedRefresh) assert.equal(jobs[1].state, 'paused')
  assert.equal(commentCount, 0)
  assert.equal(cloudMediaCount, 0)
  if (report.result.status === 'verified') {
    const verified = report.result.verifiedWork
    assert.ok(verified)
    assert.equal(verified.authorId, author.uid)
    assert.equal(verified.authorSecId, author.secUid)
    assert.ok(report.result.candidates.some((candidate) => candidate.workId === verified.workId))
    assert.equal(works.length, 1)
    assert.equal(works[0].workId, verified.workId)
    assert.equal(works[0].title, verified.title)
    assert.equal(works[0].collectionStatus, 'partial')
    assert.equal(sources.length, 1)
    assert.equal(sources[0].run_id, runId)
    assert.equal(sources[0].creator_uid, author.uid)
    assert.equal(sources[0].creator_sec_uid, author.secUid)
    const proof = JSON.parse(sources[0].proof_json)
    assert.deepEqual(proof.workProof, report.result.workProof)
    assert.deepEqual(proof.detailProof, report.result.detailProof)
    assert.equal(checkpoints.length, 1)
    assert.equal(checkpoints[0].targetKind, 'creator-works')
    assert.equal(checkpoints[0].nativeId, author.uid)
    assert.equal(checkpoints[0].status, 'scope-limited')
    assert.equal(jobs[0].state, 'completed')
  } else {
    assert.equal(works.length, 0)
    assert.equal(sources.length, 0)
    assert.equal(checkpoints.length, 0)
    assert.equal(jobs[0].state, 'blocked_user_action')
  }
  console.log(JSON.stringify({ runId, status: report.result.status,
    creatorUid: author.uid, creatorSecUid: author.secUid, followingState: author.followingState,
    verifiedWorkId: report.result.verifiedWork?.workId ?? null,
    candidateCount: report.result.candidates.length,
    navigationCount: report.result.navigationCount,
    activeApiRequests: report.result.activeApiRequests,
    workCount: works.length, commentCount, cloudMediaCount,
    workTask: jobs[0].state, followingTask: legacyPlannedRefresh ? jobs[1].state : null,
    workProofHash: report.result.workProof?.projectionSha256 ?? null,
    detailProofHash: report.result.detailProof?.projectionSha256 ?? null,
    databaseVersion: version, integrity, foreignKeyViolations: foreignKeys.length }, null, 2))
} finally { db.close() }
