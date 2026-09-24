import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import {
  NETWORK_ROUTE_DEFINITIONS,
  NetworkObserver,
  classifyStructuredResponse,
  projectStructuredResponse,
  projectionSha256,
  schemaFingerprint
} from '../browser-connector/extension/network-observer.js'

const fixture = JSON.parse(await readFile(
  new URL('../browser-connector/extension/fixtures/network-observer.synthetic.json', import.meta.url),
  'utf8'
))
const fixedNow = () => new Date('2026-09-06T02:00:00.000Z')

class MockDebugger {
  constructor(responses = fixture.responses) {
    this.calls = []
    this.listeners = new Set()
    this.bodies = new Map(responses.map((entry) => [entry.requestId, JSON.stringify(entry.body)]))
    this.onEvent = {
      addListener: (listener) => this.listeners.add(listener),
      removeListener: (listener) => this.listeners.delete(listener)
    }
  }

  async attach(target, version) {
    this.calls.push({ method: 'attach', target, version })
  }

  async sendCommand(target, method, params) {
    this.calls.push({ method, target, params })
    if (method === 'Network.getResponseBody') {
      const body = this.bodies.get(params.requestId)
      if (body === undefined) throw new Error(`No synthetic body for ${params.requestId}`)
      return { body, base64Encoded: false }
    }
    return {}
  }

  async detach(target) {
    this.calls.push({ method: 'detach', target })
  }

  emit(tabId, method, params) {
    for (const listener of [...this.listeners]) listener({ tabId }, method, params)
  }
}

function emitLifecycle(debuggerApi, entry, overrides = {}) {
  const requestId = overrides.requestId ?? entry.requestId
  const url = overrides.url ?? entry.url
  debuggerApi.emit(17, 'Network.requestWillBeSent', {
    requestId,
    request: { method: overrides.method ?? 'GET', url }
  })
  debuggerApi.emit(17, 'Network.responseReceived', {
    requestId,
    type: overrides.type ?? 'Fetch',
    response: {
      status: overrides.status ?? 200,
      mimeType: overrides.mimeType ?? 'application/json',
      headers: overrides.headers ?? { 'content-type': 'application/json' }
    }
  })
  debuggerApi.emit(17, 'Network.loadingFinished', {
    requestId,
    encodedDataLength: overrides.encodedDataLength ?? 128
  })
}

test('the classifier recognizes all six registered path + schema pairs', () => {
  assert.equal(fixture.fixture, 'signaldesk-network-observer-synthetic/v1')
  assert.equal(NETWORK_ROUTE_DEFINITIONS.length, 6)
  for (const entry of fixture.responses) {
    const classification = classifyStructuredResponse(new URL(entry.url).pathname, entry.body)
    assert.equal(classification.disposition, 'accepted', entry.endpointKind)
    assert.equal(classification.endpointKind, entry.endpointKind)
    assert.equal(classification.routeId, entry.routeId)
  }
})

test('schema fingerprint ignores values but changes with types, and projection hash is canonical', async () => {
  const first = fixture.responses[1].body
  const changedValues = structuredClone(first)
  changedValues.aweme_list[0].aweme_id = 'synthetic-work-other'
  changedValues.aweme_list[0].statistics.digg_count = 999
  assert.equal(await schemaFingerprint(first, webcrypto), await schemaFingerprint(changedValues, webcrypto))

  const changedType = structuredClone(first)
  changedType.cursor = '20'
  assert.notEqual(await schemaFingerprint(first, webcrypto), await schemaFingerprint(changedType, webcrypto))
  assert.equal(await projectionSha256({ b: 2, a: 1 }, webcrypto), await projectionSha256({ a: 1, b: 2 }, webcrypto))
})

