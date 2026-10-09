import { z } from 'zod'
import {activityFailureDiagnosticSchema} from './creatorActivityDiagnostics'
import {creatorActivityObservationSchema} from './creatorActivityObservation'
import type { CreatorRefreshSchedule, CreatorRefreshPacing, CreatorRefreshScope, CreatorRecentActivity } from './creatorRefreshPolicy'
import type {CreatorActivityAnomaly} from './creatorActivityContinuity'
import type {CreatorPublicationInterval} from './creatorPublicationInterval'

import {calendarWeek} from './calendarWeek'
export {calendarWeek} from './calendarWeek'

const id = z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
const count = z.number().int().nonnegative().nullable()
const ownerSourceRelation=z.enum(['navigation-missing','document-missing','request-missing','match','different'])
const ownerDocumentKind=z.enum(['first-author','other-platform','other-origin','missing'])
export const creatorActivityOwnerDiagnosticsSchema=z.object({
  contract:z.literal('signaldesk-activity-owner-diagnostics/v1'),navigationBound:z.boolean(),navigationFailed:z.boolean(),
  navigationLoaderPresent:z.boolean(),navigationFramePresent:z.boolean(),observedRequests:z.number().int().min(0).max(10000000),
  documents:z.array(z.object({document:ownerDocumentKind,redirect:z.boolean(),loader:ownerSourceRelation,frame:ownerSourceRelation}).strict()).max(8),
  currentDocument:z.object({document:ownerDocumentKind,committed:z.boolean(),loader:ownerSourceRelation,frame:ownerSourceRelation}).strict().nullable().optional(),
  transitions:z.array(z.object({document:ownerDocumentKind,loader:ownerSourceRelation,frame:ownerSourceRelation}).strict()).max(8).optional(),
  requests:z.array(z.object({loader:ownerSourceRelation,frame:ownerSourceRelation,document:ownerDocumentKind,childSession:z.boolean(),
    currentLoader:ownerSourceRelation.optional(),currentFrame:ownerSourceRelation.optional(),
    requestType:z.enum(['XHR','Fetch','other']),stage:z.enum(['request','response','load-failed','body','identity','identity-checked']),
    json:z.enum(['pending','valid','invalid']),identity:z.enum(['pending','matched','mismatch','missing']),
    httpStatus:z.number().int().min(0).max(999).optional(),responseSource:z.enum(['network','service-worker','disk-cache']).optional(),
    errorCode:z.string().regex(/^[A-Z0-9_-]{1,100}$/).optional()}).strict()).max(4),
  errorCode:z.string().regex(/^[A-Z0-9_-]{1,100}$/).optional()
}).strict()
export const creatorActivityRequestAuditSchema=z.object({
  contextSource:z.enum(['existing-page','first-author-page']),accountPageNavigations:z.literal(0),
  ownerVerificationGets:z.number().int().min(0).max(1),authorHomepageNavigations:z.number().int().nonnegative().max(100000),
  networkRequestsObserved:z.number().int().nonnegative().max(10000000),platformApiGetsObserved:z.number().int().nonnegative().max(10000000),
  selfGetsObserved:z.number().int().nonnegative().max(10000000),listGetsObserved:z.number().int().nonnegative().max(10000000),
  ownerVerificationSource:z.enum(['pending','native-network','active-get']).optional(),nativeOwnerRequestsObserved:z.number().int().min(0).max(10000000).optional(),
  ownerSourceDiagnostics:creatorActivityOwnerDiagnosticsSchema.optional()
}).strict().refine(value=>value.platformApiGetsObserved<=value.networkRequestsObserved
  &&value.selfGetsObserved+value.listGetsObserved<=value.platformApiGetsObserved
  &&(value.nativeOwnerRequestsObserved??0)<=value.selfGetsObserved
  &&(!value.ownerSourceDiagnostics||value.ownerSourceDiagnostics.observedRequests===value.nativeOwnerRequestsObserved)
  &&(value.ownerVerificationSource!=='native-network'||(value.ownerVerificationGets===0&&(value.nativeOwnerRequestsObserved??0)>0))
  &&(value.ownerVerificationSource!=='active-get'||(value.ownerVerificationGets===1&&value.nativeOwnerRequestsObserved===0)), '请求观察计数不一致')
