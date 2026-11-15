import {createContext,useCallback,useContext,useRef,useState,type Dispatch,type ReactNode,type SetStateAction} from 'react'

export type CreatorCardSession=Map<string,unknown>
const Context=createContext<CreatorCardSession|null>(null)
export function CreatorCardSessionProvider({session,children}:{session:CreatorCardSession;children:ReactNode}){
  return <Context.Provider value={session}>{children}</Context.Provider>
}
/** Viewport recycling must preserve drafts and expanded sections by account/profile. */
export function useCreatorCardState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
  const session=useContext(Context),current=useRef<T>(session?.has(key)?session.get(key) as T:initial)
  const [value,setValue]=useState(current.current)
  const set=useCallback<Dispatch<SetStateAction<T>>>(input=>{
    const next=typeof input==='function'?(input as (previous:T)=>T)(current.current):input
    current.current=next;session?.set(key,next);setValue(next)
  },[session,key])
  return [value,set]
}
