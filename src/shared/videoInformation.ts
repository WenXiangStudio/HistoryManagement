import {z} from 'zod'
import {creatorActivityOwnerProofSchema} from './creatorActivity'
import type {VideoContentInfo,VideoContentBatch,VideoContentRuntime} from './videoContent'

const identity=z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()
export const videoInformationSchema=z.object({
  workId:z.string().regex(/^\d{8,30}$/),authorUid:identity,authorSecUid:identity,publishedAt:z.string().datetime(),
  description:z.string().max(20000).nullable(),title:z.string().max(120).nullable(),titleSource:z.literal('description-derived'),
  durationMs:count,awemeType:z.literal(0),
  visibility:z.object({privateStatus:z.literal(0),isDelete:z.literal(false),isProhibited:z.literal(false),
    allowShare:z.boolean().nullable(),isStory:z.literal(0),is24Story:z.literal(0),awemeType:z.literal(0)}).strict(),
  statistics:z.object({likeCount:count,commentCount:count,collectCount:count,shareCount:count}).strict()
}).strict()
export type VideoInformation=z.infer<typeof videoInformationSchema>
export type SavedVideoInformation=VideoInformation & {checkedAt:string;firstCollectedAt:string;runId:string;sourceKind:'native-network'|'active-get';content?:VideoContentInfo}
export const videoInformationCaptureSchema=z.object({contract:z.literal('signaldesk-video-information/v1'),
  ownerVerification:creatorActivityOwnerProofSchema,work:videoInformationSchema,
  sourceProof:z.object({kind:z.enum(['native-network','active-get']),endpoint:z.enum(['/aweme/v1/web/aweme/post/','/aweme/v1/web/aweme/detail/']),method:z.literal('GET'),
    secUid:identity,requestCursor:z.literal(0),httpStatus:z.literal(200),observedAt:z.string().datetime()}).strict(),
  checkedAt:z.string().datetime(),acquisitionMs:z.number().finite().nonnegative().max(60000),
  audit:z.object({authorHomepageNavigations:z.literal(1),ownerVerificationGets:z.number().int().min(0).max(1),activeWorkGets:z.number().int().min(0).max(2),
    networkRequestsObserved:z.number().int().nonnegative(),platformApiGetsObserved:z.number().int().nonnegative(),
    selfGetsObserved:z.number().int().nonnegative(),listGetsObserved:z.number().int().nonnegative()}).strict()
}).strict()
export type VideoInformationCapture=z.infer<typeof videoInformationCaptureSchema>
export type VideoInformationTarget={creatorId:number;nickname:string;authorUid:string;authorSecUid:string;workId:string;publishedAt:string}
export type VideoInformationCommand=VideoInformationTarget & {action:'video-information';runId:string;ownerSecUid:string;ownerUid:string;captureEvidence?:boolean}
export type VideoInformationState={phase:'idle'|'running'|'completed'|'blocked'|'cancelled';runId:string|null;ownerSecUid:string|null;
  creatorId:number|null;message:string;errorCode?:string;startedAt?:string;capture?:VideoInformationCapture;reportPath?:string;savedTotalMs?:number;displayedTotalMs?:number;
  evidence?:{directory:string;mediaPath:string;byteLength:number;sha256:string;capturedAt:string}}
export type VideoInformationView={ownerSecUid:string;creatorId:number;records:SavedVideoInformation[];state:VideoInformationState}
export type VideoLibraryOptions={creatorSecUid?:string;startDate?:string;endDate?:string;interest?:'unmarked'|'interested'|'not-interested'}
export type VideoLibraryView={ownerSecUid:string|null;records:SavedVideoInformation[];state:VideoInformationState;contentBatches?:VideoContentBatch[];runtime?:VideoContentRuntime}

export function videoInformationErrorMessage(code:string):string {
  if(code==='VIDEO_CANCELLED')return '已取消视频信息采集，已保存资料保留'
  if(code==='VIDEO_NOT_IN_FIRST_PAGE')return '主页首屏没有找到本地记录的视频，请先刷新这位博主的主页状态，再重新采集'
  if(code.includes('OWNER')||code==='LOGIN_REQUIRED')return '浏览器登录账号需要核验，请检查登录状态与 APP 所选账号'
  if(code==='CAPTCHA_OR_SECURITY_CHALLENGE'||/^ACTIVITY_HTTP_(403|429)$/.test(code))return '平台要求验证或限制访问，本次已停止，请先在浏览器查看'
  if(code.includes('AUTHOR')||code.includes('MISMATCH')||code==='VIDEO_VALIDATION_FAILED')return '视频信息或归属未通过校验，本次未写入，已有资料保留'
  if(code.includes('DISCONNECTED')||code.includes('RESTARTED'))return '浏览器连接或应用运行已中断，已有视频信息保留'
  return '视频信息未完成，已有资料保留；请检查浏览器或刷新主页后再试'
}

export function acceptVideoInformation(input:unknown,command:VideoInformationCommand,startedAt:string):VideoInformationCapture {
  const capture=videoInformationCaptureSchema.parse(input),{work,sourceProof:source,ownerVerification:owner,audit}=capture
  if(source.endpoint==='/aweme/v1/web/aweme/detail/'&&!command.captureEvidence)throw Error('VIDEO_SOURCE_SCOPE_INVALID')
  if(work.workId!==command.workId||work.authorUid!==command.authorUid||work.authorSecUid!==command.authorSecUid
    ||work.publishedAt!==command.publishedAt||source.secUid!==command.authorSecUid)throw Error('VIDEO_AUTHOR_OR_WORK_MISMATCH')
  if(owner.runId!==command.runId||owner.uid!==command.ownerUid||owner.secUid!==command.ownerSecUid
    ||owner.firstAuthorSecUid!==command.authorSecUid)throw Error('VIDEO_OWNER_MISMATCH')
  if(work.visibility.allowShare===false)throw Error('VIDEO_PUBLIC_STATUS_UNVERIFIED')
  const derived=work.description?.split(/\r?\n/).find(line=>line.trim())?.trim().slice(0,120)||null
  if(work.title!==derived)throw Error('VIDEO_TITLE_SOURCE_INVALID')
  const start=Date.parse(startedAt),end=Date.parse(capture.checkedAt)
  if(end<start||end>Date.now()+60000||Date.parse(work.publishedAt)>end+60000
    ||[source.observedAt,owner.observedAt,owner.navigationStartedAt].some(at=>Date.parse(at)<start||Date.parse(at)>end))throw Error('VIDEO_EVIDENCE_TIME_INVALID')
  const workGetsValid=source.endpoint==='/aweme/v1/web/aweme/detail/'&&command.captureEvidence
    ?source.kind==='active-get'&&[1,2].includes(audit.activeWorkGets):(source.kind==='native-network'?0:1)===audit.activeWorkGets
  if((owner.kind==='native-network'?0:1)!==audit.ownerVerificationGets
    ||!workGetsValid
    ||source.kind==='native-network'&&audit.listGetsObserved===0
    ||audit.platformApiGetsObserved>audit.networkRequestsObserved||audit.selfGetsObserved+audit.listGetsObserved>audit.platformApiGetsObserved)throw Error('VIDEO_REQUEST_AUDIT_INVALID')
  return capture
}
