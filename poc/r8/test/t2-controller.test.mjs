import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}
function source(kind) {
  const routeId = { 'following-list': 'DY-FOLLOW-NETWORK', 'creator-work-list': 'DY-WORKS-NETWORK',
    'work-detail': 'DY-DETAIL-NETWORK', 'comment-list': 'DY-COMMENT-NETWORK',
    'comment-reply-list': 'DY-REPLY-NETWORK' }[kind]
  return { routeId, endpointKind: kind,
    schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64), durationMs: 1 }
}
function report(runId) {
  const results = Array.from({ length: 6 }, (_, index) => {
    const workId = `work-${index}`
    const uid = `uid-${Math.floor(index / 3)}`
    const secUid = `sec-${Math.floor(index / 3)}`
    return { status: 'success', creator: { uid, secUid, nickname: '合成作者', isFollowing: true },
      workId, work: { workId, authorId: uid, authorSecId: secUid,
        title: '合成作品', description: '合成简介', workType: 'video' },
      comments: [{ commentId: `cid-${index}`, workId, publicAuthorId: 'viewer-1',
        publicAuthorName: '观众', body: '公开评论', parentCommentId: null, rootCommentId: null }],
      replies: [], completeness: { detail: 'complete', comments: 'complete', replies: 'complete' },
      sources: { detail: source('work-detail'), comments: [source('comment-list')], replies: [] } }
  })
  return { contract: 'signaldesk-r8-t2-shadow-report/v1', runId, stage: 'T2-shadow',
    startedAt: '2026-09-24T00:00:00.000Z', finishedAt: '2026-09-24T00:01:00.000Z',
    status: 'structured-ready', failure: null, failureDiagnostic: null,
    ownerVerified: true, followingRequestFields: ['aid','count','device_platform','sec_user_id'],
    requestTrace: [], observerIssueCodes: [],
    result: { contract: 'signaldesk-r8-batch-result/v1', status: 'complete', seed: 'fixed',
      scope: { workLimit: 6, worksPerCreator: 3, commentsPerWork: 20, followingLimit: 300, concurrency: 3 },
      followingEvidence: { creatorCount: 2, completeness: 'complete', reportedTotal: 2,
        sources: [source('following-list')],
        refreshFailure: null, creators: [0, 1].map((index) => ({
          uid: `uid-${index}`, secUid: `sec-${index}`, nickname: '合成作者', isFollowing: true })) },
      candidateCount: 6, creatorSampling: { considered: 2, available: 2, completeness: 'all-creators' },
      selectedCreatorSources: [0, 1].map((index) => ({
        creator: { uid: `uid-${index}`, secUid: `sec-${index}` }, completeness: 'complete',
        sources: [source('creator-work-list')]
      })),
      selectedWorkIds: results.map((item) => item.workId), results, failures: [],
      creatorFailures: [], requestTrace: [],
      performance: { durationMs: 100, totalRequests: 15, requestCounts: {}, p50RequestMs: 1, p95RequestMs: 2 } },
    shadowComparison: { status: 'pending-review', checkedWorkIds: [] },
    safety: { formalDatabaseTouched: false, rawResponsesPersisted: false,
      sensitiveValuesPersisted: false, writeRequestsIssued: false,
      mediaProcessingStarted: false, externalProvidersCalled: false } }
}

test('T2 isolated controller validates six work bindings and keeps shadow review pending', async () => {
  const parent = join(tmpdir(), 'signal-desk-r8')
  await mkdir(parent, { recursive: true })
  const output = await mkdtemp(join(parent, 't2-controller-test-'))
  const runId = output.split(/[\\/]/).at(-1)
  const token = randomBytes(32).toString('hex')
  const port = await freePort()
  const child = spawn(process.execPath, [resolve('poc/r8/t2-controller.mjs'),
    '--output', output, '--port', String(port), '--token', token,
    '--owner-sec-uid', 'owner-sec', '--catalog-path', join(output, 'catalog.sqlite')],
  { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const headers = { 'content-type': 'application/json', 'x-signaldesk-r8-token': token,
    'x-signaldesk-r8-client': 'signaldesk-r8-batch-isolated-extension' }
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((accept) => setTimeout(accept, 30))
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers })).ok) { ready = true; break } } catch {}
    }
    assert.equal(ready, true)
    const crossed = report(runId)
    crossed.result.results[0].comments[0].workId = 'other-work'
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(crossed)
    })).status, 400)
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(report(runId))
    })
    assert.equal(accepted.status, 201, await accepted.text())
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.classification, 'T2_NEEDS_SHADOW_REVIEW')
    assert.equal(manifest.formalDatabaseTouched, false)
  } finally {
    if (child.exitCode === null) {
      await new Promise((accept) => { child.once('exit', accept); child.kill() })
    }
    await rm(output, { recursive: true, force: true })
  }
})
