import {useCallback,useEffect,useMemo,useRef,useState,type JSX,type KeyboardEvent} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import {parseDouyinWorkshopLink,type WorkshopJob,type WorkshopView} from '../../shared/videoWorkshop'
import type {WorkshopDeepResult} from '../../shared/workshopDeep'
import {VIDEO_CLASS_LABELS,effectiveVideoClass} from '../../shared/videoWorkflow'
import SavedWorkshopHistory from './SavedWorkshopHistory'
import {Icon} from './ui'
import './videoWorkshop.css'

type Props={ownerSecUid:string|null;creators:CreatorListItem[];focus:{workId:string;revision:number}|null;onOpenVideos:()=>void}
type WorkshopTab='new'|'history'
const activePhases=new Set<WorkshopJob['phase']>(['resolving','downloading','classifying'])
const deepActivePhases=new Set(['preparing','transcribing','recognizing','reporting'])
const deepRunning=(job:WorkshopJob)=>Boolean(job.deep&&deepActivePhases.has(job.deep.phase))
const isRunning=(job:WorkshopJob)=>activePhases.has(job.phase)||deepRunning(job)
const deepPhaseLabels:Record<string,string>={preparing:'正在准备深度处理',transcribing:'正在语音转写',recognizing:'正在识别视频画面',reporting:'正在生成图文报告',completed:'深度处理完成',failed:'深度处理失败',cancelled:'深度处理已取消'}
const phaseLabels:Record<WorkshopJob['phase'],string>={resolving:'正在解析抖音链接',downloading:'正在下载视频',classifying:'正在本地分类',completed:'下载与分类完成',failed:'处理失败',cancelled:'已取消'}
const stageLabels:Record<string,string>={resolve:'链接解析',resolving:'链接解析',download:'视频下载',downloading:'视频下载',probe:'视频校验',verify:'视频校验',classify:'本地分类',classification:'本地分类',classifying:'本地分类',save:'保存结果'}
const seconds=(value:number)=>`${(value/1000).toFixed(1)} 秒`
const videoDuration=(value:number)=>`${Math.floor(value/60000)}:${String(Math.floor(value/1000)%60).padStart(2,'0')}`
const videoTime=(value:number)=>`${String(Math.floor(value/60000)).padStart(2,'0')}:${String(Math.floor(value/1000)%60).padStart(2,'0')}.${String(Math.floor(value)%1000).padStart(3,'0')}`
const interval=(start:number,end:number)=>`${videoTime(start)} – ${videoTime(end)}`
const date=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))
const emptyView:WorkshopView={jobs:[],running:false,downloadRoot:'E:\\VideoDownload'}

function WorkshopResult({job,disabled,onRetry,onCancel}:{job:WorkshopJob;disabled:boolean;onRetry:(job:WorkshopJob)=>void;onCancel:(job:WorkshopJob)=>void}):JSX.Element {
  const running=activePhases.has(job.phase),classification=job.classification
  return <article className={`video-workshop-result ${job.phase}`} data-testid="workshop-processing-result" data-job-id={job.id} aria-label="视频处理结果">
    <div className="video-workshop-result-heading"><div><span className={`video-workshop-job-status ${job.phase}`} role="status">{phaseLabels[job.phase]}</span><h3>{job.title||'抖音视频'}</h3></div>
      {running?<button type="button" className="button ghost compact" disabled={disabled} onClick={()=>onCancel(job)}>取消处理</button>:(job.phase==='failed'||job.phase==='cancelled')&&<button type="button" className="button ghost compact" disabled={disabled} onClick={()=>onRetry(job)}>重新处理</button>}</div>
    <p className="video-workshop-job-message" role={job.phase==='failed'?'alert':undefined}>{job.message}</p>
    <div className="video-workshop-job-meta">{job.authorName&&<span>{job.authorName}</span>}{job.durationMs!==undefined&&<span>时长 {videoDuration(job.durationMs)}</span>}{job.workId&&<span>作品 ID <code>{job.workId}</code></span>}<time>{date(job.createdAt)} · 北京时间</time></div>
    <p className="video-workshop-submitted-url"><span>本次提交</span><code>{job.url}</code></p>
    {job.mediaPath&&<p className="video-workshop-saved-path"><span>视频文件</span><code>{job.mediaPath}</code>{job.byteLength!==undefined&&<small>{(job.byteLength/1024/1024).toFixed(1)} MB</small>}</p>}
    {classification&&<div className="video-workshop-local-classification" aria-label="本地分类结果"><strong>{VIDEO_CLASS_LABELS[effectiveVideoClass(classification)]}</strong><p>检测语音 {classification.basis.speechPercent.toFixed(1)}% · 文字区域 {classification.basis.retainedTextFrames}/{classification.basis.sampledFrames} 帧</p><span>{classification.strength}</span><small>本地检测声音与文字区域，未调用云端语音转写或画面识别。</small></div>}
    {(job.elapsedMs!==undefined||Object.keys(job.stageElapsedMs).length>0)&&<dl className="video-workshop-timings">{job.elapsedMs!==undefined&&<div><dt>{job.phase==='completed'?'点击到下载与分类完成':'点击到处理停止'}</dt><dd>{seconds(job.elapsedMs)}</dd></div>}{Object.entries(job.stageElapsedMs).map(([stage,value])=><div key={stage}><dt>{stageLabels[stage]??stage}</dt><dd>{seconds(value)}</dd></div>)}</dl>}
  </article>
}

