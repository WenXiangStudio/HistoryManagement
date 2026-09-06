import { describe, expect, it } from 'vitest'
import followingFixture from '../shared/fixtures/douyin-following-pages.mock.json'
import type { PlatformAdapterContext } from '../shared/platformAdapter'
import {
  DouyinFollowingAdapter,
  type FollowingReadRequest,
  type FollowingRouteId,
  type FollowingRouteReadResult,
  type FollowingRouteSource,
  type FollowingSourceKind,
  type FollowingUnavailableReason
} from './douyinFollowingAdapter'

const observedAt = '2026-09-06T02:00:00.000Z'
const ownerAccountId = followingFixture.ownerAccountId

const sourceKinds: Record<FollowingRouteId, FollowingSourceKind> = {
  'DY-FOLLOW-NETWORK': 'network-response',
  'DY-FOLLOW-EMBEDDED': 'embedded-json',
  'DY-FOLLOW-INPAGE': 'page-context-fetch'
}

function adapterContext(): PlatformAdapterContext {
  return {
    browserOrigin: 'https://www.douyin.com',
    sessionKind: 'browser-page',
    signal: new AbortController().signal,
    now: () => new Date(observedAt)
  }
}

function safeRequest(input: { ownerAccountId: string; cursor: string; count: number }): FollowingReadRequest {
  return {
    method: 'GET',
    path: '/aweme/v1/web/user/following/list/',
    parameters: {
      sec_user_id: input.ownerAccountId,
      cursor: input.cursor,
      count: input.count
    },
    headers: { accept: 'application/json' }
  }
}

function responseSource(
  routeId: FollowingRouteId,
  read: FollowingRouteSource['readPage']
): FollowingRouteSource {
  return { routeId, sourceKind: sourceKinds[routeId], readPage: read }
}

function payloadSource(
  routeId: FollowingRouteId,
  payloadForCursor: (cursor: string) => unknown,
  requestForPage?: (input: { ownerAccountId: string; cursor: string; count: number }) => FollowingReadRequest | null
): FollowingRouteSource {
  return responseSource(routeId, async (input) => ({
    outcome: 'response',
    httpStatus: 200,
    contentType: routeId === 'DY-FOLLOW-EMBEDDED' ? null : 'application/json; charset=utf-8',
    payload: structuredClone(payloadForCursor(input.cursor)),
    request: requestForPage ? requestForPage(input) : routeId === 'DY-FOLLOW-EMBEDDED' ? null : safeRequest(input),
    durationMs: 7,
    observedAt
  }))
}

function unavailableSource(
  routeId: FollowingRouteId,
  reason: FollowingUnavailableReason,
  onRead?: () => void
): FollowingRouteSource {
  return responseSource(routeId, async () => {
    onRead?.()
    return { outcome: 'unavailable', reason, durationMs: 3, observedAt }
  })
}

function statusSource(routeId: FollowingRouteId, httpStatus: number, retryAfterMs: number | null = null): FollowingRouteSource {
  return responseSource(routeId, async (input) => ({
    outcome: 'response',
    httpStatus,
    retryAfterMs,
    contentType: 'application/json',
    payload: {},
    request: safeRequest(input),
    durationMs: 5,
    observedAt
  }))
}

function networkPages(): Record<string, unknown> {
  return structuredClone(followingFixture.networkPages) as unknown as Record<string, unknown>
}

