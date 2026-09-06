import { describe, expect, it } from 'vitest'
import workFixture from '../shared/fixtures/douyin-work-pages-r4.mock.json'
import type { PlatformAdapterContext } from '../shared/platformAdapter'
import {
  DouyinCreatorWorksAdapter,
  DouyinWorkDetailAdapter,
  type CreatorWorkRouteId,
  type CreatorWorksRouteSource,
  type StructuredWorkReadRequest,
  type StructuredWorkUnavailableReason,
  type WorkDetailRouteId,
  type WorkDetailRouteSource
} from './douyinWorkAdapters'

const observedAt = '2026-09-06T04:00:00.000Z'
const creatorId = workFixture.creatorId

function context(): PlatformAdapterContext {
  return {
    browserOrigin: 'https://www.douyin.com',
    sessionKind: 'browser-page',
    signal: new AbortController().signal,
    now: () => new Date(observedAt)
  }
}

function listRequest(input: { creatorId: string; cursor: string; count: number }): StructuredWorkReadRequest {
  return {
    method: 'GET',
    path: '/aweme/v1/web/aweme/post/',
    parameters: { sec_user_id: input.creatorId, cursor: input.cursor, count: input.count },
    headers: { accept: 'application/json' }
  }
}

function detailRequest(input: { workId: string }): StructuredWorkReadRequest {
  return {
    method: 'GET',
    path: '/aweme/v1/web/aweme/detail/',
    parameters: { aweme_id: input.workId },
    headers: { accept: 'application/json' }
  }
}

function listSource(
  routeId: CreatorWorkRouteId,
  payload: (input: { creatorId: string; cursor: string; count: number }) => unknown,
  request?: (input: { creatorId: string; cursor: string; count: number }) => StructuredWorkReadRequest | null
): CreatorWorksRouteSource {
  const sourceKind = {
    'DY-WORKS-NETWORK': 'network-response',
    'DY-WORKS-EMBEDDED': 'embedded-json',
    'DY-WORKS-INPAGE': 'page-context-fetch'
  } as const
  return {
    routeId,
    sourceKind: sourceKind[routeId],
    readPage: async (input) => ({
      outcome: 'response',
      httpStatus: 200,
      contentType: routeId === 'DY-WORKS-EMBEDDED' ? null : 'application/json; charset=utf-8',
      payload: structuredClone(payload(input)),
      request: request ? request(input) : routeId === 'DY-WORKS-EMBEDDED' ? null : listRequest(input),
      durationMs: 8,
      observedAt
    })
  }
}

function detailSource(
  routeId: WorkDetailRouteId,
  payload: (input: { workId: string; expectedCreatorId: string }) => unknown,
  request?: (input: { workId: string; expectedCreatorId: string }) => StructuredWorkReadRequest | null
): WorkDetailRouteSource {
  const sourceKind = {
    'DY-DETAIL-NETWORK': 'network-response',
    'DY-DETAIL-EMBEDDED': 'embedded-json',
    'DY-DETAIL-INPAGE': 'page-context-fetch'
  } as const
  return {
    routeId,
    sourceKind: sourceKind[routeId],
    readDetail: async (input) => ({
      outcome: 'response',
      httpStatus: 200,
      contentType: routeId === 'DY-DETAIL-EMBEDDED' ? null : 'application/json',
      payload: structuredClone(payload(input)),
      request: request ? request(input) : routeId === 'DY-DETAIL-EMBEDDED' ? null : detailRequest(input),
      durationMs: 6,
      observedAt
    })
  }
}

function unavailableListSource(routeId: CreatorWorkRouteId, reason: StructuredWorkUnavailableReason, onRead?: () => void): CreatorWorksRouteSource {
  const base = listSource(routeId, () => ({}))
  return {
    ...base,
    readPage: async () => {
      onRead?.()
      return { outcome: 'unavailable', reason, durationMs: 2, observedAt }
    }
  }
}

function unavailableDetailSource(routeId: WorkDetailRouteId, reason: StructuredWorkUnavailableReason, onRead?: () => void): WorkDetailRouteSource {
  const base = detailSource(routeId, () => ({}))
  return {
    ...base,
    readDetail: async () => {
      onRead?.()
      return { outcome: 'unavailable', reason, durationMs: 2, observedAt }
    }
  }
}

function networkListPages(): Record<string, unknown> {
  return structuredClone(workFixture.networkListPages) as unknown as Record<string, unknown>
}