test('mock CDP captures six projections, attaches before navigation, then detaches and clears listeners', async () => {
  const debuggerApi = new MockDebugger()
  const observer = new NetworkObserver({ debuggerApi, now: fixedNow, cryptoImplementation: webcrypto })
  const sequence = []
  await observer.attach(17)
  sequence.push(...debuggerApi.calls.slice(0, 2).map((entry) => entry.method), 'navigate')
  assert.deepEqual(sequence, ['attach', 'Network.enable', 'navigate'])

  fixture.responses.forEach((entry) => emitLifecycle(debuggerApi, entry))
  const snapshot = await observer.stop()
  assert.equal(snapshot.observations.length, 6)
  assert.equal(snapshot.issues.length, 0)
  assert.deepEqual(snapshot.observations.map((entry) => entry.endpointKind).sort(), fixture.responses.map((entry) => entry.endpointKind).sort())
  assert.equal(debuggerApi.listeners.size, 0)
  assert.equal(debuggerApi.calls.at(-1).method, 'detach')

  const persisted = JSON.stringify(snapshot)
  assert.doesNotMatch(persisted, /LEAK_/)
  assert.doesNotMatch(persisted, /X-Bogus|msToken|authorization|access_token|session_token|raw_headers/i)
  assert.doesNotMatch(persisted, /https:\/\//i)
  assert.match(snapshot.observations.find((entry) => entry.endpointKind === 'media-resource').projection.items[0].resources[0].urlSha256[0], /^[a-f0-9]{64}$/)

  assert.deepEqual(await observer.stop(), { observations: [], issues: [] })
})

test('evicted inspector response is attributed to its route and does not reject the observer task', async () => {
  const debuggerApi = new MockDebugger()
  const original = debuggerApi.sendCommand.bind(debuggerApi)
  debuggerApi.sendCommand = async (target, method, params) => {
    if (method === 'Network.getResponseBody') {
      throw Object.assign(new Error('Request content was evicted from inspector cache'), { code: -32000 })
    }
    return original(target, method, params)
  }
  const observer = new NetworkObserver({ debuggerApi, now: fixedNow, cryptoImplementation: webcrypto })
  await observer.attach(17)
  emitLifecycle(debuggerApi, fixture.responses.find((entry) => entry.endpointKind === 'following-list'))
  const snapshot = await observer.stop()
  assert.equal(snapshot.observations.length, 0)
  assert.deepEqual(snapshot.issues.map((entry) => ({ code: entry.code, routeId: entry.routeId })),
    [{ code: 'RESPONSE_BODY_EVICTED', routeId: 'DY-FOLLOW-NETWORK' }])
  assert.doesNotMatch(JSON.stringify(snapshot), /evicted from inspector cache|requestId|url/i)
})

test('reply projection uses a real relationship field when another field is a zero sentinel', async () => {
  const reply = fixture.responses.find((entry) => entry.endpointKind === 'comment-reply-list')
  const body = structuredClone(reply.body)
  body.comments[0].reply_to_comment_id = '0'
  body.comments[0].parent_comment_id = 'synthetic-comment-1'
  body.comments[0].root_comment_id = '0'
  body.comments[0].reply_id = 'synthetic-comment-1'
  const projected = await projectStructuredResponse('comment-reply-list', body, webcrypto)
  assert.equal(projected.items[0].rootCommentId, 'synthetic-comment-1')
  assert.equal(projected.items[0].parentCommentId, 'synthetic-comment-1')
  assert.equal(projected.items[0].rootCommentIdSourceField, 'reply_id')
  assert.equal(projected.items[0].parentCommentIdSourceField, 'parent_comment_id')
  assert.equal(projected.items[0].relationshipFieldConflict, false)
})

test('known-path schema changes stop the route and known-schema path variants stay quarantined', async () => {
  const knownPath = new URL(fixture.responses[1].url).pathname
  assert.equal(classifyStructuredResponse(knownPath, { status_code: 0, unexpected: [] }).disposition, 'schema-changed')
  assert.equal(classifyStructuredResponse('/aweme/v1/web/comment/future/', fixture.responses[3].body).disposition, 'unrecognized-path')

  const debuggerApi = new MockDebugger()
  debuggerApi.bodies.set('known-schema-new-path', JSON.stringify(fixture.responses[3].body))
  debuggerApi.bodies.set('known-path-new-schema', JSON.stringify({ status_code: 0, unexpected: [] }))
  const observer = new NetworkObserver({ debuggerApi, now: fixedNow, cryptoImplementation: webcrypto })
  await observer.attach(17)
  emitLifecycle(debuggerApi, fixture.responses[3], {
    requestId: 'known-schema-new-path',
    url: 'https://www.douyin.com/aweme/v1/web/comment/future/?token=LEAK_VARIANT'
  })
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'known-path-new-schema' })
  const snapshot = await observer.stop()
  assert.equal(snapshot.observations.length, 0)
  assert.deepEqual(snapshot.issues.map((entry) => entry.code).sort(), [
    'SCHEMA_CHANGED',
    'UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA'
  ])
  assert.match(snapshot.issues.find((entry) => entry.code.startsWith('UNRECOGNIZED')).pathSha256, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(snapshot), /future|LEAK_VARIANT|https:\/\//)

  const discoveryDebugger = new MockDebugger()
  discoveryDebugger.bodies.set('discovery-path', JSON.stringify(fixture.responses[3].body))
  const discoveryObserver = new NetworkObserver({
    debuggerApi: discoveryDebugger,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    includeSafeDiscoveryPathnames: true
  })
  await discoveryObserver.attach(17)
  emitLifecycle(discoveryDebugger, fixture.responses[3], {
    requestId: 'discovery-path',
    url: 'https://www.douyin.com/aweme/v1/web/comment/future/?token=NEVER_PERSIST'
  })
  const discoverySnapshot = await discoveryObserver.stop()
  assert.equal(discoverySnapshot.issues[0].discoveryPathname, '/aweme/v1/web/comment/future/')
  assert.doesNotMatch(JSON.stringify(discoverySnapshot), /NEVER_PERSIST|https:\/\//)

  const largeDebugger = new MockDebugger()
  const largeObserver = new NetworkObserver({
    debuggerApi: largeDebugger,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    maxBodyBytes: 512,
    includeSafeDiscoveryPathnames: true
  })
  await largeObserver.attach(17)
  emitLifecycle(largeDebugger, fixture.responses[1], {
    requestId: 'large-unknown-path',
    url: 'https://www.douyin.com/aweme/v1/web/background/big/?token=NEVER_PERSIST',
    headers: { 'content-type': 'application/json', 'content-length': '513' }
  })
  const largeSnapshot = await largeObserver.stop()
  assert.equal(largeSnapshot.issues[0].code, 'RESPONSE_TOO_LARGE')
  assert.equal(largeSnapshot.issues[0].discoveryPathname, '/aweme/v1/web/background/big/')
  assert.match(largeSnapshot.issues[0].pathSha256, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(largeSnapshot), /NEVER_PERSIST|https:\/\//)

  const paginationDebugger = new MockDebugger()
  const paginationObserver = new NetworkObserver({
    debuggerApi: paginationDebugger,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    includeSafeDiscoveryPathnames: true
  })
  await paginationObserver.attach(17)
  emitLifecycle(paginationDebugger, fixture.responses[0])
  const paginationSnapshot = await paginationObserver.stop()
  assert.equal(paginationSnapshot.observations[0].discoveryPaginationOutline.hasMore, 'integer')
  assert.equal(paginationSnapshot.observations[0].discoveryPaginationOutline.nextCursor, 'missing')

  const changedCommentDebugger = new MockDebugger()
  changedCommentDebugger.bodies.set('changed-comment', JSON.stringify({
    status_code: 0,
    comments: [{ cid: 'public-cid', text: 'SECRET_COMMENT_TEXT', user: { uid: 'public-user' } }],
    cursor: 0, has_more: 0, total: 1
  }))
  const changedCommentObserver = new NetworkObserver({
    debuggerApi: changedCommentDebugger,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    includeSafeDiscoveryPathnames: true
  })
  await changedCommentObserver.attach(17)
  emitLifecycle(changedCommentDebugger, fixture.responses[3], {
    requestId: 'changed-comment',
    url: 'https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=SECRET_TARGET'
  })
  const changedCommentSnapshot = await changedCommentObserver.stop()
  const outline = changedCommentSnapshot.issues[0].discoverySchemaOutline
  assert.equal(outline.comments, 'array')
  assert.equal(outline.firstComment.cid, 'string')
  assert.equal(outline.firstComment.awemeId, 'missing')
  assert.deepEqual(outline.relationshipClasses.replyId, ['missing'])
  assert.deepEqual(outline.relationshipClasses.rootCommentId, ['missing'])
  assert.doesNotMatch(JSON.stringify(changedCommentSnapshot), /SECRET_COMMENT_TEXT|SECRET_TARGET|public-cid|public-user/)
})

test('empty root-comment and reply pages remain distinguishable by their registered paths', () => {
  const emptyPage = { status_code: 0, comments: [], cursor: 0, has_more: 0, total: 0 }
  const root = classifyStructuredResponse('/aweme/v1/web/comment/list/', emptyPage)
  const replies = classifyStructuredResponse('/aweme/v1/web/comment/list/reply/', emptyPage)
  assert.equal(root.disposition, 'accepted')
  assert.equal(root.endpointKind, 'comment-list')
  assert.equal(replies.disposition, 'accepted')
  assert.equal(replies.endpointKind, 'comment-reply-list')
})

test('invalid content, excessive bodies, malformed JSON, non-GET and foreign hosts fail closed', async () => {
  const debuggerApi = new MockDebugger()
  debuggerApi.bodies.set('malformed', '{')
  const observer = new NetworkObserver({
    debuggerApi,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    maxBodyBytes: 512
  })
  await observer.attach(17)
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'wrong-content', mimeType: 'text/html', headers: { 'content-type': 'text/html' } })
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'too-large', headers: { 'content-type': 'application/json', 'content-length': '513' } })
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'malformed' })
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'post', method: 'POST' })
  emitLifecycle(debuggerApi, fixture.responses[1], { requestId: 'foreign', url: 'https://douyin.com.example.test/aweme/v1/web/aweme/post/' })
  const snapshot = await observer.stop()
  assert.equal(snapshot.observations.length, 0)
  assert.deepEqual(snapshot.issues.map((entry) => entry.code).sort(), [
    'INVALID_CONTENT_TYPE',
    'MALFORMED_JSON',
    'RESPONSE_TOO_LARGE'
  ])
  assert.equal(debuggerApi.calls.filter((entry) => entry.method === 'Network.getResponseBody').length, 1)
})

