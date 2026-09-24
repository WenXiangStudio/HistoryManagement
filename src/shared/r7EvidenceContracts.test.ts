import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/r7-evidence-contracts.synthetic.json'
import { runR7ContractBenchmark } from './r7ContractBenchmark'
import {
  asrResultSchema,
  claimEvidenceVerdictSchema,
  evidenceMapSchema,
  factCheckRequestSchema,
  ocrResultSchema,
  verdictToUiState
} from './r7EvidenceContracts'

describe('R7 media, ASR and OCR contracts', () => {
  it('accepts both planned ASR providers and explicit verified-empty output', () => {
    expect(fixtures.asrResults.map((input) => asrResultSchema.parse(input).provider.id)).toEqual([
      'faster-whisper',
      'whisper.cpp',
      'faster-whisper'
    ])
    expect(asrResultSchema.parse(fixtures.asrResults[1])).toMatchObject({
      status: 'verified-empty',
      segments: [],
      emptyReason: 'no-speech-detected'
    })
  })

  it('does not allow failed providers to manufacture transcripts or OCR blocks', () => {
    const fakeTranscript = {
      ...fixtures.asrResults[2],
      segments: [{ segmentId: 'fake', startMs: 0, endMs: 1, text: '伪结果', language: 'zh', confidence: 0.99 }]
    }
    const fakeOcr = {
      ...fixtures.ocrResults[1],
      blocks: [{
        blockId: 'fake', frameArtifactId: 'frame', frameRef: 'frame-1', timeMs: 0,
        text: '伪结果', confidence: 0.99, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]], reviewState: 'accepted'
      }]
    }
    expect(asrResultSchema.safeParse(fakeTranscript).success).toBe(false)
    expect(ocrResultSchema.safeParse(fakeOcr).success).toBe(false)
  })

  it('keeps low-confidence OCR in human review', () => {
    const lowConfidence = structuredClone(fixtures.ocrResults[0])
    if ('blocks' in lowConfidence) {
      lowConfidence.blocks[0].confidence = 0.5
      lowConfidence.blocks[0].reviewState = 'accepted'
    }
    expect(ocrResultSchema.safeParse(lowConfidence).success).toBe(false)
    if ('blocks' in lowConfidence) lowConfidence.blocks[0].reviewState = 'needs-review'
    expect(ocrResultSchema.safeParse(lowConfidence).success).toBe(true)
  })
})

describe('R7 evidence map contract', () => {
  it('requires every summary and core-expression reference to resolve', () => {
    const parsed = evidenceMapSchema.parse(fixtures.evidenceMap)
    const evidenceIds = new Set(parsed.evidence.map((evidence) => evidence.evidenceId))
    for (const point of parsed.summaryPoints) {
      expect(point.evidenceIds.length).toBeGreaterThan(0)
      expect(point.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true)
    }
    expect(parsed.coreExpression.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true)
  })

  it('rejects dangling references, duplicate IDs and cross-work evidence', () => {
    const dangling = structuredClone(fixtures.evidenceMap)
    dangling.summaryPoints[0].evidenceIds = ['missing-evidence']
    expect(evidenceMapSchema.safeParse(dangling).success).toBe(false)

    const duplicate = structuredClone(fixtures.evidenceMap)
    duplicate.evidence.push(structuredClone(duplicate.evidence[0]))
    expect(evidenceMapSchema.safeParse(duplicate).success).toBe(false)

    const crossWork = structuredClone(fixtures.evidenceMap)
    crossWork.evidence[0].workId = 'different-work'
    expect(evidenceMapSchema.safeParse(crossWork).success).toBe(false)
  })
})

describe('R7 claim/evidence/verdict and authorization contracts', () => {
  it('forces factual claims with no external evidence to abstain', () => {
    const abstention = claimEvidenceVerdictSchema.parse(fixtures.verdicts[0])
    expect(abstention.verdict).toBe('insufficient-evidence')
    expect(verdictToUiState(abstention.verdict)).toBe('abstained')

    const inventedSupport = { ...fixtures.verdicts[0], verdict: 'supported' }
    expect(claimEvidenceVerdictSchema.safeParse(inventedSupport).success).toBe(false)
  })

  it('requires sourced quote, timestamps and reliability for a supported verdict', () => {
    expect(claimEvidenceVerdictSchema.parse(fixtures.verdicts[1]).verdict).toBe('supported')
    const missingQuote = structuredClone(fixtures.verdicts[1]) as Record<string, any>
    delete missingQuote.evidence[0].quote
    expect(claimEvidenceVerdictSchema.safeParse(missingQuote).success).toBe(false)
  })

  it('maps opinions and predictions only to not-a-factual-claim', () => {
    const opinion = structuredClone(fixtures.verdicts[0]) as Record<string, any>
    opinion.claim.classification = 'opinion'
    opinion.claim.eligibleForVerification = false
    opinion.verdict = 'not-a-factual-claim'
    expect(claimEvidenceVerdictSchema.safeParse(opinion).success).toBe(true)
    opinion.verdict = 'insufficient-evidence'
    expect(claimEvidenceVerdictSchema.safeParse(opinion).success).toBe(false)
  })

  it('keeps external verification behind network and cost approval', () => {
    const claim = fixtures.verdicts[0].claim
    expect(factCheckRequestSchema.safeParse({
      contract: 'fact-check-request/v1', requestId: 'request-1', claim,
      executionMode: 'external',
      authorization: { state: 'disabled', networkAllowed: false, costApproved: false, reason: '用户尚未批准' },
      createdAt: '2026-09-07T12:00:08.000Z'
    }).success).toBe(false)

    expect(factCheckRequestSchema.safeParse({
      contract: 'fact-check-request/v1', requestId: 'request-2', claim,
      executionMode: 'external',
      authorization: {
        state: 'approved', networkAllowed: true, costApproved: true,
        approvalId: 'approval-1', approvedAt: '2026-09-07T12:00:08.000Z', maximumCost: 1, currency: 'CNY'
      },
      createdAt: '2026-09-07T12:00:08.000Z'
    }).success).toBe(true)

    expect(factCheckRequestSchema.safeParse({
      contract: 'fact-check-request/v1', requestId: 'request-3', claim,
      executionMode: 'offline-fixture',
      authorization: { state: 'offline-fixture', networkAllowed: false, costApproved: false },
      createdAt: '2026-09-07T12:00:08.000Z'
    }).success).toBe(true)
  })
})

describe('R7 deterministic offline benchmark', () => {
  it('passes the checked-in synthetic suite without I/O or providers', () => {
    const report = runR7ContractBenchmark(fixtures)
    expect(report).toMatchObject({
      passed: true,
      validArtifacts: 2,
      validMediaResults: 2,
      validAsrResults: 3,
      validOcrResults: 2,
      traceableSummaryPoints: 1,
      abstainingNoEvidenceVerdicts: 1,
      failureResultsWithSyntheticOutput: 0,
      errors: []
    })
  })

  it('fails a suite containing synthetic output from a failed provider', () => {
    const compromised = structuredClone(fixtures) as any
    compromised.asrResults[2].segments = [{ segmentId: 'fake' }]
    const report = runR7ContractBenchmark(compromised)
    expect(report.passed).toBe(false)
    expect(report.failureResultsWithSyntheticOutput).toBe(1)
    expect(report.errors.join('\n')).toContain('synthetic output')
  })
})
