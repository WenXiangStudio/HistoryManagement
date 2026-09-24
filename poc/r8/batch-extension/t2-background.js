import { R8_CONFIG } from './session-config.js'
import { NetworkObserver } from './network-observer.js'
import { safeTemplateFromObservation, createR8BrowserRequest } from './r8-browser-transport.js'
import { collectR8Batch } from './r8-batch-core.js'

const CLIENT = 'signaldesk-r8-batch-isolated-extension'
let running = false

async function publish(patch) {
  const previous = (await chrome.storage.session.get('r8State')).r8State || {}
  await chrome.storage.session.set({ r8State: { ...previous, ...patch, updatedAt: new Date().toISOString() } })
}
function errorCode(error) {
  const message = String(error?.message || error)
  const safe = message.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 160)
  return /^[A-Z][A-Z0-9_-]{2,159}$/.test(safe) ? safe : 'UNKNOWN_FAILURE'
}
async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await chrome.tabs.get(tabId)).status === 'complete') return
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

async function runT2() {
  if (running) return
  running = true
  const startedAt = new Date().toISOString()
  let observer = null
  let result = null
  let failure = null
  let failureDiagnostic = null
  let ownerVerified = false
  let followingRequestFields = []
  const requestTrace = []
  let observerIssues = []
  try {
    if (!(await controller('/health')).ok) throw new Error('CONTROLLER_OFFLINE')
    const catalogResponse = await controller('/v1/catalog')
    if (!catalogResponse.ok) throw new Error('CATALOG_UNAVAILABLE')
    const catalog = await catalogResponse.json()
    if (catalog.ownerSecUid !== R8_CONFIG.ownerSecUid || !Array.isArray(catalog.creators)) {
      throw new Error('CATALOG_OWNER_MISMATCH')
    }
    const knownCreators = catalog.creators.map((item) => ({
      uid: item.uid, secUid: item.secUid, nickname: item.nickname
    }))
    await publish({ running: true, phase: 'prepare', message: '同一浏览器会话准备 6 个作品的结构化采集…' })
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    if (!tab.id) throw new Error('TAB_ID_MISSING')
    observer = new NetworkObserver({ debuggerApi: chrome.debugger, maxBufferedResponses: 120 })
    await observer.attach(tab.id)
    const firstUrl = knownCreators.length
      ? `https://www.douyin.com/user/${encodeURIComponent(knownCreators[0].secUid)}`
      : 'https://www.douyin.com/user/self?showTab=follow'
    await chrome.tabs.update(tab.id, { url: firstUrl, active: true })
    await waitForTab(tab.id)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (!knownCreators.length) {
      await chrome.tabs.sendMessage(tab.id, { type: 'signaldesk.r8.open-following-dialog' }).catch(() => null)
    }
    let snapshot
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      snapshot = await observer.snapshot()
      if (snapshot.observations.some((item) => item.endpointKind ===
        (knownCreators.length ? 'creator-work-list' : 'following-list'))) break
    }
    observerIssues = [...new Set(snapshot.issues.map((item) => String(item.code)))].sort()
    const seed = snapshot.observations.find((item) => item.endpointKind ===
      (knownCreators.length ? 'creator-work-list' : 'following-list'))
    if (!seed) throw new Error('REQUEST_TEMPLATE_NOT_OBSERVED')
    const observedTarget = seed.requestParameters.find((item) => item.name === 'sec_user_id')?.value
    if (knownCreators.length) {
      if (observedTarget !== knownCreators[0].secUid) throw new Error('KNOWN_CREATOR_ROUTE_MISMATCH')
    } else {
      if (observedTarget !== R8_CONFIG.ownerSecUid) throw new Error('OWNER_SEC_UID_CHANGED')
      followingRequestFields = seed.requestParameters.map((item) => item.name).sort()
      ownerVerified = true
      await observer.pauseCapture()
    }
    const template = safeTemplateFromObservation(seed)
    const templates = Object.fromEntries(['following-list', 'creator-work-list', 'work-detail',
      'comment-list', 'comment-reply-list'].map((kind) => [kind, template]))
    const browserRequest = createR8BrowserRequest({ debuggerApi: chrome.debugger, tabId: tab.id,
      templates, getTab: (id) => chrome.tabs.get(id) })
    let followingPrepared = !knownCreators.length
    const request = async (input) => {
      if (input.endpointKind === 'following-list' && !followingPrepared) {
        followingPrepared = true
        await chrome.tabs.update(tab.id, { url: 'https://www.douyin.com/user/self?showTab=follow', active: true })
        await waitForTab(tab.id)
        await new Promise((resolve) => setTimeout(resolve, 1200))
        await chrome.tabs.sendMessage(tab.id, { type: 'signaldesk.r8.open-following-dialog' }).catch(() => null)
        let observed = null
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const later = await observer.snapshot()
          observed = later.observations.find((item) => item.endpointKind === 'following-list')
          if (observed) break
        }
        if (!observed) throw new Error('OWNER_FOLLOWING_ROUTE_NOT_OBSERVED')
        const owner = observed.requestParameters.find((item) => item.name === 'sec_user_id')?.value
        if (owner !== R8_CONFIG.ownerSecUid) throw new Error('OWNER_SEC_UID_CHANGED')
        followingRequestFields = observed.requestParameters.map((item) => item.name).sort()
        ownerVerified = true
        await observer.pauseCapture()
        templates['following-list'] = safeTemplateFromObservation(observed)
      }
      return await browserRequest(input)
    }
    await publish({ phase: 'collect', message: '批量分页、详情与评论关系核对中…' })
    result = await collectR8Batch({ request, ownerSecUid: R8_CONFIG.ownerSecUid,
      knownCreators, traceSink: requestTrace,
      scope: { workLimit: 6, worksPerCreator: 3, commentsPerWork: 20,
        followingLimit: 300, pageSize: 20, concurrency: 3, maxPagesPerRoute: 30,
        seed: R8_CONFIG.seed } })
  } catch (error) { failure = errorCode(error); failureDiagnostic = error?.diagnostic ?? null }
  finally {
    if (observer) {
      const latest = await observer.snapshot().catch(() => null)
      if (latest) observerIssues = [...new Set(latest.issues.map((item) => String(item.code)))].sort()
    }
    if (observer) await observer.stop().catch(() => {})
    const report = { contract: 'signaldesk-r8-t2-shadow-report/v1', runId: R8_CONFIG.runId,
      stage: 'T2-shadow', startedAt, finishedAt: new Date().toISOString(),
      status: failure || !ownerVerified ? 'blocked'
        : result?.status === 'complete' && result.following.completeness === 'complete'
          && result.following.creators.length > 0 && result.results.length === 6
          ? 'structured-ready' : 'blocked',
      failure, failureDiagnostic, ownerVerified, followingRequestFields,
      requestTrace, observerIssueCodes: observerIssues,
      result: result ? {
        contract: result.contract, status: result.status, seed: result.seed,
        scope: result.scope, candidateCount: result.candidateCount,
        followingEvidence: { creatorCount: result.following.creators.length,
          creators: result.following.creators, completeness: result.following.completeness,
          reportedTotal: result.following.reportedTotal,
          sources: result.following.sources, refreshFailure: result.following.refreshFailure },
        creatorSampling: result.creatorSampling, selectedCreatorSources: result.selectedCreatorSources,
        selectedWorkIds: result.selectedWorkIds,
        results: result.results,
        failures: result.failures, creatorFailures: result.creatorFailures,
        requestTrace: result.requestTrace, performance: result.performance
      } : null,
      shadowComparison: { status: 'pending-review', checkedWorkIds: [] },
      safety: { formalDatabaseTouched: false, rawResponsesPersisted: false,
        sensitiveValuesPersisted: false, writeRequestsIssued: false,
        mediaProcessingStarted: false, externalProvidersCalled: false }
    }
    try {
      const response = await controller('/v1/report', { method: 'POST', body: JSON.stringify(report) })
      const outcome = await response.json()
      if (!response.ok) throw new Error('REPORT_REJECTED')
      await publish({ running: false, phase: 'complete', message: outcome.classification, outcome })
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
    if (running) { sendResponse({ accepted: false, error: 'T2 已在运行' }); return false }
    void runT2()
    sendResponse({ accepted: true })
  }
  return false
})
void publish({ running: false, phase: 'ready', message: 'T2 隔离验证等待自动启动' })
chrome.runtime.onInstalled.addListener(() => { void runT2() })
