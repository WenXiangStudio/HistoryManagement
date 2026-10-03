import {createHash} from 'node:crypto'
import {z} from 'zod'
import {followingCreatorSchema,structuredFollowingReportSchema,type FollowingDirectoryReport} from '../shared/followingDirectory'
const ownerSchema=z.object({uid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/),secUid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/),nickname:z.string().min(1).max(200)})
const pageSchema=z.object({position:z.number().int().positive(),requestOwnerSecUid:z.string(),responseOwnerUid:z.string().nullable(),
  requestMaxTime:z.number().int().nonnegative(),requestOffset:z.number().int().nonnegative(),responseMinTime:z.number().nullable(),responseOffset:z.number().nullable(),
  hasMore:z.boolean(),creators:z.array(followingCreatorSchema).max(200)})
export const structuredCaptureSchema=z.object({ok:z.literal(true),contract:z.literal('signaldesk-structured-following-capture/v1'),
  prepared:z.boolean(),sourceUrl:z.literal('https://www.douyin.com/user/self'),owner:ownerSchema,requestedCount:z.number().int(),
  creators:z.array(followingCreatorSchema).max(20),pages:z.array(pageSchema).min(1).max(20),selfStatusCode:z.literal(0),followingStatusCode:z.literal(0),
  activeApiRequests:z.number().int().min(2).max(21),workResponseBodiesRead:z.literal(0),domQueries:z.literal(0),uiClicks:z.literal(0),
  collectedAt:z.string().datetime(),hasMore:z.boolean(),seenCount:z.number().int().nonnegative(),acquisitionMs:z.number().finite().nonnegative()})
export function verifyStructuredSource(input:unknown,expected:{ownerNickname:string|null;ownerSecUid?:string|null}){
  const capture=structuredCaptureSchema.parse(input)
  if(expected.ownerSecUid?capture.owner.secUid!==expected.ownerSecUid:expected.ownerNickname&&capture.owner.nickname!==expected.ownerNickname)throw new Error('当前账号与已有目录不一致')
  capture.pages.forEach((page,index)=>{
    if(page.position!==index+1||page.requestOwnerSecUid!==capture.owner.secUid||(page.responseOwnerUid&&page.responseOwnerUid!==capture.owner.uid))throw new Error('关注接口账号归属不一致')
    if(index===0&&(page.requestMaxTime!==0||page.requestOffset!==0))throw new Error('关注接口未从第一页开始')
    const previous=capture.pages[index-1]
    if(previous&&(!previous.hasMore||page.requestMaxTime!==previous.responseMinTime))throw new Error('关注分页来源不连续')
  })
  if(capture.activeApiRequests!==capture.pages.length+1)throw new Error('关注接口请求计数不一致')
  return capture
}
export function acceptStructuredFollowingCapture(input:unknown,scope:{runId:string;limit:10|20;ownerNickname:string|null;ownerSecUid?:string|null;excludeSecUids:string[]}):{report:FollowingDirectoryReport;acquisitionMs:number}{
  const capture=verifyStructuredSource(input,scope)
  if(capture.prepared||capture.requestedCount!==scope.limit||capture.creators.length!==scope.limit)throw new Error('本轮资料未达到确认数量')
  const expected=[],seen=new Set(),excluded=new Set(scope.excludeSecUids)
  for(const page of capture.pages)for(const creator of page.creators){
    if(!excluded.has(creator.secUid)&&!seen.has(creator.secUid)&&expected.length<scope.limit){expected.push(creator);seen.add(creator.secUid)}
  }
  if(JSON.stringify(expected)!==JSON.stringify(capture.creators))throw new Error('博主字段与接口来源记录不一致')
  const report=structuredFollowingReportSchema.parse({contract:'signaldesk-structured-following/v1',runId:scope.runId,collectedAt:capture.collectedAt,
    ownerSecUid:capture.owner.secUid,ownerUid:capture.owner.uid,ownerNickname:capture.owner.nickname,sourceUrl:capture.sourceUrl,sourceKind:'structured-following-api',
    endpointPath:'/aweme/v1/web/user/following/list/',hasMore:capture.hasMore,pageCount:capture.pages.length,creators:capture.creators,
    projectionSha256:createHash('sha256').update(JSON.stringify(capture.creators)).digest('hex'),activeApiRequests:capture.activeApiRequests,workResponseBodiesRead:0,domQueries:0,uiClicks:0})
  return {report,acquisitionMs:capture.acquisitionMs}
}
