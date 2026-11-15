import type {CreatorListItem} from '../../shared/contracts'

/** IPC returns fresh objects even when nothing changed. Keep unchanged cards stable. */
export function reconcileCreatorList(previous:CreatorListItem[],incoming:CreatorListItem[]):CreatorListItem[]{
  const byId=new Map(previous.map(creator=>[creator.id,creator]))
  const next=incoming.map(creator=>{
    const old=byId.get(creator.id)
    return old&&(old===creator||JSON.stringify(old)===JSON.stringify(creator))?old:creator
  })
  return next.length===previous.length&&next.every((creator,index)=>creator===previous[index])?previous:next
}
