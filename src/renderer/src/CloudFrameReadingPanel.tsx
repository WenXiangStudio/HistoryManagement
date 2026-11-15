import {useEffect,useRef,useState} from 'react'
import type {CloudFrameResult} from '../../shared/videoContent'
const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`
export default function CloudFrameReadingPanel({owner,workId,result,onReady}:{owner:string;workId:string;result:CloudFrameResult;onReady?:()=>void}){
  const [images,setImages]=useState<Record<string,string>>({}),[failed,setFailed]=useState(false),[loaded,setLoaded]=useState<Set<string>>(new Set())
  const [expanded,setExpanded]=useState<string|null>(null),section=useRef<HTMLElement|null>(null)
  const signature=result.frames.map(f=>f.id+f.sha256).join(',')
  useEffect(()=>{let active=true;setImages({});setLoaded(new Set());setFailed(false)
    void Promise.all(result.frames.map(f=>window.signalDesk.getVideoFrame(owner,workId,f.id))).then(rows=>{
      if(active)setImages(Object.fromEntries(rows.map(r=>[r.id,r.dataUrl])))
    }).catch(()=>{if(active)setFailed(true)})
    return()=>{active=false}
  },[owner,workId,signature])
  useEffect(()=>{
    if(!onReady||failed||loaded.size!==result.frames.length)return
    section.current?.scrollIntoView?.({block:'start'})
    let next=0
    const first=requestAnimationFrame(()=>{next=requestAnimationFrame(onReady)})
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(next)}
  },[onReady,failed,loaded.size,signature])
  return <section className="cloud-frame-reading" data-testid="cloud-frame-reading" ref={section}>
    <div className="cloud-frame-heading"><h3>云端画面文字与内容</h3><span>硅基流动 · {result.modelVersion}</span></div>
    <p className="video-library-caption">本次读取 {result.frames.length} 张全时间轴抽样画面。下方文字和描述由云端模型直接读取图片得到；抽样不能覆盖全部字幕或连续动作。</p>
    <p className="cloud-frame-timing">本地校验与抽帧 {(result.timing.preparationMs/1000).toFixed(3)} 秒 · 本轮云端请求 {(result.timing.requestMs/1000).toFixed(3)} 秒<br/>
      API 返回输入 {result.usage.inputTokens.toLocaleString()} / 输出 {result.usage.outputTokens.toLocaleString()} tokens · 费用以服务商记录为准</p>
    {failed&&<p role="alert">原帧暂时无法显示，识别结果仍已保留。</p>}
    <div className="cloud-frame-cards">{result.readings.map(row=><article className="cloud-frame-card" key={row.frameId} data-frame-id={row.frameId}>
      <div className="cloud-frame-card-top"><strong>{time(row.timeMs)}</strong><small>{row.frameId}</small></div>
      <div className="cloud-frame-card-body">{images[row.frameId]?<button className="cloud-frame-image" aria-label={`放大 ${time(row.timeMs)} 画面`} onClick={()=>setExpanded(row.frameId)}>
        <img src={images[row.frameId]} alt={`${time(row.timeMs)} 的原始抽帧`} onLoad={()=>setLoaded(current=>new Set([...current,row.frameId]))} onError={()=>setFailed(true)}/></button>:<p>正在读取本地画面…</p>}
      <div className="cloud-frame-copy"><h4>画面文字</h4><p className="cloud-frame-text">{row.text||'本帧未识别到清晰文字'}</p>
      <h4>可见画面</h4><p>{row.description}</p>
      {!!row.uncertainties.length&&<div className="cloud-frame-uncertain"><strong>需核对</strong>{row.uncertainties.map((text,i)=><p key={i}>{text}</p>)}</div>}
      </div></div>
    </article>)}</div>
    {expanded&&<div className="cloud-frame-overlay" role="dialog" aria-modal="true" aria-label="原始抽帧放大" onClick={()=>setExpanded(null)}>
      <button className="button primary" autoFocus onClick={()=>setExpanded(null)}>关闭大图</button><img src={images[expanded]} alt="原始抽帧放大" onClick={e=>e.stopPropagation()}/></div>}
  </section>
}
