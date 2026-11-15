import {createContext,useCallback,useContext,useLayoutEffect,useMemo,useSyncExternalStore,type JSX,type ReactNode} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import type {CreatorPriorityState} from '../../shared/creatorPriority'
import {creatorRecentActivity} from '../../shared/creatorRefreshPolicy'
type NameIdentity={profileUrl?:string|null;nativeUid?:string|null;ownerSecUid?:string|null;priority?:CreatorPriorityState|null}
type NameAppearance={priority:CreatorPriorityState|null;noRecentUpdates:boolean}
const DEFAULT_APPEARANCE:NameAppearance={priority:null,noRecentUpdates:false}
const profileKey=(value:string):string=>{try{const url=new URL(value);return url.origin==='https://www.douyin.com'?url.pathname.replace(/\/$/,''):''}catch{return ''}}
function nameStore(owner:string|null,initial:CreatorListItem[]){
  let profiles=new Map<string,NameAppearance>(),uids=new Map<string,NameAppearance>()
  const listeners=new Set<()=>void>()
  const replace=(creators:CreatorListItem[]):void=>{
    const nextProfiles=new Map<string,NameAppearance>(),nextUids=new Map<string,NameAppearance>()
    for(const creator of creators){
      if(creator.isDemo)continue
      const key=profileKey(creator.profileUrl),old=profiles.get(key)
      const priority=creator.refreshPriority??null,noRecentUpdates=creatorRecentActivity(creator).status==='empty'
      const appearance=old&&old.noRecentUpdates===noRecentUpdates&&old.priority?.revision===priority?.revision
        &&old.priority?.mode===priority?.mode&&old.priority?.tier===priority?.tier?old:{priority,noRecentUpdates}
      if(key)nextProfiles.set(key,appearance)
      if(creator.nativeUid)nextUids.set(creator.nativeUid,appearance)
    }
    profiles=nextProfiles;uids=nextUids
    for(const listener of listeners)listener()
  }
  replace(initial)
  return {owner,replace,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
    get:(profile:string,uid?:string|null):NameAppearance=>(profile?profiles.get(profile):uid?uids.get(uid):undefined)??DEFAULT_APPEARANCE}
}
const Context=createContext(nameStore(null,[]))
export function CreatorNameProvider({owner,creators,children}:{owner:string|null;creators:CreatorListItem[];children:ReactNode}):JSX.Element{
  const value=useMemo(()=>nameStore(owner,creators),[owner])
  // Notify after commit; only names whose identity appearance changed render again.
  useLayoutEffect(()=>value.replace(creators),[value,creators])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useCreatorNameAppearance(identity:NameIdentity):NameAppearance{
  const source=useContext(Context),profile=identity.profileUrl?profileKey(identity.profileUrl):''
  const foreign=!!identity.ownerSecUid&&identity.ownerSecUid!==source.owner
  const snapshot=useCallback(()=>foreign?DEFAULT_APPEARANCE:source.get(profile,identity.nativeUid),[source,foreign,profile,identity.nativeUid])
  const saved=useSyncExternalStore(source.subscribe,snapshot,snapshot)
  return useMemo(()=>foreign?DEFAULT_APPEARANCE:identity.priority!==undefined?{...saved,priority:identity.priority}:saved,[saved,identity.priority,foreign])
}
export function creatorNameClass(appearance:NameAppearance,option=false):string|undefined{
  return appearance.priority?.mode?(option?'creator-priority-option':'creator-priority-name')
    :appearance.noRecentUpdates?(option?'creator-no-updates-option':'creator-no-updates-name'):undefined
}
export default function CreatorName({name,...identity}:NameIdentity&{name:string}):JSX.Element{
  const appearance=useCreatorNameAppearance(identity)
  return <span className={creatorNameClass(appearance)} data-creator-name="true" data-priority={appearance.priority?.mode??undefined} data-no-recent-updates={appearance.noRecentUpdates||undefined}>{name}</span>
}
export function CreatorNameOption({name,value,suffix='',...identity}:NameIdentity&{name:string;value:string;suffix?:string}):JSX.Element{
  const appearance=useCreatorNameAppearance(identity)
  return <option value={value} className={creatorNameClass(appearance,true)} data-priority={appearance.priority?.mode??undefined} data-no-recent-updates={appearance.noRecentUpdates||undefined}>{name}{suffix}</option>
}