export type CreatorActivityRequestAudit=z.infer<typeof creatorActivityRequestAuditSchema>
export const creatorActivityOwnerProofSchema=z.object({contract:z.literal('signaldesk-activity-owner/v1'),kind:z.enum(['native-network','active-get']),
  runId:id,uid:id,secUid:id,endpoint:z.literal('/aweme/v1/web/user/profile/self/'),method:z.literal('GET'),httpStatus:z.literal(200),
  observedAt:z.string().datetime(),navigationStartedAt:z.string().datetime(),firstAuthorSecUid:id,tabId:z.number().int().positive()}).strict()
export type CreatorActivityOwnerProof=z.infer<typeof creatorActivityOwnerProofSchema>
export const creatorActivityProgressSchema=z.object({currentId:z.number().int().negative().optional(),finished:z.boolean().optional(),blocked:z.boolean().optional(),
  errorCode:z.string().regex(/^[A-Z0-9_-]{1,100}$/).optional(),stage:z.enum(['preparing-context','verifying-owner','reading-author']).optional(),
  requestAudit:creatorActivityRequestAuditSchema.optional(),ownerVerification:creatorActivityOwnerProofSchema.optional(),
  failureDiagnostic:activityFailureDiagnosticSchema.optional(),readObservation:creatorActivityObservationSchema.optional(),diagnosticSaveFailed:z.boolean().optional(),
  wait:z.object({kind:z.enum(['author','batch','resume']),until:z.string().datetime(),batchNumber:z.number().int().positive(),
    totalBatches:z.number().int().positive(),durationMs:z.number().int().nonnegative()}).strict().nullable().optional()})
export type CreatorActivityProgress=z.infer<typeof creatorActivityProgressSchema>
const visibilitySchema=z.object({privateStatus:z.number().int().nullable(),isDelete:z.boolean().nullable(),isProhibited:z.boolean().nullable(),
  allowShare:z.boolean().nullable(),isStory:z.number().int().nullable(),is24Story:z.number().int().nullable(),awemeType:z.number().int().nullable()}).strict()
const networkRecordSchema=z.object({workId:z.string().regex(/^\d{8,30}$/),authorUid:id,authorSecUid:id,
  publishedAt:z.string().datetime().nullable(),pinned:z.boolean().nullable(),visibility:visibilitySchema}).strict()
const sourceProofSchema=z.object({kind:z.enum(['native-network','active-get']),endpoint:z.literal('/aweme/v1/web/aweme/post/'),
  method:z.literal('GET'),secUid:id,requestCursor:z.number().int().nonnegative(),httpStatus:z.literal(200),observedAt:z.string().datetime()}).strict()
