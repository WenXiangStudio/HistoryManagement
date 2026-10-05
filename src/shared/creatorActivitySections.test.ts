import { describe, expect, it } from 'vitest'
import type { CreatorListItem } from './contracts'
import { creatorActivitySection, currentCreatorActivity, partitionCreatorActivity, shanghaiDateKey } from './creatorActivitySections'

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

describe('creator activity sections', () => {
  it('moves today to the middle at Beijing midnight within the same week', () => {
    expect(shanghaiDateKey('2026-10-03T15:59:59.999Z')).toBe('2026-10-03')
    expect(shanghaiDateKey('2026-10-03T16:00:00.000Z')).toBe('2026-10-04')
    expect(creatorActivitySection(creator(1), '2026-10-03T15:59:59.999Z')).toBe('today')
    expect(creatorActivitySection(creator(1), '2026-10-03T16:00:00.000Z')).toBe('week')
  })

  it('keeps a same-day weekly-only update in the top section', () => {
    expect(creatorActivitySection(creator(2, { weeklyUpdateCount: 1, latestPublishedAt: '2026-10-03T15:59:59.999Z' }), '2026-10-03T15:59:59.999Z')).toBe('today')
  })

  it('puts unknown and zero-update records in the remaining section', () => {
    expect(creatorActivitySection(creator(3, { weeklyUpdateCount: null, weeklyStatus: 'partial', latestPublishedAt: '2026-10-02T03:00:00.000Z' }), '2026-10-03T08:00:00Z')).toBe('none')
    expect(creatorActivitySection(creator(4, { weeklyUpdateCount: 0, weeklyStatus: 'empty', latestPublishedAt: null }), '2026-10-03T08:00:00Z')).toBe('none')
    const missing = creator(5); delete missing.activity
    expect(creatorActivitySection(missing, '2026-10-03T08:00:00Z')).toBe('none')
  })

  it('uses a verified publication as evidence for today even with incomplete weekly coverage', () => {
    expect(creatorActivitySection(creator(1, {weeklyUpdateCount:null,weeklyStatus:'partial'}), '2026-10-03T08:00:00Z')).toBe('today')
  })

  it('rejects invalid, future and out-of-week publication times', () => {
    for (const latestPublishedAt of ['invalid', '2026-10-03T15:00:00Z', '2026-09-27T15:59:59Z', '2026-10-04T16:00:00Z']) {
      expect(creatorActivitySection(creator(1, {latestPublishedAt}), '2026-10-03T08:00:00Z')).toBe('none')
    }
    expect(creatorActivitySection(creator(1, {latestPublishedAt:null}), '2026-10-03T08:00:00Z')).toBe('none')
  })

  it('rolls the old week into pending without changing saved public totals, notes or stars', () => {
    const saved=creator(1); saved.isStarred=true; saved.note='保留的批注'
    const original=JSON.stringify(saved)
    expect(creatorActivitySection(saved, '2026-10-04T15:59:59Z')).toBe('week')
    expect(creatorActivitySection(saved, '2026-10-04T16:00:00Z')).toBe('none')
    expect(currentCreatorActivity(saved, '2026-10-04T16:00:00Z')).toMatchObject({isStarred:true,note:'保留的批注',activity:{
      workCount:20,countCheckedAt:'2026-10-03T08:00:00.000Z',checkedAt:null,weeklyUpdateCount:null,latestPublishedAt:null,weeklyStatus:'pending'
    }})
    expect(JSON.stringify(saved)).toBe(original)
  })

  it('partitions without changing the saved creator order within each section', () => {
    const result = partitionCreatorActivity([
      creator(1), creator(2, { latestPublishedAt: '2026-10-02T03:00:00.000Z' }), creator(3, { weeklyUpdateCount: 0, latestPublishedAt: null }), creator(4)
    ], '2026-10-03T08:00:00Z')
    expect(result.today.map(item => item.id)).toEqual([1, 4])
    expect(result.week.map(item => item.id)).toEqual([2])
    expect(result.none.map(item => item.id)).toEqual([3])
  })

  it('matches the 100-creator example with no duplication or lost cards', () => {
    const rows=Array.from({length:100},(_,index)=>creator(index+1,{weeklyUpdateCount:0,latestPublishedAt:null,weeklyStatus:'empty'}))
    for(const id of [24,26,99])rows[id-1]=creator(id)
    for(const id of [22,36])rows[id-1]=creator(id,{latestPublishedAt:'2026-10-02T03:00:00Z'})
    const result=partitionCreatorActivity(rows,'2026-10-03T08:00:00Z')
    expect(result.today.map(item=>item.id)).toEqual([24,26,99])
    expect(result.week.map(item=>item.id)).toEqual([22,36])
    expect(result.none).toHaveLength(95)
    expect(new Set(Object.values(result).flat().map(item=>item.id)).size).toBe(100)
    const tomorrow=partitionCreatorActivity(rows,'2026-10-03T16:00:00Z')
    expect(tomorrow.today).toHaveLength(0)
    expect(tomorrow.week.map(item=>item.id)).toEqual([22,24,26,36,99])
  })
})
