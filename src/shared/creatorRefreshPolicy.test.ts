import {describe,it,expect} from 'vitest'
import {creatorRefreshSchedule,creatorRefreshTier,DEFAULT_CREATOR_REFRESH_PACING,latestWorkFingerprint,assessRecentActivity,creatorAutomaticTier,effectiveCreatorTier,creatorsForRefreshScope} from './creatorRefreshPolicy'
import type {CreatorActivityCapture} from './creatorActivity'

describe('creator refresh frequency',()=>{
  const now='2026-10-07T04:00:00.000Z'
  it('checks four frequencies daily, weekly, fortnightly and every thirty days',()=>{
    expect(creatorRefreshSchedule('2026-10-06T00:00:00Z','2026-10-06T08:00:00Z',24,now)).toMatchObject({tier:'active',intervalDays:1,due:true,latestKnownPublishedAt:'2026-10-06T00:00:00Z'})
    expect(creatorRefreshSchedule('2026-10-06T00:00:00Z','2026-10-06T08:00:00Z',14*24,now)).toMatchObject({tier:'regular',intervalDays:7,due:false,nextDueAt:'2026-10-12T16:00:00.000Z'})
    expect(creatorRefreshSchedule('2026-10-06T00:00:00Z','2026-10-06T08:00:00Z',30*24,now)).toMatchObject({tier:'inactive',intervalDays:14,due:false,nextDueAt:'2026-10-19T16:00:00.000Z'})
  })
  it('uses Beijing date boundaries and makes unknown data due for its first check',()=>{
    expect(creatorRefreshSchedule('2026-10-06T00:00:00Z','2026-10-06T15:59:59Z',24,'2026-10-06T15:59:59Z').due).toBe(false)
    expect(creatorRefreshSchedule('2026-10-06T00:00:00Z','2026-10-06T15:59:59Z',24,'2026-10-06T16:00:00Z').due).toBe(true)
    expect(creatorRefreshSchedule(null,null,null,now)).toMatchObject({tier:'unknown',intervalDays:1,due:true})
    expect(creatorRefreshSchedule('invalid','invalid',null,now).due).toBe(true)
  })
  it.each([[0,'active'],[168,'active'],[168.001,'regular'],[336,'regular'],[336.001,'inactive'],[720,'inactive'],[720.001,'dormant'],[null,'unknown'],[undefined,'unknown'],[NaN,'unknown'],[-1,'unknown']] as const)('classifies %s hours as %s without rounding',(hours,tier)=>{
    expect(creatorRefreshTier(hours)).toBe(tier)
  })
  it('requires publication within 168 hours of successful verification and freezes that result across clock changes',()=>{
    const checked='2026-10-09T04:00:00.000Z'
    expect(assessRecentActivity('2026-10-02T04:00:00.000Z',checked).status).toBe('updated')
    expect(assessRecentActivity('2026-10-02T03:59:59.000Z',checked).status).toBe('empty')
    expect(assessRecentActivity(null,checked).status).toBe('unknown')
    expect(assessRecentActivity(null,checked,true).status).toBe('empty')
    const creator={activity:{publicationInterval:{meanHours:24},recentActivity:assessRecentActivity('2026-05-13T00:00:00.000Z',checked)}} as any
    expect(creatorAutomaticTier(creator)).toBe('dormant')
    expect(creatorRefreshSchedule('2026-10-08T00:00:00Z',checked,24,'2027-01-01').tier).toBe('active')
    expect(creatorRefreshSchedule('2026-10-08T00:00:00Z',checked,721,checked).intervalDays).toBe(30)
  })
  it.each([24,14*24,30*24,null])('prioritizes over-thirty-day inactivity for %s-hour intervals in both cards and schedules',meanHours=>{
    const checked='2026-10-09T04:00:00.000Z',latest='2026-09-09T03:59:59.000Z'
    const creator={isDemo:false,activity:{publicationInterval:{meanHours},recentActivity:assessRecentActivity(latest,checked)}} as any
    expect(creatorAutomaticTier(creator)).toBe('dormant')
    expect(creatorRefreshSchedule(latest,checked,meanHours,checked)).toMatchObject({tier:'dormant',intervalDays:30})
    expect(creatorsForRefreshScope([creator],'regular')).toHaveLength(0)
    expect(creatorsForRefreshScope([creator],'all')).toHaveLength(1)
    creator.refreshPriority={mode:'boost',tier:'inactive',revision:1}
    expect(effectiveCreatorTier(creator)).toBe('inactive')
    expect(creatorRefreshSchedule(latest,checked,meanHours,checked,creator.refreshPriority)).toMatchObject({tier:'inactive',intervalDays:14})
    creator.refreshPriority={mode:null,tier:null,revision:2}
    expect(effectiveCreatorTier(creator)).toBe('dormant')
  })
  it('includes exactly thirty days in the recent month and does not infer month-long inactivity from missing verification',()=>{
    const checked='2026-10-09T04:00:00.000Z',latest='2026-09-09T04:00:00.000Z'
    for(const [hours,tier] of [[24,'regular'],[14*24,'regular'],[30*24,'inactive']] as const){
      expect(creatorRefreshSchedule(latest,checked,hours,'2027-01-01').tier).toBe(tier)
      expect(creatorAutomaticTier({activity:{publicationInterval:{meanHours:hours},recentActivity:assessRecentActivity(latest,checked)}} as any)).toBe(tier)
    }
    for(const recent of [assessRecentActivity(null,checked),assessRecentActivity(latest,null),assessRecentActivity(latest,'invalid'),{checkedAt:checked,latestPublishedAt:'2026-05-01T00:00:00Z',status:'unknown'}]){
      expect(creatorAutomaticTier({activity:{publicationInterval:{meanHours:24},recentActivity:recent}} as any)).toBe('unknown')
    }
    expect(creatorAutomaticTier({activity:{publicationInterval:{meanHours:null},recentActivity:assessRecentActivity(null,checked,true)}} as any)).toBe('unknown')
  })
  it('splits 295 creators into nine batches with the agreed bounded waits',()=>{
    expect(Math.ceil(295/DEFAULT_CREATOR_REFRESH_PACING.batchSize)).toBe(9)
    expect(DEFAULT_CREATOR_REFRESH_PACING).toMatchObject({authorDelayMinMs:3000,authorDelayMaxMs:8000,batchDelayMinMs:180000,batchDelayMaxMs:300000})
  })
})

