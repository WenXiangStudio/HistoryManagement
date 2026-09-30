import { followingFailureMessage, followingRequest, projectFollowingResponse } from './following-core.js'

async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((entry) => entry.toString(16).padStart(2,'0')).join('')
}
export async function runFollowingSync(config, { chromeApi = globalThis.chrome, fetchApi = globalThis.fetch,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const chrome = chromeApi
  const fetch = fetchApi
  const sleep = delay
  let tabId = null
  let attached = false
  let stopped = false
  let firstRequestSeen = false
  let candidate = null
  let failure = null
  let stage = 'starting'
  let detachReason = null
  let followingBodiesRead = 0
  const requests = new Map()
  const diagnostic = (code = null) => ({ stage, code, detachReason, firstRequestSeen,
    followingBodiesRead, projectedCreatorCount: candidate?.creators.length ?? 0,
    activeApiRequests: 0, workResponseBodiesRead: 0 })
  const feedback = async (phase, message, count = 0) => {
    if (chrome.action) {
      try {
        await chrome.action.setBadgeText({ text: phase === 'completed' ? String(count) : phase === 'blocked' ? '!' : '…' })
        await chrome.action.setBadgeBackgroundColor({ color: phase === 'completed' ? '#34794f' : phase === 'blocked' ? '#a33b32' : '#50695a' })
      } catch { /* UI feedback failure must not prevent receipt of the actual collection outcome. */ }
    }
    if (tabId !== null) {
      try { await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.following.feedback', phase, message }) } catch { /* Page not yet loaded or tab closed. */ }
    }
  }
  const post = async (path, body) => {
    const response = await fetch(config.origin + path, { method: 'POST', headers: {
      authorization: `Bearer ${config.token}`, 'content-type': 'application/json'
    }, body: JSON.stringify({ ...body, runId: config.runId }) })
    if (!response.ok) throw new Error('APP_SESSION_REJECTED')
    return response.json()
  }
  const progress = async (message) => {
    await post('/progress', { phase: 'running', message, diagnostic: diagnostic() })
    await feedback('running', message)
  }
  const active = async () => {
    const response = await fetch(config.origin + '/status', { headers: { authorization: `Bearer ${config.token}` } })
    if (!response.ok) throw new Error('APP_UNAVAILABLE')
    const state = await response.json()
    if (state.runId !== config.runId || !['awaiting-config','running'].includes(state.phase)) throw new Error('APP_SESSION_ENDED')
  }
  const listener = (source, method, params) => {
    if (source.tabId !== tabId || stopped) return
    if (method === 'Network.requestWillBeSent') {
      // No cookies, headers, tokens or unrelated URLs are retained.
      try {
        const request = followingRequest(params.request.url)
        if (!request || firstRequestSeen) return
        if (params.request.method !== 'GET') throw new Error('FOLLOWING_REQUEST_METHOD_INVALID')
        firstRequestSeen = true
        requests.set(params.requestId, { ...request, status: null })
      } catch (error) { failure = error }
    }
    if (method === 'Network.responseReceived' && requests.has(params.requestId)) {
      requests.get(params.requestId).status = params.response.status
    }
    if (method === 'Network.loadingFailed' && requests.has(params.requestId)) failure = new Error('FOLLOWING_NETWORK_FAILED')
    if (method === 'Network.loadingFinished' && requests.has(params.requestId)) {
      const request = requests.get(params.requestId)
      requests.delete(params.requestId)
      void (async () => {
        if (stopped || failure) return
        if (request.status !== 200) throw new Error('FOLLOWING_HTTP_' + request.status)
        const tab = await chrome.tabs.get(tabId)
        if (new URL(tab.url).pathname.replace(/\/+$/, '') !== '/user/self') throw new Error('OWNER_SELF_ROUTE_CHANGED')
        // Only the following-list body is requested from CDP. Work/detail/comment bodies are ignored.
        const result = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: params.requestId })
        followingBodiesRead += 1
        if (stopped || failure) return
        const text = result.base64Encoded
          ? new TextDecoder().decode(Uint8Array.from(atob(result.body), (character) => character.charCodeAt(0))) : result.body
        if (text.length > 2 * 1024 * 1024) throw new Error('FOLLOWING_BODY_TOO_LARGE')
        candidate = { ...projectFollowingResponse(JSON.parse(text)), ownerSecUid: request.ownerSecUid }
      })().catch((error) => { failure = error })
    }
  }
  const detachListener = (source, reason) => {
    if (source.tabId !== tabId || stopped) return
    detachReason = ['canceled_by_user', 'target_closed'].includes(reason) ? reason : 'unknown'
    failure = new Error('BROWSER_DEBUGGER_DETACHED')
  }
  try {
    await active()
    await progress('正在连接 Chrome；尚未读取或保存关注结果。')
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    tabId = tab.id
    chrome.debugger.onEvent.addListener(listener)
    chrome.debugger.onDetach.addListener(detachListener)
    await chrome.debugger.attach({ tabId }, '1.3'); attached = true
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxResourceBufferSize: 2 * 1024 * 1024 })
    await active()
    stage = 'opening-self'
    await progress('正在打开当前登录账号主页；请保留自动打开的抖音标签页和顶部连接提示。')
    await chrome.tabs.update(tabId, { url: 'https://www.douyin.com/user/self' })
    const deadline = Date.now() + 60000
    let triggerReady = false
    let opened = null
    while (Date.now() < deadline) {
      await sleep(500)
      if (failure) throw failure
      await active()
      const current = await chrome.tabs.get(tabId)
      if (current.status !== 'complete') continue
      try {
        stage = 'opening-following'
        await progress('正在打开自己的关注列表；尚未保存博主信息。')
        opened = await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.r8.open-following-dialog' })
        triggerReady = true; break
      } catch (error) {
        if (failure) throw failure
        if (!/Receiving end does not exist|Could not establish connection/.test(String(error.message))) throw error
        /* Wait for the document_idle content script. */
      }
    }
    if (failure) throw failure
    if (!triggerReady) throw new Error('FOLLOWING_PAGE_NOT_READY')
    if (!opened?.ok) throw new Error(opened?.code || 'FOLLOWING_DIALOG_NOT_OPENED')
    stage = 'waiting-response'
    await progress('已打开自己的关注列表，正在读取第一页基础信息；结果尚未保存。')
    const responseDeadline = Date.now() + 20000
    while (!candidate && !failure && Date.now() < responseDeadline) { await sleep(250); await active() }
    if (failure) throw failure
    if (!candidate) throw new Error('FOLLOWING_FIRST_RESPONSE_NOT_OBSERVED')
    stage = 'verifying'
    await progress(`已读到 ${candidate.creators.length} 位博主基础信息，正在核对关注页归属；结果尚未保存。`)
    const verified = await chrome.tabs.sendMessage(tabId, { type: 'signaldesk.following.verify' })
    if (!verified?.ok) throw new Error(verified?.code || 'FOLLOWING_UI_VERIFICATION_FAILED')
    if (failure) throw failure
    const report = {
      contract: 'signaldesk-following-directory/v1', runId: config.runId, collectedAt: new Date().toISOString(),
      ownerSecUid: candidate.ownerSecUid, sourceUrl: 'https://www.douyin.com/user/self',
      endpointPath: '/aweme/v1/web/user/following/list/', firstPage: true, activeFollowingTab: true,
      hasMore: candidate.hasMore, responseItemCount: candidate.responseItemCount, creators: candidate.creators,
      projectionSha256: await sha256(JSON.stringify(candidate.creators)), activeApiRequests: 0, workResponseBodiesRead: 0
    }
    await active()
    if (failure) throw failure
    stage = 'saving'
    await progress(`正在将 ${candidate.creators.length} 位博主基础信息保存到 APP 本地数据库…`)
    const saved = await post('/report', report)
    stage = 'finished'
    await feedback(saved.phase, saved.message, saved.count)
    await chrome.storage.local.set({ lastFollowingResult: { runId: config.runId, count: saved.count,
      status: saved.phase === 'completed' ? 'saved' : 'partial', message: saved.message, diagnostic: diagnostic() } })
  } catch (error) {
    const raw = String(error?.message || error)
    const code = /^[A-Z0-9_-]{1,100}$/.test(raw) ? raw : 'FOLLOWING_RUNTIME_ERROR'
    const message = followingFailureMessage(code, detachReason)
    try { await post('/progress', { phase: 'blocked', message, diagnostic: diagnostic(code) }) } catch { /* APP closed or cancelled. */ }
    await feedback('blocked', message)
    await chrome.storage.local.set({ lastFollowingResult: { runId: config.runId, status: 'blocked', message, diagnostic: diagnostic(code) } })
  } finally {
    stopped = true
    chrome.debugger.onEvent.removeListener(listener); chrome.debugger.onDetach.removeListener(detachListener)
    if (attached) { try { await chrome.debugger.detach({ tabId }) } catch { /* Already detached. */ } }
  }
}
