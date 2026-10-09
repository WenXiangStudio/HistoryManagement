import {classifyActivityVisibility,type CreatorActivityCapture} from './creatorActivity'

export type CreatorPublicationSource = {
  authorUid:string; authorSecUid:string; observedAt:string; pages:CreatorActivityCapture['pages']
  /** Only a verified complete list whose public IDs agree with the homepage count replaces current membership. */
  completePublicList?:boolean
}
export type CreatorPublicationInterval = {
  workCount:number; gapCount:number; meanHours:number|null; earliestPublishedAt:string|null; latestPublishedAt:string|null
}

/** Preserve source history, but compute current membership from the last proven complete list plus newer observations. */
export function creatorPublicationInterval(sources:CreatorPublicationSource[],uid:string|null,secUid:string):CreatorPublicationInterval {
  const works=new Map<string,{published:number;observed:number}>()
  for(const source of [...sources].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt))){
    const observed=Date.parse(source.observedAt)
    if(!Number.isFinite(observed)||source.authorSecUid!==secUid||!uid||source.authorUid!==uid)continue
    if(source.completePublicList)works.clear()
    for(const page of source.pages){
      const records=page.records??page.items
      for(const record of records){
        if(record.authorUid!==uid||record.authorSecUid!==secUid)continue
        if('visibility' in record&&['deleted','prohibited','restricted','temporary-marker'].includes(classifyActivityVisibility(record.visibility))){works.delete(record.workId);continue}
        if(!record.publishedAt)continue
        const visible='visibility' in record?classifyActivityVisibility(record.visibility)==='public':record.publicVisible===true
        if(!visible)continue
        const published=Date.parse(record.publishedAt)
        if(!Number.isFinite(published)||published>observed+60_000)continue
        const previous=works.get(record.workId)
        if(!previous||observed>=previous.observed)works.set(record.workId,{published,observed})
      }
    }
  }
  const times=[...works.values()].map(work=>work.published).sort((a,b)=>a-b)
  const gapCount=Math.max(0,times.length-1)
  let gapMs=0
  for(let index=1;index<times.length;index++)gapMs+=times[index]-times[index-1]
  return {workCount:times.length,gapCount,meanHours:gapCount?gapMs/gapCount/3600000:null,
    earliestPublishedAt:times.length?new Date(times[0]).toISOString():null,
    latestPublishedAt:times.length?new Date(times.at(-1)!).toISOString():null}
}

/** Each author contributes one unrounded mean, independent of how many works were collected. */
export function meanCreatorPublicationInterval(intervals:CreatorPublicationInterval[]):{
  eligibleCreators:number; insufficientCreators:number; sumMeanHours:number; meanHours:number|null
} {
  const eligible=intervals.filter(interval=>interval.meanHours!==null)
  const sumMeanHours=eligible.reduce((sum,interval)=>sum+interval.meanHours!,0)
  return {eligibleCreators:eligible.length,insufficientCreators:intervals.length-eligible.length,sumMeanHours,
    meanHours:eligible.length?sumMeanHours/eligible.length:null}
}

export function formatPublicationInterval(meanHours:number|null|undefined):string {
  if(meanHours===null||meanHours===undefined)return '记录不足'
  const hours=Math.round(meanHours)
  return `${Math.floor(hours/24)}天${hours%24}小时`
}

/** Match the displayed whole hours; exactly 12 remainder hours rounds down. */
export function publicationIntervalWholeDays(meanHours:number|null|undefined):number|null{
  if(meanHours===null||meanHours===undefined||!Number.isFinite(meanHours)||meanHours<0)return null
  const hours=Math.round(meanHours)
  return Math.floor(hours/24)+(hours%24>12?1:0)
}
