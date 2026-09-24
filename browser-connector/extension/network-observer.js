const DEBUGGER_PROTOCOL_VERSION = '1.3'
const DEFAULT_MAX_BUFFERED_RESPONSES = 32
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024

export const NETWORK_ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({
    routeId: 'DY-FOLLOW-NETWORK',
    endpointKind: 'following-list',
    pathPattern: /^\/aweme\/v1\/web\/user\/following\/list\/?$/
  }),
  Object.freeze({
    routeId: 'DY-WORKS-NETWORK',
    endpointKind: 'creator-work-list',
    pathPattern: /^\/aweme\/v1\/web\/aweme\/post\/?$/
  }),
  Object.freeze({
    routeId: 'DY-DETAIL-NETWORK',
    endpointKind: 'work-detail',
    pathPattern: /^\/aweme\/v1\/web\/aweme\/detail\/?$/
  }),
  Object.freeze({
    routeId: 'DY-REPLY-NETWORK',
    endpointKind: 'comment-reply-list',
    pathPattern: /^\/aweme\/v1\/web\/comment\/list\/reply\/?$/
  }),
  Object.freeze({
    routeId: 'DY-COMMENT-NETWORK',
    endpointKind: 'comment-list',
    pathPattern: /^\/aweme\/v1\/web\/comment\/list\/?$/
  }),
  Object.freeze({
    routeId: 'DY-MEDIA-NETWORK',
    endpointKind: 'media-resource',
    pathPattern: /^\/aweme\/v1\/web\/(?:aweme\/media|media\/resource)\/?$/
  })
])

const SAFE_PARAMETERS = Object.freeze({
  'following-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'offset', 'min_time', 'max_time', 'sec_user_id']),
  'creator-work-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'sec_user_id']),
  'work-detail': new Set(['aid', 'aweme_id', 'channel', 'device_platform', 'item_id']),
  'comment-list': new Set(['aid', 'aweme_id', 'channel', 'count', 'cursor', 'device_platform']),
  'comment-reply-list': new Set(['aid', 'aweme_id', 'channel', 'comment_id', 'count', 'cursor', 'device_platform', 'item_id']),
  'media-resource': new Set(['aid', 'aweme_id', 'channel', 'device_platform', 'item_id'])
})

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function platformPayload(value) {
  return isRecord(value?.data) ? value.data : value
}

function firstArray(payload, names) {
  const root = platformPayload(payload)
  for (const name of names) {
    if (Array.isArray(root?.[name])) return root[name]
  }
  return null
}

function firstRecord(payload, names) {
  const root = platformPayload(payload)
  for (const name of names) {
    if (isRecord(root?.[name])) return root[name]
  }
  return null
}

function hasNativeId(value, names) {
  return isRecord(value) && names.some((name) => typeof value[name] === 'string' && /^[A-Za-z0-9._-]{1,240}$/.test(value[name]))
}

function nativeId(value, names) {
  if (!isRecord(value)) return null
  for (const name of names) {
    if (typeof value[name] === 'string' && /^[A-Za-z0-9._-]{1,240}$/.test(value[name])) return value[name]
  }
  return null
}

function hasArrayShape(payload, names, predicate) {
  const values = firstArray(payload, names)
  return values !== null && (values.length === 0 || values.every(predicate))
}

function isFollowingSchema(payload) {
  return hasArrayShape(payload, ['user_list', 'users', 'followings'], (entry) => hasNativeId(entry, ['uid', 'sec_uid']))
}

function validWork(entry) {
  return hasNativeId(entry, ['aweme_id']) && isRecord(entry.author) && hasNativeId(entry.author, ['uid', 'sec_uid'])
}

function isCreatorWorkSchema(payload) {
  return hasArrayShape(payload, ['aweme_list'], validWork)
}

function isWorkDetailSchema(payload) {
  const detail = firstRecord(payload, ['aweme_detail'])
  return validWork(detail)
}

function validComment(entry) {
  return hasNativeId(entry, ['cid']) && hasNativeId(entry, ['aweme_id'])
}

