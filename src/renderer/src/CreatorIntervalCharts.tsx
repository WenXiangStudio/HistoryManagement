import {memo,useMemo,useState,type JSX,type KeyboardEvent} from 'react'
import type {CreatorDatabaseRow} from '../../shared/creatorDatabase'
import {creatorIntervalStatistics,intervalStatisticDays,type IntervalBucket} from '../../shared/creatorIntervalStatistics'
import {formatPublicationInterval} from '../../shared/creatorPublicationInterval'
import CreatorName from './CreatorName'
import VirtualTableBody from './VirtualTableBody'

type ChartType='column'|'bar'|'line'|'donut'
type Selection=number|null|'all'|'valid'
const chartTypes:{id:ChartType;name:string;path:string}[]=[
  {id:'column',name:'柱状图',path:'M4 19V10h4v9M10 19V4h4v15M16 19v-7h4v7'},
  {id:'bar',name:'条形图',path:'M4 4h15v4H4M4 10h10v4H4M4 16h6v4H4'},
  {id:'line',name:'折线图',path:'m3 17 6-7 5 3 7-10M3 3v18h18'},
  {id:'donut',name:'环形图',path:'M12 3a9 9 0 1 0 9 9h-6a3 3 0 1 1-3-3V3Zm3 0v6h6a9 9 0 0 0-6-6Z'}
]
const color=(days:number|null,index=0,donut=false):string=>days===null?'#919a95':days===0?'#cc7046':donut?`hsl(${145+(index*47)%210} 32% ${36+(index%3)*9}%)`:'#33735e'
const percent=(share:number):string=>`${(share*100).toFixed(1)}%`
const selectByKey=(event:KeyboardEvent<SVGElement>,select:()=>void):void=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select()}}

