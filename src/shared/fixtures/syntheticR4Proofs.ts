import {
  douyinCreatorWorksStructuredProofSchema,
  workAuthorProofSchema,
  type DouyinCreatorWorksStructuredProof,
  type WorkAuthorProof
} from '../platformAdapter'
import {
  STRUCTURED_ACQUISITION_ADAPTER_VERSION,
  workDetailVerificationSchema,
  type PublicWorkStatistics,
  type StructuredWorkObservation,
  type WorkDetailVerification
} from '../structuredAcquisition'

const DEFAULT_COLLECTED_AT = '2026-09-06T04:00:00.000Z'

function trace(routeId: string, schemaFingerprint: string, occurredAt: string) {
  return [{
    routeId,
    status: 'success' as const,
    attempt: 1,
    durationMs: 10,
    schemaFingerprint,
    occurredAt
  }]
}

function validationResults(pagination: 'valid' | 'not-applicable') {
  return {
    http: 'valid' as const,
    json: 'valid' as const,
    platformStatus: 'valid' as const,
    targetIdentity: 'valid' as const,
    schema: 'valid' as const,
    pagination,
    sensitiveFields: 'removed' as const
  }
}

export function syntheticCreatorWorksProof(
  creatorId: string,
  workIds: string[],
  options: { collectedAt?: string; cursorOut?: string | null; reportedTotal?: number | null } = {}
): DouyinCreatorWorksStructuredProof {
  const collectedAt = options.collectedAt ?? DEFAULT_COLLECTED_AT
  const schemaFingerprint = 'a'.repeat(64)
  return douyinCreatorWorksStructuredProofSchema.parse({
    contract: 'douyin-creator-works-structured-proof/v2',
    platform: 'douyin',
    adapterName: 'douyin.creator-works',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 2,
    routeId: 'DY-WORKS-NETWORK',
    sourceKind: 'network-response',
    endpointKind: 'creator-work-list',
    followedCreatorId: creatorId,
    profileRouteCreatorId: creatorId,
    requestTargetCreatorId: creatorId,
    targetCreatorIdSourcePath: 'request.sec_user_id',
    requestParameters: [
      { name: 'count', value: 20 },
      { name: 'cursor', value: '0' },
      { name: 'sec_user_id', value: creatorId }
    ],
    cursorIn: '0',
    cursorOut: options.cursorOut ?? '20',
    hasMore: false,
    reportedTotal: options.reportedTotal ?? workIds.length,
    returnedIds: workIds,
    workIds,
    authorBindings: workIds.map((workId) => ({ workId, authorId: creatorId })),
    schemaFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: trace('DY-WORKS-NETWORK', schemaFingerprint, collectedAt),
    collectedAt,
    browserOrigin: 'https://www.douyin.com',
    sessionUsed: true,
    validationResults: validationResults('valid')
  })
}

export function syntheticR4WorkEvidence(
  creatorId: string,
  workId: string,
  detailStatistics: PublicWorkStatistics,
  options: { collectedAt?: string; listStatistics?: PublicWorkStatistics } = {}
): {
  authorProof: WorkAuthorProof
  structuredObservation: StructuredWorkObservation
  detailVerification: WorkDetailVerification
} {
  const collectedAt = options.collectedAt ?? DEFAULT_COLLECTED_AT
  const listStatistics = options.listStatistics ?? detailStatistics
  const listFingerprint = 'a'.repeat(64)
  const detailFingerprint = 'c'.repeat(64)
  const listObservation: StructuredWorkObservation = {
    contract: 'douyin-structured-work-observation/v1',
    sourceKind: 'network-response',
    routeId: 'DY-WORKS-NETWORK',
    endpointKind: 'creator-work-list',
    requestTargetCreatorId: creatorId,
    workId,
    authorId: creatorId,
    authorIdSourcePath: 'aweme_list[].author.uid',
    observedAt: collectedAt,
    schemaFingerprint: listFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: trace('DY-WORKS-NETWORK', listFingerprint, collectedAt)
  }
  const detailObservation: StructuredWorkObservation = {
    contract: 'douyin-structured-work-observation/v1',
    sourceKind: 'network-response',
    routeId: 'DY-DETAIL-NETWORK',
    endpointKind: 'work-detail',
    requestTargetCreatorId: null,
    workId,
    authorId: creatorId,
    authorIdSourcePath: 'aweme_detail.author.uid',
    observedAt: collectedAt,
    schemaFingerprint: detailFingerprint,
    responseProjectionSha256: 'd'.repeat(64),
    routeTrace: trace('DY-DETAIL-NETWORK', detailFingerprint, collectedAt)
  }
  const authorProof = workAuthorProofSchema.parse({
    contract: 'douyin-work-author-proof/v2',
    followedCreatorId: creatorId,
    profileRouteCreatorId: creatorId,
    requestTargetCreatorId: creatorId,
    observedWorkAuthorId: creatorId,
    observedWorkId: workId,
    authorProofSource: 'network-response',
    endpointKind: 'creator-work-list',
    routeId: 'DY-WORKS-NETWORK',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    observedAt: collectedAt,
    schemaFingerprint: listFingerprint,
    responseProjectionSha256: 'b'.repeat(64),
    routeTrace: listObservation.routeTrace
  })
  const detailSourceProof = {
    contract: 'douyin-work-detail-structured-proof/v2' as const,
    platform: 'douyin' as const,
    adapterName: 'douyin.work-detail',
    adapterVersion: STRUCTURED_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: 2 as const,
    routeId: 'DY-DETAIL-NETWORK' as const,
    sourceKind: 'network-response' as const,
    endpointKind: 'work-detail' as const,
    targetWorkId: workId,
    returnedWorkId: workId,
    expectedCreatorId: creatorId,
    observedAuthorId: creatorId,
    authorIdSourcePath: 'aweme_detail.author.uid' as const,
    targetWorkIdSourcePath: 'request.aweme_id' as const,
    requestParameters: [{ name: 'aweme_id' as const, value: workId }],
    returnedIds: [workId],
    schemaFingerprint: detailFingerprint,
    responseProjectionSha256: 'd'.repeat(64),
    routeTrace: detailObservation.routeTrace,
    collectedAt,
    browserOrigin: 'https://www.douyin.com' as const,
    sessionUsed: true as const,
    validationResults: validationResults('not-applicable')
  }
  const changedStatisticFields = (['likeCount', 'commentCount', 'collectCount', 'shareCount', 'playCount'] as const)
    .filter((field) => listStatistics[field] !== detailStatistics[field])
  const detailVerification = workDetailVerificationSchema.parse({
    contract: 'douyin-work-detail-verification/v1',
    workId,
    expectedCreatorId: creatorId,
    listObservation,
    detailObservation,
    detailSourceProof,
    listStatistics,
    detailStatistics,
    changedStatisticFields,
    verifiedAt: collectedAt
  })
  return { authorProof, structuredObservation: listObservation, detailVerification }
}
