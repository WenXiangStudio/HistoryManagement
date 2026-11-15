import {classifyActivityVisibility,creatorWorkBelongsTo,type CreatorActivityCapture} from './creatorActivity'
import type {CreatorRefreshBaseline} from './creatorRefreshPolicy'

export type CreatorContinuityComparison={
  previousCount:number;currentCount:number;increase:number;newPublicWorks:number;overlapWorks:number
  anchorFound:boolean;listEnded:boolean;completePublicList:boolean;connected:boolean
  reasons:('count-jump'|'missing-new-works'|'history-gap')[]
  timeBaseline?:string|null;sampledHistoricalWorks?:number
  restoredPublicWorks?:number
}
export type CreatorActivityAnomaly={
  detectedAt:string;baselineSnapshotId:number;comparison:CreatorContinuityComparison
}

export function currentPublicWorks(capture:CreatorActivityCapture):Map<string,{workId:string;publishedAt:string;pinned:boolean|null;sourceAuthor?:{uid:string;secUid:string}}>{
  const works=new Map<string,{workId:string;publishedAt:string;pinned:boolean|null;sourceAuthor?:{uid:string;secUid:string}}>()
  for(const page of capture.pages)for(const record of page.records??page.items){
    if(!creatorWorkBelongsTo(record,capture.profile.uid,capture.profile.secUid)||!record.publishedAt)continue
    const visible='visibility' in record?classifyActivityVisibility(record.visibility)==='public':record.publicVisible===true
    if(visible)works.set(record.workId,{workId:record.workId,publishedAt:record.publishedAt,pinned:record.pinned,
      ...('profileOwner' in record&&record.profileOwner&&(record.authorUid!==capture.profile.uid||record.authorSecUid!==capture.profile.secUid)?{sourceAuthor:{uid:record.authorUid,secUid:record.authorSecUid}}:{})})
  }
  return works
}
export function hasCompletePublicList(capture:CreatorActivityCapture):boolean{
  if(capture.errorCode||!capture.pages.length||capture.pages.at(-1)!.hasMore||capture.frontendCount?.count===null||capture.frontendCount?.count===undefined)return false
  if(capture.pages.some(page=>page.records?.some(record=>creatorWorkBelongsTo(record,capture.profile.uid,capture.profile.secUid)&&classifyActivityVisibility(record.visibility)==='unknown')))return false
  return currentPublicWorks(capture).size===capture.frontendCount.count
}
export function compareCreatorContinuity(capture:CreatorActivityCapture,baseline:CreatorRefreshBaseline):CreatorContinuityComparison|null{
  const count=capture.frontendCount?.count
  if(count===null||count===undefined||!baseline.knownWorkIds)return null
  const works=currentPublicWorks(capture),known=new Set(baseline.knownWorkIds)
  const m=baseline.timeBaseline??baseline.latest?.publishedAt??baseline.anchor?.publishedAt??null
  const newPublicWorks=m?[...works.values()].filter(work=>Date.parse(work.publishedAt)>Date.parse(m)&&Date.parse(work.publishedAt)<=Date.parse(capture.checkedAt)).length:0
  const overlapWorks=[...works.keys()].filter(id=>known.has(id)).length,increase=count-baseline.workCount
  const sampledHistoricalWorks=m?[...works.values()].filter(work=>Date.parse(work.publishedAt)<=Date.parse(m)).length:works.size
  const invalid=new Set(baseline.invalidWorkIds??[]),restoredPublicWorks=[...works.keys()].filter(id=>invalid.has(id)).length
  const listEnded=!!capture.pages.length&&!capture.pages.at(-1)!.hasMore
  const completePublicList=hasCompletePublicList(capture)
  // A pinned old record alone cannot prove continuity with the most recent ordinary work.
  const anchorFound=!!baseline.anchor&&works.has(baseline.anchor.workId)
  const connected=completePublicList||(anchorFound&&newPublicWorks+restoredPublicWorks>=Math.max(0,increase))
  const reasons:CreatorContinuityComparison['reasons']=[]
  if(increase>=10)reasons.push('count-jump')
  if(!completePublicList&&increase>newPublicWorks+restoredPublicWorks)reasons.push('missing-new-works')
  if(!connected&&!completePublicList)reasons.push('history-gap')
  return {previousCount:baseline.workCount,currentCount:count,increase,newPublicWorks,overlapWorks,anchorFound,listEnded,completePublicList,connected,reasons,timeBaseline:m,sampledHistoricalWorks,restoredPublicWorks}
}
