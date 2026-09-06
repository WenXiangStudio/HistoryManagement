import {
  CREATOR_WORKS_PROOF_CONTRACT,
  DEFAULT_SAMPLE_COUNT,
  DISCOVERY_CONTRACT,
  FOLLOWING_PROOF_CONTRACT,
  MAX_CANDIDATE_WORKS_PER_CREATOR,
  MAX_DISCOVERY_CREATORS,
  MAX_SELECTED_WORKS_PER_CREATOR,
  MAX_API_PAGES,
  PAGE_SIZE,
  PHASE_B_CONTRACT,
  SAMPLE_REPORT_CONTRACT,
  assertNoSensitiveShape,
  canonicalSampleUrl,
  compareChannels,
  createSamplingSeed,
  deterministicShuffle,
  isCommentEndpoint,
  normalizeCommentPage,
  safeObservedEndpoint,
  safeIssue,
  sanitizeDiagnosticText,
  selectFollowingSamples,
  sha256Canonical,
  validateCreatorWorksSnapshot,
  validateFollowingSnapshot,
  validateTargetSampleCount,
  whitelistPageForHash
} from './core.js'

const DEBUGGER_VERSION = '1.3'
const LEGACY_PHASE_B_DISABLED_REASON = 'LEGACY_ROUTE_DISABLED:0.2.4:BLOCKED_BY_R0_UNTIL_R4'
const NAVIGATION_TIMEOUT_MS = 45_000
const NETWORK_OBSERVE_MS = 12_000
const API_TIMEOUT_MS = 20_000
const state = {
  running: false,
  runId: null,
  total: 0,
  completed: 0,
  currentWorkId: null,
  discovery: null,
  status: 'idle',
  lastIssue: null
}
const observations = new Map()
let stopRequested = false

async function publishState(patch = {}) {
  Object.assign(state, patch)
  await chrome.storage.local.set({ phaseBState: { ...state } })
  return { ...state }
}

function controllerEndpoint(controllerUrl, path) {
  const url = new URL(path, controllerUrl.endsWith('/') ? controllerUrl : `${controllerUrl}/`)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') {
    throw new Error('控制器必须是 http://127.0.0.1 或 http://localhost')
  }
  return url.toString()
}

async function controllerFetch(controllerUrl, token, path, options = {}) {
  const response = await fetch(controllerEndpoint(controllerUrl, path), {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-phase-b-token': token,
      ...(options.headers || {})
    }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(sanitizeDiagnosticText(body.error || `控制器 HTTP ${response.status}`))
  return body
}

async function pairController(controllerUrl) {
  const response = await fetch(controllerEndpoint(controllerUrl, '/v1/pair'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-phase-b-client': 'signaldesk-phase-b-poc'
    },
    body: JSON.stringify({ contract: 'signaldesk-phase-b-pair/v1' })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(sanitizeDiagnosticText(body.error || `控制器配对 HTTP ${response.status}`))
  const token = String(body.sessionToken || '')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('本地控制器返回的会话凭据格式无效')
  await chrome.storage.session.set({ phaseBSessionToken: token })
  return token
}

function waitForTab(tabId, timeoutMs = NAVIGATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('PAGE_NAVIGATION_TIMEOUT'))
    }, timeoutMs)
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }).catch((error) => {
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      reject(error)
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(base = 1_500, spread = 700) {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return base + (values[0] % (spread + 1))
}

function issueCodeFromMessage(message, fallback = 'SCHEMA_CHANGED') {
  const code = String(message || '').split(':', 1)[0]
  return [
    'BROWSER_OFFLINE', 'PAGE_NAVIGATION_TIMEOUT', 'PAGE_CONTEXT_NOT_READY', 'LOGIN_REQUIRED',
    'CAPTCHA_OR_SECURITY_CHALLENGE', 'RATE_LIMITED', 'HTTP_TRANSIENT', 'API_STATUS_ERROR',
    'SIGNATURE_UNAVAILABLE', 'SIGNATURE_REJECTED', 'SCHEMA_CHANGED', 'WORK_PRIVATE',
    'WORK_DELETED', 'COMMENTS_DISABLED', 'VERIFIED_EMPTY', 'INSUFFICIENT_ELIGIBLE_SAMPLES'
  ].includes(code) ? code : fallback
}

async function attachNetworkObserver(tabId) {
  const debuggee = { tabId }
  const observation = { requestIds: new Map(), pages: [], templateUrl: null, issues: [], pending: new Set(), endpointPaths: new Map() }
  observations.set(tabId, observation)
  await chrome.debugger.attach(debuggee, DEBUGGER_VERSION)
  await chrome.debugger.sendCommand(debuggee, 'Network.enable', {
    maxTotalBufferSize: 8 * 1024 * 1024,
    maxResourceBufferSize: 2 * 1024 * 1024
  })
  return observation
}

async function detachNetworkObserver(tabId) {
  observations.delete(tabId)
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // The tab may already be closed; no diagnostic should contain debugger internals.
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId) return
  const observation = observations.get(tabId)
  if (!observation || observation.accepting === false) return
  if (method === 'Network.responseReceived') {
    const url = params?.response?.url
    const safeEndpoint = safeObservedEndpoint(url, { kind: params?.type, status: Number(params?.response?.status) })
    if (safeEndpoint && observation.endpointPaths.size < 100) {
      const key = JSON.stringify(safeEndpoint)
      const existing = observation.endpointPaths.get(key)
      observation.endpointPaths.set(key, { ...safeEndpoint, count: (existing?.count || 0) + 1 })
    }
    if (!isCommentEndpoint(url)) return
    observation.templateUrl ||= url
    observation.requestIds.set(params.requestId, {
      status: Number(params.response.status),
      url,
      receivedAt: new Date().toISOString()
    })
    return
  }
  if (method !== 'Network.loadingFinished' || !observation.requestIds.has(params?.requestId)) return
  const metadata = observation.requestIds.get(params.requestId)
  observation.requestIds.delete(params.requestId)
  const pending = chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: params.requestId })
    .then(async (result) => {
      if (metadata.status !== 200) {
        observation.issues.push(safeIssue(
          metadata.status === 429 ? 'RATE_LIMITED' : metadata.status >= 500 ? 'HTTP_TRANSIENT' : 'API_STATUS_ERROR',
          'network-response',
          `评论网络响应 HTTP ${metadata.status}`,
          { httpStatus: metadata.status }
        ))
        return
      }
      const text = result?.base64Encoded
        ? new TextDecoder().decode(Uint8Array.from(atob(result.body || ''), (character) => character.charCodeAt(0)))
        : result?.body
      const raw = JSON.parse(text)
      const responseUrl = new URL(metadata.url)
      const awemeId = responseUrl.searchParams.get('aweme_id') || 'unknown'
      const cursorIn = responseUrl.searchParams.get('cursor') || '0'
      const page = normalizeCommentPage(raw, {
        workId: awemeId,
        cursorIn,
        sourceKind: 'network-response',
        collectedAt: metadata.receivedAt
      })
      page.responseBodySha256 = await sha256Canonical(whitelistPageForHash(page))
      if (!observation.pages.some((existing) => existing.responseBodySha256 === page.responseBodySha256)) {
        observation.pages.push(page)
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      observation.issues.push(safeIssue(issueCodeFromMessage(message), 'network-response', message))
    })
    .finally(() => observation.pending.delete(pending))
  observation.pending.add(pending)
})

