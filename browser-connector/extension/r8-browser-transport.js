const ROUTES = Object.freeze({
  'following-list': { routeId: 'DY-FOLLOW-NETWORK', path: '/aweme/v1/web/user/following/list/' },
  'creator-work-list': { routeId: 'DY-WORKS-NETWORK', path: '/aweme/v1/web/aweme/post/' },
  'work-detail': { routeId: 'DY-DETAIL-NETWORK', path: '/aweme/v1/web/aweme/detail/' },
  'comment-list': { routeId: 'DY-COMMENT-NETWORK', path: '/aweme/v1/web/comment/list/' },
  'comment-reply-list': { routeId: 'DY-REPLY-NETWORK', path: '/aweme/v1/web/comment/list/reply/' }
})
const PUBLIC_ID = /^[A-Za-z0-9._-]{1,240}$/
const SAFE_TEMPLATE_NAMES = new Set(['aid', 'channel', 'device_platform', 'count'])
const FOLLOWING_CONTEXT_NAMES = new Set(['min_time', 'max_time'])
const PAGINATION_NAMES = new Set(['cursor', 'max_cursor', 'offset', 'min_time', 'max_time'])

function reject(code) { throw Object.assign(new Error(`R8_TRANSPORT_${code}`), { code }) }
function publicId(value, code) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value)) reject(code)
  return value
}

export function safeTemplateFromObservation(observation) {
  const route = ROUTES[observation?.endpointKind]
  if (!route || observation.routeId !== route.routeId || !Array.isArray(observation.requestParameters)) reject('TEMPLATE_ROUTE_INVALID')
  const parameters = {}
  for (const entry of observation.requestParameters) {
    if (!SAFE_TEMPLATE_NAMES.has(entry?.name)
      && !(observation.endpointKind === 'following-list' && FOLLOWING_CONTEXT_NAMES.has(entry?.name))) continue
    if (typeof entry.value !== 'string' || entry.value.length > 100 || !/^[A-Za-z0-9._-]+$/.test(entry.value)) reject('TEMPLATE_VALUE_INVALID')
    if (FOLLOWING_CONTEXT_NAMES.has(entry.name) && !/^\d{1,20}$/.test(entry.value)) reject('TEMPLATE_VALUE_INVALID')
    parameters[entry.name] = entry.value
  }
  if (observation.endpointKind === 'following-list'
    && observation.requestParameters.some((entry) => entry.name === 'offset' && /^\d{1,20}$/.test(entry.value))) {
    parameters.initialPaginationField = 'offset'
  }
  if (!parameters.aid || !parameters.device_platform) reject('TEMPLATE_INCOMPLETE')
  return Object.freeze(parameters)
}

export function buildR8ReadUrl(input, template) {
  const route = ROUTES[input?.endpointKind]
  if (!route || input.routeId !== route.routeId || input.path !== route.path || input.method !== 'GET') reject('ROUTE_INVALID')
  const url = new URL(route.path, 'https://www.douyin.com')
  for (const name of SAFE_TEMPLATE_NAMES) {
    const value = template?.[name]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9._-]+$/.test(value)) reject('TEMPLATE_VALUE_INVALID')
    url.searchParams.set(name, value)
  }
  if (!url.searchParams.has('aid') || !url.searchParams.has('device_platform')) reject('TEMPLATE_INCOMPLETE')
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 100) reject('COUNT_INVALID')
  url.searchParams.set('count', String(input.count))
  if (input.endpointKind === 'following-list' || input.endpointKind === 'creator-work-list') {
    url.searchParams.set('sec_user_id', publicId(input.target?.secUserId, 'SEC_UID_INVALID'))
  } else {
    url.searchParams.set('aweme_id', publicId(input.target?.workId, 'WORK_ID_INVALID'))
  }
  if (input.endpointKind === 'comment-reply-list') {
    url.searchParams.set('comment_id', publicId(input.target?.rootCommentId, 'ROOT_ID_INVALID'))
  }
  if (input.endpointKind !== 'work-detail') {
    const cursor = String(input.cursor ?? '')
    if (!/^\d{1,20}$/.test(cursor)) reject('CURSOR_INVALID')
    const initialField = input.endpointKind === 'following-list' ? template?.initialPaginationField ?? null
      : input.endpointKind === 'creator-work-list' ? 'max_cursor' : 'cursor'
    const field = input.cursorField ?? initialField
    if (field !== null) {
      if (!PAGINATION_NAMES.has(field)) reject('CURSOR_FIELD_INVALID')
      if (input.endpointKind === 'creator-work-list' && field !== 'max_cursor') reject('CURSOR_FIELD_INVALID')
      if (input.endpointKind.startsWith('comment-') && field !== 'cursor') reject('CURSOR_FIELD_INVALID')
      url.searchParams.set(field, cursor)
    }
    if (input.endpointKind === 'following-list') {
      for (const name of FOLLOWING_CONTEXT_NAMES) {
        const value = template?.[name]
        if (value === undefined) continue
        if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) reject('TEMPLATE_VALUE_INVALID')
        url.searchParams.set(name, value)
      }
    }
  }
  return url.toString()
}

export function createR8BrowserRequest({ debuggerApi, tabId, templates, getTab }) {
  if (!debuggerApi?.sendCommand || !Number.isSafeInteger(tabId) || tabId <= 0 || typeof getTab !== 'function') reject('BROWSER_CONTEXT_INVALID')
  return async (input) => {
    const tab = await getTab(tabId)
    if (!tab?.url?.startsWith('https://www.douyin.com/')) reject('PAGE_ORIGIN_INVALID')
    const template = templates?.[input.endpointKind]
    if (!template) reject('TEMPLATE_MISSING')
    const url = buildR8ReadUrl(input, template)
    // Only the public IDs and whitelisted parameters cross CDP. The browser
    // keeps its own cookies; neither response bodies nor request URLs persist.
    const expression = `(async () => {
      const response = await fetch(${JSON.stringify(url)}, { method: 'GET', credentials: 'include', cache: 'no-store' });
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = /^\\d{1,4}$/.test(retryAfter || '') ? Number(retryAfter) : null;
      if (response.status !== 200) return { status: response.status, retryAfterSeconds };
      const text = await response.text();
      if (text.length > 2097152) return { status: response.status, oversized: true, retryAfterSeconds };
      try { return { status: response.status, body: JSON.parse(text), retryAfterSeconds }; }
      catch { return { status: response.status, invalidJson: true, retryAfterSeconds }; }
    })()`
    let evaluated
    try {
      evaluated = await debuggerApi.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, timeout: 30000
      })
    } catch { reject('PAGE_FETCH_FAILED') }
    if (evaluated?.exceptionDetails || !evaluated?.result?.value) reject('PAGE_FETCH_FAILED')
    const value = evaluated.result.value
    if (value.oversized) reject('RESPONSE_TOO_LARGE')
    if (value.invalidJson) reject('INVALID_JSON')
    return value
  }
}
