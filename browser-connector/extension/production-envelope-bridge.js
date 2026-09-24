import { projectionSha256 } from './network-observer.js'

export const PRODUCTION_CONNECTOR_BRIDGE_VERSION = 'observer-v2-business-envelope/1'

const ID = /^[A-Za-z0-9._-]{1,240}$/
const ADAPTERS = Object.freeze({
  collect_following: Object.freeze({ name: 'douyin.following', version: '0.2.0-r4' }),
  collect_creator_works: Object.freeze({ name: 'douyin.creator-works', version: '0.2.0-r4' }),
  comments: Object.freeze({ name: 'douyin.comment-list', version: '0.2.0-r5' }),
  replies: Object.freeze({ name: 'douyin.comment-replies', version: '0.2.0-r5' })
})

function reject(message) {
  throw new Error(`OBSERVER_V2_BRIDGE_REJECTED:${message}`)
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${label} must be an object`)
  return value
}

function nativeId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === 'self') reject(`${label} is not a native platform ID`)
  return value
}

function nullableId(value, label) {
  return value === null || value === undefined ? null : nativeId(value, label)
}

function observedAt(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) reject(`${label} is not an ISO date`)
  return value
}

function requestParameters(observation) {
  if (!Array.isArray(observation.requestParameters)) reject('requestParameters are missing')
  const names = new Set()
  return observation.requestParameters.map((candidate) => {
    const entry = record(candidate, 'request parameter')
    if (typeof entry.name !== 'string' || names.has(entry.name)) reject('request parameter names must be unique')
    if (!['string', 'number', 'boolean'].includes(typeof entry.value)) reject(`request parameter ${entry.name} is unsafe`)
    names.add(entry.name)
    return { name: entry.name, value: entry.value }
  })
}

function parameter(observation, name) {
  return requestParameters(observation).find((entry) => entry.name === name)?.value
}

function commandIdentity(command, expected) {
  const payload = record(command.payload, 'command payload')
  if (payload.adapterName !== expected.name || payload.adapterVersion !== expected.version) {
    reject(`command adapter identity must be ${expected.name}@${expected.version}`)
  }
  return expected
}

function validationResults(pagination = 'valid') {
  return {
    http: 'valid', json: 'valid', platformStatus: 'valid', targetIdentity: 'valid',
    schema: 'valid', pagination, sensitiveFields: 'removed'
  }
}

function snapshotObservations(snapshot, targetRoutes) {
  const value = record(snapshot, 'observer snapshot')
  if (!Array.isArray(value.observations) || !Array.isArray(value.issues)) reject('observer snapshot shape is invalid')
  const targetIssues = value.issues.filter((issue) => issue?.code !== 'UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA'
    && targetRoutes.has(issue?.routeId))
  if (targetIssues.length) reject(`observer reported ${targetIssues.length} target route issue(s)`)
  return value.observations.map((candidate) => {
    const item = record(candidate, 'network observation')
    if (item.contract !== 'network-observation/v1') reject('unexpected observation contract')
    observedAt(item.observedAt, 'observation time')
    if (!/^[a-f0-9]{64}$/.test(String(item.schemaFingerprint))) reject('invalid schema fingerprint')
    if (!/^[a-f0-9]{64}$/.test(String(item.responseProjectionSha256))) reject('invalid projection hash')
    requestParameters(item)
    record(item.projection, 'response projection')
    return item
  })
}

async function verifyObservation(observation) {
  if (await projectionSha256(observation.projection) !== observation.responseProjectionSha256) {
    reject(`${observation.endpointKind} projection hash mismatch`)
  }
}

async function pageChain(observations, endpointKind, routeId, targets, initialCursor) {
  const candidates = observations.filter((item) => item.endpointKind === endpointKind
    && Object.entries(targets).every(([name, expected]) => String(parameter(item, name) ?? '') === expected))
  if (!candidates.length) reject(`no ${endpointKind} observation matched the command`)
  const byCursor = new Map()
  for (const item of candidates) {
    if (item.routeId !== routeId || item.projection.endpointKind !== endpointKind) reject(`${endpointKind} route identity mismatch`)
    await verifyObservation(item)
    const cursor = String(parameter(item, 'cursor') ?? '')
    if (!/^\d+$/.test(cursor) || byCursor.has(cursor)) reject(`${endpointKind} request cursor missing or duplicated`)
    byCursor.set(cursor, item)
  }
  const pages = []
  const seen = new Set()
  let cursor = String(initialCursor)
  while (true) {
    if (seen.has(cursor)) reject(`${endpointKind} cursor loop`)
    seen.add(cursor)
    const item = byCursor.get(cursor)
    if (!item) reject(`${endpointKind} chain is incomplete at cursor ${cursor}`)
    pages.push(item)
    if (item.projection.hasMore !== true) break
    const next = String(item.projection.cursorOut ?? '')
    if (!/^\d+$/.test(next) || next === cursor) reject(`${endpointKind} cursor did not advance`)
    cursor = next
  }
  if (pages.length !== candidates.length) reject(`${endpointKind} has observations outside its closed chain`)
  return pages
}

function pageItems(pages, idName) {
  const items = []
  const ids = new Set()
  for (const page of pages) {
    const projection = record(page.projection, 'page projection')
    if (!Array.isArray(projection.items) || !Array.isArray(projection.returnedIds)
      || projection.items.length !== projection.returnedIds.length) reject('projected item/ID list mismatch')
    projection.items.forEach((candidate, index) => {
      const item = record(candidate, 'projected item')
      const id = nativeId(item[idName], idName)
      if (projection.returnedIds[index] !== id || ids.has(id)) reject(`duplicate or reordered ${idName}`)
      ids.add(id)
      items.push(item)
    })
  }
  return items
}

function totalFor(pages, count) {
  const totals = pages.map((page) => page.projection.reportedTotal).filter((value) => value !== null && value !== undefined)
  if (totals.some((value) => !Number.isSafeInteger(value) || value < 0) || new Set(totals).size > 1) reject('reportedTotal is inconsistent')
  const total = totals.length ? totals[0] : null
  if (total !== null && total < count) reject('reportedTotal is smaller than returned IDs')
  if (!count && total !== 0) reject('verified-empty requires reportedTotal=0')
  return total
}

async function chainFingerprint(pages) {
  if (pages.length === 1) return pages[0].schemaFingerprint
  return await projectionSha256({ endpointKind: pages[0].endpointKind, pageSchemaFingerprints: pages.map((page) => page.schemaFingerprint) })
}

function trace(routeId, fingerprint, at) {
  return [{ routeId, status: 'success', attempt: 1, durationMs: 0, schemaFingerprint: fingerprint, occurredAt: at }]
}

function envelope(command, sourceUrl, at, cursor, sourceProof, items) {
  return {
    contract: 'browser-collection-envelope/v1', commandId: command.commandId, platform: 'douyin',
    collectedAt: at, sourceUrl, completeness: 'complete', cursor, hasMore: false,
    reason: null, sourceProof, items
  }
}

async function followingEnvelope(command, observations) {
  const identity = commandIdentity(command, ADAPTERS.collect_following)
  const candidates = observations.filter((item) => item.endpointKind === 'following-list')
  const owners = new Set(candidates.map((item) => String(parameter(item, 'sec_user_id') ?? '')).filter(Boolean))
  if (owners.size !== 1) reject('following requires one explicit request sec_user_id owner')
  const ownerAccountId = nativeId([...owners][0], 'following owner')
  const cursorIn = String(command.payload.cursor ?? '0')
  const pages = await pageChain(observations, 'following-list', 'DY-FOLLOW-NETWORK', { sec_user_id: ownerAccountId }, cursorIn)
  const projected = pageItems(pages, 'creatorId')
  if (projected.some((item) => item.isFollowing !== true || typeof item.nickname !== 'string' || !item.nickname.trim())) {
    reject('following item lacks an explicit relationship or nickname')
  }
  const creatorIds = projected.map((item) => item.creatorId)
  const reportedTotal = totalFor(pages, creatorIds.length)
  const last = pages.at(-1)
  const collectedAt = observedAt(last.observedAt, 'following collectedAt')
  const cursorOut = last.projection.cursorOut === null ? null : String(last.projection.cursorOut)
  const schemaFingerprint = await chainFingerprint(pages)
  const businessProjection = {
    endpointKind: 'following-list', relationship: 'following', ownerAccountId, cursorIn, cursorOut,
    hasMore: false, reportedTotal, returnedIds: creatorIds,
    items: projected.map((item) => ({
      creatorId: item.creatorId, secCreatorId: nullableId(item.secCreatorId, 'following sec ID'),
      nickname: item.nickname, signature: '', relationship: 'following'
    }))
  }
  const sourceProof = {
    contract: 'douyin-following-structured-proof/v3', platform: 'douyin',
    adapterName: identity.name, adapterVersion: identity.version, schemaVersion: 3,
    routeId: 'DY-FOLLOW-NETWORK', sourceKind: 'network-response', endpointKind: 'following-list',
    relationship: 'following', ownerAccountId, requestTargetCreatorId: ownerAccountId,
    requestParameters: requestParameters(pages[0]), cursorIn, cursorOut, hasMore: false, reportedTotal,
    returnedIds: creatorIds, creatorIds,
    creatorIdentityBindings: businessProjection.items.map((item) => ({
      creatorId: item.creatorId, secCreatorId: nativeId(item.secCreatorId, 'following sec ID')
    })),
    schemaFingerprint,
    responseProjectionSha256: await projectionSha256(businessProjection),
    routeTrace: trace('DY-FOLLOW-NETWORK', schemaFingerprint, collectedAt), collectedAt,
    browserOrigin: 'https://www.douyin.com', sessionUsed: true, validationResults: validationResults()
  }
  const items = businessProjection.items.map((item) => ({
    entityType: 'creator', creatorId: item.creatorId, nickname: item.nickname,
    profileUrl: `https://www.douyin.com/user/${encodeURIComponent(nativeId(item.secCreatorId, 'following sec ID'))}`,
    signature: item.signature, isFollowing: true
  }))
  return envelope(command, 'https://www.douyin.com/user/self?showTab=follow', collectedAt, cursorOut, sourceProof, items)
}