export const frontendWorkCountSchema=z.union([
  z.object({count:z.number().int().nonnegative(),text:z.string().regex(/^\d+(?:,\d{3})*$/),profileUrl:z.string().url(),secUid:id,
    checkedAt:z.string().datetime(),selector:z.literal('#semiTabpost [data-e2e="user-tab-count"]')}).strict(),
  z.object({count:z.null(),errorCode:z.enum(['PROFILE_PAGE_MISMATCH','PROFILE_TAB_COUNT_UNAVAILABLE'])}).strict()
])
export const activityPageSchema = z.object({
  requestCursor: z.number().int().nonnegative(), responseCursor: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(), items: z.array(z.object({
    workId: z.string().regex(/^\d{8,30}$/), authorUid: id, authorSecUid: id,
    publishedAt: z.string().datetime(), pinned: z.boolean().nullable(), publicVisible: z.literal(true)
  }).strict()).max(200)
  ,excludedAuthors:z.array(z.object({workId:z.string().regex(/^\d{8,30}$/),authorUid:id,authorSecUid:id}).strict()).max(200).default([])
  ,excludedNonPublic:z.array(z.object({workId:z.string().regex(/^\d{8,30}$/),authorUid:id,authorSecUid:id,
    reason:z.enum(['private','deleted','prohibited'])}).strict()).max(200).default([])
  ,records:z.array(networkRecordSchema).max(200).optional(),sourceProof:sourceProofSchema.optional()
}).strict()
export const creatorActivityCaptureSchema = z.object({
  contract: z.enum(['signaldesk-creator-activity/v2','signaldesk-creator-activity/v3','signaldesk-creator-activity/v4','signaldesk-creator-activity/v6','signaldesk-creator-activity/v7','signaldesk-creator-activity/v8']), ownerSecUid: id,
  requestContext:z.object({versionCode:z.literal('170400'),publishStrategy:z.literal('2'),clientType:z.literal('1')}).strict(),
  requestedSecUid: id, profile: z.object({uid: id, secUid: id, workCount: count}).strict(),
  frontendCount:frontendWorkCountSchema.optional(),
  checkedAt: z.string().datetime(), weekStart: z.string().datetime(), weekEndExclusive: z.string().datetime(),
  pages: z.array(activityPageSchema).max(200), errorCode: z.string().regex(/^[A-Z0-9_-]{1,100}$/).nullable(),
  activeApiRequests: z.number().int().min(0).max(202), acquisitionMs: z.number().finite().nonnegative()
  ,reusedNativePages:z.number().int().min(0).max(10).optional(),nativeListRequests:z.number().int().min(0).max(1000).optional()
}).strict()
export type CreatorActivityCapture = z.infer<typeof creatorActivityCaptureSchema>
export const creatorActivityUnchangedSchema=z.object({
  contract:z.literal('signaldesk-activity-unchanged/v1'),ownerSecUid:id,requestedSecUid:id,authorUid:id,
  baselineSnapshotId:z.number().int().positive(),checkedAt:z.string().datetime(),
  frontendCount:frontendWorkCountSchema,reason:z.enum(['count-unchanged','latest-unchanged']),
  firstPage:activityPageSchema.optional(),nativeListRequests:z.number().int().nonnegative()
}).strict()
export type CreatorActivityUnchanged=z.infer<typeof creatorActivityUnchangedSchema>
export type CreatorActivitySnapshot = {
  workCount: number | null; checkedAt: string; weekStart: string; weekEndExclusive: string
  weeklyUpdateCount: number | null
  workCountSource?: 'public-list' | 'profile-tab'
  workCountCheckedAt?: string | null
  latestPublishedAt: string | null; weeklyStatus: 'updated' | 'empty' | 'partial'
  coverage: 'week-boundary' | 'list-end' | 'partial'; errorCode: string | null
  authorUid: string; authorSecUid: string
}
export type CreatorActivityView = {
  workCount: number | null; countCheckedAt: string | null; checkedAt: string | null
  weeklyUpdateCount: number | null
  publicCountStatus?: 'complete' | 'pending'
  weekStart: string; weekEndExclusive: string; latestPublishedAt: string | null
  weeklyStatus: 'pending' | 'updated' | 'empty' | 'partial'; errorCode: string | null; lastAttemptAt: string | null
  refreshSchedule?: CreatorRefreshSchedule
  publicationInterval?:CreatorPublicationInterval
  recentActivity?:CreatorRecentActivity
  anomaly?:CreatorActivityAnomaly|null
  refreshCheck?: {checkedAt:string;reason:'count-unchanged'|'latest-unchanged';lastFullCheckedAt:string;basisWeekStart:string;nativeUnavailableReason?:string}
}
export type CreatorActivityState = {
  phase: 'idle' | 'running' | 'completed' | 'cancelled' | 'blocked'
  runId: string | null; message: string; total: number; done: number; succeeded: number; failed: number
  currentName: string | null; remainingIds: number[]; startedAt: string | null
  currentSecUid?:string
  weekStart: string; weekEndExclusive: string; savedTotalMs?: number; displayedTotalMs?: number
  activeListRequests?:number;reusedNativePages?:number;observedNativeListRequests?:number
  excludedNonPublicCount?:number;unverifiedVisibilityCount?:number
  requestAudit?:CreatorActivityRequestAudit
  ownerVerification?:CreatorActivityOwnerProof;ownerVerificationRequired?:boolean
  failureDiagnostic?:{creatorId:number;capturedAt:string;errorCode:string;screenshotSaved:boolean;pageSaved:boolean;capturePhase?:'frozen'|'complete';retainedTabId?:number}
  diagnosticSaveFailed?:boolean
  pacing?:CreatorRefreshPacing; notDueCount?:number; unchangedCount?:number; fullRefreshCount?:number
  waiting?:{kind:'author'|'batch'|'resume';until:string;batchNumber:number;totalBatches:number;durationMs:number}|null
  resumeWaitUntil?:string|null
  plannedWaitingMs?:number; mode?:'due'|'manual'|'resume'; scope?:CreatorRefreshScope
  anomalyCount?:number; repair?:boolean
}

