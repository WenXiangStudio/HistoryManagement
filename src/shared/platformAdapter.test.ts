import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import commentPageFixture from './fixtures/douyin-comment-page.mock.json'
import {
  PLATFORM_ADAPTER_ERROR_POLICIES,
  buildPlatformAdapterIssue,
  collectionScopeSchema,
  createPlatformAdapterPageSchema,
  douyinCommentApiProofSchema,
  douyinFollowingApiProofSchema,
  douyinWorkApiProofSchema,
  mediaResourceProofSchema,
  platformAdapterIssueSchema,
  platformSourceProofSchema,
  type CollectionScope,
  type PlatformAdapter,
  type PlatformAdapterContext,
  type PlatformAdapterPage
} from './platformAdapter'
import {
  createCollectionScopeFingerprint,
  filterPageContextRequestHeaders,
  filterPersistedRequestParameters,
  filterPersistedResponseHeaders,
  redactForLog,
  sanitizeUrlForLogging,
  sha256CanonicalJson
} from '../main/platformAdapterSecurity'

const rawCommentSchema = z.object({
  cid: z.string().min(1),
  text: z.string().min(1),
  create_time: z.number().int().nonnegative(),
  digg_count: z.number().int().nonnegative(),
  ip_label: z.string().nullable(),
  reply_comment_total: z.number().int().nonnegative(),
  user: z.object({
    uid: z.string().min(1),
    nickname: z.string().min(1)
  }).strict()
}).strict()

const rawCommentPageSchema = z.object({
  fixture: z.literal('synthetic-douyin-comment-page/v1'),
  status_code: z.literal(0),
  comments: z.array(rawCommentSchema),
  cursor: z.number().int().nonnegative(),
  has_more: z.union([z.literal(0), z.literal(1)]),
  total: z.number().int().nonnegative(),
  extra: z.object({ now: z.number().int().nonnegative() }).strict()
}).strict()

const normalizedCommentSchema = z.object({
  commentId: z.string().min(1),
  workId: z.string().min(1),
  publicAuthorId: z.string().min(1),
  publicAuthorName: z.string().min(1),
  body: z.string().min(1),
  likeCount: z.number().int().nonnegative(),
  publishedAt: z.string().datetime(),
  replyCount: z.number().int().nonnegative(),
  ipLabel: z.string().nullable()
}).strict()

type NormalizedComment = z.infer<typeof normalizedCommentSchema>
type MockRequest = { workId: string; cursor: string; count: number }

const mockAdapterIdentity = {
  platform: 'douyin' as const,
  adapterName: 'douyin.comments',
  adapterVersion: '0.2.0-phase-a',
  schemaVersion: 1 as const
}

class FixtureCommentAdapter implements PlatformAdapter<MockRequest, NormalizedComment> {
  readonly identity = mockAdapterIdentity
  readonly operation = 'comments' as const

