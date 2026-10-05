const DAY = 86_400_000
const SHANGHAI_OFFSET = 8 * 3_600_000
export function calendarWeek(at: string | number | Date = Date.now()) {
  const instant = new Date(at).getTime()
  if (!Number.isFinite(instant)) throw new Error('检查时间无效')
  const local = new Date(instant + SHANGHAI_OFFSET)
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    - ((local.getUTCDay() + 6) % 7) * DAY
  const start = new Date(monday - SHANGHAI_OFFSET).toISOString()
  const endExclusive = new Date(monday + 7 * DAY - SHANGHAI_OFFSET).toISOString()
  const date = (time: number) => new Date(time).toISOString().slice(0, 10)
  return { start, endExclusive, startDate: date(monday), endDate: date(monday + 6 * DAY), timeZone: 'Asia/Shanghai' as const }
}
