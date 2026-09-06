import { describe, expect, it } from 'vitest'
import structuredWorksFixture from './fixtures/douyin-structured-works.mock.json'
import frozenRunRegistry from '../../poc/phase-b/FROZEN_RUNS.json'
import { workAuthorProofSchema } from './platformAdapter'
import {
  LEGACY_PHASE_B_ROUTES,
  ROUTE_REGISTRY,
  acceptStructuredWorkCandidate,
  assertLegacyPhaseBRouteDisabled,
  assertNativeStructuredCommentTarget,
  createWorkAuthorProof,
  nativeStructuredCommentItemSchema,
  nativeStructuredWorkItemSchema,
  type StructuredWorkObservation
} from './structuredAcquisition'
import {
  assertSafePersistedRouteTrace,
  createResponseProjectionSha256,
  createSchemaFingerprint,
  validateSafeReadOnlyRequest
} from '../main/platformAdapterSecurity'

const observedAt = '2026-09-06T01:00:00.000Z'

function workProjection(authorId = 'synthetic-creator-1001') {
  return {
    endpointKind: 'creator-work-list',
    cursorOut: '20',
    hasMore: false,
    reportedTotal: 1,
    items: [{
      workId: 'synthetic-work-1001',
      authorId,
      authorSecId: 'synthetic-sec-creator-1001',
      workType: 'video',
      statistics: { likeCount: 12, commentCount: 3, collectCount: 2, shareCount: 1, playCount: 50 }
    }]
  }
}

function observation(authorId = 'synthetic-creator-1001'): StructuredWorkObservation {
  const schemaFingerprint = createSchemaFingerprint(structuredWorksFixture)
  return {
    contract: 'douyin-structured-work-observation/v1',
    sourceKind: 'network-response',
    routeId: 'DY-WORKS-NETWORK',
    endpointKind: 'creator-work-list',
    requestTargetCreatorId: 'synthetic-creator-1001',
    workId: 'synthetic-work-1001',
    authorId,
    authorIdSourcePath: 'aweme_list[].author.uid',
    observedAt,
    schemaFingerprint,
    responseProjectionSha256: createResponseProjectionSha256(workProjection(authorId)),
    routeTrace: [{
      routeId: 'DY-WORKS-NETWORK',
      status: 'success',
      attempt: 1,
      durationMs: 12,
      schemaFingerprint,
      occurredAt: observedAt
    }]
  }
}

describe('R0 route and failed-run freeze', () => {
  it('registers the Network routes plus R3/R4 fallbacks as synthetic-only', () => {
    expect(Object.keys(ROUTE_REGISTRY).sort()).toEqual([
      'DY-COMMENT-NETWORK',
      'DY-DETAIL-EMBEDDED',
      'DY-DETAIL-INPAGE',
      'DY-DETAIL-NETWORK',
      'DY-DETAIL-STOP',
      'DY-FOLLOW-EMBEDDED',
      'DY-FOLLOW-INPAGE',
      'DY-FOLLOW-NETWORK',
      'DY-FOLLOW-STOP',
      'DY-MEDIA-NETWORK',
      'DY-REPLY-NETWORK',
      'DY-WORKS-EMBEDDED',
      'DY-WORKS-INPAGE',
      'DY-WORKS-NETWORK',
      'DY-WORKS-STOP'
    ])
    expect(Object.values(ROUTE_REGISTRY).every((route) => !route.eligibleForFormalData)).toBe(true)
    expect(Object.values(ROUTE_REGISTRY).every((route) => route.allowedMethods[0] === 'GET')).toBe(true)
  })

  it('hard-disables both legacy Phase B routes', () => {
    expect(LEGACY_PHASE_B_ROUTES['0.2.3']).toMatchObject({ executable: false, benchmarkEligible: false, status: 'frozen-failed' })
    expect(LEGACY_PHASE_B_ROUTES['0.2.4']).toMatchObject({ executable: false, benchmarkEligible: false, status: 'disabled' })
    expect(() => assertLegacyPhaseBRouteDisabled('0.2.3')).toThrow(/LEGACY_ROUTE_DISABLED/)
    expect(LEGACY_PHASE_B_ROUTES['0.2.4'].reasonCode).toBe('LEGACY_ROUTE_PERMANENTLY_DISABLED')
    expect(() => assertLegacyPhaseBRouteDisabled('0.2.4')).toThrow(/LEGACY_ROUTE_PERMANENTLY_DISABLED/)
  })

  it('treats every historical run as immutable failure evidence regardless of legacy summary fields', () => {
    expect(frozenRunRegistry.contract).toBe('signaldesk-r0-frozen-run-registry/v1')
    expect(frozenRunRegistry.policy).toMatchObject({
      immutableEvidenceOnly: true,
      benchmarkEligible: false,
      mayResume: false,
      mayOverwrite: false,
      mayImportIntoFormalDatabase: false
    })
    expect(frozenRunRegistry.runs).toHaveLength(3)
    expect(frozenRunRegistry.runs.every((run) => run.benchmarkEligible === false)).toBe(true)
    expect(frozenRunRegistry.runs.find((run) => run.runId.endsWith('144519Z'))).toMatchObject({
      classification: 'failed-author-proof-and-structured-comments',
      reasonCode: 'AUTHOR_PROOF_CIRCULAR',
      legacySummaryMustNotOverrideRegistry: true
    })
  })
})

