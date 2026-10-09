import {z} from 'zod'
import type {CreatorRefreshTier} from './creatorRefreshPolicy'

export type CreatorPriorityMode='boost'|'reduce'
export type CreatorPriorityState={mode:CreatorPriorityMode|null;tier:CreatorRefreshTier|null;revision:number}
export const CREATOR_TIER_LABELS:Record<CreatorRefreshTier,string>={active:'高频',regular:'中频',inactive:'低频',dormant:'极低频',unknown:'待确认'}
export const DEFAULT_CREATOR_PRIORITY:CreatorPriorityState={mode:null,tier:null,revision:0}
const identity=z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
export const creatorPriorityInputSchema=z.object({ownerSecUid:identity,secUid:identity,mode:z.enum(['boost','reduce']).nullable(),revision:z.number().int().nonnegative()}).strict()
export type CreatorPriorityInput=z.infer<typeof creatorPriorityInputSchema>

/** One step from the automatic tier. Unknown joins regular on boost, inactive on reduction. */
export function adjustedCreatorTier(base:CreatorRefreshTier,mode:CreatorPriorityMode):CreatorRefreshTier{
  if(mode==='boost')return base==='dormant'?'inactive':base==='inactive'||base==='unknown'?'regular':'active'
  return base==='active'?'regular':base==='regular'?'inactive':'dormant'
}