chrome.debugger.onDetach.addListener((source, reason) => {
  const observation = source.tabId ? observations.get(source.tabId) : null
  if (observation && reason !== 'target_closed') {
    observation.issues.push(safeIssue('BROWSER_OFFLINE', 'network-response', `Chrome debugger detached: ${reason}`))
  }
})

async function warmCommentSurface(tabId, workId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [workId],
    func: async (targetWorkId) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const route = location.pathname.match(/^\/(?:video|note)\/([^/]+)/)?.[1]
      if (route !== targetWorkId) return { ok: false, code: 'WORK_DELETED', message: '作品路由与目标不一致' }
      const pageText = (document.body?.innerText || '').slice(0, 50_000)
      if (/验证码|安全验证|访问过于频繁/.test(pageText)) return { ok: false, code: 'CAPTCHA_OR_SECURITY_CHALLENGE', message: '页面显示安全验证或访问限制' }
      if (/扫码登录|登录后查看|请登录/.test(pageText)) return { ok: false, code: 'LOGIN_REQUIRED', message: '页面要求登录' }
      if (/作品不存在|视频已删除|内容已删除/.test(pageText)) return { ok: false, code: 'WORK_DELETED', message: '作品已删除或不存在' }
      if (/私密作品|无权查看/.test(pageText)) return { ok: false, code: 'WORK_PRIVATE', message: '作品不可公开访问' }
      const root = document.querySelector('[data-e2e="comment-list"]')
      if (root) {
        root.scrollIntoView({ block: 'center', behavior: 'instant' })
        root.dispatchEvent(new Event('scroll', { bubbles: true }))
      } else {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      }
      await sleep(2_000)
      return { ok: true }
    }
  })
  return result
}

async function discoverTemplateInMainWorld(tabId, workId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [workId],
    func: (targetWorkId) => {
      const route = location.pathname.match(/^\/(?:video|note)\/([^/]+)/)?.[1]
      if (route !== targetWorkId) return { ok: false, code: 'WORK_DELETED', message: '作品路由不匹配' }
      const resources = performance.getEntriesByType('resource')
      const entries = resources.map((entry) => entry.name).filter((value) => {
          try {
            const url = new URL(value)
            return url.origin === 'https://www.douyin.com' && `${url.pathname.replace(/\/+$/, '')}/` === '/aweme/v1/web/comment/list/'
          } catch {
            return false
          }
        })
      const endpointPaths = []
      const seen = new Set()
      for (const entry of resources) {
        try {
          const url = new URL(entry.name)
          if (url.protocol !== 'https:' || (url.hostname !== 'www.douyin.com' && !url.hostname.endsWith('.douyin.com'))) continue
          if (!/(?:aweme|comment|feed|list|detail|post)/i.test(url.pathname)) continue
          const path = url.pathname.split('/').map((segment) => (/^\d{8,}$/.test(segment) || /^[A-Za-z0-9._-]{32,}$/.test(segment) ? ':id' : segment)).join('/').slice(0, 300)
          const kind = ['fetch', 'xmlhttprequest'].includes(entry.initiatorType) ? entry.initiatorType : 'other'
          const key = `${url.hostname}|${path}|${kind}`
          if (seen.has(key) || endpointPaths.length >= 100) continue
          seen.add(key)
          endpointPaths.push({ host: url.hostname, path, kind, status: null, count: 1 })
        } catch {
          // Ignore resources that cannot be reduced to a query-free endpoint shape.
        }
      }
      return { ok: true, templateUrl: entries.at(-1) || null, endpointPaths }
    }
  })
  return result
}

async function pageContextFetch(tabId, { templateUrl, workId, cursor, count }) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [{ templateUrl, workId, cursor, count, timeoutMs: API_TIMEOUT_MS }],
    func: async (request) => {
      const safeText = (value, maximum) => {
        if (value === null || value === undefined) return null
        const text = String(value).normalize('NFKC').trim()
        return text && text.length <= maximum ? text : null
      }
      const safeInteger = (value) => {
        const number = typeof value === 'number' ? value : Number(value)
        return Number.isSafeInteger(number) && number >= 0 ? number : 0
      }
      const route = location.pathname.match(/^\/(?:video|note)\/([^/]+)/)?.[1]
      if (route !== request.workId) return { ok: false, code: 'WORK_DELETED', message: '作品路由不匹配' }
      const bodyText = (document.body?.innerText || '').slice(0, 50_000)
      if (/验证码|安全验证|访问过于频繁/.test(bodyText)) return { ok: false, code: 'CAPTCHA_OR_SECURITY_CHALLENGE', message: '页面显示安全验证或访问限制' }
      if (/扫码登录|登录后查看|请登录/.test(bodyText)) return { ok: false, code: 'LOGIN_REQUIRED', message: '页面要求登录' }
      let url
      try {
        url = new URL(request.templateUrl)
      } catch {
        return { ok: false, code: 'PAGE_CONTEXT_NOT_READY', message: '没有取得评论接口请求模板' }
      }
      if (url.origin !== 'https://www.douyin.com' || `${url.pathname.replace(/\/+$/, '')}/` !== '/aweme/v1/web/comment/list/') {
        return { ok: false, code: 'SCHEMA_CHANGED', message: '请求模板不是允许的评论端点' }
      }
      for (const name of ['cursor', 'count', 'X-Bogus', 'x-bogus']) url.searchParams.delete(name)
      url.searchParams.set('aweme_id', request.workId)
      url.searchParams.set('cursor', String(request.cursor))
      url.searchParams.set('count', String(request.count))
      const signerOwner = globalThis.byted_acrawler
      if (typeof signerOwner?.frontierSign !== 'function') return { ok: false, code: 'SIGNATURE_UNAVAILABLE', message: '页面签名对象尚未就绪' }
      let signed
      try {
        signed = await signerOwner.frontierSign({ url: `${url.pathname}${url.search}` })
      } catch {
        return { ok: false, code: 'SIGNATURE_REJECTED', message: '页面签名调用失败' }
      }
      const signature = signed?.['X-Bogus'] || signed?.['x-bogus'] || signed?.XBogus
      if (typeof signature !== 'string' || signature.length < 6 || signature.length > 1_000) {
        return { ok: false, code: 'SIGNATURE_REJECTED', message: '页面签名结果格式无效' }
      }
      url.searchParams.set('X-Bogus', signature)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' },
          signal: controller.signal
        })
        if (!response.ok) {
          return { ok: false, code: response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'HTTP_TRANSIENT' : 'API_STATUS_ERROR', message: `评论接口 HTTP ${response.status}`, httpStatus: response.status }
        }
        const raw = await response.json()
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.comments)) {
          return { ok: false, code: 'SCHEMA_CHANGED', message: '评论接口响应 schema 不匹配' }
        }
        const comments = []
        let invalidCommentCount = 0
        for (const item of raw.comments.slice(0, request.count)) {
          if (!item || typeof item !== 'object') {
            invalidCommentCount += 1
            continue
          }
          const cid = safeText(item.cid, 240)
          const text = safeText(item.text, 5_000)
          const user = item.user && typeof item.user === 'object' ? item.user : null
          const nickname = safeText(user?.nickname, 200)
          if (!cid || !/^[A-Za-z0-9._-]+$/.test(cid) || !text || !nickname) {
            invalidCommentCount += 1
            continue
          }
          comments.push({
            cid,
            text,
            create_time: safeInteger(item.create_time),
            digg_count: safeInteger(item.digg_count),
            ip_label: safeText(item.ip_label, 80),
            reply_comment_total: safeInteger(item.reply_comment_total),
            user: { uid: safeText(user?.uid, 240), nickname }
          })
        }
        const statusCode = Number(raw.status_code ?? 0)
        if (!Number.isSafeInteger(statusCode)) return { ok: false, code: 'SCHEMA_CHANGED', message: '评论接口 status_code 格式无效' }
        const total = raw.total === null || raw.total === undefined ? null : Number(raw.total)
        if (total !== null && (!Number.isSafeInteger(total) || total < 0)) return { ok: false, code: 'SCHEMA_CHANGED', message: '评论接口 total 格式无效' }
        return {
          ok: true,
          safeBody: {
            status_code: statusCode,
            comments,
            cursor: raw.cursor === null || raw.cursor === undefined ? null : String(raw.cursor),
            has_more: raw.has_more === true || raw.has_more === 1 || raw.has_more === '1',
            total,
            invalid_comment_count: invalidCommentCount
          },
          signatureProvider: 'page-frontierSign'
        }
      } catch (error) {
        return { ok: false, code: error?.name === 'AbortError' ? 'HTTP_TRANSIENT' : 'API_STATUS_ERROR', message: error?.name === 'AbortError' ? '评论接口请求超时' : '评论接口请求失败' }
      } finally {
        clearTimeout(timeout)
      }
    }
  })
  return result
}

