import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react'
import {defaultRangeExtractor,observeElementRect,useVirtualizer,type Range} from '@tanstack/react-virtual'
import type {CreatorListItem} from '../../shared/contracts'
import {CreatorCardSessionProvider,type CreatorCardSession} from './CreatorCardSession'

/** Bound DOM, layout and Windows accessibility work to the viewport, not the library size. */
export default function VirtualCreatorGrid({creators,renderCard,sessions,focus}:{
  creators:CreatorListItem[];renderCard:(creator:CreatorListItem)=>ReactNode
  sessions:Map<number,CreatorCardSession>;focus:{creatorId:number;revision:number}|null
}){
  const grid=useRef<HTMLDivElement>(null),scroll=useRef<HTMLElement|null>(null)
  const [geometry,setGeometry]=useState({columns:3,margin:0,width:0})
  const [focused,setFocused]=useState<number|null>(null)
  const appliedFocus=useRef<number|null>(null)
  const rows=useMemo(()=>Array.from({length:Math.ceil(creators.length/geometry.columns)},(_,index)=>creators.slice(index*geometry.columns,(index+1)*geometry.columns)),[creators,geometry.columns])
  const rangeExtractor=useCallback((range:Range)=>{
    const visible=defaultRangeExtractor(range),index=focused===null?-1:creators.findIndex(c=>c.id===focused)
    if(index>=0)visible.push(Math.floor(index/geometry.columns))
    return [...new Set(visible)].sort((a,b)=>a-b)
  },[creators,focused,geometry.columns])
  const virtual=useVirtualizer<HTMLElement,HTMLDivElement>({
    count:rows.length,getScrollElement:()=>scroll.current,estimateSize:()=>950,overscan:1,gap:17,
    initialRect:{width:1000,height:900},scrollMargin:geometry.margin,
    observeElementRect:(instance,callback)=>observeElementRect(instance,rect=>{if(rect.width>0&&rect.height>0)callback(rect)}),
    measureElement:(element,entry)=>entry?.borderBoxSize[0]?.blockSize||element.getBoundingClientRect().height||950,
    getItemKey:index=>rows[index].map(c=>c.id).join(':'),rangeExtractor,
    useAnimationFrameWithResizeObserver:true
  })
  useLayoutEffect(()=>{
    const element=grid.current,workspace=element?.closest<HTMLElement>('.workspace')
    if(!element||!workspace)return
    scroll.current=workspace
    const measure=()=>{
      const rect=element.getBoundingClientRect(),parent=workspace.getBoundingClientRect()
      const columns=window.innerWidth>=1500?4:window.innerWidth<=1200?2:3
      const next={columns,margin:rect.top-parent.top+workspace.scrollTop,width:rect.width}
      setGeometry(previous=>previous.columns===next.columns&&Math.abs(previous.margin-next.margin)<1&&Math.abs(previous.width-next.width)<1?previous:next)
    }
    measure()
    const observer=new ResizeObserver(measure)
    observer.observe(workspace);if(element.parentElement)observer.observe(element.parentElement)
    window.addEventListener('resize',measure)
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);scroll.current=null}
  },[])
  useEffect(()=>{virtual.measure()},[geometry.width,geometry.columns])
  useEffect(()=>{
    if(!focus||appliedFocus.current===focus.revision)return
    const index=creators.findIndex(c=>c.id===focus.creatorId)
    if(index<0||!scroll.current)return
    appliedFocus.current=focus.revision
    virtual.scrollToIndex(Math.floor(index/geometry.columns),{align:'start'})
  },[focus,creators,geometry.columns,geometry.margin,virtual])
  return <div ref={grid} className="creator-virtual-grid" data-testid="creator-virtual-grid" role="list" aria-label="当前分组博主" style={{height:virtual.getTotalSize()}}
    onFocusCapture={event=>setFocused(Number((event.target as HTMLElement).closest<HTMLElement>('[data-creator-id]')?.dataset.creatorId)||null)}
    onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(null)}}>
    {virtual.getVirtualItems().map(row=><div key={row.key} ref={virtual.measureElement} data-index={row.index} className="creator-virtual-row" role="presentation"
      style={{gridTemplateColumns:`repeat(${geometry.columns},minmax(0,1fr))`,transform:`translateY(${row.start-geometry.margin}px)`}}>
      {rows[row.index].map((creator,column)=>{
        let session=sessions.get(creator.id)
        if(!session){session=new Map();sessions.set(creator.id,session)}
        return <div key={creator.id} role="listitem" aria-posinset={row.index*geometry.columns+column+1} aria-setsize={creators.length}>
          <CreatorCardSessionProvider session={session}>{renderCard(creator)}</CreatorCardSessionProvider>
        </div>
      })}
    </div>)}
  </div>
}
