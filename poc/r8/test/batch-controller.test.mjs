import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
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
function report(runId) {
  const route = (endpointKind) => ({ status: 'observed', endpointKind,
    schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64),
    itemCount: 1, paginationKnown: true, cursorField: 'cursor', hasMore: false })
  return { contract: 'signaldesk-r8-batch-t1-report/v1', runId, stage: 'T1-discovery',
    startedAt: '2026-09-24T00:00:00.000Z', finishedAt: '2026-09-24T00:01:00.000Z',
    trigger: 'completed', identity: { ownerSecUid: 'owner-sec', creatorUid: 'creator-uid',
      creatorSecUid: 'creator-sec', workId: 'work-1' },
    routes: Object.fromEntries(['following-list', 'creator-work-list', 'work-detail', 'comment-list']
      .map((kind) => [kind, route(kind)])),
    observer: { observedEndpointKinds: ['following-list'], issueCodes: [], seedSource: 'following-list' },
    safety: { formalDatabaseTouched: false, writeRequestsIssued: false,
      rawResponsesPersisted: false, sensitiveValuesPersisted: false } }
}

test('batch T1 controller accepts one safe discovery report and rejects credential fields', async () => {
  const manifest = JSON.parse(await readFile(resolve('poc/r8/batch-extension/manifest.json'), 'utf8'))
  assert.deepEqual(manifest.permissions.sort(), ['debugger', 'storage', 'tabs'])
  assert.equal(Object.hasOwn(manifest, 'key'), false)
  const parent = join(tmpdir(), 'signal-desk-r8')
  await mkdir(parent, { recursive: true })
  const output = await mkdtemp(join(parent, 'batch-controller-test-'))
  const runId = output.split(/[\\/]/).at(-1)
  const port = await freePort()
  const token = randomBytes(32).toString('hex')
  const child = spawn(process.execPath, [resolve('poc/r8/batch-controller.mjs'),
    '--output', output, '--port', String(port), '--token', token],
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
    const unsafe = report(runId)
    unsafe.routes['following-list'].cookie = 'secret'
    const rejected = await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(unsafe)
    })
    assert.equal(rejected.status, 400)
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/report`, {
      method: 'POST', headers, body: JSON.stringify(report(runId))
    })
    assert.equal(accepted.status, 201, await accepted.text())
    const result = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(result.classification, 'T1_DISCOVERED')
    assert.equal(result.readyForT2Review, true)
    assert.equal(result.formalDatabaseTouched, false)
  } finally {
    child.kill()
    await rm(output, { recursive: true, force: true })
  }
})
