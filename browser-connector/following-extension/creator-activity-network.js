// Observe the author's own native list response before navigation. Never read page DOM,
// persist request URLs/headers, or replace a rejected native request with another GET.
export function projectCreatorActivityResponse(input) {
  const root = input?.data || input
  if (!root || root.status_code !== 0) throw new Error('ACTIVITY_RESPONSE_REJECTED')
  if (!Array.isArray(root.aweme_list) || root.aweme_list.length > 200 || ![true, false, 0, 1].includes(root.has_more)) throw new Error('ACTIVITY_LIST_SCHEMA_INVALID')
  const integer = value => Number.isSafeInteger(value) ? value : null
  const boolean = value => typeof value === 'boolean' ? value : null
  return {
    status_code: 0, has_more: root.has_more, max_cursor: integer(root.max_cursor),
    aweme_list: root.aweme_list.map(row => ({
      aweme_id: String(row.aweme_id || ''), author: {uid: String(row.author?.uid || ''), sec_uid: row.author?.sec_uid || ''},
      create_time: integer(row.create_time), is_top: [true, false, 0, 1].includes(row.is_top) ? row.is_top : null,
      status: {private_status: integer(row.status?.private_status), is_delete: boolean(row.status?.is_delete),
        is_prohibited: boolean(row.status?.is_prohibited), allow_share: boolean(row.status?.allow_share)},
      is_story: integer(row.is_story), is_24_story: integer(row.is_24_story), aweme_type: integer(row.aweme_type)
    }))
  }
}

// These are web-response observations, not Open Platform enums. Positive private
// markers are excluded without assigning names to individual numeric values.
export function classifyActivityVisibility(value) {
  if (value.isDelete === true) return 'deleted'
  if (value.isProhibited === true) return 'prohibited'
  if (Number.isSafeInteger(value.privateStatus) && value.privateStatus > 0) return 'restricted'
  if ((Number.isSafeInteger(value.isStory) && value.isStory > 0) || (Number.isSafeInteger(value.is24Story) && value.is24Story > 0)) return 'temporary-marker'
  if (value.privateStatus === 0 && value.isDelete === false && value.isProhibited === false && value.isStory === 0 && value.is24Story === 0 && value.allowShare !== false) return 'public'
  return 'unknown'
}

export async function observeCreatorActivity(chrome, target, secUid) {
  const requests = new Map(), pages = new Map()
  let stopped = false, nativeListRequests = 0
  const matches = raw => {
    try {
      const url = new URL(raw)
      if (url.origin !== 'https://www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/post/' || url.searchParams.get('sec_user_id') !== secUid) return null
      const rawCursor = url.searchParams.get('max_cursor')
      if (rawCursor === null || !/^\d+$/.test(rawCursor)) return null
      const cursor = Number(rawCursor)
      return Number.isSafeInteger(cursor) ? cursor : null
    } catch { return null }
  }
  const settle = (entry, value) => {if (!entry.finished) {entry.finished = true; entry.resolve(value)}}
  const listener = (source, method, params) => {
    if (stopped || source.tabId !== target.tabId) return
    if (method === 'Network.requestWillBeSent') {
      const cursor = params.request?.method === 'GET' ? matches(params.request.url) : null
      if (cursor === null) return
      if (requests.has(params.requestId)) {settle(requests.get(params.requestId), {errorCode: 'ACTIVITY_NATIVE_REDIRECT'}); return}
      nativeListRequests++
      const entry = {cursor, finished: false, response: false, observedAt: new Date().toISOString()}
      entry.promise = new Promise(resolve => {entry.resolve = resolve})
      requests.set(params.requestId, entry)
      if (!pages.has(cursor)) pages.set(cursor, entry)
    }
    const entry = requests.get(params.requestId)
    if (!entry || entry.finished) return
    if (method === 'Network.responseReceived') {
      if (matches(params.response?.url) !== entry.cursor) {settle(entry, {errorCode: 'ACTIVITY_NATIVE_RESPONSE_MISMATCH'}); return}
      entry.response = true
      if (params.response.status !== 200) settle(entry, {errorCode: 'ACTIVITY_HTTP_' + params.response.status})
    } else if (method === 'Network.loadingFailed') {
      settle(entry, {errorCode: 'ACTIVITY_NATIVE_LOAD_FAILED'})
    } else if (method === 'Network.loadingFinished') {
      if (!entry.response || params.encodedDataLength > 4 * 1024 * 1024) {settle(entry, {errorCode: 'ACTIVITY_NATIVE_BODY_UNAVAILABLE'}); return}
      void chrome.debugger.sendCommand(target, 'Network.getResponseBody', {requestId: params.requestId}).then(body => {
        const text = body.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(body.body), c => c.charCodeAt(0))) : body.body
        if (text.length > 4 * 1024 * 1024) throw new Error('ACTIVITY_BODY_TOO_LARGE')
        let root
        try {root = JSON.parse(text)} catch {throw new Error('ACTIVITY_JSON_UNAVAILABLE')}
        const projected = projectCreatorActivityResponse(root)
        settle(entry, {root: projected, sourceProof: {kind: 'native-network', endpoint: '/aweme/v1/web/aweme/post/', method: 'GET',
          secUid, requestCursor: entry.cursor, httpStatus: 200, observedAt: entry.observedAt}})
      }).catch(error => settle(entry, {errorCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'ACTIVITY_NATIVE_BODY_UNAVAILABLE'}))
    }
  }
  chrome.debugger.onEvent.addListener(listener)
  try {await chrome.debugger.sendCommand(target, 'Network.enable', {maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: 4 * 1024 * 1024})}
  catch (error) {chrome.debugger.onEvent.removeListener(listener); throw error}
  return {
    get nativeListRequests() {return nativeListRequests},
    async page(cursor, {waitMs = 8000, active = async () => {}} = {}) {
      const deadline = Date.now() + waitMs
      do {
        await active()
        const entry = pages.get(cursor)
        if (entry) {
          const value = await Promise.race([entry.promise, new Promise(resolve => setTimeout(() => resolve(null), 100))])
          if (value) return value
        } else if (cursor !== 0) return null
        if (Date.now() >= deadline) return {errorCode: cursor === 0 && !entry ? 'ACTIVITY_NATIVE_LIST_UNAVAILABLE' : 'ACTIVITY_NATIVE_BODY_UNAVAILABLE'}
        if (!entry) await new Promise(resolve => setTimeout(resolve, 100))
      } while (true)
    },
    async stop({keepNetworkEnabled=false}={}) {
      if (stopped) return
      stopped = true; chrome.debugger.onEvent.removeListener(listener)
      for (const entry of requests.values()) settle(entry, {errorCode: 'ACTIVITY_SESSION_ENDED'})
      if(!keepNetworkEnabled)await chrome.debugger.sendCommand(target, 'Network.disable').catch(() => {})
    }
  }
}
