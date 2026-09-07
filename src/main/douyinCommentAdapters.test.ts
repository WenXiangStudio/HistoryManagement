import { describe, expect, it } from 'vitest'
import commentFixture from '../shared/fixtures/douyin-comment-pages-r5.mock.json'
import {
  COMMENT_ROUTE_REGISTRY,
  douyinCommentListStructuredProofSchema,
  douyinCommentReplyStructuredProofSchema
} from '../shared/commentAcquisition'
import type { PlatformAdapterContext } from '../shared/platformAdapter'
import {
  DouyinCommentListAdapter,
  DouyinCommentReplyAdapter,
  assertNormalizedCommentIsNative,
  type CommentRouteId,
  type CommentRouteSource,
  type ReplyRouteId,
  type ReplyRouteSource,
  type StructuredCommentReadRequest,
  type StructuredCommentRouteId,
  type StructuredCommentRouteReadResult,
  type StructuredCommentUnavailableReason
} from './douyinCommentAdapters'

const observedAt = '2026-09-06T06:00:00.000Z'
const workId = commentFixture.workId
const rootCommentId = commentFixture.rootCommentId

const sourceKinds = {
  'DY-COMMENT-NETWORK': 'network-response',
  'DY-COMMENT-EMBEDDED': 'embedded-json',
  'DY-COMMENT-INPAGE': 'page-context-fetch',
  'DY-COMMENT-TRIGGER': 'triggered-network-response',
  'DY-REPLY-NETWORK': 'network-response',
  'DY-REPLY-EMBEDDED': 'embedded-json',
  'DY-REPLY-INPAGE': 'page-context-fetch',
  'DY-REPLY-TRIGGER': 'triggered-network-response'
} as const

function context(): PlatformAdapterContext {
  return {
    browserOrigin: 'https://www.douyin.com',
    sessionKind: 'browser-page',
    signal: new AbortController().signal,
    now: () => new Date(observedAt)
  }
}

function safeRequest(endpoint: 'comment-list' | 'comment-reply-list', input: {
  workId: string
  rootCommentId: string | null
  cursor: string
  count: number
}): StructuredCommentReadRequest {
  return endpoint === 'comment-list'
    ? {
      method: 'GET',
      path: '/aweme/v1/web/comment/list/',
      parameters: { aweme_id: input.workId, cursor: input.cursor, count: input.count },
      headers: { accept: 'application/json' }
    }
    : {
      method: 'GET',
      path: '/aweme/v1/web/comment/list/reply/',
      parameters: { aweme_id: input.workId, comment_id: input.rootCommentId, cursor: input.cursor, count: input.count },
      headers: { accept: 'application/json' }
    }
}

type ReadInput = {
  workId: string
  rootCommentId: string | null
  cursor: string
  count: number
  signal: AbortSignal
}

