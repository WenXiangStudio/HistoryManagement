export type RankableInboxItem = {
  readState: string
  publishedAt: string | null
  discoveredAt: string
  isCreatorStarred?: boolean
  keywordAffinity?: number
}

export function calculateInboxScore(item: RankableInboxItem, now = Date.now()): number {
  const unreadBoost = item.readState === 'unread' ? 10 : 0
  const timestamp = Date.parse(item.publishedAt || item.discoveredAt)
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000)
  const freshness = Math.max(0, 1 - ageHours / (24 * 14))
  const interest = Math.max(0, Math.min(1, item.keywordAffinity ?? 0))
  const creator = item.isCreatorStarred ? 1 : 0
  return unreadBoost + interest * 0.55 + freshness * 0.25 + creator * 0.2
}

export type MetricSample = {
  likeCount: number | null
  commentCount: number | null
  collectCount: number | null
}

export function performanceLabel(samples: MetricSample[], target: MetricSample): 'high' | 'low' | 'normal' | 'insufficient' {
  if (samples.length < 8) return 'insufficient'
  const keys = ['likeCount', 'commentCount', 'collectCount'] as const
  let high = 0
  let low = 0
  for (const key of keys) {
    if (target[key] === null) continue
    const visible = samples.map((sample) => sample[key]).filter((value): value is number => value !== null).sort((a, b) => a - b)
    if (visible.length < 8) continue
    const rank = visible.filter((value) => value <= target[key]!).length / visible.length
    if (rank >= 0.75) high += 1
    if (rank <= 0.25) low += 1
  }
  if (high >= 2) return 'high'
  if (low >= 2) return 'low'
  return 'normal'
}