async function collectDomShadow(tabId, workId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [workId],
    func: (targetWorkId) => {
      const visible = (element) => {
        if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }
      const text = (element) => (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      const route = location.pathname.match(/^\/(?:video|note)\/([^/]+)/)?.[1]
      if (route !== targetWorkId) return { status: 'error', commentCount: 0, comments: [], issue: { code: 'WORK_DELETED', message: '作品路由不匹配' } }
      const roots = [...document.querySelectorAll('[data-e2e="comment-list"]')].filter((element) => visible(element) && element.classList.contains('comment-mainContent'))
      if (roots.length !== 1) return { status: 'not-ready', commentCount: 0, comments: [], rootCount: roots.length }
      const nodes = [...roots[0].querySelectorAll('[data-e2e="comment-item"]')].filter((element) => visible(element) && element.closest('[data-e2e="comment-list"]') === roots[0])
      const comments = []
      for (const node of nodes.slice(0, 40)) {
        const wraps = [...node.querySelectorAll('[class~="comment-item-info-wrap"]')].filter((element) => visible(element) && element.closest('[data-e2e="comment-item"]') === node)
        if (wraps.length !== 1) continue
        const publicAuthorName = text(wraps[0]).replace(/\s*作者\s*$/, '').trim()
        const sibling = wraps[0].nextElementSibling
        const body = sibling && sibling.parentElement === wraps[0].parentElement && visible(sibling) ? text(sibling) : ''
        if (!publicAuthorName || !body || /^[\d\s.,，。+万亿]+$/.test(body)) continue
        const commentId = (node.getAttribute('data-comment-id') || '').trim()
        comments.push({
          commentId: /^[A-Za-z0-9._-]{1,240}$/.test(commentId) ? commentId : null,
          publicAuthorName: publicAuthorName.slice(0, 200),
          body: body.slice(0, 5_000)
        })
      }
      return {
        status: nodes.length === 0 ? 'empty-unverified' : comments.length > 0 ? 'success' : 'schema-mismatch',
        commentCount: comments.length,
        visibleNodeCount: nodes.length,
        comments
      }
    }
  })
  return result
}

async function openVerifiedFollowingDialog(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const text = (element) => (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      const visible = (element) => {
        if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }
      const pageIssue = () => {
        const body = text(document.body).slice(0, 50_000)
        if (/验证码|安全验证|访问过于频繁/.test(body)) return { code: 'CAPTCHA_OR_SECURITY_CHALLENGE', message: '本人主页显示安全验证或访问限制' }
        if (/扫码登录|登录后查看|请登录/.test(body)) return { code: 'LOGIN_REQUIRED', message: '本人主页要求登录' }
        return null
      }
      const route = new URL(location.href)
      if (route.origin !== 'https://www.douyin.com' || route.pathname.replace(/\/+$/, '') !== '/user/self') {
        return { ok: false, code: 'SCHEMA_CHANGED', message: '当前页面不是抖音本人主页' }
      }
      const issue = pageIssue()
      if (issue) return { ok: false, ...issue }
      const followingPattern = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
      const fansPattern = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
      const verifiedDialog = () => {
        const active = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
          .filter((element) => visible(element) && followingPattern.test(text(element)))
        if (active.length !== 1) return false
        const tabList = active[0].closest('[role="tablist"]')
        if (!tabList) return false
        const tabs = [...tabList.querySelectorAll('[role="tab"]')].filter(visible)
        if (tabs.filter((element) => followingPattern.test(text(element))).length !== 1 || tabs.filter((element) => fansPattern.test(text(element))).length !== 1) return false
        const containers = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(visible)
        return containers.length === 1
      }
      if (verifiedDialog()) return { ok: true, opened: false, entryPoint: { mode: 'preopened-verified-dialog', candidateCount: 0, triggered: false } }

      const countPattern = /^(?:关注\s*[：:]?\s*[\d.,，万亿+]+|[\d.,，万亿+]+\s*关注)$/
      const rawCandidates = [...document.querySelectorAll('[data-e2e="user-info-follow"], [data-e2e="following-count"], [aria-label], a, button, [role="button"]')]
        .filter((element) => {
          if (!visible(element) || element.closest('nav, aside')) return false
          const dataE2e = element.getAttribute('data-e2e') || ''
          const ariaLabel = (element.getAttribute('aria-label') || '').normalize('NFKC').trim()
          const label = text(element)
          const semanticIdentity = dataE2e === 'user-info-follow' || dataE2e === 'following-count' || /^(?:我的)?关注(?:数量|列表)?$/.test(ariaLabel)
          return semanticIdentity ? /关注/.test(label || ariaLabel) : countPattern.test(label)
        })
        .map((element) => {
          if (element.matches('button, a, [role="button"], [tabindex]')) return element
          return element.querySelector('button, a, [role="button"], [tabindex]') || element.closest('button, a, [role="button"], [tabindex]') || element
        })
        .filter((element) => visible(element) && !element.closest('nav, aside'))
      const candidates = [...new Set(rawCandidates)].filter((element) => !rawCandidates.some((other) => other !== element && element.contains(other)))
      if (candidates.length !== 1) return { ok: false, code: 'SCHEMA_CHANGED', message: `无法唯一识别本人主页的关注数量入口（找到 ${candidates.length} 个）` }
      candidates[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      if (!candidates[0].matches('a, button, [role="button"], [tabindex]')) candidates[0].setAttribute('tabindex', '-1')
      candidates[0].focus({ preventScroll: true })
      candidates[0].click()
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(500)
        const afterClickIssue = pageIssue()
        if (afterClickIssue) return { ok: false, ...afterClickIssue }
        if (verifiedDialog()) return { ok: true, opened: true, entryPoint: { mode: 'unique-following-count', candidateCount: 1, triggered: true } }
      }
      return {
        ok: false,
        code: 'PAGE_CONTEXT_NOT_READY',
        message: '普通语义点击后尚未出现真实关注关系弹窗',
        retryFocusedWithKeyboard: document.activeElement === candidates[0],
        entryPoint: { mode: 'unique-following-count', candidateCount: 1, triggered: true }
      }
    }
  })
  return result
}

