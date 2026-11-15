import {useEffect,useState,type JSX} from 'react'
import type {CreatorTimelineObservation,CreatorTimelineView} from '../../shared/creatorWorkTimeline'
import {useCreatorCardState} from './CreatorCardSession'

const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
export default function CreatorWorkTimelinePanel({owner,creatorId,observation,invalidCount=0}:{owner:string;creatorId:number;observation:CreatorTimelineObservation;invalidCount?:number}):JSX.Element{
  const [open,setOpen]=useCreatorCardState('timeline-open',false),[view,setView]=useState<CreatorTimelineView|null>(null),[error,setError]=useState(''),[limit,setLimit]=useCreatorCardState('timeline-limit',30)
  useEffect(()=>{if(!open)return;let disposed=false;setError('');setView(null)
    void window.signalDesk.getCreatorWorkTimeline(owner,creatorId).then(result=>{if(!disposed&&result.ownerSecUid===owner)setView(result)}).catch(()=>{if(!disposed)setError('作品记录暂未读取，请重新展开')})
    return()=>{disposed=true}
  },[owner,creatorId,open,observation.checkedAt])
  return <details className="creator-work-timeline" data-testid="creator-work-timeline" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>查看统计区间与累计作品记录{invalidCount>0&&` · ${invalidCount} 条已失效`}</summary>
    <p>{observation.timeBaseline?`统计区间：发布时间晚于 ${date(observation.timeBaseline)}，截至 ${date(observation.checkedAt)}`:`时间基线建立于 ${date(observation.checkedAt)}`}。</p>
    <p>作品按发布时间从旧到新排列，置顶只作标记。已失效记录保留，并继续参与间隔计算。</p>
    <p>{observation.coverage==='complete'?'该次采集已核对完整公开列表':observation.coverage==='time-range'?`该次采集连续核对 ${date(observation.coverageStart!)} 之后的时间范围；更早未读作品保留原状态`:'该次采集为部分抽样，未推断缺失作品失效'}。</p>
    {error?<p role="alert">{error}</p>:!view?<p>正在读取本地记录…</p>:<>
      <ol>{view.works.slice(0,limit).map(work=><li key={work.workId} className={work.state==='invalid'?'invalid':''}>
        <div><time>{date(work.publishedAt)}</time><span>{work.state==='invalid'?'已失效':'已记录'}</span>{work.pinned&&<small>置顶</small>}{work.sourceAuthor&&<small>按当前博主主页归属</small>}</div>
        <a href={`https://www.douyin.com/video/${work.workId}`} onClick={e=>{e.preventDefault();void window.signalDesk.openExternal(e.currentTarget.href)}}>作品 {work.workId}</a>
        {work.invalidatedAt&&<small>核对于 {date(work.invalidatedAt)} · 在已覆盖范围内未出现，删除／隐藏原因未确定</small>}
      </li>)}</ol>
      {view.works.length>limit&&<button className="button ghost compact" onClick={()=>setLimit(n=>n+30)}>再显示 30 条</button>}
      <small>累计 {view.works.length} 条 · 已失效 {view.works.filter(w=>w.state==='invalid').length} 条</small>
    </>}
  </details>
}
