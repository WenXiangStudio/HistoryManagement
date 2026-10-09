import {describe,it,expect} from 'vitest'
import {creatorPublicationInterval,formatPublicationInterval,meanCreatorPublicationInterval,type CreatorPublicationSource} from './creatorPublicationInterval'
const visibility={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}
const record=(id:number,publishedAt:string)=>({workId:String(700000000+id),authorUid:'uid',authorSecUid:'sec',publishedAt,pinned:false,visibility})
const source=(records:NonNullable<CreatorPublicationSource['pages'][number]['records']>,observedAt='2026-10-08T00:00:00.000Z'):CreatorPublicationSource=>({authorUid:'uid',authorSecUid:'sec',observedAt,
  pages:[{requestCursor:0,responseCursor:0,hasMore:false,items:[],records,excludedAuthors:[],excludedNonPublic:[]}]})
describe('per-author publication intervals from retained local works',()=>{
  it('uses a proven new complete public list for current membership without changing retained source evidence',()=>{
    const old=source(Array.from({length:11},(_,i)=>record(i+1,`2026-05-${String(i+1).padStart(2,'0')}T00:00:00.000Z`)))
    const recent={...source([1,2,3,4,5,6].map(i=>record(i,`2026-05-${String(i).padStart(2,'0')}T00:00:00.000Z`)),'2026-10-09T00:00:00.000Z'),completePublicList:true}
    expect(creatorPublicationInterval([recent,old],'uid','sec')).toMatchObject({workCount:6,meanHours:24,latestPublishedAt:'2026-05-06T00:00:00.000Z'})
    expect(old.pages[0].records).toHaveLength(11)
    expect(creatorPublicationInterval([old,{...recent,completePublicList:false}],'uid','sec').workCount).toBe(11)
    expect(creatorPublicationInterval([old,{...recent,authorUid:'foreign'}],'uid','sec').workCount).toBe(11)
  })
  it('sorts publication timestamps including pinned works and uses n-1 adjacent gaps for the corrected example',()=>{
    const interval=creatorPublicationInterval([source([
      {...record(4,'2026-10-06T16:00:00.000Z'),pinned:true},record(2,'2026-04-29T16:00:00.000Z'),
      record(1,'2026-04-25T16:00:00.000Z'),record(3,'2026-07-20T16:00:00.000Z')])],'uid','sec')
    expect(interval).toMatchObject({workCount:4,gapCount:3,meanHours:1312})
    expect(formatPublicationInterval(interval.meanHours)).toBe('54天16小时')
  })
  it('deduplicates works across historical pages and checks, and applies the most recent valid publication observation',()=>{
    const a=source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-02T00:00:00.000Z')],'2026-10-03T00:00:00.000Z')
    const b=source([record(2,'2026-10-03T00:00:00.000Z'),record(3,'2026-10-04T00:00:00.000Z')])
    const interval=creatorPublicationInterval([b,a,b],'uid','sec')
    expect(interval).toMatchObject({workCount:3,gapCount:2,meanHours:36})
  })
  it('excludes other accounts, foreign authors, private or unknown visibility and invalid or future dates',()=>{
    const page=source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-02T00:00:00.000Z'),
      {...record(3,'2026-10-03T00:00:00.000Z'),authorUid:'foreign',authorSecUid:'foreign'},
      {...record(4,'2026-10-04T00:00:00.000Z'),visibility:{...visibility,privateStatus:1}},
      {...record(5,'2026-10-05T00:00:00.000Z'),visibility:{...visibility,isStory:1}},record(6,'invalid'),record(7,'2027-01-01T00:00:00.000Z'),
      {...record(8,'2026-10-06T00:00:00.000Z'),visibility:{...visibility,isDelete:null}}])
    expect(creatorPublicationInterval([page,{...page,authorUid:'other'}],'uid','sec')).toMatchObject({workCount:2,meanHours:24})
    expect(creatorPublicationInterval([page],null,'sec').meanHours).toBeNull()
  })
  it('retains seconds until formatting and counts two distinct simultaneous works as a zero interval',()=>{
    const same=creatorPublicationInterval([source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-01T00:00:00.000Z')])],'uid','sec')
    expect(same.meanHours).toBe(0);expect(formatPublicationInterval(same.meanHours)).toBe('0天0小时')
    expect(formatPublicationInterval(23.6)).toBe('1天0小时')
    const fractional=creatorPublicationInterval([source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-01T00:30:01.000Z')])],'uid','sec')
    expect(fractional.meanHours).toBeCloseTo(1801/3600)
  })
  it('includes validated legacy public items and reports insufficient data rather than a false zero',()=>{
    const legacy=source([]);delete legacy.pages[0].records
    legacy.pages[0].items=[record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-03T00:00:00.000Z')].map(({visibility,...work})=>({...work,publicVisible:true as const}))
    expect(creatorPublicationInterval([legacy],'uid','sec').meanHours).toBe(48)
    expect(creatorPublicationInterval([source([record(1,'2026-10-01T00:00:00.000Z')])],'uid','sec')).toMatchObject({workCount:1,gapCount:0,meanHours:null})
    expect(formatPublicationInterval(null)).toBe('记录不足')
  })
  it('averages each author once without pooling all intervals or rounding each author first',()=>{
    const first=creatorPublicationInterval([source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-02T00:00:00.000Z')])],'uid','sec')
    const second=creatorPublicationInterval([source([record(1,'2026-10-01T00:00:00.000Z'),record(2,'2026-10-01T02:00:00.000Z'),record(3,'2026-10-01T04:00:00.000Z')])],'uid','sec')
    const empty=creatorPublicationInterval([],'uid','sec')
    expect(meanCreatorPublicationInterval([first,second,empty])).toEqual({eligibleCreators:2,insufficientCreators:1,sumMeanHours:26,meanHours:13})
    expect(meanCreatorPublicationInterval([{...first,meanHours:0.4},{...first,meanHours:1.4}]).meanHours).toBeCloseTo(0.9)
    expect(meanCreatorPublicationInterval([empty]).meanHours).toBeNull()
  })
})
