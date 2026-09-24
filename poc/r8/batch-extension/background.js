import { R8_CONFIG } from './session-config.js'
import { NetworkObserver, classifyStructuredResponse, projectStructuredResponse, projectionSha256, schemaFingerprint } from './network-observer.js'
import { createR8BrowserRequest, safeTemplateFromObservation } from './r8-browser-transport.js'

let running = false
const CLIENT = 'signaldesk-r8-batch-isolated-extension'
const KINDS = ['following-list', 'creator-work-list', 'work-detail', 'comment-list']
const PATHS = {
  'following-list': ['/aweme/v1/web/user/following/list/', 'DY-FOLLOW-NETWORK'],
  'creator-work-list': ['/aweme/v1/web/aweme/post/', 'DY-WORKS-NETWORK'],
  'work-detail': ['/aweme/v1/web/aweme/detail/', 'DY-DETAIL-NETWORK'],
  'comment-list': ['/aweme/v1/web/comment/list/', 'DY-COMMENT-NETWORK']
}

async function publish(patch) {
  const prior = (await chrome.storage.session.get('r8State')).r8State || {}
  await chrome.storage.session.set({ r8State: { ...prior, ...patch, updatedAt: new Date().toISOString() } })
}
function code(error) {
  const value = error?.code || String(error?.message || error)
  return String(value).match(/[A-Z][A-Z0-9_-]{2,80}/)?.[0] || 'UNEXPECTED_FAILURE'
}
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,240}$/.test(value) ? value : null }
function safeSummary(kind, projection, fingerprint, hash) {
  return { endpointKind: kind, schemaFingerprint: fingerprint, projectionSha256: hash,
    itemCount: Array.isArray(projection.items) ? projection.items.length : projection.item ? 1 : 0,
    paginationKnown: projection.paginationKnown === true,
    cursorField: projection.cursorField ?? null,
    hasMore: projection.hasMore === true }
}
async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('TAB_LOAD_TIMEOUT')
}
async function controller(path, init = {}) {
  return await fetch(`${R8_CONFIG.controllerOrigin}${path}`, {
    ...init, cache: 'no-store', headers: { 'content-type': 'application/json',
      'x-signaldesk-r8-token': R8_CONFIG.token, 'x-signaldesk-r8-client': CLIENT }
  })
}

