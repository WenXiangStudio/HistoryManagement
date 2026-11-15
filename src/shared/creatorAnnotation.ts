import {z} from 'zod'
import type {CreatorListItem} from './contracts'

export const creatorAnnotationInputSchema=z.object({isStarred:z.boolean().optional(),note:z.string().max(20000).optional()}).strict()
export const creatorAnnotationChangedSchema=z.object({source:z.literal('creator-annotation'),ownerSecUid:z.string().min(1),
  secUid:z.string().min(1),revision:z.number().int().positive(),isStarred:z.boolean(),note:z.string()}).strict()
export type CreatorAnnotationChanged=z.infer<typeof creatorAnnotationChangedSchema>
export function withCreatorAnnotation(creator:CreatorListItem,event:CreatorAnnotationChanged):CreatorListItem{
  return creator.isStarred===event.isStarred&&creator.note===event.note?creator:{...creator,isStarred:event.isStarred,note:event.note}
}
export function applyCreatorAnnotation(creators:CreatorListItem[],owner:string|null,event:CreatorAnnotationChanged):CreatorListItem[]{
  if(owner!==event.ownerSecUid)return creators
  let changed=false
  const next=creators.map(creator=>{
    if(creator.isDemo||new URL(creator.profileUrl).pathname.split('/').at(-1)!==event.secUid)return creator
    const updated=withCreatorAnnotation(creator,event);changed||=updated!==creator;return updated
  })
  return changed?next:creators
}
