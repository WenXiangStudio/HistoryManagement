import {z} from 'zod'
import type {CreatorRefreshTier} from './creatorRefreshPolicy'
import type {FollowingSyncState} from './followingDirectory'
import type {CreatorListItem} from './contracts'
import {creatorRefreshSchedule} from './creatorRefreshPolicy'

export type CreatorPriorityMode='boost'|'reduce'
export type CreatorPriorityState={mode:CreatorPriorityMode|null;tier:CreatorRefreshTier|null;revision:number}
export const CREATOR_TIER_LABELS:Record<CreatorRefreshTier,string>={active:'高频',regular:'中频',inactive:'低频',dormant:'极低频',unknown:'待确认'}
export const DEFAULT_CREATOR_PRIORITY:CreatorPriorityState={mode:null,tier:null,revision:0}
const identity=z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
export const creatorPriorityInputSchema=z.object({ownerSecUid:identity,secUid:identity,mode:z.enum(['boost','reduce']).nullable(),revision:z.number().int().nonnegative()}).strict()
export type CreatorPriorityInput=z.infer<typeof creatorPriorityInputSchema>
export const creatorPriorityChangedSchema=z.object({source:z.literal('creator-priority'),ownerSecUid:identity,secUid:identity,
  priority:z.object({mode:z.enum(['boost','reduce']).nullable(),tier:z.enum(['active','regular','inactive','dormant']).nullable(),revision:z.number().int().nonnegative()}).strict()
    .refine(value=>(value.mode===null)===(value.tier===null))}).strict()
export type CreatorPriorityChanged=Omit<z.infer<typeof creatorPriorityChangedSchema>,'priority'>&{priority:CreatorPriorityState}

/** Apply a saved priority while retaining the creator's source fields and newer confirmations. */
export function withCreatorPriority(creator:CreatorListItem,priority:CreatorPriorityState):CreatorListItem{
  if((creator.refreshPriority?.revision??-1)>=priority.revision)return creator
  const activity=creator.activity,schedule=activity?.refreshSchedule
  return {...creator,refreshPriority:priority,...(schedule?{activity:{...activity,refreshSchedule:creatorRefreshSchedule(
    schedule.latestKnownPublishedAt,schedule.lastCheckedAt,(activity?.recentBaseline?.interval??activity?.publicationInterval)?.meanHours,Date.now(),priority)}}:{})}
}
export function applyCreatorPriorityChange(creators:CreatorListItem[],owner:string|null,event:CreatorPriorityChanged):CreatorListItem[]{
  if(owner!==event.ownerSecUid)return creators
  let changed=false
  const next=creators.map(creator=>{
    if(creator.isDemo||new URL(creator.profileUrl).pathname.split('/').at(-1)!==event.secUid)return creator
    const updated=withCreatorPriority(creator,event.priority);changed||=updated!==creator;return updated
  })
  return changed?next:creators
}

/** Only creator collection can change the automatic tier or an active refresh selection. */
export function creatorPriorityBusyReason(state?:Pick<FollowingSyncState,'phase'|'basic'|'activity'>|null):string|null{
  if(state&&['running','awaiting-config'].includes(state.phase))return '关注同步尚未结束，请完成或取消后再调整博主权重'
  if(state?.basic?.phase==='running')return '博主基础资料补充正在运行，请完成或取消后再调整权重'
  if(state?.activity?.phase==='running')return '博主资料刷新正在运行，请完成或取消后再调整权重'
  return null
}

/** One step from the current effective tier, clamped at the two ends. */
export function adjustedCreatorTier(base:CreatorRefreshTier,mode:CreatorPriorityMode):CreatorRefreshTier{
  if(mode==='boost')return base==='dormant'?'inactive':base==='inactive'||base==='unknown'?'regular':'active'
  return base==='active'?'regular':base==='regular'?'inactive':'dormant'
}
