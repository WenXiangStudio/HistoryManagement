// Shared by the page script and deterministic offline tests. Elapsed time uses
// a monotonic clock; wall-clock timestamps are only human-readable references.
function createFollowingBatchTimer(requestedCount, clock = {
  now: () => performance.now(), wallNow: () => new Date().toISOString()
}) {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) throw new Error('Invalid timing scope')
  const startedAt = clock.wallNow()
  const start = clock.now()
  let previous = start, active = null, completed = null
  const records = [], identities = new Set()
  const tick = () => {
    const value = clock.now()
    if (!Number.isFinite(value) || value < previous) throw new Error('Elapsed clock must be monotonic')
    previous = value
    return value
  }
  const finishRecord = (success, end) => {
    records.push({ secUid: active.secUid, nickname: active.nickname, startedAt: active.startedAt,
      finishedAt: clock.wallNow(), startedOffsetMs: active.start - start,
      finishedOffsetMs: end - start, elapsedMs: end - active.start, success })
    active = null
  }
  return {
    beginCreator(secUid, nickname) {
      if (completed || active) throw new Error('Timing session is not ready for another author')
      if (!secUid || !nickname || identities.has(secUid)) throw new Error('Duplicate or missing timed author identity')
      if (identities.size >= requestedCount) throw new Error('Timed author limit exceeded')
      identities.add(secUid)
      active = { secUid, nickname, start: tick(), startedAt: clock.wallNow() }
    },
    finishCreator() {
      if (!active || completed) throw new Error('No active author timing')
      finishRecord(true, tick())
    },
    finish(status = 'completed') {
      if (completed) return structuredClone(completed)
      if (!['completed','failed'].includes(status)) throw new Error('Unknown timing status')
      const end = tick()
      if (active) finishRecord(false, end)
      const successful = records.filter(record => record.success)
      if (status === 'completed' && successful.length !== requestedCount) throw new Error('Timed batch did not complete its requested scope')
      const totalMs = end - start
      const authorProcessingMs = records.reduce((sum, record) => sum + record.elapsedMs, 0)
      completed = { contract: 'signaldesk-following-timing/v1', status, requestedCount,
        startedAt, finishedAt: clock.wallNow(), clock: 'monotonic',
        scope: 'page acquisition including verification, discovery, deduplication, scrolling and avatar loading; excludes database and APP',
        perCreatorScope: 'author card verification and field read after shared discovery, including scroll and avatar waiting',
        totalMs, successfulCount: successful.length,
        averageMsPerCreator: successful.length ? totalMs / successful.length : null,
        authorProcessingMs, sharedOverheadMs: totalMs - authorProcessingMs,
        records: records.map(record => ({ ...record })) }
      return structuredClone(completed)
    }
  }
}
