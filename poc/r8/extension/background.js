import { R8_CONFIG } from './session-config.js'
import { NetworkObserver } from './network-observer.js'
import { buildV2BusinessEnvelope } from './production-envelope-bridge.js'

const CLIENT = 'signaldesk-r8-isolated-extension'
const REQUIRED_ENTRY_IDS = ['following', 'creator-works', 'work-detail-comments']
let running = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function publish(patch) {
  const current = (await chrome.storage.session.get('r8State')).r8State || {}
  await chrome.storage.session.set({ r8State: { ...current, ...patch, updatedAt: new Date().toISOString() } })
}

function sanitizeMessage(error) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/https?:\/\/[^\s]+/gi, '[URL_REDACTED]')
    .replace(/(?:msToken|a_bogus|verifyFp|fp|token|signature)=[^\s&]+/gi, '$1=[REDACTED]')
    .slice(0, 500)
}

function errorCode(error, fallback = 'T1_ENTRY_BLOCKED') {
  const text = sanitizeMessage(error).toUpperCase()
  const known = text.match(/(?:OBSERVER_V2_BRIDGE_REJECTED:)?([A-Z][A-Z0-9_-]{2,80})/)
  return known?.[1] || fallback
}

function canonicalUrl(value, fallback = 'https://www.douyin.com/') {
  try {
    const url = new URL(String(value))
    if (url.origin !== 'https://www.douyin.com') return fallback
    return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`
  } catch {
    return fallback
  }
}

function summarizeObservation(value) {
  const projection = value?.projection && typeof value.projection === 'object' ? value.projection : {}
  return {
    contract: 'signaldesk-r8-observation-summary/v1',
    routeId: String(value?.routeId || 'unknown'),
    endpointKind: String(value?.endpointKind || 'unknown'),
    requestParameterNames: Array.isArray(value?.requestParameters)
      ? [...new Set(value.requestParameters.map((entry) => String(entry?.name || '')).filter(Boolean))].sort()
      : [],
    schemaFingerprint: String(value?.schemaFingerprint || ''),
    projectionSha256: String(value?.responseProjectionSha256 || ''),
    observedAt: String(value?.observedAt || new Date().toISOString()),
    itemCount: Array.isArray(projection.items) ? projection.items.length : projection.item ? 1 : 0,
    returnedIdCount: Array.isArray(projection.returnedIds) ? projection.returnedIds.length : 0,
    hasMore: projection.hasMore === true,
    reportedTotal: Number.isSafeInteger(projection.reportedTotal) && projection.reportedTotal >= 0
      ? projection.reportedTotal
      : null,
    cursorPresent: projection.cursorOut !== null && projection.cursorOut !== undefined,
    discoveryPaginationOutline: value?.discoveryPaginationOutline ?? null
  }
}

function snapshotSummary(snapshot) {
  return {
    observations: Array.isArray(snapshot?.observations) ? snapshot.observations.map(summarizeObservation) : [],
    issueCodes: Array.isArray(snapshot?.issues)
      ? snapshot.issues.map((issue) => String(issue?.code || 'UNKNOWN_OBSERVER_ISSUE').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 100))
      : [],
    issueSummaries: Array.isArray(snapshot?.issues) ? snapshot.issues.map((issue) => ({
      code: String(issue?.code || 'UNKNOWN_OBSERVER_ISSUE').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 100),
      routeId: typeof issue?.routeId === 'string' ? issue.routeId : null,
      endpointKind: typeof issue?.endpointKind === 'string' ? issue.endpointKind : null,
      schemaFingerprint: /^[a-f0-9]{64}$/.test(String(issue?.schemaFingerprint || '')) ? issue.schemaFingerprint : null,
      pathSha256: /^[a-f0-9]{64}$/.test(String(issue?.pathSha256 || '')) ? issue.pathSha256 : null,
      discoveryPathname: typeof issue?.discoveryPathname === 'string' && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{1,511}$/.test(issue.discoveryPathname)
        ? issue.discoveryPathname
        : null,
      discoverySchemaOutline: issue?.code === 'SCHEMA_CHANGED' && issue?.endpointKind === 'comment-list'
        ? issue.discoverySchemaOutline ?? null
        : null
    })) : []
  }
}

function blockedEntry(entryId, url, error) {
  return {
    contract: 'signaldesk-r8-t1-entry/v1', entryId, status: 'blocked', canonicalSourceUrl: canonicalUrl(url),
    observations: [], issueCodes: [errorCode(error)], trigger: { status: 'blocked', code: errorCode(error) },
    issueSummaries: [],
    bridgePreview: { status: 'not-run', code: 'DEPENDENCY_BLOCKED' }
  }
}

function waitForTab(tabId, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('TAB_LOAD_TIMEOUT'))
    }, timeoutMs)
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 2_000)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function sendTrigger(tabId, command) {
  try {
    if (command.action === 'collect_following') {
      const opened = await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.r8.open-following-dialog' })
      if (!opened?.ok) return {
        status: 'blocked', code: opened?.code || 'FOLLOWING_DIALOG_NOT_OPENED',
        uiOutline: opened?.uiOutline || null, legacyEnvelope: null
      }
    }
    const result = await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.collect', command })
    if (!result?.ok) throw new Error(result?.error || 'PAGE_TRIGGER_REJECTED')
    const counts = {}
    for (const item of Array.isArray(result.envelope?.items) ? result.envelope.items : []) {
      const kind = String(item?.entityType || 'unknown')
      counts[kind] = (counts[kind] || 0) + 1
    }
    return { status: 'completed', entityCounts: counts, legacyEnvelope: result.envelope }
  } catch (error) {
    return { status: 'blocked', code: errorCode(error, 'PAGE_TRIGGER_BLOCKED'), message: sanitizeMessage(error), legacyEnvelope: null }
  }
}

async function capture(tabId, targetUrl, command) {
  const observer = new NetworkObserver({
    debuggerApi: chrome.debugger, maxBufferedResponses: 120, includeSafeDiscoveryPathnames: true
  })
  let trigger = { status: 'not-run', legacyEnvelope: null }
  let snapshot
  await observer.attach(tabId)
  try {
    const loaded = waitForTab(tabId)
    await chrome.tabs.update(tabId, { url: targetUrl, active: true })
    await loaded
    trigger = await sendTrigger(tabId, command)
    await sleep(2_000)
  } finally {
    snapshot = await observer.stop()
  }
  return { snapshot, trigger }
}

function observation(snapshot, endpointKind) {
  return snapshot?.observations?.find((item) => item?.endpointKind === endpointKind) || null
}

function firstItem(observationValue) {
  const items = observationValue?.projection?.items
  return Array.isArray(items) ? items.find((item) => item && typeof item === 'object') || null : null
}

function firstNavigationItem(trigger, entityType) {
  const items = trigger?.legacyEnvelope?.items
  if (!Array.isArray(items)) return null
  return items.find((item) => item?.entityType === entityType) || null
}

async function previewBridge(command, legacyEnvelope, snapshot) {
  try {
    const bridgeSnapshot = snapshot && Array.isArray(snapshot.issues)
      ? { ...snapshot, issues: snapshot.issues.filter((issue) => issue?.code !== 'UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA') }
      : snapshot
    const envelope = await buildV2BusinessEnvelope(command, legacyEnvelope || {
      contract: 'browser-collection-envelope/v1', commandId: command.commandId,
      sourceUrl: command.payload?.sourceUrl || command.payload?.profileUrl || 'https://www.douyin.com/'
    }, bridgeSnapshot)
    return {
      status: 'assembled', contract: String(envelope?.sourceProof?.contract || 'missing'),
      itemCount: Array.isArray(envelope?.items) ? envelope.items.length : 0
    }
  } catch (error) {
    return { status: 'rejected', code: errorCode(error, 'V2_BRIDGE_REJECTED'), message: sanitizeMessage(error) }
  }
}

function entryFromCapture(entryId, sourceUrl, captureValue, bridgePreview) {
  const summary = snapshotSummary(captureValue.snapshot)
  return {
    contract: 'signaldesk-r8-t1-entry/v1', entryId,
    status: summary.observations.length > 0 ? 'observed' : 'blocked',
    canonicalSourceUrl: canonicalUrl(sourceUrl), observations: summary.observations,
    issueCodes: summary.issueCodes,
    issueSummaries: summary.issueSummaries,
    trigger: captureValue.trigger.status === 'completed'
      ? { status: 'completed', entityCounts: captureValue.trigger.entityCounts }
      : {
        status: 'blocked', code: captureValue.trigger.code || 'PAGE_TRIGGER_BLOCKED',
        ...(captureValue.trigger.uiOutline ? { uiOutline: captureValue.trigger.uiOutline } : {})
      },
    bridgePreview
  }
}

async function controllerFetch(path, init = {}) {
  return await fetch(`${R8_CONFIG.controllerOrigin}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-signaldesk-r8-token': R8_CONFIG.token,
      'x-signaldesk-r8-client': CLIENT,
      ...(init.headers || {})
    }
  })
}