function hasReplyRelationship(entry) {
  return isRecord(entry) && [entry.reply_id, entry.reply_to_comment_id, entry.root_comment_id, entry.parent_comment_id]
    .some((value) => typeof value === 'string' && value.length > 0 && value !== '0')
}

function isReplySchema(payload) {
  const comments = firstArray(payload, ['comments'])
  return comments !== null && (comments.length === 0 || comments.every((entry) => validComment(entry) && hasReplyRelationship(entry)))
}

function isCommentSchema(payload) {
  const comments = firstArray(payload, ['comments'])
  return comments !== null && (comments.length === 0 || (comments.every(validComment) && !isReplySchema(payload)))
}

function validMediaResource(entry) {
  if (!isRecord(entry) || !hasNativeId(entry, ['aweme_id', 'item_id'])) return false
  const resources = Array.isArray(entry.resources) ? entry.resources : []
  return resources.length > 0 && resources.every((resource) => {
    if (!isRecord(resource) || !['video', 'audio', 'subtitle', 'image'].includes(resource.kind)) return false
    const urls = Array.isArray(resource.url_list) ? resource.url_list : []
    return urls.length > 0 && urls.every((url) => typeof url === 'string' && /^https:\/\//i.test(url))
  })
}

function isMediaSchema(payload) {
  return hasArrayShape(payload, ['resource_list', 'media_list'], validMediaResource)
}

const SCHEMA_CLASSIFIERS = Object.freeze({
  'following-list': isFollowingSchema,
  'creator-work-list': isCreatorWorkSchema,
  'work-detail': isWorkDetailSchema,
  'comment-reply-list': isReplySchema,
  'comment-list': isCommentSchema,
  'media-resource': isMediaSchema
})

export function classifyPath(pathname) {
  return NETWORK_ROUTE_DEFINITIONS.find((definition) => definition.pathPattern.test(pathname)) ?? null
}

export function detectSchemaKinds(payload) {
  return Object.entries(SCHEMA_CLASSIFIERS)
    .filter(([, classifier]) => classifier(payload))
    .map(([endpointKind]) => endpointKind)
}

export function classifyStructuredResponse(pathname, payload) {
  const pathDefinition = classifyPath(pathname)
  const schemaKinds = detectSchemaKinds(payload)
  if (pathDefinition && schemaKinds.includes(pathDefinition.endpointKind)) {
    return { disposition: 'accepted', ...pathDefinition, schemaKinds }
  }
  if (pathDefinition) {
    return { disposition: 'schema-changed', ...pathDefinition, schemaKinds }
  }
  if (schemaKinds.length > 0) {
    const endpointKind = schemaKinds[0]
    const knownDefinition = NETWORK_ROUTE_DEFINITIONS.find((definition) => definition.endpointKind === endpointKind)
    return {
      disposition: 'unrecognized-path',
      routeId: knownDefinition?.routeId ?? null,
      endpointKind,
      pathPattern: null,
      schemaKinds
    }
  }
  return { disposition: 'ignored', routeId: null, endpointKind: null, pathPattern: null, schemaKinds: [] }
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON rejects non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry === undefined ? null : entry))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]))
  }
  throw new Error(`canonical JSON rejects ${typeof value}`)
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

async function sha256Hex(value, cryptoImplementation = globalThis.crypto) {
  if (!cryptoImplementation?.subtle) throw new Error('Web Crypto SHA-256 is unavailable')
  const bytes = new TextEncoder().encode(value)
  const digest = await cryptoImplementation.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function schemaType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

export function canonicalSchemaPaths(value) {
  const paths = new Set()
  const visit = (current, path) => {
    paths.add(`${path}:${schemaType(current)}`)
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, `${path}[]`))
    } else if (isRecord(current)) {
      Object.entries(current).sort(([left], [right]) => left.localeCompare(right))
        .forEach(([key, entry]) => visit(entry, `${path}.${key}`))
    }
  }
  visit(value, '$')
  return [...paths].sort()
}

export async function schemaFingerprint(payload, cryptoImplementation = globalThis.crypto) {
  return await sha256Hex(canonicalJson(canonicalSchemaPaths(payload)), cryptoImplementation)
}

