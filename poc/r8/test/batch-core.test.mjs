import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectR8Batch } from '../../../browser-connector/extension/r8-batch-core.js'

function fixture(creatorCount = 2, worksPerCreator = 2, mutate = () => {}) {
  const calls = []
  let active = 0
  let peak = 0
  const request = async (input) => {
    calls.push(input)
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active -= 1
    const cursor = Number(input.cursor)
    let body
    if (input.endpointKind === 'following-list') {
      const start = cursor
      const users = Array.from({ length: creatorCount }, (_, index) => ({
        uid: `uid-${index}`, sec_uid: `sec-${index}`, nickname: `作者 ${index}`, is_following: 1
      })).slice(start, start + 10)
      body = { status_code: 0, user_list: users, cursor: start + users.length,
        has_more: start + users.length < creatorCount ? 1 : 0, total: creatorCount }
    } else if (input.endpointKind === 'creator-work-list') {
      const index = Number(input.target.secUserId.split('-')[1])
      const items = Array.from({ length: worksPerCreator }, (_, workIndex) => ({
        aweme_id: `work-${index}-${workIndex}`,
        author: { uid: `uid-${index}`, sec_uid: `sec-${index}`, nickname: `作者 ${index}` },
        statistics: { comment_count: 1 }
      })).slice(cursor, cursor + 2)
      body = { status_code: 0, aweme_list: items, cursor: cursor + items.length,
        has_more: cursor + items.length < worksPerCreator ? 1 : 0, total: worksPerCreator }
    } else if (input.endpointKind === 'work-detail') {
      const [, creatorIndex] = input.target.workId.split('-')
      body = { status_code: 0, aweme_detail: {
        aweme_id: input.target.workId,
        desc: `作品 ${input.target.workId} 的公开简介`, create_time: 1780000000,
        video: { duration: 45000 },
        author: { uid: `uid-${creatorIndex}`, sec_uid: `sec-${creatorIndex}`, nickname: `作者 ${creatorIndex}` },
        statistics: { comment_count: 1 }
      } }
    } else if (input.endpointKind === 'comment-list') {
      body = { status_code: 0, comments: cursor === 0 ? [{
        cid: `cid-${input.target.workId}`, aweme_id: input.target.workId,
        reply_id: '0', text: '公开评论', reply_comment_total: 1,
        user: { uid: 'viewer-1', nickname: '观众' }
      }] : [], cursor: cursor + 1, has_more: cursor === 0 ? 1 : 0, total: 1 }
    } else if (input.endpointKind === 'comment-reply-list') {
      body = { status_code: 0, comments: [{
        cid: `reply-${input.target.workId}`, aweme_id: input.target.workId,
        root_comment_id: input.target.rootCommentId, reply_to_comment_id: input.target.rootCommentId,
        text: '公开回复', user: { uid: 'viewer-2', nickname: '回复者' }
      }], cursor: 1, has_more: 0, total: 1 }
    }
    mutate(input, body)
    return { status: 200, body }
  }
  return { request, calls, getPeak: () => peak }
}

test('batch path closes pagination, keeps uid/sec_uid separate and bounds concurrency', async () => {
  const transport = fixture(8, 4)
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 24, worksPerCreator: 3, commentsPerWork: 20, seed: 'fixed-seed' } })
  assert.equal(result.results.length, 24)
  assert.equal(result.status, 'complete')
  assert.equal(new Set(result.selectedWorkIds).size, 24)
  assert.ok(transport.getPeak() <= 3)
  assert.equal(result.performance.requestCounts['work-detail'], 24)
  assert.equal(result.performance.requestCounts['comment-list'], 48)
  assert.equal(result.performance.requestCounts['comment-reply-list'], 24)
  assert.ok(result.results.every((entry) => entry.creator.uid !== entry.creator.secUid
    && entry.creator.uid === entry.work.authorId && entry.creator.secUid === entry.work.authorSecId
    && entry.work.description.includes(entry.workId) && entry.work.durationMs === 45000
    && entry.completeness.comments === 'complete' && entry.replies[0].rootCommentId === entry.comments[0].commentId))
  assert.ok(!JSON.stringify(result).includes('cookie'))
})

test('100 work benchmark shape reports throughput without an asserted speed promise', async () => {
  const transport = fixture(34, 3)
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 100, worksPerCreator: 3, commentsPerWork: 20, seed: 'benchmark-100' } })
  assert.equal(result.results.length, 100)
  assert.equal(result.performance.requestCounts['work-detail'], 100)
  assert.ok(result.performance.durationMs >= 0 && result.performance.p95RequestMs >= 0)
})

test('tampered creator, detail and cross-work comments fail closed', async () => {
  for (const [kind, change, code] of [
    ['creator-work-list', (body) => { body.aweme_list[0].author.uid = 'other' }, /WORK_AUTHOR_IDENTITY_MISMATCH/],
    ['work-detail', (body) => { body.aweme_detail.author.sec_uid = 'other' }, /DETAIL_IDENTITY_MISMATCH/],
    ['comment-list', (body) => { if (body.comments[0]) body.comments[0].aweme_id = 'other' }, /CROSS_WORK_COMMENT/]
  ]) {
    const transport = fixture(1, 1, (input, body) => { if (input.endpointKind === kind) change(body) })
    const input = { request: transport.request, ownerSecUid: 'owner-sec', scope: { workLimit: 1, seed: 'tamper' } }
    if (kind === 'creator-work-list') await assert.rejects(collectR8Batch(input), code)
    else {
      const result = await collectR8Batch(input)
      assert.equal(result.status, 'failed')
      assert.equal(result.results.length, 0)
      assert.match(result.failures[0].code, code)
    }
  }
})

