import {createContext,useContext,useMemo,type JSX,type ReactNode} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import type {CreatorPriorityState} from '../../shared/creatorPriority'
import {creatorRecentActivity} from '../../shared/creatorRefreshPolicy'
type NameIdentity={profileUrl?:string|null;nativeUid?:string|null;ownerSecUid?:string|null;priority?:CreatorPriorityState|null}
type NameAppearance={priority:CreatorPriorityState|null;noRecentUpdates:boolean}
const DEFAULT_APPEARANCE:NameAppearance={priority:null,noRecentUpdates:false}
const Context=createContext<{owner:string|null;profiles:Map<string,NameAppearance>;uids:Map<string,NameAppearance>}>({owner:null,profiles:new Map(),uids:new Map()})
const profileKey=(value:string):string=>{try{const url=new URL(value);return url.origin==='https://www.douyin.com'?url.pathname.replace(/\/$/,''):''}catch{return ''}}
export function CreatorNameProvider({owner,creators,children}:{owner:string|null;creators:CreatorListItem[];children:ReactNode}):JSX.Element{
  const value=useMemo(()=>{const profiles=new Map<string,NameAppearance>(),uids=new Map<string,NameAppearance>()
    for(const creator of creators){
      if(creator.isDemo)continue
      const appearance={priority:creator.refreshPriority??null,noRecentUpdates:creatorRecentActivity(creator).status==='empty'}
      const key=profileKey(creator.profileUrl)
      if(key)profiles.set(key,appearance)
      if(creator.nativeUid)uids.set(creator.nativeUid,appearance)
    }
    return {owner,profiles,uids}
  },[owner,creators])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useCreatorNameAppearance(identity:NameIdentity):NameAppearance{
  const source=useContext(Context)
  if(identity.ownerSecUid&&identity.ownerSecUid!==source.owner)return DEFAULT_APPEARANCE
  const saved=(identity.profileUrl?source.profiles.get(profileKey(identity.profileUrl)):identity.nativeUid?source.uids.get(identity.nativeUid):undefined)??DEFAULT_APPEARANCE
  return identity.priority!==undefined?{...saved,priority:identity.priority}:saved
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