async function runT1() {
  if (running) throw new Error('R8_T1_ALREADY_RUNNING')
  running = true
  const entries = []
  const identities = { creatorId: null, secCreatorId: null, workId: null, observedWorkAuthorId: null }
  let tabId = null
  try {
    const health = await controllerFetch('/health')
    if (!health.ok) throw new Error('R8_CONTROLLER_OFFLINE')
    await publish({ running: true, phase: 'following', message: 'T1 1/3：观察本人关注入口' })
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    if (!tab.id) throw new Error('TAB_ID_MISSING')
    tabId = tab.id

    const followingUrl = 'https://www.douyin.com/user/self?showTab=follow'
    const followingCommand = {
      contract: 'browser-command/v1', commandId: `${R8_CONFIG.runId}-following`, action: 'collect_following',
      createdAt: new Date().toISOString(), payload: {
        adapterName: 'douyin.following', adapterVersion: '0.2.0-r4', cursor: '0', creatorLimit: 3
      }
    }
    let followingCapture
    try {
      followingCapture = await capture(tabId, followingUrl, followingCommand)
      entries.push(entryFromCapture('following', 'https://www.douyin.com/user/self', followingCapture,
        await previewBridge(followingCommand, followingCapture.trigger.legacyEnvelope, followingCapture.snapshot)))
    } catch (error) {
      entries.push(blockedEntry('following', 'https://www.douyin.com/user/self', error))
    }

    const followingObservation = observation(followingCapture?.snapshot, 'following-list')
    const networkCreator = firstItem(followingObservation)
    if (networkCreator?.creatorId && networkCreator?.secCreatorId) {
      identities.creatorId = String(networkCreator.creatorId)
      identities.secCreatorId = String(networkCreator.secCreatorId)
    }
    const navigationCreator = networkCreator?.secCreatorId ? {
      creatorId: String(networkCreator.secCreatorId),
      profileUrl: `https://www.douyin.com/user/${encodeURIComponent(String(networkCreator.secCreatorId))}`
    } : firstNavigationItem(followingCapture?.trigger, 'creator')
    if (!navigationCreator?.creatorId || !navigationCreator?.profileUrl) throw new Error('FOLLOWING_NAVIGATION_SEED_NOT_OBSERVED')
    const parsedProfile = new URL(String(navigationCreator.profileUrl))
    if (parsedProfile.origin !== 'https://www.douyin.com'
      || !/^\/user\/[A-Za-z0-9._-]{1,240}\/?$/.test(parsedProfile.pathname)) {
      throw new Error('FOLLOWING_NAVIGATION_SEED_UNSAFE')
    }

    await publish({ phase: 'creator-works', message: 'T1 2/3：观察首个结构化关注账号作品入口' })
    const profileUrl = `${parsedProfile.origin}${parsedProfile.pathname.replace(/\/+$/, '')}`
    const navigationCreatorId = String(navigationCreator.creatorId)
    const worksCommand = {
      contract: 'browser-command/v1', commandId: `${R8_CONFIG.runId}-works`, action: 'collect_creator_works',
      createdAt: new Date().toISOString(), payload: {
        adapterName: 'douyin.creator-works', adapterVersion: '0.2.0-r4', cursor: '0', worksPerCreator: 3,
        creatorId: navigationCreatorId, profileUrl
      }
    }
    let worksCapture
    try {
      worksCapture = await capture(tabId, profileUrl, worksCommand)
      entries.push(entryFromCapture('creator-works', profileUrl, worksCapture,
        await previewBridge(worksCommand, worksCapture.trigger.legacyEnvelope, worksCapture.snapshot)))
    } catch (error) {
      entries.push(blockedEntry('creator-works', profileUrl, error))
    }

    const worksObservation = observation(worksCapture?.snapshot, 'creator-work-list')
    const networkWork = firstItem(worksObservation)
    if (networkWork?.workId && networkWork?.authorId) {
      identities.workId = String(networkWork.workId)
      identities.observedWorkAuthorId = String(networkWork.authorId)
    }
    const navigationWork = networkWork?.workId ? {
      workId: String(networkWork.workId),
      workType: networkWork.workType === 'image' ? 'image' : 'video',
      sourceUrl: `https://www.douyin.com/${networkWork.workType === 'image' ? 'note' : 'video'}/${encodeURIComponent(String(networkWork.workId))}`
    } : firstNavigationItem(worksCapture?.trigger, 'work')
    if (!navigationWork?.workId || !navigationWork?.sourceUrl) throw new Error('WORK_NAVIGATION_SEED_NOT_OBSERVED')
    const parsedWork = new URL(String(navigationWork.sourceUrl))
    const workMatch = parsedWork.pathname.replace(/\/+$/, '').match(/^\/(video|note)\/([A-Za-z0-9._-]{1,240})$/)
    if (parsedWork.origin !== 'https://www.douyin.com' || !workMatch || workMatch[2] !== String(navigationWork.workId)) {
      throw new Error('WORK_NAVIGATION_SEED_UNSAFE')
    }

    await publish({ phase: 'work-detail-comments', message: 'T1 3/3：观察作品详情与评论入口' })
    const workUrl = `${parsedWork.origin}${parsedWork.pathname.replace(/\/+$/, '')}`
    const navigationWorkId = String(navigationWork.workId)
    const commentsCommand = {
      contract: 'browser-command/v1', commandId: `${R8_CONFIG.runId}-comments`, action: 'collect_work_comments',
      createdAt: new Date().toISOString(), payload: {
        adapterName: 'douyin.comment-list', adapterVersion: '0.2.0-r5', cursor: '0', commentsPerWork: 6,
        creatorId: navigationCreatorId, workId: navigationWorkId, sourceUrl: workUrl
      }
    }
    try {
      const detailCapture = await capture(tabId, workUrl, commentsCommand)
      entries.push(entryFromCapture('work-detail-comments', workUrl, detailCapture,
        await previewBridge(commentsCommand, detailCapture.trigger.legacyEnvelope, detailCapture.snapshot)))
    } catch (error) {
      entries.push(blockedEntry('work-detail-comments', workUrl, error))
    }
  } catch (error) {
    while (entries.length < 3) {
      const entryId = REQUIRED_ENTRY_IDS[entries.length]
      entries.push(blockedEntry(entryId, 'https://www.douyin.com/', error))
    }
  } finally {
    const report = {
      contract: 'signaldesk-r8-t1-discovery-report/v1', runId: R8_CONFIG.runId, stage: 'T1-discovery',
      startedAt: R8_CONFIG.startedAt, finishedAt: new Date().toISOString(), entries,
      identityBindings: identities,
      safety: {
        rawResponsesPersisted: false, sensitiveValuesPersisted: false,
        writeRequestsIssued: false, formalDatabaseTouched: false,
        mediaProcessingStarted: false, externalProvidersCalled: false
      }
    }
    try {
      const response = await controllerFetch('/v1/t1-report', { method: 'POST', body: JSON.stringify(report) })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'R8_REPORT_REJECTED')
      await publish({ running: false, phase: 'complete', message: `T1 已完成：${result.classification}`, result })
    } catch (error) {
      await publish({ running: false, phase: 'report-failed', message: sanitizeMessage(error), errorCode: errorCode(error) })
    }
    running = false
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void publish({ running: false, phase: 'ready', message: 'R8 T1 隔离验证器已就绪；不会写正式数据库' })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'r8.state') {
    chrome.storage.session.get('r8State').then(({ r8State }) => sendResponse(r8State || { running: false, phase: 'ready' }))
    return true
  }
  if (message?.type === 'r8.start-t1') {
    if (running) {
      sendResponse({ accepted: false, error: 'T1 已在运行' })
      return false
    }
    void runT1()
    sendResponse({ accepted: true })
    return false
  }
  return false
})

void publish({ running: false, phase: 'ready', message: 'R8 T1 隔离验证器已就绪；不会写正式数据库' })
