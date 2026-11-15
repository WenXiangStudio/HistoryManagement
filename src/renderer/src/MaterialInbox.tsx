import {useCallback,useEffect,useMemo,useState,type JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import type {VideoLibraryView, SavedVideoInformation} from '../../shared/videoInformation'
import {VIDEO_CLASS_LABELS,effectiveVideoClass,type MaterialInboxState} from '../../shared/videoWorkflow'
import MaterialResearchView from './MaterialResearchView'
import CreatorName from './CreatorName'
import {ClassificationFrames} from './VideoClassificationPanel'

export default function MaterialInbox({owner,creators,search,filter,onCount,onAvailable,onOpenVideos}:{owner:string|null;creators:CreatorListItem[];
  search:string;filter:string;onCount:(count:number)=>void;onAvailable?:(count:number)=>void;onOpenVideos:()=>void}):JSX.Element {
  const [library,setLibrary]=useState<VideoLibraryView|null>(null),[selectedId,setSelectedId]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=useCallback(async()=>{
    const next=await window.signalDesk.getVideoLibrary()
    if(next.ownerSecUid!==owner)return
    setLibrary(next)
  },[owner])
  useEffect(()=>{let disposed=false;setLibrary(null);setSelectedId(null)
    const refresh=()=>{if(!disposed)void load().catch(()=>{if(!disposed)setError('读取素材收件箱失败')})}
    refresh();const unsubscribe=window.signalDesk.onDataChanged(refresh),timer=setInterval(refresh,2000)
    return()=>{disposed=true;unsubscribe();clearInterval(timer)}
  },[load])
  const available=useMemo(()=>library?.records.filter(w=>w.content?.interest==='interested'&&w.content.body&&
    ['speech','visual_text'].includes(effectiveVideoClass(w.content.classification))&&w.content.body.sourceSha256===w.content.classification?.sourceSha256&&
    w.content.body.source===(effectiveVideoClass(w.content.classification)==='speech'?'doubao-flash':'qwen-vision'))??[],[library])
  useEffect(()=>onCount(available.filter(w=>(w.content?.inboxState??'unread')==='unread').length),[available,onCount])
  useEffect(()=>onAvailable?.(available.length),[available,onAvailable])
  const author=(work:SavedVideoInformation)=>creators.find(c=>!c.isDemo&&c.profileUrl.endsWith('/'+work.authorSecUid))
  const filtered=available.filter(w=> (filter==='all'||(w.content?.inboxState??'unread')===filter)&&
    (!search||[w.title,w.description,author(w)?.nickname,w.content?.body?.text,w.content?.research?.overview,...(w.content?.research?.domains.map(d=>d.name)??[])].join(' ').normalize('NFKC').toLowerCase().includes(search.normalize('NFKC').toLowerCase())))
  const selected=available.find(w=>w.workId===selectedId)
  const action=async(task:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await task();await load()}catch(e){setError(e instanceof Error?e.message:'操作未完成');throw e}finally{setBusy(false)}}
  const setState=(id:string,state:MaterialInboxState)=>{if(owner)void action(()=>window.signalDesk.setMaterialInboxState(owner,id,state)).catch(()=>{})}
  const open=(id:string)=>{setSelectedId(id);if(owner)setState(id,'read')}
  useEffect(()=>{
    if(!selected||!owner)return
    const batch=library?.contentBatches?.find(b=>b.provider==='workflow'&&b.completedWorkIds.includes(selected.workId)&&b.displayedTotalMs===undefined)
    if(!batch)return
    const frame=requestAnimationFrame(()=>void window.signalDesk.ackVideoWorkflowRendered(owner,batch.id,[selected.workId]).catch(()=>{}))
    return()=>cancelAnimationFrame(frame)
  },[selected?.workId,selected?.content?.stages.research?.updatedAt,library?.contentBatches,owner])
  useEffect(()=>{if(!selected)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelectedId(null)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[selected?.workId])
  return <section className="material-inbox" aria-label="感兴趣素材收件箱">
    {error&&<p className="video-library-error" role="alert">{error}</p>}
    <div className="material-inbox-heading"><div><h2>感兴趣的素材 <span>{available.length}</span></h2><p>已完成初步转写的口播与图文素材，打开查看完整正文与研究报告。</p></div><button className="button ghost compact" onClick={onOpenVideos}>前往视频信息</button></div>
    <div className="inbox-grid">{filtered.map(w=>{const creator=author(w),report=w.content?.research;return <article className="work-card material-inbox-card" key={w.workId}>
      {owner&&w.content?.classification&&<ClassificationFrames owner={owner} id={w.workId} classification={w.content.classification} thumbnail/>}
      <div className="work-body"><small><CreatorName name={creator?.nickname??'已保存博主'} profileUrl={creator?.profileUrl}/> · {new Date(w.publishedAt).toLocaleDateString('zh-CN')}</small>
        <h3><button onClick={()=>open(w.workId)}>{w.title||'发布描述为空'}</button></h3><span className="video-category-label">{VIDEO_CLASS_LABELS[effectiveVideoClass(w.content?.classification)]}</span>
        <p className="work-summary">{report?.overview??w.content?.body?.text}</p><div className="tag-row">{report?.domains.map(d=><span key={d.name}>{d.name} · 推测</span>)}{!report&&<span className="pending-tag">{w.content?.stages.research?.state==='failed'?'研究报告未完成':w.content?.stages.research?.state==='running'?'研究报告处理中':'研究报告待手动处理'}</span>}{w.content?.body?.needsReview&&<span className="pending-tag">文案待人工校对</span>}</div></div>
      <div className="card-actions"><button disabled={busy} onClick={()=>setState(w.workId,'later')}>稍后看</button><button disabled={busy} onClick={()=>setState(w.workId,'saved')}>收藏</button><button className="detail-button" onClick={()=>open(w.workId)}>查看正文与报告 →</button></div>
    </article>})}</div>
    {available.length>0&&!filtered.length&&<p className="material-empty">当前筛选条件下没有素材。</p>}
    {selected&&owner&&selected.content?.body&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedId(null)}}><aside className="work-drawer material-drawer" role="dialog" aria-modal="true" aria-label="视频正文与研究报告">
      <div className="drawer-head"><div><p className="eyebrow">VIDEO MATERIAL</p><h2>{selected.title||'发布描述为空'}</h2><span><CreatorName name={author(selected)?.nickname??'已保存博主'} profileUrl={author(selected)?.profileUrl}/> · {new Date(selected.publishedAt).toLocaleString('zh-CN')} · 时长 {Math.floor((selected.durationMs??0)/60000)}:{String(Math.floor((selected.durationMs??0)/1000)%60).padStart(2,'0')}</span></div><button aria-label="关闭视频详情" autoFocus onClick={()=>setSelectedId(null)}>×</button></div>
      <div className="drawer-scroll"><p className="material-published-description">发布描述：{selected.description||'为空'}</p><MaterialResearchView body={selected.content.body} report={selected.content.research} reportState={selected.content.stages.research?.state}
        error={selected.content.stages.research?.error} disabled={busy||library?.contentBatches?.some(b=>['queued','running'].includes(b.state))}
        onRevise={text=>action(()=>window.signalDesk.reviseVideoBody(owner,selected.workId,text))}/></div>
      <div className="drawer-footer"><button className="button ghost" onClick={()=>setSelectedId(null)}>关闭</button>{selected.content.stages.research?.state==='failed'&&<button className="button ghost" disabled={busy} onClick={()=>void action(()=>window.signalDesk.startVideoWorkflow({ownerSecUid:owner,workIds:[selected.workId]})).catch(()=>{})}>继续生成研究报告</button>}<button className="button primary" onClick={()=>void window.signalDesk.openExternal('https://www.douyin.com/video/'+selected.workId)}>打开原视频</button></div>
    </aside></div>}
  </section>
}