async function activateFocusedFollowingEntry(tabId) {
  const debuggee = { tabId }
  let attached = false
  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_VERSION)
    attached = true
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    })
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    })
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(debuggee) } catch { /* tab may have navigated */ }
    }
  }
}

async function verifyFollowingDialog(tabId, entryPoint) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(500)
    let result
    try {
      ;[{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => {
        const text = (element) => (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
        const visible = (element) => {
          if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
          const style = getComputedStyle(element)
          return style.display !== 'none' && style.visibility !== 'hidden'
        }
        const body = text(document.body).slice(0, 50_000)
        if (/验证码|安全验证|访问过于频繁/.test(body)) return { ok: false, terminal: true, code: 'CAPTCHA_OR_SECURITY_CHALLENGE', message: '本人主页显示安全验证或访问限制' }
        if (/扫码登录|登录后查看|请登录/.test(body)) return { ok: false, terminal: true, code: 'LOGIN_REQUIRED', message: '本人主页要求登录' }
        const followingPattern = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
        const fansPattern = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
        const active = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
          .filter((element) => visible(element) && followingPattern.test(text(element)))
        const tabList = active.length === 1 ? active[0].closest('[role="tablist"]') : null
        const tabs = tabList ? [...tabList.querySelectorAll('[role="tab"]')].filter(visible) : []
        const containers = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(visible)
        const ok = active.length === 1 && tabs.filter((element) => followingPattern.test(text(element))).length === 1 && tabs.filter((element) => fansPattern.test(text(element))).length === 1 && containers.length === 1
        return { ok }
        }
      })
    } catch {
      continue
    }
    if (result?.ok) return { ok: true, opened: true, entryPoint }
    if (result?.terminal) return result
  }
  return { ok: false, code: 'PAGE_CONTEXT_NOT_READY', message: '聚焦唯一关注入口并发送 Enter 后仍未出现真实关注关系弹窗' }
}

async function collectVerifiedFollowing(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [MAX_DISCOVERY_CREATORS, FOLLOWING_PROOF_CONTRACT],
    func: async (maximumCreators, proofContract) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const text = (element) => (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      const visible = (element) => {
        if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }
      const followingPattern = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
      const fansPattern = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
      const relationshipPattern = /^(?:已关注|相互关注)$/
      const assertReadable = () => {
        const body = text(document.body).slice(0, 50_000)
        if (/验证码|安全验证|访问过于频繁/.test(body)) throw new Error('CAPTCHA_OR_SECURITY_CHALLENGE:关注关系页面显示安全验证或访问限制')
        if (/扫码登录|登录后查看|请登录/.test(body)) throw new Error('LOGIN_REQUIRED:关注关系页面要求登录')
      }
      const lowestCommonAncestor = (first, second) => {
        const ancestors = new Set()
        for (let current = first; current; current = current.parentElement) ancestors.add(current)
        let current = second
        while (current && !ancestors.has(current)) current = current.parentElement
        return current
      }
      const locate = () => {
        assertReadable()
        const route = new URL(location.href)
        if (route.origin !== 'https://www.douyin.com' || route.pathname.replace(/\/+$/, '') !== '/user/self' || route.searchParams.get('showTab') !== 'follow') {
          throw new Error('SCHEMA_CHANGED:真实关注弹窗未绑定本人关注路由')
        }
        const activeTabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
          .filter((element) => visible(element) && followingPattern.test(text(element)))
        if (activeTabs.length !== 1) throw new Error(`SCHEMA_CHANGED:已激活关注页签数量为 ${activeTabs.length}`)
        const tabList = activeTabs[0].closest('[role="tablist"]')
        if (!tabList) throw new Error('SCHEMA_CHANGED:关注页签缺少 tablist')
        const tabs = [...tabList.querySelectorAll('[role="tab"]')].filter(visible)
        const followingTabs = tabs.filter((element) => followingPattern.test(text(element)))
        const fansTabs = tabs.filter((element) => fansPattern.test(text(element)))
        if (followingTabs.length !== 1 || fansTabs.length !== 1 || followingTabs[0] !== activeTabs[0]) {
          throw new Error('SCHEMA_CHANGED:关注/粉丝页签语义不唯一或当前激活了粉丝页')
        }
        const containers = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(visible)
        if (containers.length !== 1) throw new Error(`SCHEMA_CHANGED:关注成员容器数量为 ${containers.length}`)
        const list = containers[0]
        const dialog = lowestCommonAncestor(tabList, list)
        if (!dialog || dialog === document.body || dialog === document.documentElement || dialog.closest('nav, aside')) {
          throw new Error('SCHEMA_CHANGED:关注页签与成员容器不属于唯一关系弹窗')
        }
        return { route, tabList, list, followingTabs, fansTabs }
      }
      const profileIdentity = (anchor) => {
        try {
          const url = new URL(anchor.href, location.href)
          if (url.origin !== 'https://www.douyin.com') return null
          const match = url.pathname.replace(/\/+$/, '').match(/^\/user\/([^/]+)$/)
          if (!match) return null
          const creatorId = decodeURIComponent(match[1])
          if (!creatorId || creatorId === 'self' || !/^[A-Za-z0-9._-]{1,240}$/.test(creatorId)) return null
          return { creatorId, profileUrl: `https://www.douyin.com/user/${encodeURIComponent(creatorId)}` }
        } catch {
          return null
        }
      }
      const identitiesWithin = (element) => new Set([...element.querySelectorAll('a[href]')].map((anchor) => profileIdentity(anchor)?.creatorId).filter(Boolean))
      const relationshipMarker = (element) => {
        const candidates = [element, ...element.querySelectorAll('button, [role="button"], span, div')]
        return candidates.map((candidate) => visible(candidate) ? text(candidate) : '').find((value) => relationshipPattern.test(value)) || null
      }
      const recommendationSubtree = (element, boundary) => {
        for (let current = element; current && current !== boundary; current = current.parentElement) {
          const dataE2e = current.getAttribute?.('data-e2e') || ''
          const ariaLabel = current.getAttribute?.('aria-label') || ''
          if (/recommend|suggest/i.test(dataE2e) || /推荐|可能感兴趣/.test(ariaLabel)) return true
        }
        return false
      }
      const readMembers = (surface, accumulated) => {
        for (const anchor of surface.list.querySelectorAll('a[href]')) {
          const identity = profileIdentity(anchor)
          if (!identity) continue
          let card = anchor
          while (card && card !== surface.list) {
            const identities = identitiesWithin(card)
            if (identities.size === 1 && identities.has(identity.creatorId) && relationshipMarker(card)) break
            card = card.parentElement
          }
          if (!card || card === surface.list || recommendationSubtree(card, surface.list)) continue
          const marker = relationshipMarker(card)
          if (!marker) continue
          accumulated.set(identity.creatorId, { ...identity, relationshipMarker: marker, sourceRegion: 'verified-following-dialog' })
        }
      }
      const status = (root, kind) => {
        const selector = kind === 'end' ? '[data-e2e="following-list-end"], [data-e2e="follow-list-end"], [role="status"], [aria-live]' : '[data-e2e="following-list-empty"], [data-e2e="follow-list-empty"], [role="status"], [aria-live]'
        const pattern = kind === 'end' ? /^(?:没有更多了|已加载全部|已经到底了)$/ : /^(?:暂无关注|还没有关注|暂未关注任何账号)$/
        return [...root.querySelectorAll(selector)].some((element) => visible(element) && pattern.test(text(element)))
      }
      const scrollRootFor = (list) => {
        for (let current = list; current && current !== document.body; current = current.parentElement) {
          const overflowY = getComputedStyle(current).overflowY || ''
          if (/^(?:auto|scroll)$/.test(overflowY) && current.scrollHeight > current.clientHeight) return { kind: 'element', element: current }
        }
        const documentScroller = document.scrollingElement || document.documentElement
        if (documentScroller.scrollHeight > documentScroller.clientHeight) return { kind: 'document', element: documentScroller }
        return null
      }
      const accumulated = new Map()
      let surface = locate()
      readMembers(surface, accumulated)
      if (accumulated.size === 0 && status(surface.list, 'empty')) throw new Error('INSUFFICIENT_ELIGIBLE_SAMPLES:关注列表已验证为空')
      let scrollRoot = scrollRootFor(surface.list)
      let scrollRootKind = scrollRoot?.kind || 'not-needed'
      let stableRounds = 0
      let exhausted = status(surface.list, 'end')
      for (let round = 0; round < 80 && accumulated.size < maximumCreators && !exhausted; round += 1) {
        if (!scrollRoot) throw new Error('SCHEMA_CHANGED:关注成员不足且无法验证关系弹窗滚动容器')
        const previousSize = accumulated.size
        if (scrollRoot.kind === 'document') window.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
        else if (typeof scrollRoot.element.scrollTo === 'function') scrollRoot.element.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
        else scrollRoot.element.scrollTop = scrollRoot.element.scrollHeight
        await sleep(700)
        surface = locate()
        readMembers(surface, accumulated)
        exhausted = status(surface.list, 'end')
        stableRounds = accumulated.size === previousSize ? stableRounds + 1 : 0
        if (stableRounds >= 5 && !exhausted) throw new Error('SCHEMA_CHANGED:关注弹窗连续滚动无新成员且没有可验证结束标记')
        scrollRoot ||= scrollRootFor(surface.list)
      }
      if (accumulated.size === 0) throw new Error('INSUFFICIENT_ELIGIBLE_SAMPLES:没有取得带明确关注关系标记的博主')
      return {
        ok: true,
        snapshot: {
          contract: proofContract,
          relationship: 'following',
          pageKind: 'owner-following-list',
          activeTab: 'following',
          routeOrigin: 'https://www.douyin.com',
          routePath: '/user/self',
          routeShowTab: 'follow',
          followingTabCount: 1,
          fansTabCount: 1,
          containerIdentity: 'data-e2e:user-fans-container',
          extractionScope: 'verified-following-list-container',
          scrollRootKind,
          exhausted,
          creators: [...accumulated.values()].slice(0, maximumCreators),
          collectedAt: new Date().toISOString()
        }
      }
    }
  })
  return result
}