function WorkshopDeepReport({job,result,onDisplayed}:{job:WorkshopJob;result:WorkshopDeepResult;onDisplayed:(jobId:string,clickedAt:number)=>void}):JSX.Element {
  const reportKey=`${job.id}:${result.generatedAt}`
  const [images,setImages]=useState<{key:string;items:Record<string,{url?:string;error?:string;loaded?:boolean}>}>({key:reportKey,items:{}})
  const notified=useRef(false)
  const loadedIds=useRef<Set<string>>(new Set())
  const sections=useMemo(()=>[...result.report.sections].sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs),[result])
  const frames=useMemo(()=>{const referenced=new Set(sections.flatMap(section=>section.frameIds));return result.frames.filter(frame=>referenced.has(frame.id))},[sections,result])
  useEffect(()=>{
    let current=true
    loadedIds.current.clear();notified.current=false
    setImages({key:reportKey,items:{}})
    for(const frame of frames){
      void (async()=>{
        try{
          if(typeof window.signalDesk.getWorkshopFrame!=='function')throw Error('截图读取服务未就绪')
          const image=await window.signalDesk.getWorkshopFrame({jobId:job.id,frameId:frame.id})
          if(image.id!==frame.id||image.timeMs!==frame.timeMs||!image.dataUrl.startsWith('data:image/'))throw Error('截图与报告时间不一致')
          if(current)setImages(value=>({key:reportKey,items:{...value.items,[frame.id]:{url:image.dataUrl}}}))
        }catch(reason){if(current)setImages(value=>({key:reportKey,items:{...value.items,[frame.id]:{error:reason instanceof Error?reason.message:'截图暂时无法读取'}}}))}
      })()
    }
    return()=>{current=false}
  },[job.id,reportKey,frames])
  const markFrameLoaded=useCallback((frameId:string)=>{
    loadedIds.current.add(frameId)
    setImages(value=>({key:reportKey,items:{...value.items,[frameId]:{...value.items[frameId],loaded:true}}}))
    if(notified.current||loadedIds.current.size!==frames.length||job.deep?.phase!=='completed')return
    const first=requestAnimationFrame(()=>{requestAnimationFrame(()=>{if(!notified.current){notified.current=true;onDisplayed(job.id,job.deep!.clickedAt)}})})
    return()=>cancelAnimationFrame(first)
  },[frames,job.deep?.phase,job.deep?.clickedAt,job.id,onDisplayed,reportKey])
  const imageItems=images.key===reportKey?images.items:{}
  useEffect(()=>{
    if(notified.current||job.deep?.phase!=='completed'||!frames.every(frame=>images.key===reportKey&&images.items[frame.id]?.loaded))return
    let second:number|undefined
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{notified.current=true;onDisplayed(job.id,job.deep!.clickedAt)})})
    return()=>{cancelAnimationFrame(first);if(second!==undefined)cancelAnimationFrame(second)}
  },[images,reportKey,frames,job.id,job.deep?.phase,job.deep?.clickedAt,onDisplayed])
  return <div className="video-workshop-report-content" data-testid="workshop-deep-report" data-job-id={job.id}>
    <div className="video-workshop-report-source"><strong>{job.title||'抖音视频'}</strong><code>{job.url}</code><span>生成于 {date(result.generatedAt)} · 北京时间</span></div>
    <p className="video-workshop-report-overview">{result.report.overview}</p>
    {result.speech.segments.length===0&&<p className="video-workshop-speech-empty">{result.speech.state==='no-audio'?'原视频无音轨，报告依据画面与画面文字生成。':'未识别到带时间戳的语音，报告依据画面与画面文字生成。'}</p>}
    <ol className="video-workshop-timeline" aria-label="按视频时间对齐的图文报告">{sections.map(section=>{
      const speech=result.speech.segments.filter(segment=>section.speechIds.includes(segment.id)&&segment.startMs<section.endMs&&segment.endMs>section.startMs)
      const sectionFrames=frames.filter(frame=>section.frameIds.includes(frame.id)).sort((a,b)=>a.timeMs-b.timeMs)
      return <li key={section.id} className="video-workshop-timeline-section" data-start-ms={section.startMs} data-end-ms={section.endMs}>
        <header><time>{interval(section.startMs,section.endMs)}</time><h3>{section.title}</h3></header>
        {section.summary&&<p className="video-workshop-section-summary">{section.summary}</p>}
        <div className="video-workshop-timed-frames">{sectionFrames.map(frame=>{
          const reading=result.readings.find(item=>item.frameId===frame.id),image=imageItems[frame.id]
          return <figure className="video-workshop-timed-frame" key={frame.id} data-frame-id={frame.id}>
            {image?.url?<a href={image.url} target="_blank" rel="noreferrer" aria-label={`查看 ${videoTime(frame.timeMs)} 原视频画面`}><img src={image.url} alt={`${videoTime(frame.timeMs)} 原视频画面`} onLoad={()=>markFrameLoaded(frame.id)} onLoadCapture={()=>markFrameLoaded(frame.id)} onErrorCapture={()=>setImages(value=>({key:reportKey,items:{...value.items,[frame.id]:{error:'原视频截图显示失败'}}}))}/></a>:<div className="video-workshop-frame-placeholder" role="status">{image?.error?`截图暂不可用：${image.error}`:'正在读取原视频截图…'}</div>}
            <figcaption><time>画面 {videoTime(frame.timeMs)}</time>{reading?.description&&<p>{reading.description}</p>}{reading?.text&&<p><strong>画面文字</strong>{reading.text}</p>}{reading?.uncertainties&&reading.uncertainties.length>0&&<p className="video-workshop-evidence-uncertain">识别存疑：{reading.uncertainties.join('；')}</p>}</figcaption>
          </figure>
        })}</div>
        <div className="video-workshop-timed-speech"><h4>对应语音</h4>{speech.length>0?speech.map(segment=><p key={segment.id}><time>{interval(segment.startMs,segment.endMs)}</time><span>{segment.text}</span></p>):<p className="video-workshop-no-speech">本时段没有可对齐的语音转写。</p>}</div>
        <div className="video-workshop-section-analysis"><h4>分析与总结</h4><p>{section.analysis}</p></div>
      </li>
    })}</ol>
    {frames.some(frame=>imageItems[frame.id]?.error)&&<p className="video-workshop-speech-empty" role="status">部分截图暂不可用，尚未记录图文全部可用的全程耗时。</p>}
    {result.report.limitations.length>0&&<div className="video-workshop-report-limitations"><h4>报告依据与局限</h4><ul>{result.report.limitations.map((limitation,index)=><li key={index}>{limitation}</li>)}</ul></div>}
  </div>
}

