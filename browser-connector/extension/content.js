const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function visibleText(element) {
  return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim()
}

function stableId(prefix, value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`
}

function parseCompactNumber(value) {
  const text = String(value || '').replace(/,/g, '').trim()
  const match = text.match(/([\d.]+)\s*(万|亿)?/)
  if (!match) return null
  const multiplier = match[2] === '亿' ? 100000000 : match[2] === '万' ? 10000 : 1
  return Math.round(Number(match[1]) * multiplier)
}

function findMetric(root, labels) {
  const text = visibleText(root)
  for (const label of labels) {
    const tokenStart = '(?:^|[^\\p{L}\\p{N}])'
    const tokenEnd = '(?=$|[^\\p{L}\\p{N}])'
    const before = text.match(new RegExp(`${tokenStart}([\\d.,]+\\s*[万亿]?)\\s*${label}${tokenEnd}`, 'u'))
    const after = text.match(new RegExp(`${tokenStart}${label}\\s*([\\d.,]+\\s*[万亿]?)${tokenEnd}`, 'u'))
    const value = before?.[1] || after?.[1]
    if (value) return parseCompactNumber(value)
  }
  return null
}

function assertReadablePage() {
  const body = visibleText(document.body)
  if (/扫码登录|验证码|安全验证|访问过于频繁|登录后查看/.test(body)) {
    throw new Error('抖音要求登录或安全验证，请在该浏览器标签页完成后重试')
  }
}

function boundedLimit(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : fallback
}

const FOLLOWING_LIST_E2E_IDENTITIES = new Set([
  'following-list',
  'follow-list',
  'user-following-list',
  'user-follow-list',
  'user-fans-container'
])

const FOLLOWING_TAB_PATTERN = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
const FANS_TAB_PATTERN = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
const FOLLOWING_RELATIONSHIP_PATTERN = /^(?:已关注|相互关注)$/

function assertFollowingRoute() {
  const url = new URL(location.href)
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  if (url.origin !== 'https://www.douyin.com' || pathname !== '/user/self' || url.searchParams.get('showTab') !== 'follow') {
    throw new Error('当前页面不是经过确认的“本人关注”页面，已停止且不会入库')
  }
}

function isSemanticallyHidden(element) {
  return Boolean(element?.closest('[hidden], [aria-hidden="true"]'))
}

function isRendered(element) {
  if (!element?.isConnected || isSemanticallyHidden(element)) return false
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null
  return style?.display !== 'none' && style?.visibility !== 'hidden'
}

function semanticIdentity(element) {
  if (!element) return 'missing'
  const parts = []
  for (const attribute of ['id', 'role', 'aria-label', 'aria-labelledby', 'data-e2e']) {
    const value = element.getAttribute?.(attribute)
    if (value) parts.push(`${attribute}:${String(value).slice(0, 80)}`)
  }
  return parts.join('|') || `tag:${element.tagName?.toLowerCase() || 'unknown'}`
}

function followingStructureDiagnostics() {
  const tokens = new Set()
  for (const element of document.querySelectorAll('[data-e2e], [role], [aria-label]')) {
    const dataE2e = element.getAttribute('data-e2e')
    const role = element.getAttribute('role')
    const ariaLabel = element.getAttribute('aria-label')
    if (dataE2e && /follow|关注/i.test(dataE2e)) tokens.add(`data-e2e:${dataE2e.slice(0, 60)}`)
    if (role && /关注/.test(visibleText(element).slice(0, 40))) tokens.add(`role:${role}`)
    if (ariaLabel && /关注/.test(ariaLabel)) tokens.add(`aria-label:${ariaLabel.slice(0, 60)}`)
    if (tokens.size >= 8) break
  }
  return [...tokens].join(', ') || 'none'
}

function findActiveFollowingTab() {
  const selectors = [
    '[role="tab"][aria-selected="true"]',
    '[role="tab"][aria-current="page"]',
    '[role="tab"][data-state="active"]',
    '[role="tab"][data-state="selected"]'
  ].join(', ')
  const candidates = [...document.querySelectorAll(selectors)].filter((element) => {
    return isRendered(element) && FOLLOWING_TAB_PATTERN.test(visibleText(element))
  })
  if (candidates.length !== 1) {
    throw new Error(`无法唯一验证已激活的“关注”页签（找到 ${candidates.length} 个；结构标记：${followingStructureDiagnostics()}）`)
  }
  return candidates[0]
}

function isFollowingListIdentity(element) {
  const dataE2e = element.getAttribute?.('data-e2e') || ''
  const ariaLabel = element.getAttribute?.('aria-label') || ''
  return FOLLOWING_LIST_E2E_IDENTITIES.has(dataE2e) || /^我的关注(?:账号|用户|列表)?$/.test(ariaLabel) || /^关注(?:账号|用户)?列表$/.test(ariaLabel)
}

function lowestCommonAncestor(first, second) {
  const ancestors = new Set()
  let current = first
  while (current) {
    ancestors.add(current)
    current = current.parentElement
  }
  current = second
  while (current && !ancestors.has(current)) current = current.parentElement
  return current
}

function locateVerifiedRelationshipDialog(activeTab) {
  const tabList = activeTab.closest('[role="tablist"]')
  if (!tabList) return null
  const tabs = [...tabList.querySelectorAll('[role="tab"]')].filter(isRendered)
  const followingTabs = tabs.filter((element) => FOLLOWING_TAB_PATTERN.test(visibleText(element)))
  const fansTabs = tabs.filter((element) => FANS_TAB_PATTERN.test(visibleText(element)))
  if (followingTabs.length !== 1 || fansTabs.length !== 1 || followingTabs[0] !== activeTab) return null

  const containers = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(isRendered)
  if (containers.length !== 1) {
    throw new Error(`无法唯一验证关注弹窗成员容器（找到 ${containers.length} 个）`)
  }
  const list = containers[0]
  const dialog = lowestCommonAncestor(tabList, list)
  if (!dialog || dialog === document.body || dialog === document.documentElement || dialog.closest('nav, aside')) {
    throw new Error('关注页签与成员容器不属于唯一可验证的关系弹窗')
  }
  if (!hasExplicitFollowingRelationship(list)) {
    throw new Error('关注弹窗成员列表缺少明确的“已关注”关系标记，已停止且不会入库')
  }
  return {
    activeTab,
    root: list,
    list,
    containerIdentity: semanticIdentity(list),
    requiresRelationshipMarker: true
  }
}

function locateVerifiedFollowingSurface() {
  assertFollowingRoute()
  const activeTab = findActiveFollowingTab()
  const relationshipDialog = locateVerifiedRelationshipDialog(activeTab)
  if (relationshipDialog) return relationshipDialog
  const controlledId = activeTab.getAttribute('aria-controls')
  const roots = []
  if (controlledId) {
    const controlled = document.getElementById(controlledId)
    if (controlled) roots.push(controlled)
  }
  if (activeTab.id) {
    for (const panel of document.querySelectorAll('[role="tabpanel"][aria-labelledby]')) {
      if (panel.getAttribute('aria-labelledby') === activeTab.id) roots.push(panel)
    }
  }
  for (const element of document.querySelectorAll('[data-e2e]')) {
    if (FOLLOWING_LIST_E2E_IDENTITIES.has(element.getAttribute('data-e2e') || '')) roots.push(element)
  }
  const uniqueRoots = [...new Set(roots)].filter((element) => {
    return isRendered(element) && !element.closest('nav, aside') && element !== document.body && element !== document.documentElement
  })
  const deepestRoots = uniqueRoots.filter((root) => !uniqueRoots.some((other) => other !== root && root.contains(other)))
  if (deepestRoots.length !== 1) {
    throw new Error(`无法唯一验证关注列表根容器（找到 ${deepestRoots.length} 个；结构标记：${followingStructureDiagnostics()}）`)
  }
  const root = deepestRoots[0]
  const listCandidates = [root, ...root.querySelectorAll('[role="list"], ul, ol, [data-e2e]')]
    .filter((element) => element.isConnected && !isSemanticallyHidden(element) && isFollowingListIdentity(element))
  const uniqueLists = [...new Set(listCandidates)]
  const deepestLists = uniqueLists.filter((list) => !uniqueLists.some((other) => other !== list && list.contains(other)))
  if (deepestLists.length !== 1) {
    throw new Error(`无法唯一验证关注成员列表（找到 ${deepestLists.length} 个；根容器 ${semanticIdentity(root)}）`)
  }
  const list = deepestLists[0]
  return { activeTab, root, list, containerIdentity: semanticIdentity(list), requiresRelationshipMarker: false }
}

function profileIdentity(anchor) {
  try {
    const url = new URL(anchor.href, location.href)
    if (url.origin !== 'https://www.douyin.com') return null
    const match = url.pathname.replace(/\/+$/, '').match(/^\/user\/([^/]+)$/)
    if (!match) return null
    const creatorId = decodeURIComponent(match[1])
    if (!creatorId || creatorId === 'self') return null
    return { creatorId, profileUrl: `https://www.douyin.com/user/${creatorId}` }
  } catch {
    return null
  }
}