test('the in-memory request/response buffer is bounded and is empty after detach', async () => {
  const debuggerApi = new MockDebugger()
  const observer = new NetworkObserver({
    debuggerApi,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    maxBufferedResponses: 2
  })
  await observer.attach(17)
  for (const requestId of ['buffer-1', 'buffer-2', 'buffer-3']) {
    debuggerApi.emit(17, 'Network.requestWillBeSent', {
      requestId,
      request: { method: 'GET', url: fixture.responses[1].url }
    })
  }
  const snapshot = await observer.stop()
  assert.deepEqual(snapshot.issues.map((entry) => entry.code), ['BUFFER_LIMIT_REACHED'])
  assert.equal(observer.requestMetadata.size, 0)
  assert.equal(observer.responseMetadata.size, 0)
  assert.equal(observer.observations.length, 0)
  assert.equal(observer.issues.length, 0)
})

test('completed observation output is bounded as well as in-flight request metadata', async () => {
  const debuggerApi = new MockDebugger()
  const observer = new NetworkObserver({
    debuggerApi,
    now: fixedNow,
    cryptoImplementation: webcrypto,
    maxBufferedResponses: 2
  })
  await observer.attach(17)
  fixture.responses.slice(0, 3).forEach((entry) => emitLifecycle(debuggerApi, entry))
  const snapshot = await observer.stop()
  assert.ok(snapshot.observations.length + snapshot.issues.length <= 2)
  assert.ok(snapshot.issues.some((entry) => entry.code === 'BUFFER_LIMIT_REACHED'))
})
