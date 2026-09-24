const WORK_ID = /^[0-9]{8,30}$/

export function pilotTabDisposition(result, tabId) {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return { keep: false, tabId: null }
  return result?.status === 'verified' || result?.status === 'candidate-only'
    ? { keep: true, tabId }
    : { keep: false, tabId: null }
}

export function pilotSummary(result, tabId, reportDirectory) {
  const disposition = pilotTabDisposition(result, tabId)
  const workId = result?.verifiedWork?.workId
  return {
    status: result?.status ?? 'blocked',
    verifiedWorkId: typeof workId === 'string' && WORK_ID.test(workId) ? workId : null,
    candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
    reason: result?.reason ?? null,
    retainedTabId: disposition.tabId,
    reportDirectory: String(reportDirectory ?? '')
  }
}