export async function projectionSha256(projection, cryptoImplementation = globalThis.crypto) {
  return await sha256Hex(canonicalJson(projection), cryptoImplementation)
}

function paginationProjection(payload) {
  const root = platformPayload(payload)
  const cursorFields = ['cursor', 'max_cursor', 'offset', 'min_time', 'max_time']
  const cursorField = cursorFields.find((name) => root?.[name] !== null && root?.[name] !== undefined) ?? null
  const cursor = cursorField === null ? null : root[cursorField]
  const hasMoreValue = root?.has_more ?? root?.hasMore
  const total = root?.total ?? root?.total_count ?? null
  return {
    cursorField,
    cursorOut: cursor === null || cursor === undefined ? null : String(cursor),
    paginationKnown: hasMoreValue === true || hasMoreValue === false || hasMoreValue === 0 || hasMoreValue === 1,
    hasMore: hasMoreValue === true || hasMoreValue === 1,
    reportedTotal: Number.isSafeInteger(total) && total >= 0 ? total : null
  }
}

function publicStatistics(value) {
  const statistics = isRecord(value?.statistics) ? value.statistics : {}
  const numberOrNull = (entry) => Number.isSafeInteger(entry) && entry >= 0 ? entry : null
  return {
    likeCount: numberOrNull(statistics.digg_count),
    commentCount: numberOrNull(statistics.comment_count),
    collectCount: numberOrNull(statistics.collect_count),
    shareCount: numberOrNull(statistics.share_count),
    playCount: numberOrNull(statistics.play_count)
  }
}

function authorProjection(author) {
  return {
    authorId: nativeId(author, ['uid', 'sec_uid']),
    authorSecId: nativeId(author, ['sec_uid']),
    nickname: typeof author?.nickname === 'string' ? author.nickname.slice(0, 200) : ''
  }
}

function projectFollowing(payload) {
  const items = firstArray(payload, ['user_list', 'users', 'followings']) ?? []
  return {
    endpointKind: 'following-list',
    ...paginationProjection(payload),
    returnedIds: items.map((entry) => nativeId(entry, ['uid', 'sec_uid'])),
    items: items.map((entry) => ({
      creatorId: nativeId(entry, ['uid', 'sec_uid']),
      secCreatorId: nativeId(entry, ['sec_uid']),
      nickname: typeof entry.nickname === 'string' ? entry.nickname.slice(0, 200) : '',
      isFollowing: entry.is_following === true || entry.is_following === 1
        || entry.follow_status === 1 || entry.follow_status === 2
    }))
  }
}

function workType(value) {
  return value?.aweme_type === 68 || Array.isArray(value?.images) ? 'image' : 'video'
}

function projectedWork(entry, sourcePrefix) {
  const authorIdField = nativeId(entry.author, ['uid']) ? 'uid' : 'sec_uid'
  const createdAt = Number(entry?.create_time)
  const publishedAt = Number.isSafeInteger(createdAt) && createdAt > 0
    ? new Date(createdAt * 1_000).toISOString() : null
  const description = typeof entry?.desc === 'string' ? entry.desc.slice(0, 4_000) : ''
  const title = typeof entry?.title === 'string' && entry.title.trim()
    ? entry.title.slice(0, 300) : description.split(/\r?\n/, 1)[0].slice(0, 300)
  const rawDuration = entry?.video?.duration ?? entry?.duration
  return {
    workId: nativeId(entry, ['aweme_id']),
    workIdKind: 'native-aweme-id',
    workIdSourcePath: `${sourcePrefix}.aweme_id`,
    ...authorProjection(entry.author),
    authorIdSourcePath: `${sourcePrefix}.author.${authorIdField}`,
    workType: workType(entry),
    title,
    description,
    publishedAt,
    durationMs: Number.isSafeInteger(rawDuration) && rawDuration >= 0 ? rawDuration : null,
    statistics: publicStatistics(entry)
  }
}

function projectCreatorWorks(payload) {
  const items = firstArray(payload, ['aweme_list']) ?? []
  return {
    endpointKind: 'creator-work-list',
    ...paginationProjection(payload),
    returnedIds: items.map((entry) => nativeId(entry, ['aweme_id'])),
    items: items.map((entry) => projectedWork(entry, 'aweme_list[]'))
  }
}

