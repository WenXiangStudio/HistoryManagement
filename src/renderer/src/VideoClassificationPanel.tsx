import {useEffect,useState,type JSX} from 'react'
import {VIDEO_CLASS_LABELS,effectiveVideoClass,processingRoute,type VideoClassification,type VideoClass} from '../../shared/videoWorkflow'

export function ClassificationFrames({owner,id,classification,thumbnail=false,onReady}:{owner:string;id:string;classification:Pick<VideoClassification,'sourceSha256'|'frames'>;
  thumbnail?:boolean;onReady?:()=>void}):JSX.Element {
  const [images,setImages]=useState<{id:string;timeMs:number;dataUrl:string}[]>([]),[error,setError]=useState(false),[zoom,setZoom]=useState<string|null>(null)
  const [loaded,setLoaded]=useState<Set<string>>(new Set())
  useEffect(()=>{let disposed=false;setImages([]);setLoaded(new Set());setError(false)
    const frames=thumbnail?classification.frames.slice(0,1):classification.frames
    void Promise.all(frames.map(f=>window.signalDesk.getClassificationFrame(owner,id,f.id))).then(result=>{if(!disposed)setImages(result)}).catch(()=>{if(!disposed)setError(true)})
    return()=>{disposed=true}
  },[owner,id,classification.sourceSha256,classification.frames.map(f=>f.sha256).join(','),thumbnail])
  useEffect(()=>{if(images.length&&loaded.size===images.length)onReady?.()},[images,loaded,onReady])
  useEffect(()=>{if(!zoom)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setZoom(null)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[zoom])
  return <>{error?<p className="video-frame-unavailable">截图未能读取，可重新分类恢复</p>:<div className={thumbnail?'video-triage-thumbnail':'video-evidence-frames triage-frames'}>
    {images.map(f=><figure key={f.id}><button aria-label={`放大第 ${Math.floor(f.timeMs/1000)} 秒截图`} onClick={()=>setZoom(f.dataUrl)}><img src={f.dataUrl} alt={`视频抽帧 ${Math.floor(f.timeMs/1000)} 秒`} onLoad={()=>setLoaded(previous=>new Set([...previous,f.id]))}/></button>{!thumbnail&&<figcaption>{(f.timeMs/1000).toFixed(1)} 秒</figcaption>}</figure>)}
    {!images.length&&<span>正在读取截图…</span>}</div>}
    {zoom&&<div className="cloud-frame-overlay" role="dialog" aria-modal="true" aria-label="视频截图" onClick={()=>setZoom(null)}><button className="button ghost" autoFocus onClick={()=>setZoom(null)}>关闭截图 · Esc</button><img src={zoom} alt="放大的视频截图"/></div>}</>
}
export default function VideoClassificationPanel({owner,id,classification,state,disabled,onReview}:{owner:string;id:string;
  classification?:VideoClassification;state?:string;disabled:boolean;onReview:(code:'visual'|'visual_text'|'speech',note:string)=>Promise<void>}):JSX.Element {
  const [editing,setEditing]=useState(false),[code,setCode]=useState<VideoClass>('pending'),[note,setNote]=useState('')
  useEffect(()=>{setEditing(false);setNote('');setCode(effectiveVideoClass(classification))},[owner,id,classification?.manualReview?.at])
  const category=effectiveVideoClass(classification),route=processingRoute(classification)
  const routeText={manual:'此类内容需要亲自观看。标记感兴趣后保留供人工观看。',vision:'标记感兴趣后，可手动开始识别画面文字并生成文案与研究报告；文案需要人工校对。',speech:'标记感兴趣后，可手动开始转写口播并生成文案与研究报告。',review:'分类尚未确定，请人工审核；审核完成后仍需手动开始处理。'}[route]
  return <section className={`video-classification ${category}`} aria-label="视频分类">
    <div className="video-classification-heading"><div><small>视频类型</small><h3>{classification?VIDEO_CLASS_LABELS[category]:state==='running'?'正在本地分类…':state==='failed'?'分类未完成 · 请人工审核':'等待本地分类'}</h3></div>
      {classification&&<button className="button ghost compact" disabled={disabled} onClick={()=>setEditing(v=>!v)}>人工审核 / 更正</button>}</div>
    <p>{routeText}</p>
    {classification&&<><div className="video-classification-basis"><span>检测语音 {classification.basis.speechPercent.toFixed(1)}%</span><span>文字区域 {classification.basis.retainedTextFrames}/{classification.basis.sampledFrames} 帧</span><span>规则依据：{classification.strength}</span>{classification.manualReview&&<span>已人工确认</span>}</div>
      {classification.manualReview&&<p className="video-review-note">人工审核：{classification.manualReview.note}</p>}
      <p className="video-library-caption">本地语音区间与文字区域检测，不识别文案含义；抽帧供你判断内容方向。</p>
      <ClassificationFrames owner={owner} id={id} classification={classification}/></>}
    {editing&&<form className="video-classification-review" onSubmit={e=>{e.preventDefault();if(code==='pending')return;void onReview(code,note).then(()=>setEditing(false)).catch(()=>{})}}>
      <label>人工确认类型<select aria-label="人工确认视频类型" value={code} onChange={e=>setCode(e.target.value as VideoClass)}><option value="pending">请选择确认类别</option>{(['visual','visual_text','speech'] as const).map(c=><option key={c} value={c}>{VIDEO_CLASS_LABELS[c]}</option>)}</select></label>
      <label>判断依据<textarea aria-label="分类审核依据" value={note} onChange={e=>setNote(e.target.value)} placeholder="记录观看与判断依据" maxLength={2000}/></label>
      <button className="button primary compact" disabled={disabled||code==='pending'||!note.trim()}>保存人工审核</button>
    </form>}
  </section>
}
