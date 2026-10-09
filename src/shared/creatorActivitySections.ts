import type { CreatorListItem } from './contracts'
import { calendarWeek } from './calendarWeek'

const SHANGHAI_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/** Return the calendar date in Beijing time, independent of the machine's local zone. */
export function shanghaiDateKey(value: string | number | Date = Date.now()): string | null {
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return null
  const parts = Object.fromEntries(SHANGHAI_DATE_PARTS.formatToParts(instant).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Rollover hides old weekly statistics while retaining the last public total. */
export function currentCreatorActivity(creator: CreatorListItem, at: string | number | Date = Date.now()): CreatorListItem {
  const activity = creator.activity
  const week = calendarWeek(at)
  if (!activity || (activity.weekStart === week.start && activity.weekEndExclusive === week.endExclusive)) return creator
  return { ...creator, activity: { ...activity, weekStart: week.start, weekEndExclusive: week.endExclusive,
    weeklyUpdateCount: null, latestPublishedAt: null, weeklyStatus: 'pending', checkedAt: null, errorCode: null } }
}