function metrics(statistics) {
  const value = record(statistics, 'work statistics')
  const get = (name) => Number.isSafeInteger(value[name]) && value[name] >= 0 ? value[name] : null
  return {
    likeCount: get('likeCount'), commentCount: get('commentCount'), collectCount: get('collectCount'),
    shareCount: get('shareCount'), playCount: get('playCount')
  }
}

function workObservation(routeId, endpointKind, requestTargetCreatorId, work, at, fingerprint, hash, routeTrace) {
  return {
    contract: 'douyin-structured-work-observation/v1', sourceKind: 'network-response', routeId,
    endpointKind, requestTargetCreatorId, workId: work.workId, authorId: work.authorId,
    authorIdSourcePath: work.authorIdSourcePath, observedAt: at, schemaFingerprint: fingerprint,
    responseProjectionSha256: hash, routeTrace
  }
}

async function worksEnvelope(command, observations) {
  const identity = commandIdentity(command, ADAPTERS.collect_creator_works)
  const creatorId = nativeId(command.payload.creatorId, 'works creator')
  const cursorIn = String(command.payload.cursor ?? '0')
  const pages = await pageChain(observations, 'creator-work-list', 'DY-WORKS-NETWORK', { sec_user_id: creatorId }, cursorIn)
  const projected = pageItems(pages, 'workId')
  if (projected.some((item) => item.authorId !== creatorId)) reject('works list author does not match the requested followed creator')
  const workIds = projected.map((item) => item.workId)
  const reportedTotal = totalFor(pages, workIds.length)
  const last = pages.at(-1)
  const collectedAt = observedAt(last.observedAt, 'works collectedAt')
  const cursorOut = last.projection.cursorOut === null ? null : String(last.projection.cursorOut)
  const schemaFingerprint = await chainFingerprint(pages)
  const listProjection = {
    endpointKind: 'creator-work-list', cursorIn, cursorOut, hasMore: false, reportedTotal,
    returnedIds: workIds, items: projected
  }
  const listHash = await projectionSha256(listProjection)
  const listTrace = trace('DY-WORKS-NETWORK', schemaFingerprint, collectedAt)
  const sourceProof = {
    contract: 'douyin-creator-works-structured-proof/v2', platform: 'douyin',
    adapterName: identity.name, adapterVersion: identity.version, schemaVersion: 2,
    routeId: 'DY-WORKS-NETWORK', sourceKind: 'network-response', endpointKind: 'creator-work-list',
    followedCreatorId: creatorId, profileRouteCreatorId: creatorId, requestTargetCreatorId: creatorId,
    targetCreatorIdSourcePath: 'request.sec_user_id', requestParameters: requestParameters(pages[0]),
    cursorIn, cursorOut, hasMore: false, reportedTotal, returnedIds: workIds, workIds,
    authorBindings: projected.map((item) => ({ workId: item.workId, authorId: item.authorId })),
    schemaFingerprint, responseProjectionSha256: listHash, routeTrace: listTrace, collectedAt,
    browserOrigin: 'https://www.douyin.com', sessionUsed: true, validationResults: validationResults()
  }
  const items = []
  for (const listWork of projected) {
    const workId = nativeId(listWork.workId, 'work ID')
    const details = observations.filter((item) => item.endpointKind === 'work-detail'
      && [parameter(item, 'aweme_id'), parameter(item, 'item_id')].some((value) => String(value ?? '') === workId))
    if (details.length !== 1) reject(`work ${workId} requires exactly one independent detail observation`)
    const detail = details[0]
    if (detail.routeId !== 'DY-DETAIL-NETWORK' || detail.projection.endpointKind !== 'work-detail') reject('detail route identity mismatch')
    await verifyObservation(detail)
    const detailWork = record(detail.projection.item, 'detail work')
    if (detail.projection.returnedIds?.length !== 1 || detail.projection.returnedIds[0] !== workId
      || detailWork.workId !== workId || detailWork.authorId !== creatorId) reject(`work ${workId} detail identity mismatch`)
    const detailAt = observedAt(detail.observedAt, 'detail collectedAt')
    const detailTrace = trace('DY-DETAIL-NETWORK', detail.schemaFingerprint, detailAt)
    const listObservation = workObservation('DY-WORKS-NETWORK', 'creator-work-list', creatorId,
      listWork, collectedAt, schemaFingerprint, listHash, listTrace)
    const detailObservation = workObservation('DY-DETAIL-NETWORK', 'work-detail', null,
      detailWork, detailAt, detail.schemaFingerprint, detail.responseProjectionSha256, detailTrace)
    const parameterName = parameter(detail, 'aweme_id') === workId ? 'aweme_id' : 'item_id'
    const detailSourceProof = {
      contract: 'douyin-work-detail-structured-proof/v2', platform: 'douyin',
      adapterName: identity.name, adapterVersion: identity.version, schemaVersion: 2,
      routeId: 'DY-DETAIL-NETWORK', sourceKind: 'network-response', endpointKind: 'work-detail',
      targetWorkId: workId, returnedWorkId: workId, expectedCreatorId: creatorId,
      observedAuthorId: creatorId, authorIdSourcePath: detailWork.authorIdSourcePath,
      targetWorkIdSourcePath: `request.${parameterName}`, requestParameters: requestParameters(detail),
      returnedIds: [workId], schemaFingerprint: detail.schemaFingerprint,
      responseProjectionSha256: detail.responseProjectionSha256, routeTrace: detailTrace,
      collectedAt: detailAt, browserOrigin: 'https://www.douyin.com', sessionUsed: true,
      validationResults: validationResults('not-applicable')
    }
    const authorProof = {
      contract: 'douyin-work-author-proof/v2', followedCreatorId: creatorId, profileRouteCreatorId: creatorId,
      requestTargetCreatorId: creatorId, observedWorkAuthorId: creatorId, observedWorkId: workId,
      authorProofSource: 'network-response', endpointKind: 'creator-work-list', routeId: 'DY-WORKS-NETWORK',
      adapterVersion: identity.version, observedAt: collectedAt, schemaFingerprint,
      responseProjectionSha256: listHash, routeTrace: listTrace
    }
    const listStatistics = metrics(listWork.statistics)
    const detailStatistics = metrics(detailWork.statistics)
    const changedStatisticFields = ['likeCount', 'commentCount', 'collectCount', 'shareCount', 'playCount']
      .filter((name) => listStatistics[name] !== detailStatistics[name])
    const detailVerification = {
      contract: 'douyin-work-detail-verification/v1', workId, expectedCreatorId: creatorId,
      listObservation, detailObservation, detailSourceProof, listStatistics, detailStatistics,
      changedStatisticFields, verifiedAt: detailAt
    }
    const workType = detailWork.workType === 'image' ? 'image' : 'video'
    items.push({
      entityType: 'work', workId, creatorId, workType,
      sourceUrl: `https://www.douyin.com/${workType === 'image' ? 'note' : 'video'}/${encodeURIComponent(workId)}`,
      title: '', description: '', publishedAt: null, discoveredAt: collectedAt,
      metrics: {
        likeCount: detailStatistics.likeCount, commentCount: detailStatistics.commentCount,
        collectCount: detailStatistics.collectCount, shareCount: detailStatistics.shareCount,
        visibility: { like: 'unknown', comment: 'unknown', collect: 'unknown', share: 'unknown' }
      },
      authorProof, structuredObservation: listObservation, detailVerification
    })
  }
  return envelope(command, `https://www.douyin.com/user/${encodeURIComponent(creatorId)}`, collectedAt, cursorOut, sourceProof, items)
}

