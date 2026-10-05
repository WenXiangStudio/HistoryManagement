import type { CreatorListItem } from './contracts'
import { calendarWeek } from './calendarWeek'

export type CreatorActivitySection = 'today' | 'week' | 'none'

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

/** Today's verified publication takes priority; a complete positive weekly count is required for the middle. */
export function creatorActivitySection(creator: CreatorListItem, at: string | number | Date = Date.now()): CreatorActivitySection {
  const activity = currentCreatorActivity(creator, at).activity
  if (!activity || !activity.latestPublishedAt) return 'none'
  const published = Date.parse(activity.latestPublishedAt), instant = new Date(at).getTime()
  if (!Number.isFinite(published) || published < Date.parse(activity.weekStart)
    || published >= Date.parse(activity.weekEndExclusive) || published > instant) return 'none'
  if (shanghaiDateKey(published) === shanghaiDateKey(at)) return 'today'
  if (activity.weeklyUpdateCount === null || activity.weeklyUpdateCount === undefined || activity.weeklyUpdateCount < 1) return 'none'
  return 'week'
}

export function partitionCreatorActivity(creators: CreatorListItem[], at: string | number | Date = Date.now()): Record<CreatorActivitySection, CreatorListItem[]> {
  const sections: Record<CreatorActivitySection, CreatorListItem[]> = { today: [], week: [], none: [] }
  for (const creator of creators) {
    const current = currentCreatorActivity(creator, at)
    sections[creatorActivitySection(current, at)].push(current)
  }
  return sections
}
