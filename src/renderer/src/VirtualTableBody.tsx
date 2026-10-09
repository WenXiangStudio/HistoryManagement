import {cloneElement,useLayoutEffect,useMemo,useRef,useState,type JSX,type ReactElement} from 'react'

/** Keep native table columns/headers, while laying out only rows near the scroll viewport. */
export default function VirtualTableBody<T>({rows,rowKey,renderRow,columnCount,estimatedHeight,layoutKey='',pinnedKey}: {
  rows:T[];rowKey:(row:T)=>string;renderRow:(row:T,index:number)=>ReactElement;columnCount:number
  estimatedHeight:number;layoutKey?:string;pinnedKey?:string
}):JSX.Element{
  const body=useRef<HTMLTableSectionElement>(null)
  const [viewport,setViewport]=useState({top:0,height:600})
  const [measured,setMeasured]=useState<{layout:string;heights:Map<string,number>}>(()=>({layout:layoutKey,heights:new Map()}))
  const heights=measured.layout===layoutKey?measured.heights:null
  const keys=rows.map(rowKey)
  const offsets=useMemo(()=>{
    const values=[0]
    for(const key of keys)values.push(values.at(-1)!+(heights?.get(key)??estimatedHeight))
    return values
  },[rows,heights,estimatedHeight,layoutKey])
  let first=0,last=0
  while(first<rows.length&&offsets[first+1]<viewport.top)first++
  last=first
  while(last<rows.length&&offsets[last]<viewport.top+viewport.height)last++
  first=Math.max(0,first-5);last=Math.min(rows.length,last+5)
  const visible=new Set(Array.from({length:last-first},(_,index)=>first+index))
  const pinned=pinnedKey?keys.indexOf(pinnedKey):-1
  if(pinned>=0)visible.add(pinned)
  const indices=[...visible].sort((a,b)=>a-b),range=indices.map(index=>keys[index]).join('|')
  useLayoutEffect(()=>{
    const element=body.current,table=element?.closest('table'),scroll=table?.parentElement
    if(!element||!table||!scroll)return
    let frame=0,disposed=false
    const readViewport=():void=>{
      frame=0
      if(disposed)return
      const top=Math.max(0,scroll.scrollTop-(table.tHead?.offsetHeight??0)),height=scroll.clientHeight||600
      setViewport(previous=>previous.top===top&&previous.height===height?previous:{top,height})
    }
    const schedule=():void=>{if(!frame)frame=requestAnimationFrame(readViewport)}
    readViewport();scroll.addEventListener('scroll',schedule,{passive:true})
    const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule)
    resize?.observe(scroll);if(table.tHead)resize?.observe(table.tHead)
    return()=>{disposed=true;cancelAnimationFrame(frame);scroll.removeEventListener('scroll',schedule);resize?.disconnect()}
  },[])
  useLayoutEffect(()=>{
    const element=body.current
    if(!element||typeof ResizeObserver==='undefined')return
    const observer=new ResizeObserver(entries=>{
      setMeasured(previous=>{
        const next=new Map(previous.layout===layoutKey?previous.heights:[])
        let changed=previous.layout!==layoutKey
        for(const entry of entries){
          const key=(entry.target as HTMLElement).dataset.virtualKey!,height=entry.borderBoxSize[0]?.blockSize??entry.contentRect.height
          if(height>0&&Math.abs((next.get(key)??estimatedHeight)-height)>.5){next.set(key,height);changed=true}
        }
        return changed?{layout:layoutKey,heights:next}:previous
      })
    })
    element.querySelectorAll('[data-virtual-key]').forEach(row=>observer.observe(row))
    return()=>observer.disconnect()
  },[range,layoutKey,estimatedHeight])
  const children:ReactElement[]=[]
  const spacer=(start:number,end:number):void=>{
    if(end<=start)return
    children.push(<tr key={`gap-${start}`} aria-hidden="true" className="virtual-table-spacer"><td colSpan={columnCount} style={{height:offsets[end]-offsets[start]}}/></tr>)
  }
  let previous=0
  for(const index of indices){
    spacer(previous,index)
    children.push(cloneElement(renderRow(rows[index],index),{'data-virtual-key':keys[index],'aria-rowindex':index+2,key:keys[index]} as Record<string,unknown>))
    previous=index+1
  }
  spacer(previous,rows.length)
  return <tbody ref={body}>{children}</tbody>
}
