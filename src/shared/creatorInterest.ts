import {z} from 'zod'
import type {CreatorListItem} from './contracts'

export const CREATOR_INTEREST_LABELS={high:'高',medium:'中',weak:'弱'} as const
export const creatorInterestTierSchema=z.enum(['high','medium','weak'])
export type CreatorInterestTier=z.infer<typeof creatorInterestTierSchema>
export type CreatorInterestState={tier:CreatorInterestTier|null;revision:number}
export const creatorInterestInputSchema=z.object({ownerSecUid:z.string().min(1),secUid:z.string().min(1),
  tier:creatorInterestTierSchema.nullable(),revision:z.number().int().nonnegative()}).strict()
export type CreatorInterestInput=z.infer<typeof creatorInterestInputSchema>
export const creatorInterestChangedSchema=z.object({source:z.literal('creator-interest'),ownerSecUid:z.string().min(1),secUid:z.string().min(1),
  interest:z.object({tier:creatorInterestTierSchema.nullable(),revision:z.number().int().nonnegative()}).strict()}).strict()
export type CreatorInterestChanged=z.infer<typeof creatorInterestChangedSchema>
export function withCreatorInterest(creator:CreatorListItem,interest:CreatorInterestState):CreatorListItem{
  return creator.interest?.tier===interest.tier&&creator.interest?.revision===interest.revision?creator:{...creator,interest}
}
export function applyCreatorInterestChange(creators:CreatorListItem[],owner:string|null,event:CreatorInterestChanged):CreatorListItem[]{
  if(owner!==event.ownerSecUid)return creators
  let changed=false
  const next=creators.map(creator=>{
    if(creator.isDemo||new URL(creator.profileUrl).pathname.split('/').at(-1)!==event.secUid)return creator
    const updated=withCreatorInterest(creator,event.interest);changed||=updated!==creator;return updated
  })
  return changed?next:creators
}
