import {
  asrResultSchema,
  claimEvidenceVerdictSchema,
  evidenceMapSchema,
  mediaArtifactSchema,
  mediaProcessingResultSchema,
  ocrResultSchema
} from './r7EvidenceContracts'

export type R7SyntheticFixtureSuite = {
  artifacts: unknown[]
  mediaResults: unknown[]
  asrResults: unknown[]
  ocrResults: unknown[]
  evidenceMap: unknown
  verdicts: unknown[]
}

export type R7ContractBenchmarkReport = {
  contract: 'r7-contract-benchmark-report/v1'
  passed: boolean
  validArtifacts: number
  validMediaResults: number
  validAsrResults: number
  validOcrResults: number
  traceableSummaryPoints: number
  abstainingNoEvidenceVerdicts: number
  failureResultsWithSyntheticOutput: number
  errors: string[]
}

function validateAll(label: string, values: unknown[], parse: (value: unknown) => unknown, errors: string[]): number {
  let valid = 0
  for (const [index, value] of values.entries()) {
    try {
      parse(value)
      valid += 1
    } catch (error) {
      errors.push(`${label}[${index}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return valid
}

/**
 * Runs an entirely deterministic benchmark over checked-in synthetic objects.
 * It never invokes a provider, reads media, opens a browser, or performs I/O.
 */
export function runR7ContractBenchmark(fixtures: R7SyntheticFixtureSuite): R7ContractBenchmarkReport {
  const errors: string[] = []
  const validArtifacts = validateAll('artifacts', fixtures.artifacts, (value) => mediaArtifactSchema.parse(value), errors)
  const validMediaResults = validateAll('mediaResults', fixtures.mediaResults, (value) => mediaProcessingResultSchema.parse(value), errors)
  const validAsrResults = validateAll('asrResults', fixtures.asrResults, (value) => asrResultSchema.parse(value), errors)
  const validOcrResults = validateAll('ocrResults', fixtures.ocrResults, (value) => ocrResultSchema.parse(value), errors)

  let traceableSummaryPoints = 0
  try {
    const evidenceMap = evidenceMapSchema.parse(fixtures.evidenceMap)
    traceableSummaryPoints = evidenceMap.summaryPoints.length
  } catch (error) {
    errors.push(`evidenceMap: ${error instanceof Error ? error.message : String(error)}`)
  }

  let abstainingNoEvidenceVerdicts = 0
  for (const [index, value] of fixtures.verdicts.entries()) {
    try {
      const result = claimEvidenceVerdictSchema.parse(value)
      if (result.claim.classification === 'factual' && result.evidence.length === 0 && result.verdict === 'insufficient-evidence') {
        abstainingNoEvidenceVerdicts += 1
      }
    } catch (error) {
      errors.push(`verdicts[${index}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const failureResultsWithSyntheticOutput = [
    ...fixtures.mediaResults.map((result) => ({ kind: 'media', result })),
    ...fixtures.asrResults.map((result) => ({ kind: 'asr', result })),
    ...fixtures.ocrResults.map((result) => ({ kind: 'ocr', result }))
  ].filter(({ kind, result }) => {
    if (!result || typeof result !== 'object') return false
    const record = result as Record<string, unknown>
    if (record.status !== 'failed' && record.status !== 'unavailable') return false
    const output = kind === 'media' ? record.artifactRefs : kind === 'asr' ? record.segments : record.blocks
    return Array.isArray(output) && output.length > 0
  }).length

  if (failureResultsWithSyntheticOutput > 0) errors.push('failed or unavailable provider results contain synthetic output')
  if (traceableSummaryPoints === 0) errors.push('fixture suite has no traceable summary point')
  if (abstainingNoEvidenceVerdicts === 0) errors.push('fixture suite does not prove no-evidence abstention')

  return {
    contract: 'r7-contract-benchmark-report/v1',
    passed: errors.length === 0,
    validArtifacts,
    validMediaResults,
    validAsrResults,
    validOcrResults,
    traceableSummaryPoints,
    abstainingNoEvidenceVerdicts,
    failureResultsWithSyntheticOutput,
    errors
  }
}