describe('R1 WorkAuthorProof/v2 and independent author gate', () => {
  it('accepts a candidate only when all identities and structured observation hashes agree', () => {
    const independent = observation()
    const proof = createWorkAuthorProof({
      followedCreatorId: 'synthetic-creator-1001',
      profileRouteCreatorId: 'synthetic-creator-1001',
      observation: independent
    })
    expect(proof.contract).toBe('douyin-work-author-proof/v2')
    expect(acceptStructuredWorkCandidate({
      workId: 'synthetic-work-1001',
      creatorId: 'synthetic-creator-1001',
      sourceKind: 'network-response',
      authorProof: proof
    }, independent).authorProof.observedWorkAuthorId).toBe('synthetic-creator-1001')
  })

  it('rejects DOM-only candidates even when their loop variable creatorId looks valid', () => {
    expect(() => acceptStructuredWorkCandidate({
      workId: 'synthetic-work-1001',
      creatorId: 'synthetic-creator-1001',
      sourceKind: 'dom-fallback'
    }, observation())).toThrow(/DOM_ONLY_SOURCE_REJECTED/)
  })

  it('rejects a self-filled author ID when an independent projection observes another author', () => {
    const selfFilled = observation('synthetic-creator-1001')
    const forgedProof = createWorkAuthorProof({
      followedCreatorId: 'synthetic-creator-1001',
      profileRouteCreatorId: 'synthetic-creator-1001',
      observation: selfFilled
    })
    const actualStructuredObservation = {
      ...observation('synthetic-other-author'),
      requestTargetCreatorId: 'synthetic-creator-1001'
    }
    expect(() => acceptStructuredWorkCandidate({
      workId: 'synthetic-work-1001',
      creatorId: 'synthetic-creator-1001',
      sourceKind: 'network-response',
      authorProof: forgedProof
    }, actualStructuredObservation)).toThrow(/AUTHOR_PROOF_MISMATCH/)
  })

  it('rejects direct four-ID mismatches and missing successful trace binding', () => {
    const valid = createWorkAuthorProof({
      followedCreatorId: 'synthetic-creator-1001',
      profileRouteCreatorId: 'synthetic-creator-1001',
      observation: observation()
    })
    expect(() => workAuthorProofSchema.parse({ ...valid, observedWorkAuthorId: 'synthetic-other-author' })).toThrow(/AUTHOR_PROOF_MISMATCH/)
    expect(() => workAuthorProofSchema.parse({ ...valid, routeTrace: [] })).toThrow(/successful matching route trace/)
  })

  it('accepts only native aweme_id/cid identities and requires reply relationships', () => {
    expect(nativeStructuredWorkItemSchema.parse({
      workId: 'synthetic-work-1001',
      workIdKind: 'native-aweme-id',
      workIdSourcePath: 'aweme_list[].aweme_id',
      authorId: 'synthetic-creator-1001',
      authorIdSourcePath: 'aweme_list[].author.uid'
    }).workId).toBe('synthetic-work-1001')
    expect(() => nativeStructuredWorkItemSchema.parse({
      workId: 'synthetic-content-hash-123',
      workIdKind: 'synthetic-content-hash',
      workIdSourcePath: 'dom.href',
      authorId: 'synthetic-creator-1001',
      authorIdSourcePath: 'aweme_list[].author.uid'
    })).toThrow()

    const reply = {
      commentId: 'synthetic-reply-1001',
      commentIdKind: 'native-cid',
      commentIdSourcePath: 'comments[].cid',
      workId: 'synthetic-work-1001',
      workIdSourcePath: 'comments[].aweme_id',
      parentCommentId: 'synthetic-comment-1001',
      rootCommentId: 'synthetic-comment-1001',
      endpointKind: 'comment-reply-list'
    }
    expect(nativeStructuredCommentItemSchema.parse(reply).commentIdKind).toBe('native-cid')
    expect(() => nativeStructuredCommentItemSchema.parse({ ...reply, commentIdKind: 'synthetic-content-hash' })).toThrow()
    expect(() => nativeStructuredCommentItemSchema.parse({ ...reply, parentCommentId: null, rootCommentId: null })).toThrow(/repl/)
    expect(() => assertNativeStructuredCommentTarget({ ...reply, workId: 'different-work' }, 'synthetic-work-1001')).toThrow(/NATIVE_ID_MISMATCH/)
  })
})