async function collectCreatorWorks(tabId, creator) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [creator, MAX_CANDIDATE_WORKS_PER_CREATOR, CREATOR_WORKS_PROOF_CONTRACT],
    func: async (targetCreator, maximumWorks, proofContract) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const text = (element) => (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      const visible = (element) => {
        if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
        const style = getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }
      const assertPage = () => {
        const body = text(document.body).slice(0, 50_000)
        if (/验证码|安全验证|访问过于频繁/.test(body)) throw new Error('CAPTCHA_OR_SECURITY_CHALLENGE:博主主页显示安全验证或访问限制')
        if (/扫码登录|登录后查看|请登录/.test(body)) throw new Error('LOGIN_REQUIRED:博主主页要求登录')
        const route = new URL(location.href)
        let routeCreatorId = null
        try { routeCreatorId = decodeURIComponent(route.pathname.replace(/\/+$/, '').match(/^\/user\/([^/]+)$/)?.[1] || '') } catch { /* invalid route */ }
        if (route.origin !== 'https://www.douyin.com' || routeCreatorId !== targetCreator.creatorId) throw new Error('SCHEMA_CHANGED:博主主页路由与关注来源不一致')
      }
      const isNoise = (element, boundary) => {
        for (let current = element; current && current !== boundary; current = current.parentElement) {
          const dataE2e = current.getAttribute?.('data-e2e') || ''
          const ariaLabel = current.getAttribute?.('aria-label') || ''
          const regionText = current.matches?.('[role="region"], section') ? text(current).slice(0, 40) : ''
          if (/recommend|suggest|sidebar/i.test(dataE2e) || /推荐|可能感兴趣|侧栏/.test(ariaLabel) || /^(?:相关推荐|你可能感兴趣)/.test(regionText) || current.matches?.('nav, aside')) return true
        }
        return false
      }
      const canonicalWork = (anchor) => {
        if (!visible(anchor) || isNoise(anchor, document.body)) return null
        try {
          const url = new URL(anchor.href, location.href)
          if (url.origin !== 'https://www.douyin.com') return null
          const match = url.pathname.replace(/\/+$/, '').match(/^\/(video|note)\/([A-Za-z0-9._-]{1,240})$/)
          return match ? { kind: match[1], workId: match[2] } : null
        } catch {
          return null
        }
      }
      const workAnchorsWithin = (root) => [...root.querySelectorAll('a[href]')].filter((anchor) => canonicalWork(anchor))
      const workCount = (root) => new Set(workAnchorsWithin(root).map((anchor) => canonicalWork(anchor).workId)).size
      const identity = (element, inferred = false) => {
        const dataE2e = element.getAttribute?.('data-e2e')
        if (dataE2e) return `data-e2e:${String(dataE2e).slice(0, 150)}`
        const role = element.getAttribute?.('role')
        if (role) return `role:${String(role).slice(0, 150)}`
        const ariaLabel = element.getAttribute?.('aria-label')
        if (ariaLabel) return `aria-label:${String(ariaLabel).slice(0, 150)}`
        return `inferred:${inferred ? 'common-work-ancestor' : 'semantic-work-container'}-${element.tagName?.toLowerCase() || 'unknown'}`
      }
      const lowestCommonAncestor = (elements) => {
        if (!elements.length) return null
        let common = elements[0]
        for (const element of elements.slice(1)) {
          const ancestors = new Set()
          for (let current = common; current; current = current.parentElement) ancestors.add(current)
          let current = element
          while (current && !ancestors.has(current)) current = current.parentElement
          common = current
          if (!common) break
        }
        return common
      }
      const locateWorksContainer = () => {
        assertPage()
        const workTabPattern = /^(?:作品|视频|图文)(?:\s*[（(]?\s*\d+\s*[）)]?)?$/
        const activeWorkTabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
          .filter((element) => visible(element) && workTabPattern.test(text(element)))
        if (activeWorkTabs.length === 1) {
          const controlledId = activeWorkTabs[0].getAttribute('aria-controls')
          const panels = []
          if (controlledId) {
            const controlled = document.getElementById(controlledId)
            if (controlled) panels.push(controlled)
          }
          if (activeWorkTabs[0].id) {
            panels.push(...[...document.querySelectorAll('[role="tabpanel"][aria-labelledby]')].filter((panel) => panel.getAttribute('aria-labelledby') === activeWorkTabs[0].id))
          }
          const uniquePanels = [...new Set(panels)].filter((panel) => visible(panel) && !panel.closest('nav, aside') && !isNoise(panel, document.body))
          if (uniquePanels.length === 1) return { root: uniquePanels[0], identity: identity(uniquePanels[0]) }
        }

        const selectors = [
          '[data-e2e*="post-list"]', '[data-e2e*="work-list"]', '[data-e2e*="video-list"]',
          '[data-e2e*="user-post"]', '[data-e2e*="user-video"]', '[role="tabpanel"]',
          'main', '[role="main"]', '[role="list"]', 'ul', 'ol'
        ].join(', ')
        const candidates = [...new Set([...document.querySelectorAll(selectors)])]
          .filter((root) => visible(root) && !root.closest('nav, aside') && !isNoise(root, document.body) && workCount(root) > 0)
          .map((root) => ({ root, count: workCount(root), identity: identity(root) }))
        const pageWorkAnchors = [...document.querySelectorAll('a[href]')].filter((anchor) => canonicalWork(anchor))
        const common = lowestCommonAncestor(pageWorkAnchors)
        if (common && common !== document.body && common !== document.documentElement && !common.closest('nav, aside') && pageWorkAnchors.length >= 2) {
          candidates.push({ root: common, count: workCount(common), identity: identity(common, true) })
        }
        const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.root, candidate])).values()]
        if (!uniqueCandidates.length) throw new Error('SCHEMA_CHANGED:没有找到可验证的博主作品容器')
        const maximumCount = Math.max(...uniqueCandidates.map((candidate) => candidate.count))
        const maximum = uniqueCandidates.filter((candidate) => candidate.count === maximumCount)
        const deepest = maximum.filter((candidate) => !maximum.some((other) => other !== candidate && candidate.root.contains(other.root)))
        const uniqueRoots = [...new Set(deepest.map((candidate) => candidate.root))]
        if (uniqueRoots.length !== 1) throw new Error(`SCHEMA_CHANGED:博主作品容器不唯一（同为 ${maximumCount} 个作品的容器有 ${uniqueRoots.length} 个）`)
        const selected = deepest.find((candidate) => candidate.root === uniqueRoots[0])
        return { root: selected.root, identity: selected.identity }
      }
      const accumulated = new Map()
      const readWorks = (root) => {
        for (const anchor of root.querySelectorAll('a[href]')) {
          if (isNoise(anchor, root)) continue
          const work = canonicalWork(anchor)
          if (!work) continue
          accumulated.set(work.workId, {
            url: `https://www.douyin.com/${work.kind}/${work.workId}`,
            workId: work.workId,
            workType: work.kind === 'note' ? 'image' : 'video',
            creatorId: targetCreator.creatorId,
            sourceRegion: 'verified-creator-works-container'
          })
        }
      }
      let surface = locateWorksContainer()
      const containerIdentity = surface.identity
      readWorks(surface.root)
      let stableRounds = 0
      let exhausted = false
      for (let round = 0; round < 30 && accumulated.size < maximumWorks; round += 1) {
        const previousSize = accumulated.size
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
        await sleep(650)
        surface = locateWorksContainer()
        if (surface.identity !== containerIdentity) throw new Error('SCHEMA_CHANGED:博主作品容器在滚动过程中发生变化')
        readWorks(surface.root)
        stableRounds = accumulated.size === previousSize ? stableRounds + 1 : 0
        if (stableRounds >= 4) {
          exhausted = true
          break
        }
      }
      return {
        ok: true,
        snapshot: {
          contract: proofContract,
          creatorId: targetCreator.creatorId,
          profileUrl: targetCreator.profileUrl,
          routeOrigin: 'https://www.douyin.com',
          routeCreatorId: targetCreator.creatorId,
          extractionScope: 'verified-creator-works-container',
          containerIdentity,
          works: [...accumulated.values()].slice(0, maximumWorks),
          exhausted,
          collectedAt: new Date().toISOString()
        }
      }
    }
  })
  return result
}