function DistributionChart({type,buckets,total,selected,onSelect}:{type:ChartType;buckets:IntervalBucket[];total:number;selected:Selection;onSelect:(days:number|null)=>void}):JSX.Element{
  const [hover,setHover]=useState<number|null|undefined>()
  const hovered=buckets.find(bucket=>bucket.days===hover)
  const max=Math.max(1,...buckets.map(bucket=>bucket.count)),step=Math.max(1,Math.ceil(max/4)),ceiling=Math.ceil(max/step)*step
  const width=Math.max(740,buckets.length*34+90),height=300,left=48,base=height-46,plotHeight=height-80,slot=(width-left-24)/Math.max(1,buckets.length)
  const point=(bucket:IntervalBucket,index:number)=>({x:left+slot*(index+.5),y:base-bucket.count/ceiling*plotHeight})
  const interactive=(bucket:IntervalBucket)=>({role:'button',tabIndex:0,'aria-label':`${bucket.label}：${bucket.count}位，占${percent(bucket.share)}，查看博主`,'aria-pressed':selected===bucket.days,
    onClick:()=>onSelect(bucket.days),onKeyDown:(e:KeyboardEvent<SVGElement>)=>selectByKey(e,()=>onSelect(bucket.days)),onMouseEnter:()=>setHover(bucket.days),onMouseLeave:()=>setHover(undefined),onFocus:()=>setHover(bucket.days),onBlur:()=>setHover(undefined)})
  let offset=0
  return <>
    <div className="interval-chart-readout" aria-live="polite">{hovered?<><i style={{background:color(hovered.days)}}/><strong>{hovered.label}</strong><span>{hovered.count}位博主 · 占全部统计人数 {percent(hovered.share)}</span></>:<span>悬停查看人数与占比，点击查看对应博主</span>}</div>
    {type==='donut'?<div className="interval-donut-layout">
      <svg className="interval-donut" viewBox="0 0 300 300" aria-label="间隔天数人数环形图">
        <circle cx="150" cy="150" r="104" fill="none" stroke="#e8e9e1" strokeWidth="42"/>
        {buckets.map((bucket,index)=>{const start=offset;offset+=bucket.share;return <circle key={bucket.label} {...interactive(bucket)} className="interval-chart-mark" cx="150" cy="150" r="104" pathLength="100" fill="none"
          stroke={color(bucket.days,index,true)} strokeWidth={selected===bucket.days?50:42} strokeDasharray={`${bucket.share*100} ${100-bucket.share*100}`} strokeDashoffset={-start*100} transform="rotate(-90 150 150)">
          <title>{bucket.label} · {bucket.count}位 · {percent(bucket.share)}</title></circle>})}
        <text x="150" y="148" textAnchor="middle" className="interval-donut-total">{total}</text><text x="150" y="174" textAnchor="middle" className="interval-axis">位博主 · 含 null</text>
      </svg>
      <div className="interval-chart-legend" aria-label="环形图分类图例">{buckets.map((bucket,index)=><button key={bucket.label} aria-pressed={selected===bucket.days} onClick={()=>onSelect(bucket.days)}><i style={{background:color(bucket.days,index,true)}}/><span>{bucket.label}</span><strong>{bucket.count}位</strong><small>{percent(bucket.share)}</small></button>)}</div>
    </div>:type==='bar'?<div className="interval-chart-scroll interval-horizontal-scroll" tabIndex={0} aria-label="条形图，可纵向滚动查看全部天数">
      <div className="interval-bar-scale"><span>间隔天数</span><span>博主人数 · 最多 {max} 位</span></div>
      {buckets.map(bucket=><button key={bucket.label} className="interval-horizontal-bar" aria-pressed={selected===bucket.days} onClick={()=>onSelect(bucket.days)} onMouseEnter={()=>setHover(bucket.days)} onMouseLeave={()=>setHover(undefined)} onFocus={()=>setHover(bucket.days)} onBlur={()=>setHover(undefined)}>
        <span>{bucket.label}</span><span className="interval-bar-track"><i style={{width:`${bucket.count/max*100}%`,background:color(bucket.days)}}/></span><strong>{bucket.count}</strong><small>{percent(bucket.share)}</small></button>)}
    </div>:<div className="interval-chart-scroll" tabIndex={0} aria-label={`${type==='column'?'柱状图':'折线图'}，可横向滚动查看全部天数`}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{width,minWidth:'100%'}} aria-label="各间隔天数对应博主人数">
        {Array.from({length:ceiling/step+1},(_,i)=>{const count=i*step,y=base-count/ceiling*plotHeight;return <g key={count}><line x1={left} x2={width-20} y1={y} y2={y} stroke="#e2e5dc" strokeDasharray={count?'3 5':undefined}/><text className="interval-axis" x={left-12} y={y+4} textAnchor="end">{count}</text></g>})}
        <text className="interval-axis" x="8" y="17">人数</text>
        {type==='line'&&<polyline points={buckets.flatMap((bucket,index)=>{if(bucket.days===null)return [];const p=point(bucket,index);return [`${p.x},${p.y}`]}).join(' ')} fill="none" stroke="#33735e" strokeWidth="2.5"/>}
        {buckets.map((bucket,index)=>{const p=point(bucket,index),active=selected===bucket.days;return <g key={bucket.label} {...interactive(bucket)} className="interval-chart-mark">
          <title>{bucket.label} · {bucket.count}位 · {percent(bucket.share)}</title>
          <rect x={p.x-slot/2} y="25" width={slot} height={base-18} fill={active?'#e8eee4':'transparent'}/>
          {type==='column'||bucket.days===null?<rect x={p.x-10} y={p.y} width="20" height={base-p.y} rx="3" fill={color(bucket.days)} opacity={hover===bucket.days?1:.88}/>:<circle cx={p.x} cy={p.y} r={active?6:4.5} fill={color(bucket.days)} stroke="#fcfaf5" strokeWidth="2"/>}
          <text x={p.x} y={p.y-9} textAnchor="middle" className="interval-value">{bucket.count}</text><text x={p.x} y={base+22} textAnchor="middle" className="interval-axis">{bucket.days??'null'}</text>
        </g>})}
        <text x={left} y={height-4} className="interval-axis">天数分类 · 按天数升序 · null 单独列示</text>
      </svg>
    </div>}
    <p className="interval-chart-footnote">{type==='donut'?'占比按全部统计人数计算，包含0天与 null；每个天数独立显示。':type==='bar'?'向下滚动查看全部分类；每一行对应一个整数天数或 null。':'横向滚动查看全部分类；仅列出有博主的天数，分类等距显示。'}{type==='line'?' 折线用于比较分类人数，不代表时间趋势；null 不连入折线。':''}</p>
  </>
}