test('repeated cursor and login/rate limits stop the run', async () => {
  const repeated = fixture(1, 1, (input, body) => {
    if (input.endpointKind === 'comment-list') { body.cursor = 0; body.has_more = 1 }
  })
  const repeatedResult = await collectR8Batch({ request: repeated.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 1, seed: 'cursor' } })
  assert.equal(repeatedResult.status, 'failed')
  assert.match(repeatedResult.failures[0].code, /CURSOR_NOT_ADVANCING/)
  for (const status of [403, 429]) {
    await assert.rejects(collectR8Batch({ request: async () => ({ status }), ownerSecUid: 'owner-sec',
      scope: { workLimit: 1, seed: 'status' } }), status === 429 ? /RATE_LIMITED/ : /LOGIN_REQUIRED/)
  }
})

test('a following page with has_more but no proven cursor is not declared complete', async () => {
  const transport = fixture(2, 1, (input, body) => {
    if (input.endpointKind === 'following-list') {
      delete body.cursor
      body.has_more = 1
    }
  })
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 1, seed: 'following-shape' } })
  assert.equal(result.following.completeness, 'partial')
  assert.equal(result.following.creators.length, 2)
  assert.match(result.following.refreshFailure.code, /FOLLOWING_PAGINATION_SHAPE_UNVERIFIED/)
})

test('following offset may echo the current page while native IDs still advance', async () => {
  const transport = fixture(35, 3, (input, body) => {
    if (input.endpointKind === 'following-list') {
      delete body.cursor
      body.offset = Number(input.cursor)
    }
  })
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 6, worksPerCreator: 3, commentsPerWork: 20, seed: 'offset-echo' } })
  assert.equal(result.status, 'complete')
  assert.equal(result.results.length, 6)
  const offsets = transport.calls.filter((input) => input.endpointKind === 'following-list').map((input) => input.cursor)
  assert.deepEqual(offsets, ['0', '10', '20', '30'])
})

test('following offset echo cannot accept a repeated page', async () => {
  const transport = fixture(20, 1, (input, body) => {
    if (input.endpointKind !== 'following-list') return
    delete body.cursor
    body.offset = Number(input.cursor)
    if (input.cursor !== '0') body.user_list = Array.from({ length: 10 }, (_, index) => ({
      uid: `uid-${index}`, sec_uid: `sec-${index}`, nickname: `作者 ${index}`, is_following: 1
    }))
  })
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 1, seed: 'repeat-page' } })
  assert.equal(result.following.completeness, 'partial')
  assert.equal(result.following.creators.length, 10)
  assert.match(result.following.refreshFailure.code, /REPEATED_PAGE|DUPLICATE_ID/)
})

test('saved creator runs first and survives an independent following refresh failure', async () => {
  const transport = fixture(1, 1)
  const request = async (input) => input.endpointKind === 'following-list'
    ? { status: 500, body: {} } : transport.request(input)
  const result = await collectR8Batch({ request, ownerSecUid: 'owner-sec',
    knownCreators: [{ uid: 'uid-0', secUid: 'sec-0', nickname: '作者 0' }],
    scope: { workLimit: 1, seed: 'saved-first' } })
  assert.equal(result.status, 'partial')
  assert.equal(result.results.length, 1)
  assert.equal(result.following.completeness, 'failed')
  assert.match(result.following.refreshFailure.code, /HTTP_OR_JSON_following-list/)
  assert.equal(result.requestTrace[0].endpointKind, 'creator-work-list')
  assert.equal(result.requestTrace[1].endpointKind, 'following-list')
  assert.equal(result.following.refreshFailure.diagnostic.httpStatus, 500)
})

test('pagination failure retains endpoint, page and cursor categories', async () => {
  const transport = fixture(1, 1, (input, body) => {
    if (input.endpointKind === 'comment-list') { body.cursor = 0; body.has_more = 1 }
  })
  const result = await collectR8Batch({ request: transport.request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 1, seed: 'diagnostic' } })
  const failure = result.failures[0]
  assert.match(failure.code, /CURSOR_NOT_ADVANCING_comment-list/)
  assert.equal(failure.diagnostic.endpointKind, 'comment-list')
  assert.equal(failure.diagnostic.pageIndex, 0)
  assert.equal(failure.diagnostic.responseCursorCategory, 'same')
})

test('confirmed first following page survives a later page failure without claiming closure', async () => {
  const transport = fixture(12, 1)
  const request = async (input) => input.endpointKind === 'following-list' && input.cursor !== '0'
    ? { status: 500, body: {} } : transport.request(input)
  const result = await collectR8Batch({ request, ownerSecUid: 'owner-sec',
    scope: { workLimit: 1, seed: 'partial-following' } })
  assert.equal(result.status, 'partial')
  assert.equal(result.following.completeness, 'partial')
  assert.equal(result.following.creators.length, 10)
  assert.equal(result.following.refreshFailure.diagnostic.pageIndex, 1)
})