async function run() {
  if (running) throw new Error('T1_ALREADY_RUNNING')
  running = true
  const startedAt = new Date().toISOString()
  const routes = Object.fromEntries(KINDS.map((kind) => [kind, { status: 'not-run' }]))
  const identity = { ownerSecUid: null, creatorUid: null, creatorSecUid: null, workId: null }
  const observerSummary = { observedEndpointKinds: [], issueCodes: [], seedSource: 'none' }
  let trigger = 'not-run'
  let tabId = null
  let observer = null
  try {
    await publish({ running: true, phase: 'discover', message: '单会话观察关注接口…' })
    const health = await controller('/health')
    if (!health.ok) throw new Error('CONTROLLER_OFFLINE')
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    if (!tab.id) throw new Error('TAB_ID_MISSING')
    tabId = tab.id
    observer = new NetworkObserver({ debuggerApi: chrome.debugger, maxBufferedResponses: 120,
      includeSafeDiscoveryPathnames: true })
    await observer.attach(tabId)
    await chrome.tabs.update(tabId, { url: 'https://www.douyin.com/user/self?showTab=follow', active: true })
    await waitForTab(tabId)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const opened = await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.r8.open-following-dialog' })
    trigger = opened?.ok ? 'completed' : String(opened?.code || 'FOLLOWING_TRIGGER_FAILED')
    let snapshot
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      snapshot = await observer.snapshot()
      if (snapshot.observations.some((item) => item.endpointKind === 'following-list'
        || item.endpointKind === 'creator-work-list')) break
    }
    observerSummary.observedEndpointKinds = [...new Set(snapshot.observations.map((item) => item.endpointKind))].sort()
    observerSummary.issueCodes = [...new Set(snapshot.issues.map((item) => item.code))].sort()
    const first = snapshot.observations.find((item) => item.endpointKind === 'following-list'
      && item.routeId === 'DY-FOLLOW-NETWORK')
      || snapshot.observations.find((item) => item.endpointKind === 'creator-work-list'
        && item.routeId === 'DY-WORKS-NETWORK')
    if (!first) throw new Error('OWNER_REQUEST_NOT_OBSERVED')
    observerSummary.seedSource = first.endpointKind
    const owner = first.requestParameters.find((item) => item.name === 'sec_user_id')?.value
    identity.ownerSecUid = safeId(owner)
    if (!identity.ownerSecUid) throw new Error('OWNER_SEC_UID_NOT_OBSERVED')
    const template = safeTemplateFromObservation(first)
    const templates = Object.fromEntries(KINDS.map((kind) => [kind, template]))
    const request = createR8BrowserRequest({ debuggerApi: chrome.debugger, tabId,
      templates, getTab: (id) => chrome.tabs.get(id) })

    async function probe(kind, target, cursor = '0', cursorField = null) {
      const [path, routeId] = PATHS[kind]
      let httpStatus = null
      try {
        const response = await request({ routeId, endpointKind: kind, path, target, cursor,
          cursorField, count: 20, method: 'GET' })
        httpStatus = Number.isSafeInteger(response.status) ? response.status : null
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error('LOGIN_REQUIRED'), { code: 'LOGIN_REQUIRED' })
        if (response.status === 429) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' })
        if (response.status !== 200) throw Object.assign(new Error('HTTP_REJECTED'), { code: 'HTTP_REJECTED' })
        if (!response.body || typeof response.body !== 'object') throw new Error('EMPTY_OR_NON_JSON_RESPONSE')
        if ((response.body.status_code ?? response.body.data?.status_code) !== 0) throw new Error('PLATFORM_STATUS_REJECTED')
        const classification = classifyStructuredResponse(path, response.body)
        if (classification.disposition !== 'accepted' || classification.endpointKind !== kind) throw new Error('SCHEMA_CHANGED')
        const projection = await projectStructuredResponse(kind, response.body)
        const summary = safeSummary(kind, projection, await schemaFingerprint(response.body), await projectionSha256(projection))
        routes[kind] = { status: 'observed', ...summary }
        return projection
      } catch (error) {
        routes[kind] = { status: 'blocked', code: code(error), httpStatus }
        return null
      }
    }

    await publish({ phase: 'read', message: '同一浏览器会话试读四类只读接口…' })
    const following = await probe('following-list', { secUserId: identity.ownerSecUid })
    if (following?.hasMore === true) {
      if (following.paginationKnown && following.cursorField && /^\d+$/.test(String(following.cursorOut ?? ''))) {
        const firstSummary = routes['following-list']
        const second = await probe('following-list', { secUserId: identity.ownerSecUid }, String(following.cursorOut), following.cursorField)
        routes['following-list'] = second ? { ...firstSummary, secondPage: 'observed' }
          : { ...firstSummary, secondPage: 'blocked', secondPageCode: routes['following-list'].code }
      } else routes['following-list'].secondPage = 'pagination-shape-unverified'
    }
    const creator = following?.items?.find((item) => safeId(item.creatorId) && safeId(item.secCreatorId))
      || (first.endpointKind === 'following-list'
        ? first.projection.items?.find((item) => safeId(item.creatorId) && safeId(item.secCreatorId)) : null)
    identity.creatorUid = safeId(creator?.creatorId)
    identity.creatorSecUid = safeId(creator?.secCreatorId)
    if (identity.creatorSecUid) {
      const works = await probe('creator-work-list', { secUserId: identity.creatorSecUid })
      const work = works?.items?.find((item) => safeId(item.workId)
        && item.authorId === identity.creatorUid && item.authorSecId === identity.creatorSecUid)
      identity.workId = safeId(work?.workId)
      if (identity.workId) {
        await probe('work-detail', { workId: identity.workId })
        await probe('comment-list', { workId: identity.workId })
      } else {
        routes['work-detail'] = { status: 'blocked', code: 'WORK_SEED_NOT_OBSERVED' }
        routes['comment-list'] = { status: 'blocked', code: 'WORK_SEED_NOT_OBSERVED' }
      }
    } else routes['creator-work-list'] = { status: 'blocked', code: 'CREATOR_SEED_NOT_OBSERVED' }
  } catch (error) {
    const failure = code(error)
    for (const kind of KINDS) if (routes[kind].status === 'not-run') routes[kind] = { status: 'blocked', code: failure }
  } finally {
    if (observer) await observer.stop().catch(() => {})
    const report = { contract: 'signaldesk-r8-batch-t1-report/v1', runId: R8_CONFIG.runId,
      stage: 'T1-discovery', startedAt, finishedAt: new Date().toISOString(), trigger,
      identity, routes, observer: observerSummary,
      safety: { formalDatabaseTouched: false, writeRequestsIssued: false,
        rawResponsesPersisted: false, sensitiveValuesPersisted: false } }
    try {
      const response = await controller('/v1/report', { method: 'POST', body: JSON.stringify(report) })
      const result = await response.json()
      if (!response.ok) throw new Error('REPORT_REJECTED')
      await publish({ running: false, phase: 'complete', message: result.classification, result })
    } catch { await publish({ running: false, phase: 'report-failed', message: '隔离报告提交失败' }) }
    running = false
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'r8.state') {
    chrome.storage.session.get('r8State').then(({ r8State }) => sendResponse(r8State || { running: false, phase: 'ready' }))
    return true
  }
  if (message?.type === 'r8.start-t1') {
    if (running) { sendResponse({ accepted: false, error: 'T1 已在运行' }); return false }
    void run()
    sendResponse({ accepted: true })
  }
  return false
})
void publish({ running: false, phase: 'ready', message: '一次启动，单会话只读验证' })
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void run()
})
