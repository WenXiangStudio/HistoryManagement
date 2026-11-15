import {classifyActivityVisibility,creatorWorkBelongsTo,type CreatorActivityCapture} from './creatorActivity'
import {creatorPublicationInterval,type CreatorPublicationInterval} from './creatorPublicationInterval'
import type {CreatorRefreshPacing} from './creatorRefreshPolicy'

export type CreatorBaselinePolicy={limit:60;windowDays:180;windowStart:string;version?:1}|{version:2;limit:60}
export type CreatorBaselineResult={creatorId:number;nickname:string;checkedAt:string;publicCount:number;collectedCount:number;
  recentCount:number;stopReason:'limit'|'window'|'list-end';interval:CreatorPublicationInterval;latestPublicAt:string|null;
  prefixIntervals:{limit:number;meanHours:number|null}[];workIds:string[];
  version?:2;sampleCount?:number;sampleQuality?:'insufficient'|'limited'|'sufficient';daysSinceLatest?:number|null;
  recentCounts?:{days:30|90|180;count:number;complete:boolean}[]}
export type CreatorBaselineTask={policy:CreatorBaselinePolicy;targetIds:number[];batchSizes:number[];results:CreatorBaselineResult[];reusedCount?:number;directoryTotal?:number}
export function baselineSampleCount(result:CreatorBaselineResult):number{return result.sampleCount??result.recentCount}
export function baselineBatchSizes(total:number,batches=Math.min(11,total)):number[]{
  if(!Number.isSafeInteger(total)||total<1||!Number.isSafeInteger(batches)||batches<1||batches>total)throw Error('基线批次数量无效')
  return Array.from({length:batches},(_,i)=>Math.floor(total/batches)+Number(i<total%batches))
}
export function baselinePacing(batchSizes:number[],startIndex=0):CreatorRefreshPacing{
  return {batchSize:Math.max(...batchSizes),batchSizes,startIndex,authorDelayMinMs:5000,authorDelayMaxMs:10000,batchDelayMinMs:180000,batchDelayMaxMs:300000}
}
/** Recheck the entire newest prefix; pins never prove that the chronological boundary was crossed. */
export function assessCreatorBaseline(capture:CreatorActivityCapture,policy:CreatorBaselinePolicy,creatorId:number,nickname:string):CreatorBaselineResult{
  if(capture.errorCode||!capture.pages.length||capture.frontendCount?.count===null||capture.frontendCount?.count===undefined)throw Error(capture.errorCode??'ACTIVITY_BASELINE_INCOMPLETE')
  const checked=Date.parse(capture.checkedAt),countBased=policy.version===2
  const cutoff=countBased?-Infinity:Date.parse(policy.windowStart)
  if(!Number.isFinite(checked)||!countBased&&(!Number.isFinite(cutoff)||cutoff>checked||checked-cutoff>181*86400000||policy.windowDays!==180)||policy.limit!==60)throw Error('ACTIVITY_BASELINE_POLICY_INVALID')
  const works=new Map<string,NonNullable<CreatorActivityCapture['pages'][number]['records']>[number]>()
  let previous=Infinity,ordinaryRecent=0
  for(const [index,page] of capture.pages.entries()){
    if(index===0?page.requestCursor!==0:!capture.pages[index-1].hasMore||page.requestCursor!==capture.pages[index-1].responseCursor)throw Error('ACTIVITY_BASELINE_CURSOR_INVALID')
    for(const record of page.records??[]){
      if(works.has(record.workId))continue
      if(!creatorWorkBelongsTo(record,capture.profile.uid,capture.profile.secUid))throw Error('ACTIVITY_BASELINE_AUTHOR_MISMATCH')
      const verdict=classifyActivityVisibility(record.visibility),at=record.publishedAt?Date.parse(record.publishedAt):NaN
      if(verdict==='unknown'||record.pinned===null||!Number.isFinite(at))throw Error('ACTIVITY_BASELINE_ORDER_UNVERIFIED')
      if(at>checked+60000)throw Error('ACTIVITY_BASELINE_TIME_INVALID')
      if(!record.pinned){if(at>previous)throw Error('ACTIVITY_BASELINE_ORDER_UNVERIFIED');previous=at}
      // All records participate in order and dedup; only verified public records participate in statistics.
      works.set(record.workId,record)
      if(verdict==='public'&&!record.pinned&&at>=cutoff&&at<=checked)ordinaryRecent++
    }
  }
  const ended=!capture.pages.at(-1)!.hasMore
  const stopReason=ended?'list-end':ordinaryRecent>=policy.limit?'limit':!countBased&&previous<cutoff?'window':null
  if(!stopReason)throw Error('ACTIVITY_BASELINE_INCOMPLETE')
  const allPublic=[...works.values()].filter(r=>classifyActivityVisibility(r.visibility)==='public'&&Date.parse(r.publishedAt!)<=checked)
    .sort((a,b)=>Date.parse(b.publishedAt!)-Date.parse(a.publishedAt!)||b.workId.localeCompare(a.workId))
  const recent=allPublic.filter(r=>Date.parse(r.publishedAt!)>=cutoff).slice(0,policy.limit)
  const intervalFor=(limit:number)=>creatorPublicationInterval([{authorUid:capture.profile.uid,authorSecUid:capture.profile.secUid,observedAt:capture.checkedAt,
    pages:[{...capture.pages[0],records:recent.slice(0,limit)}]}],capture.profile.uid,capture.profile.secUid)
  return {creatorId,nickname,checkedAt:capture.checkedAt,publicCount:capture.frontendCount.count,collectedCount:allPublic.length,recentCount:recent.length,
    stopReason,interval:intervalFor(policy.limit),latestPublicAt:allPublic[0]?.publishedAt??null,
    prefixIntervals:[20,40,60].map(limit=>({limit,meanHours:intervalFor(limit).meanHours})),workIds:recent.map(r=>r.workId),
    ...(countBased?{version:2 as const,sampleCount:recent.length,sampleQuality:recent.length<2?'insufficient' as const:recent.length<12?'limited' as const:'sufficient' as const,
      daysSinceLatest:allPublic.length?(checked-Date.parse(allPublic[0].publishedAt!))/86400000:null,
      recentCounts:([30,90,180] as const).map(days=>{const boundary=checked-days*86400000;return {days,
        count:allPublic.filter(r=>Date.parse(r.publishedAt!)>=boundary).length,complete:ended||previous<boundary}})}:{})}
}