function normalizedComment(item, endpointKind, rootId) {
  const commentId = nativeId(item.commentId, 'comment cid')
  const workId = nativeId(item.workId, 'comment aweme_id')
  const publicAuthorId = nativeId(item.publicAuthorId, 'comment author ID')
  const publicAuthorName = typeof item.publicAuthorName === 'string' ? item.publicAuthorName.normalize('NFKC').trim() : ''
  const body = typeof item.body === 'string' ? item.body.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
  if (!publicAuthorName || publicAuthorName === '公开用户' || /^\d+$/.test(publicAuthorName)) reject(`comment ${commentId} lacks public author name`)
  if (!body || /^[\d\s.,，。+万亿]+$/.test(body)) reject(`comment ${commentId} lacks valid body`)
  const parentCommentId = nullableId(item.parentCommentId, 'parent comment ID')
  const rootCommentId = nullableId(item.rootCommentId, 'root comment ID')
  if (endpointKind === 'comment-list' && (parentCommentId !== null || rootCommentId !== null)) reject('root comment carries reply relationship')
  if (endpointKind === 'comment-reply-list' && (parentCommentId === null || rootCommentId !== rootId)) reject('reply relationship mismatch')
  return {
    commentId, commentIdKind: 'native-cid', workId, parentCommentId, rootCommentId,
    publicAuthorId, publicAuthorName, body,
    likeCount: Number.isSafeInteger(item.likeCount) && item.likeCount >= 0 ? item.likeCount : null,
    replyCount: Number.isSafeInteger(item.replyCount) && item.replyCount >= 0 ? item.replyCount : null,
    publishedAt: item.publishedAt === null ? null : observedAt(item.publishedAt, 'comment publishedAt'), endpointKind
  }
}

