import { PILOT_CONFIG } from './session-config.js'
import { NetworkObserver } from './network-observer.js'
import { runHomepagePilot } from './r8-homepage-pilot-core.js'
import { pilotSummary, pilotTabDisposition } from './r8-homepage-pilot-presentation.js'

const CLIENT = 'signaldesk-homepage-pilot-extension'
let running = false
async function controller(path, init = {}) {
  return fetch(`${PILOT_CONFIG.controllerOrigin}${path}`, { ...init, cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-signaldesk-r8-token': PILOT_CONFIG.token,
      'x-signaldesk-r8-client': CLIENT } })
}
async function publish(patch) {
  const prior = (await chrome.storage.session.get('pilotState')).pilotState || {}
  await chrome.storage.session.set({ pilotState: { ...prior, ...patch, updatedAt: new Date().toISOString() } })
}
function pageProjection() {
  const body = (document.body?.innerText || '').slice(0, 4000)
  const title = document.title || ''
  const securityPrompt = /验证码|安全验证|环境异常|访问过于频繁|请求过于频繁|滑块|依次点击文字|Security Verification/i.test(`${title}\n${body}`)
  const loginPrompt = /请先登录|登录后查看|登录后即可|登录后发表评论/i.test(`${title}\n${body}`)
  const cards = [...document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')]
    .slice(0, 24).map((node) => ({ url: node.href || node.getAttribute('href') || '' }))
  return { pageUrl: location.origin + location.pathname.replace(/\/$/, ''),
    securityPrompt, loginPrompt, cards }
}
async function inspect(tabId) {
  const values = await chrome.scripting.executeScript({ target: { tabId }, func: pageProjection })
  return values?.[0]?.result ?? null
}
async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('TAB_LOAD_TIMEOUT')
}
function blockedResult(creator, reason) {
  return { contract: 'signaldesk-homepage-pilot/v1',
    creator: { uid: creator.uid, secUid: creator.secUid,
      profileUrl: `https://www.douyin.com/user/${encodeURIComponent(creator.secUid)}` },
    status: 'blocked', stage: 'profile', navigationCount: 0, activeApiRequests: 0,
    candidates: [], verifiedWork: null, workProof: null, detailProof: null,
    comments: 'not-requested', replies: 'not-requested', reason }
}
async function run(creatorUid) {
  if (running) return
  running = true
  const startedAt = new Date().toISOString()
  let result = null
  let observer = null
  let tabId = null
  let creator = null
  let issues = []
  let lastStage = 'preflight'
  let preflightNavigationCount = 0
  try {
    const catalogResponse = await controller('/v1/catalog')
    if (!catalogResponse.ok) throw new Error('CATALOG_UNAVAILABLE')
    const catalog = await catalogResponse.json()
    creator = catalog.creators?.find((item) => item.uid === creatorUid)
    if (!creator) throw new Error('CREATOR_NOT_IN_VERIFIED_CATALOG')
    await publish({ phase: 'preflight', message: '检查当前抖音页面是否仍显示验证' })
    const existing = await chrome.tabs.query({ url: ['https://www.douyin.com/*'] })
    let preflightBlocked = false
    if (!existing.length) {
      const tab = await chrome.tabs.create({ url: 'https://www.douyin.com/', active: false })
      tabId = tab.id
      preflightNavigationCount = 1
      if (!Number.isSafeInteger(tabId)) throw new Error('TAB_ID_MISSING')
      await waitForTab(tabId)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const state = await inspect(tabId).catch(() => null)
      preflightBlocked = !state || state.securityPrompt || state.loginPrompt
    } else {
      for (const tab of existing) {
        const state = await inspect(tab.id).catch(() => null)
        if (!state || state.securityPrompt || state.loginPrompt) { preflightBlocked = true; break }
      }
    }
    if (preflightBlocked) result = { ...blockedResult(creator, 'PAGE_SECURITY_OR_LOGIN_PROMPT'),
      navigationCount: preflightNavigationCount }
    if (!result) {
      await publish({ phase: 'collect', message: '观察一位作者主页及最多一个作品页' })
      lastStage = 'profile'
      if (tabId === null) {
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
        tabId = tab.id
      }
      if (!Number.isSafeInteger(tabId)) throw new Error('TAB_ID_MISSING')
      observer = new NetworkObserver({ debuggerApi: chrome.debugger, maxBufferedResponses: 24 })
      await observer.attach(tabId)
      result = await runHomepagePilot({ creator,
        navigate: async (url) => {
          const health = await controller('/health').catch(() => null)
          if (!health?.ok) throw new Error('PILOT_CONTROLLER_STOPPED')
          if (/\/(?:video|note)\//.test(new URL(url).pathname)) lastStage = 'work-detail'
          await chrome.tabs.update(tabId, { url, active: false })
          await waitForTab(tabId)
        },
        inspectPage: () => inspect(tabId), snapshot: () => observer.snapshot(),
        wait: () => new Promise((resolve) => setTimeout(resolve, 3000)),
        initialNavigationCount: preflightNavigationCount })
    }
  } catch (error) {
    result = creator ? { ...blockedResult(creator, /^[A-Z0-9_-]{3,100}$/.test(String(error?.message))
      ? String(error.message) : 'PILOT_EXECUTION_FAILED'), stage: lastStage,
      navigationCount: preflightNavigationCount + (lastStage === 'work-detail' ? 2
        : lastStage === 'profile' ? 1 : 0) } : null
  } finally {
    if (observer) {
      const final = await observer.stop().catch(() => null)
      issues = [...new Set((final?.issues ?? []).map((item) => String(item.code)))].sort()
    }
    const tabDisposition = pilotTabDisposition(result, tabId)
    if (tabId !== null && !tabDisposition.keep) await chrome.tabs.remove(tabId).catch(() => {})
    if (result) {
      const report = { contract: 'signaldesk-homepage-pilot-report/v1', runId: PILOT_CONFIG.runId,
        startedAt, finishedAt: new Date().toISOString(), result, observerIssueCodes: issues,
        safety: { formalDatabaseTouched: false, activeApiRequests: 0,
          mediaProcessingStarted: false, externalProvidersCalled: false } }
      try {
        const response = await controller('/v1/report', { method: 'POST', body: JSON.stringify(report) })
        const outcome = await response.json()
        if (!response.ok) throw new Error('REPORT_REJECTED')
        const summary = pilotSummary(result, tabId, PILOT_CONFIG.reportDirectory)
        await publish({ running: false, phase: outcome.status, message: '隔离报告已提交',
          outcome, summary })
        if (tabDisposition.keep) await chrome.tabs.update(tabId, { active: true }).catch(() => {})
      } catch { await publish({ running: false, phase: 'report-failed', message: '隔离报告提交失败' }) }
    } else await publish({ running: false, phase: 'blocked', message: '未取得已验证作者' })
    running = false
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'pilot.state') {
    chrome.storage.session.get('pilotState').then(({ pilotState }) => sendResponse(pilotState || { running: false, phase: 'ready' }))
    return true
  }
  if (message?.type === 'pilot.catalog') {
    controller('/v1/catalog').then((response) => response.json()).then(sendResponse)
      .catch(() => sendResponse({ creators: [] }))
    return true
  }
  if (message?.type === 'pilot.start') {
    if (running) { sendResponse({ accepted: false, error: '试跑正在执行' }); return false }
    void run(String(message.creatorUid ?? ''))
    sendResponse({ accepted: true })
    return false
  }
  return false
})
void publish({ running: false, phase: 'ready', message: '等待手动选择一位作者；不会自动采集' })