function isRecommendationSubtree(element, boundary) {
  let current = element
  while (current && current !== boundary) {
    const dataE2e = current.getAttribute?.('data-e2e') || ''
    const ariaLabel = current.getAttribute?.('aria-label') || ''
    if (/recommend|suggest/i.test(dataE2e) || /推荐|可能感兴趣/.test(ariaLabel)) return true
    current = current.parentElement
  }
  return false
}

function hasExplicitFollowingRelationship(element) {
  const candidates = [element, ...element.querySelectorAll('button, [role="button"], span, div')]
  return candidates.some((candidate) => isRendered(candidate) && FOLLOWING_RELATIONSHIP_PATTERN.test(visibleText(candidate)))
}

function identitiesWithin(element) {
  const anchors = []
  if (element.matches?.('a[href]')) anchors.push(element)
  anchors.push(...element.querySelectorAll('a[href]'))
  return new Set(anchors.map((anchor) => profileIdentity(anchor)?.creatorId).filter(Boolean))
}

function findRelationshipCard(anchor, list, identity) {
  let current = anchor
  while (current && current !== list) {
    const identities = identitiesWithin(current)
    if (identities.size === 1 && identities.has(identity.creatorId) && hasExplicitFollowingRelationship(current)) return current
    current = current.parentElement
  }
  return null
}

