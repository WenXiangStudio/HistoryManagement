import { classifyStructuredResponse, projectStructuredResponse, projectionSha256, schemaFingerprint } from './network-observer.js'

const ROUTES = Object.freeze({
  'following-list': ['DY-FOLLOW-NETWORK', '/aweme/v1/web/user/following/list/'],
  'creator-work-list': ['DY-WORKS-NETWORK', '/aweme/v1/web/aweme/post/'],
  'work-detail': ['DY-DETAIL-NETWORK', '/aweme/v1/web/aweme/detail/'],
  'comment-list': ['DY-COMMENT-NETWORK', '/aweme/v1/web/comment/list/'],
  'comment-reply-list': ['DY-REPLY-NETWORK', '/aweme/v1/web/comment/list/reply/']
})
const ID = /^[A-Za-z0-9._-]{1,240}$/

function fail(code, diagnostic = null) {
  const error = new Error(`R8_BATCH_${code}`)
  error.code = error.message
  if (diagnostic) error.diagnostic = diagnostic
  throw error
}
function id(value, code) { if (typeof value !== 'string' || !ID.test(value)) fail(code); return value }
function positiveInteger(value, code, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(code)
  return value
}
function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}
function statusCode(body) { return body?.status_code ?? body?.data?.status_code }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

