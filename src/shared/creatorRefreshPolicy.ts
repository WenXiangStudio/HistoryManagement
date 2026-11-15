import type { CreatorActivityCapture } from './creatorActivity'
import { classifyActivityVisibility,creatorWorkBelongsTo } from './creatorActivity'
import { shanghaiDateKey } from './creatorActivitySections'
import type {CreatorListItem} from './contracts'
import type {CreatorPriorityState} from './creatorPriority'

export type CreatorRefreshTier = 'active' | 'regular' | 'inactive' | 'dormant' | 'unknown'
export type CreatorRefreshScope = 'active' | 'regular' | 'inactive' | 'all' | 'anomaly'
export const CREATOR_REFRESH_SCOPE_LABELS:Record<CreatorRefreshScope,string>={active:'高频更新',regular:'中频更新',inactive:'低频更新',all:'全量更新',anomaly:'一键核验并补齐'}
export type CreatorRecentActivity={checkedAt:string|null;latestPublishedAt:string|null;status:'updated'|'empty'|'unknown'}
/** The result belongs to a successful verification, and never ages merely because the clock moves. */
export function assessRecentActivity(latest:string|null,checked:string|null,verifiedEmpty=false):CreatorRecentActivity{
  const result:CreatorRecentActivity={checkedAt:checked,latestPublishedAt:latest,status:'unknown'}
  if(!checked||!Number.isFinite(Date.parse(checked)))return result
  if(!latest)return {...result,status:verifiedEmpty?'empty':'unknown'}
  const elapsed=Date.parse(checked)-Date.parse(latest)
  if(!Number.isFinite(elapsed)||elapsed<0)return result
  return {...result,status:elapsed<=7*86400000?'updated':'empty'}
}
export function creatorRecentActivity(creator:CreatorListItem):CreatorRecentActivity{
  return creator.activity?.recentActivity??assessRecentActivity(creator.activity?.refreshSchedule?.latestKnownPublishedAt??null,creator.activity?.refreshSchedule?.lastCheckedAt??null)
}
export function creatorRefreshTier(meanHours:number|null|undefined):CreatorRefreshTier{
  if(meanHours===null||meanHours===undefined||!Number.isFinite(meanHours)||meanHours<0)return 'unknown'
  return meanHours<=7*24?'active':meanHours<=14*24?'regular':meanHours<=30*24?'inactive':'dormant'
}
/** Recent inactivity overrides historical frequency, using the verification time rather than today's clock. */
function verifiedCreatorTier(meanHours:number|null|undefined,recent:CreatorRecentActivity):CreatorRefreshTier{
  if(recent.status!=='unknown'&&recent.checkedAt&&recent.latestPublishedAt){
    const elapsed=Date.parse(recent.checkedAt)-Date.parse(recent.latestPublishedAt)
    if(Number.isFinite(elapsed)&&elapsed>30*86400000)return 'dormant'
  }
  const tier=creatorRefreshTier(meanHours)
  if(tier!=='active')return tier
  return recent.status==='updated'?'active':recent.status==='empty'?'regular':'unknown'
}
export function creatorAutomaticTier(creator:CreatorListItem):CreatorRefreshTier{
  return verifiedCreatorTier((creator.activity?.recentBaseline?.interval??creator.activity?.publicationInterval)?.meanHours,creatorRecentActivity(creator))
}
export function effectiveCreatorTier(creator:CreatorListItem):CreatorRefreshTier{
  return creator.refreshPriority?.mode&&creator.refreshPriority.tier?creator.refreshPriority.tier:creatorAutomaticTier(creator)
}
/** Missing a verified work baseline is a review condition, independent of publication frequency. */
export function creatorNeedsVerification(creator:CreatorListItem):boolean{
  return !creator.isDemo&&(!!creator.activity?.anomaly||creator.activity?.baselineStatus==='missing')
}
/** Receives the full current-owner directory; search and due dates do not restrict manual groups. */
export function creatorsForRefreshScope(creators:CreatorListItem[],scope:CreatorRefreshScope):CreatorListItem[]{
  if(scope==='anomaly')return creators.filter(creatorNeedsVerification)
  return creators.filter(creator=>!creator.isDemo&&!creatorNeedsVerification(creator)&&(scope==='all'||effectiveCreatorTier(creator)===scope))
}
export type CreatorRefreshSchedule = {
  tier: CreatorRefreshTier; intervalDays: number; lastCheckedAt: string | null
  latestKnownPublishedAt: string | null; nextDueAt: string | null; due: boolean
}
export type LatestWorkFingerprint = { workId: string; publishedAt: string }
export type CreatorRefreshBaseline = {
  snapshotId: number; workCount: number; latest: LatestWorkFingerprint | null
  knownWorkIds?:string[];anchor?:LatestWorkFingerprint|null
  timeBaseline?:string|null;checkedAt?:string
  continuitySnapshotId?:number
  invalidWorkIds?:string[]
}
export type CreatorRefreshPacing = {
  batchSize: number; authorDelayMinMs: number; authorDelayMaxMs: number
  batchDelayMinMs: number; batchDelayMaxMs: number
  batchSizes?:number[];startIndex?:number
}
export const DEFAULT_CREATOR_REFRESH_PACING: CreatorRefreshPacing = {
  batchSize: 33, authorDelayMinMs: 3000, authorDelayMaxMs: 8000,
  batchDelayMinMs: 180000, batchDelayMaxMs: 300000
}