function nicknameFromCard(card, matchingAnchors) {
  const namedAnchor = matchingAnchors.find((candidate) => visibleText(candidate))
  if (namedAnchor) return visibleText(namedAnchor)
  const imageAlt = card.querySelector('img[alt]')?.getAttribute('alt')?.trim() || ''
  return imageAlt.replace(/\s*头像$/, '').trim()
}

function readVerifiedFollowingMembers(surface, accumulated) {
  for (const anchor of surface.list.querySelectorAll('a[href]')) {
    const identity = profileIdentity(anchor)
    if (!identity) continue
    const card = surface.requiresRelationshipMarker
      ? findRelationshipCard(anchor, surface.list, identity)
      : anchor.closest('[role="listitem"], li')
    if (!card || !surface.list.contains(card) || isRecommendationSubtree(card, surface.list)) continue
    if (surface.requiresRelationshipMarker) {
      if (!hasExplicitFollowingRelationship(card)) continue
    } else {
      const owningList = card.parentElement?.closest('[role="list"], ul, ol') || card.closest('[role="list"], ul, ol')
      if (owningList !== surface.list) continue
    }
    const matchingAnchors = [...card.querySelectorAll('a[href]')].filter((candidate) => profileIdentity(candidate)?.creatorId === identity.creatorId)
    const nickname = nicknameFromCard(card, matchingAnchors)
    if (!nickname) continue
    const avatar = card.querySelector('img')?.src || null
    const signature = visibleText(card.querySelector('[data-e2e="user-signature"], [aria-label="简介"]')).slice(0, 500)
    accumulated.set(identity.creatorId, {
      entityType: 'creator',
      creatorId: identity.creatorId,
      nickname: nickname.slice(0, 200),
      profileUrl: identity.profileUrl,
      avatarUrl: avatar?.startsWith('http') ? avatar : null,
      signature,
      isFollowing: true
    })
  }
}

function semanticStatus(root, kind) {
  const selectors = kind === 'empty'
    ? '[data-e2e="following-list-empty"], [data-e2e="follow-list-empty"], [role="status"], [aria-live]'
    : '[data-e2e="following-list-end"], [data-e2e="follow-list-end"], [role="status"], [aria-live]'
  const pattern = kind === 'empty'
    ? /^(暂无关注|还没有关注|暂未关注任何账号)$/
    : /^(没有更多了|已加载全部|已经到底了)$/
  return [...root.querySelectorAll(selectors)].some((element) => !isSemanticallyHidden(element) && pattern.test(visibleText(element)))
}