export async function collectR8Batch({ request, ownerSecUid, scope, knownCreators = [], refreshFollowing = true,
  traceSink = null,
  now = () => performance.now() }) {
  if (typeof request !== 'function') fail('REQUEST_TRANSPORT_MISSING')
  id(ownerSecUid, 'OWNER_SEC_UID_MISSING')
  const limit = positiveInteger(scope?.workLimit ?? 24, 'WORK_LIMIT_INVALID', 100)
  const perCreator = positiveInteger(scope?.worksPerCreator ?? 3, 'PER_CREATOR_LIMIT_INVALID', 100)
  const commentLimit = positiveInteger(scope?.commentsPerWork ?? 100, 'COMMENT_LIMIT_INVALID', 5000)
  const followingLimit = positiveInteger(scope?.followingLimit ?? 1000, 'FOLLOWING_LIMIT_INVALID', 1000)
  const pageSize = positiveInteger(scope?.pageSize ?? 20, 'PAGE_SIZE_INVALID', 100)
  const seed = String(scope?.seed ?? '')
  if (!seed || seed.length > 200) fail('SEED_INVALID')
  const concurrency = positiveInteger(scope?.concurrency ?? 3, 'CONCURRENCY_INVALID', 3)
  const maxPages = positiveInteger(scope?.maxPagesPerRoute ?? 100, 'PAGE_LIMIT_INVALID', 500)
  const begun = now()
  const timings = []
  const counts = Object.fromEntries(Object.keys(ROUTES).map((kind) => [kind, 0]))
  if (traceSink !== null && !Array.isArray(traceSink)) fail('TRACE_SINK_INVALID')
  const requestTrace = traceSink ?? []
  if (!Array.isArray(knownCreators)) fail('KNOWN_CREATORS_INVALID')
  const verifiedKnown = knownCreators.map((creator) => ({
    uid: id(creator?.uid, 'KNOWN_UID_INVALID'),
    secUid: id(creator?.secUid, 'KNOWN_SEC_UID_INVALID'),
    nickname: String(creator?.nickname ?? '').trim(), isFollowing: true
  }))
  if (verifiedKnown.some((creator, index) => !creator.nickname
    || verifiedKnown.findIndex((other) => other.uid === creator.uid || other.secUid === creator.secUid) !== index)) {
    fail('KNOWN_CREATORS_DUPLICATE_OR_INCOMPLETE')
  }

  async function mapLimited(entries, worker) {
    const output = new Array(entries.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++
        output[index] = await worker(entries[index])
      }
    }))
    return output
  }

  async function read(endpointKind, target, cursor, cursorField = null, pageIndex = 0) {
    const [routeId, path] = ROUTES[endpointKind]
    const started = now()
    const diagnostic = { endpointKind, routeId, stage: 'request', pageIndex,
      targetId: target.secUserId ?? target.workId ?? null,
      rootCommentId: target.rootCommentId ?? null,
      requestCursorField: cursorField ?? (endpointKind === 'creator-work-list' ? 'max_cursor'
        : endpointKind.startsWith('comment-') ? 'cursor' : null),
      requestCursorCategory: pageIndex === 0 ? 'initial' : 'advanced',
      responseCursorField: null, responseCursorCategory: 'missing', hasMore: null,
      returnedCount: null, duplicateIdCount: 0, httpStatus: null,
      platformStatusCategory: null, schemaFingerprint: null, projectionSha256: null,
      durationMs: null, retryCount: 0, retryAfterSeconds: null }
    requestTrace.push(diagnostic)
    counts[endpointKind] += 1
    let response
    try { response = await request({ routeId, endpointKind, path, target, cursor, cursorField, count: pageSize, method: 'GET' }) }
    catch (error) {
      diagnostic.durationMs = Math.max(0, now() - started)
      diagnostic.stage = 'transport'
      timings.push(diagnostic.durationMs)
      fail(`TRANSPORT_${endpointKind}_${String(error?.code ?? 'FAILED')}`, diagnostic)
    }
    const elapsed = Math.max(0, now() - started)
    diagnostic.durationMs = elapsed
    diagnostic.httpStatus = Number.isSafeInteger(response?.status) ? response.status : null
    diagnostic.retryAfterSeconds = Number.isSafeInteger(response?.retryAfterSeconds)
      && response.retryAfterSeconds >= 0 && response.retryAfterSeconds <= 3600
      ? response.retryAfterSeconds : null
    timings.push(elapsed)
    if (!isRecord(response) || response.status === 401 || response.status === 403) {
      diagnostic.stage = 'http'; fail('LOGIN_REQUIRED', diagnostic)
    }
    if (response.status === 429) { diagnostic.stage = 'http'; fail('RATE_LIMITED', diagnostic) }
    if (response.status !== 200 || !isRecord(response.body)) {
      diagnostic.stage = 'http-or-json'; fail(`HTTP_OR_JSON_${endpointKind}`, diagnostic)
    }
    diagnostic.platformStatusCategory = statusCode(response.body) === 0 ? 'ok' : 'nonzero-or-missing'
    if (statusCode(response.body) !== 0) {
      diagnostic.stage = 'platform-status'; fail(`PLATFORM_STATUS_${endpointKind}`, diagnostic)
    }
    const classification = classifyStructuredResponse(path, response.body)
    if (classification.disposition !== 'accepted' || classification.endpointKind !== endpointKind) {
      diagnostic.stage = 'schema'; fail(`SCHEMA_${endpointKind}`, diagnostic)
    }
    const projection = await projectStructuredResponse(endpointKind, response.body)
    const fingerprint = await schemaFingerprint(response.body)
    const hash = await projectionSha256(projection)
    diagnostic.stage = 'pagination'
    diagnostic.responseCursorField = projection.cursorField
    diagnostic.hasMore = projection.hasMore
    diagnostic.returnedCount = Array.isArray(projection.items) ? projection.items.length : null
    diagnostic.schemaFingerprint = fingerprint
    diagnostic.projectionSha256 = hash
    diagnostic.responseCursorCategory = projection.cursorOut === null ? 'missing'
      : String(projection.cursorOut) === String(cursor) ? 'same'
        : /^\d+$/.test(String(projection.cursorOut)) && /^\d+$/.test(String(cursor))
          ? BigInt(projection.cursorOut) > BigInt(cursor) ? 'forward' : 'backward' : 'unclassified'
    return { projection, source: { routeId, endpointKind, schemaFingerprint: fingerprint, projectionSha256: hash, durationMs: elapsed } }
  }

  async function pages(endpointKind, target, cap = Infinity, allowPartial = false) {
    let cursor = '0'
    let cursorField = null
    const seenCursors = new Set()
    const seenPageHashes = new Set()
    const seenIds = new Set()
    const items = []
    const sources = []
    try {
    for (let page = 0; page < maxPages; page += 1) {
      if (seenCursors.has(cursor)) fail(`CURSOR_LOOP_${endpointKind}`, requestTrace.at(-1))
      seenCursors.add(cursor)
      const { projection, source } = await read(endpointKind, target, cursor, cursorField, page)
      const diagnostic = requestTrace.at(-1)
      sources.push(source)
      if (projection.paginationKnown !== true) fail(`PAGINATION_STATUS_MISSING_${endpointKind}`, diagnostic)
      if (seenPageHashes.has(source.projectionSha256)) fail(`REPEATED_PAGE_${endpointKind}`, diagnostic)
      seenPageHashes.add(source.projectionSha256)
      if (!Array.isArray(projection.items) || !Array.isArray(projection.returnedIds)
        || projection.items.length !== projection.returnedIds.length) fail(`ITEM_SHAPE_${endpointKind}`, diagnostic)
      const pageIds = new Set()
      for (let index = 0; index < projection.items.length; index += 1) {
        const nativeId = id(projection.returnedIds[index], `NATIVE_ID_${endpointKind}`)
        if (seenIds.has(nativeId) || pageIds.has(nativeId)) {
          diagnostic.duplicateIdCount += 1; fail(`DUPLICATE_ID_${endpointKind}`, diagnostic)
        }
        pageIds.add(nativeId)
      }
      for (const nativeId of pageIds) seenIds.add(nativeId)
      items.push(...projection.items)
      if (projection.hasMore !== true) return {
        items: items.slice(0, cap), sources,
        completeness: items.length > cap ? 'scope-limited' : 'complete', nextCursor: null,
        reportedTotal: projection.reportedTotal
      }
      if (!projection.items.length) fail(`EMPTY_PAGE_WITH_MORE_${endpointKind}`, diagnostic)
      if (endpointKind === 'following-list' && projection.cursorField === null) fail('FOLLOWING_PAGINATION_SHAPE_UNVERIFIED', diagnostic)
      if (!['cursor', 'max_cursor', 'offset', 'min_time', 'max_time'].includes(projection.cursorField)
        || (cursorField !== null && cursorField !== projection.cursorField)) fail(`CURSOR_FIELD_${endpointKind}`, diagnostic)
      let next = String(projection.cursorOut ?? '')
      if (endpointKind === 'following-list' && projection.cursorField === 'offset'
        && (!/^\d+$/.test(next) || Number(next) <= Number(cursor))) {
        // Some following responses echo the current offset. Advancing by the
        // number of native IDs is safe only while every page is nonempty and
        // the global duplicate-ID / repeated-page checks continue to hold.
        if (!Number.isSafeInteger(Number(cursor))) fail('EMPTY_OR_UNSAFE_FOLLOWING_OFFSET', diagnostic)
        next = String(Number(cursor) + projection.items.length)
        diagnostic.responseCursorCategory = 'same-offset-derived-next'
      }
      if (!/^\d+$/.test(next) || next === cursor || seenCursors.has(next)) {
        fail(`CURSOR_NOT_ADVANCING_${endpointKind}`, diagnostic)
      }
      if (items.length >= cap) return { items: items.slice(0, cap), sources,
        completeness: 'scope-limited', nextCursor: next, reportedTotal: projection.reportedTotal }
      cursor = next
      cursorField = projection.cursorField
    }
    fail(`PAGE_LIMIT_${endpointKind}`, requestTrace.at(-1))
    } catch (error) {
      if (/LOGIN_REQUIRED|RATE_LIMITED/.test(String(error?.code ?? error?.message ?? ''))) throw error
      if (allowPartial && items.length > 0) return {
        items, sources, completeness: 'partial', nextCursor: cursor,
        reportedTotal: null,
        failure: { code: String(error?.code ?? error?.message ?? 'R8_BATCH_UNKNOWN_FAILURE'),
          diagnostic: error?.diagnostic ?? null }
      }
      throw error
    }
  }

  const creatorSources = []
  const creatorFailures = []
  let availableWorks = 0
  let seenCreators = 0
  async function readCreators(creators, tolerateFailure) {
    for (let start = 0; start < creators.length && availableWorks < limit; start += concurrency) {
      const remainingCreatorSlots = Math.max(0, followingLimit - seenCreators)
      if (remainingCreatorSlots === 0) break
      const batch = await mapLimited(creators.slice(start, start + concurrency), async (creator) => {
        try {
          const works = await pages('creator-work-list', { secUserId: creator.secUid }, perCreator)
          return { creator, works }
        } catch (error) {
          if (!tolerateFailure || /LOGIN_REQUIRED|RATE_LIMITED/.test(String(error?.message ?? ''))) throw error
          creatorFailures.push({ creatorUid: creator.uid, code: String(error?.code ?? error?.message ?? 'R8_BATCH_UNKNOWN_FAILURE'),
            diagnostic: error?.diagnostic ?? null })
          return null
        }
      })
      for (const entry of batch.filter(Boolean)) {
        creatorSources.push(entry)
        availableWorks += entry.works.items.length
      }
      seenCreators += batch.length
    }
  }
  // Saved creators are requested before the owner's following page. Refresh
  // failure cannot erase these independently verified work-list results.
  await readCreators(verifiedKnown, true)
  let following = { items: [], sources: [], completeness: 'not-run', nextCursor: null, reportedTotal: null }
  let refreshFailure = null
  if (refreshFollowing) {
    try { following = await pages('following-list', { secUserId: ownerSecUid }, followingLimit, true) }
    catch (error) {
      if (!verifiedKnown.length || /LOGIN_REQUIRED|RATE_LIMITED/.test(String(error?.message ?? ''))) throw error
      refreshFailure = { code: String(error?.code ?? error?.message ?? 'R8_BATCH_UNKNOWN_FAILURE'),
        diagnostic: error?.diagnostic ?? null }
      following = { ...following, completeness: 'failed' }
    }
  }
  if (following.failure) refreshFailure = following.failure
  const creators = following.items.map((item) => ({
    uid: id(item.creatorId, 'FOLLOWING_UID_MISSING'),
    secUid: id(item.secCreatorId, 'FOLLOWING_SEC_UID_MISSING'),
    nickname: String(item.nickname ?? '').trim(), isFollowing: item.isFollowing
  }))
  if (creators.some((item, index) => item.isFollowing !== true || !item.nickname
    || creators.findIndex((other) => other.uid === item.uid || other.secUid === item.secUid) !== index)) {
    fail('FOLLOWING_IDENTITY_DUPLICATE_OR_INCOMPLETE')
  }
  const knownUid = new Map(verifiedKnown.map((creator) => [creator.uid, creator.secUid]))
  const knownSecUid = new Map(verifiedKnown.map((creator) => [creator.secUid, creator.uid]))
  for (const creator of creators) {
    if ((knownUid.has(creator.uid) && knownUid.get(creator.uid) !== creator.secUid)
      || (knownSecUid.has(creator.secUid) && knownSecUid.get(creator.secUid) !== creator.uid)) {
      fail('FOLLOWING_IDENTITY_CONFLICT')
    }
  }
  const newCreators = creators.filter((creator) => !knownUid.has(creator.uid))
  const orderedCreators = await Promise.all(newCreators.map(async (creator) => ({
    creator, rank: await projectionSha256({ seed, creatorUid: creator.uid })
  })))
  orderedCreators.sort((a, b) => a.rank.localeCompare(b.rank) || a.creator.uid.localeCompare(b.creator.uid))
  await readCreators(orderedCreators.map((item) => item.creator), false)
  const candidates = []
  const seenWorkIds = new Set()
  const rejectedCreatorIds = new Set()
  for (const { creator, works } of creatorSources) {
    const mismatched = works.items.find((work) => work.authorId !== creator.uid || work.authorSecId !== creator.secUid)
    if (mismatched && verifiedKnown.some((item) => item.uid === creator.uid)) {
      creatorFailures.push({ creatorUid: creator.uid, code: 'R8_BATCH_WORK_AUTHOR_IDENTITY_MISMATCH',
        diagnostic: { endpointKind: 'creator-work-list', stage: 'identity',
          observedField: mismatched.authorId !== creator.uid ? 'author.uid' : 'author.sec_uid',
          targetField: mismatched.authorId !== creator.uid ? 'creator.uid' : 'creator.secUid',
          targetId: creator.uid, observedId: mismatched.authorId !== creator.uid ? mismatched.authorId : mismatched.authorSecId } })
      rejectedCreatorIds.add(creator.uid)
      continue
    }
    for (const work of works.items) {
      id(work.workId, 'WORK_ID_MISSING')
      if (work.authorId !== creator.uid || work.authorSecId !== creator.secUid) fail('WORK_AUTHOR_IDENTITY_MISMATCH')
      if (seenWorkIds.has(work.workId)) fail('DUPLICATE_WORK_ACROSS_CREATORS')
      seenWorkIds.add(work.workId)
      candidates.push({ creator, work })
    }
  }
  const ranked = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate, rank: await projectionSha256({ seed, workId: candidate.work.workId })
  })))
  ranked.sort((a, b) => a.rank.localeCompare(b.rank) || a.work.workId.localeCompare(b.work.workId))
  const perCreatorCounts = new Map()
  const selected = ranked.filter(({ creator }) => {
    const count = perCreatorCounts.get(creator.uid) ?? 0
    if (count >= perCreator) return false
    perCreatorCounts.set(creator.uid, count + 1)
    return true
  }).slice(0, limit)

  const selectedCreatorIds = new Set(selected.map((item) => item.creator.uid))
  const selectedCreatorSources = creatorSources
    .filter((entry) => selectedCreatorIds.has(entry.creator.uid))
    .map(({ creator, works }) => ({ creator, completeness: works.completeness, sources: works.sources }))

  const outcomes = await mapLimited(selected, async ({ creator, work }) => {
    try {
    const detail = await read('work-detail', { workId: work.workId }, '0')
    const detailWork = detail.projection.item
    if (detailWork?.workId !== work.workId || detailWork.authorId !== creator.uid
      || detailWork.authorSecId !== creator.secUid) fail('DETAIL_IDENTITY_MISMATCH')
    const roots = await pages('comment-list', { workId: work.workId }, commentLimit)
    const comments = []
    const commentIds = new Set()
    const verifyComment = (comment) => {
      id(comment.commentId, 'COMMENT_ID_MISSING')
      id(comment.publicAuthorId, 'COMMENT_AUTHOR_ID_MISSING')
      if (typeof comment.publicAuthorName !== 'string' || !comment.publicAuthorName.trim()
        || typeof comment.body !== 'string' || !comment.body.trim()) fail('COMMENT_PUBLIC_CONTENT_MISSING')
      if (commentIds.has(comment.commentId)) fail('COMMENT_ID_DUPLICATE')
      commentIds.add(comment.commentId)
    }
    for (const comment of roots.items) {
      if (comment.workId !== work.workId) fail('CROSS_WORK_COMMENT')
      if (comment.parentCommentId !== null || comment.rootCommentId !== null) fail('ROOT_RELATIONSHIP_INVALID')
      verifyComment(comment)
      comments.push(comment)
    }
    const replies = []
    const replySources = []
    const rootsWithReplies = comments.filter((item) => (item.replyCount ?? 0) > 0)
    let repliesScopeLimited = false
    for (const root of rootsWithReplies) {
      const remaining = commentLimit - comments.length - replies.length
      if (remaining <= 0) { repliesScopeLimited = true; break }
      const replyPage = await pages('comment-reply-list', { workId: work.workId, rootCommentId: root.commentId }, remaining)
      for (const reply of replyPage.items) {
        if (reply.workId !== work.workId) fail('CROSS_WORK_REPLY')
        if (reply.relationshipFieldConflict || reply.rootCommentId !== root.commentId || !reply.parentCommentId) {
          fail('REPLY_RELATIONSHIP_INVALID', { endpointKind: 'comment-reply-list',
            stage: 'identity', targetId: work.workId, rootCommentId: root.commentId,
            observedRootCommentId: reply.rootCommentId,
            observedParentCommentId: reply.parentCommentId,
            observedRootField: reply.rootCommentIdSourceField,
            observedParentField: reply.parentCommentIdSourceField,
            relationshipFieldConflict: reply.relationshipFieldConflict === true })
        }
        verifyComment(reply)
        replies.push(reply)
      }
      if (replyPage.completeness !== 'complete') repliesScopeLimited = true
      replySources.push({ rootCommentId: root.commentId, completeness: replyPage.completeness, sources: replyPage.sources })
    }
    if (roots.completeness === 'complete' && !repliesScopeLimited) {
      for (const reply of replies) {
        if (!commentIds.has(reply.parentCommentId)) fail('REPLY_PARENT_NOT_OBSERVED')
      }
    }
    return { status: 'success',
      creator, work: detailWork, workId: work.workId,
      comments, replies,
      completeness: { detail: 'complete', comments: roots.completeness,
        replies: repliesScopeLimited ? 'scope-limited' : 'complete' },
      sources: { detail: detail.source, comments: roots.sources, replies: replySources }
    }
    } catch (error) {
      if (/LOGIN_REQUIRED|RATE_LIMITED/.test(String(error?.message ?? ''))) throw error
      return { status: 'failed', workId: work.workId,
        creatorUid: creator.uid, code: String(error?.code ?? error?.message ?? 'R8_BATCH_UNKNOWN_FAILURE'),
        diagnostic: error?.diagnostic ?? null }
    }
  })
  const results = outcomes.filter((item) => item.status === 'success')
  const failures = outcomes.filter((item) => item.status === 'failed')
  return {
    contract: 'signaldesk-r8-batch-result/v1', seed,
    status: failures.length || creatorFailures.length ? 'failed'
      : refreshFailure || following.completeness === 'scope-limited' ? 'partial' : 'complete',
    scope: { workLimit: limit, worksPerCreator: perCreator,
      commentsPerWork: commentLimit, followingLimit, concurrency },
    following: { creators, completeness: following.completeness, sources: following.sources,
      reportedTotal: following.reportedTotal ?? null,
      refreshFailure, knownCreatorCount: verifiedKnown.length },
    creatorFailures,
    creatorSources: creatorSources.map(({ creator, works }) => ({
      creator, completeness: works.completeness, sources: works.sources
    })),
    selectedCreatorSources,
    creatorSampling: { considered: creatorSources.length, available: creators.length + verifiedKnown.length,
      completeness: creatorSources.length === creators.length + verifiedKnown.length ? 'all-creators' : 'scope-satisfied' },
    candidateCount: candidates.length, selectedWorkIds: selected.map((item) => item.work.workId),
    results, failures, requestTrace,
    performance: { durationMs: Math.max(0, now() - begun), requestCounts: counts,
      totalRequests: Object.values(counts).reduce((sum, count) => sum + count, 0),
      p50RequestMs: percentile(timings, 0.5), p95RequestMs: percentile(timings, 0.95) }
  }
}
