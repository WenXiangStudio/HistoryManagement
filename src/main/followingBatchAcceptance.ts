import { createHash } from 'node:crypto'
import { z } from 'zod'
import { followingDirectoryReportSchema, type FollowingDirectoryReport } from '../shared/followingDirectory'

const bindingSchema=z.object({secUid:z.string(),nickname:z.string(),profileUrl:z.string().url(),avatarUrl:z.string().url(),
  signature:z.string(),imageAlt:z.string(),imageLoaded:z.literal(true),anchorProfileUrl:z.string().url().nullable(),
  avatarLinkUrl:z.string().url(),nicknameAnchorProfileUrl:z.string().url(),relationship:z.enum(['已关注','相互关注']),
  bindingMethod:z.literal('image-and-signature-inside-exact-profile-card')})
const captureSchema=z.object({ok:z.literal(true),collectedAt:z.string().datetime(),ownerNickname:z.string().min(1).max(200),
  sourceUrl:z.literal('https://www.douyin.com/user/self'),activeFollowingTab:z.literal(true),listStartedAtTop:z.literal(true),
  hasMore:z.boolean(),visibleItemCount:z.number().int().nonnegative(),activeApiRequests:z.literal(0),workResponseBodiesRead:z.literal(0),
  requestedCount:z.union([z.literal(10),z.literal(20)]),creators:z.array(z.object({uid:z.null(),secUid:z.string(),nickname:z.string(),
    avatarUrl:z.string().url(),signature:z.string(),profileUrl:z.string().url()})).max(20),bindings:z.array(bindingSchema).max(20),
  timing:z.object({status:z.literal('completed'),totalMs:z.number().finite().nonnegative(),successfulCount:z.number().int(),
    averageMsPerCreator:z.number().finite().nonnegative()})})

export function acceptFollowingCapture(input:unknown,scope:{runId:string;limit:10|20;ownerNickname:string|null;excludeSecUids:string[]}):{
  report:FollowingDirectoryReport;acquisitionMs:number
}{
  const capture=captureSchema.parse(input)
  if(capture.requestedCount!==scope.limit || capture.creators.length!==scope.limit || capture.bindings.length!==scope.limit
    ||capture.timing.successfulCount!==scope.limit)throw new Error('本轮资料未达到确认数量')
  if(scope.ownerNickname && capture.ownerNickname!==scope.ownerNickname)throw new Error('当前页面账号与已有目录不一致')
  const excluded=new Set(scope.excludeSecUids),bindings=new Map(capture.bindings.map(item=>[item.secUid,item]))
  if(bindings.size!==scope.limit)throw new Error('头像归属记录重复')
  for(const creator of capture.creators){
    const binding=bindings.get(creator.secUid)
    if(excluded.has(creator.secUid))throw new Error('本轮返回了已保存博主')
    if(!binding || binding.nickname!==creator.nickname || binding.profileUrl!==creator.profileUrl
      ||binding.nicknameAnchorProfileUrl!==creator.profileUrl || binding.avatarUrl!==creator.avatarUrl
      ||binding.signature!==creator.signature || binding.imageAlt!==`${creator.nickname}头像`)throw new Error('博主字段或头像归属不一致')
    if(binding.anchorProfileUrl ? binding.anchorProfileUrl!==creator.profileUrl : new URL(binding.avatarLinkUrl).origin!=='https://live.douyin.com')throw new Error('头像链接来源不一致')
  }
  const creators=capture.creators
  const report=followingDirectoryReportSchema.parse({contract:'signaldesk-visible-following/v1',runId:scope.runId,
    collectedAt:capture.collectedAt,ownerSecUid:null,ownerNickname:capture.ownerNickname,sourceUrl:capture.sourceUrl,
    sourceKind:'visible-following-list',activeFollowingTab:true,listStartedAtTop:true,hasMore:capture.hasMore,
    visibleItemCount:capture.visibleItemCount,creators,
    projectionSha256:createHash('sha256').update(JSON.stringify(creators)).digest('hex'),activeApiRequests:0,workResponseBodiesRead:0})
  return {report,acquisitionMs:capture.timing.totalMs}
}
