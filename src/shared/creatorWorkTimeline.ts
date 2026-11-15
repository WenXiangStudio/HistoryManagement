import {classifyActivityVisibility,creatorWorkBelongsTo,type CreatorActivityCapture} from './creatorActivity'
import {currentPublicWorks,hasCompletePublicList} from './creatorActivityContinuity'
import type {CreatorRefreshBaseline,LatestWorkFingerprint} from './creatorRefreshPolicy'

export type CreatorTimelineWork={workId:string;publishedAt:string;pinned:boolean|null;firstSeenAt:string;lastSeenAt:string;
  state:'active'|'invalid';invalidatedAt:string|null;invalidReason:'missing-in-covered-range'|null;sourceAuthor?:{uid:string;secUid:string}}
export type CreatorTimelineObservation={checkedAt:string;timeBaseline:string|null;previousCount:number|null;currentCount:number|null;countChange:number|null;
  newWorkIds:string[];historicalWorkIds:string[];invalidatedWorkIds:string[];restoredWorkIds:string[];
  coverage:'complete'|'time-range'|'sampled';coverageStart:string|null;newWorksComplete:boolean;sampledPublicCount:number}
export type CreatorTimelineState={works:CreatorTimelineWork[];latest:LatestWorkFingerprint|null;count:number|null;countCheckedAt:string|null;
  lastSnapshotId:number|null;observation:CreatorTimelineObservation|null}
export type CreatorTimelineView=CreatorTimelineState&{ownerSecUid:string;creatorSecUid:string}
export function emptyCreatorTimeline():CreatorTimelineState{return {works:[],latest:null,count:null,countCheckedAt:null,lastSnapshotId:null,observation:null}}

/** Missing IDs are meaningful only in a proven complete list or its continuously traversed ordinary time range. */
export function coveredPublicationRange(capture:CreatorActivityCapture):{coverage:CreatorTimelineObservation['coverage'];start:string|null}{
  if(hasCompletePublicList(capture))return {coverage:'complete',start:null}
  if(capture.errorCode||!capture.pages.length)return {coverage:'sampled',start:null}
  let previous=Infinity,minimum:number|null=null
  const seen=new Set<string>()
  for(const [index,page] of capture.pages.entries()){
    if(index===0?page.requestCursor!==0:!capture.pages[index-1].hasMore||page.requestCursor!==capture.pages[index-1].responseCursor)return {coverage:'sampled',start:null}
    for(const record of page.records??page.items){
      if(!creatorWorkBelongsTo(record,capture.profile.uid,capture.profile.secUid)||seen.has(record.workId))continue
      seen.add(record.workId)
      if('visibility' in record&&classifyActivityVisibility(record.visibility)==='unknown')return {coverage:'sampled',start:null}
      const at=record.publishedAt?Date.parse(record.publishedAt):NaN
      if(record.pinned===null||!Number.isFinite(at))return {coverage:'sampled',start:null}
      if(record.pinned)continue
      if(at>previous)return {coverage:'sampled',start:null}
      previous=at;minimum=at
    }
  }
  // Boundary timestamps may contain more works on the next page. Do not invalidate boundary peers.
  return minimum===null?{coverage:'sampled',start:null}:{coverage:'time-range',start:new Date(minimum).toISOString()}
}

/** Append public observations by ID, keep disappeared records and keep the publication high-water mark. */
export function observeCreatorTimeline(previous:CreatorTimelineState,capture:CreatorActivityCapture,snapshotId:number|null):CreatorTimelineState{
  const checked=Date.parse(capture.checkedAt),m=previous.latest?.publishedAt??null,from=m?Date.parse(m):-Infinity
  const records=currentPublicWorks(capture),works=new Map(previous.works.map(w=>[w.workId,{...w}]))
  const fresh:string[]=[],historical:string[]=[],restored:string[]=[],invalidated:string[]=[]
  for(const record of records.values()){
    const published=Date.parse(record.publishedAt)
    if(!Number.isFinite(published)||published>checked)continue
    const old=works.get(record.workId)
    if(published>from&&published<=checked&&m!==null)fresh.push(record.workId)
    else if(!old&&m!==null)historical.push(record.workId)
    if(old?.state==='invalid')restored.push(record.workId)
    works.set(record.workId,{workId:record.workId,publishedAt:record.publishedAt,pinned:record.pinned,
      firstSeenAt:old?.firstSeenAt??capture.checkedAt,lastSeenAt:capture.checkedAt,state:'active',invalidatedAt:null,invalidReason:null})
    if(record.sourceAuthor)works.get(record.workId)!.sourceAuthor=record.sourceAuthor
  }
  const range=coveredPublicationRange(capture)
  if(range.coverage!=='sampled')for(const work of works.values()){
    if(work.state==='invalid'||records.has(work.workId))continue
    const at=Date.parse(work.publishedAt)
    if(range.coverage==='complete'||at>Date.parse(range.start!)&&at<=checked){
      work.state='invalid';work.invalidatedAt=capture.checkedAt;work.invalidReason='missing-in-covered-range';invalidated.push(work.workId)
    }
  }
  let latest=previous.latest
  for(const work of works.values())if(!latest||Date.parse(work.publishedAt)>Date.parse(latest.publishedAt)
    ||work.publishedAt===latest.publishedAt&&work.workId>latest.workId)latest={workId:work.workId,publishedAt:work.publishedAt}
  const count=capture.frontendCount?.count??null,ordered=[...works.values()].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)||a.workId.localeCompare(b.workId))
  const order=(ids:string[])=>{const selected=new Set(ids);return ordered.filter(w=>selected.has(w.workId)).map(w=>w.workId)}
  return {works:ordered,latest,count:count??previous.count,countCheckedAt:count===null?previous.countCheckedAt:capture.frontendCount&&'checkedAt' in capture.frontendCount?capture.frontendCount.checkedAt:capture.checkedAt,
    lastSnapshotId:snapshotId??previous.lastSnapshotId,observation:{checkedAt:capture.checkedAt,timeBaseline:m,previousCount:previous.count,currentCount:count,
      countChange:count!==null&&previous.count!==null?count-previous.count:null,newWorkIds:order(fresh),historicalWorkIds:order(historical),
      invalidatedWorkIds:order(invalidated),restoredWorkIds:order(restored),coverage:range.coverage,coverageStart:range.start,
      newWorksComplete:range.coverage==='complete'||!!m&&range.coverage==='time-range'&&Date.parse(range.start!)<=from,
      sampledPublicCount:records.size}}
}

export function timelineBaseline(value:CreatorTimelineState):CreatorRefreshBaseline|undefined{
  if(value.lastSnapshotId===null||value.count===null)return
  const ordinary=value.works.filter(w=>w.state==='active'&&w.pinned===false).at(-1)
  return {snapshotId:value.lastSnapshotId,workCount:value.count,latest:value.latest,knownWorkIds:value.works.map(w=>w.workId),
    invalidWorkIds:value.works.filter(w=>w.state==='invalid').map(w=>w.workId),
    timeBaseline:value.latest?.publishedAt??null,checkedAt:value.observation?.checkedAt,
    anchor:ordinary?{workId:ordinary.workId,publishedAt:ordinary.publishedAt}:null}
}
