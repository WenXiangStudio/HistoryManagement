import {useEffect,useState} from 'react'
import type {CreatorActivityState} from '../../shared/creatorActivity'
import {baselineBatchSizes,baselineSampleCount} from '../../shared/creatorActivityBaseline'
import CreatorName from './CreatorName'
import {CreatorActivityRecoveryStatus} from './CreatorActivityRecoveryStatus'

export function CreatorBaselineTaskPanel({state,creatorCount,canStart,onStart,onCancel}:{state:CreatorActivityState|null;creatorCount:number;canStart:boolean;onStart:(resume?:boolean)=>void;onCancel:()=>void}){
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{if(state?.phase!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[state?.phase])
  const task=state?.baselineTask,running=!!task&&state?.phase==='running',sizes=task?.batchSizes??(creatorCount?baselineBatchSizes(creatorCount):[])
  const pending=Math.max(0,creatorCount-(state?.baselineReadyCount??0))
  const done=task?state!.succeeded:0,total=task?state!.total:creatorCount
  const samples=task?.results.reduce((n,r)=>n+baselineSampleCount(r),0)??0
  const currentIndex=Math.min(done,Math.max(0,total-1));let batch=1,offset=0
  for(const [i,size] of sizes.entries()){batch=i+1;if(currentIndex<offset+size)break;offset+=size}
  const remaining=Math.max(0,Math.ceil((Date.parse(state?.waiting?.until??'')-now)/1000))||0
  return <div className="creator-baseline-task" data-testid="creator-baseline-task">
    <div className="creator-baseline-heading"><div><h3>活跃度基线试采</h3><p>连续采集最新 60 条有效作品 · 不限制时间跨度 · 不足 60 条则读取到列表末尾</p></div>
      {running?<button className="button ghost" data-testid="pause-creator-baseline" onClick={onCancel}>暂停试采</button>:<div className="creator-baseline-actions">
        {!!task&&state!.remainingIds.length>0&&<button className="button primary" disabled={!canStart} data-testid="resume-creator-baseline" onClick={()=>onStart(true)}>继续剩余 {state!.remainingIds.length} 位</button>}
        <button className="button ghost" disabled={!canStart||!pending} data-testid="start-creator-baseline" onClick={()=>onStart(false)}>{pending?`补齐剩余 ${pending} 位基线`:'全部基线已补齐'}</button></div>}
    </div>
    <p>已有 {state?.baselineReadyCount??0}/{creatorCount} 位满足新规则，可复用原始记录；最近 30／90／180 天发布数量单独统计。</p>
    {!!task?.reusedCount&&<p>本轮复用 {task.reusedCount} 位 · 仅补采其余 {total} 位</p>}
    {!!task&&task.policy.version!==2&&<p>下方为上轮 180 天窗口试采记录；上方按钮按新规则补齐。</p>}
    <p>{sizes.length} 批 · {sizes.join(' / ')} 位 · 博主间隔 5～10 秒 · 批次间隔 3～5 分钟</p>
    {!!task&&<><div className="creator-baseline-status" role="status"><strong>{state!.phase==='completed'?'已完成':state!.phase==='blocked'?'已停止':state!.phase==='cancelled'?'已暂停':'采集中'} · {done}/{total} 位（{total?Math.floor(done/total*100):0}%）</strong><span>第 {batch}/{sizes.length} 批 · 已保存 {samples} 条统计样本</span></div>
      <progress max={total||1} value={done}/><p>{state!.message}{running&&state!.currentName&&<> · <CreatorName name={state!.currentName} profileUrl={state!.currentSecUid?`https://www.douyin.com/user/${state!.currentSecUid}`:undefined}/></>}</p>
      {running&&state!.waiting&&<strong className="creator-baseline-countdown" data-testid="creator-baseline-countdown">{state!.waiting.kind==='batch'?'批间休息':state!.waiting.kind==='resume'?'恢复等待':'博主间隔'} · {Math.floor(remaining/60)} 分 {remaining%60} 秒后继续</strong>}
      <CreatorActivityRecoveryStatus state={state!} now={now}/>
      <div className="creator-baseline-batches">{sizes.map((size,i)=>{const start=sizes.slice(0,i).reduce((n,x)=>n+x,0),completed=Math.max(0,Math.min(size,done-start));return <span key={i} className={completed===size?'complete':running&&batch===i+1?'current':''}>第 {i+1} 批 · {completed}/{size}</span>})}</div>
      {!!task.results.length&&<details><summary>最近采集结果 · 少于 2 条时显示“记录不足”</summary><div className="creator-baseline-results">{task.results.slice(-8).reverse().map(r=><div key={r.creatorId}><strong>{r.nickname}</strong><span>统计 {baselineSampleCount(r)} 条 · 原始公开记录 {r.collectedCount} 条 · {r.stopReason==='limit'?'达到 60 条':r.stopReason==='window'?'达到旧版 180 天边界':'列表已结束'} · {r.interval.meanHours===null?'记录不足':`平均 ${(r.interval.meanHours/24).toFixed(2)} 天`}</span></div>)}</div></details>}
    </>}
  </div>
}
