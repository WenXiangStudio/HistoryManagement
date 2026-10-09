import { describe, expect, it } from 'vitest'
import type { CreatorListItem } from './contracts'
import { currentCreatorActivity, shanghaiDateKey } from './creatorActivitySections'

function creator(id: number, activity?: Partial<NonNullable<CreatorListItem['activity']>>): CreatorListItem {
  return {
    id, isDemo: false, platformCreatorId: `creator-${id}`, nickname: `博主${id}`, avatarUrl: null,
    signature: '', profileUrl: `https://www.douyin.com/user/sec-${id}`, isFollowing: true,
    isStarred: false, note: '', domains: [], workCount: 0, analyzedCount: 0, lastPublishedAt: null,
    activity: {
      workCount: 20, countCheckedAt: '2026-10-03T08:00:00.000Z', checkedAt: '2026-10-03T08:00:00.000Z',
      weeklyUpdateCount: 1, weekStart: '2026-09-27T16:00:00.000Z', weekEndExclusive: '2026-10-04T16:00:00.000Z',
      latestPublishedAt: '2026-10-03T03:00:00.000Z', weeklyStatus: 'updated', errorCode: null, lastAttemptAt: null,
      ...activity
    }
  }
}

describe('creator activity calendar projection', () => {
  it('uses Beijing date boundaries independently of machine timezone', () => {
    expect(shanghaiDateKey('2026-10-03T15:59:59.999Z')).toBe('2026-10-03')
    expect(shanghaiDateKey('2026-10-03T16:00:00.000Z')).toBe('2026-10-04')
  })

  it('rolls the old week into pending without changing saved public totals, notes or stars', () => {
    const saved=creator(1); saved.isStarred=true; saved.note='保留的批注'
    const original=JSON.stringify(saved)
    expect(currentCreatorActivity(saved, '2026-10-04T15:59:59Z')).toBe(saved)
    expect(currentCreatorActivity(saved, '2026-10-04T16:00:00Z')).toMatchObject({isStarred:true,note:'保留的批注',activity:{
      workCount:20,countCheckedAt:'2026-10-03T08:00:00.000Z',checkedAt:null,weeklyUpdateCount:null,latestPublishedAt:null,weeklyStatus:'pending'
    }})
    expect(JSON.stringify(saved)).toBe(original)
  })
})
