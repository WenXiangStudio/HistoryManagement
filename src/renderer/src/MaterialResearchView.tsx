import {useEffect,useState,type JSX} from 'react'
import type {MaterialBody,ResearchReport} from '../../shared/videoWorkflow'

export default function MaterialResearchView({body,report,reportState,error,onRevise,disabled=false}:{body:MaterialBody;report?:ResearchReport;
  reportState?:string;error?:string;onRevise?:(text:string)=>Promise<void>;disabled?:boolean}):JSX.Element {
  const [editing,setEditing]=useState(false),[text,setText]=useState(body.text),[copied,setCopied]=useState(false)
  useEffect(()=>{setText(body.text);setEditing(false);setCopied(false)},[body.text,body.generatedAt])
  return <div className="material-research-view">
    <section className="material-body-section"><div className="material-section-title"><h3>文案正文</h3><div>
      <button className="button ghost compact" onClick={()=>void navigator.clipboard.writeText(body.text).then(()=>setCopied(true)).catch(()=>setCopied(false))}>{copied?'已复制':'复制正文'}</button>
      {onRevise&&<button className="button ghost compact" disabled={disabled} onClick={()=>setEditing(v=>!v)}>人工校对</button>}</div></div>
      <small className="material-source">{body.source==='doubao-flash'?'语音转写':'画面文字识别'} · {body.modelVersion}{body.reviewedAt?' · 已人工校对':body.needsReview?' · 待人工校对':''}</small>
      {body.needsReview&&<p className="material-review-banner">图文识别需要人工参与，请结合原视频校对顺序、重复内容与遗漏。下方研究报告基于当前识别稿。</p>}
      {editing?<form onSubmit={e=>{e.preventDefault();void onRevise?.(text).then(()=>setEditing(false)).catch(()=>{})}}><textarea className="material-body-editor" aria-label="校对文案正文" value={text} onChange={e=>setText(e.target.value)} maxLength={100000}/><button className="button primary compact" disabled={disabled||!text.trim()}>保存校正文案并更新研究报告</button></form>
        :<div className="material-body-text" data-testid="material-body">{body.text.split(/\n\s*\n/).map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>}
      {body.limitations.length>0&&<details><summary>识别说明</summary>{body.limitations.map((item,i)=><p key={i}>{item}</p>)}</details>}
    </section>
    <section className="material-report-section" aria-label="正文研究报告"><div className="material-section-title"><h3>正文研究报告</h3><small>{report?.modelVersion??'zai-org/GLM-5.3-Flash'}</small></div>
      {report?<><section><h4>内容总结与概括</h4><p>{report.overview}</p></section><section><h4>正文分析</h4><p>{report.analysis}</p></section>
        <section><h4>主要观点与原文依据</h4>{report.keyPoints.map((point,i)=><article className="material-point" key={i}><h5>{i+1}. {point.viewpoint}</h5><p>{point.explanation}</p>{point.quotes.map((quote,j)=><blockquote key={j}>{quote}</blockquote>)}</article>)}</section>
        <section><h4>可能涉及的领域 <span>模型推测</span></h4>{report.domains.map((domain,i)=><article className="material-domain" key={i}><h5>{domain.name}</h5><p>{domain.reasoning}</p>{domain.quotes.map((quote,j)=><blockquote key={j}>{quote}</blockquote>)}</article>)}</section>
        {report.limitations.length>0&&<section><h4>分析说明</h4><ul>{report.limitations.map((item,i)=><li key={i}>{item}</li>)}</ul></section>}
        <small className="material-source">生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')} · 依据当前文案正文</small></>
        :<p className="material-report-pending" role="status">{reportState==='running'?'正在根据文案生成研究报告…':error?`研究报告未完成：${error}`:'研究报告待处理'}</p>}
    </section>
  </div>
}
