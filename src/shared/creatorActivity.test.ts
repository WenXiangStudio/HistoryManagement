import {describe,it,expect,vi,afterEach} from 'vitest'
import {acceptCreatorActivity,calendarWeek,type CreatorActivityCapture} from './creatorActivity'
const expected={ownerSecUid:'owner',secUid:'author-sec',uid:'author-uid',weekStart:'2026-09-27T16:00:00.000Z',weekEndExclusive:'2026-10-04T16:00:00.000Z'}
const item=(id:string,time:string,pinned:boolean|null=false)=>({workId:id,authorUid:'author-uid',authorSecUid:'author-sec',publishedAt:time,pinned,publicVisible:true as const})
function capture():CreatorActivityCapture{return {contract:'signaldesk-creator-activity/v2',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:'owner',requestedSecUid:'author-sec',
  profile:{uid:'author-uid',secUid:'author-sec',workCount:224},checkedAt:'2026-10-03T12:00:00.000Z',weekStart:expected.weekStart,weekEndExclusive:expected.weekEndExclusive,
  pages:[{requestCursor:0,responseCursor:100,hasMore:true,excludedAuthors:[],excludedNonPublic:[],items:[item('700000001','2026-07-01T00:00:00.000Z',true),item('700000002','2026-10-03T04:00:00.000Z'),item('700000003','2026-09-27T15:59:59.000Z')]}],
  errorCode:null,activeApiRequests:2,acquisitionMs:100}}