  async collect(request: MockRequest, context: PlatformAdapterContext): Promise<PlatformAdapterPage<NormalizedComment>> {
    const raw = rawCommentPageSchema.parse(commentPageFixture)
    const items = raw.comments.map((comment) => ({
      commentId: comment.cid,
      workId: request.workId,
      publicAuthorId: comment.user.uid,
      publicAuthorName: comment.user.nickname,
      body: comment.text,
      likeCount: comment.digg_count,
      publishedAt: new Date(comment.create_time * 1_000).toISOString(),
      replyCount: comment.reply_comment_total,
      ipLabel: comment.ip_label
    }))
    const returnedIds = items.map((comment) => comment.commentId)
    const safeResponseBody = {
      status_code: raw.status_code,
      comments: raw.comments,
      cursor: raw.cursor,
      has_more: raw.has_more,
      total: raw.total
    }
    return {
      contract: 'platform-adapter-page/v1',
      identity: this.identity,
      operation: this.operation,
      completion: raw.has_more === 1 ? 'partial' : 'complete',
      pagination: {
        cursorIn: request.cursor,
        cursorOut: String(raw.cursor),
        hasMore: raw.has_more === 1,
        reportedTotal: raw.total,
        returnedCount: items.length,
        duplicateCount: 0
      },
      sourceProof: douyinCommentApiProofSchema.parse({
        contract: 'douyin-comment-api-proof/v1',
        ...this.identity,
        pageKind: 'work-detail-comments',
        sourceKind: 'page-context-fetch',
        endpointKind: 'comment-list',
        requestParameters: filterPersistedRequestParameters('comment-list', {
          aweme_id: request.workId,
          cursor: request.cursor,
          count: request.count,
          'X-Bogus': 'must-never-be-retained'
        }),
        cursorIn: request.cursor,
        cursorOut: String(raw.cursor),
        hasMore: raw.has_more === 1,
        reportedTotal: raw.total,
        returnedIds,
        responseBodySha256: sha256CanonicalJson(safeResponseBody),
        collectedAt: context.now().toISOString(),
        browserOrigin: context.browserOrigin,
        sessionUsed: true,
        signatureProvider: 'page-frontierSign',
        validationResults: {
          http: 'valid',
          json: 'valid',
          platformStatus: 'valid',
          targetIdentity: 'valid',
          schema: 'valid',
          pagination: 'valid',
          sensitiveFields: 'removed'
        },
        awemeId: request.workId
      }),
      items
    }
  }
}

function baseScope(): CollectionScope {
  return collectionScopeSchema.parse({
    contract: 'collection-scope/v1',
    platform: 'douyin',
    ownerAccountId: 'local-owner-1',
    operation: 'comments',
    entityId: 'mock-work-9001',
    limits: { creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 },
    collectionMode: 'collection-only',
    adapterName: 'douyin.comments',
    adapterVersion: '0.2.0-phase-a',
    timeWindow: null
  })
}