export default memo(function CreatorIntervalCharts({rows,allRows}:{rows:CreatorDatabaseRow[];allRows:CreatorDatabaseRow[]}):JSX.Element{
  const [scope,setScope]=useState<'filtered'|'all'>('filtered'),[type,setType]=useState<ChartType>('column'),[selected,setSelected]=useState<Selection>('all')
  const statistics=useMemo(()=>creatorIntervalStatistics(scope==='all'?allRows:rows),[scope,allRows,rows])
  const members=statistics.buckets.filter(bucket=>selected==='all'||(selected==='valid'?bucket.days!==null:bucket.days===selected)).flatMap(bucket=>bucket.rows)
  const selectionLabel=selected==='all'?'全部博主':selected==='valid'?'有效间隔':selected===null?'null · 暂无间隔':`${selected}天`
  const choose=(value:Selection):void=>setSelected(value)
  return <section className="interval-statistics" data-testid="interval-statistics" aria-label="间隔天数数据图表">
    <div className="interval-heading"><div><h2>发布间隔统计</h2></div>
      <label className="interval-scope">统计范围<select aria-label="图表统计范围" value={scope} onChange={event=>{setScope(event.target.value as 'filtered'|'all');setSelected('all')}}><option value="filtered">当前搜索与筛选</option><option value="all">当前账号全部博主</option></select></label>
    </div>
    <div className="interval-summary">
      {([{label:'统计博主',count:statistics.total,value:'all',note:scope==='all'?'当前账号全部博主':'跟随当前搜索与筛选'},
        {label:'有效间隔',count:statistics.valid,value:'valid',note:'包含取整后的0天'},
        {label:'0天 · 单独关注',count:statistics.zeroCount,value:0,note:'0天0–12小时，已计入主图'},
        {label:'null · 暂无间隔',count:statistics.nullCount,value:null,note:'空白或记录不足，已计入主图'}] as const).map(card=><button key={card.label} data-stat={card.value===null?'missing':String(card.value)} aria-pressed={selected===card.value} className={`interval-stat-card ${card.value===0?'is-zero':card.value===null?'is-null':''}`} onClick={()=>choose(card.value)}><span>{card.label}</span><strong>{card.count}<small>位</small></strong><small>{card.note}</small></button>)}
    </div>
    <details className="interval-rule"><summary>取整规则：小时 &gt; 12 加1天，小时 ≤ 12 舍去；空白记为 null<span>查看示例</span></summary><p>按表格显示的“X天Y小时”计算，空白或记录不足记为 <code>null</code>，0天和 null 均计入主图。<br/>例如：0天12小时 → 0天，0天13小时 → 1天，21天12小时 → 21天。</p></details>
    <div className="interval-chart-panel">
      <div className="interval-chart-heading"><div><h3>间隔天数分布</h3><span>{statistics.buckets.length} 个分类 · 共 {statistics.total} 位 · 含0天与 null</span></div><div className="interval-chart-types" aria-label="图表类型">{chartTypes.map(chart=><button key={chart.id} aria-pressed={type===chart.id} onClick={()=>setType(chart.id)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={chart.path}/></svg>{chart.name}</button>)}</div></div>
      {statistics.total?<DistributionChart key={type} type={type} buckets={statistics.buckets} total={statistics.total} selected={selected} onSelect={choose}/>:<div className="database-empty">{allRows.length?'当前筛选下没有博主。请调整筛选，或将统计范围切换为“当前账号全部博主”。':'当前账号还没有博主，完成关注清单同步后会自动生成图表。'}</div>}
    </div>
    <div className="interval-detail-grid">
      <section className="interval-detail-panel"><div className="interval-detail-heading"><h3>逐天人数</h3><span>点击分类查看明细</span></div><div className="interval-detail-scroll"><table className="interval-detail-table" aria-rowcount={statistics.buckets.length+2}><thead><tr><th scope="col">间隔天数</th><th scope="col">博主人数</th><th scope="col">占全部人数</th></tr></thead>
        <VirtualTableBody rows={statistics.buckets} rowKey={bucket=>bucket.label} columnCount={3} estimatedHeight={40} renderRow={bucket=><tr key={bucket.label} aria-selected={selected===bucket.days}><td><button className="interval-bucket-link" onClick={()=>choose(bucket.days)}><i style={{background:color(bucket.days)}}/>{bucket.label}</button></td><td>{bucket.count}</td><td>{percent(bucket.share)}</td></tr>}/>
        <tfoot><tr><td>合计（含 null）</td><td>{statistics.total}</td><td>{statistics.total?'100%':'—'}</td></tr></tfoot></table></div></section>
      <section className="interval-detail-panel" aria-label="博主统计明细"><div className="interval-detail-heading"><h3>{selectionLabel}<span> {members.length}位</span></h3><button className="interval-reset" onClick={()=>choose('all')}>查看全部</button></div>
        {selected===0&&<p className="interval-selection-note">这些博主有有效间隔，舍去小时后记为0天，已计入主图。</p>}{selected===null&&<p className="interval-selection-note">间隔为空或记录不足，统计值为 null，独立计入主图。</p>}
        <div className="interval-detail-scroll"><table className="interval-detail-table" data-testid="interval-members" aria-rowcount={members.length+1}><thead><tr><th scope="col">博主昵称</th><th scope="col">原始间隔</th><th scope="col">统计天数</th></tr></thead>
          <VirtualTableBody rows={members} rowKey={row=>row.secUid} columnCount={3} estimatedHeight={40} renderRow={row=>{const days=intervalStatisticDays(row.values.intervalHours);return <tr key={row.secUid}><td><CreatorName name={row.nickname} profileUrl={row.profileUrl} priority={row.refreshPriority}/></td><td>{days===null?'null':formatPublicationInterval(row.values.intervalHours as number)}</td><td><span className={days===0?'interval-zero-value':days===null?'interval-null-value':''}>{days===null?'null':`${days}天`}</span></td></tr>}}/>
        </table>{!members.length&&<div className="database-empty">当前范围内没有该分类的博主。</div>}</div>
      </section>
    </div>
  </section>
})