function discoveryError(result, fallback) {
  if (result?.ok) return null
  const code = issueCodeFromMessage(result?.code || result?.message, fallback)
  const error = new Error(`${code}:${result?.message || '自动样本发现失败'}`)
  error.code = code
  return error
}

async function automaticSampleDiscovery(controllerUrl, token, targetCount) {
  const samplingSeed = createSamplingSeed()
  const samplingSeedSha256 = await sha256Canonical(samplingSeed)
  const discoveryStart = await controllerFetch(controllerUrl, token, '/v1/discovery-start', {
    method: 'POST',
    body: JSON.stringify({
      contract: DISCOVERY_CONTRACT,
      targetSampleCount: targetCount,
      samplingSeed,
      samplingSeedSha256,
      limits: {
        maxCreators: MAX_DISCOVERY_CREATORS,
        maxCandidateWorksPerCreator: MAX_CANDIDATE_WORKS_PER_CREATOR,
        maxSelectedWorksPerCreator: MAX_SELECTED_WORKS_PER_CREATOR
      },
      startedAt: new Date().toISOString()
    })
  })
  await publishState({
    runId: discoveryStart.runId,
    discovery: { targetSampleCount: targetCount, verifiedCreators: 0, inspectedCreators: 0, candidateWorks: 0 },
    status: 'discovering-following'
  })

  let ownerTabId = null
  let following
  try {
    const ownerTab = await chrome.tabs.create({ url: 'https://www.douyin.com/user/self?showTab=follow', active: true })
    ownerTabId = ownerTab.id
    if (!ownerTabId) throw new Error('BROWSER_OFFLINE:无法创建本人主页标签页')
    await waitForTab(ownerTabId)
    let opened = await openVerifiedFollowingDialog(ownerTabId)
    if (!opened?.ok && opened?.retryFocusedWithKeyboard) {
      await activateFocusedFollowingEntry(ownerTabId)
      opened = await verifyFollowingDialog(ownerTabId, opened.entryPoint)
    }
    const openError = discoveryError(opened, 'PAGE_CONTEXT_NOT_READY')
    if (openError) throw openError
    const collected = await collectVerifiedFollowing(ownerTabId)
    const collectError = discoveryError(collected, 'SCHEMA_CHANGED')
    if (collectError) throw collectError
    following = validateFollowingSnapshot({ ...collected.snapshot, entryPoint: opened.entryPoint })
  } finally {
    if (ownerTabId) {
      try { await chrome.tabs.remove(ownerTabId) } catch { /* already closed */ }
    }
  }

  const creatorOrder = deterministicShuffle(following.creators, samplingSeed, 'discovery-creator-order')
  const creatorWorks = []
  const excludedCreators = []
  const minimumCreatorsToInspect = Math.min(creatorOrder.length, Math.ceil(targetCount / MAX_SELECTED_WORKS_PER_CREATOR) + 4)
  let selected = null
  await publishState({ discovery: { targetSampleCount: targetCount, verifiedCreators: following.creators.length, inspectedCreators: 0, candidateWorks: 0 }, status: 'discovering-public-works' })
  for (const creator of creatorOrder) {
    if (await shouldStop(controllerUrl, token)) throw new Error('BROWSER_OFFLINE:阶段 B 自动发现已停止')
    let tabId = null
    try {
      const tab = await chrome.tabs.create({ url: creator.profileUrl, active: false })
      tabId = tab.id
      if (!tabId) throw new Error('BROWSER_OFFLINE:无法创建博主主页标签页')
      await waitForTab(tabId)
      const collected = await collectCreatorWorks(tabId, creator)
      const collectError = discoveryError(collected, 'SCHEMA_CHANGED')
      if (collectError) throw collectError
      creatorWorks.push(validateCreatorWorksSnapshot(collected.snapshot, creator.creatorId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = issueCodeFromMessage(message, 'SCHEMA_CHANGED')
      if (blockingCode(code)) throw error
      excludedCreators.push({ creatorId: creator.creatorId, code })
    } finally {
      if (tabId) {
        try { await chrome.tabs.remove(tabId) } catch { /* already closed */ }
      }
    }
    const candidateWorks = creatorWorks.reduce((sum, snapshot) => sum + snapshot.works.length, 0)
    await publishState({
      discovery: {
        targetSampleCount: targetCount,
        verifiedCreators: following.creators.length,
        inspectedCreators: creatorWorks.length + excludedCreators.length,
        candidateWorks
      },
      status: 'discovering-public-works'
    })
    try {
      selected = selectFollowingSamples(following, creatorWorks, targetCount, samplingSeed)
    } catch (error) {
      if (!String(error?.message || error).startsWith('INSUFFICIENT_ELIGIBLE_SAMPLES:')) throw error
    }
    if (selected && creatorWorks.length + excludedCreators.length >= minimumCreatorsToInspect) break
  }
  try {
    selected ||= selectFollowingSamples(following, creatorWorks, targetCount, samplingSeed)
  } catch (error) {
    const excludedCodeCounts = {}
    for (const excluded of excludedCreators) excludedCodeCounts[excluded.code] = (excludedCodeCounts[excluded.code] || 0) + 1
    error.diagnostics = {
      verifiedFollowingCreators: following.creators.length,
      inspectedCreatorProfiles: creatorWorks.length + excludedCreators.length,
      acceptedCreatorProfiles: creatorWorks.length,
      candidateWorks: creatorWorks.reduce((sum, snapshot) => sum + snapshot.works.length, 0),
      excludedCodeCounts
    }
    throw error
  }
  const manifest = assertNoSensitiveShape({
    contract: PHASE_B_CONTRACT,
    discoveryId: discoveryStart.runId,
    sampleCount: selected.length,
    samples: selected,
    sampling: {
      targetSampleCount: targetCount,
      samplingSeed,
      samplingSeedSha256,
      policy: 'seeded-random-creator-round-robin/v1',
      maxSelectedWorksPerCreator: MAX_SELECTED_WORKS_PER_CREATOR,
      workTypeCoverageWhenAvailable: true
    },
    followingProof: following,
    creatorWorksProofs: creatorWorks,
    excludedCreators,
    candidateCount: creatorWorks.reduce((sum, snapshot) => sum + snapshot.works.length, 0),
    limits: { maxApiPages: MAX_API_PAGES, pageSize: PAGE_SIZE },
    startedAt: new Date().toISOString()
  })
  const startResult = await controllerFetch(controllerUrl, token, '/v1/start', { method: 'POST', body: JSON.stringify(manifest) })
  return { ...startResult, samples: selected }
}

function blockingCode(code) {
  return code === 'LOGIN_REQUIRED' || code === 'CAPTCHA_OR_SECURITY_CHALLENGE'
}

async function runOneSample(sample, runId) {
  const startedAt = new Date().toISOString()
  const issues = []
  const networkPages = []
  const apiPages = []
  const networkEndpointPaths = []
  const performanceEndpointPaths = []
  let domShadow = { status: 'not-run', commentCount: 0, comments: [] }
  let tabId = null
  let attached = false
  let eligible = true
  let eligibilityReason = 'public-accessible-no-challenge'

  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
    tabId = tab.id
    if (!tabId) throw new Error('BROWSER_OFFLINE')
    const observation = await attachNetworkObserver(tabId)
    attached = true
    await chrome.tabs.update(tabId, { url: sample.url, active: false })
    await waitForTab(tabId)
    const warm = await warmCommentSurface(tabId, sample.workId)
    if (!warm?.ok) {
      const issue = safeIssue(warm?.code || 'PAGE_CONTEXT_NOT_READY', 'page-readiness', warm?.message || '页面尚未就绪')
      issues.push(issue)
      if (blockingCode(issue.code) || ['WORK_PRIVATE', 'WORK_DELETED'].includes(issue.code)) {
        eligible = false
        eligibilityReason = issue.code
      }
      if (blockingCode(issue.code)) stopRequested = true
    }
    await delay(NETWORK_OBSERVE_MS)
    await Promise.allSettled([...observation.pending])
    observation.accepting = false
    networkPages.push(...observation.pages.filter((page) => page.workId === sample.workId))
    networkEndpointPaths.push(...observation.endpointPaths.values())
    issues.push(...observation.issues)

    const discovered = await discoverTemplateInMainWorld(tabId, sample.workId)
    performanceEndpointPaths.push(...(discovered?.endpointPaths || []))
    const templateUrl = observation.templateUrl || discovered?.templateUrl
    let cursor = '0'
    if (templateUrl && eligible && !stopRequested) {
      for (let pageIndex = 0; pageIndex < MAX_API_PAGES; pageIndex += 1) {
        const fetched = await pageContextFetch(tabId, { templateUrl, workId: sample.workId, cursor, count: PAGE_SIZE })
        if (!fetched?.ok) {
          const issue = safeIssue(fetched?.code || 'API_STATUS_ERROR', 'page-context-fetch', fetched?.message || '页面上下文请求失败', { httpStatus: fetched?.httpStatus })
          issues.push(issue)
          if (blockingCode(issue.code)) {
            eligible = false
            eligibilityReason = issue.code
            stopRequested = true
          }
          break
        }
        try {
          if (Number(fetched.safeBody?.invalid_comment_count || 0) > 0) {
            throw new Error(`SCHEMA_CHANGED:${fetched.safeBody.invalid_comment_count} 条评论未通过白名单字段校验`)
          }
          const page = normalizeCommentPage(fetched.safeBody, {
            workId: sample.workId,
            cursorIn: cursor,
            sourceKind: 'page-context-fetch',
            collectedAt: new Date().toISOString()
          })
          page.responseBodySha256 = await sha256Canonical(whitelistPageForHash(page))
          page.signatureProvider = fetched.signatureProvider
          apiPages.push(page)
          if (!page.hasMore || page.completion === 'verified-empty' || !page.cursorOut || page.cursorOut === cursor) break
          cursor = page.cursorOut
          await delay(jitter(800, 400))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          issues.push(safeIssue(issueCodeFromMessage(message), 'normalization', message))
          break
        }
      }
    } else if (eligible && !stopRequested) {
      issues.push(safeIssue('PAGE_CONTEXT_NOT_READY', 'request-template', discovered?.message || '没有观察到评论请求模板'))
    }

    domShadow = await collectDomShadow(tabId, sample.workId)
    if (domShadow?.status === 'error' && domShadow?.issue) {
      const issue = safeIssue(domShadow.issue.code || 'SCHEMA_CHANGED', 'dom-shadow', domShadow.issue.message || 'DOM shadow 目标发生变化')
      issues.push(issue)
      if (['WORK_PRIVATE', 'WORK_DELETED'].includes(issue.code)) {
        eligible = false
        eligibilityReason = issue.code
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = message.includes('PAGE_NAVIGATION_TIMEOUT') ? 'PAGE_NAVIGATION_TIMEOUT' : 'BROWSER_OFFLINE'
    issues.push(safeIssue(code, 'sample-runner', message))
  } finally {
    if (attached && tabId) await detachNetworkObserver(tabId)
    if (tabId) {
      try { await chrome.tabs.remove(tabId) } catch { /* already closed */ }
    }
  }

  const report = {
    contract: SAMPLE_REPORT_CONTRACT,
    runId,
    sampleIndex: sample.index,
    sourceUrl: sample.url,
    workId: sample.workId,
    workType: sample.workType,
    startedAt,
    endedAt: new Date().toISOString(),
    eligibility: { eligible, reason: eligibilityReason },
    network: {
      status: networkPages.length > 0 ? 'success' : issues.some((issue) => issue.phase === 'network-response') ? 'error' : 'not-observed',
      pages: networkPages
    },
    pageContextApi: {
      status: apiPages.length > 0 ? 'success' : issues.some((issue) => issue.phase === 'page-context-fetch') ? 'error' : 'not-ready',
      pages: apiPages
    },
    domShadow,
    endpointProbe: {
      network: networkEndpointPaths,
      performance: performanceEndpointPaths
    },
    comparison: compareChannels(networkPages, apiPages, domShadow),
    issues
  }
  return assertNoSensitiveShape(report)
}

async function shouldStop(controllerUrl, token) {
  if (stopRequested) return true
  try {
    const result = await controllerFetch(controllerUrl, token, '/v1/should-stop', { method: 'GET' })
    return Boolean(result.stop)
  } catch {
    return true
  }
}

async function runSamples(controllerUrl, token, runId, samples) {
  stopRequested = false
  await publishState({ running: true, runId, total: samples.length, completed: 0, status: 'running', lastIssue: null })
  let completed = 0
  try {
    for (const sample of samples) {
      if (await shouldStop(controllerUrl, token)) break
      await publishState({ currentWorkId: sample.workId, status: `sample-${sample.index}-of-${samples.length}` })
      const report = await runOneSample(sample, runId)
      await controllerFetch(controllerUrl, token, '/v1/report', { method: 'POST', body: JSON.stringify(report) })
      completed += 1
      await publishState({ completed })
      if (report.issues.some((issue) => blockingCode(issue.code))) break
      await delay(jitter())
    }
    const final = await controllerFetch(controllerUrl, token, '/v1/complete', {
      method: 'POST',
      body: JSON.stringify({ runId, completed, stopped: completed < samples.length || stopRequested })
    })
    await publishState({ running: false, currentWorkId: null, status: final.status || 'complete' })
  } catch (error) {
    await publishState({
      running: false,
      currentWorkId: null,
      status: 'failed',
      lastIssue: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
    })
  } finally {
    await chrome.storage.session.remove(['phaseBSessionToken'])
  }
}

async function runAutomaticPhaseB(controllerUrl, token, targetCount) {
  try {
    const discovered = await automaticSampleDiscovery(controllerUrl, token, targetCount)
    await publishState({
      runId: discovered.runId,
      total: discovered.samples.length,
      completed: 0,
      currentWorkId: null,
      status: 'manifest-frozen'
    })
    await runSamples(controllerUrl, token, discovered.runId, discovered.samples)
  } catch (error) {
    const message = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
    try {
      await controllerFetch(controllerUrl, token, '/v1/discovery-fail', {
        method: 'POST',
        body: JSON.stringify({
          contract: 'signaldesk-phase-b-discovery-failure/v1',
          code: issueCodeFromMessage(message, message.startsWith('INSUFFICIENT_ELIGIBLE_SAMPLES:') ? 'INSUFFICIENT_ELIGIBLE_SAMPLES' : 'SCHEMA_CHANGED'),
          message,
          ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}),
          failedAt: new Date().toISOString()
        })
      })
    } catch {
      // The local controller may already be stopped; keep the sanitized state locally.
    }
    await publishState({ running: false, currentWorkId: null, status: 'discovery-failed', lastIssue: message })
    await chrome.storage.session.remove(['phaseBSessionToken'])
  }
}

async function beginAutomaticPhaseB(controllerUrl, targetCount) {
  throw new Error(LEGACY_PHASE_B_DISABLED_REASON)
  /* c8 ignore start -- frozen legacy implementation retained only as failure evidence. */
  if (state.running) throw new Error('已有阶段 B PoC 正在运行')
  const count = validateTargetSampleCount(targetCount)
  const token = await pairController(controllerUrl)
  stopRequested = false
  await publishState({
    running: true,
    runId: null,
    total: count,
    completed: 0,
    currentWorkId: null,
    discovery: { targetSampleCount: count, verifiedCreators: 0, inspectedCreators: 0, candidateWorks: 0 },
    status: 'starting-automatic-discovery',
    lastIssue: null
  })
  void runAutomaticPhaseB(controllerUrl, token, count)
  return { accepted: true, automaticDiscovery: true, targetSampleCount: count }
  /* c8 ignore stop */
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'phase-b.state') {
    sendResponse({ ...state })
    return false
  }
  if (message?.type === 'phase-b.start') {
    void (async () => {
      const controllerUrl = String(message.controllerUrl || '')
      sendResponse(await beginAutomaticPhaseB(controllerUrl, message.targetSampleCount))
    })().catch((error) => sendResponse({ accepted: false, error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)) }))
    return true
  }
  if (message?.type === 'phase-b.stop') {
    void (async () => {
      stopRequested = true
      const token = String((await chrome.storage.session.get('phaseBSessionToken')).phaseBSessionToken || '')
      const result = await controllerFetch(String(message.controllerUrl || ''), token, '/v1/stop', { method: 'POST', body: '{}' })
      await publishState({ status: 'stop-requested' })
      sendResponse(result)
    })().catch((error) => sendResponse({ stopped: false, error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)) }))
    return true
  }
  return false
})

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await delay(750)
    const saved = await chrome.storage.local.get(['phaseBControllerUrl', 'phaseBTargetSampleCount'])
    const controllerUrl = String(saved.phaseBControllerUrl || 'http://127.0.0.1:43827')
    const targetCount = Number(saved.phaseBTargetSampleCount || DEFAULT_SAMPLE_COUNT)
    await beginAutomaticPhaseB(controllerUrl, targetCount)
  })().catch(() => {
    // Auto-start is only armed while the local controller is running. The popup remains a manual retry surface.
  })
})

void chrome.storage.local.get('phaseBState').then((stored) => {
  if (stored.phaseBState && !stored.phaseBState.running) Object.assign(state, stored.phaseBState)
  if (stored.phaseBState?.running) void publishState({ running: false, status: 'interrupted-service-worker-restart', currentWorkId: null })
})