/** Daily / weekly / fortnightly / thirty-day checks are keyed to Beijing calendar dates. */
export function creatorRefreshSchedule(latest: string | null, checked: string | null, meanHours:number|null|undefined, at: string | number | Date = Date.now(),priority?:CreatorPriorityState): CreatorRefreshSchedule {
  const now = new Date(at).getTime(),automatic=verifiedCreatorTier(meanHours,assessRecentActivity(latest,checked))
  const tier=priority?.mode&&priority.tier?priority.tier:automatic
  const intervalDays = tier === 'regular' ? 7 : tier === 'inactive' ? 14 : tier==='dormant'?30:1
  const checkDay = checked ? shanghaiDateKey(checked) : null
  const nextDueAt = checkDay ? new Date(Date.parse(`${checkDay}T00:00:00+08:00`) + intervalDays * 86400000).toISOString() : null
  return { tier, intervalDays, lastCheckedAt: checked, latestKnownPublishedAt: latest, nextDueAt,
    due: !nextDueAt || now >= Date.parse(nextDueAt) }
}

/** Only the first small page is retained; use dates, not display position or changing engagement counts. */
export function latestWorkFingerprint(capture: CreatorActivityCapture): { ready: boolean; latest: LatestWorkFingerprint | null } {
  const first = capture.pages[0]
  if (!first || first.requestCursor !== 0 || !first.records) return { ready: false, latest: null }
  let latest: LatestWorkFingerprint | null = null, ordinary = false
  for (const record of first.records) {
    if (!creatorWorkBelongsTo(record,capture.profile.uid,capture.profile.secUid)) continue
    const verdict = classifyActivityVisibility(record.visibility)
    if (verdict === 'unknown' || record.pinned === null) return { ready: false, latest: null }
    if (record.pinned === false) ordinary = true
    if (verdict !== 'public') continue
    if (!record.publishedAt || !Number.isFinite(Date.parse(record.publishedAt))) return { ready: false, latest: null }
    if (!latest || Date.parse(record.publishedAt) > Date.parse(latest.publishedAt)
      || (record.publishedAt === latest.publishedAt && record.workId > latest.workId)) {
      latest = { workId: record.workId, publishedAt: record.publishedAt }
    }
  }
  return { ready: !first.hasMore || ordinary, latest }
}
