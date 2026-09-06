export const PHASE_B_CONTRACT = 'signaldesk-phase-b-run/v1'
export const DISCOVERY_CONTRACT = 'signaldesk-phase-b-discovery/v1'
export const FOLLOWING_PROOF_CONTRACT = 'douyin-following-source-proof/v1'
export const CREATOR_WORKS_PROOF_CONTRACT = 'douyin-creator-works-source-proof/v1'
export const SAMPLE_REPORT_CONTRACT = 'signaldesk-phase-b-sample-report/v1'
export const MIN_SAMPLE_COUNT = 20
export const MAX_SAMPLE_COUNT = 30
export const DEFAULT_SAMPLE_COUNT = 24
export const MAX_DISCOVERY_CREATORS = 60
export const MAX_CANDIDATE_WORKS_PER_CREATOR = 8
export const MAX_SELECTED_WORKS_PER_CREATOR = 3
export const MAX_API_PAGES = 2
export const PAGE_SIZE = 20
export const MAX_COMMENTS_PER_SAMPLE = MAX_API_PAGES * PAGE_SIZE

const COMMENT_ENDPOINT = '/aweme/v1/web/comment/list/'
const SENSITIVE_KEY = /(?:authorization|bearer|cookie|password|secret|apikey|accesstoken|refreshtoken|x[-_]?bogus|signature(?:value|input|header)?|session(?:id|token|key)|device(?:id|fingerprint)|browserprofile)/i

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._-]{1,240}$/
const SEED_PATTERN = /^[a-f0-9]{64}$/
const FOLLOWING_RELATIONSHIP_PATTERN = /^(?:已关注|相互关注)$/

export function validateTargetSampleCount(value) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < MIN_SAMPLE_COUNT || count > MAX_SAMPLE_COUNT) {
    throw new Error(`阶段 B 样本数必须是 ${MIN_SAMPLE_COUNT}～${MAX_SAMPLE_COUNT} 的整数`)
  }
  return count
}

export function createSamplingSeed() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateSamplingSeed(value) {
  const seed = String(value || '').toLowerCase()
  if (!SEED_PATTERN.test(seed)) throw new Error('samplingSeed 必须是 256 位十六进制随机值')
  return seed
}