function elementCanScroll(element) {
  const overflowY = getComputedStyle(element).overflowY || element.style?.overflowY || ''
  return /^(auto|scroll)$/.test(overflowY) && Number(element.scrollHeight) > Number(element.clientHeight)
}

function findFollowingScrollRoot(surface) {
  const candidates = []
  let current = surface.list
  while (current) {
    if (elementCanScroll(current)) candidates.push(current)
    if (current === surface.root) break
    current = current.parentElement
  }
  if (candidates.length > 0) {
    const element = candidates[0]
    return { kind: 'element', element, identity: semanticIdentity(element) }
  }
  const documentScroller = document.scrollingElement || document.documentElement
  if (documentScroller && Number(documentScroller.scrollHeight) > Number(documentScroller.clientHeight)) {
    return { kind: 'document', element: documentScroller, identity: semanticIdentity(documentScroller) }
  }
  return null
}

function scrollFollowingSurface(scrollRoot) {
  if (scrollRoot.kind === 'document') {
    window.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
    return
  }
  if (typeof scrollRoot.element.scrollTo === 'function') {
    scrollRoot.element.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
  } else {
    scrollRoot.element.scrollTop = scrollRoot.element.scrollHeight
  }
}

function followingSourceProof(surface, scrollRootKind, scrollRootIdentity, creatorIds, empty = false) {
  return {
    contract: 'douyin-following-source-proof/v1',
    relationship: 'following',
    pageKind: 'owner-following-list',
    activeTab: 'following',
    extractionScope: 'verified-following-list-container',
    scrollRootKind,
    containerIdentity: surface.containerIdentity,
    scrollRootIdentity,
    creatorIds,
    ...(empty ? { emptyStateEvidence: 'verified-empty-state' } : {})
  }
}

async function scrollUntilStable({ maxRounds = 120, waitMs = 700, count, targetCount = null }) {
  let stableRounds = 0
  let previous = count()
  if (targetCount && previous >= targetCount) return { exhausted: false, limitReached: true, rounds: 0 }
  for (let round = 0; round < maxRounds; round += 1) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    await sleep(waitMs)
    assertReadablePage()
    const current = count()
    if (current === previous) stableRounds += 1
    else stableRounds = 0
    previous = current
    if (targetCount && current >= targetCount) return { exhausted: false, limitReached: true, rounds: round + 1 }
    if (stableRounds >= 5) return { exhausted: true, limitReached: false, rounds: round + 1 }
  }
  return { exhausted: false, limitReached: false, rounds: maxRounds }
}

async function collectFollowing(command) {
  assertReadablePage()
  const creatorLimit = boundedLimit(command.payload.creatorLimit, 3, 5)
  let surface = locateVerifiedFollowingSurface()
  const accumulated = new Map()
  readVerifiedFollowingMembers(surface, accumulated)
  if (accumulated.size === 0 && semanticStatus(surface.root, 'empty')) {
    const sourceProof = followingSourceProof(surface, 'not-needed', 'verified-empty-state', [], true)
    return envelope(command, [], 'complete', false, null, sourceProof)
  }
  if (accumulated.size >= creatorLimit) {
    const items = [...accumulated.values()].slice(0, creatorLimit)
    const sourceProof = followingSourceProof(surface, 'not-needed', 'not-needed', items.map((item) => item.creatorId))
    return envelope(command, items, 'partial', true, `小样本同步最多采集 ${creatorLimit} 位博主`, sourceProof)
  }
  if (semanticStatus(surface.root, 'end')) {
    const items = [...accumulated.values()]
    const sourceProof = followingSourceProof(surface, 'not-needed', 'verified-list-end', items.map((item) => item.creatorId))
    return envelope(command, items, 'complete', false, null, sourceProof)
  }

  const scrollRoot = findFollowingScrollRoot(surface)
  if (!scrollRoot) throw new Error(`关注成员少于目标数量，但无法验证实际滚动容器；已停止且不会入库（${surface.containerIdentity}）`)
  let stableRounds = 0
  for (let round = 0; round < 40; round += 1) {
    const previousSize = accumulated.size
    scrollFollowingSurface(scrollRoot)
    await sleep(700)
    assertReadablePage()
    assertFollowingRoute()
    const refreshed = locateVerifiedFollowingSurface()
    if (refreshed.containerIdentity !== surface.containerIdentity) {
      throw new Error('关注列表容器在采集过程中发生变化，已停止且不会入库')
    }
    surface = refreshed
    readVerifiedFollowingMembers(surface, accumulated)
    if (accumulated.size >= creatorLimit) {
      const items = [...accumulated.values()].slice(0, creatorLimit)
      const sourceProof = followingSourceProof(surface, scrollRoot.kind, scrollRoot.identity, items.map((item) => item.creatorId))
      return envelope(command, items, 'partial', true, `小样本同步最多采集 ${creatorLimit} 位博主`, sourceProof)
    }
    if (semanticStatus(surface.root, 'end')) {
      const items = [...accumulated.values()]
      const sourceProof = followingSourceProof(surface, scrollRoot.kind, scrollRoot.identity, items.map((item) => item.creatorId))
      return envelope(command, items, 'complete', false, null, sourceProof)
    }
    stableRounds = accumulated.size === previousSize ? stableRounds + 1 : 0
    if (stableRounds >= 5) {
      throw new Error('关注列表连续滚动未出现新成员，且页面没有可验证的结束标记；已停止且不会入库')
    }
  }
  throw new Error('关注列表达到安全滚动上限但无法证明已经结束；已停止且不会入库')
}