function details(): Record<string, unknown> {
  return structuredClone(workFixture.details) as unknown as Record<string, unknown>
}

function networkDetailAdapter(detailPayloads = details()): DouyinWorkDetailAdapter {
  return new DouyinWorkDetailAdapter([
    detailSource('DY-DETAIL-NETWORK', ({ workId }) => detailPayloads[workId])
  ])
}

function networkWorksAdapter(
  pages = networkListPages(),
  detailAdapter = networkDetailAdapter()
): DouyinCreatorWorksAdapter {
  return new DouyinCreatorWorksAdapter([
    listSource('DY-WORKS-NETWORK', ({ cursor }) => pages[cursor])
  ], detailAdapter)
}

describe('R4 creator works, detail verification, and statistics projection', () => {
  it('collects multiple /aweme/post/ pages and independently verifies every work through detail', async () => {
    const page = await networkWorksAdapter().collect({
      followedCreatorId: creatorId,
      profileRouteCreatorId: creatorId,
      pageSize: 20,
      maxPages: 3
    }, context())

    expect(page.completion).toBe('complete')
    expect(page.pagination).toMatchObject({ cursorIn: '0', cursorOut: '40', hasMore: false, reportedTotal: 3, returnedCount: 3 })
    expect(page.items.map((item) => item.workId)).toEqual(['synthetic-work-2001', 'synthetic-work-2002', 'synthetic-work-2003'])
    expect(page.sourceProof).toMatchObject({
      contract: 'douyin-creator-works-structured-proof/v2',
      routeId: 'DY-WORKS-NETWORK',
      sourceKind: 'network-response',
      followedCreatorId: creatorId,
      profileRouteCreatorId: creatorId,
      requestTargetCreatorId: creatorId,
      targetCreatorIdSourcePath: 'request.sec_user_id',
      workIds: ['synthetic-work-2001', 'synthetic-work-2002', 'synthetic-work-2003'],
      authorBindings: [
        { workId: 'synthetic-work-2001', authorId: creatorId },
        { workId: 'synthetic-work-2002', authorId: creatorId },
        { workId: 'synthetic-work-2003', authorId: creatorId }
      ]
    })
    for (const item of page.items) {
      expect(item.authorProof).toMatchObject({
        followedCreatorId: creatorId,
        profileRouteCreatorId: creatorId,
        requestTargetCreatorId: creatorId,
        observedWorkAuthorId: creatorId,
        observedWorkId: item.workId,
        routeId: 'DY-WORKS-NETWORK'
      })
      expect(item.detailVerification).toMatchObject({
        workId: item.workId,
        expectedCreatorId: creatorId,
        listObservation: { endpointKind: 'creator-work-list', authorId: creatorId },
        detailObservation: { endpointKind: 'work-detail', authorId: creatorId, routeId: 'DY-DETAIL-NETWORK' }
      })
    }
  })

  it('keeps list/detail statistics snapshots separate and never guesses formatted or invalid counts', async () => {
    const page = await networkWorksAdapter().collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())
    const video = page.items[0]
    const image = page.items[1]

    expect(video.statistics).toEqual({
      list: { likeCount: 10, commentCount: 2, collectCount: 3, shareCount: 1, playCount: 100 },
      detail: { likeCount: 12, commentCount: 3, collectCount: 3, shareCount: 1, playCount: 120 },
      changedFields: ['likeCount', 'commentCount', 'playCount']
    })
    expect(image.statistics.list).toEqual({ likeCount: null, commentCount: 4, collectCount: null, shareCount: 2, playCount: null })
    expect(image.statistics.detail).toEqual({ likeCount: 20, commentCount: 4, collectCount: 5, shareCount: 2, playCount: null })
    expect(image.statistics.changedFields).toEqual(['likeCount', 'collectCount'])
  })

  it('falls back from unobserved Network to bounded embedded list and detail state', async () => {
    const adapter = new DouyinCreatorWorksAdapter([
      unavailableListSource('DY-WORKS-NETWORK', 'not-observed'),
      listSource('DY-WORKS-EMBEDDED', () => workFixture.embeddedListState)
    ], new DouyinWorkDetailAdapter([
      unavailableDetailSource('DY-DETAIL-NETWORK', 'not-observed'),
      detailSource('DY-DETAIL-EMBEDDED', () => workFixture.embeddedDetailState)
    ]))
    const page = await adapter.collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(page.items).toHaveLength(1)
    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-WORKS-EMBEDDED',
      sourceKind: 'embedded-json',
      requestParameters: [],
      requestTargetCreatorId: creatorId,
      targetCreatorIdSourcePath: 'embedded.profile_user.uid'
    })
    expect(page.items[0].detailVerification.detailObservation).toMatchObject({
      routeId: 'DY-DETAIL-EMBEDDED',
      sourceKind: 'embedded-json'
    })
  })

  it('falls back through schema changes to INPAGE for both list and detail', async () => {
    const pages = networkListPages()
    const detailPayloads = details()
    const adapter = new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => workFixture.schemaChanged),
      unavailableListSource('DY-WORKS-EMBEDDED', 'schema-missing'),
      listSource('DY-WORKS-INPAGE', ({ cursor }) => pages[cursor])
    ], new DouyinWorkDetailAdapter([
      detailSource('DY-DETAIL-NETWORK', () => workFixture.schemaChanged),
      unavailableDetailSource('DY-DETAIL-EMBEDDED', 'schema-missing'),
      detailSource('DY-DETAIL-INPAGE', ({ workId }) => detailPayloads[workId])
    ]))
    const page = await adapter.collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(page.sourceProof).toMatchObject({
      routeId: 'DY-WORKS-INPAGE',
      routeTrace: [
        { routeId: 'DY-WORKS-NETWORK', status: 'schema-changed' },
        { routeId: 'DY-WORKS-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-WORKS-INPAGE', status: 'success' }
      ]
    })
    expect(page.items[0].detailVerification.detailObservation.routeTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeId: 'DY-DETAIL-NETWORK', status: 'schema-changed' }),
      expect.objectContaining({ routeId: 'DY-DETAIL-INPAGE', status: 'success' })
    ]))
  })

  it('rejects a recommended work whose structured author does not match the followed creator', async () => {
    let detailCalls = 0
    const detailAdapter = new DouyinWorkDetailAdapter([{
      ...unavailableDetailSource('DY-DETAIL-NETWORK', 'not-observed'),
      readDetail: async () => {
        detailCalls += 1
        return { outcome: 'unavailable', reason: 'not-observed', durationMs: 1, observedAt }
      }
    }])
    const outcome = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => workFixture.mixedRecommendation)
    ], detailAdapter).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'AUTHOR_PROOF_MISMATCH' } })
    expect(detailCalls).toBe(0)
  })

  it('rejects a self-filled profile creator before reading any route', async () => {
    let listCalls = 0
    const outcome = await new DouyinCreatorWorksAdapter([
      unavailableListSource('DY-WORKS-NETWORK', 'not-observed', () => { listCalls += 1 })
    ], networkDetailAdapter()).collectOutcome({
      followedCreatorId: creatorId,
      profileRouteCreatorId: 'synthetic-other-profile'
    }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'AUTHOR_PROOF_MISMATCH' } })
    expect(listCalls).toBe(0)
  })

  it.each([
    ['detail aweme_id mismatch', workFixture.wrongDetailWork, 'TARGET_ID_MISMATCH'],
    ['detail author mismatch', workFixture.wrongDetailAuthor, 'AUTHOR_PROOF_MISMATCH']
  ])('rejects %s and returns zero candidates', async (_label, badDetail, code) => {
    const pages = networkListPages()
    const firstPage = pages['0'] as { aweme_list: unknown[]; cursor: number; has_more: number; total: number }
    firstPage.aweme_list = [firstPage.aweme_list[0]]
    firstPage.cursor = 0
    firstPage.has_more = 0
    firstPage.total = 1
    const adapter = networkWorksAdapter(pages, new DouyinWorkDetailAdapter([
      detailSource('DY-DETAIL-NETWORK', () => badDetail)
    ]))
    const outcome = await adapter.collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, completion: 'failed', items: [], issue: { code } })
  })

  it('returns zero candidates and throws from collect when every structured list route fails', async () => {
    const adapter = new DouyinCreatorWorksAdapter([
      unavailableListSource('DY-WORKS-NETWORK', 'not-observed'),
      unavailableListSource('DY-WORKS-EMBEDDED', 'schema-missing'),
      unavailableListSource('DY-WORKS-INPAGE', 'signature-unavailable')
    ], networkDetailAdapter())
    const outcome = await adapter.collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({
      ok: false,
      items: [],
      issue: { code: 'SIGNATURE_UNAVAILABLE' },
      routeTrace: [
        { routeId: 'DY-WORKS-NETWORK', status: 'not-observed' },
        { routeId: 'DY-WORKS-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-WORKS-INPAGE', status: 'signature-unavailable' },
        { routeId: 'DY-WORKS-STOP', status: 'stopped' }
      ]
    })
    await expect(adapter.collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())).rejects.toThrow(/SIGNATURE_UNAVAILABLE/)
  })

  it('returns zero items and a STOP trace when every structured detail route fails', async () => {
    const adapter = new DouyinWorkDetailAdapter([
      unavailableDetailSource('DY-DETAIL-NETWORK', 'not-observed'),
      unavailableDetailSource('DY-DETAIL-EMBEDDED', 'schema-missing'),
      unavailableDetailSource('DY-DETAIL-INPAGE', 'signature-unavailable')
    ])
    const request = { workId: 'synthetic-work-2001', expectedCreatorId: creatorId }
    const outcome = await adapter.collectOutcome(request, context())

    expect(outcome).toMatchObject({
      ok: false,
      completion: 'failed',
      items: [],
      issue: { code: 'SIGNATURE_UNAVAILABLE', endpointKind: 'work-detail' },
      routeTrace: [
        { routeId: 'DY-DETAIL-NETWORK', status: 'not-observed' },
        { routeId: 'DY-DETAIL-EMBEDDED', status: 'schema-missing' },
        { routeId: 'DY-DETAIL-INPAGE', status: 'signature-unavailable' },
        { routeId: 'DY-DETAIL-STOP', status: 'stopped' }
      ]
    })
    await expect(adapter.collect(request, context())).rejects.toThrow(/SIGNATURE_UNAVAILABLE/)
  })

  it('accepts a verified-empty works list without calling the detail adapter', async () => {
    let detailCalls = 0
    const detailAdapter = new DouyinWorkDetailAdapter([{
      ...unavailableDetailSource('DY-DETAIL-NETWORK', 'not-observed'),
      readDetail: async () => {
        detailCalls += 1
        return { outcome: 'unavailable', reason: 'not-observed', durationMs: 1, observedAt }
      }
    }])
    const page = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => workFixture.verifiedEmpty)
    ], detailAdapter).collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(page).toMatchObject({ completion: 'verified-empty', items: [], pagination: { reportedTotal: 0, hasMore: false } })
    expect(detailCalls).toBe(0)
  })

  it.each([
    ['cursor loop', (page: Record<string, unknown>) => { page.cursor = 0; page.has_more = 1 }, 'CURSOR_LOOP'],
    ['empty page has_more', (page: Record<string, unknown>) => { page.aweme_list = []; page.cursor = 20; page.has_more = 1 }, 'PAGINATION_PROTOCOL_ERROR']
  ])('rejects %s as a terminal pagination error', async (_label, mutate, code) => {
    const page = structuredClone(workFixture.networkListPages['0']) as unknown as Record<string, unknown>
    mutate(page)
    const outcome = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => page)
    ], networkDetailAdapter()).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code } })
  })

  it('rejects duplicate native aweme_id values across pages', async () => {
    const pages = networkListPages()
    const first = pages['0'] as { aweme_list: unknown[] }
    const second = pages['20'] as { aweme_list: unknown[] }
    second.aweme_list = [structuredClone(first.aweme_list[0])]
    const outcome = await networkWorksAdapter(pages).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())
    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'DUPLICATE_NATIVE_ID' } })
  })

  it('does not switch list routes after a schema change interrupts an open pagination chain', async () => {
    const pages = networkListPages()
    let fallbackCalls = 0
    const outcome = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', ({ cursor }) => cursor === '0' ? pages['0'] : workFixture.schemaChanged),
      unavailableListSource('DY-WORKS-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ], networkDetailAdapter()).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, completion: 'failed', items: [], issue: { code: 'SCHEMA_CHANGED' } })
    expect(fallbackCalls).toBe(0)
  })

  it('rejects a list that remains open at maxPages instead of accepting a partial batch', async () => {
    const outcome = await networkWorksAdapter().collectOutcome({
      followedCreatorId: creatorId,
      profileRouteCreatorId: creatorId,
      maxPages: 1
    }, context())

    expect(outcome).toMatchObject({ ok: false, completion: 'failed', items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it('rejects an empty works list without an explicit reported total of zero', async () => {
    const emptyWithoutTotal = structuredClone(workFixture.verifiedEmpty) as Partial<typeof workFixture.verifiedEmpty>
    delete emptyWithoutTotal.total
    const outcome = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => emptyWithoutTotal)
    ], networkDetailAdapter()).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, completion: 'failed', items: [], issue: { code: 'PAGINATION_PROTOCOL_ERROR' } })
  })

  it.each([401, 403, 429])('does not fallback after terminal HTTP %i from the list route', async (httpStatus) => {
    let fallbackCalls = 0
    const network = listSource('DY-WORKS-NETWORK', () => ({}))
    network.readPage = async (input) => ({
      outcome: 'response', httpStatus, retryAfterMs: httpStatus === 429 ? 1500 : null,
      contentType: 'application/json', payload: {}, request: listRequest(input), durationMs: 2, observedAt
    })
    const outcome = await new DouyinCreatorWorksAdapter([
      network,
      unavailableListSource('DY-WORKS-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ], networkDetailAdapter()).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: httpStatus === 429 ? 'RATE_LIMITED' : 'LOGIN_REQUIRED' } })
    expect(fallbackCalls).toBe(0)
  })

  it.each([403, 429])('does not fallback after terminal HTTP %i from the detail route', async (httpStatus) => {
    let fallbackCalls = 0
    const network = detailSource('DY-DETAIL-NETWORK', () => ({}))
    network.readDetail = async (input) => ({
      outcome: 'response', httpStatus, retryAfterMs: httpStatus === 429 ? 1500 : null,
      contentType: 'application/json', payload: {}, request: detailRequest(input), durationMs: 2, observedAt
    })
    const outcome = await new DouyinWorkDetailAdapter([
      network,
      unavailableDetailSource('DY-DETAIL-EMBEDDED', 'schema-missing', () => { fallbackCalls += 1 })
    ]).collectOutcome({ workId: 'synthetic-work-2001', expectedCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: httpStatus === 429 ? 'RATE_LIMITED' : 'LOGIN_REQUIRED' } })
    expect(fallbackCalls).toBe(0)
  })

  it.each([
    ['wrong list path', (request: StructuredWorkReadRequest) => { request.path = '/aweme/v1/web/recommend/' }],
    ['unknown list parameter', (request: StructuredWorkReadRequest) => { request.parameters.device_id = 'secret-device' }],
    ['sensitive list header', (request: StructuredWorkReadRequest) => { request.headers.Authorization = 'Bearer secret-token' }]
  ])('rejects %s without persisting the sensitive diagnostic', async (_label, mutate) => {
    const outcome = await new DouyinCreatorWorksAdapter([
      listSource('DY-WORKS-NETWORK', () => workFixture.verifiedEmpty, (input) => {
        const request = listRequest(input)
        mutate(request)
        return request
      })
    ], networkDetailAdapter()).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'UNSAFE_REQUEST', safeContext: {} } })
    expect(JSON.stringify(outcome)).not.toMatch(/secret-device|secret-token|Bearer/)
  })

  it('rejects an unsafe detail request before creating independent verification', async () => {
    const pages = networkListPages()
    const firstPage = pages['0'] as { aweme_list: unknown[]; cursor: number; has_more: number; total: number }
    firstPage.aweme_list = [firstPage.aweme_list[0]]
    firstPage.cursor = 0
    firstPage.has_more = 0
    firstPage.total = 1
    const detailPayloads = details()
    const detailAdapter = new DouyinWorkDetailAdapter([
      detailSource('DY-DETAIL-NETWORK', ({ workId }) => detailPayloads[workId], (input) => {
        const request = detailRequest(input)
        request.parameters['X-Bogus'] = 'secret-signature'
        return request
      })
    ])
    const outcome = await networkWorksAdapter(pages, detailAdapter).collectOutcome({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())

    expect(outcome).toMatchObject({ ok: false, items: [], issue: { code: 'UNSAFE_REQUEST', endpointKind: 'work-detail' } })
    expect(JSON.stringify(outcome)).not.toContain('secret-signature')
  })

  it('persists only whitelist projections, hashes, IDs and safe route traces', async () => {
    const page = await networkWorksAdapter().collect({ followedCreatorId: creatorId, profileRouteCreatorId: creatorId }, context())
    const serialized = JSON.stringify(page)
    expect(serialized).not.toMatch(/must-not-enter|private_token|authorization|raw_headers|cookie|X-Bogus|internal_score/)
    expect(serialized).not.toContain('https://www.douyin.com/aweme/')
  })
})
