import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { VerifiedCreatorCatalog } from '../verified-catalog.mjs'

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}
function report(runId, override = {}) {
  const result = { contract: 'signaldesk-homepage-pilot/v1',
    creator: { uid: 'uid-1', secUid: 'sec-1', profileUrl: 'https://www.douyin.com/user/sec-1' },
    status: 'blocked', stage: 'profile', navigationCount: 0, activeApiRequests: 0,
    candidates: [], verifiedWork: null, workProof: null, detailProof: null,
    comments: 'not-requested', replies: 'not-requested', reason: 'PAGE_SECURITY_OR_LOGIN_PROMPT',
    ...override }
  return { contract: 'signaldesk-homepage-pilot-report/v1', runId,
    startedAt: '2026-09-24T00:00:00.000Z', finishedAt: '2026-09-24T00:01:00.000Z',
    result, observerIssueCodes: [], safety: { formalDatabaseTouched: false,
      activeApiRequests: 0, mediaProcessingStarted: false, externalProvidersCalled: false } }
}

test('homepage controller serves only verified catalog and accepts one bounded report', async () => {
  const parent = join(tmpdir(), 'signal-desk-r8')
  await mkdir(parent, { recursive: true })
  const output = await mkdtemp(join(parent, 'homepage-controller-test-'))
  const checked = relative(resolve(tmpdir()), resolve(output))
  if (!checked || checked.startsWith('..') || isAbsolute(checked)) throw new Error('test path invalid')
  const runId = output.split(/[\\/]/).at(-1)
  const catalogPath = join(output, 'catalog.sqlite')
  const catalog = new VerifiedCreatorCatalog(catalogPath)
  catalog.bindOwner('owner-sec', '2026-09-24T00:00:00.000Z')
  catalog.upsertFollowing('owner-sec', { uid: 'uid-1', secUid: 'sec-1',
    nickname: '合成作者', isFollowing: true }, '2026-09-24T00:00:00.000Z')
  catalog.close()
  const token = randomBytes(32).toString('hex')
  const port = await freePort()
  const child = spawn(process.execPath, [resolve('poc/r8/homepage-pilot-controller.mjs'),
    '--output', output, '--port', String(port), '--token', token,
    '--owner-sec-uid', 'owner-sec', '--catalog-path', catalogPath],
  { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const headers = { 'content-type': 'application/json', 'x-signaldesk-r8-token': token,
    'x-signaldesk-r8-client': 'signaldesk-homepage-pilot-extension' }
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((accept) => setTimeout(accept, 30))
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers })).ok) { ready = true; break } } catch {}
    }
    assert.equal(ready, true)
    const catalogResponse = await fetch(`http://127.0.0.1:${port}/v1/catalog`, { headers })
    const listing = await catalogResponse.json()
    assert.equal(listing.creators.length, 1)
    assert.equal(listing.creators[0].profileUrl, 'https://www.douyin.com/user/sec-1')
    const unsafe = report(runId, { activeApiRequests: 1 })
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(unsafe) })).status, 400)
    const forgedWork = report(runId, { status: 'verified', stage: 'work-detail', navigationCount: 2,
      candidates: [{ workId: '1234567890123', url: 'https://www.douyin.com/video/1234567890123',
        status: 'page-visible-candidate' }],
      verifiedWork: { workId: '1234567890123', workIdKind: 'native-aweme-id',
        workIdSourcePath: 'aweme_detail.aweme_id', authorId: 'someone-else', authorSecId: 'sec-1',
        nickname: '错误作者', authorIdSourcePath: 'aweme_detail.author.uid',
        workType: 'video', title: '作品', description: '内容', publishedAt: null,
        durationMs: null, statistics: { likeCount: 1, commentCount: 0,
          collectCount: 0, shareCount: 0, playCount: null } },
      workProof: { routeId: 'DY-WORKS-NETWORK', endpointKind: 'creator-work-list',
        schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64),
        observedAt: '2026-09-24T00:00:00.000Z' },
      detailProof: { routeId: 'DY-DETAIL-NETWORK', endpointKind: 'work-detail',
        schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64),
        observedAt: '2026-09-24T00:00:01.000Z' }, reason: null })
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(forgedWork) })).status, 400)
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(report(runId)) })
    assert.equal(accepted.status, 201, await accepted.text())
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.status, 'blocked')
    assert.equal(manifest.activeApiRequests, 0)
    assert.equal(manifest.formalDatabaseTouched, false)
  } finally {
    if (child.exitCode === null) await new Promise((accept) => { child.once('exit', accept); child.kill() })
    await rm(output, { recursive: true, force: true })
  }
})