function commentPageUrl(legacyEnvelope, workId) {
  const url = new URL(String(legacyEnvelope?.sourceUrl ?? ''))
  const match = url.pathname.replace(/\/+$/, '').match(/^\/(?:video|note)\/([^/]+)$/)
  if (url.origin !== 'https://www.douyin.com' || !match || decodeURIComponent(match[1]) !== workId) reject('comment page does not match work')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

async function commentsEnvelope(command, legacyEnvelope, observations) {
  const workId = nativeId(command.payload.workId, 'comment work ID')
  const creatorId = nativeId(command.payload.creatorId, 'comment creator ID')
  const rootId = nullableId(command.payload.rootCommentId, 'root comment ID')
  const identity = commandIdentity(command, rootId ? ADAPTERS.replies : ADAPTERS.comments)
  const endpointKind = rootId ? 'comment-reply-list' : 'comment-list'
  const routeId = rootId ? 'DY-REPLY-NETWORK' : 'DY-COMMENT-NETWORK'
  const cursorIn = String(command.payload.cursor ?? '0')
  const targets = { aweme_id: workId, ...(rootId ? { comment_id: rootId } : {}) }
  const pages = await pageChain(observations, endpointKind, routeId, targets, cursorIn)
  const comments = pageItems(pages, 'commentId').map((item) => normalizedComment(item, endpointKind, rootId))
  const limit = Number(command.payload.commentsPerWork)
  if (!Number.isSafeInteger(limit) || limit < 1 || comments.length > limit) reject('comment result exceeds command scope')
  if (comments.some((item) => item.workId !== workId)) reject('comment work target mismatch')
  const commentIds = comments.map((item) => item.commentId)
  const reportedTotal = totalFor(pages, commentIds.length)
  const last = pages.at(-1)
  const collectedAt = observedAt(last.observedAt, 'comment collectedAt')
  const cursorOut = last.projection.cursorOut === null ? null : String(last.projection.cursorOut)
  const schemaFingerprint = await chainFingerprint(pages)
  const projection = {
    endpointKind, targetWorkId: workId, targetRootCommentId: rootId,
    cursorIn, cursorOut, hasMore: false, reportedTotal, returnedIds: commentIds, items: comments
  }
  const bindings = comments.map((item) => ({
    commentId: item.commentId, workId: item.workId,
    parentCommentId: item.parentCommentId, rootCommentId: item.rootCommentId
  }))
  const baseProof = {
    platform: 'douyin', adapterName: identity.name, adapterVersion: identity.version, schemaVersion: 2,
    routeId, sourceKind: 'network-response', endpointKind, requestParameters: requestParameters(pages[0]),
    targetWorkId: workId, requestTargetWorkId: workId, targetWorkIdSourcePath: 'request.aweme_id',
    cursorIn, cursorOut, hasMore: false, reportedTotal, returnedIds: commentIds, commentIds,
    commentBindings: bindings, schemaFingerprint, responseProjectionSha256: await projectionSha256(projection),
    routeTrace: trace(routeId, schemaFingerprint, collectedAt), collectedAt,
    browserOrigin: 'https://www.douyin.com', sessionUsed: true, validationResults: validationResults()
  }
  const sourceProof = rootId ? {
    contract: 'douyin-comment-reply-structured-proof/v2', ...baseProof,
    targetRootCommentId: rootId, requestTargetRootCommentId: rootId,
    targetRootCommentIdSourcePath: 'request.comment_id'
  } : { contract: 'douyin-comment-list-structured-proof/v2', ...baseProof }
  const sourceUrl = commentPageUrl(legacyEnvelope, workId)
  const workType = new URL(sourceUrl).pathname.startsWith('/note/') ? 'image' : 'video'
  const work = {
    entityType: 'work', workId, creatorId, workType, sourceUrl,
    title: '', description: '', publishedAt: null, discoveredAt: collectedAt
  }
  return envelope(command, sourceUrl, collectedAt, cursorOut, sourceProof,
    [work, ...comments.map((item) => ({ entityType: 'comment', ...item }))])
}

export async function buildV2BusinessEnvelope(commandInput, legacyEnvelope, snapshot) {
  const command = record(commandInput, 'browser command')
  if (command.contract !== 'browser-command/v1' || typeof command.commandId !== 'string' || !command.commandId) reject('invalid browser command')
  if (legacyEnvelope?.commandId !== command.commandId) reject('page result belongs to another command')
  const targetRoutes = command.action === 'collect_following' ? new Set(['DY-FOLLOW-NETWORK'])
    : command.action === 'collect_creator_works' ? new Set(['DY-WORKS-NETWORK', 'DY-DETAIL-NETWORK'])
      : command.action === 'collect_work_comments' ? new Set([
        command.payload?.rootCommentId ? 'DY-REPLY-NETWORK' : 'DY-COMMENT-NETWORK'
      ]) : new Set()
  const observations = snapshotObservations(snapshot, targetRoutes)
  if (command.action === 'collect_following') return await followingEnvelope(command, observations)
  if (command.action === 'collect_creator_works') return await worksEnvelope(command, observations)
  if (command.action === 'collect_work_comments') return await commentsEnvelope(command, legacyEnvelope, observations)
  reject(`unsupported action ${String(command.action)}`)
}
