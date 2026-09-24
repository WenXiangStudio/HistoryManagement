// A bounded, passive homepage pilot. The caller may navigate one verified
// creator page and one work page; this module never issues endpoint requests.
const ID = /^[A-Za-z0-9._-]{1,240}$/
const WORK_PATH = /^\/(?:video|note)\/([0-9]{8,30})\/?$/

function publicId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${label}_INVALID`)
  return value
}
function safeWorkUrl(value) {
  let url
  try { url = new URL(value) } catch { return null }
  if (url.origin !== 'https://www.douyin.com' || url.username || url.password) return null
  const match = url.pathname.match(WORK_PATH)
  return match ? { workId: match[1], url: `${url.origin}${url.pathname.replace(/\/$/, '')}` } : null
}
function safeProfileUrl(value, secUid) {
  let url
  try { url = new URL(value) } catch { return false }
  return url.origin === 'https://www.douyin.com'
    && url.pathname.replace(/\/$/, '') === `/user/${encodeURIComponent(secUid)}`
    && !url.username && !url.password
}
function securityState(page) {
  return page?.securityPrompt === true || page?.loginPrompt === true
}
function routeObservation(snapshot, kind, targetParameter, targetId) {
  return (snapshot?.observations ?? []).filter((item) => item.endpointKind === kind
    && item.routeId === (kind === 'creator-work-list' ? 'DY-WORKS-NETWORK' : 'DY-DETAIL-NETWORK')
    && item.requestParameters?.some((parameter) => (parameter.name === targetParameter
      || (kind === 'work-detail' && parameter.name === 'item_id'))
      && parameter.value === targetId))
}
function proof(item) {
  return { routeId: item.routeId, endpointKind: item.endpointKind,
    schemaFingerprint: item.schemaFingerprint, projectionSha256: item.responseProjectionSha256,
    observedAt: item.observedAt }
}

export async function runHomepagePilot({ creator, navigate, inspectPage, snapshot,
  wait = async () => {}, maxCards = 6, initialNavigationCount = 0 }) {
  const uid = publicId(creator?.uid, 'CREATOR_UID')
  const secUid = publicId(creator?.secUid, 'CREATOR_SEC_UID')
  if (typeof navigate !== 'function' || typeof inspectPage !== 'function'
    || typeof snapshot !== 'function' || typeof wait !== 'function') throw new Error('PILOT_DRIVER_INVALID')
  if (!Number.isSafeInteger(maxCards) || maxCards < 1 || maxCards > 6) throw new Error('MAX_CARDS_INVALID')
  if (!Number.isSafeInteger(initialNavigationCount) || initialNavigationCount < 0
    || initialNavigationCount > 1) throw new Error('INITIAL_NAVIGATION_COUNT_INVALID')
  const profileUrl = `https://www.douyin.com/user/${encodeURIComponent(secUid)}`
  const result = { contract: 'signaldesk-homepage-pilot/v1', creator: { uid, secUid, profileUrl },
    status: 'blocked', stage: 'profile', navigationCount: initialNavigationCount, activeApiRequests: 0,
    candidates: [], verifiedWork: null, workProof: null, detailProof: null,
    comments: 'not-requested', replies: 'not-requested', reason: null }
  await navigate(profileUrl)
  result.navigationCount += 1
  await wait()
  const profile = await inspectPage()
  if (securityState(profile)) { result.reason = 'PAGE_SECURITY_OR_LOGIN_PROMPT'; return result }
  if (!safeProfileUrl(profile?.pageUrl, secUid)) { result.reason = 'PROFILE_ROUTE_MISMATCH'; return result }
  const cards = []
  const cardIds = new Set()
  for (const entry of (Array.isArray(profile.cards) ? profile.cards : []).slice(0, maxCards)) {
    const work = safeWorkUrl(entry?.url)
    if (!work || cardIds.has(work.workId)) continue
    cardIds.add(work.workId)
    cards.push(work)
  }
  result.candidates = cards.map((item) => ({ workId: item.workId, url: item.url,
    status: 'page-visible-candidate' }))
  if (!cards.length) { result.reason = 'NO_PAGE_VISIBLE_WORK'; return result }
  const profileSnapshot = await snapshot()
  const worksRoutes = routeObservation(profileSnapshot, 'creator-work-list', 'sec_user_id', secUid)
  let chosen = null
  let chosenProof = null
  for (const card of cards) {
    const match = worksRoutes.find((route) => route.projection?.items?.some((work) =>
      work.workId === card.workId && work.authorId === uid && work.authorSecId === secUid))
    if (match) { chosen = card; chosenProof = proof(match); break }
  }
  if (!chosen) {
    result.status = 'candidate-only'
    result.reason = 'NO_MATCHING_STRUCTURED_AUTHOR_PROOF'
    return result
  }
  result.workProof = chosenProof
  result.stage = 'work-detail'
  await navigate(chosen.url)
  result.navigationCount += 1
  await wait()
  const workPage = await inspectPage()
  if (securityState(workPage)) { result.reason = 'PAGE_SECURITY_OR_LOGIN_PROMPT'; return result }
  const actual = safeWorkUrl(workPage?.pageUrl)
  if (!actual || actual.workId !== chosen.workId) {
    result.reason = 'WORK_ROUTE_MISMATCH'; return result
  }
  const detailSnapshot = await snapshot()
  const matchingDetail = routeObservation(detailSnapshot, 'work-detail', 'aweme_id', chosen.workId)
    .find((route) => route.projection?.item?.workId === chosen.workId
      && route.projection.item.authorId === uid && route.projection.item.authorSecId === secUid)
  if (!matchingDetail) {
    result.status = 'candidate-only'
    result.reason = 'NO_MATCHING_STRUCTURED_DETAIL_PROOF'
    return result
  }
  result.verifiedWork = matchingDetail.projection.item
  result.detailProof = proof(matchingDetail)
  result.status = 'verified'
  result.reason = null
  return result
}
