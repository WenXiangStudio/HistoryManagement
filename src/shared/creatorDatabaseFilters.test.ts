import {describe,it,expect} from 'vitest'
import {DEFAULT_CREATOR_DATABASE_COLUMNS,type CreatorDatabaseRow} from './creatorDatabase'
import {matchesDatabaseFilters,validateDatabaseFilters,publicationIntervalWholeDays,type DatabaseFilterRule} from './creatorDatabaseFilters'
const columns=DEFAULT_CREATOR_DATABASE_COLUMNS
const row:CreatorDatabaseRow={secUid:'sec',nickname:'AI作者',profileUrl:'https://www.douyin.com/user/sec',automatic:{},manualColumns:[],values:{nickname:'AI作者',workCount:100,intervalHours:252,lastPublishedDate:'2026-10-01',tier:'active'}}
const rule=(columnId:string,operator:DatabaseFilterRule['operator'],value='',upper=''):DatabaseFilterRule=>({id:columnId,columnId,operator,value,upper})
const match=(...rules:DatabaseFilterRule[])=>matchesDatabaseFilters(row,{mode:'all',rules},columns)
describe('custom creator filters and day distribution rounding',()=>{
  it('combines numeric thresholds, fractional interval days and dates with inclusive bounds',()=>{
    expect(match(rule('workCount','gte','100'),rule('intervalHours','between','10','10.5'),rule('lastPublishedDate','between','2026-10-01','2026-10-08'))).toBe(true)
    expect(match(rule('intervalHours','gt','10.5'))).toBe(false)
    expect(match(rule('workCount','lt','100'))).toBe(false)
    expect(match(rule('lastPublishedDate','lt','2026-10-02'))).toBe(true)
  })
  it('supports ANY vs ALL and text and tier predicates',()=>{
    const rules=[rule('nickname','contains','ai'),rule('tier','eq','inactive')]
    expect(matchesDatabaseFilters(row,{mode:'any',rules},columns)).toBe(true)
    expect(matchesDatabaseFilters(row,{mode:'all',rules},columns)).toBe(false)
    expect(match(rule('nickname','not-contains','程序员'),rule('tier','neq','inactive'))).toBe(true)
  })
  it('keeps zero distinct from missing records and explicitly handles empty values',()=>{
    const missing={...row,values:{...row.values,workCount:0,intervalHours:null}}
    expect(matchesDatabaseFilters(missing,{mode:'all',rules:[rule('workCount','eq','0'),rule('intervalHours','empty')]},columns)).toBe(true)
    expect(matchesDatabaseFilters(missing,{mode:'all',rules:[rule('intervalHours','lt','1')]},columns)).toBe(false)
  })
  it('rejects incomplete, nonnumeric, reversed, invalid-date, wrong-type and deleted-column filters',()=>{
    for(const condition of [rule('workCount','gt',''),rule('workCount','gt','abc'),rule('intervalHours','between','20','10'),rule('lastPublishedDate','eq','2026-02-30'),rule('workCount','contains','1'),rule('gone','eq','a')])
      expect(validateDatabaseFilters({mode:'all',rules:[condition]},columns)).not.toBeNull()
    expect(validateDatabaseFilters({mode:'all',rules:[rule('intervalHours','between','1.5','20')]},columns)).toBeNull()
  })
  it('supports custom text, numeric and date columns through the same rules',()=>{
    const custom={id:'custom_a',name:'评分',kind:'count' as const,builtin:false}
    expect(matchesDatabaseFilters({...row,values:{...row.values,custom_a:4}},{mode:'all',rules:[rule('custom_a','between','3','5')]},[...columns,custom])).toBe(true)
  })
  it('rounds only remainder hours greater than twelve upward, exactly matching the requested examples',()=>{
    expect(publicationIntervalWholeDays(21*24+12)).toBe(21)
    expect(publicationIntervalWholeDays(11*24+20)).toBe(12)
    expect(publicationIntervalWholeDays(12)).toBe(0);expect(publicationIntervalWholeDays(13)).toBe(1)
    expect(publicationIntervalWholeDays(0)).toBe(0);expect(publicationIntervalWholeDays(null)).toBeNull()
    expect(publicationIntervalWholeDays(24+12.4)).toBe(1)
    expect(publicationIntervalWholeDays(24+12.6)).toBe(2)
  })
})