function payloadSource(
  routeId: StructuredCommentRouteId,
  endpoint: 'comment-list' | 'comment-reply-list',
  payload: (input: ReadInput) => unknown,
  request?: (input: ReadInput) => StructuredCommentReadRequest | null,
  onRead?: () => void
): CommentRouteSource | ReplyRouteSource {
  const sourceKind = sourceKinds[routeId]
  const read = async (input: ReadInput): Promise<StructuredCommentRouteReadResult> => {
    onRead?.()
    return {
      outcome: 'response',
      httpStatus: 200,
      contentType: sourceKind === 'embedded-json' ? null : 'application/json; charset=utf-8',
      payload: structuredClone(payload(input)),
      request: request ? request(input) : sourceKind === 'embedded-json' ? null : safeRequest(endpoint, input),
      durationMs: 7,
      observedAt,
      ...(sourceKind === 'triggered-network-response' ? { observationKind: 'network-observer' as const } : {})
    }
  }
  return sourceKind === 'triggered-network-response'
    ? { routeId: routeId as 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER', sourceKind, observeAfterTrigger: read } as CommentRouteSource | ReplyRouteSource
    : { routeId: routeId as Exclude<StructuredCommentRouteId, 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER'>, sourceKind, readPage: read } as CommentRouteSource | ReplyRouteSource
}

function unavailableSource(
  routeId: StructuredCommentRouteId,
  reason: StructuredCommentUnavailableReason,
  onRead?: () => void
): CommentRouteSource | ReplyRouteSource {
  const sourceKind = sourceKinds[routeId]
  const read = async (): Promise<StructuredCommentRouteReadResult> => {
    onRead?.()
    return { outcome: 'unavailable', reason, durationMs: 2, observedAt }
  }
  return sourceKind === 'triggered-network-response'
    ? { routeId: routeId as 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER', sourceKind, observeAfterTrigger: read } as CommentRouteSource | ReplyRouteSource
    : { routeId: routeId as Exclude<StructuredCommentRouteId, 'DY-COMMENT-TRIGGER' | 'DY-REPLY-TRIGGER'>, sourceKind, readPage: read } as CommentRouteSource | ReplyRouteSource
}

function statusSource(
  routeId: CommentRouteId | ReplyRouteId,
  endpoint: 'comment-list' | 'comment-reply-list',
  httpStatus: number,
  retryAfterMs: number | null = null
): CommentRouteSource | ReplyRouteSource {
  const base = payloadSource(routeId, endpoint, () => ({}))
  const read = async (input: ReadInput): Promise<StructuredCommentRouteReadResult> => ({
    outcome: 'response', httpStatus, retryAfterMs,
    contentType: 'application/json', payload: {}, request: safeRequest(endpoint, input), durationMs: 3, observedAt
  })
  return 'observeAfterTrigger' in base ? { ...base, observeAfterTrigger: read } : { ...base, readPage: read }
}

function commentPages(): Record<string, unknown> {
  return structuredClone(commentFixture.networkCommentPages) as unknown as Record<string, unknown>
}

function replyPages(): Record<string, unknown> {
  return structuredClone(commentFixture.networkReplyPages) as unknown as Record<string, unknown>
}

function rootAdapter(pages = commentPages()): DouyinCommentListAdapter {
  return new DouyinCommentListAdapter([
    payloadSource('DY-COMMENT-NETWORK', 'comment-list', ({ cursor }) => pages[cursor]) as CommentRouteSource
  ])
}

function replyAdapter(pages = replyPages()): DouyinCommentReplyAdapter {
  return new DouyinCommentReplyAdapter([
    payloadSource('DY-REPLY-NETWORK', 'comment-reply-list', ({ cursor }) => pages[cursor]) as ReplyRouteSource
  ])
}

describe('R5 root comments and replies structured adapters', () => {
  it('collects bounded root-comment pages with native cid and a proof bound to aweme_id', async () => {
    const page = await rootAdapter().collect({ workId, pageSize: 20, maxPages: 3 }, context())

    expect(page.completion).toBe('complete')
    expect(page.pagination).toEqual({
      cursorIn: '0', cursorOut: '40', hasMore: false, reportedTotal: 3, returnedCount: 3, duplicateCount: 0
    })
    expect(page.items.map((item) => item.commentId)).toEqual([
      'synthetic-comment-3001', 'synthetic-comment-3002', 'synthetic-comment-3003'
    ])
    expect(page.items.every((item) => item.commentIdKind === 'native-cid' && item.workId === workId)).toBe(true)
    expect(page.items[0]).toMatchObject({ parentCommentId: null, rootCommentId: null, likeCount: 7, replyCount: 2 })
    expect(page.items[2]).toMatchObject({ likeCount: null, replyCount: null })
    expect(page.sourceProof).toMatchObject({
      contract: 'douyin-comment-list-structured-proof/v2',
      routeId: 'DY-COMMENT-NETWORK',
      sourceKind: 'network-response',
      endpointKind: 'comment-list',
      targetWorkId: workId,
      requestTargetWorkId: workId,
      targetWorkIdSourcePath: 'request.aweme_id',
      commentIds: page.items.map((item) => item.commentId),
      returnedIds: page.items.map((item) => item.commentId),
      hasMore: false,
      reportedTotal: 3
    })
    expect(page.items.map(assertNormalizedCommentIsNative)).toHaveLength(3)
    expect(JSON.stringify(page)).not.toMatch(/must-not-enter|private_token|authorization|raw_headers|cookie|X-Bogus/)
  })

  it('collects replies only when request comment_id and each root/parent relationship agree', async () => {
    const page = await replyAdapter().collect({ workId, rootCommentId }, context())

    expect(page.items.map((item) => item.commentId)).toEqual(['synthetic-reply-3001', 'synthetic-reply-3002'])
    expect(page.items.map((item) => [item.rootCommentId, item.parentCommentId])).toEqual([
      [rootCommentId, rootCommentId],
      [rootCommentId, 'synthetic-reply-3001']
    ])
    expect(page.sourceProof).toMatchObject({
      contract: 'douyin-comment-reply-structured-proof/v2',
      routeId: 'DY-REPLY-NETWORK',
      targetWorkId: workId,
      requestTargetWorkId: workId,
      targetRootCommentId: rootCommentId,
      requestTargetRootCommentId: rootCommentId,
      targetRootCommentIdSourcePath: 'request.comment_id'
    })
    expect(page.items.map(assertNormalizedCommentIsNative)).toHaveLength(2)
    expect(JSON.stringify(page)).not.toMatch(/must-not-enter|session_token|X-Bogus/)
  })

  it('falls back to bounded embedded root comments without claiming request metadata', async () => {
    const page = await new DouyinCommentListAdapter([
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource,
      payloadSource('DY-COMMENT-EMBEDDED', 'comment-list', () => commentFixture.embeddedComments) as CommentRouteSource
    ]).collect({ workId }, context())

    expect(page.items.map((item) => item.commentId)).toEqual(['synthetic-comment-embedded'])
    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-COMMENT-EMBEDDED', sourceKind: 'embedded-json',
      requestTargetWorkId: null, requestParameters: [], targetWorkIdSourcePath: 'embedded.comment_context.aweme_id',
      routeTrace: [
        { routeId: 'DY-COMMENT-NETWORK', status: 'not-observed' },
        { routeId: 'DY-COMMENT-EMBEDDED', status: 'success' }
      ]
    })
  })

  it('falls back to bounded embedded replies with an independently matching embedded root', async () => {
    const page = await new DouyinCommentReplyAdapter([
      unavailableSource('DY-REPLY-NETWORK', 'not-observed') as ReplyRouteSource,
      payloadSource('DY-REPLY-EMBEDDED', 'comment-reply-list', () => commentFixture.embeddedReplies) as ReplyRouteSource
    ]).collect({ workId, rootCommentId }, context())

    expect(page.items.map((item) => item.commentId)).toEqual(['synthetic-reply-embedded'])
    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-REPLY-EMBEDDED', sourceKind: 'embedded-json', requestParameters: [],
      requestTargetWorkId: null, requestTargetRootCommentId: null,
      targetRootCommentIdSourcePath: 'embedded.reply_context.cid'
    })
  })

  it('reaches TRIGGER only after registered fallbacks and accepts only its observed Network response', async () => {
    const page = await new DouyinCommentListAdapter([
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource,
      payloadSource('DY-COMMENT-EMBEDDED', 'comment-list', () => commentFixture.schemaChanged) as CommentRouteSource,
      unavailableSource('DY-COMMENT-INPAGE', 'signature-unavailable') as CommentRouteSource,
      payloadSource('DY-COMMENT-TRIGGER', 'comment-list', () => commentFixture.verifiedEmptyComments) as CommentRouteSource
    ]).collect({ workId }, context())

    expect(page.completion).toBe('verified-empty')
    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-COMMENT-TRIGGER', sourceKind: 'triggered-network-response',
      routeTrace: [
        { routeId: 'DY-COMMENT-NETWORK', status: 'not-observed' },
        { routeId: 'DY-COMMENT-EMBEDDED', status: 'schema-changed' },
        { routeId: 'DY-COMMENT-INPAGE', status: 'signature-unavailable' },
        { routeId: 'DY-COMMENT-TRIGGER', status: 'success' }
      ]
    })
  })

  it('rejects TRIGGER output that was not independently observed by Network Observer', async () => {
    const trigger = payloadSource('DY-COMMENT-TRIGGER', 'comment-list', () => commentFixture.verifiedEmptyComments) as Extract<CommentRouteSource, { routeId: 'DY-COMMENT-TRIGGER' }>
    const original = trigger.observeAfterTrigger
    trigger.observeAfterTrigger = async (input) => {
      const result = await original(input)
      if (result.outcome === 'response') delete result.observationKind
      return result
    }
    const outcome = await new DouyinCommentListAdapter([trigger]).collectOutcome({ workId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'DOM_ONLY_SOURCE_REJECTED' } })
  })

  it('stops with zero comments when every structured root route is unavailable', async () => {
    const outcome = await new DouyinCommentListAdapter([
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing') as CommentRouteSource,
      unavailableSource('DY-COMMENT-INPAGE', 'signature-unavailable') as CommentRouteSource,
      unavailableSource('DY-COMMENT-TRIGGER', 'not-observed') as CommentRouteSource
    ]).collectOutcome({ workId }, context())

    expect(outcome).toMatchObject({
      ok: false, completion: 'failed', items: [], issue: { code: 'NOT_OBSERVED' },
      routeTrace: [
        { routeId: 'DY-COMMENT-NETWORK', status: 'not-observed' },
        { routeId: 'DY-COMMENT-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-COMMENT-INPAGE', status: 'signature-unavailable' },
        { routeId: 'DY-COMMENT-TRIGGER', status: 'not-observed' },
        { routeId: 'DY-COMMENT-STOP', status: 'stopped' }
      ]
    })
  })

  it('stops with zero replies when every structured reply route is unavailable', async () => {
    const outcome = await new DouyinCommentReplyAdapter([
      unavailableSource('DY-REPLY-NETWORK', 'not-observed') as ReplyRouteSource,
      unavailableSource('DY-REPLY-EMBEDDED', 'schema-missing') as ReplyRouteSource,
      unavailableSource('DY-REPLY-INPAGE', 'signature-unavailable') as ReplyRouteSource,
      unavailableSource('DY-REPLY-TRIGGER', 'not-observed') as ReplyRouteSource
    ]).collectOutcome({ workId, rootCommentId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'NOT_OBSERVED' } })
    if (outcome.ok) throw new Error('expected a failed reply outcome')
    expect(outcome.routeTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeId: 'DY-REPLY-STOP', status: 'stopped' })
    ]))
  })

  it('accepts verified-empty root comments only with total=0, has_more=false, and zero items', async () => {
    const page = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.verifiedEmptyComments) as CommentRouteSource
    ]).collect({ workId }, context())
    expect(page).toMatchObject({
      completion: 'verified-empty', items: [],
      pagination: { hasMore: false, reportedTotal: 0, returnedCount: 0 },
      sourceProof: { commentIds: [], returnedIds: [], hasMore: false, reportedTotal: 0 }
    })

    const invalid = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.emptyWithoutTotal) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(invalid).toMatchObject({ ok: false, items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it('accepts independently closed verified-empty replies', async () => {
    const page = await new DouyinCommentReplyAdapter([
      payloadSource('DY-REPLY-NETWORK', 'comment-reply-list', () => commentFixture.verifiedEmptyReplies) as ReplyRouteSource
    ]).collect({ workId, rootCommentId }, context())

    expect(page).toMatchObject({ completion: 'verified-empty', items: [], pagination: { reportedTotal: 0, hasMore: false } })
    expect(page.sourceProof).toMatchObject({ targetRootCommentId: rootCommentId, commentIds: [] })
  })

  it('classifies explicit comments-disabled separately and never invokes fallback', async () => {
    let fallbackCalls = 0
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.commentsDisabled) as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as CommentRouteSource
    ]).collectOutcome({ workId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'COMMENTS_DISABLED' } })
    expect(fallbackCalls).toBe(0)
  })

  it('rejects a cross-work root comment with zero candidates', async () => {
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.wrongWorkComment) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'TARGET_ID_MISMATCH' } })
  })

  it.each([
    ['wrong root', commentFixture.wrongRootReply],
    ['missing parent', commentFixture.missingParentReply]
  ])('rejects reply %s relationships with zero candidates', async (_label, payload) => {
    const outcome = await new DouyinCommentReplyAdapter([
      payloadSource('DY-REPLY-NETWORK', 'comment-reply-list', () => payload) as ReplyRouteSource
    ]).collectOutcome({ workId, rootCommentId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'TARGET_ID_MISMATCH' } })
  })

  it('rejects reply-shaped data returned by the root-comment endpoint', async () => {
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.rootWithReplyRelation) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'TARGET_ID_MISMATCH' } })
  })

  it.each([
    ['cursor loop', commentFixture.cursorLoop, 'CURSOR_LOOP'],
    ['empty page with has_more', commentFixture.emptyHasMore, 'PAGINATION_PROTOCOL_ERROR']
  ])('rejects %s as a terminal pagination failure', async (_label, payload, code) => {
    let fallbackCalls = 0
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => payload) as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code } })
    expect(fallbackCalls).toBe(0)
  })

  it('rejects a native cid repeated across pages', async () => {
    const pages = commentPages()
    const first = pages['0'] as { comments: unknown[] }
    const second = pages['20'] as { comments: unknown[] }
    second.comments = [structuredClone(first.comments[0])]
    const outcome = await rootAdapter(pages).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'DUPLICATE_NATIVE_ID' } })
  })

  it('rejects pagination that remains open at maxPages', async () => {
    const outcome = await rootAdapter().collectOutcome({ workId, maxPages: 1 }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it.each([401, 403])('treats HTTP %i as LOGIN_REQUIRED and never invokes fallback', async (status) => {
    let fallbackCalls = 0
    const outcome = await new DouyinCommentListAdapter([
      statusSource('DY-COMMENT-NETWORK', 'comment-list', status) as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'LOGIN_REQUIRED', httpStatus: status } })
    expect(fallbackCalls).toBe(0)
  })

  it('treats HTTP 429 as RATE_LIMITED and never invokes fallback', async () => {
    let fallbackCalls = 0
    const outcome = await new DouyinCommentReplyAdapter([
      statusSource('DY-REPLY-NETWORK', 'comment-reply-list', 429, 2_500) as ReplyRouteSource,
      unavailableSource('DY-REPLY-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as ReplyRouteSource
    ]).collectOutcome({ workId, rootCommentId }, context())
    expect(outcome).toMatchObject({
      ok: false, items: [], issue: { code: 'RATE_LIMITED', httpStatus: 429, retryAfterMs: 2_500, safeContext: {} }
    })
    expect(fallbackCalls).toBe(0)
  })

  it('classifies a nonzero platform status separately', async () => {
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => ({ status_code: 8, comments: [], cursor: 0, has_more: 0, total: 0 })) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'API_STATUS_ERROR' } })
  })

  it.each([
    ['wrong path', (request: StructuredCommentReadRequest) => { request.path = '/aweme/v1/web/recommend/' }],
    ['unknown parameter', (request: StructuredCommentReadRequest) => { request.parameters.device_id = 'secret-device' }],
    ['sensitive parameter', (request: StructuredCommentReadRequest) => { request.parameters['X-Bogus'] = 'secret-signature' }],
    ['sensitive header', (request: StructuredCommentReadRequest) => { request.headers.Authorization = 'Bearer secret-token' }]
  ])('rejects %s without leaking the input or invoking fallback', async (_label, mutate) => {
    let fallbackCalls = 0
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.verifiedEmptyComments, (input) => {
        const request = safeRequest('comment-list', input)
        mutate(request)
        return request
      }) as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'UNSAFE_REQUEST', safeContext: {} } })
    expect(JSON.stringify(outcome)).not.toMatch(/secret-device|secret-signature|secret-token|Bearer/)
    expect(fallbackCalls).toBe(0)
  })

  it('rejects a reply request whose comment_id differs from the requested root', async () => {
    const outcome = await new DouyinCommentReplyAdapter([
      payloadSource('DY-REPLY-NETWORK', 'comment-reply-list', () => commentFixture.verifiedEmptyReplies, (input) => {
        const request = safeRequest('comment-reply-list', input)
        request.parameters.comment_id = 'synthetic-other-root'
        return request
      }) as ReplyRouteSource
    ]).collectOutcome({ workId, rootCommentId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'TARGET_ID_MISMATCH' } })
  })

  it('does not switch routes after a structured route changes schema mid-pagination', async () => {
    const pages = commentPages()
    let fallbackCalls = 0
    const outcome = await new DouyinCommentListAdapter([
      payloadSource('DY-COMMENT-NETWORK', 'comment-list', ({ cursor }) => cursor === '0' ? pages['0'] : commentFixture.schemaChanged) as CommentRouteSource,
      unavailableSource('DY-COMMENT-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 }) as CommentRouteSource
    ]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'SCHEMA_CHANGED', phase: 'validation' } })
    expect(fallbackCalls).toBe(0)
  })

  it('does not copy a thrown browser diagnostic containing credentials into a persisted issue', async () => {
    const source = payloadSource('DY-COMMENT-NETWORK', 'comment-list', () => commentFixture.verifiedEmptyComments) as CommentRouteSource & { readPage: (input: ReadInput) => Promise<StructuredCommentRouteReadResult> }
    source.readPage = async () => { throw new Error('https://www.douyin.com/path?X-Bogus=secret Cookie=session-secret') }
    const outcome = await new DouyinCommentListAdapter([source]).collectOutcome({ workId }, context())
    expect(outcome).toMatchObject({
      ok: false, items: [], issue: { code: 'HTTP_TRANSIENT', message: '结构化评论路线读取失败', safeContext: {} }
    })
    expect(JSON.stringify(outcome)).not.toMatch(/X-Bogus|session-secret|https:\/\//)
  })

  it('binds proof route, hash, work, root, returned IDs, and relationships in strict mode', async () => {
    const rootPage = await rootAdapter().collect({ workId }, context())
    const rootProof = rootPage.sourceProof
    expect(() => douyinCommentListStructuredProofSchema.parse(rootProof)).not.toThrow()
    expect(() => douyinCommentListStructuredProofSchema.parse({ ...rootProof, responseProjectionSha256: 'f'.repeat(64) })).not.toThrow()
    expect(() => douyinCommentListStructuredProofSchema.parse({ ...rootProof, routeId: 'DY-COMMENT-EMBEDDED' })).toThrow(/route/)
    expect(() => douyinCommentListStructuredProofSchema.parse({
      ...rootProof,
      requestParameters: [...rootProof.requestParameters, { name: 'sec_user_id', value: 'synthetic-unrelated-target' }]
    })).toThrow(/allowlist/)
    expect(() => douyinCommentListStructuredProofSchema.parse({
      ...rootProof,
      requestParameters: rootProof.requestParameters.filter((entry) => entry.name !== 'count')
    })).toThrow(/require/)
    expect(() => douyinCommentListStructuredProofSchema.parse({
      ...rootProof,
      routeTrace: rootProof.routeTrace.map((entry) => ({ ...entry, occurredAt: '2026-09-06T06:00:01.000Z' }))
    })).toThrow(/time/)
    expect(() => douyinCommentListStructuredProofSchema.parse({ ...rootProof, returnedIds: rootProof.returnedIds.slice(1) })).toThrow(/exactly/)
    expect(() => douyinCommentListStructuredProofSchema.parse({
      ...rootProof,
      commentBindings: rootProof.commentBindings.map((binding, index) => index === 0 ? { ...binding, workId: 'synthetic-other-work' } : binding)
    })).toThrow(/TARGET_ID_MISMATCH/)

    const replyPage = await replyAdapter().collect({ workId, rootCommentId }, context())
    const replyProof = replyPage.sourceProof
    expect(() => douyinCommentReplyStructuredProofSchema.parse(replyProof)).not.toThrow()
    expect(() => douyinCommentReplyStructuredProofSchema.parse({ ...replyProof, requestTargetRootCommentId: 'synthetic-other-root' })).toThrow(/TARGET_ID_MISMATCH/)
    expect(() => douyinCommentReplyStructuredProofSchema.parse({
      ...replyProof,
      requestParameters: replyProof.requestParameters.filter((entry) => entry.name !== 'comment_id')
    })).toThrow(/TARGET_ID_MISMATCH/)
    expect(() => douyinCommentReplyStructuredProofSchema.parse({
      ...replyProof,
      commentBindings: replyProof.commentBindings.map((binding, index) => index === 0 ? { ...binding, parentCommentId: null } : binding)
    })).toThrow(/TARGET_ID_MISMATCH/)
  })

  it('registers exactly the R5 comment/reply routes as E2 synthetic-only GET policies', () => {
    expect(Object.keys(COMMENT_ROUTE_REGISTRY)).toEqual([
      'DY-COMMENT-NETWORK', 'DY-COMMENT-EMBEDDED', 'DY-COMMENT-INPAGE', 'DY-COMMENT-TRIGGER', 'DY-COMMENT-STOP',
      'DY-REPLY-NETWORK', 'DY-REPLY-EMBEDDED', 'DY-REPLY-INPAGE', 'DY-REPLY-TRIGGER', 'DY-REPLY-STOP'
    ])
    expect(Object.values(COMMENT_ROUTE_REGISTRY).every((route) => route.evidenceLevel === 'E2-doc')).toBe(true)
    expect(Object.values(COMMENT_ROUTE_REGISTRY).every((route) => route.allowedMethods[0] === 'GET' && !route.eligibleForFormalData)).toBe(true)
  })

  it('rejects unordered, duplicate, or mismatched route source declarations', () => {
    expect(() => new DouyinCommentListAdapter([
      unavailableSource('DY-COMMENT-INPAGE', 'signature-unavailable') as CommentRouteSource,
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource
    ])).toThrow(/ordered/)
    expect(() => new DouyinCommentListAdapter([
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource,
      unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as CommentRouteSource
    ])).toThrow(/unique/)
    const mismatched = unavailableSource('DY-COMMENT-NETWORK', 'not-observed') as Extract<CommentRouteSource, { routeId: 'DY-COMMENT-NETWORK' }>
    Object.assign(mismatched, { sourceKind: 'page-context-fetch' })
    expect(() => new DouyinCommentListAdapter([mismatched])).toThrow(/sourceKind/)
  })
})
