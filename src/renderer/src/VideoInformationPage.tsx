import {useCallback,useEffect,useMemo,useRef,useState,type JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import {creatorNeedsVerification} from '../../shared/creatorRefreshPolicy'
import type {VideoLibraryView,VideoInformationState} from '../../shared/videoInformation'
import type {VideoContentDetail} from '../../shared/videoContent'
import VideoClassificationPanel,{ClassificationFrames} from './VideoClassificationPanel'
import {VIDEO_CLASS_LABELS,effectiveVideoClass} from '../../shared/videoWorkflow'
import CreatorName from './CreatorName'
import './videoInformation.css'

type Props={ownerSecUid:string|null;creators:CreatorListItem[];focus:{creatorId:number;revision:number}|null;
  canCollect:boolean;collectionState?:VideoInformationState;onOpenCreator:(creator:CreatorListItem)=>void;onOpenWorkshop?:(workId:string)=>void}
type Sort='published'|'collected'|'likes'
const date=(value:string,full=false)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
  ...(full?{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false} as const:{})}).format(new Date(value))
const count=(value:number|null)=>value===null?'未取得':new Intl.NumberFormat('zh-CN').format(value)
const duration=(ms:number|null)=>ms===null?'时长未取得':`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`
const preview=(title:string|null,description:string|null)=>description?.startsWith(title||'')?description.slice(title?.length||0).trim():description
const interestLabel=(interest?:'unmarked'|'interested'|'not-interested')=>interest==='interested'?'感兴趣':interest==='not-interested'?'不感兴趣':'未标记'
const secUid=(creator:CreatorListItem)=>{try{return new URL(creator.profileUrl).pathname.split('/').at(-1)||''}catch{return ''}}
function Glyph({kind='video'}:{kind?:'video'|'search'|'arrow'|'check'}):JSX.Element {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {kind==='search'?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>:kind==='arrow'?<path d="M5 12h14m-5-5 5 5-5 5"/>:kind==='check'?<path d="m5 12 4 4L19 6"/>:<><rect x="3" y="4" width="18" height="16" rx="4"/><path d="m10 8 6 4-6 4Z"/></>}
  </svg>
}
export default function VideoInformationPage({ownerSecUid,creators,focus,canCollect,collectionState,onOpenCreator,onOpenWorkshop}:Props):JSX.Element {
  const [view,setView]=useState<VideoLibraryView|null>(null),[error,setError]=useState(''),[search,setSearch]=useState('')
  const [author,setAuthor]=useState<string>('all'),[sort,setSort]=useState<Sort>('published'),[selectedId,setSelectedId]=useState<string|null>(null)
  const [startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[interestFilter,setInterestFilter]=useState<'all'|'unmarked'|'interested'|'not-interested'>('all')
  const [checked,setChecked]=useState<Set<string>>(new Set()),[chosenCreators,setChosenCreators]=useState<number[]>([]),[chooser,setChooser]=useState(false),[creatorQuery,setCreatorQuery]=useState('')
  const [detail,setDetail]=useState<VideoContentDetail|null>(null)
  const [limit,setLimit]=useState(50),[submitting,setSubmitting]=useState(false),[copied,setCopied]=useState(false)
  const generation=useRef(0),sequence=useRef(0),clicked=useRef<string|null>(null),reading=useRef<HTMLElement>(null)
  const selectedWorkRef=useRef<string|null>(null)
  const appliedFocus=useRef<number|null>(null)
  const realCreators=useMemo(()=>creators.filter(c=>!c.isDemo),[creators])
  const creatorBySec=useMemo(()=>new Map(realCreators.map(c=>[secUid(c),c])),[realCreators])
  const load=useCallback(async()=>{
    const current=++sequence.current,epoch=generation.current
    try{
      const next=await window.signalDesk.getVideoLibrary({startDate:startDate||undefined,endDate:endDate||undefined,interest:interestFilter==='all'?undefined:interestFilter})
      if(epoch!==generation.current||current!==sequence.current)return
      if(next.ownerSecUid!==ownerSecUid){setView(null);setError('资料账号已变化，请等待页面更新');return}
      setView(next);setError('')
    }catch(reason){if(epoch===generation.current&&current===sequence.current)setError(reason instanceof Error?reason.message:'无法读取已保存的视频信息')}
  },[ownerSecUid,startDate,endDate,interestFilter])
  // React Activity suspends effects when this page is hidden, keeping selection
  // without hidden polling or late results crossing account boundaries.
  useEffect(()=>{++generation.current;setSubmitting(false);void load();return()=>{++generation.current;++sequence.current}},[load])
  useEffect(()=>{void load()},[collectionState?.runId,collectionState?.phase,collectionState?.displayedTotalMs,load])
  useEffect(()=>window.signalDesk.onDataChanged?.(()=>void load()),[load])
  const activeBatch=view?.contentBatches?.find(b=>b.state==='running'||b.state==='queued')
  const latestBatch=activeBatch??view?.contentBatches?.[0]
  const state=view?.state,capturing=state?.phase==='running',running=capturing||!!activeBatch
  useEffect(()=>{
    if(!running)return
    const timer=setInterval(()=>void load(),700);return()=>clearInterval(timer)
  },[running,load])
  useEffect(()=>{
    if(!focus||appliedFocus.current===focus.revision)return
    appliedFocus.current=focus.revision
    setAuthor(String(focus.creatorId));setSearch('');setSelectedId(null);setLimit(50)
  },[focus?.creatorId,focus?.revision])
  useEffect(()=>{setLimit(50)},[search,author,sort])
  const records=view?.records??[]
  const authorCounts=useMemo(()=>{const counts=new Map<string,number>();for(const row of records)counts.set(row.authorSecUid,(counts.get(row.authorSecUid)||0)+1);return counts},[view])
  const filterCreator=realCreators.find(c=>String(c.id)===author)
  const filtered=useMemo(()=>{
    const query=search.normalize('NFKC').trim().toLocaleLowerCase(),key=filterCreator?secUid(filterCreator):author==='all'?null:'unavailable'
    return records.filter(row=>(key===null||row.authorSecUid===key)&&(!query||[row.title,row.description,row.workId,creatorBySec.get(row.authorSecUid)?.nickname].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query)))
      .sort((a,b)=>sort==='likes'?(b.statistics.likeCount??-1)-(a.statistics.likeCount??-1)||b.publishedAt.localeCompare(a.publishedAt)
        :sort==='collected'?b.firstCollectedAt.localeCompare(a.firstCollectedAt):b.publishedAt.localeCompare(a.publishedAt))
  },[view,filterCreator,author,search,sort,creatorBySec])
  const selected=filtered.find(row=>row.workId===selectedId)??filtered[0]
  selectedWorkRef.current=selected?.workId??null
  useEffect(()=>{
    if(!ownerSecUid||!latestBatch||latestBatch.kind!=='process'||['triage','workflow'].includes(latestBatch.provider??'')||latestBatch.provider==='cloud-frames'||!window.signalDesk.ackVideoContentRendered)return
    const ids=filtered.slice(0,limit).filter(w=>w.content?.stages.transcript?.state==='completed'||w.content?.stages.summary?.state==='completed').map(w=>w.workId)
    if(!ids.some(id=>latestBatch.completedWorkIds.includes(id)))return
    const frame=requestAnimationFrame(()=>void window.signalDesk.ackVideoContentRendered(ownerSecUid,latestBatch.id,ids).catch(()=>{}))
    return()=>cancelAnimationFrame(frame)
  },[ownerSecUid,latestBatch?.id,latestBatch?.state,latestBatch?.completedWorkIds.join(','),filtered,limit])
  const selectedCreator=selected?creatorBySec.get(selected.authorSecUid):undefined
  useEffect(()=>{
    let disposed=false;setDetail(null)
    if(ownerSecUid&&selected?.workId&&window.signalDesk.getVideoContentDetail)void window.signalDesk.getVideoContentDetail(ownerSecUid,selected.workId).then(v=>{if(!disposed&&v.ownerSecUid===ownerSecUid)setDetail(v)}).catch(()=>{})
    return()=>{disposed=true}
  },[ownerSecUid,selected?.workId,selected?.content?.stages.summary?.updatedAt,selected?.content?.stages.visual?.updatedAt,selected?.content?.stages.transcript?.updatedAt,selected?.content?.stages.classification?.updatedAt,selected?.content?.stages.body?.updatedAt,selected?.content?.stages.research?.updatedAt])
  const collectCreator=filterCreator??selectedCreator
  const options=useMemo(()=>[...realCreators].sort((a,b)=>Number(authorCounts.has(secUid(b)))-Number(authorCounts.has(secUid(a)))||a.nickname.localeCompare(b.nickname,'zh-CN')),[realCreators,authorCounts])
  const latest=records.reduce((value,row)=>row.checkedAt>value?row.checkedAt:value,'')
  useEffect(()=>{reading.current?.scrollTo?.({top:0});setCopied(false)},[selected?.workId])
  useEffect(()=>{
    if(!copied)return
    const timer=setTimeout(()=>setCopied(false),1800);return()=>clearTimeout(timer)
  },[copied])
  useEffect(()=>{
    if(state?.phase!=='completed'||!clicked.current||state.runId!==clicked.current||selected?.runId!==clicked.current)return
    const runId=clicked.current,epoch=generation.current
    const frame=requestAnimationFrame(()=>{clicked.current=null;void window.signalDesk.ackVideoInformationRendered(runId)
      .then(()=>{if(epoch===generation.current)void load()}).catch(()=>{})})
    return()=>cancelAnimationFrame(frame)
  },[state,selected,load])
  const collect=async(cancel=false)=>{
    if(!cancel&&!collectCreator)return
    const epoch=generation.current
    setSubmitting(true);setError('')
    try{
      const next=await(cancel?window.signalDesk.cancelVideoInformation():window.signalDesk.collectVideoInformation(collectCreator!.id))
      if(epoch!==generation.current)return
      if(!cancel){clicked.current=next.runId;setSearch('');setSelectedId(null);setSort('published');setAuthor(String(collectCreator!.id))}
      await load()
    }catch(reason){if(epoch===generation.current)setError(reason instanceof Error?reason.message:'采集未启动')}
    finally{if(epoch===generation.current)setSubmitting(false)}
  }
  const copy=async()=>{try{await navigator.clipboard.writeText(selected?.description??'');setCopied(true)}catch{setError('复制失败，可以直接选中下方文案复制')}}
  const action=async(task:()=>Promise<unknown>,onSuccess?:()=>void)=>{const epoch=generation.current;setSubmitting(true);setError('');try{await task();if(epoch===generation.current){await load();if(epoch===generation.current)onSuccess?.()}}catch(reason){if(epoch===generation.current)setError(reason instanceof Error?reason.message:'操作未完成')}finally{if(epoch===generation.current)setSubmitting(false)}}
  const discover=()=>{if(!ownerSecUid)return;const ids=chosenCreators.length?chosenCreators:filterCreator?[filterCreator.id]:[]
    if(!ids.length||!startDate||!endDate){setError('请先选择博主和起止发布日期');return}
    void action(()=>window.signalDesk.discoverVideoWorks({ownerSecUid,creatorIds:ids,startDate,endDate}))}
  const classifySelected=(all=false)=>{if(!ownerSecUid)return
    const ids=all?filtered.map(w=>w.workId):[...checked].filter(id=>records.some(w=>w.workId===id))
    if(!ids.length){setError('请先勾选要分类的作品');return}
    void action(()=>window.signalDesk.classifyVideoWorks({ownerSecUid,workIds:ids,clickedAt:Date.now()}))
  }
  const setInterest=(workId:string,interest:'unmarked'|'interested'|'not-interested')=>{if(!ownerSecUid)return
    void action(()=>window.signalDesk.setVideoInterest(ownerSecUid,workId,interest))}
  const ackFrame=(id:string)=>{
    if(!ownerSecUid)return
    const batch=view?.contentBatches?.find(b=>b.provider==='triage'&&b.completedWorkIds.includes(id)&&b.displayedTotalMs===undefined)
    if(batch)void window.signalDesk.ackVideoWorkflowRendered(ownerSecUid,batch.id,[id]).catch(()=>{})
  }
  const reset=()=>{setSearch('');setAuthor('all');setSelectedId(null);setStartDate('');setEndDate('');setInterestFilter('all')}
  return <section className="video-library" data-testid="video-information-page" aria-label="视频信息">
    <div className="video-library-overview">
      <div className="video-library-total"><span className="video-library-symbol"><Glyph/></span><div><span>已保存视频</span><strong>{count(records.length)}<small>条</small></strong></div></div>
      <div className="video-library-stat"><span>来自博主</span><strong>{authorCounts.size}<small>位</small></strong></div>
      <div className="video-library-stat last"><span>最近采集</span><strong>{latest?date(latest,true):'尚无记录'}</strong><small>当前账号 · 本地保存</small></div>
      <div className="video-library-collection"><button className="button primary" data-testid="collect-video-information" onClick={()=>void collect()}
        disabled={!view||!canCollect||running||submitting||!collectCreator?.nativeUid||creatorNeedsVerification(collectCreator)}><Glyph/>读取最近一条基础信息</button>
        <small>{collectCreator?<>采集对象：<CreatorName name={collectCreator.nickname} profileUrl={collectCreator.profileUrl}/></>:'先选择一位博主，再开始采集'}</small></div>
    </div>
    {state&&state.phase!=='idle'&&(capturing||!latestBatch)&&<div className={`video-library-status ${state.phase}`} role="status"><span><Glyph kind="check"/>{!capturing&&'最近一次 · '}{state.message}</span>
      {capturing?<button className="button ghost compact" onClick={()=>void collect(true)} disabled={submitting}>取消采集</button>
        :state.displayedTotalMs!==undefined?<small>上次开始至界面可用 {(state.displayedTotalMs/1000).toFixed(1)} 秒</small>:null}</div>}
    {error&&<div className="video-library-error" role="alert">{error}<button className="button ghost compact" onClick={()=>void load()}>重新读取本地记录</button></div>}
    <div className="video-library-toolbar">
      <label className="video-library-search"><Glyph kind="search"/><input aria-label="搜索视频" placeholder="搜索标题、发布文案或博主…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清空搜索" onClick={()=>setSearch('')}>×</button>}</label>
      <label className="video-library-select"><span>博主</span><select aria-label="筛选博主" value={author} onChange={e=>{setAuthor(e.target.value);setSelectedId(null)}}><option value="all">全部博主</option>{options.map(c=><option key={c.id} value={c.id}>{c.nickname}{authorCounts.has(secUid(c))?` · ${authorCounts.get(secUid(c))} 条`:''}</option>)}</select></label>
      <label className="video-library-select sort"><span>排序</span><select aria-label="视频排序" value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="published">最新发布</option><option value="collected">最新收录</option><option value="likes">点赞最多</option></select></label>
      <label className="video-library-date"><span>发布自</span><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label className="video-library-date"><span>至</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
      <label className="video-library-select"><span>判断</span><select aria-label="筛选兴趣判断" value={interestFilter} onChange={e=>setInterestFilter(e.target.value as typeof interestFilter)}><option value="all">全部</option><option value="unmarked">未标记</option><option value="interested">感兴趣</option><option value="not-interested">不感兴趣</option></select></label>
    </div>
    <div className="video-content-controls">
      <button onClick={()=>setChooser(v=>!v)} className="button ghost compact">{chosenCreators.length?`已选 ${chosenCreators.length} 位博主`:'选择多位博主'}</button>
      <button className="button ghost compact" disabled={running||submitting||!canCollect} onClick={discover}>查找日期范围内作品</button>
      <span>本地分类与截图 → 兴趣标记 → 手动开始处理 · 分类并发 8</span>
      <button className="button primary compact" disabled={running||submitting||!checked.size||!view?.runtime?.triageAvailable} onClick={()=>classifySelected()}>分类选中 {checked.size||''}</button>
      <button className="button ghost compact" disabled={running||submitting||!filtered.length||!view?.runtime?.triageAvailable} onClick={()=>classifySelected(true)}>分类筛选结果全部</button>
    </div>
    {chooser&&<div className="video-creator-chooser"><input aria-label="查找待采集博主" placeholder="搜索要查找作品的博主" value={creatorQuery} onChange={e=>setCreatorQuery(e.target.value)}/><button onClick={()=>setChosenCreators([])}>清空</button><div>{realCreators.filter(c=>c.nickname.includes(creatorQuery)).map(c=><label key={c.id}><input type="checkbox" checked={chosenCreators.includes(c.id)} onChange={e=>setChosenCreators(ids=>e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{c.nickname}</label>)}</div></div>}
    {view?.runtime&&!view.runtime.triageAvailable&&<div className="video-library-caption">本地分类环境未就绪，请配置语音区间与文字区域检测环境。</div>}
    {latestBatch&&<div className={`video-library-status ${latestBatch.state}`} role="status"><span>{latestBatch.message}{latestBatch.displayedTotalMs!==undefined&&<small> · 本轮开始至已完成内容可用 {(latestBatch.displayedTotalMs/1000).toFixed(1)} 秒</small>}</span>
      {activeBatch?<button className="button ghost compact" onClick={()=>void action(()=>activeBatch.kind==='discover'?window.signalDesk.cancelVideoDiscovery(ownerSecUid!):['triage','workflow'].includes(activeBatch.provider??'')?window.signalDesk.cancelVideoWorkflow(ownerSecUid!):window.signalDesk.cancelVideoTask(ownerSecUid!))}>取消任务</button>
        :latestBatch.state!=='completed'&&(!latestBatch.pendingSummaryWorkIds?.length||latestBatch.failedWorkIds.length>0)&&<button className="button ghost compact" onClick={()=>void action(()=>latestBatch.kind==='discover'?window.signalDesk.resumeVideoDiscovery(ownerSecUid!,latestBatch.id):['triage','workflow'].includes(latestBatch.provider??'')?window.signalDesk.resumeVideoWorkflow(ownerSecUid!,latestBatch.id):window.signalDesk.resumeVideoTask(ownerSecUid!,latestBatch.id))}>继续未完成部分</button>}</div>}
    {latestBatch?.stageElapsedMs&&<details className="video-stage-timing"><summary>查看阶段耗时</summary><span>媒体核验 {((latestBatch.stageElapsedMs.media??0)/1000).toFixed(2)} 秒 · 转写与保存 {((latestBatch.stageElapsedMs.body??0)/1000).toFixed(2)} 秒 · 研究报告与保存 {((latestBatch.stageElapsedMs.research??0)/1000).toFixed(2)} 秒</span></details>}
    <div className="video-library-split">
      <aside className="video-library-results" aria-label="已保存视频列表">
        <div className="video-library-list-heading"><h2>{filterCreator?filterCreator.nickname:'全部视频'}<span>{filtered.length}</span></h2><label className="video-select-all"><input type="checkbox" aria-label="选择筛选结果全部作品" checked={filtered.length>0&&filtered.every(w=>checked.has(w.workId))} onChange={e=>setChecked(e.target.checked?new Set(filtered.map(w=>w.workId)):new Set())}/>全选</label>{(author!=='all'||search||startDate||endDate||interestFilter!=='all')&&<button onClick={reset}>查看全部</button>}</div>
        <div className="video-library-list" data-testid="video-library-list">
          {!view?<p className="video-library-list-empty">正在读取本地视频…</p>:filtered.length===0?<div className="video-library-list-empty"><Glyph/><strong>{search?'没有匹配的视频':'还没有保存的视频'}</strong><p>{search?'试试其他关键词，或查看全部视频。':filterCreator?'可以采集这位博主最近一条已发现的视频。':'选择一位博主，开始保存视频信息。'}</p></div>:null}
          {filtered.slice(0,limit).map((work,index)=>{const creator=creatorBySec.get(work.authorSecUid);return <div className="video-selectable-row" key={work.workId}><input className="video-work-checkbox" type="checkbox" aria-label={`选择作品 ${work.title||work.workId}`} checked={checked.has(work.workId)} onChange={e=>setChecked(prior=>{const next=new Set(prior);if(e.target.checked)next.add(work.workId);else next.delete(work.workId);return next})}/><button className={`video-library-item ${selected?.workId===work.workId?'selected':''}`} aria-pressed={selected?.workId===work.workId}
            data-work-id={work.workId} onClick={()=>setSelectedId(work.workId)}><div className="video-library-item-top"><span className="video-library-index">{String(index+1).padStart(2,'0')}</span><span><CreatorName name={creator?.nickname||'已保存博主'} profileUrl={creator?.profileUrl}/></span><small>{duration(work.durationMs)}</small></div>
            <h3>{work.title||'未取得发布文案'}</h3><span className="video-category-label">{work.content?.classification?VIDEO_CLASS_LABELS[effectiveVideoClass(work.content.classification)]:work.content?.stages.classification?.state==='running'?'分类中…':'待分类'}</span>{preview(work.title,work.description)&&<p>{preview(work.title,work.description)}</p>}<div className="video-library-item-bottom"><time>{date(work.publishedAt)}</time><span className={`video-interest-mark ${work.content?.interest||'unmarked'}`}>{interestLabel(work.content?.interest)}</span><span>赞 {count(work.statistics.likeCount)}<Glyph kind="arrow"/></span></div></button>{work.content?.classification&&ownerSecUid&&<ClassificationFrames owner={ownerSecUid} id={work.workId} classification={work.content.classification} thumbnail onReady={()=>ackFrame(work.workId)}/>}</div>})}
          {filtered.length>limit&&<button className="video-library-more" onClick={()=>setLimit(value=>value+50)}>再显示 50 条</button>}
        </div>
        <div className="video-library-list-footer">按账号保存 · 重复采集更新同一作品</div>
      </aside>
      <article ref={reading} className="video-library-reading" aria-label="视频详情" data-testid="video-library-detail">
        {selected?<>
          <div className="video-library-author"><div><span className="video-library-author-mark">{(selectedCreator?.nickname||'博').slice(0,1)}</span><span><CreatorName name={selectedCreator?.nickname||'已保存博主'} profileUrl={selectedCreator?.profileUrl}/><small>抖音 · 已保存视频</small></span></div>
            {selectedCreator&&<button onClick={()=>onOpenCreator(selectedCreator)}>查看博主资料<Glyph kind="arrow"/></button>}</div>
          <h2 className="video-library-title">{selected.title||'未取得发布文案'}</h2>
          <div className="video-library-meta"><time>{date(selected.publishedAt,true)} 发布</time><span>时长 {duration(selected.durationMs)}</span><span>北京时间</span></div>
          <div className="video-basic-description"><h3>标题与发布描述</h3><p>{selected.description||'平台发布描述为空'}</p></div>
          {ownerSecUid&&<VideoClassificationPanel owner={ownerSecUid} id={selected.workId} classification={selected.content?.classification}
            state={selected.content?.stages.classification?.state} disabled={running||submitting}
            onReview={(code,note)=>action(()=>window.signalDesk.reviewVideoClassification(ownerSecUid,selected.workId,{code,note}))}/>}
          <div className="video-interest-actions" aria-label="视频兴趣标记"><span>你的判断：{interestLabel(selected.content?.interest)}</span><button className={selected.content?.interest==='interested'?'active':''} disabled={submitting} onClick={()=>void setInterest(selected.workId,'interested')}>感兴趣</button><button className={selected.content?.interest==='not-interested'?'active':''} disabled={submitting} onClick={()=>void setInterest(selected.workId,'not-interested')}>不感兴趣</button>{selected.content?.interest&&selected.content.interest!=='unmarked'&&<button disabled={submitting} onClick={()=>void setInterest(selected.workId,'unmarked')}>清除</button>}</div>
          {selected.content?.interest==='interested'&&<div className="video-workshop-entry" data-testid="manual-video-processing"><span>兴趣标记已保存；转写、画面文字识别与研究报告需手动开始。</span>
            <button className="button primary compact" data-testid="start-video-workflow" disabled={running||submitting||!['speech','visual_text'].includes(effectiveVideoClass(selected.content?.classification))}
              title={!selected.content?.classification?'请先完成本地分类':effectiveVideoClass(selected.content.classification)==='pending'?'请先人工审核分类':effectiveVideoClass(selected.content.classification)==='visual'?'纯画面主导作品请人工观看':'按当前视频类型取得文案并生成研究报告，复用已有成功结果'}
              onClick={()=>void action(()=>window.signalDesk.startVideoWorkflow({ownerSecUid:ownerSecUid!,workIds:[selected.workId]}))}>{selected.content.body?'继续处理':'开始处理'}</button></div>}
          {selected.content?.interest==='interested'&&onOpenWorkshop&&<div className="video-workshop-entry"><span>已保留为历史收藏资料；新的视频处理任务请在视频工坊粘贴地址。</span><button className="button ghost compact" disabled={submitting} onClick={()=>onOpenWorkshop(selected.workId)}>查看历史资料</button></div>}
          {selected.content?.interest==='interested'&&selected.content?.body&&<div className="video-content-overview"><h3>初步文案已保存</h3><p>在「今日收件箱」查看无时间戳的完整文案、正文研究报告并参与校对。</p><small>{selected.content.stages.research?.state==='completed'?'研究报告已完成':selected.content.stages.research?.state==='running'?'正在生成研究报告':selected.content.stages.research?.state==='failed'?'研究报告未完成，可手动继续处理':'研究报告待手动处理'}</small></div>}
          {detail&&<div className="video-stage-status">{detail.stages.filter(s=>['classification','body','research'].includes(s.stage)).map(s=><span key={s.stage}>{({classification:'本地分类',body:'文案正文',research:'研究报告'} as Record<string,string>)[s.stage]}：{({queued:'待处理',running:'处理中',completed:'已完成',partial:'部分完成',failed:'未完成',cancelled:'已取消',interrupted:'已中断'})[s.state]}{s.error&&<small>{s.error}</small>}</span>)}</div>}
          <dl className="video-library-metrics">{([['点赞',selected.statistics.likeCount],['评论数',selected.statistics.commentCount],['收藏',selected.statistics.collectCount],['分享',selected.statistics.shareCount]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}</dl>
          <div className="video-library-copy-heading"><h3>完整发布文案</h3><button onClick={()=>void copy()} disabled={!selected.description}>{copied?'已复制':'复制文案'}</button></div>
          <p className="video-library-description">{selected.description===null?'平台未提供发布文案':selected.description||'发布文案为空'}</p>
          <p className="video-library-caption">“感兴趣”保存标记并保留为历史资料；新的视频工坊任务从粘贴视频地址开始。此页的“开始处理”用于生成已收藏作品的文案与研究报告。</p>
          <div className="video-library-provenance"><span>首次收录<time>{date(selected.firstCollectedAt,true)}</time></span><span>数据更新<time>{date(selected.checkedAt,true)}</time></span><span>作品 ID<code>{selected.workId}</code></span></div>
          <div className="video-library-reading-footer"><span><i/>已保存到当前账号</span><button className="button ghost" onClick={()=>void window.signalDesk.openExternal(`https://www.douyin.com/video/${selected.workId}`)}>打开原视频<Glyph kind="arrow"/></button></div>
        </>:<div className="video-library-empty-detail"><Glyph/><h2>{filterCreator?`${filterCreator.nickname} 的视频信息`:'让视频资料有一个固定的位置'}</h2><p>{filtered.length?'从左侧选择一条视频查看详情。':'采集后的发布文案和互动数据会保存在这里，随时可以回来查看。'}</p>{filterCreator&&<button className="button ghost" onClick={()=>onOpenCreator(filterCreator)}>查看博主资料</button>}</div>}
      </article>
    </div>
  </section>
}
