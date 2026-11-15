import {useEffect,useMemo,useRef,useState,type JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import {CREATOR_INTEREST_LABELS,type CreatorInterestTier} from '../../shared/creatorInterest'
import CreatorName from './CreatorName'
import {SearchBox} from './ui'

const PAGE_SIZE=20
export default function CreatorInterestPicker({creators,tier,ownerSecUid,savingKeys,onChange,onClose}:{
  creators:CreatorListItem[];tier:CreatorInterestTier;ownerSecUid:string;savingKeys:string[]
  onChange:(creator:CreatorListItem,tier:CreatorInterestTier|null)=>Promise<boolean>;onClose:()=>void
}):JSX.Element{
  const dialog=useRef<HTMLDialogElement>(null),[search,setSearch]=useState(''),[page,setPage]=useState(0)
  useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close()},[])
  const matches=useMemo(()=>{
    const query=search.normalize('NFKC').trim().toLocaleLowerCase()
    return creators.filter(creator=>!creator.isDemo&&(!query||`${creator.nickname} ${creator.signature} ${creator.note} ${creator.profileUrl} ${creator.nativeUid??''}`.normalize('NFKC').toLocaleLowerCase().includes(query)))
  },[creators,search])
  const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE)),currentPage=Math.min(page,pages-1)
  return <dialog ref={dialog} className="creator-interest-picker" aria-labelledby="creator-interest-picker-title" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose()}}}>
    <div className="creator-interest-picker-heading"><h2 id="creator-interest-picker-title">添加到{CREATOR_INTEREST_LABELS[tier]}兴趣度</h2><button type="button" className="button ghost compact" onClick={onClose}>完成</button></div>
    <p>从当前账号资料库选择博主。仅添加你选择的博主，其他博主保持未添加。</p>
    <SearchBox value={search} onChange={value=>{setSearch(value);setPage(0)}} placeholder="搜索博主名称、主页或批注"/>
    <div className="creator-interest-picker-results" data-testid="creator-interest-picker-results">
      {matches.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE).map(creator=>{
        const current=creator.interest?.tier,added=current===tier,key=ownerSecUid+':'+new URL(creator.profileUrl).pathname.split('/').at(-1),saving=savingKeys.includes(key)
        return <div className="creator-interest-picker-row" key={creator.id} data-creator-id={creator.id}>
          <div><strong><CreatorName name={creator.nickname} profileUrl={creator.profileUrl}/></strong><small title={creator.profileUrl}>{creator.profileUrl}</small><span>{current?`已在${CREATOR_INTEREST_LABELS[current]}兴趣度`:'未添加兴趣度'}</span></div>
          <button type="button" className={`button ${added?'ghost':'primary'} compact`} data-testid="add-creator-interest" aria-label={`${added?'已添加':current?'移入':'添加'} ${creator.nickname} 到${CREATOR_INTEREST_LABELS[tier]}兴趣度`} disabled={saving||added} onClick={()=>void onChange(creator,tier)}>{saving?'保存中':added?'已添加':current?'移入此分区':'添加'}</button>
        </div>
      })}
      {!matches.length&&<div className="creator-zone-empty">{search?'没有匹配的博主，可调整搜索词':'当前账号资料库暂无博主'}</div>}
    </div>
    <div className="creator-interest-picker-pagination"><span>共 {matches.length} 位 · 第 {currentPage+1}/{pages} 页</span><div><button type="button" className="button ghost compact" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><button type="button" className="button ghost compact" disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div></div>
  </dialog>
}