function projectWorkDetail(payload) {
  const detail = firstRecord(payload, ['aweme_detail'])
  return {
    endpointKind: 'work-detail',
    returnedIds: detail ? [nativeId(detail, ['aweme_id'])] : [],
    item: detail ? projectedWork(detail, 'aweme_detail') : null
  }
}

function projectedComment(entry, endpointKind) {
  const relationshipId = (value) => value === undefined || value === null || value === '' || value === '0' || value === 0
    ? null
    : nativeId({ value }, ['value'])
  const publishedAt = Number.isSafeInteger(Number(entry?.create_time)) && Number(entry.create_time) >= 0
    ? new Date(Number(entry.create_time) * 1_000).toISOString()
    : null
  const replyToId = relationshipId(entry.reply_to_comment_id)
  const parentId = relationshipId(entry.parent_comment_id)
  const explicitRootId = relationshipId(entry.root_comment_id)
  const replyId = relationshipId(entry.reply_id)
  return {
    commentId: nativeId(entry, ['cid']),
    commentIdKind: 'native-cid',
    commentIdSourcePath: 'comments[].cid',
    workId: nativeId(entry, ['aweme_id']),
    workIdSourcePath: 'comments[].aweme_id',
    parentCommentId: replyToId ?? parentId,
    rootCommentId: explicitRootId ?? replyId,
    parentCommentIdSourceField: replyToId ? 'reply_to_comment_id' : parentId ? 'parent_comment_id' : null,
    rootCommentIdSourceField: explicitRootId ? 'root_comment_id' : replyId ? 'reply_id' : null,
    relationshipFieldConflict: Boolean((replyToId && parentId && replyToId !== parentId)
      || (explicitRootId && replyId && explicitRootId !== replyId)),
    endpointKind,
    publicAuthorId: nativeId(entry?.user, ['uid', 'sec_uid']),
    publicAuthorName: typeof entry?.user?.nickname === 'string' ? entry.user.nickname.slice(0, 200) : '',
    body: typeof entry?.text === 'string' ? entry.text.slice(0, 4_000) : '',
    likeCount: Number.isSafeInteger(entry?.digg_count) && entry.digg_count >= 0 ? entry.digg_count : null,
    replyCount: Number.isSafeInteger(entry?.reply_comment_total) && entry.reply_comment_total >= 0
      ? entry.reply_comment_total
      : null,
    publishedAt
  }
}

function projectComments(payload, endpointKind) {
  const items = firstArray(payload, ['comments']) ?? []
  return {
    endpointKind,
    ...paginationProjection(payload),
    returnedIds: items.map((entry) => nativeId(entry, ['cid'])),
    items: items.map((entry) => projectedComment(entry, endpointKind))
  }
}

async function projectMedia(payload, cryptoImplementation) {
  const items = firstArray(payload, ['resource_list', 'media_list']) ?? []
  return {
    endpointKind: 'media-resource',
    returnedIds: items.map((entry) => nativeId(entry, ['aweme_id', 'item_id'])),
    items: await Promise.all(items.map(async (entry) => ({
      workId: nativeId(entry, ['aweme_id', 'item_id']),
      workIdKind: 'native-aweme-id',
      resources: await Promise.all(entry.resources.map(async (resource) => ({
        resourceKind: resource.kind,
        urlSha256: await Promise.all(resource.url_list.map((url) => sha256Hex(url, cryptoImplementation)))
      })))
    })))
  }
}

export async function projectStructuredResponse(endpointKind, payload, cryptoImplementation = globalThis.crypto) {
  if (endpointKind === 'following-list') return projectFollowing(payload)
  if (endpointKind === 'creator-work-list') return projectCreatorWorks(payload)
  if (endpointKind === 'work-detail') return projectWorkDetail(payload)
  if (endpointKind === 'comment-list') return projectComments(payload, endpointKind)
  if (endpointKind === 'comment-reply-list') return projectComments(payload, endpointKind)
  if (endpointKind === 'media-resource') return await projectMedia(payload, cryptoImplementation)
  throw new Error(`Unsupported endpoint kind: ${endpointKind}`)
}

