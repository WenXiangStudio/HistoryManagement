import {useCallback,useEffect,useMemo,useRef,useState,type JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import type {SavedVideoInformation} from '../../shared/videoInformation'
import type {VideoClassification} from '../../shared/videoWorkflow'
import CreatorName from './CreatorName'
import {ClassificationFrames} from './VideoClassificationPanel'
import './videoInformation.css'

type WorkshopWork=Omit<SavedVideoInformation,'content'>&{screenshots?:Pick<VideoClassification,'sourceSha256'|'frames'>}
type Props={ownerSecUid:string|null;creators:CreatorListItem[];focus:{workId:string;revision:number}|null;onOpenVideos:()=>void}
const date=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))
const duration=(ms:number|null)=>ms===null?'时长未取得':`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`
const count=(value:number|null)=>value===null?'未取得':new Intl.NumberFormat('zh-CN').format(value)

export default function SavedWorkshopHistory({ownerSecUid,creators,focus,onOpenVideos}:Props):JSX.Element {
  const [works,setWorks]=useState<WorkshopWork[]>([]),[savedOwner,setSavedOwner]=useState<string|null>(null)
  const [search,setSearch]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const generation=useRef(0),sequence=useRef(0),reading=useRef<HTMLElement>(null)
  const load=useCallback(async()=>{
    const epoch=generation.current,request=++sequence.current
    try{
      if(!ownerSecUid){setWorks([]);setSavedOwner(null);setLoading(false);return}
      const next=await window.signalDesk.getVideoLibrary({interest:'interested'})
      if(epoch!==generation.current||request!==sequence.current)return
      if(next.ownerSecUid!==ownerSecUid){setWorks([]);setSavedOwner(null);setLoading(false);setError('资料账号已变化，请重新打开历史资料');return}
      // The workshop receives base information and screenshot references only.
      // Classification, processing stages and review results stay in their original pages.
      const selected=next.records.filter(work=>work.content?.interest==='interested').map(work=>{
        const {content,...basic}=work,classification=content?.classification
        return {...basic,screenshots:classification?.frames.length?{sourceSha256:classification.sourceSha256,frames:classification.frames}:undefined}
      })
      setWorks(selected);setSavedOwner(next.ownerSecUid);setLoading(false);setError('')
    }catch(reason){if(epoch===generation.current&&request===sequence.current){setLoading(false);setError(reason instanceof Error?reason.message:'无法读取历史资料')}}
  },[ownerSecUid])
  useEffect(()=>{
    ++generation.current;setWorks([]);setSavedOwner(null);setSelectedId(null);setSearch('');setLoading(true);setError('')
    void load()
    const unsubscribe=window.signalDesk.onDataChanged?.(()=>void load()),timer=setInterval(()=>void load(),2000)
    return()=>{++generation.current;++sequence.current;unsubscribe?.();clearInterval(timer)}
  },[load])
  useEffect(()=>{if(focus){setSearch('');setSelectedId(focus.workId)}},[focus?.workId,focus?.revision])
  const creatorBySec=useMemo(()=>new Map(creators.filter(creator=>!creator.isDemo).map(creator=>[new URL(creator.profileUrl).pathname.split('/').at(-1),creator])),[creators])
  const owned=savedOwner===ownerSecUid?works:[]
  const filtered=useMemo(()=>{
    const query=search.normalize('NFKC').trim().toLocaleLowerCase()
    return owned.filter(work=>!query||[work.title,work.description,work.workId,creatorBySec.get(work.authorSecUid)?.nickname].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query))
      .sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||b.workId.localeCompare(a.workId))
  },[owned,search,creatorBySec])
  const selected=filtered.find(work=>work.workId===selectedId)??filtered[0],author=selected?creatorBySec.get(selected.authorSecUid):undefined
  useEffect(()=>{reading.current?.scrollTo?.({top:0})},[selected?.workId])
  return <section className="video-library information-workshop saved-workshop-history" data-testid="saved-workshop-history" aria-label="历史资料">
    <div className="video-library-overview">
      <div className="video-library-total"><div><span>已收录作品</span><strong data-testid="workshop-total">{owned.length}<small>条</small></strong></div></div>
      <div className="video-library-stat"><span>来自博主</span><strong>{new Set(owned.map(work=>work.authorSecUid)).size}<small>位</small></strong></div>
      <p className="workshop-introduction">原信息工坊保存的感兴趣作品与截图可在此查阅。</p>
      <button className="button ghost" onClick={onOpenVideos}>前往视频信息</button>
    </div>
    <div className="video-library-toolbar"><label className="video-library-search"><input aria-label="搜索工坊作品" placeholder="搜索作品、发布描述或博主…" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="清空工坊搜索" onClick={()=>setSearch('')}>×</button>}</label><span className="result-count">{filtered.length} 条作品</span></div>
    {error&&<div className="video-library-error" role="alert">{error}<button className="button ghost compact" onClick={()=>void load()}>重新读取</button></div>}
    <div className="video-library-split">
      <aside className="video-library-results" aria-label="工坊作品列表">
        <div className="video-library-list-heading"><h2>感兴趣的作品<span>{filtered.length}</span></h2></div>
        <div className="video-library-list">
          {loading?<p className="video-library-list-empty">正在读取作品…</p>:!filtered.length&&<div className="video-library-list-empty"><strong>{search?'没有匹配的作品':'暂无感兴趣的作品'}</strong><p>{search?'试试其他关键词。':'在视频信息页点击“感兴趣”，作品就会出现在这里。'}</p></div>}
          {filtered.map((work,index)=>{const creator=creatorBySec.get(work.authorSecUid);return <button className={`video-library-item ${selected?.workId===work.workId?'selected':''}`} data-workshop-work-id={work.workId} key={work.workId} aria-pressed={selected?.workId===work.workId} onClick={()=>setSelectedId(work.workId)}>
            <div className="video-library-item-top"><span className="video-library-index">{String(index+1).padStart(2,'0')}</span><span><CreatorName name={creator?.nickname??'已保存博主'} profileUrl={creator?.profileUrl}/></span><small>{duration(work.durationMs)}</small></div>
            <h3>{work.title||'发布描述为空'}</h3><p>{work.description}</p><div className="video-library-item-bottom"><time>{date(work.publishedAt)}</time><span>赞 {count(work.statistics.likeCount)}</span></div>
          </button>})}
        </div>
        <div className="video-library-list-footer">当前账号 · 感兴趣的作品</div>
      </aside>
      <article ref={reading} className="video-library-reading" data-testid="workshop-detail" data-work-id={selected?.workId} aria-label="工坊作品详情">
        {selected?<>
          <div className="video-library-author"><div><span className="video-library-author-mark">{(author?.nickname??'博').slice(0,1)}</span><span><CreatorName name={author?.nickname??'已保存博主'} profileUrl={author?.profileUrl}/><small>抖音 · 感兴趣的作品</small></span></div></div>
          <h2 className="video-library-title">{selected.title||'发布描述为空'}</h2>
          <div className="video-library-meta"><time>{date(selected.publishedAt)} 发布</time><span>时长 {duration(selected.durationMs)}</span><span>北京时间</span></div>
          <div className="video-library-copy-heading workshop-description-heading"><h3>完整发布描述</h3></div><p className="video-library-description">{selected.description??'平台未提供发布描述'}</p>
          <section className="workshop-screenshots" aria-label="作品截图"><div className="video-library-copy-heading"><h3>作品截图</h3></div>{ownerSecUid&&selected.screenshots?<ClassificationFrames owner={ownerSecUid} id={selected.workId} classification={selected.screenshots}/>:<p className="workshop-no-screenshots">暂无已保存截图</p>}</section>
          <dl className="video-library-metrics">{([['点赞',selected.statistics.likeCount],['评论数',selected.statistics.commentCount],['收藏',selected.statistics.collectCount],['分享',selected.statistics.shareCount]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}</dl>
          <div className="video-library-provenance"><span>作品 ID<code>{selected.workId}</code></span></div>
          <div className="video-library-reading-footer"><button className="button ghost" onClick={onOpenVideos}>返回视频信息</button><button className="button ghost" onClick={()=>void window.signalDesk.openExternal(`https://www.douyin.com/video/${selected.workId}`)}>打开原视频</button></div>
        </>:<div className="video-library-empty-detail"><h2>{search?'没有匹配的作品':'从感兴趣的作品开始'}</h2><p>在视频信息页选择作品，收录到你的信息工坊。</p><button className="button ghost" onClick={onOpenVideos}>前往视频信息</button></div>}
      </article>
    </div>
  </section>
}