describe('PlatformAdapter phase A contracts', () => {
  it('executes a synthetic fixture adapter and validates the normalized page and proof', async () => {
    const controller = new AbortController()
    const adapter = new FixtureCommentAdapter()
    const result = await adapter.collect(
      { workId: 'mock-work-9001', cursor: '0', count: 20 },
      {
        browserOrigin: 'https://www.douyin.com',
        sessionKind: 'browser-page',
        signal: controller.signal,
        now: () => new Date('2026-09-05T00:00:00.000Z')
      }
    )

    const parsed = createPlatformAdapterPageSchema(normalizedCommentSchema).parse(result)
    expect(parsed.items.map((comment) => comment.commentId)).toEqual(['mock-comment-1001', 'mock-comment-1002'])
    expect(parsed.pagination).toMatchObject({ cursorIn: '0', cursorOut: '20', hasMore: true, returnedCount: 2, reportedTotal: 42 })
    expect(parsed.sourceProof).toMatchObject({
      contract: 'douyin-comment-api-proof/v1',
      awemeId: 'mock-work-9001',
      returnedIds: ['mock-comment-1001', 'mock-comment-1002'],
      sessionUsed: true,
      signatureProvider: 'page-frontierSign'
    })
    if (parsed.sourceProof.contract !== 'douyin-comment-api-proof/v1') throw new Error('expected comment API proof')
    expect(parsed.sourceProof.requestParameters).toEqual([
      { name: 'aweme_id', value: 'mock-work-9001' },
      { name: 'count', value: 20 },
      { name: 'cursor', value: '0' }
    ])
  })

  it('validates every versioned proof contract in strict mode', () => {
    const common = {
      platform: 'douyin' as const,
      adapterName: 'douyin.fixture',
      adapterVersion: '0.2.0-phase-a',
      schemaVersion: 1 as const,
      sourceKind: 'network-response' as const,
      cursorIn: '0',
      cursorOut: '20',
      hasMore: true,
      reportedTotal: 42,
      responseBodySha256: 'c'.repeat(64),
      collectedAt: '2026-09-05T00:00:00.000Z',
      browserOrigin: 'https://www.douyin.com' as const,
      sessionUsed: true as const,
      signatureProvider: 'observed-network-response' as const,
      validationResults: {
        http: 'valid' as const,
        json: 'valid' as const,
        platformStatus: 'valid' as const,
        targetIdentity: 'valid' as const,
        schema: 'valid' as const,
        pagination: 'valid' as const,
        sensitiveFields: 'removed' as const
      }
    }
    const comment = douyinCommentApiProofSchema.parse({
      contract: 'douyin-comment-api-proof/v1', ...common,
      pageKind: 'work-detail-comments', endpointKind: 'comment-list', awemeId: 'work-1',
      requestParameters: [{ name: 'aweme_id', value: 'work-1' }], returnedIds: ['comment-1']
    })
    const following = douyinFollowingApiProofSchema.parse({
      contract: 'douyin-following-api-proof/v1', ...common,
      pageKind: 'owner-following-list', endpointKind: 'following-list', relationship: 'following',
      requestParameters: [{ name: 'cursor', value: '0' }], returnedIds: ['creator-1'], creatorIds: ['creator-1']
    })
    const work = douyinWorkApiProofSchema.parse({
      contract: 'douyin-work-api-proof/v1', ...common,
      pageKind: 'creator-profile-works', endpointKind: 'creator-work-list', creatorId: 'creator-1',
      requestParameters: [{ name: 'sec_user_id', value: 'creator-1' }], returnedIds: ['work-1'], workIds: ['work-1']
    })
    const media = mediaResourceProofSchema.parse({
      contract: 'media-resource-proof/v1', platform: 'douyin', adapterName: 'douyin.media',
      adapterVersion: '0.2.0-phase-a', schemaVersion: 1, sourceKind: 'performance-resource',
      endpointKind: 'media-resource', workId: 'work-1', resourceKind: 'video',
      resourceUrlSha256: 'd'.repeat(64), collectedAt: '2026-09-05T00:00:00.000Z',
      browserOrigin: 'https://www.douyin.com', sessionUsed: true,
      validationResults: { targetIdentity: 'valid', resourceScheme: 'https', sensitiveFields: 'removed' }
    })
    for (const proof of [comment, following, work, media]) {
      expect(() => platformSourceProofSchema.parse(proof)).not.toThrow()
    }
    expect(() => douyinCommentApiProofSchema.parse({
      ...comment,
      requestUrl: 'https://www.douyin.com/aweme/v1/web/comment/list/?X-Bogus=forbidden',
      headers: { Cookie: 'forbidden' }
    })).toThrow()
  })

  it('rejects pagination states that could otherwise confuse not-yet-loaded with verified empty', () => {
    const schema = createPlatformAdapterPageSchema(normalizedCommentSchema)
    const adapter = new FixtureCommentAdapter()
    const proof = douyinCommentApiProofSchema.parse({
      contract: 'douyin-comment-api-proof/v1', ...adapter.identity,
      pageKind: 'work-detail-comments', sourceKind: 'page-context-fetch', endpointKind: 'comment-list',
      requestParameters: [{ name: 'aweme_id', value: 'mock-work-9001' }],
      cursorIn: '0', cursorOut: '0', hasMore: true, reportedTotal: 1, returnedIds: [],
      responseBodySha256: 'a'.repeat(64), collectedAt: '2026-09-05T00:00:00.000Z',
      browserOrigin: 'https://www.douyin.com', sessionUsed: true, signatureProvider: 'page-frontierSign',
      validationResults: {
        http: 'valid', json: 'valid', platformStatus: 'valid', targetIdentity: 'valid', schema: 'valid',
        pagination: 'valid', sensitiveFields: 'removed'
      },
      awemeId: 'mock-work-9001'
    })
    const invalid = {
      contract: 'platform-adapter-page/v1', identity: adapter.identity, operation: 'comments', completion: 'partial',
      pagination: { cursorIn: '0', cursorOut: '0', hasMore: true, reportedTotal: 1, returnedCount: 0, duplicateCount: 0 },
      sourceProof: proof, items: []
    }
    expect(() => schema.parse(invalid)).toThrow(/empty page with hasMore=true/)
  })

  it('accepts only a strongly verified empty completion', () => {
    const schema = createPlatformAdapterPageSchema(normalizedCommentSchema)
    const proof = douyinCommentApiProofSchema.parse({
      contract: 'douyin-comment-api-proof/v1', ...mockAdapterIdentity,
      pageKind: 'work-detail-comments', sourceKind: 'page-context-fetch', endpointKind: 'comment-list',
      requestParameters: [{ name: 'aweme_id', value: 'mock-work-empty' }],
      cursorIn: '0', cursorOut: null, hasMore: false, reportedTotal: 0, returnedIds: [],
      responseBodySha256: 'b'.repeat(64), collectedAt: '2026-09-05T00:00:00.000Z',
      browserOrigin: 'https://www.douyin.com', sessionUsed: true, signatureProvider: 'page-frontierSign',
      validationResults: {
        http: 'valid', json: 'valid', platformStatus: 'valid', targetIdentity: 'valid', schema: 'valid',
        pagination: 'valid', sensitiveFields: 'removed'
      },
      awemeId: 'mock-work-empty'
    })
    const page = {
      contract: 'platform-adapter-page/v1', identity: mockAdapterIdentity, operation: 'comments', completion: 'verified-empty',
      pagination: { cursorIn: '0', cursorOut: null, hasMore: false, reportedTotal: 0, returnedCount: 0, duplicateCount: 0 },
      sourceProof: proof, items: []
    }
    expect(schema.parse(page).completion).toBe('verified-empty')
    expect(() => schema.parse({ ...page, pagination: { ...page.pagination, reportedTotal: null } })).toThrow(/verified-empty/)
  })

  it('freezes error policy instead of trusting caller-selected retry or blocking semantics', () => {
    const issue = buildPlatformAdapterIssue({
      code: 'PAGE_CONTEXT_NOT_READY',
      phase: 'discovery',
      message: '页面结构化数据尚未就绪',
      endpointKind: 'comment-list',
      occurredAt: '2026-09-05T00:00:00.000Z'
    })
    expect(issue).toMatchObject({ category: 'transient', retryable: true, taskImpact: 'item', userActionRequired: false })
    expect(PLATFORM_ADAPTER_ERROR_POLICIES.LOGIN_REQUIRED).toMatchObject({ retryable: false, taskImpact: 'batch', userActionRequired: true })
    expect(() => platformAdapterIssueSchema.parse({ ...issue, retryable: false })).toThrow(/frozen policy/)
    expect(() => buildPlatformAdapterIssue({
      code: 'SCHEMA_CHANGED', phase: 'validation', message: 'schema drift', safeContext: { cookie: 'forbidden' },
      occurredAt: '2026-09-05T00:00:00.000Z'
    })).toThrow(/sensitive context keys/)
  })

  it('derives a deterministic scope fingerprint and changes it for range or adapter-version changes', () => {
    const scope = baseScope()
    const first = createCollectionScopeFingerprint(scope)
    const reordered = {
      adapterVersion: scope.adapterVersion,
      collectionMode: scope.collectionMode,
      limits: { commentsPerWork: 20, worksPerCreator: 5, creatorLimit: 3 },
      entityId: scope.entityId,
      operation: scope.operation,
      adapterName: scope.adapterName,
      ownerAccountId: scope.ownerAccountId,
      platform: scope.platform,
      timeWindow: scope.timeWindow,
      contract: scope.contract
    } as CollectionScope
    expect(first).toMatch(/^scope-v1:[a-f0-9]{64}$/)
    expect(createCollectionScopeFingerprint(reordered)).toBe(first)
    expect(createCollectionScopeFingerprint({ ...scope, limits: { ...scope.limits, commentsPerWork: 30 } })).not.toBe(first)
    expect(createCollectionScopeFingerprint({ ...scope, adapterVersion: '0.2.1' })).not.toBe(first)
  })
})