describe('latest-work small snapshot',()=>{
  const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}
  const record=(id:string,time:string,pinned=false)=>({workId:id,authorUid:'uid',authorSecUid:'sec',publishedAt:time,pinned,visibility})
  const capture=(records:unknown[],hasMore=true)=>({profile:{uid:'uid',secUid:'sec'},pages:[{requestCursor:0,records,hasMore}]} as CreatorActivityCapture)
  it('uses publication time rather than pinned display position, and ignores foreign authors',()=>{
    const foreign={...record('700000009','2026-10-07T02:00:00Z'),authorUid:'foreign',authorSecUid:'foreign-sec'}
    expect(latestWorkFingerprint(capture([record('700000001','2026-07-01T00:00:00Z',true),foreign,record('700000002','2026-10-06T00:00:00Z')]))).toEqual({ready:true,latest:{workId:'700000002',publishedAt:'2026-10-06T00:00:00Z'}})
  })
  it('recognizes a genuine empty end, but rejects unknown visibility and all-pinned incomplete pages',()=>{
    expect(latestWorkFingerprint(capture([],false))).toEqual({ready:true,latest:null})
    expect(latestWorkFingerprint(capture([record('700000001','2026-07-01T00:00:00Z',true)])).ready).toBe(false)
    expect(latestWorkFingerprint(capture([{...record('700000001','2026-07-01T00:00:00Z'),visibility:{...visibility,privateStatus:null}}])).ready).toBe(false)
  })
})