export default function InformationWorkshopPage({ownerSecUid,creators,focus,onOpenVideos}:Props):JSX.Element {
  const [tab,setTab]=useState<WorkshopTab>(()=>focus?'history':'new')
  const [input,setInput]=useState('')
  const [view,setView]=useState<WorkshopView>(emptyView),[selectedJobId,setSelectedJobId]=useState<string|null>(null)
  const [loading,setLoading]=useState(true),[readError,setReadError]=useState(''),[actionError,setActionError]=useState(''),[deepError,setDeepError]=useState<{jobId:string;message:string}|null>(null),[action,setAction]=useState<'start'|'deep'|'cancel'|null>(null)
  const alive=useRef(false),readSequence=useRef(0),pendingAction=useRef(false),liveDeepRuns=useRef(new Map<string,number>())
  const link=useMemo(()=>parseDouyinWorkshopLink(input),[input])
  const inputRef=useRef<HTMLTextAreaElement>(null),newTab=useRef<HTMLButtonElement>(null),historyTab=useRef<HTMLButtonElement>(null)
  const load=useCallback(async()=>{
    if(pendingAction.current)return
    const request=++readSequence.current
    if(typeof window.signalDesk.getVideoWorkshop!=='function'){setLoading(false);return}
    try{const next=await window.signalDesk.getVideoWorkshop();if(alive.current&&request===readSequence.current){setView(next);setReadError('');setLoading(false)}}
    catch(reason){if(alive.current&&request===readSequence.current){setLoading(false);setReadError(reason instanceof Error?reason.message:'无法读取视频处理记录')}}
  },[])
  useEffect(()=>{alive.current=true;void load();const unsubscribe=window.signalDesk.onDataChanged?.(()=>void load());return()=>{alive.current=false;++readSequence.current;unsubscribe?.()}},[load])
  useEffect(()=>{if(!view.running)return;const timer=setInterval(()=>void load(),1000);return()=>clearInterval(timer)},[load,view.running])
  const jobs=useMemo(()=>[...new Map(view.jobs.map(job=>[job.id,job])).values()],[view.jobs])
  const activeJob=jobs.find(isRunning),selectedJob=jobs.find(job=>job.id===selectedJobId)??activeJob??jobs[0]
  const processing=view.running||Boolean(activeJob)||action!==null
  const start=async(url:string)=>{
    if(pendingAction.current||view.running||activeJob)return
    pendingAction.current=true;++readSequence.current;setAction('start');setActionError('')
    try{
      if(typeof window.signalDesk.processWorkshopVideo!=='function')throw Error('视频处理服务未就绪，请重启 APP 后重试。')
      const next=await window.signalDesk.processWorkshopVideo({url,clickedAt:Date.now()})
      if(alive.current){setView(next);setReadError('');setSelectedJobId(next.jobs.find(job=>activePhases.has(job.phase))?.id??next.jobs[0]?.id??null)}
    }catch(reason){if(alive.current)setActionError(reason instanceof Error?reason.message:'无法开始视频处理')}
    finally{pendingAction.current=false;if(alive.current)setAction(null)}
  }
  const cancel=async(job:WorkshopJob)=>{
    if(pendingAction.current)return
    pendingAction.current=true;++readSequence.current;setAction('cancel');setActionError('')
    try{const next=await window.signalDesk.cancelWorkshopVideo(job.id);if(alive.current){setView(next);setReadError('')}}
    catch(reason){if(alive.current)setActionError(reason instanceof Error?reason.message:'无法取消视频处理')}
    finally{pendingAction.current=false;if(alive.current)setAction(null)}
  }
  const startDeep=async(job:WorkshopJob)=>{
    if(pendingAction.current||view.running||activeJob||job.phase!=='completed'||!job.classification||!job.mediaPath)return
    pendingAction.current=true;++readSequence.current;setAction('deep');setDeepError(null)
    const clickedAt=Date.now()
    liveDeepRuns.current.set(job.id,clickedAt)
    try{
      if(typeof window.signalDesk.deepProcessWorkshopVideo!=='function')throw Error('深度处理服务未就绪，请重启 APP 后重试。')
      const next=await window.signalDesk.deepProcessWorkshopVideo({jobId:job.id,clickedAt})
      if(alive.current){setView(next);setReadError('');setSelectedJobId(job.id)}
    }catch(reason){liveDeepRuns.current.delete(job.id);if(alive.current)setDeepError({jobId:job.id,message:reason instanceof Error?reason.message:'无法开始深度处理'})}
    finally{pendingAction.current=false;if(alive.current)setAction(null)}
  }
  const reportDisplayed=useCallback((jobId:string,clickedAt:number)=>{
    if(liveDeepRuns.current.get(jobId)!==clickedAt||typeof window.signalDesk.ackWorkshopDeepDisplayed!=='function')return
    liveDeepRuns.current.delete(jobId)
    void window.signalDesk.ackWorkshopDeepDisplayed({jobId,displayedAt:Date.now()}).then(next=>{
      if(!alive.current)return
      const saved=next.jobs.find(job=>job.id===jobId)
      if(saved?.deep?.clickedAt!==clickedAt||saved.deep.displayedTotalMs===undefined)return
      setView(current=>({...current,jobs:current.jobs.map(job=>job.id===jobId&&job.deep?.clickedAt===clickedAt?{...job,deep:{...job.deep,displayedTotalMs:saved.deep!.displayedTotalMs}}:job)}))
    }).catch(()=>{})
  },[])
  useEffect(()=>{setTab(focus?'history':'new')},[focus?.workId,focus?.revision])
  const moveTab=(event:KeyboardEvent<HTMLButtonElement>)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
    event.preventDefault()
    const next=event.key==='Home'?'new':event.key==='End'?'history':tab==='new'?'history':'new'
    setTab(next);(next==='new'?newTab:historyTab).current?.focus()
  }
  return <section className="video-workshop" data-testid="information-workshop-page" aria-label="视频工坊">
    <div className="video-workshop-view-bar">
      <div className="video-workshop-tabs" role="tablist" aria-label="视频工坊视图">
        <button ref={newTab} id="workshop-new-tab" type="button" role="tab" aria-selected={tab==='new'} aria-controls="workshop-new-panel" tabIndex={tab==='new'?0:-1} onKeyDown={moveTab} onClick={()=>setTab('new')}><Icon name="video" size={15}/>新建处理</button>
        <button ref={historyTab} id="workshop-history-tab" type="button" role="tab" aria-selected={tab==='history'} aria-controls="workshop-history-panel" tabIndex={tab==='history'?0:-1} onKeyDown={moveTab} onClick={()=>setTab('history')}><Icon name="bookmark" size={15}/>历史资料</button>
      </div>
      <span className="video-workshop-local"><Icon name="database" size={13}/>视频与资料保存在本地</span>
    </div>
    {tab==='history'?<div id="workshop-history-panel" className="video-workshop-history-panel" role="tabpanel" aria-labelledby="workshop-history-tab">
      <SavedWorkshopHistory ownerSecUid={ownerSecUid} creators={creators} focus={focus} onOpenVideos={onOpenVideos}/>
    </div>:<div id="workshop-new-panel" className="video-workshop-new" role="tabpanel" aria-labelledby="workshop-new-tab" data-testid="video-workshop-new">
      <p className="video-workshop-preview"><span>抖音视频</span>粘贴链接后点击处理，下载视频并完成本地分类。</p>
      <section className="video-workshop-source video-workshop-card" aria-labelledby="workshop-source-heading">
        <header className="video-workshop-card-heading">
          <span className="video-workshop-step">01</span>
          <div><h2 id="workshop-source-heading">下载与本地分类</h2><p>从一条视频开始，先下载，再整理。</p></div>
          <span className="video-workshop-platform">抖音</span>
        </header>
        <label className={`video-workshop-input${link.state==='invalid'?' invalid':''}`}>
          <span className="video-workshop-field-label">抖音视频链接</span>
          <textarea ref={inputRef} aria-label="抖音视频链接" aria-invalid={link.state==='invalid'} aria-describedby="workshop-link-status" placeholder="粘贴视频地址，也可以直接粘贴抖音分享文本…" rows={2} value={input} spellCheck={false} onChange={event=>setInput(event.target.value)}/>
        </label>
        <div className="video-workshop-source-actions">
          <div id="workshop-link-status" data-testid="workshop-link-status" className={`video-workshop-link-status ${link.state}`} role="status" aria-live="polite">
            {link.state==='valid'?<><Icon name="check" size={14}/><div><strong>{link.kind==='short'?'已识别抖音分享短链接':'已识别抖音视频链接'}</strong><code>{link.canonicalUrl}</code></div></>:link.state==='invalid'?<p>{link.message}</p>:<p>支持作品链接与分享文本，每次处理一条视频。</p>}
          </div>
          {input&&<button type="button" className="video-workshop-clear" aria-label="清空视频链接" onClick={()=>{setInput('');inputRef.current?.focus()}}>清空</button>}
          <button className="button primary video-workshop-process" type="button" disabled={link.state!=='valid'||processing||loading||Boolean(readError)} aria-describedby="workshop-link-status workshop-processing-status" onClick={()=>{if(link.state==='valid')void start(link.canonicalUrl)}}><Icon name="download" size={15}/>{action==='start'?'正在提交…':processing?'处理中…':'处理'}</button>
        </div>
        <p id="workshop-processing-status" className="video-workshop-processing-status" role="status" aria-live="polite">{loading?'正在读取本地处理记录…':action==='cancel'?'正在取消处理…':activeJob?`${deepRunning(activeJob)?deepPhaseLabels[activeJob.deep!.phase]:phaseLabels[activeJob.phase]}，可继续编辑下一条链接。`:readError?'暂时无法读取处理记录，请重新读取后开始。':'仅进行下载与本地分类，深度处理需单独发起。'}</p>
        {readError&&<div className="video-workshop-error" role="alert"><span>{readError}</span><button type="button" className="button ghost compact" onClick={()=>void load()}>重新读取</button></div>}
        {actionError&&<p className="video-workshop-error" role="alert">{actionError}</p>}
        <div className="video-workshop-download-paths"><Icon name="database" size={13}/><span>视频 <code>E:\VideoDownload</code></span><i/><span>音频 <code>E:\AudioDownload</code></span></div>
        {jobs.length>0&&<section className="video-workshop-jobs" aria-label="已保存的处理记录">
          {jobs.length>1&&<label className="video-workshop-job-picker">处理记录<select aria-label="选择处理记录" value={selectedJob?.id??''} onChange={event=>setSelectedJobId(event.target.value)}>{jobs.map(job=><option value={job.id} key={job.id}>{phaseLabels[job.phase]} · {job.title||job.workId||job.url}</option>)}</select></label>}
          {activeJob&&activeJob.id!==selectedJob?.id&&<WorkshopResult job={activeJob} disabled={action!==null} onRetry={job=>void start(job.url)} onCancel={job=>void cancel(job)}/>}
          {selectedJob&&<WorkshopResult job={selectedJob} disabled={processing&&!isRunning(selectedJob)||action!==null} onRetry={job=>void start(job.url)} onCancel={job=>void cancel(job)}/>}
        </section>}
      </section>
      <div className="video-workshop-lower">
        <section className="video-workshop-deep video-workshop-card" aria-labelledby="workshop-deep-heading">
          <header className="video-workshop-card-heading"><span className="video-workshop-step">02</span><div><h2 id="workshop-deep-heading">深度处理</h2><p>提取声音与画面中的信息。</p></div></header>
          <div className="video-workshop-models">
            <div className="video-workshop-model"><div className="video-workshop-model-title"><Icon name="comment" size={16}/><h3>语音转写</h3><span>默认</span></div><strong>豆包极速版</strong><code>volc.bigasr.auc_turbo</code></div>
            <div className="video-workshop-model"><div className="video-workshop-model-title"><Icon name="video" size={16}/><h3>画面识别</h3><span>默认</span></div><strong>Qwen3.5-122B-A10B</strong><code>Qwen/Qwen3.5-122B-A10B</code></div>
          </div>
          {selectedJob?.phase==='completed'&&<p className="video-workshop-deep-target">处理对象：<strong>{selectedJob.title||selectedJob.workId||'已下载视频'}</strong></p>}
          <p id="video-workshop-deep-status" className="video-workshop-deep-hint" role="status" aria-live="polite">{action==='deep'?'正在提交深度处理…':selectedJob?.deep?`${deepPhaseLabels[selectedJob.deep.phase]}。${selectedJob.deep.message}`:selectedJob?.phase==='completed'&&selectedJob.mediaPath&&selectedJob.classification?'下载与本地分类已完成。点击后使用默认云端模型转写语音、识别画面并生成时间对齐报告。':'先完成视频下载与本地分类，再点击深度处理。'}</p>
          {deepError!==null&&deepError.jobId===selectedJob?.id&&<p className="video-workshop-error" role="alert">{deepError.message}</p>}
          {selectedJob?.deep?.phase==='failed'&&<p className="video-workshop-error" role="alert">{selectedJob.deep.message} 已下载视频与本地分类已保留，可直接重试深度处理。</p>}
          {selectedJob?.deep?.elapsedMs!==undefined&&<p className="video-workshop-deep-timing">{selectedJob.deep.phase==='completed'?'深度处理后台用时':'点击到深度处理停止'}：{seconds(selectedJob.deep.elapsedMs)}</p>}
          {selectedJob?.deep?.displayedTotalMs!==undefined&&<p className="video-workshop-deep-timing">点击深度处理到图文报告与截图可用：{seconds(selectedJob.deep.displayedTotalMs)}</p>}
          {activeJob&&deepRunning(activeJob)?<div className="video-workshop-deep-running">{activeJob.id!==selectedJob?.id&&<p role="status">{activeJob.title||'另一条视频'}：{deepPhaseLabels[activeJob.deep!.phase]}。{activeJob.deep!.message}</p>}<button className="button ghost video-workshop-deep-button" type="button" disabled={action!==null} onClick={()=>void cancel(activeJob)}>取消深度处理</button></div>:<button className="button primary video-workshop-deep-button" type="button" disabled={processing||loading||Boolean(readError)||selectedJob?.phase!=='completed'||!selectedJob.mediaPath||!selectedJob.classification||selectedJob?.deep?.phase==='completed'} aria-describedby="video-workshop-deep-status" onClick={()=>{if(selectedJob)void startDeep(selectedJob)}}><Icon name="play" size={14}/>{action==='deep'?'正在提交…':selectedJob?.deep?.phase==='failed'||selectedJob?.deep?.phase==='cancelled'?'重试深度处理':selectedJob?.deep?.phase==='completed'?'深度处理已完成':'深度处理'}</button>}
          <small className="video-workshop-cloud-note">点击时才调用云端模型，可能产生云端用量。</small>
        </section>
        <section className="video-workshop-report video-workshop-card" aria-labelledby="workshop-report-heading">
          <header className="video-workshop-card-heading"><span className="video-workshop-step">03</span><div><h2 id="workshop-report-heading">图文分析与总结报告</h2><p>每一段分析，都能回到对应的视频时刻。</p></div><span className="video-workshop-time-badge"><Icon name="clock" size={12}/>时间对齐</span></header>
          {selectedJob?.deep?.result?<WorkshopDeepReport key={`${selectedJob.id}:${selectedJob.deep.result.generatedAt}`} job={selectedJob} result={selectedJob.deep.result} onDisplayed={reportDisplayed}/>:<><div className="video-workshop-report-empty" data-testid="workshop-report-empty">
            <div className="video-workshop-report-placeholder" aria-hidden="true"><Icon name="workshop" size={28}/><span/><span/></div>
            <h3>报告将在深度处理后生成</h3>
            <p>按原视频时间组织画面、语音与文字，结合证据形成分析和总结。</p>
          </div>
          <div className="video-workshop-report-structure" aria-label="报告内容结构">
            <div className="video-workshop-time-column"><Icon name="clock" size={14}/><span>视频时间</span><small>精确到毫秒</small></div>
            <div className="video-workshop-evidence-column"><span><Icon name="video" size={14}/>对应画面</span><span><Icon name="comment" size={14}/>语音转写 · 画面文字</span></div>
            <div className="video-workshop-analysis-column"><Icon name="workshop" size={15}/><span>分析与总结</span></div>
          </div></>}
          <p className="video-workshop-alignment-note">截图保留原始时间点，转写保留起止时间；图文按同一时间轴对应，无法对齐的内容会单独标注。</p>
        </section>
      </div>
    </div>}
  </section>
}