describe('PlatformAdapter phase A sensitive-data boundaries', () => {
  it('uses endpoint-specific parameter allowlists and never persists signatures or unknown device fields', () => {
    const retained = filterPersistedRequestParameters('comment-list', {
      aweme_id: 'work-1', cursor: '0', count: 20, comment_id: 'wrong-endpoint-field',
      aid: 'not-a-number', channel: 'channel with spaces',
      'X-Bogus': 'signature-secret', msToken: 'token-secret', device_id: 'device-secret',
      cookie: 'session-secret'
    })
    expect(retained).toEqual([
      { name: 'aweme_id', value: 'work-1' },
      { name: 'count', value: 20 },
      { name: 'cursor', value: '0' }
    ])
    expect(JSON.stringify(retained)).not.toMatch(/signature-secret|token-secret|device-secret|session-secret/)
  })

  it('filters request and persisted response headers with deny-by-default behavior', () => {
    const request = filterPageContextRequestHeaders({
      Accept: 'application/json', Referer: 'https://www.douyin.com/video/work-1',
      'Content-Type': 'text/html', 'X-Injected': 'safe\r\nAuthorization: Bearer smuggled-secret',
      Cookie: 'session=top-secret', Authorization: 'Bearer auth-secret', 'X-Bogus': 'signature-secret'
    })
    const response = filterPersistedResponseHeaders({
      'Content-Type': 'application/json', ETag: 'safe-etag', 'Set-Cookie': 'session=response-secret',
      'X-Device-Id': 'device-secret', Authorization: 'Bearer response-auth-secret'
    })
    expect(request).toEqual({ accept: 'application/json' })
    expect(response).toEqual({ 'content-type': 'application/json', etag: 'safe-etag' })
    expect(JSON.stringify({ request, response })).not.toMatch(/top-secret|auth-secret|signature-secret|response-secret|device-secret|smuggled-secret/)
  })

  it('redacts nested secrets, bearer text, signed URLs, credentials, and cycles before logging', () => {
    const input: Record<string, unknown> = {
      sessionUsed: true,
      signatureProvider: 'page-frontierSign',
      cookie: 'sid=cookie-secret',
      authorization: 'Bearer auth-secret',
      nested: {
        apiKey: 'key-secret',
        message: 'request failed Authorization: Bearer inline-secret',
        requestUrl: 'https://name:password@example.test/path?aweme_id=work-1&X-Bogus=url-secret&msToken=query-secret#fragment'
      }
    }
    input.self = input
    const redacted = redactForLog(input)
    const serialized = JSON.stringify(redacted)
    expect(redacted).toMatchObject({ sessionUsed: true, signatureProvider: 'page-frontierSign', cookie: '[REDACTED]' })
    expect(serialized).not.toMatch(/cookie-secret|auth-secret|key-secret|inline-secret|password|url-secret|query-secret|fragment/)
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[CIRCULAR]')
    expect(serialized).toContain('aweme_id=work-1')
  })

  it('sanitizes URL query values by allowlist while retaining parameter names for diagnosis', () => {
    const safe = sanitizeUrlForLogging('https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=work-1&cursor=20&X-Bogus=signed-value&msToken=token-value')
    expect(safe).toContain('aweme_id=work-1')
    expect(safe).toContain('cursor=20')
    expect(safe).toContain('X-Bogus=%5BREDACTED%5D')
    expect(safe).toContain('msToken=%5BREDACTED%5D')
    expect(safe).not.toMatch(/signed-value|token-value/)
  })

  it('hashes canonical whitelist-projected JSON independent of object key order', () => {
    const left = sha256CanonicalJson({ status_code: 0, cursor: 20, comments: [{ cid: 'c1', text: 'mock' }] })
    const right = sha256CanonicalJson({ comments: [{ text: 'mock', cid: 'c1' }], cursor: 20, status_code: 0 })
    expect(left).toMatch(/^[a-f0-9]{64}$/)
    expect(right).toBe(left)
  })
})