async function collectCreatorWorks(command) {
  assertReadablePage()
  const selector = 'a[href*="/video/"], a[href*="/note/"]'
  const workLimit = boundedLimit(command.payload.worksPerCreator, 5, 10)
  const creatorId = command.payload.creatorId || location.pathname.match(/\/user\/([^/?]+)/)?.[1]
  if (!creatorId) throw new Error('无法从博主主页识别账号 ID')
  const candidates = () => {
    const seen = new Set()
    const values = []
    for (const anchor of document.querySelectorAll(selector)) {
      const url = new URL(anchor.href, location.href)
      const match = url.pathname.match(/\/(video|note)\/([^/?]+)/)
      if (!match || seen.has(match[2])) continue
      seen.add(match[2])
      const card = anchor.closest('li, article, [data-e2e], div[class*="card"]') || anchor
      const image = card.querySelector('img')
      const title = image?.alt || visibleText(card).slice(0, 180)
      const likeCount = findMetric(card, ['赞', '点赞'])
      values.push({
        entityType: 'work', workId: match[2], creatorId: String(creatorId), workType: match[1] === 'note' ? 'image' : 'video',
        sourceUrl: url.origin + url.pathname, coverUrl: image?.src?.startsWith('http') ? image.src : null,
        title, description: title, publishedAt: null, discoveredAt: new Date().toISOString(),
        metrics: {
          likeCount, commentCount: null, collectCount: null, shareCount: null,
          visibility: { like: likeCount === null ? 'unknown' : 'visible', comment: 'unknown', collect: 'unknown', share: 'unknown' }
        }
      })
    }
    return values
  }
  const scroll = await scrollUntilStable({ maxRounds: 60, count: () => candidates().length, targetCount: workLimit })
  const allItems = candidates()
  const items = allItems.slice(0, workLimit)
  const limited = scroll.limitReached || allItems.length > items.length
  return envelope(command, items, limited ? 'partial' : scroll.exhausted ? 'complete' : 'partial', limited || !scroll.exhausted, limited ? `小样本同步每位博主最多采集 ${workLimit} 个作品` : scroll.exhausted ? null : '已达到安全滚动上限')
}

function assertWorkRoute(workId) {
  const url = new URL(location.href)
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  const match = pathname.match(/^\/(?:video|note)\/([^/]+)$/)
  if (url.origin !== 'https://www.douyin.com' || !match || decodeURIComponent(match[1]) !== String(workId)) {
    throw new Error('当前页面不是目标作品详情页，已停止且不会入库')
  }
}

function locateVerifiedCommentSurface(workId) {
  assertWorkRoute(workId)
  const roots = [...document.querySelectorAll('[data-e2e="comment-list"]')].filter((element) => {
    return isRendered(element) && element.classList.contains('comment-mainContent') && !element.closest('nav, aside')
  })
  if (roots.length !== 1) {
    throw new Error(`无法唯一验证作品评论列表容器（找到 ${roots.length} 个），已停止且不会入库`)
  }
  return { root: roots[0], containerIdentity: 'data-e2e:comment-list' }
}