function allowedHost(hostname) {
  const normalized = hostname.toLowerCase()
  return normalized === 'douyin.com' || normalized.endsWith('.douyin.com')
}

function candidatePath(pathname) {
  return pathname.startsWith('/aweme/')
}

function normalizedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]))
}

function jsonContentType(response) {
  const headers = normalizedHeaders(response.headers)
  const contentType = headers['content-type'] ?? response.mimeType ?? ''
  return /(?:application|text)\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)
}

function declaredContentLength(response) {
  const value = normalizedHeaders(response.headers)['content-length']
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function decodeResponseBody(result) {
  if (!result?.base64Encoded) return String(result?.body ?? '')
  const binary = atob(String(result.body ?? ''))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function safeRequestParameters(url, endpointKind) {
  const allowed = SAFE_PARAMETERS[endpointKind] ?? new Set()
  return [...url.searchParams.entries()]
    .filter(([name]) => allowed.has(name))
    .slice(0, 24)
    .map(([name, value]) => ({ name, value: value.slice(0, 512) }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function issue(code, input = {}) {
  return {
    contract: 'network-observer-issue/v1',
    code,
    routeId: input.routeId ?? null,
    endpointKind: input.endpointKind ?? null,
    schemaFingerprint: input.schemaFingerprint ?? null,
    pathSha256: input.pathSha256 ?? null,
    occurredAt: input.occurredAt,
    ...(input.discoveryPathname ? { discoveryPathname: input.discoveryPathname } : {}),
    ...(input.discoverySchemaOutline ? { discoverySchemaOutline: input.discoverySchemaOutline } : {})
  }
}

function discoverySchemaOutline(payload) {
  const root = platformPayload(payload)
  const comments = Array.isArray(root?.comments) ? root.comments : null
  const first = comments?.find((entry) => isRecord(entry)) ?? null
  const user = isRecord(first?.user) ? first.user : null
  const fieldType = (value) => value === undefined ? 'missing' : schemaType(value)
  const relationshipClass = (value, cid) => {
    if (value === undefined || value === null) return 'missing'
    if (value === '' || value === '0' || value === 0) return 'empty-or-zero'
    if (typeof value !== 'string') return 'other-type'
    return typeof cid === 'string' && value === cid ? 'self-cid' : 'other-id'
  }
  const relationshipClasses = (key) => [...new Set((comments ?? []).map((entry) => relationshipClass(entry?.[key], entry?.cid)))].sort()
  const statusCode = payload?.status_code ?? root?.status_code
  return {
    wrapper: isRecord(payload?.data) ? 'data' : 'root',
    statusCodeClass: statusCode === 0 ? 'zero' : typeof statusCode === 'number' ? 'nonzero' : 'missing-or-other',
    comments: fieldType(root?.comments),
    commentList: fieldType(root?.comment_list),
    commentListCamel: fieldType(root?.commentList),
    commentCountClass: comments === null ? 'not-array' : comments.length === 0 ? 'empty' : 'nonempty',
    cursor: fieldType(root?.cursor),
    hasMore: fieldType(root?.has_more),
    total: fieldType(root?.total),
    firstComment: {
      cid: fieldType(first?.cid),
      awemeId: fieldType(first?.aweme_id),
      text: fieldType(first?.text),
      user: fieldType(first?.user),
      userUid: fieldType(user?.uid),
      userSecUid: fieldType(user?.sec_uid),
      replyId: fieldType(first?.reply_id),
      rootCommentId: fieldType(first?.root_comment_id)
    },
    relationshipClasses: {
      replyId: relationshipClasses('reply_id'),
      replyToCommentId: relationshipClasses('reply_to_comment_id'),
      rootCommentId: relationshipClasses('root_comment_id'),
      parentCommentId: relationshipClasses('parent_comment_id')
    }
  }
}

function discoveryPaginationOutline(payload) {
  const root = platformPayload(payload)
  const fieldType = (value) => value === undefined ? 'missing' : schemaType(value)
  return {
    cursor: fieldType(root?.cursor),
    maxCursor: fieldType(root?.max_cursor),
    minCursor: fieldType(root?.min_cursor),
    nextCursor: fieldType(root?.next_cursor),
    offset: fieldType(root?.offset),
    minTime: fieldType(root?.min_time),
    maxTime: fieldType(root?.max_time),
    hasMore: fieldType(root?.has_more),
    total: fieldType(root?.total),
    totalCount: fieldType(root?.total_count)
  }
}

function safeDiscoveryPathname(url) {
  const pathname = url?.pathname
  return typeof pathname === 'string'
    && /^\/aweme\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{1,503}$/.test(pathname)
    && pathname.length <= 512
    ? pathname
    : null
}

export class NetworkObserver {
  constructor({
    debuggerApi,
    maxBufferedResponses = DEFAULT_MAX_BUFFERED_RESPONSES,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    now = () => new Date(),
    cryptoImplementation = globalThis.crypto,
    includeSafeDiscoveryPathnames = false
  }) {
    if (!debuggerApi?.attach || !debuggerApi?.sendCommand || !debuggerApi?.detach || !debuggerApi?.onEvent) {
      throw new Error('A chrome.debugger-compatible API is required')
    }
    if (!Number.isInteger(maxBufferedResponses) || maxBufferedResponses < 1 || maxBufferedResponses > 256) {
      throw new Error('maxBufferedResponses must be an integer from 1 to 256')
    }
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 16 * 1024 * 1024) {
      throw new Error('maxBodyBytes must be an integer from 1 to 16777216')
    }
    this.debuggerApi = debuggerApi
    this.maxBufferedResponses = maxBufferedResponses
    this.maxBodyBytes = maxBodyBytes
    this.now = now
    this.cryptoImplementation = cryptoImplementation
    if (typeof includeSafeDiscoveryPathnames !== 'boolean') throw new Error('includeSafeDiscoveryPathnames must be boolean')
    this.includeSafeDiscoveryPathnames = includeSafeDiscoveryPathnames
    this.tabId = null
    this.attached = false
    this.requestMetadata = new Map()
    this.responseMetadata = new Map()
    this.observations = []
    this.issues = []
    this.tasks = new Set()
    this.bufferLimitReported = false
    this.listener = (source, method, params) => {
      if (source?.tabId !== this.tabId) return
      const task = this.handleEvent(method, params).catch(() => {
        // CDP events are observational. A late response-body failure must not
        // terminate the extension worker or disappear as an unhandled promise.
        this.recordIssue(issue('OBSERVER_EVENT_FAILED', { occurredAt: this.now().toISOString() }))
      })
      this.tasks.add(task)
      void task.then(() => this.tasks.delete(task))
    }
  }

  async attach(tabId) {
    if (this.attached) throw new Error('Network Observer is already attached')
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('A positive tabId is required')
    const target = { tabId }
    await this.debuggerApi.attach(target, DEBUGGER_PROTOCOL_VERSION)
    try {
      await this.debuggerApi.sendCommand(target, 'Network.enable', {
        maxTotalBufferSize: this.maxBodyBytes * this.maxBufferedResponses,
        maxResourceBufferSize: this.maxBodyBytes,
        maxPostDataSize: 0
      })
      this.tabId = tabId
      this.debuggerApi.onEvent.addListener(this.listener)
      this.attached = true
    } catch (error) {
      await this.debuggerApi.detach(target).catch(() => {})
      this.tabId = null
      throw error
    }
  }

  reportBufferLimit() {
    if (this.bufferLimitReported) return
    this.bufferLimitReported = true
    const limitIssue = issue('BUFFER_LIMIT_REACHED', { occurredAt: this.now().toISOString() })
    if (this.observations.length + this.issues.length >= this.maxBufferedResponses) {
      if (this.issues.length > 0) this.issues[this.issues.length - 1] = limitIssue
      else {
        this.observations.pop()
        this.issues.push(limitIssue)
      }
      return
    }
    this.issues.push(limitIssue)
  }

  recordIssue(value) {
    if (this.observations.length + this.issues.length >= this.maxBufferedResponses) {
      this.reportBufferLimit()
      return
    }
    this.issues.push(value)
  }

  async responseTooLargeIssue(metadata) {
    const pathDefinition = metadata.pathDefinition ?? classifyPath(metadata.url?.pathname ?? '')
    const discoveryPathname = this.includeSafeDiscoveryPathnames && !pathDefinition
      ? safeDiscoveryPathname(metadata.url)
      : null
    return issue('RESPONSE_TOO_LARGE', {
      routeId: pathDefinition?.routeId,
      endpointKind: pathDefinition?.endpointKind,
      ...(discoveryPathname ? {
        discoveryPathname,
        pathSha256: await sha256Hex(discoveryPathname, this.cryptoImplementation)
      } : {}),
      occurredAt: this.now().toISOString()
    })
  }

  async handleEvent(method, params = {}) {
    if (!this.attached) return
    if (method === 'Network.requestWillBeSent') {
      let url
      try {
        url = new URL(String(params.request?.url ?? ''))
      } catch {
        return
      }
      if (params.request?.method !== 'GET' || url.protocol !== 'https:' || !allowedHost(url.hostname) || !candidatePath(url.pathname)) return
      if (this.requestMetadata.size >= this.maxBufferedResponses) {
        this.reportBufferLimit()
        return
      }
      this.requestMetadata.set(params.requestId, { url })
      return
    }

    if (method === 'Network.responseReceived') {
      const request = this.requestMetadata.get(params.requestId)
      if (!request || !['Fetch', 'XHR'].includes(params.type)) return
      const response = params.response ?? {}
      if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
        this.requestMetadata.delete(params.requestId)
        return
      }
      const pathDefinition = classifyPath(request.url.pathname)
      if (!jsonContentType(response)) {
        this.recordIssue(issue('INVALID_CONTENT_TYPE', {
          routeId: pathDefinition?.routeId,
          endpointKind: pathDefinition?.endpointKind,
          occurredAt: this.now().toISOString()
        }))
        this.requestMetadata.delete(params.requestId)
        return
      }
      const contentLength = declaredContentLength(response)
      if (contentLength !== null && contentLength > this.maxBodyBytes) {
        this.recordIssue(await this.responseTooLargeIssue({ ...request, pathDefinition }))
        this.requestMetadata.delete(params.requestId)
        return
      }
      if (this.responseMetadata.size >= this.maxBufferedResponses) {
        this.reportBufferLimit()
        this.requestMetadata.delete(params.requestId)
        return
      }
      this.responseMetadata.set(params.requestId, { ...request, pathDefinition })
      return
    }

    if (method === 'Network.loadingFailed') {
      this.requestMetadata.delete(params.requestId)
      this.responseMetadata.delete(params.requestId)
      return
    }

    if (method !== 'Network.loadingFinished') return
    const metadata = this.responseMetadata.get(params.requestId)
    if (!metadata) return
    this.responseMetadata.delete(params.requestId)
    this.requestMetadata.delete(params.requestId)
    if (Number(params.encodedDataLength) > this.maxBodyBytes) {
      this.recordIssue(await this.responseTooLargeIssue(metadata))
      return
    }
    await this.consumeBody(params.requestId, metadata)
  }

  async consumeBody(requestId, metadata) {
    let rawBody = null
    try {
      let responseBody
      try {
        responseBody = await this.debuggerApi.sendCommand({ tabId: this.tabId }, 'Network.getResponseBody', { requestId })
      } catch (error) {
        const evicted = Number(error?.code) === -32000
          && /evicted from inspector cache/i.test(String(error?.message ?? ''))
        this.recordIssue(issue(evicted ? 'RESPONSE_BODY_EVICTED' : 'RESPONSE_BODY_UNAVAILABLE', {
          routeId: metadata.pathDefinition?.routeId,
          endpointKind: metadata.pathDefinition?.endpointKind,
          occurredAt: this.now().toISOString()
        }))
        return
      }
      rawBody = decodeResponseBody(responseBody)
      if (new TextEncoder().encode(rawBody).byteLength > this.maxBodyBytes) {
        this.recordIssue(await this.responseTooLargeIssue(metadata))
        return
      }
      let payload
      try {
        payload = JSON.parse(rawBody)
      } catch {
        this.recordIssue(issue('MALFORMED_JSON', {
          routeId: metadata.pathDefinition?.routeId,
          endpointKind: metadata.pathDefinition?.endpointKind,
          occurredAt: this.now().toISOString()
        }))
        return
      }

      const classification = classifyStructuredResponse(metadata.url.pathname, payload)
      if (classification.disposition === 'ignored') return
      const fingerprint = await schemaFingerprint(payload, this.cryptoImplementation)
      if (classification.disposition === 'schema-changed') {
        this.recordIssue(issue('SCHEMA_CHANGED', {
          routeId: classification.routeId,
          endpointKind: classification.endpointKind,
          schemaFingerprint: fingerprint,
          ...(this.includeSafeDiscoveryPathnames && classification.endpointKind === 'comment-list'
            ? { discoverySchemaOutline: discoverySchemaOutline(payload) }
            : {}),
          occurredAt: this.now().toISOString()
        }))
        return
      }
      if (classification.disposition === 'unrecognized-path') {
        const discoveryPathname = this.includeSafeDiscoveryPathnames
          && metadata.url.pathname.startsWith('/')
          && !metadata.url.pathname.includes('?')
          && !metadata.url.pathname.includes('#')
          && metadata.url.pathname.length <= 512
          ? metadata.url.pathname
          : null
        this.recordIssue(issue('UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA', {
          routeId: classification.routeId,
          endpointKind: classification.endpointKind,
          schemaFingerprint: fingerprint,
          pathSha256: await sha256Hex(metadata.url.pathname, this.cryptoImplementation),
          discoveryPathname,
          occurredAt: this.now().toISOString()
        }))
        return
      }

      const projection = await projectStructuredResponse(classification.endpointKind, payload, this.cryptoImplementation)
      const projectionHash = await projectionSha256(projection, this.cryptoImplementation)
      if (this.observations.length + this.issues.length >= this.maxBufferedResponses) {
        this.reportBufferLimit()
        return
      }
      this.observations.push({
        contract: 'network-observation/v1',
        routeId: classification.routeId,
        endpointKind: classification.endpointKind,
        requestParameters: safeRequestParameters(metadata.url, classification.endpointKind),
        schemaFingerprint: fingerprint,
        responseProjectionSha256: projectionHash,
        projection,
        ...(this.includeSafeDiscoveryPathnames && ['following-list', 'creator-work-list', 'comment-list', 'comment-reply-list'].includes(classification.endpointKind)
          ? { discoveryPaginationOutline: discoveryPaginationOutline(payload) }
          : {}),
        observedAt: this.now().toISOString()
      })
    } finally {
      rawBody = null
    }
  }

  async stop() {
    if (!this.attached || this.tabId === null) {
      return { observations: [], issues: [] }
    }
    this.debuggerApi.onEvent.removeListener(this.listener)
    await Promise.allSettled([...this.tasks])
    const target = { tabId: this.tabId }
    try {
      await this.debuggerApi.detach(target)
    } finally {
      const snapshot = {
        observations: structuredClone(this.observations),
        issues: structuredClone(this.issues)
      }
      this.requestMetadata.clear()
      this.responseMetadata.clear()
      this.observations.length = 0
      this.issues.length = 0
      this.tasks.clear()
      this.tabId = null
      this.attached = false
      this.bufferLimitReported = false
      return snapshot
    }
  }

  async snapshot() {
    if (!this.attached || this.tabId === null) throw new Error('Network Observer is not attached')
    await Promise.allSettled([...this.tasks])
    return {
      observations: structuredClone(this.observations),
      issues: structuredClone(this.issues)
    }
  }

  async pauseCapture() {
    if (!this.attached || this.tabId === null) throw new Error('Network Observer is not attached')
    this.debuggerApi.onEvent.removeListener(this.listener)
    await Promise.allSettled([...this.tasks])
    this.requestMetadata.clear()
    this.responseMetadata.clear()
  }
}