afterEach(()=>vi.useRealTimers())
describe('Shanghai calendar weeks and source-backed creator activity',()=>{
  it('uses Monday through Sunday in Shanghai across UTC, year boundaries and rollover',()=>{
    expect(calendarWeek('2026-10-03T12:00:00Z')).toMatchObject({start:expected.weekStart,endExclusive:expected.weekEndExclusive,startDate:'2026-09-28',endDate:'2026-10-04'})
    expect(calendarWeek('2026-10-04T15:59:59Z').start).toBe(expected.weekStart)
    expect(calendarWeek('2026-10-04T16:00:00Z').startDate).toBe('2026-10-05')
    expect(calendarWeek('2027-01-01T00:00:00Z')).toMatchObject({startDate:'2026-12-28',endDate:'2027-01-03'})
  })
  it('ignores old pin order and uses actual publication times with an inclusive Monday boundary',()=>{
    const result=acceptCreatorActivity(capture(),expected).snapshot
    expect(result).toMatchObject({workCount:null,weeklyUpdateCount:1,latestPublishedAt:'2026-10-03T04:00:00.000Z',weeklyStatus:'updated',coverage:'week-boundary',errorCode:'PUBLIC_LIST_INCOMPLETE'})
    const value=capture();value.pages[0].items[1].publishedAt=expected.weekStart
    expect(acceptCreatorActivity(value,expected).snapshot.latestPublishedAt).toBe(expected.weekStart)
  })
  it('accepts a complete public empty list even when the profile reports private or hidden works',()=>{
    const value=capture();value.pages[0].items=value.pages[0].items.filter(row=>row.workId!=='700000002')
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({weeklyStatus:'empty',weeklyUpdateCount:0})
    value.pages[0]={requestCursor:0,responseCursor:0,hasMore:false,excludedAuthors:[],excludedNonPublic:[],items:[]}
    value.profile.workCount=2
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({weeklyStatus:'empty',workCount:0,weeklyUpdateCount:0})
  })
  it('does not declare an unordered, unmarked, interrupted or scope-limited scan complete',()=>{
    const value=capture();value.pages[0].items.push(item('700000004','2026-10-02T00:00:00.000Z'))
    expect(acceptCreatorActivity(value,expected).snapshot.weeklyStatus).toBe('partial')
    const unmarked=capture();unmarked.pages[0].items[0].pinned=null
    expect(acceptCreatorActivity(unmarked,expected).snapshot.weeklyStatus).toBe('partial')
    const failed=capture();failed.errorCode='ACTIVITY_PAGE_LIMIT'
    expect(acceptCreatorActivity(failed,expected).snapshot).toMatchObject({weeklyStatus:'partial',weeklyUpdateCount:null,latestPublishedAt:'2026-10-03T04:00:00.000Z'})
  })
  it('rejects owner, author, pagination, future timestamps and wrong week before persistence',()=>{
    expect(()=>acceptCreatorActivity(capture(),{...expected,ownerSecUid:'other'})).toThrow('归属')
    const author=capture();author.pages[0].items[1].authorUid='other'
    expect(()=>acceptCreatorActivity(author,expected)).toThrow('归属')
    const cursor=capture();cursor.pages[0].requestCursor=1
    expect(()=>acceptCreatorActivity(cursor,expected)).toThrow('分页')
    const future=capture();future.pages[0].items[1].publishedAt='2026-10-05T01:00:00.000Z'
    expect(()=>acceptCreatorActivity(future,expected)).toThrow('检查时间')
    expect(()=>acceptCreatorActivity(capture(),{...expected,weekStart:'2026-09-28T16:00:00.000Z'})).toThrow('边界')
  })
  it('rejects unverified visibility and counts the public list independently of the profile total',()=>{
    const invalid=capture() as any;invalid.pages[0].items[0].publicVisible=false
    expect(()=>acceptCreatorActivity(invalid,expected)).toThrow()
    const wrongCount=capture();wrongCount.profile.workCount=1;wrongCount.pages[0].hasMore=false
    expect(acceptCreatorActivity(wrongCount,expected).snapshot).toMatchObject({workCount:3,errorCode:null,workCountSource:'public-list'})
    wrongCount.profile.workCount=9999
    expect(acceptCreatorActivity(wrongCount,expected).snapshot.workCount).toBe(3)
  })
  it('records foreign authors separately and never attributes their publication dates to the target',()=>{
    const value=capture();value.pages[0].excludedAuthors=[{workId:'800000001',authorUid:'foreign-uid',authorSecUid:'foreign-sec'}]
    expect(acceptCreatorActivity(value,expected).snapshot.latestPublishedAt).toBe('2026-10-03T04:00:00.000Z')
    value.pages[0].excludedAuthors[0].authorUid='author-uid'
    expect(()=>acceptCreatorActivity(value,expected)).toThrow('冲突')
  })
  it('counts unique public works across pages, includes current-week pins and skips future or next-week times',()=>{
    const value=capture(),pinned=item('700000004','2026-10-02T01:00:00.000Z',true),recent=value.pages[0].items[1]
    value.pages[0].items=[pinned,recent]
    value.pages.push({requestCursor:100,responseCursor:200,hasMore:true,excludedAuthors:[],excludedNonPublic:[],items:[pinned,item('700000005','2026-09-28T02:00:00.000Z'),item('700000006','2026-09-27T15:59:59.000Z')]})
    value.activeApiRequests=3
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({weeklyUpdateCount:3,latestPublishedAt:recent.publishedAt,coverage:'week-boundary'})
    const future=capture();future.pages[0].items.unshift(item('700000007','2026-10-03T12:00:30.000Z',true))
    expect(acceptCreatorActivity(future,expected).snapshot.weeklyUpdateCount).toBe(1)
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T01:00:00.000Z'))
    future.checkedAt='2026-10-04T16:00:30.000Z';future.pages[0].items[0].publishedAt=expected.weekEndExclusive
    expect(acceptCreatorActivity(future,expected).snapshot.weeklyUpdateCount).toBe(1)
  })
  it('deduplicates the full public list, excluding proven foreign and non-public works from both counts',()=>{
    const value=capture();value.contract='signaldesk-creator-activity/v3'
    value.pages[0].excludedNonPublic=[{workId:'800000002',authorUid:'author-uid',authorSecUid:'author-sec',reason:'private'}]
    value.pages[0].excludedAuthors=[{workId:'800000003',authorUid:'foreign-uid',authorSecUid:'foreign-sec'}]
    value.pages.push({requestCursor:100,responseCursor:200,hasMore:false,excludedAuthors:[],excludedNonPublic:[],
      items:[value.pages[0].items[0],item('700000009','2026-05-01T00:00:00.000Z')]})
    value.activeApiRequests=3
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:4,weeklyUpdateCount:1,coverage:'list-end',errorCode:null})
    value.pages[1].items.push(item('800000002','2026-10-02T00:00:00.000Z'))
    expect(()=>acceptCreatorActivity(value,expected)).toThrow('可见性')
  })
  it('never uses a partial or interrupted list as a public total, including profile zero',()=>{
    const value=capture();value.profile.workCount=0;value.errorCode='ACTIVITY_HTTP_500'
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:null,weeklyUpdateCount:null})
    value.pages=[];value.activeApiRequests=2
    expect(acceptCreatorActivity(value,expected).snapshot.workCount).toBeNull()
    const empty=capture();empty.pages[0].items=[]
    expect(()=>acceptCreatorActivity(empty,expected)).toThrow('新记录')
  })
  it('takes a v4 total only from the rendered works tab, independent of API total and weekly coverage',()=>{
    const value=capture();value.contract='signaldesk-creator-activity/v4';value.activeApiRequests=1
    value.frontendCount={count:18,text:'18',profileUrl:'https://www.douyin.com/user/author-sec',secUid:'author-sec',
      checkedAt:value.checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'}
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,workCountSource:'profile-tab',weeklyUpdateCount:1,errorCode:null})
    value.errorCode='ACTIVITY_HTTP_500'
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyStatus:'partial'})
    value.errorCode=null;value.pages[0].items=[];value.pages[0].hasMore=false;value.frontendCount.count=0;value.frontendCount.text='0'
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:0,weeklyUpdateCount:0,weeklyStatus:'empty',errorCode:null})
  })
  it('rejects a count from another page or altered text, and leaves missing frontend counts unknown',()=>{
    const value=capture();value.contract='signaldesk-creator-activity/v4';value.activeApiRequests=1
    value.frontendCount={count:18,text:'19',profileUrl:'https://www.douyin.com/user/author-sec',secUid:'author-sec',
      checkedAt:value.checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'}
    expect(()=>acceptCreatorActivity(value,expected)).toThrow('计数')
    value.frontendCount.text='18';value.frontendCount.profileUrl='https://www.douyin.com/user/other'
    expect(()=>acceptCreatorActivity(value,expected)).toThrow('归属')
    value.frontendCount={count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}
    expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:null,weeklyUpdateCount:1,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'})
  })
})