function explicitCommentAuthor(element) {
  const wraps = [...element.querySelectorAll('[class~="comment-item-info-wrap"]')].filter((candidate) => {
    return isRendered(candidate) && candidate.closest('[data-e2e="comment-item"]') === element
  })
  if (wraps.length !== 1) return null
  const wrap = wraps[0]
  const rawName = visibleText(wrap)
  const publicAuthorName = rawName.replace(/\s*作者\s*$/, '').trim()
  if (!publicAuthorName || publicAuthorName.length > 200 || /^公开用户$/.test(publicAuthorName) || /^\d+$/.test(publicAuthorName)) return null
  const anchor = [...element.querySelectorAll('a[href]')].find((candidate) => {
    return candidate.closest('[data-e2e="comment-item"]') === element && profileIdentity(candidate)
  })
  const identity = anchor ? profileIdentity(anchor) : null
  return { wrap, publicAuthorName, publicAuthorId: identity?.creatorId || null }
}

function explicitCommentBody(element, authorWrap) {
  const bodyElement = authorWrap.nextElementSibling
  if (!bodyElement || bodyElement.parentElement !== authorWrap.parentElement || !isRendered(bodyElement)) return null
  if (bodyElement.closest('[data-e2e="comment-item"]') !== element) return null
  const body = visibleText(bodyElement)
  if (!body || body.length > 5000) return null
  if (/^[\d\s.,，。+万亿]+$/.test(body)) return null
  if (/^(?:回复|分享|赞|点赞|展开\s*\d*\s*条?回复|收起\s*\d*\s*条?回复)$/.test(body)) return null
  return body
}

function verifiedCommentRecords(surface, workId) {
  const records = []
  const seen = new Set()
  const nodes = [...surface.root.querySelectorAll('[data-e2e="comment-item"]')].filter((element) => {
    return isRendered(element) && element.closest('[data-e2e="comment-list"]') === surface.root
  })
  for (const element of nodes) {
    const author = explicitCommentAuthor(element)
    if (!author) continue
    const body = explicitCommentBody(element, author.wrap)
    if (!body) continue
    const pageId = (element.getAttribute('data-comment-id') || '').trim()
    const commentIdKind = pageId && pageId.length <= 240 && !/\s/.test(pageId) ? 'page-attribute' : 'synthetic-content-hash'
    const commentId = commentIdKind === 'page-attribute'
      ? pageId
      : stableId('comment', `${workId}:${author.publicAuthorId || author.publicAuthorName}:${body}`)
    if (seen.has(commentId)) continue
    seen.add(commentId)
    records.push({
      entityType: 'comment', commentId, commentIdKind, workId: String(workId), parentCommentId: null,
      publicAuthorId: author.publicAuthorId, publicAuthorName: author.publicAuthorName,
      body, likeCount: findMetric(element, ['赞', '点赞']), publishedAt: null
    })
  }
  return { records, nodeCount: nodes.length }
}

function findCommentScrollRoot(surface) {
  let current = surface.root
  while (current && current !== document.body && current !== document.documentElement) {
    if (elementCanScroll(current)) return { kind: 'element', element: current, identity: semanticIdentity(current) }
    current = current.parentElement
  }
  const scroller = document.scrollingElement || document.documentElement
  if (scroller && Number(scroller.scrollHeight) > Number(scroller.clientHeight)) {
    return { kind: 'document', element: scroller, identity: semanticIdentity(scroller) }
  }
  return null
}

function scrollCommentSurface(scrollRoot) {
  if (scrollRoot.kind === 'document') {
    window.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
  } else if (typeof scrollRoot.element.scrollTo === 'function') {
    scrollRoot.element.scrollTo({ top: scrollRoot.element.scrollHeight, behavior: 'instant' })
  } else {
    scrollRoot.element.scrollTop = scrollRoot.element.scrollHeight
  }
}

function commentSourceProof(surface, scrollRootKind, scrollRootIdentity, workId, items) {
  return {
    contract: 'douyin-comment-source-proof/v1',
    pageKind: 'work-detail-comments',
    extractionScope: 'verified-comment-list-container',
    containerIdentity: surface.containerIdentity,
    itemIdentity: 'data-e2e:comment-item',
    authorIdentity: 'class-token:comment-item-info-wrap',
    bodyIdentity: 'adjacent-visible-sibling-after-author',
    scrollRootKind,
    scrollRootIdentity,
    workId: String(workId),
    commentIds: items.map((item) => item.commentId)
  }
}