function hash32(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function deterministicShuffle(values, samplingSeed, domain = 'default') {
  const seed = validateSamplingSeed(samplingSeed)
  const result = [...values]
  const random = mulberry32(hash32(`${seed}:${domain}`))
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

export function canonicalSampleUrl(value) {
  const url = new URL(String(value))
  if (url.origin !== 'https://www.douyin.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('样本必须是无查询参数的 www.douyin.com 公开作品 URL')
  }
  const match = url.pathname.replace(/\/+$/, '').match(/^\/(video|note)\/([A-Za-z0-9._-]{1,240})$/)
  if (!match) throw new Error('样本 URL 必须匹配 /video/<id> 或 /note/<id>')
  return { url: `${url.origin}/${match[1]}/${match[2]}`, workId: match[2], workType: match[1] === 'note' ? 'image' : 'video' }
}

export function validateSampleUrls(values) {
  if (!Array.isArray(values)) throw new Error('样本清单必须是数组')
  const samples = []
  const seen = new Set()
  for (const value of values) {
    const sample = canonicalSampleUrl(value)
    if (seen.has(sample.workId)) continue
    seen.add(sample.workId)
    samples.push(sample)
  }
  if (samples.length < MIN_SAMPLE_COUNT || samples.length > MAX_SAMPLE_COUNT) {
    throw new Error(`去重后必须提供 ${MIN_SAMPLE_COUNT}～${MAX_SAMPLE_COUNT} 个公开作品 URL；当前为 ${samples.length} 个`)
  }
  return samples.map((sample, index) => ({ ...sample, index: index + 1 }))
}

function canonicalProfileUrl(value, creatorId) {
  const url = new URL(String(value || ''))
  if (url.origin !== 'https://www.douyin.com' || url.search || url.hash || url.username || url.password) {
    throw new Error(`博主 ${creatorId} 的主页 URL 不符合隔离规则`)
  }
  const match = url.pathname.replace(/\/+$/, '').match(/^\/user\/([^/]+)$/)
  let routeCreatorId = null
  try {
    routeCreatorId = match ? decodeURIComponent(match[1]) : null
  } catch {
    throw new Error(`博主 ${creatorId} 的主页路径编码无效`)
  }
  if (!match || routeCreatorId !== creatorId || creatorId === 'self') throw new Error(`博主 ${creatorId} 的主页与 ID 不一致`)
  return `https://www.douyin.com/user/${encodeURIComponent(creatorId)}`
}

export function validateFollowingSnapshot(value) {
  if (!value || value.contract !== FOLLOWING_PROOF_CONTRACT) throw new Error('关注来源证明合同无效')
  if (value.relationship !== 'following' || value.pageKind !== 'owner-following-list' || value.activeTab !== 'following') {
    throw new Error('当前关系界面不是本人“关注”列表')
  }
  if (value.routeOrigin !== 'https://www.douyin.com' || value.routePath !== '/user/self' || value.routeShowTab !== 'follow') {
    throw new Error('关注来源证明不是本人关注路由')
  }
  if (value.followingTabCount !== 1 || value.fansTabCount !== 1 || value.containerIdentity !== 'data-e2e:user-fans-container') {
    throw new Error('关注弹窗的页签或成员容器不唯一')
  }
  if (value.extractionScope !== 'verified-following-list-container' || !Array.isArray(value.creators)) {
    throw new Error('关注来源证明缺少受验证的抽取范围')
  }
  const entryPoint = value.entryPoint
  const openedUniquely = entryPoint?.mode === 'unique-following-count' && entryPoint.candidateCount === 1 && entryPoint.triggered === true
  const reusedVerified = entryPoint?.mode === 'preopened-verified-dialog' && entryPoint.candidateCount === 0 && entryPoint.triggered === false
  if (!openedUniquely && !reusedVerified) throw new Error('本人关注关系入口未经唯一性验证')
  if (value.creators.length < 1 || value.creators.length > MAX_DISCOVERY_CREATORS) {
    throw new Error(`关注候选必须包含 1～${MAX_DISCOVERY_CREATORS} 位博主`)
  }
  const creators = []
  const seen = new Set()
  for (const raw of value.creators) {
    const creatorId = String(raw?.creatorId || '')
    if (!OPAQUE_ID_PATTERN.test(creatorId) || creatorId === 'self' || seen.has(creatorId)) throw new Error('关注候选 creatorId 缺失、重复或格式无效')
    if (!FOLLOWING_RELATIONSHIP_PATTERN.test(String(raw.relationshipMarker || ''))) throw new Error(`博主 ${creatorId} 缺少“已关注/相互关注”关系标记`)
    if (raw.sourceRegion !== 'verified-following-dialog') throw new Error(`博主 ${creatorId} 来自粉丝、推荐、侧栏或未知区域`)
    seen.add(creatorId)
    creators.push({
      creatorId,
      profileUrl: canonicalProfileUrl(raw.profileUrl, creatorId),
      relationshipMarker: raw.relationshipMarker,
      sourceRegion: 'verified-following-dialog'
    })
  }
  return {
    contract: FOLLOWING_PROOF_CONTRACT,
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
    entryPoint: {
      mode: entryPoint.mode,
      candidateCount: entryPoint.candidateCount,
      triggered: entryPoint.triggered
    },
    scrollRootKind: ['element', 'document', 'not-needed'].includes(value.scrollRootKind) ? value.scrollRootKind : 'not-needed',
    exhausted: Boolean(value.exhausted),
    creators,
    creatorIds: creators.map((creator) => creator.creatorId),
    collectedAt: String(value.collectedAt || '')
  }
}

export function validateCreatorWorksSnapshot(value, expectedCreatorId = null) {
  if (!value || value.contract !== CREATOR_WORKS_PROOF_CONTRACT) throw new Error('博主作品来源证明合同无效')
  const creatorId = String(value.creatorId || '')
  if (!OPAQUE_ID_PATTERN.test(creatorId) || creatorId === 'self' || (expectedCreatorId && creatorId !== expectedCreatorId)) {
    throw new Error('博主作品来源证明 creatorId 无效')
  }
  if (value.routeOrigin !== 'https://www.douyin.com' || value.routeCreatorId !== creatorId) throw new Error(`博主 ${creatorId} 的页面路由不一致`)
  if (value.extractionScope !== 'verified-creator-works-container' || !Array.isArray(value.works)) throw new Error(`博主 ${creatorId} 的作品抽取范围无效`)
  const containerIdentity = String(value.containerIdentity || '')
  if (!/^(?:data-e2e|role|aria-label|inferred):[^\r\n]{1,160}$/.test(containerIdentity)) throw new Error(`博主 ${creatorId} 的作品容器证明无效`)
  if (value.works.length > MAX_CANDIDATE_WORKS_PER_CREATOR) throw new Error(`博主 ${creatorId} 的候选作品超过上限`)
  const profileUrl = canonicalProfileUrl(value.profileUrl, creatorId)
  const works = []
  const seen = new Set()
  for (const raw of value.works) {
    if (raw?.creatorId !== creatorId || raw?.sourceRegion !== 'verified-creator-works-container') {
      throw new Error(`作品 ${raw?.workId || 'unknown'} 与已验证博主或主页作品区不绑定`)
    }
    const sample = canonicalSampleUrl(raw.url)
    if (sample.workId !== raw.workId || sample.workType !== raw.workType || seen.has(sample.workId)) throw new Error(`博主 ${creatorId} 的作品记录重复或不一致`)
    seen.add(sample.workId)
    works.push({ ...sample, creatorId, profileUrl, sourceRegion: 'verified-creator-works-container' })
  }
  return {
    contract: CREATOR_WORKS_PROOF_CONTRACT,
    creatorId,
    profileUrl,
    routeOrigin: 'https://www.douyin.com',
    routeCreatorId: creatorId,
    extractionScope: 'verified-creator-works-container',
    containerIdentity,
    works,
    exhausted: Boolean(value.exhausted),
    collectedAt: String(value.collectedAt || '')
  }
}

export function selectFollowingSamples(followingSnapshot, creatorWorkSnapshots, targetCount, samplingSeed) {
  const following = validateFollowingSnapshot(followingSnapshot)
  const count = validateTargetSampleCount(targetCount)
  const seed = validateSamplingSeed(samplingSeed)
  if (!Array.isArray(creatorWorkSnapshots)) throw new Error('博主作品候选必须是数组')
  const allowedCreators = new Set(following.creatorIds)
  const byCreator = new Map()
  const globalWorkIds = new Set()
  for (const raw of creatorWorkSnapshots) {
    const snapshot = validateCreatorWorksSnapshot(raw)
    if (!allowedCreators.has(snapshot.creatorId) || byCreator.has(snapshot.creatorId)) throw new Error(`博主 ${snapshot.creatorId} 不属于已验证关注候选或重复`)
    const uniqueWorks = []
    for (const work of snapshot.works) {
      if (globalWorkIds.has(work.workId)) continue
      globalWorkIds.add(work.workId)
      uniqueWorks.push(work)
    }
    byCreator.set(snapshot.creatorId, deterministicShuffle(uniqueWorks.sort((left, right) => left.workId.localeCompare(right.workId)), seed, `works:${snapshot.creatorId}`))
  }
  const creatorOrder = deterministicShuffle(
    [...byCreator.keys()].sort((left, right) => left.localeCompare(right)),
    seed,
    'creators'
  )
  const chosen = []
  const chosenIds = new Set()
  const perCreator = new Map()
  const choose = (work) => {
    if (!work || chosenIds.has(work.workId) || (perCreator.get(work.creatorId) || 0) >= MAX_SELECTED_WORKS_PER_CREATOR) return false
    chosen.push(work)
    chosenIds.add(work.workId)
    perCreator.set(work.creatorId, (perCreator.get(work.creatorId) || 0) + 1)
    return true
  }

  const allCandidates = deterministicShuffle(
    creatorOrder.flatMap((creatorId) => byCreator.get(creatorId) || []),
    seed,
    'type-coverage'
  )
  const availableTypes = new Set(allCandidates.map((work) => work.workType))
  if (availableTypes.has('video') && availableTypes.has('image')) {
    choose(allCandidates.find((work) => work.workType === 'video'))
    choose(allCandidates.find((work) => work.workType === 'image'))
  }

  for (let round = 0; round < MAX_SELECTED_WORKS_PER_CREATOR && chosen.length < count; round += 1) {
    for (const creatorId of creatorOrder) {
      if (chosen.length >= count) break
      const candidates = (byCreator.get(creatorId) || []).filter((work) => !chosenIds.has(work.workId))
      choose(candidates[0])
    }
  }
  if (chosen.length < count) {
    throw new Error(`INSUFFICIENT_ELIGIBLE_SAMPLES:已验证关注博主的唯一公开作品只能形成 ${chosen.length} 个合格样本，少于目标 ${count}`)
  }
  return chosen.slice(0, count).map((work, index) => ({
    index: index + 1,
    url: work.url,
    workId: work.workId,
    workType: work.workType,
    creatorId: work.creatorId,
    creatorProfileUrl: work.profileUrl
  }))
}

export function isCommentEndpoint(value) {
  try {
    const url = new URL(value)
    return url.origin === 'https://www.douyin.com' && `${url.pathname.replace(/\/+$/, '')}/` === COMMENT_ENDPOINT
  } catch {
    return false
  }
}

export function safeObservedEndpoint(value, metadata = {}) {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' || (url.hostname !== 'www.douyin.com' && !url.hostname.endsWith('.douyin.com'))) return null
    if (!/(?:aweme|comment|feed|list|detail|post)/i.test(url.pathname)) return null
    const path = url.pathname
      .split('/')
      .map((segment) => (/^\d{8,}$/.test(segment) || /^[A-Za-z0-9._-]{32,}$/.test(segment) ? ':id' : segment))
      .join('/')
      .slice(0, 300)
    if (!path.startsWith('/') || path.includes('?') || path.includes('#')) return null
    return {
      host: url.hostname,
      path,
      kind: ['Fetch', 'XHR', 'fetch', 'xmlhttprequest'].includes(metadata.kind) ? metadata.kind : 'other',
      status: Number.isInteger(metadata.status) && metadata.status >= 100 && metadata.status <= 599 ? metadata.status : null
    }
  } catch {
    return null
  }
}

function safeInteger(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function optionalString(value, maximum) {
  if (value === null || value === undefined) return null
  const text = String(value).normalize('NFKC').trim()
  return text && text.length <= maximum ? text : null
}

function requireOpaqueId(value, label) {
  const text = optionalString(value, 240)
  if (!text || !/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${label} 缺失或格式无效`)
  return text
}

function normalizeComment(value) {
  if (!value || typeof value !== 'object') throw new Error('评论记录不是对象')
  const cid = requireOpaqueId(value.cid, 'cid')
  const body = optionalString(value.text, 5_000)
  const user = value.user && typeof value.user === 'object' ? value.user : null
  const publicAuthorName = optionalString(user?.nickname, 200)
  if (!body || !publicAuthorName) throw new Error(`评论 ${cid} 缺少正文或作者`)
  return {
    commentId: cid,
    publicAuthorId: optionalString(user?.uid, 240),
    publicAuthorName,
    body,
    likeCount: safeInteger(value.digg_count),
    publishedAt: safeInteger(value.create_time) > 0 ? new Date(safeInteger(value.create_time) * 1_000).toISOString() : null,
    ipLabel: optionalString(value.ip_label, 80),
    replyCount: safeInteger(value.reply_comment_total)
  }
}

export function normalizeCommentPage(value, { workId, cursorIn, sourceKind, collectedAt }) {
  if (!value || typeof value !== 'object') throw new Error('评论响应不是 JSON 对象')
  const statusCode = Number(value.status_code ?? 0)
  if (!Number.isSafeInteger(statusCode) || statusCode !== 0) throw new Error(`API_STATUS_ERROR:${Number.isFinite(statusCode) ? statusCode : 'invalid'}`)
  if (!Array.isArray(value.comments)) throw new Error('SCHEMA_CHANGED:comments 不是数组')
  const comments = []
  const seen = new Set()
  let duplicateCount = 0
  for (const raw of value.comments.slice(0, PAGE_SIZE * 2)) {
    const comment = normalizeComment(raw)
    if (seen.has(comment.commentId)) {
      duplicateCount += 1
      continue
    }
    seen.add(comment.commentId)
    comments.push(comment)
  }
  const cursorOut = value.cursor === null || value.cursor === undefined ? null : String(value.cursor)
  if (cursorOut !== null && !/^\d+$/.test(cursorOut)) throw new Error('SCHEMA_CHANGED:cursor 格式无效')
  const hasMore = value.has_more === true || value.has_more === 1 || value.has_more === '1'
  const reportedTotal = value.total === null || value.total === undefined ? null : safeInteger(value.total, -1)
  if (reportedTotal === -1) throw new Error('SCHEMA_CHANGED:total 格式无效')
  if (comments.length === 0 && hasMore) throw new Error('API_STATUS_ERROR:空页但 has_more=true')
  const verifiedEmpty = comments.length === 0 && !hasMore && reportedTotal === 0
  return {
    contract: 'phase-b-comment-page/v1',
    sourceKind,
    workId: requireOpaqueId(workId, 'workId'),
    cursorIn: String(cursorIn),
    cursorOut,
    hasMore,
    reportedTotal,
    returnedCount: comments.length,
    duplicateCount,
    completion: verifiedEmpty ? 'verified-empty' : hasMore ? 'partial' : 'complete',
    returnedIds: comments.map((comment) => comment.commentId),
    comments,
    collectedAt
  }
}

export function safeIssue(code, phase, message, extra = {}) {
  const allowedCodes = new Set([
    'BROWSER_OFFLINE', 'PAGE_NAVIGATION_TIMEOUT', 'PAGE_CONTEXT_NOT_READY', 'LOGIN_REQUIRED',
    'CAPTCHA_OR_SECURITY_CHALLENGE', 'RATE_LIMITED', 'HTTP_TRANSIENT', 'API_STATUS_ERROR',
    'SIGNATURE_UNAVAILABLE', 'SIGNATURE_REJECTED', 'SCHEMA_CHANGED', 'WORK_PRIVATE',
    'WORK_DELETED', 'COMMENTS_DISABLED', 'VERIFIED_EMPTY', 'INSUFFICIENT_ELIGIBLE_SAMPLES'
  ])
  const normalizedCode = allowedCodes.has(code) ? code : 'SCHEMA_CHANGED'
  const text = sanitizeDiagnosticText(message)
  return {
    contract: 'phase-b-issue/v1',
    code: normalizedCode,
    phase,
    message: text.slice(0, 1_000),
    httpStatus: Number.isInteger(extra.httpStatus) ? extra.httpStatus : null,
    occurredAt: new Date().toISOString()
  }
}

export function sanitizeDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s]+/gi, (url) => sanitizeDiagnosticUrl(url))
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:set-cookie|cookie|authorization)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/((?:x[-_]?bogus|msToken|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*)[^&\s,;]+/gi, '$1[REDACTED]')
}

export function sanitizeDiagnosticUrl(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.hash = ''
    const allowed = new Set(['aweme_id', 'comment_id', 'count', 'cursor'])
    const query = new URLSearchParams()
    for (const [name, parameterValue] of url.searchParams) {
      query.append(name, allowed.has(name) && /^[A-Za-z0-9._-]{1,240}$/.test(parameterValue) ? parameterValue : '[REDACTED]')
    }
    query.sort()
    url.search = query.toString()
    return url.toString()
  } catch {
    return '[INVALID_URL_REDACTED]'
  }
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalValue(entry)]))
  }
  throw new Error('不支持 canonical JSON 类型')
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export async function sha256Canonical(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function whitelistPageForHash(page) {
  return {
    comments: page.comments,
    cursorIn: page.cursorIn,
    cursorOut: page.cursorOut,
    hasMore: page.hasMore,
    reportedTotal: page.reportedTotal,
    returnedIds: page.returnedIds,
    workId: page.workId
  }
}

export function compareChannels(networkPages, apiPages, domShadow) {
  const uniqueIds = (pages) => [...new Set(pages.flatMap((page) => page.returnedIds || []))]
  const networkIds = uniqueIds(networkPages)
  const apiIds = uniqueIds(apiPages)
  const domIds = [...new Set((domShadow?.comments || []).map((comment) => comment.commentId).filter(Boolean))]
  const overlap = (left, right) => left.filter((value) => new Set(right).has(value)).length
  return {
    networkCount: networkIds.length,
    apiCount: apiIds.length,
    domCount: Number(domShadow?.commentCount || 0),
    networkApiIdOverlap: overlap(networkIds, apiIds),
    apiDomNativeIdOverlap: overlap(apiIds, domIds),
    networkVerifiedEmpty: networkPages.some((page) => page.completion === 'verified-empty'),
    apiVerifiedEmpty: apiPages.some((page) => page.completion === 'verified-empty'),
    domDisplayedEmpty: domShadow?.status === 'empty-unverified'
  }
}

export function assertNoSensitiveShape(value) {
  const seen = new WeakSet()
  const walk = (current, path = '$') => {
    if (typeof current === 'string') {
      if (/\bBearer\s+[A-Za-z0-9._~+\/-]+/i.test(current)) throw new Error(`敏感 Bearer 值位于 ${path}`)
      if (/[?&](?:X-Bogus|msToken|access_token|refresh_token)=[^&\s\[]+/i.test(current)) throw new Error(`敏感 URL 参数位于 ${path}`)
      return
    }
    if (!current || typeof current !== 'object') return
    if (seen.has(current)) throw new Error(`循环对象位于 ${path}`)
    seen.add(current)
    for (const [key, entry] of Object.entries(current)) {
      if (SENSITIVE_KEY.test(key) && !['signatureProvider', 'sessionUsed'].includes(key)) throw new Error(`禁止敏感字段 ${path}.${key}`)
      walk(entry, `${path}.${key}`)
    }
  }
  walk(value)
  return value
}
