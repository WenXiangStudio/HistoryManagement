import {describe,it,expect} from 'vitest'
import {type CreatorActivityCapture} from './creatorActivity'
import {assessCreatorBaseline,baselineBatchSizes} from './creatorActivityBaseline'
import {creatorAutomaticTier} from './creatorRefreshPolicy'
const checked='2026-10-14T04:00:00.000Z',policy={limit:60 as const,windowDays:180 as const,windowStart:'2026-04-17T04:00:00.000Z'}
function capture(count=80):CreatorActivityCapture{
 const record=(i:number,pinned=false)=>({workId:String(700000000+i),authorUid:'uid',authorSecUid:'sec',profileOwner:{uid:'uid',secUid:'sec'},
  publishedAt:new Date(Date.parse(checked)-(pinned?300:i)*86400000).toISOString(),pinned,
  visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}})
 return {contract:'signaldesk-creator-activity/v9',ownerSecUid:'owner',requestedSecUid:'sec',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},
  profile:{uid:'uid',secUid:'sec',workCount:null},frontendCount:{count:999,text:'999',profileUrl:'https://www.douyin.com/user/sec',secUid:'sec',checkedAt:checked,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
  checkedAt:checked,weekStart:'2026-10-11T16:00:00.000Z',weekEndExclusive:'2026-10-18T16:00:00.000Z',errorCode:null,activeApiRequests:1,reusedNativePages:0,nativeListRequests:0,acquisitionMs:10,
  pages:[{requestCursor:0,responseCursor:100,hasMore:true,items:[],excludedAuthors:[],excludedNonPublic:[],records:[record(100,true),...Array.from({length:count},(_,i)=>record(i))],
  sourceProof:{kind:'active-get',secUid:'sec',requestCursor:0,endpoint:'/aweme/v1/web/aweme/post/',method:'GET',httpStatus:200,observedAt:checked}}]}
}
describe('continuous recent activity baseline',()=>{
 it('collects and measures old publications without a date cutoff while reporting zero recent updates',()=>{
  const c=capture(80)
  for(const record of c.pages[0].records!)record.publishedAt=new Date(Date.parse(record.publishedAt!)-400*86400000).toISOString()
  const r=assessCreatorBaseline(c,{version:2,limit:60},-1,'半年未更新')
  expect(r).toMatchObject({version:2,sampleCount:60,sampleQuality:'sufficient',interval:{workCount:60,meanHours:24},daysSinceLatest:400,
    recentCounts:[{days:30,count:0,complete:true},{days:90,count:0,complete:true},{days:180,count:0,complete:true}]})
  expect(()=>assessCreatorBaseline(capture(20),{version:2,limit:60},-1,'不足')).toThrow('INCOMPLETE')
 })
 it('distinguishes lower-bound recent counts and limited samples from a complete window',()=>{
  const r=assessCreatorBaseline(capture(80),{version:2,limit:60},-1,'高频')
  expect(r.recentCounts).toEqual([{days:30,count:31,complete:true},{days:90,count:80,complete:false},{days:180,count:80,complete:false}])
  const few=capture(5);few.pages[0].hasMore=false
  const result=assessCreatorBaseline(few,{version:2,limit:60},-1,'少量')
  expect(result).toMatchObject({sampleCount:6,sampleQuality:'limited',stopReason:'list-end'})
  expect(result.workIds).toContain('700000100')
  expect(result.recentCounts?.every(c=>c.complete)).toBe(true)
 })
 it('makes eleven balanced batches covering each of 302 identities once',()=>{expect(baselineBatchSizes(302)).toEqual([28,28,28,28,28,27,27,27,27,27,27])})
 it('excludes old pins, retains the full observation and selects the newest sixty by date',()=>{
  const c=capture(),r=assessCreatorBaseline(c,policy,-1,'测试')
  expect(r).toMatchObject({collectedCount:81,recentCount:60,stopReason:'limit',interval:{gapCount:59,meanHours:24}})
  expect(c.pages[0].records).toHaveLength(81);expect(r.workIds).not.toContain('700000100');expect(r.prefixIntervals.map(p=>p.meanHours)).toEqual([24,24,24])
 })
 it('rejects insufficient traversal, reversed ordinary dates, uncertain visibility and wrong homepage attribution',()=>{
  expect(()=>assessCreatorBaseline(capture(20),policy,-1,'测试')).toThrow('INCOMPLETE')
  const c=capture();[c.pages[0].records![1],c.pages[0].records![2]]=[c.pages[0].records![2],c.pages[0].records![1]]
  expect(()=>assessCreatorBaseline(c,policy,-1,'测试')).toThrow('ORDER_UNVERIFIED')
  const unknown=capture();unknown.pages[0].records![1].visibility.privateStatus=null
  expect(()=>assessCreatorBaseline(unknown,policy,-1,'测试')).toThrow('ORDER_UNVERIFIED')
  const wrong=capture();wrong.pages[0].records![1].profileOwner!.secUid='other'
  expect(()=>assessCreatorBaseline(wrong,policy,-1,'测试')).toThrow('AUTHOR_MISMATCH')
 })
 it('accepts complete zero/one-work lists with null interval, and terminates at a proven time boundary',()=>{
  for(const n of [0,1]){const c=capture(n);c.pages[0].records=c.pages[0].records!.slice(1);c.pages[0].hasMore=false
   const r=assessCreatorBaseline(c,policy,-1,'测试');expect(r.interval.meanHours).toBeNull();expect(r.recentCount).toBe(n)}
  const c=capture(2);c.pages[0].records![2].publishedAt='2025-10-10T00:00:00.000Z'
  expect(assessCreatorBaseline(c,policy,-1,'测试')).toMatchObject({stopReason:'window',recentCount:1})
 })
 it('uses trial frequency with verified recent inactivity and preserves history separately',()=>{
  const creator={} as any
  creator.activity={publicationInterval:{meanHours:1000},recentBaseline:{interval:{meanHours:24}},recentActivity:{checkedAt:checked,latestPublishedAt:checked,status:'updated'}}
  expect(creatorAutomaticTier(creator)).toBe('active');expect(creator.activity.publicationInterval.meanHours).toBe(1000)
 })
})