describe('R3 Douyin structured following adapter', () => {
  it('collects a bounded two-page Network fixture and emits only proof plus whitelist projection data', async () => {
    const pages = networkPages()
    const requestedCursors: string[] = []
    const source = payloadSource('DY-FOLLOW-NETWORK', (cursor) => {
      requestedCursors.push(cursor)
      return pages[cursor]
    })
    const page = await new DouyinFollowingAdapter([source]).collect(
      { ownerAccountId, pageSize: 20, maxPages: 3 },
      adapterContext()
    )

    expect(requestedCursors).toEqual(['0', '20'])
    expect(page.completion).toBe('complete')
    expect(page.pagination).toMatchObject({ cursorIn: '0', cursorOut: '40', hasMore: false, reportedTotal: 3, returnedCount: 3 })
    expect(page.items.map((item) => item.creatorId)).toEqual([
      'synthetic-creator-1001',
      'synthetic-creator-1002',
      'synthetic-creator-1003'
    ])
    expect(page.sourceProof).toMatchObject({
      contract: 'douyin-following-structured-proof/v2',
      routeId: 'DY-FOLLOW-NETWORK',
      sourceKind: 'network-response',
      ownerAccountId,
      requestTargetCreatorId: ownerAccountId,
      creatorIds: page.items.map((item) => item.creatorId),
      returnedIds: page.items.map((item) => item.creatorId),
      hasMore: false,
      reportedTotal: 3
    })
    const serialized = JSON.stringify(page)
    expect(serialized).not.toMatch(/must-not-enter|private_token|debug_cookie|authorization|X-Bogus/)
    expect(serialized).not.toContain('https://www.douyin.com/aweme/')
  })

  it('falls back from an unobserved Network route to a bounded nested embedded-state route', async () => {
    const page = await new DouyinFollowingAdapter([
      unavailableSource('DY-FOLLOW-NETWORK', 'not-observed'),
      payloadSource('DY-FOLLOW-EMBEDDED', () => followingFixture.embeddedState)
    ]).collect({ ownerAccountId }, adapterContext())

    expect(page.items.map((item) => item.creatorId)).toEqual(['synthetic-embedded-creator'])
    expect(page.sourceProof).toMatchObject({
      contract: 'douyin-following-structured-proof/v2',
      routeId: 'DY-FOLLOW-EMBEDDED',
      sourceKind: 'embedded-json',
      requestTargetCreatorId: null,
      requestParameters: [],
      routeTrace: [
        { routeId: 'DY-FOLLOW-NETWORK', status: 'not-observed' },
        { routeId: 'DY-FOLLOW-EMBEDDED', status: 'success' }
      ]
    })
  })

  it('falls back through missing/changing Network and embedded schemas to INPAGE', async () => {
    const page = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => followingFixture.schemaChanged),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing'),
      payloadSource('DY-FOLLOW-INPAGE', () => followingFixture.networkPages['20'])
    ]).collect({ ownerAccountId }, adapterContext())

    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-FOLLOW-INPAGE',
      sourceKind: 'page-context-fetch',
      routeTrace: [
        { routeId: 'DY-FOLLOW-NETWORK', status: 'schema-changed' },
        { routeId: 'DY-FOLLOW-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-FOLLOW-INPAGE', status: 'success' }
      ]
    })
  })

  it('stops with zero creators when every structured route is unavailable', async () => {
    const adapter = new DouyinFollowingAdapter([
      unavailableSource('DY-FOLLOW-NETWORK', 'not-observed'),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing'),
      unavailableSource('DY-FOLLOW-INPAGE', 'signature-unavailable')
    ])
    const outcome = await adapter.collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({
      ok: false,
      completion: 'failed',
      items: [],
      issue: { code: 'SIGNATURE_UNAVAILABLE' },
      routeTrace: [
        { routeId: 'DY-FOLLOW-NETWORK', status: 'not-observed' },
        { routeId: 'DY-FOLLOW-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-FOLLOW-INPAGE', status: 'signature-unavailable' },
        { routeId: 'DY-FOLLOW-STOP', status: 'stopped' }
      ]
    })
    await expect(adapter.collect({ ownerAccountId }, adapterContext())).rejects.toThrow(/SIGNATURE_UNAVAILABLE/)
  })

  it('accepts verified-empty only with total=0, has_more=false, and zero items', async () => {
    const page = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => followingFixture.verifiedEmpty)
    ]).collect({ ownerAccountId }, adapterContext())

    expect(page).toMatchObject({
      completion: 'verified-empty',
      items: [],
      pagination: { hasMore: false, reportedTotal: 0, returnedCount: 0 },
      sourceProof: { hasMore: false, reportedTotal: 0, creatorIds: [] }
    })

    const outcome = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => followingFixture.emptyWithoutTotal)
    ]).collectOutcome({ ownerAccountId }, adapterContext())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it.each([
    ['cursor loop', followingFixture.cursorLoop, 'CURSOR_LOOP'],
    ['empty page with has_more', followingFixture.emptyHasMore, 'PAGINATION_PROTOCOL_ERROR']
  ])('rejects %s as a terminal pagination failure', async (_label, payload, code) => {
    let fallbackCalls = 0
    const outcome = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => payload),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, completion: 'failed', items: [], issue: { code } })
    expect(fallbackCalls).toBe(0)
  })

  it('rejects a creator ID repeated across pages', async () => {
    const pages = networkPages()
    const first = pages['0'] as { user_list: unknown[] }
    const second = pages['20'] as { user_list: unknown[] }
    second.user_list = [structuredClone(first.user_list[0])]
    const outcome = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', (cursor) => pages[cursor])
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'DUPLICATE_NATIVE_ID' } })
  })

  it('rejects pagination that does not close inside maxPages', async () => {
    const outcome = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => followingFixture.networkPages['0'])
    ]).collectOutcome({ ownerAccountId, maxPages: 1 }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it.each([401, 403])('treats HTTP %i as LOGIN_REQUIRED and never invokes fallback', async (status) => {
    let fallbackCalls = 0
    const outcome = await new DouyinFollowingAdapter([
      statusSource('DY-FOLLOW-NETWORK', status),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'LOGIN_REQUIRED', httpStatus: status } })
    expect(fallbackCalls).toBe(0)
  })

  it('treats HTTP 429 as RATE_LIMITED, retains only retry timing, and never invokes fallback', async () => {
    let fallbackCalls = 0
    const outcome = await new DouyinFollowingAdapter([
      statusSource('DY-FOLLOW-NETWORK', 429, 2_500),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({
      ok: false,
      items: [],
      issue: { code: 'RATE_LIMITED', httpStatus: 429, retryAfterMs: 2_500, safeContext: {} }
    })
    expect(fallbackCalls).toBe(0)
  })

  it.each([
    ['wrong path', (request: FollowingReadRequest) => { request.path = '/aweme/v1/web/user/follower/list/' }],
    ['unknown parameter', (request: FollowingReadRequest) => { request.parameters.unknown_device_id = 'secret-device' }],
    ['sensitive parameter', (request: FollowingReadRequest) => { request.parameters['X-Bogus'] = 'secret-signature' }],
    ['sensitive header', (request: FollowingReadRequest) => { request.headers.Cookie = 'session=secret' }]
  ])('rejects %s before parsing or route fallback', async (_label, mutate) => {
    let fallbackCalls = 0
    const outcome = await new DouyinFollowingAdapter([
      payloadSource('DY-FOLLOW-NETWORK', () => followingFixture.verifiedEmpty, (input) => {
        const request = safeRequest(input)
        mutate(request)
        return request
      }),
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'UNSAFE_REQUEST', safeContext: {} } })
    expect(JSON.stringify(outcome)).not.toMatch(/secret-device|secret-signature|session=secret/)
    expect(fallbackCalls).toBe(0)
  })

  it('does not switch routes after a structured route fails during pagination', async () => {
    const pages = networkPages()
    let fallbackCalls = 0
    const network = responseSource('DY-FOLLOW-NETWORK', async (input): Promise<FollowingRouteReadResult> => {
      if (input.cursor === '20') {
        return { outcome: 'unavailable', reason: 'schema-changed', durationMs: 4, observedAt }
      }
      return {
        outcome: 'response',
        httpStatus: 200,
        contentType: 'application/json',
        payload: pages[input.cursor],
        request: safeRequest(input),
        durationMs: 4,
        observedAt
      }
    })
    const outcome = await new DouyinFollowingAdapter([
      network,
      unavailableSource('DY-FOLLOW-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'SCHEMA_CHANGED', phase: 'pagination' } })
    expect(fallbackCalls).toBe(0)
  })

  it('does not copy a thrown browser diagnostic containing credentials into a persisted issue', async () => {
    const source = responseSource('DY-FOLLOW-NETWORK', async () => {
      throw new Error('https://www.douyin.com/path?X-Bogus=secret Cookie=session-secret')
    })
    const outcome = await new DouyinFollowingAdapter([source]).collectOutcome({ ownerAccountId }, adapterContext())

    expect(outcome).toMatchObject({
      ok: false,
      items: [],
      issue: { code: 'HTTP_TRANSIENT', message: '结构化关注路线读取失败', safeContext: {} }
    })
    expect(JSON.stringify(outcome)).not.toMatch(/X-Bogus|session-secret|https:\/\//)
  })
})
