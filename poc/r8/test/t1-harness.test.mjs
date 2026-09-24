import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

async function freePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const port = server.address().port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}

function entry(entryId, endpointKinds, url) {
  return {
    contract: 'signaldesk-r8-t1-entry/v1', entryId, status: 'observed', canonicalSourceUrl: url,
    observations: endpointKinds.map((endpointKind, index) => ({
      contract: 'signaldesk-r8-observation-summary/v1', routeId: `R8-ROUTE-${index}`,
      endpointKind, requestParameterNames: ['cursor'], schemaFingerprint: 'a'.repeat(64),
      projectionSha256: 'b'.repeat(64), observedAt: '2026-09-24T00:00:00.000Z',
      itemCount: 1, returnedIdCount: 1, hasMore: false, reportedTotal: 1, cursorPresent: false
    })),
    issueCodes: [], issueSummaries: [], trigger: { status: 'completed', entityCounts: {} },
    bridgePreview: { status: 'assembled', contract: 'synthetic-proof/v2', itemCount: 1 }
  }
}

function report(runId) {
  return {
    contract: 'signaldesk-r8-t1-discovery-report/v1', runId, stage: 'T1-discovery',
    startedAt: '2026-09-24T00:00:00.000Z', finishedAt: '2026-09-24T00:01:00.000Z',
    entries: [
      entry('following', ['following-list'], 'https://www.douyin.com/user/self'),
      entry('creator-works', ['creator-work-list'], 'https://www.douyin.com/user/public-sec-id'),
      entry('work-detail-comments', ['work-detail', 'comment-list'], 'https://www.douyin.com/video/public-work-id')
    ],
    identityBindings: {
      creatorId: 'public-creator-id', secCreatorId: 'public-sec-id',
      workId: 'public-work-id', observedWorkAuthorId: 'public-creator-id'
    },
    safety: {
      rawResponsesPersisted: false, sensitiveValuesPersisted: false,
      writeRequestsIssued: false, formalDatabaseTouched: false,
      mediaProcessingStarted: false, externalProvidersCalled: false
    }
  }
}

test('R8 T1 extension uses a separate identity and requests no credential/native/download permissions', async () => {
  const manifest = JSON.parse(await readFile(resolve('poc/r8/extension/manifest.json'), 'utf8'))
  assert.equal(manifest.name, 'Signal Desk R8 隔离验证器')
  assert.deepEqual(manifest.permissions.sort(), ['debugger', 'storage', 'tabs'])
  for (const forbidden of ['cookies', 'webRequest', 'nativeMessaging', 'downloads']) {
    assert.equal(manifest.permissions.includes(forbidden), false)
  }
  assert.equal(Object.hasOwn(manifest, 'key'), false)
  assert.deepEqual(manifest.host_permissions.sort(), ['http://127.0.0.1/*', 'https://www.douyin.com/*'])
})

test('R8 T1 controller rejects sensitive/query artifacts and writes one bounded discovery run', async () => {
  const parent = join(tmpdir(), 'signal-desk-r8')
  await mkdir(parent, { recursive: true })
  const output = await mkdtemp(join(parent, 'controller-test-'))
  await mkdir(join(output, 'extension'))
  const runId = output.split(/[\\/]/).at(-1)
  const port = await freePort()
  const token = randomBytes(32).toString('hex')
  const child = spawn(process.execPath, [
    resolve('poc/r8/controller.mjs'), '--output', output, '--port', String(port), '--token', token
  ], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  const headers = {
    'content-type': 'application/json',
    'x-signaldesk-r8-token': token,
    'x-signaldesk-r8-client': 'signaldesk-r8-isolated-extension'
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40))
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { headers })
        if (response.ok) { ready = true; break }
      } catch {}
    }
    assert.equal(ready, true, stderr)

    const unsafe = report(runId)
    unsafe.entries[0].canonicalSourceUrl = 'https://www.douyin.com/user/self?token=secret'
    const rejected = await fetch(`http://127.0.0.1:${port}/v1/t1-report`, {
      method: 'POST', headers, body: JSON.stringify(unsafe)
    })
    assert.equal(rejected.status, 400)

    const unsafeOutline = report(runId)
    unsafeOutline.entries[2].issueSummaries.push({
      code: 'SCHEMA_CHANGED', routeId: 'DY-COMMENT-NETWORK', endpointKind: 'comment-list',
      schemaFingerprint: 'c'.repeat(64), pathSha256: null, discoveryPathname: null,
      discoverySchemaOutline: { rawBody: 'secret' }
    })
    const rejectedOutline = await fetch(`http://127.0.0.1:${port}/v1/t1-report`, {
      method: 'POST', headers, body: JSON.stringify(unsafeOutline)
    })
    assert.equal(rejectedOutline.status, 400)

    const unsafePagination = report(runId)
    unsafePagination.entries[0].observations[0].discoveryPaginationOutline = { cursor: 'SECRET_CURSOR_VALUE' }
    const rejectedPagination = await fetch(`http://127.0.0.1:${port}/v1/t1-report`, {
      method: 'POST', headers, body: JSON.stringify(unsafePagination)
    })
    assert.equal(rejectedPagination.status, 400)

    const accepted = await fetch(`http://127.0.0.1:${port}/v1/t1-report`, {
      method: 'POST', headers, body: JSON.stringify(report(runId))
    })
    assert.equal(accepted.status, 201, await accepted.text())
    const artifacts = await readdir(output)
    for (const required of [
      'manifest.json', 'route-trace.json', 'schema-fingerprints.json',
      'source-proof-summary.json', 't1-report.json', 'acceptance-report.md'
    ]) assert.equal(artifacts.includes(required), true, required)
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.status, 'T1_READY_FOR_T2_REVIEW')
    assert.equal(manifest.evidenceLevel, 'endpoint-schema-discovery-only')
    assert.equal(manifest.formalDatabaseTouched, false)
    const allPersisted = await Promise.all(artifacts.filter((name) => /\.(?:json|md)$/.test(name))
      .map((name) => readFile(join(output, name), 'utf8')))
    assert.doesNotMatch(allPersisted.join('\n'), /Cookie|Authorization|Bearer|msToken|a_bogus|verifyFp/i)
    const expiredConfig = await readFile(join(output, 'extension', 'session-config.js'), 'utf8')
    assert.match(expiredConfig, /EXPIRED_AFTER_REPORT/)
    assert.doesNotMatch(expiredConfig, new RegExp(token))
  } finally {
    if (child.exitCode === null) child.kill()
    await rm(output, { recursive: true, force: true })
  }
})
