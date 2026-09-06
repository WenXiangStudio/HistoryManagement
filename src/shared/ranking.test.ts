import { describe, expect, it } from 'vitest'
import { calculateInboxScore, performanceLabel } from './ranking'

describe('calculateInboxScore', () => {
  it('prioritizes unread and matching content', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z')
    const relevant = calculateInboxScore({ readState: 'unread', publishedAt: '2026-08-27T11:00:00.000Z', discoveredAt: '2026-08-27T11:00:00.000Z', keywordAffinity: 1 }, now)
    const oldRead = calculateInboxScore({ readState: 'read', publishedAt: '2026-01-01T00:00:00.000Z', discoveredAt: '2026-01-01T00:00:00.000Z', keywordAffinity: 0 }, now)
    expect(relevant).toBeGreaterThan(oldRead)
  })
})

describe('performanceLabel', () => {
  const samples = Array.from({ length: 12 }, (_, index) => ({ likeCount: index * 10, commentCount: index, collectCount: index * 2 }))

  it('requires a sufficient sample', () => {
    expect(performanceLabel(samples.slice(0, 7), samples[6])).toBe('insufficient')
  })

  it('uses at least two visible metric quartiles', () => {
    expect(performanceLabel(samples, samples[11])).toBe('high')
    expect(performanceLabel(samples, samples[0])).toBe('low')
  })
})