export function classifyActivityVisibility(value:z.infer<typeof visibilitySchema>):string {
  if(value.isDelete===true)return 'deleted'
  if(value.isProhibited===true)return 'prohibited'
  if(value.privateStatus!==null&&value.privateStatus>0)return 'restricted'
  if((value.isStory!==null&&value.isStory>0)||(value.is24Story!==null&&value.is24Story>0))return 'temporary-marker'
  if(value.privateStatus===0&&value.isDelete===false&&value.isProhibited===false&&value.isStory===0&&value.is24Story===0&&value.allowShare!==false)return 'public'
  return 'unknown'
}

// Recalculate coverage from the whitelisted source pages rather than trusting a browser verdict.
export function acceptCreatorActivity(input: unknown, expected: {
  ownerSecUid: string; secUid: string; uid: string | null; weekStart: string; weekEndExclusive: string;repair?:boolean
}): {capture: CreatorActivityCapture; snapshot: CreatorActivitySnapshot} {
  const capture = creatorActivityCaptureSchema.parse(input)
  if (capture.ownerSecUid !== expected.ownerSecUid || capture.requestedSecUid !== expected.secUid
    || capture.profile.secUid !== expected.secUid || (expected.uid && capture.profile.uid !== expected.uid)) throw new Error('博主资料账号或作者归属不一致')
  if (capture.weekStart !== expected.weekStart || capture.weekEndExclusive !== expected.weekEndExclusive) throw new Error('本周追踪边界不一致')
  const week = calendarWeek(expected.weekStart)
  if (week.start !== expected.weekStart || week.endExclusive !== expected.weekEndExclusive) throw new Error('日历周边界无效')
  const network=capture.contract==='signaldesk-creator-activity/v6'||capture.contract==='signaldesk-creator-activity/v7'||capture.contract==='signaldesk-creator-activity/v8'
  const frontend=capture.contract==='signaldesk-creator-activity/v4'||network
  if(frontend&&!capture.frontendCount)throw new Error('主页作品计数缺失')
  if(frontend&&capture.pages.length>(expected.repair?200:10))throw new Error('本周动态超出读取范围')
  const countProof=capture.frontendCount
  if(frontend&&countProof?.count!==null&&countProof!==undefined){
    if(countProof.secUid!==expected.secUid||countProof.profileUrl!=='https://www.douyin.com/user/'+encodeURIComponent(expected.secUid)
      ||Number(countProof.text.replaceAll(',',''))!==countProof.count)throw new Error('主页作品计数或归属不一致')
    const countTime=Date.parse(countProof.checkedAt)
    if(countTime>Date.parse(capture.checkedAt)+60_000||countTime<Date.parse(capture.checkedAt)-120_000)throw new Error('主页作品计数时间无效')
  }
  const minRequests=network?capture.pages.filter(page=>page.sourceProof?.kind==='active-get').length:capture.pages.length+(frontend?0:1)
  if (capture.activeApiRequests < minRequests || capture.activeApiRequests > minRequests+1) throw new Error('资料请求计数不一致')
  if(['signaldesk-creator-activity/v7','signaldesk-creator-activity/v8'].includes(capture.contract)&&!capture.errorCode&&capture.activeApiRequests!==minRequests)throw new Error('资料请求计数不一致')
  const start = Date.parse(expected.weekStart), end = Date.parse(expected.weekEndExclusive), checked = Date.parse(capture.checkedAt)
  if (checked < start || checked > Date.now() + 60_000) throw new Error('检查时间无效')
  if(network)return acceptNetworkActivity(capture,expected,start,end,checked)
  let previousTime = Infinity, ordered = true, crossed = false, latest: string | null = null
  const seen = new Map<string, string>()
  const excluded = new Set<string>()
  const weeklyIds = new Set<string>()
  const cursors = new Set<number>([0])
  capture.pages.forEach((page, index) => {
    const seenBefore=seen.size+excluded.size
    for(const item of page.excludedAuthors){
      if(item.authorUid===capture.profile.uid||item.authorSecUid===expected.secUid)throw new Error('排除作品的作者身份存在冲突')
      if(seen.has(item.workId))throw new Error('同一作品来源发生冲突')
      excluded.add(item.workId)
    }
    for(const item of page.excludedNonPublic){
      if(item.authorUid!==capture.profile.uid||item.authorSecUid!==expected.secUid)throw new Error('非公开作品作者归属不一致')
      if(seen.has(item.workId))throw new Error('同一作品可见性发生冲突')
      excluded.add(item.workId)
    }
    if (index === 0 ? page.requestCursor !== 0 : !capture.pages[index-1].hasMore || page.requestCursor !== capture.pages[index-1].responseCursor) throw new Error('作品分页不连续')
    if (page.hasMore && (page.responseCursor === null || page.responseCursor === page.requestCursor)) throw new Error('作品分页没有推进')
    if(page.hasMore&&page.responseCursor!==null){if(cursors.has(page.responseCursor))throw new Error('作品分页游标重复');cursors.add(page.responseCursor)}
    for (const item of page.items) {
      if (item.authorUid !== capture.profile.uid || item.authorSecUid !== expected.secUid) throw new Error('作品作者归属不一致')
      if(excluded.has(item.workId))throw new Error('同一作品来源或可见性发生冲突')
      const encoded = JSON.stringify(item), prior = seen.get(item.workId)
      if (prior && prior !== encoded) throw new Error('同一作品来源发生冲突')
      if (prior) continue
      seen.set(item.workId, encoded)
      const time = Date.parse(item.publishedAt)
      if (time > checked + 60_000) throw new Error('作品发布时间超出检查时间')
      if (time >= start && time < end && time <= checked) {
        weeklyIds.add(item.workId)
        if (!latest || time > Date.parse(latest)) latest = item.publishedAt
      }
      if (item.pinned === null) ordered = false
      else if (!item.pinned) {
        if (time > previousTime) ordered = false
        previousTime = time
        if (time < start) crossed = true
      }
    }
    if (page.hasMore && page.items.length === 0 && page.excludedAuthors.length === 0 && page.excludedNonPublic.length === 0) ordered = false
    if(page.hasMore&&seen.size+excluded.size===seenBefore)throw new Error('作品分页没有新记录')
  })
  const last = capture.pages.at(-1)
  const ended = !!last && !last.hasMore
  // profile.workCount is only the platform's reported count; it may include non-public works.
  // The authenticated author's public list, continuously traversed to its end, is the count source.
  const complete = !capture.errorCode && ended
  const coverage = complete ? 'list-end'
    : !capture.errorCode && ordered && crossed ? 'week-boundary' : 'partial'
  return {capture, snapshot: {
    workCount:frontend?countProof!.count:complete?seen.size:null,workCountSource:frontend?'profile-tab':'public-list',
    workCountCheckedAt:frontend&&countProof?.count!==null&&countProof!==undefined?countProof.checkedAt:null,
    checkedAt: capture.checkedAt, weekStart: capture.weekStart, weekEndExclusive: capture.weekEndExclusive,
    weeklyUpdateCount: coverage === 'partial' ? null : weeklyIds.size,
    latestPublishedAt: latest, weeklyStatus: coverage === 'partial' ? 'partial' : latest ? 'updated' : 'empty', coverage,
    errorCode: capture.errorCode || (frontend&&countProof?.count===null?countProof.errorCode:coverage==='partial'?'WEEK_COVERAGE_INCOMPLETE':frontend||complete?null:'PUBLIC_LIST_INCOMPLETE'),
    authorUid: capture.profile.uid, authorSecUid: capture.profile.secUid
  }}
}