describe('R1 schema fingerprints, projection hashes, trace and request safety', () => {
  it('hashes only schema paths/types for a fingerprint and canonical whitelist values for a projection', () => {
    const sameShapeDifferentValues = structuredClone(structuredWorksFixture)
    sameShapeDifferentValues.aweme_list[0].aweme_id = 'synthetic-work-9999'
    sameShapeDifferentValues.aweme_list[0].statistics.digg_count = 999
    expect(createSchemaFingerprint(sameShapeDifferentValues)).toBe(createSchemaFingerprint(structuredWorksFixture))

    const typeChanged = structuredClone(structuredWorksFixture) as Record<string, unknown>
    typeChanged.cursor = '20'
    expect(createSchemaFingerprint(typeChanged)).not.toBe(createSchemaFingerprint(structuredWorksFixture))
    expect(createResponseProjectionSha256({ b: 2, a: 1 })).toBe(createResponseProjectionSha256({ a: 1, b: 2 }))
  })

  it('accepts a minimal safe GET request and rejects method, URL, parameter, and header negatives', () => {
    expect(validateSafeReadOnlyRequest({
      method: 'GET',
      endpointKind: 'creator-work-list',
      path: '/aweme/v1/web/aweme/post/',
      parameters: { sec_user_id: 'synthetic-sec-creator-1001', cursor: '0', count: 20 },
      headers: { accept: 'application/json' }
    })).toMatchObject({ method: 'GET', path: '/aweme/v1/web/aweme/post/' })

    expect(() => validateSafeReadOnlyRequest({ method: 'POST', endpointKind: 'creator-work-list', path: '/aweme/post/' })).toThrow(/only GET/)
    expect(() => validateSafeReadOnlyRequest({ method: 'GET', endpointKind: 'creator-work-list', path: 'https://www.douyin.com/aweme/post/' })).toThrow(/relative pathname/)
    expect(() => validateSafeReadOnlyRequest({ method: 'GET', endpointKind: 'creator-work-list', path: '/aweme/post/', parameters: { unknown: 'x' } })).toThrow(/unknown or invalid/)
    expect(() => validateSafeReadOnlyRequest({ method: 'GET', endpointKind: 'creator-work-list', path: '/aweme/post/', parameters: { 'X-Bogus': 'secret' } })).toThrow(/sensitive parameter/)
    expect(() => validateSafeReadOnlyRequest({ method: 'GET', endpointKind: 'creator-work-list', path: '/aweme/post/', headers: { Authorization: 'Bearer secret' } })).toThrow(/not explicitly permitted/)
  })

  it('persists only the strict non-sensitive route trace shape', () => {
    const trace = observation().routeTrace
    expect(assertSafePersistedRouteTrace(trace)).toEqual(trace)
    expect(() => assertSafePersistedRouteTrace([{ ...trace[0], requestUrl: 'https://www.douyin.com/?token=secret' }])).toThrow()
    expect(() => assertSafePersistedRouteTrace([{ ...trace[0], rawResponse: structuredWorksFixture }])).toThrow(/forbidden persisted field/)
    expect(() => assertSafePersistedRouteTrace([{ ...trace[0], cookie: 'secret' }])).toThrow(/forbidden persisted field/)
  })
})
