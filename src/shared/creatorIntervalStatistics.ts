import type {CreatorDatabaseRow} from './creatorDatabase'
import {publicationIntervalWholeDays} from './creatorDatabaseFilters'

export type IntervalBucket={days:number|null;label:string;count:number;share:number;rows:CreatorDatabaseRow[]}
export type IntervalStatistics={total:number;valid:number;nullCount:number;zeroCount:number;buckets:IntervalBucket[]}

/** Follow the table's displayed whole hours. Missing data must never become zero. */
export function intervalStatisticDays(value:unknown):number|null{
  return typeof value==='number'?publicationIntervalWholeDays(value):null
}

/** Input belongs to one selected owner. Count each profile identity once within that owner. */
export function creatorIntervalStatistics(rows:CreatorDatabaseRow[]):IntervalStatistics{
  const identities=new Set<string>(),groups=new Map<number|null,CreatorDatabaseRow[]>()
  for(const row of rows){
    if(identities.has(row.secUid))continue
    identities.add(row.secUid)
    const days=intervalStatisticDays(row.values.intervalHours)
    const group=groups.get(days)??[];group.push(row);groups.set(days,group)
  }
  const total=identities.size
  const buckets=[...groups].sort(([a],[b])=>a===null?1:b===null?-1:a-b)
    .map(([days,members])=>({days,label:days===null?'null':`${days}天`,count:members.length,share:total?members.length/total:0,rows:members}))
  const nullCount=groups.get(null)?.length??0
  return {total,valid:total-nullCount,nullCount,zeroCount:groups.get(0)?.length??0,buckets}
}