function acceptNetworkActivity(capture:CreatorActivityCapture,expected:{secUid:string},start:number,end:number,checked:number) {
  const native=capture.pages.filter(page=>page.sourceProof?.kind==='native-network').length
  if(capture.reusedNativePages!==native||capture.nativeListRequests===undefined||capture.nativeListRequests<native)throw new Error('原生响应复用计数不一致')
  const seen=new Map<string,string>(),cursors=new Set<number>([0]),weekly=new Set<string>()
  let previousTime=Infinity,ordered=true,crossed=false,unknown=false,latest:string|null=null
  for(const [index,page] of capture.pages.entries()){
    const proof=page.sourceProof
    if(!proof||!page.records||page.items.length||page.excludedAuthors.length||page.excludedNonPublic.length
      ||proof.secUid!==expected.secUid||proof.requestCursor!==page.requestCursor
      ||(capture.contract==='signaldesk-creator-activity/v6'&&index===0&&proof.kind!=='native-network')
      ||(capture.contract==='signaldesk-creator-activity/v7'&&proof.kind!=='active-get'))throw new Error('作品网络来源或归属无效')
    const observed=Date.parse(proof.observedAt)
    if(observed>checked+60_000||observed<checked-120_000)throw new Error('作品网络来源时间无效')
    if(index===0?page.requestCursor!==0:!capture.pages[index-1].hasMore||page.requestCursor!==capture.pages[index-1].responseCursor)throw new Error('作品分页不连续')
    if(page.hasMore){if(page.responseCursor===null||cursors.has(page.responseCursor))throw new Error('作品分页没有推进');cursors.add(page.responseCursor)}
    const before=seen.size
    for(const record of page.records){
      if((record.authorUid===capture.profile.uid)!==(record.authorSecUid===expected.secUid))throw new Error('作品作者归属冲突')
      const encoded=JSON.stringify(record),prior=seen.get(record.workId)
      if(prior&&prior!==encoded)throw new Error('同一作品来源或可见性发生冲突')
      if(prior)continue
      seen.set(record.workId,encoded)
      if(record.authorUid!==capture.profile.uid)continue
      const verdict=classifyActivityVisibility(record.visibility),time=record.publishedAt?Date.parse(record.publishedAt):null
      if(time!==null&&time>checked+60_000)throw new Error('作品发布时间超出检查时间')
      if(verdict==='public'&&time===null)throw new Error('公开作品发布时间缺失')
      if(verdict==='unknown'&&(time===null||(time>=start&&time<end&&time<=checked)))unknown=true
      if(verdict==='public'&&time!==null&&time>=start&&time<end&&time<=checked){weekly.add(record.workId);if(!latest||time>Date.parse(latest))latest=record.publishedAt}
      // Check ordering using ALL target records, including excluded works, so
      // filtering cannot hide an inversion and cause premature week completion.
      if(record.pinned===null||time===null)ordered=false
      else if(!record.pinned){if(time>previousTime)ordered=false;previousTime=time;if(time<start)crossed=true}
    }
    if(page.hasMore&&seen.size===before)throw new Error('作品分页没有新记录')
  }
  const ended=!!capture.pages.length&&!capture.pages.at(-1)!.hasMore
  const coverage:CreatorActivitySnapshot['coverage']=!capture.errorCode&&!unknown?(ended?'list-end':ordered&&crossed?'week-boundary':'partial'):'partial'
  const countProof=capture.frontendCount!
  const snapshot:CreatorActivitySnapshot={workCount:countProof.count,workCountSource:'profile-tab',workCountCheckedAt:countProof.count!==null?countProof.checkedAt:null,
    checkedAt:capture.checkedAt,weekStart:capture.weekStart,weekEndExclusive:capture.weekEndExclusive,weeklyUpdateCount:coverage==='partial'?null:weekly.size,
    latestPublishedAt:latest,weeklyStatus:coverage==='partial'?'partial':latest?'updated':'empty',coverage,
    errorCode:capture.errorCode||(unknown?'ACTIVITY_WORK_VISIBILITY_UNVERIFIED':countProof.count===null?countProof.errorCode:coverage==='partial'?'WEEK_COVERAGE_INCOMPLETE':null),
    authorUid:capture.profile.uid,authorSecUid:capture.profile.secUid}
  return {capture,snapshot}
}
