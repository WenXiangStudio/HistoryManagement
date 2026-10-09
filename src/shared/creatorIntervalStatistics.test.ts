import {describe,it,expect} from 'vitest'
import {creatorIntervalStatistics,intervalStatisticDays} from './creatorIntervalStatistics'
import type {CreatorDatabaseRow} from './creatorDatabase'
const row=(secUid:string,intervalHours:number|null):CreatorDatabaseRow=>({secUid,nickname:secUid,profileUrl:`https://www.douyin.com/user/${secUid}`,values:{intervalHours},automatic:{intervalHours},manualColumns:[]})
describe('creator interval distribution',()=>{
  it.each([[0,0],[10,0],[12,0],[12.49,0],[12.5,1],[13,1],[23.6,1],[21*24+12,21],[21*24+13,22],[11*24+20,12]])('converts %s hours to %s days using the displayed whole hours', (hours,days)=>{
    expect(intervalStatisticDays(hours)).toBe(days)
  })
  it.each([null,undefined,'','  ','记录不足','0',NaN,Infinity,-1])('keeps missing or invalid %s as null',value=>{
    expect(intervalStatisticDays(value)).toBeNull()
  })
  it('includes null and zero in the main distribution, deduplicates identities, and does not modify input',()=>{
    const rows=[row('a',12),row('b',13),row('c',null),row('d',0),row('a',12),row('e',12.5),row('f',48)]
    const before=structuredClone(rows),result=creatorIntervalStatistics(rows)
    expect(result).toMatchObject({total:6,valid:5,nullCount:1,zeroCount:2})
    expect(result.buckets.map(({days,count})=>({days,count}))).toEqual([{days:0,count:2},{days:1,count:2},{days:2,count:1},{days:null,count:1}])
    expect(result.buckets.reduce((sum,bucket)=>sum+bucket.count,0)).toBe(result.total)
    expect(result.buckets.reduce((sum,bucket)=>sum+bucket.share,0)).toBeCloseTo(1)
    expect(result.buckets[0].rows.map(row=>row.secUid)).toEqual(['a','d'])
    expect(rows).toEqual(before)
  })
  it('handles empty and all-null input without treating it as zero days',()=>{
    expect(creatorIntervalStatistics([])).toEqual({total:0,valid:0,nullCount:0,zeroCount:0,buckets:[]})
    const result=creatorIntervalStatistics([row('a',null),row('b',null)])
    expect(result).toMatchObject({total:2,valid:0,nullCount:2,zeroCount:0})
    expect(result.buckets).toHaveLength(1);expect(result.buckets[0]).toMatchObject({days:null,count:2,share:1})
  })
})