async function collectWorkComments(command) {
  assertReadablePage()
  const commentLimit = boundedLimit(command.payload.commentsPerWork, 20, 30)
  const video = document.querySelector('video')
  const mediaUrl = video?.currentSrc?.startsWith('http') ? video.currentSrc : null
  const workId = command.payload.workId || location.pathname.match(/\/(?:video|note)\/([^/?]+)/)?.[1]
  if (!workId) throw new Error('无法识别作品 ID')
  let surface = locateVerifiedCommentSurface(workId)
  let extracted = verifiedCommentRecords(surface, workId)
  if (extracted.nodeCount > 0 && extracted.records.length === 0) {
    throw new Error('评论列表中存在评论项，但无法同时验证公开作者和正文节点，已停止且不会入库')
  }
  if (extracted.nodeCount === 0) {
    throw new Error('评论列表中尚未显示可验证的真实评论，请确认评论已加载后重试')
  }
  const scrollRoot = extracted.records.length >= commentLimit ? null : findCommentScrollRoot(surface)
  let stable = 0
  let previous = extracted.records.length
  if (scrollRoot) {
    for (let round = 0; round < 60 && extracted.records.length < commentLimit; round += 1) {
      scrollCommentSurface(scrollRoot)
      await sleep(650)
      assertReadablePage()
      surface = locateVerifiedCommentSurface(workId)
      const current = verifiedCommentRecords(surface, workId)
      if (current.nodeCount > 0 && current.records.length === 0) {
        throw new Error('滚动后无法验证评论作者和正文结构，已停止且不会入库')
      }
      extracted = current
      stable = extracted.records.length === previous ? stable + 1 : 0
      previous = extracted.records.length
      if (stable >= 6) break
    }
  }
  const items = extracted.records.slice(0, commentLimit)
  if (items.length === 0) throw new Error('没有取得同时具备作者与正文结构证明的评论，已停止且不会入库')
  const limitReached = extracted.records.length >= commentLimit
  const proof = commentSourceProof(
    surface,
    scrollRoot?.kind || 'not-needed',
    scrollRoot?.identity || 'not-needed',
    workId,
    items
  )
  const reason = limitReached
    ? `小样本同步每个作品最多采集 ${commentLimit} 条评论`
    : scrollRoot
      ? '已保存当前可验证评论；页面未提供可验证的列表结束标记'
      : '已保存当前可验证评论；无法验证更多评论'
  const result = envelope(command, items, 'partial', true, reason, proof)
  const likeCount = findMetric(document.body, ['赞', '点赞'])
  const commentCount = findMetric(document.body, ['评论'])
  const collectCount = findMetric(document.body, ['收藏'])
  const shareCount = findMetric(document.body, ['分享'])
  result.items.unshift({
    entityType: 'work', workId: String(workId), creatorId: String(command.payload.creatorId || 'unknown'),
    workType: location.pathname.includes('/note/') ? 'image' : 'video', sourceUrl: location.origin + location.pathname,
    coverUrl: document.querySelector('video')?.poster || null, title: document.title.replace(/\s*-\s*抖音.*$/, ''),
    description: visibleText(document.querySelector('[data-e2e*="video-desc"], [class*="desc"]')).slice(0, 2000),
    mediaUrl, publishedAt: null, discoveredAt: new Date().toISOString(),
    metrics: {
      likeCount, commentCount, collectCount, shareCount,
      visibility: {
        like: likeCount === null ? 'unknown' : 'visible',
        comment: commentCount === null ? 'unknown' : 'visible',
        collect: collectCount === null ? 'unknown' : 'visible',
        share: shareCount === null ? 'unknown' : 'visible'
      }
    }
  })
  return result
}

function envelope(command, items, completeness, hasMore, reason, sourceProof = null) {
  return {
    contract: 'browser-collection-envelope/v1', commandId: command.commandId, platform: 'douyin',
    collectedAt: new Date().toISOString(), sourceUrl: location.href, completeness,
    cursor: null, hasMore, reason, ...(sourceProof ? { sourceProof } : {}), items
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'signaldesk.collect') return false
  const command = message.command
  const handlers = {
    collect_following: collectFollowing,
    collect_creator_works: collectCreatorWorks,
    collect_work_comments: collectWorkComments
  }
  const handler = handlers[command?.action]
  if (!handler) {
    sendResponse({ ok: false, error: `不支持的浏览器采集动作：${String(command?.action || 'unknown')}` })
    return false
  }
  handler(command).then((result) => sendResponse({ ok: true, envelope: result })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})
