import {memo,useCallback,useEffect,useMemo,useRef,useState,type JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import type {CreatorActivityState} from '../../shared/creatorActivity'
import {calendarWeek} from '../../shared/calendarWeek'
import {formatPublicationInterval} from '../../shared/creatorPublicationInterval'
import {creatorsForRefreshScope,creatorNeedsVerification,effectiveCreatorTier,creatorRecentActivity,CREATOR_REFRESH_SCOPE_LABELS,type CreatorRefreshScope} from '../../shared/creatorRefreshPolicy'
import {CREATOR_TIER_LABELS,type CreatorPriorityMode} from '../../shared/creatorPriority'
import {currentCreatorActivity,shanghaiDateKey} from '../../shared/creatorActivitySections'
import CreatorName from './CreatorName'
import CreatorPriorityControls from './CreatorPriorityControls'
import CreatorWorkTimelinePanel from './CreatorWorkTimelinePanel'
import {CreatorActivityRecoveryStatus} from './CreatorActivityRecoveryStatus'
import {Icon,Avatar,SearchBox,useEventCallback} from './ui'
import VirtualCreatorGrid from './VirtualCreatorGrid'
import {useCreatorCardState,type CreatorCardSession} from './CreatorCardSession'
import {CREATOR_INTEREST_LABELS,type CreatorInterestTier} from '../../shared/creatorInterest'
import CreatorInterestPicker from './CreatorInterestPicker'

type CreatorLibrarySection = 'active' | 'regular' | 'inactive' | 'dormant' | 'anomaly'
type CreatorInterestSection = 'interest-high' | 'interest-medium' | 'interest-weak'
type CreatorSectionKey = CreatorLibrarySection|CreatorInterestSection
type CreatorViewMode = 'activity'|'interest'

export type CreatorCardRefreshRun = {ownerSecUid:string|null;runId:string;creatorIds:number[]}

const creatorDateTimeFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
function creatorDateTime(value:string):string {
  const parts=creatorDateTimeFormatter.formatToParts(new Date(value))
  const part=(name:string)=>parts.find(item=>item.type===name)?.value||''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}
function creatorPublishedDate(value:string|null|undefined):string {
  const date=value?shanghaiDateKey(value):null
  if(!date)return '暂无可用日期'
  const [year,month,day]=date.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}
function CreatorBiography({creator}: {creator:CreatorListItem}):JSX.Element {
  const [expanded,setExpanded]=useCreatorCardState('biography-expanded',false)
  const [truncated,setTruncated]=useState(false)
  const preview=useRef<HTMLParagraphElement|null>(null)
  const text=creator.signature||'这个博主还没有可用的公开简介。'
  useEffect(()=>{
    const element=preview.current
    if(!element||expanded)return
    let disposed=false,visible=false,frame=0
    // Reading every offscreen biography forces the entire grid to lay out.
    const measure=():void=>{
      if(disposed||!visible||frame)return
      frame=requestAnimationFrame(()=>{frame=0;if(!disposed&&visible)setTruncated(element.scrollHeight>element.clientHeight+1)})
    }
    const resize=new ResizeObserver(measure)
    const card=element.closest('.creator-card')!
    const intersection=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
      visible=entries.some(entry=>entry.isIntersecting)
      if(visible){resize.observe(element);measure()}else resize.unobserve(element)
    },{root:element.closest('.workspace'),rootMargin:'200px 0px'})
    if(intersection)intersection.observe(card)
    else{visible=true;resize.observe(element);measure()}
    void document.fonts.ready.then(measure)
    return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();intersection?.disconnect()}
  },[text,expanded])
  const descriptionId=`creator-biography-${creator.id}`
  return <div className={`creator-biography${expanded?' expanded':''}`} data-testid="creator-biography">
    <p ref={preview} id={descriptionId} className={expanded?'creator-biography-full':'creator-biography-preview'} data-testid="creator-biography-text">{text}</p>
    {(truncated||expanded)&&<button type="button" className="creator-biography-toggle" data-testid="creator-biography-toggle"
      aria-expanded={expanded} aria-controls={descriptionId} aria-label={`${expanded?'收起':'展开'} ${creator.nickname} 的完整简介`}
      onClick={()=>setExpanded(value=>!value)}>{expanded?'收起简介':'展开简介'}<Icon name={expanded?'chevron-up':'chevron'} size={12}/></button>}
  </div>
}

type CreatorCardProps={
  creator:CreatorListItem;ownerSecUid:string|null;selected:boolean;saving:boolean
  running:boolean;canSetPriority:boolean;canRefresh:boolean;weekLabel:string
  annotationSaving:boolean
  interestSaving:boolean
  onInterestChange:(creator:CreatorListItem,tier:CreatorInterestTier|null)=>Promise<boolean>
  refreshedThisRun:boolean;singleRefreshSuccess:boolean
  onSelect:(id:number,checked:boolean)=>void
  onUpdate:(id:number,input:{isStarred?:boolean;note?:string},success:string)=>Promise<boolean>
  onOpenVideos:(creator:CreatorListItem)=>void
  onPriorityChange:(creator:CreatorListItem,mode:CreatorPriorityMode|null)=>void
  onRefresh:(creatorId?:number,resume?:boolean,creatorIds?:number[],scope?:CreatorRefreshScope)=>void
}
const CreatorCard=memo(function CreatorCard({creator,ownerSecUid,selected,saving,running,canSetPriority,canRefresh,weekLabel,refreshedThisRun,singleRefreshSuccess,onSelect,onUpdate,onOpenVideos,onPriorityChange,onRefresh,annotationSaving,interestSaving,onInterestChange}:CreatorCardProps):JSX.Element{
  const [editing,setEditing]=useCreatorCardState('note-editing',false),[note,setNote]=useCreatorCardState('note-draft','')
  const noteInput=useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{if(editing)noteInput.current?.focus({preventScroll:true})},[editing])
  const refreshBadge=refreshedThisRun&&<span className="creator-current-refresh" data-testid="creator-current-refresh">
    <Icon name="check" size={12}/><span data-testid={singleRefreshSuccess?'creator-refresh-success':undefined}>本轮已刷新</span>
  </span>
  return <article className="creator-card" data-directory={!creator.isDemo} data-creator-id={creator.id} >
      <div className="creator-top"><Avatar name={creator.nickname} src={creator.avatarUrl} large/><button type="button" disabled={annotationSaving} title={creator.isStarred ? '取消星标' : '星标博主'} aria-label={creator.isStarred ? `取消星标 ${creator.nickname}` : `星标 ${creator.nickname}`} className={`star-button ${creator.isStarred ? 'active' : ''}`} onClick={() => void onUpdate(creator.id, { isStarred: !creator.isStarred }, creator.isStarred ? '已取消博主星标' : '已星标博主')}><Icon name="star" size={16}/><span>{creator.isStarred ? '已星标' : '星标'}</span></button></div>
      {!creator.isDemo&&!creatorNeedsVerification(creator)&&<label className="creator-refresh-selection"><input type="checkbox" data-testid="select-creator-refresh" aria-label={`选择刷新 ${creator.nickname}`} disabled={running}
        checked={selected} onChange={event=>onSelect(creator.id,event.target.checked)}/>选择刷新</label>}
      <h3><CreatorName name={creator.nickname} profileUrl={creator.profileUrl} priority={creator.refreshPriority}/></h3>
      {!creator.isDemo&&<CreatorPriorityControls creator={creator} disabled={!canSetPriority||running||creatorNeedsVerification(creator)} saving={saving} onChange={mode=>onPriorityChange(creator,mode)}/>}
      {!creator.isDemo&&<label className="creator-interest-control">兴趣度<select data-testid="creator-interest-select" aria-label={`${creator.nickname} 的兴趣度`} value={creator.interest?.tier??''} disabled={!ownerSecUid||interestSaving}
        onChange={event=>void onInterestChange(creator,(event.target.value||null) as CreatorInterestTier|null)}>
        <option value="">未添加</option>{(Object.keys(CREATOR_INTEREST_LABELS) as CreatorInterestTier[]).map(tier=><option key={tier} value={tier}>{CREATOR_INTEREST_LABELS[tier]}</option>)}
      </select>{creator.interest?.tier&&<button type="button" data-testid="remove-creator-interest" disabled={interestSaving} onClick={()=>void onInterestChange(creator,null)}>移出</button>}{interestSaving&&<small role="status">保存中</small>}</label>}
      <CreatorBiography creator={creator}/>{creator.basicPending&&<small className="pending-tag">基础资料待补充</small>}
      <a className="creator-profile-link" href={creator.profileUrl} title={creator.profileUrl} onClick={(event) => { event.preventDefault(); void window.signalDesk.openExternal(creator.profileUrl) }}><Icon name="external" size={15}/><span>{creator.profileUrl}</span></a>
      <div className="tag-row">{creator.domains.length ? creator.domains.map((domain) => <span key={domain}>#{domain}</span>) : <span className="pending-tag">待分类</span>}</div>
      <div className="creator-stats creator-activity-stats"><div title="读取博主主页“作品”标签显示的数量"><strong data-testid="creator-public-work-count">{creator.isDemo?creator.workCount:creator.activity?.workCount??'待更新'}</strong><span>公开作品总数</span></div>
        <div title="分析数量暂未接入"><strong data-testid="creator-analyzed-count">—</strong><span>已分析</span></div></div>
      <div className="creator-weekly-activity" data-testid="creator-weekly-activity"><p>
        {creatorRecentActivity(creator).status==='empty'
          ?<><strong className="creator-no-recent-updates" data-testid="creator-no-recent-updates">最近七天暂无更新</strong>
            <span className="creator-weekly-divider" aria-hidden="true">·</span>
            <span className="creator-last-update-reminder" data-testid="creator-last-update-reminder">上次更新日期：<time data-testid="creator-weekly-update"
              dateTime={creatorRecentActivity(creator).latestPublishedAt??undefined}>
              {creatorPublishedDate(creatorRecentActivity(creator).latestPublishedAt)}</time></span></>:<>
        <span>{creatorRecentActivity(creator).status==='updated'?'最近七天有更新':'最近七天动态待核验'}</span>
        <span className="creator-weekly-divider" aria-hidden="true">·</span><span>上次更新 <time data-testid="creator-weekly-update"
          dateTime={creatorRecentActivity(creator).latestPublishedAt??undefined}>{creatorRecentActivity(creator).latestPublishedAt?creatorDateTime(creatorRecentActivity(creator).latestPublishedAt!):'—'}</time></span>
        </>}
      </p><small>按最近一次成功核验判断{creatorRecentActivity(creator).checkedAt?` · ${creatorDateTime(creatorRecentActivity(creator).checkedAt!)}`:''}</small>
        <small data-testid="creator-weekly-count">本周记录 {weekLabel}：{creator.activity?.weeklyUpdateCount??'待确认'} 条</small></div>
      {creator.activity?.baselineStatus==='missing'&&<div className="creator-anomaly-detail" data-testid="creator-baseline-missing"><strong>尚未建立本地作品基线</strong>
        <span>已保存博主资料，作品发布时间与发布间隔尚待核验。</span>
        <small>点击“核验并补齐”建立基线，通过后按发布间隔分组。</small></div>}
      {creator.activity?.anomaly&&<div className="creator-anomaly-detail" data-testid="creator-anomaly-detail"><strong>数据异常 · 待补齐</strong>
        <span>作品总数 {creator.activity.anomaly.comparison.previousCount} → {creator.activity.anomaly.comparison.currentCount}（{creator.activity.anomaly.comparison.increase>=0?'+':''}{creator.activity.anomaly.comparison.increase}）</span>
        <small>异常记录 · {creatorDateTime(creator.activity.anomaly.detectedAt)}</small>
        <span>该次采集新增作品 {creator.activity.anomaly.comparison.newPublicWorks} 条{!creator.activity.anomaly.comparison.connected?' · 与上次记录尚未衔接':''}</span>
        {creator.activity.anomaly.comparison.timeBaseline&&<small>仅统计发布时间晚于 {creatorDateTime(creator.activity.anomaly.comparison.timeBaseline)} 的作品</small>}
        <small>核验完成前保留上次有效的间隔与更新状态</small></div>}
      {!creator.isDemo&&<div className="creator-publication-interval" data-testid="creator-publication-interval"
        title="按本地已保存的公开作品发布时间计算平均相邻间隔，精确到小时；至少需要两条有效作品记录">
        <span>间隔天数：<strong data-testid="creator-publication-interval-value">{formatPublicationInterval((creator.activity?.recentBaseline?.interval??creator.activity?.publicationInterval)?.meanHours)}</strong></span>
        <small>{creator.activity?.recentBaseline?creator.activity.recentBaseline.version===2?`最新 ${creator.activity.recentBaseline.sampleCount} 条有效作品 · 不限制时间跨度${creator.activity.recentBaseline.stopReason==='list-end'?' · 列表已结束':''}`:`旧版最近 180 天 · 依据 ${creator.activity.recentBaseline.recentCount} 条作品 · 待按新规则补齐`:`依据 ${creator.activity?.publicationInterval?.workCount??0} 条已保存作品`}</small>
        {creator.activity?.recentBaseline?.version===2&&<>
          <small>样本覆盖 {creator.activity.recentBaseline.interval.earliestPublishedAt?.slice(0,10)??'—'} ～ {creator.activity.recentBaseline.interval.latestPublishedAt?.slice(0,10)??'—'}
            {creator.activity.recentBaseline.sampleQuality==='insufficient'?' · 少于 2 条，无法计算间隔':creator.activity.recentBaseline.sampleQuality==='limited'?' · 样本较少，判断把握有限':''}</small>
          <small>最近发布距采集 {creator.activity.recentBaseline.daysSinceLatest===null?'未知':`${Math.floor(creator.activity.recentBaseline.daysSinceLatest??0)} 天`} · {creator.activity.recentBaseline.recentCounts?.map(c=>`${c.days} 天${c.complete?'':'至少'} ${c.count} 条`).join(' ／ ')}</small>
          <small>上述发布数量截至 {creatorDateTime(creator.activity.recentBaseline.checkedAt)}；“至少”表示已读范围尚未覆盖完整时段</small>
        </>}
        {creator.activity?.recentBaseline&&<small>历史累计间隔 {formatPublicationInterval(creator.activity.publicationInterval?.meanHours)} · {creator.activity.publicationInterval?.workCount??0} 条</small>}
      </div>}
      {creator.activity?.workObservation&&<div className={`creator-time-observation${refreshedThisRun?' refreshed-this-run':''}`} data-testid="creator-time-observation">
        <div className="creator-observation-header"><span>最近采集结果 · <time dateTime={creator.activity.workObservation.checkedAt}>{creatorDateTime(creator.activity.workObservation.checkedAt)}</time></span>{refreshBadge}</div>
        <strong>{creator.activity.baselineStatus==='missing'?'采集记录保留 · 作品基线待核验':creator.activity.workObservation.timeBaseline?`${creator.activity.workObservation.newWorksComplete?'新增作品':'已读新增作品'} ${creator.activity.workObservation.newWorkIds.length} 条`:'已建立作品时间基线'}</strong>
        {creator.activity.workObservation.countChange!==null&&<span>主页作品总数 {creator.activity.workObservation.previousCount} → {creator.activity.workObservation.currentCount}（{creator.activity.workObservation.countChange>=0?'+':''}{creator.activity.workObservation.countChange}）</span>}
        {!!creator.activity.workObservation.historicalWorkIds.length&&<small>补充 {creator.activity.workObservation.historicalWorkIds.length} 条旧作品，不计入新发布</small>}
        {!!creator.activity.workObservation.invalidatedWorkIds.length&&<small>标记 {creator.activity.workObservation.invalidatedWorkIds.length} 条已失效，原记录保留</small>}
        {!!creator.activity.workObservation.restoredWorkIds.length&&<small>恢复可见 {creator.activity.workObservation.restoredWorkIds.length} 条历史记录</small>}
        {!creator.activity.workObservation.newWorksComplete&&creator.activity.workObservation.timeBaseline&&<small>数量为该次采集已读结果，时间范围尚未完整覆盖</small>}
        {ownerSecUid&&<CreatorWorkTimelinePanel owner={ownerSecUid} creatorId={creator.id} observation={creator.activity.workObservation} invalidCount={creator.activity.invalidWorkCount}/>}
      </div>}
      {!creator.isDemo&&<div className="creator-activity-check"><span>{creator.activity?.checkedAt?`检查于 ${creatorDateTime(creator.activity.checkedAt)}`:'尚未检查本周动态'}
        {creator.activity?.refreshCheck&&<small className="creator-refresh-unchanged" data-testid="creator-refresh-unchanged">未更新 · {creator.activity.refreshCheck.reason==='latest-unchanged'?'最新作品相同':'作品总数相同'}<br/>比对于 {creatorDateTime(creator.activity.refreshCheck.checkedAt)} · 动态沿用上次核验{creator.activity.refreshCheck.nativeUnavailableReason&&<><br/>仅按总数比对：{creator.activity.refreshCheck.nativeUnavailableReason}</>}</small>}
        {creator.activity?.refreshSchedule&&<small data-testid="creator-refresh-schedule">{CREATOR_TIER_LABELS[creator.activity.refreshSchedule.tier]} · {creator.activity.refreshSchedule.intervalDays===1?'每天':`每 ${creator.activity.refreshSchedule.intervalDays} 天`}检查
          {creator.activity.refreshSchedule.due?' · 已到期':` · 下次 ${creatorDateTime(creator.activity.refreshSchedule.nextDueAt!)}`}</small>}
        {!creator.activity?.workObservation&&refreshBadge}
        {creator.activity?.countCheckedAt&&creator.activity.countCheckedAt!==creator.activity.checkedAt&&<small>作品数截至 {creatorDateTime(creator.activity.countCheckedAt)}</small>}</span>
        {(creator.activity?.errorCode||creator.activity?.weeklyStatus==='partial'||creator.activity?.workCount===null)&&<small className="creator-activity-warning">{creator.activity?.workCount===null?'主页作品数待更新，已取得资料保留':creator.activity?.errorCode?.startsWith('PROFILE_')?'本次主页计数未取得，保留上次总数':creator.activity?.weeklyStatus==='partial'?'作品总数已保存，本周动态待确认':'本次动态刷新未完成，保留上次结果'}</small>}
        <button className="button ghost compact" data-testid="refresh-one-creator" title={creator.activity?.baselineStatus==='missing'?'读取主页作品数与发布时间，核验后建立本地作品基线':creatorNeedsVerification(creator)?'单独读取这位博主，连续补齐至旧记录或完整列表，核验通过后恢复分组':'立即完整核验这位博主，不受检查周期和跳过策略限制'} disabled={!canRefresh||running} onClick={()=>onRefresh(creator.id)}>{creatorNeedsVerification(creator)?'核验并补齐':'刷新'}</button>
      </div>}
      {editing ? <div className="note-editor"><textarea ref={noteInput} value={note} disabled={annotationSaving} onChange={(event) => setNote(event.target.value)} placeholder="例如：宏观金融观点清楚，但不看荐股内容。"/><div><button disabled={annotationSaving} onClick={() => setEditing(false)}>取消</button><button disabled={annotationSaving} onClick={async() => { if(await onUpdate(creator.id, { note }, '博主批注已保存'))setEditing(false) }}>{annotationSaving?'保存中':'保存批注'}</button></div></div> : <button className="creator-note" onClick={() => { setEditing(true); setNote(creator.note) }}>{creator.note || '＋ 添加我的批注'}</button>}
      <button className="button ghost creator-sync-works" data-testid="open-video-information" disabled={creator.isDemo||!ownerSecUid} onClick={()=>onOpenVideos(creator)}>视频信息</button>
    </article>
})

export default function CreatorsPage({ creators, allCreators, search, setSearch, onUpdate, onOpenVideos, activityState,canRefresh,singleRefreshSuccess,cardRefreshRun,onRefresh,onCancelRefresh,canSetPriority,prioritySavingKeys,onPriorityChange,ownerSecUid,focus,annotationSavingIds,onInterestChange,interestSavingKeys }: {
  ownerSecUid:string|null
  focus:{creatorId:number;revision:number}|null
  creators: CreatorListItem[]; allCreators:CreatorListItem[]; search: string; setSearch: (value: string) => void;
  onUpdate: (id: number, input: { isStarred?: boolean; note?: string }, success: string) => Promise<boolean>; onOpenVideos: (creator: CreatorListItem) => void;
  annotationSavingIds:number[]
  onInterestChange:(creator:CreatorListItem,tier:CreatorInterestTier|null)=>Promise<boolean>
  interestSavingKeys:string[]
  activityState:CreatorActivityState|null;canRefresh:boolean;onRefresh:(creatorId?:number,resume?:boolean,creatorIds?:number[],scope?:CreatorRefreshScope)=>void;onCancelRefresh:()=>void
  singleRefreshSuccess:{creatorId:number;attemptedAt:string}|null
  cardRefreshRun:CreatorCardRefreshRun|null
  canSetPriority:boolean;onPriorityChange:(creator:CreatorListItem,mode:CreatorPriorityMode|null)=>void
  prioritySavingKeys:string[]
}): JSX.Element {
  const [selected,setSelected]=useState<number[]>([])
  const sessions=useRef(new Map<number,CreatorCardSession>())
  const [activeSection,setActiveSection]=useState<CreatorSectionKey|null>(null)
  const [viewMode,setViewMode]=useState<CreatorViewMode>('activity')
  const [addingInterest,setAddingInterest]=useState<CreatorInterestTier|null>(null)
  const onSelect=useCallback((id:number,checked:boolean)=>setSelected(ids=>checked?[...ids,id]:ids.filter(value=>value!==id)),[])
  const updateCard=useEventCallback(onUpdate),openVideos=useEventCallback(onOpenVideos),refreshCard=useEventCallback(onRefresh)
  const priorityCard=useEventCallback(onPriorityChange)
  const interestCard=useEventCallback(onInterestChange)
  const activityCache=useRef(new WeakMap<CreatorListItem,{day:string|null;creator:CreatorListItem}>())
  const appliedFocus=useRef<number|null>(null)
  useEffect(()=>{
    if(!focus||appliedFocus.current===focus.revision)return
    const creator=allCreators.find(c=>c.id===focus.creatorId)
    if(!creator)return
    appliedFocus.current=focus.revision
    const tier=effectiveCreatorTier(creator)
    if(viewMode==='interest'&&creator.interest?.tier)setActiveSection(`interest-${creator.interest.tier}`)
    else{setViewMode('activity');setActiveSection(creatorNeedsVerification(creator)?'anomaly':tier==='unknown'?'dormant':tier)}
  },[focus,allCreators,viewMode])
  const [calendarDay, setCalendarDay] = useState(() => shanghaiDateKey())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refreshToday = (): void => {
      clearTimeout(timer)
      const now=Date.now(),day=86_400_000,offset=8*3_600_000
      setCalendarDay(shanghaiDateKey(now))
      const nextMidnight=(Math.floor((now+offset)/day)+1)*day-offset
      timer=setTimeout(refreshToday,Math.max(1,nextMidnight-now))
    }
    refreshToday()
    window.addEventListener('focus',refreshToday)
    document.addEventListener('visibilitychange',refreshToday)
    return () => {clearTimeout(timer);window.removeEventListener('focus',refreshToday);document.removeEventListener('visibilitychange',refreshToday)}
  }, [])
  const week=useMemo(()=>calendarWeek(),[calendarDay]),running=activityState?.phase==='running'
  const weekLabel=`${week.startDate.slice(5).replace('-','.')}～${week.endDate.slice(5).replace('-','.')}`
  const sections=useMemo(()=>{
    const result:Record<CreatorLibrarySection,CreatorListItem[]>={active:[],regular:[],inactive:[],dormant:[],anomaly:[]}
    const now=Date.now()
    for(const creator of creators){
      if(creator.isDemo)continue
      const tier=effectiveCreatorTier(creator)
      const cached=activityCache.current.get(creator)
      const current=cached?.day===calendarDay?cached.creator:currentCreatorActivity(creator,now)
      if(cached?.creator!==current||cached?.day!==calendarDay)activityCache.current.set(creator,{day:calendarDay,creator:current})
      result[creatorNeedsVerification(creator)?'anomaly':tier==='unknown'?'dormant':tier].push(current)
    }
    // Keep the directory order within each group of enabled/disabled manual priorities.
    for(const section of ['active','regular'] as const){
      result[section].sort((a,b)=>Number(!!b.refreshPriority?.mode)-Number(!!a.refreshPriority?.mode))
    }
    return result
  },[creators,calendarDay])
  const interestSections=useMemo(()=>{
    const result:Record<CreatorInterestSection,CreatorListItem[]>={'interest-high':[],'interest-medium':[],'interest-weak':[]}
    for(const creator of creators)if(!creator.isDemo&&creator.interest?.tier)result[`interest-${creator.interest.tier}`].push(activityCache.current.get(creator)?.creator??creator)
    return result
  },[creators,sections])
  const interestTier:CreatorInterestTier=activeSection==='interest-medium'?'medium':activeSection==='interest-weak'?'weak':'high'
  const interestRefreshIds=useMemo(()=>creatorsForRefreshScope(allCreators,'all').filter(creator=>creator.interest?.tier===interestTier).map(creator=>creator.id),[allCreators,interestTier])
  const visibleCreators=activeSection&&activeSection in sections?sections[activeSection as CreatorLibrarySection]:activeSection?interestSections[activeSection as CreatorInterestSection]:[]
  const selectedVisible=visibleCreators.filter(creator=>!creator.isDemo&&!creatorNeedsVerification(creator)&&selected.includes(creator.id)).map(creator=>creator.id)
  const refreshScope:CreatorRefreshScope|undefined=viewMode==='activity'?(activeSection==='dormant'?'all':activeSection as CreatorRefreshScope|undefined):undefined
  const realCreators=creators.filter(item=>!item.isDemo)
  const dueCount=realCreators.filter(item=>!item.activity?.refreshSchedule||item.activity.refreshSchedule.due).length
  const refreshCounts=useMemo(()=>({active:creatorsForRefreshScope(allCreators,'active').length,regular:creatorsForRefreshScope(allCreators,'regular').length,inactive:creatorsForRefreshScope(allCreators,'inactive').length,all:creatorsForRefreshScope(allCreators,'all').length,anomaly:creatorsForRefreshScope(allCreators,'anomaly').length}),[allCreators])
  const pendingCount=sections.dormant.filter(item=>effectiveCreatorTier(item)==='unknown').length
  const sectionMeta: Record<CreatorSectionKey,{title:string;description:string}> = {
    active:{title:'高频',description:'平均间隔 ≤7 天，且最近核验时七天内有更新；建议每天检查'},
    regular:{title:'中频',description:'最近核验时30天内有更新，平均间隔 >7～14 天；或间隔 ≤7 天但距上次更新 >7～30 天；建议每周检查'},
    inactive:{title:'低频',description:'平均间隔 >14～30 天；最近核验时已超过30天未更新的归极低频；建议每两周检查'},
    dormant:{title:'极低频',description:`平均间隔 >30 天，或最近核验时已超过30天未更新；建议每30天检查，包含在全量更新中${pendingCount?`；另有 ${pendingCount} 位待确认`:''}`},
    anomaly:{title:'异常',description:'作品数增加 ≥10 条、记录未能衔接，或尚未建立本地作品基线；可一键核验并补齐，通过后按发布间隔分组'},
    'interest-high':{title:'高',description:'仅展示手动添加为高兴趣度的博主，可随时调整或移出'},
    'interest-medium':{title:'中',description:'仅展示手动添加为中兴趣度的博主，可随时调整或移出'},
    'interest-weak':{title:'弱',description:'仅展示手动添加为弱兴趣度的博主，可随时调整或移出'}
  }
  const refreshedThisRun=(creator:CreatorListItem):boolean=>!!cardRefreshRun&&activityState?.runId===cardRefreshRun.runId
    &&cardRefreshRun.creatorIds.includes(creator.id)&&!activityState.remainingIds.includes(creator.id)
    &&!!activityState.startedAt&&!!creator.activity?.lastAttemptAt&&Date.parse(creator.activity.lastAttemptAt)>=Date.parse(activityState.startedAt)
    &&!creator.activity.errorCode&&!creatorNeedsVerification(creator)&&!creator.isDemo
  const renderSection = (key: CreatorSectionKey): JSX.Element => {
    const items=key in sections?sections[key as CreatorLibrarySection]:interestSections[key as CreatorInterestSection],meta=sectionMeta[key]
    return <section className={`creator-zone creator-zone-${key}`} data-testid={`creator-zone-${key}`} aria-labelledby={`creator-section-${key}`}>
      <div className="creator-zone-heading"><div><h2>{meta.title}</h2><small>{meta.description}</small></div><strong data-testid={`creator-zone-${key}-count`}>{items.length} 位</strong></div>
      {items.length?<VirtualCreatorGrid key={key} creators={items} sessions={sessions.current} focus={focus} renderCard={creator=><CreatorCard creator={creator} ownerSecUid={ownerSecUid}
        selected={selected.includes(creator.id)} saving={prioritySavingKeys.includes(ownerSecUid+':'+creator.profileUrl)}
        annotationSaving={annotationSavingIds.includes(creator.id)}
        interestSaving={interestSavingKeys.includes(ownerSecUid+':'+new URL(creator.profileUrl).pathname.split('/').at(-1))} onInterestChange={interestCard}
        running={running} canSetPriority={canSetPriority} canRefresh={canRefresh} weekLabel={weekLabel}
        refreshedThisRun={refreshedThisRun(creator)} singleRefreshSuccess={singleRefreshSuccess?.creatorId===creator.id&&singleRefreshSuccess.attemptedAt===creator.activity?.lastAttemptAt}
        onSelect={onSelect} onUpdate={updateCard} onOpenVideos={openVideos} onRefresh={refreshCard} onPriorityChange={priorityCard}/>}/>:<div className="creator-zone-empty">{search?'当前区域没有匹配的博主，可清空搜索或切换区域':key.startsWith('interest-')?'此分区尚未添加博主，点击“＋ 添加博主”开始添加':'当前区域暂无博主'}</div>}
    </section>
  }
  return <section className="page-section">
    <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="搜索博主、领域或你的批注"/><span className="result-count">{realCreators.length} 位博主</span></div>
    <div className="creator-activity-toolbar"><div><strong>本周动态 · {weekLabel}</strong><small>北京时间 · 周一至周日 · 作品数读取主页“作品”计数</small>
      <small data-testid="creator-refresh-due-summary">当前列表 {dueCount} 位到期，{realCreators.length-dueCount} 位未到期；分组更新包含未到期博主</small>
      <small data-testid="creator-refresh-scope-help">平均发布间隔：高频 ≤7 天 · 中频 ≤14 天 · 低频 ≤30 天 · 极低频 &gt;30 天；高频须七天内有更新；最近核验时超过30天未更新的优先归极低频</small>
      <small>加权／降权按当前等级逐档调整；点击“恢复自动”重新按发布间隔分类</small>
      <small>等级与颜色按最近一次成功核验判断；全量包含四档及待确认博主，异常博主须单独补齐</small>
      <small>每批 33 位 · 作者间隔 3～8 秒 · 批间休息 3～5 分钟；勾选刷新和单卡刷新可立即检查</small></div></div>
    {activityState&&activityState.phase!=='idle'&&<div className="creator-activity-progress" role="status" data-testid="creator-activity-progress"><span>{activityState.message}{activityState.currentName&&<> · <CreatorName name={activityState.currentName} profileUrl={activityState.currentSecUid?`https://www.douyin.com/user/${activityState.currentSecUid}`:undefined}/></>}</span>
      {running&&<progress max={activityState.total} value={activityState.done}/>}<small>{activityState.phase==='completed'&&activityState.displayedTotalMs!==undefined?`点击到资料显示 ${(activityState.displayedTotalMs/1000).toFixed(2)} 秒`:''}</small>
      {activityState.waiting&&<strong data-testid="creator-refresh-wait">{activityState.waiting.kind==='batch'?'批间休息':activityState.waiting.kind==='resume'?'恢复等待':'作者间隔'} · 第 {activityState.waiting.batchNumber}/{activityState.waiting.totalBatches} 批 · 预计 {creatorDateTime(activityState.waiting.until)} 继续</strong>}
      <CreatorActivityRecoveryStatus state={activityState}/>
      {activityState.mode&&<small>{activityState.scope&&`${CREATOR_REFRESH_SCOPE_LABELS[activityState.scope]} · `}本轮 {activityState.total} 位{activityState.mode==='due'&&!!activityState.notDueCount&&<> · 历史任务未到期跳过 {activityState.notDueCount} 位</>} · 未更新 {activityState.unchangedCount||0} 位 · 完整核验 {activityState.fullRefreshCount||0} 位</small>}
      {!!activityState.plannedWaitingMs&&<small>计划等待累计 {(activityState.plannedWaitingMs/60000).toFixed(1)} 分钟（包含在全程耗时内）</small>}
      {activityState.reusedNativePages!==undefined&&<small>已复用主页列表 {activityState.reusedNativePages} 页 · 额外列表请求 {activityState.activeListRequests||0} 次{activityState.unverifiedVisibilityCount?` · ${activityState.unverifiedVisibilityCount} 条作品状态待确认`:''}</small>}
      {activityState.requestAudit&&<small title="只统计本轮已连接标签的网络观察窗口；包含网页自身流量，不代表浏览器总请求数">{activityState.requestAudit.ownerVerificationSource==='native-network'?'已复用本轮账号响应 · ':''}主动账号核验 {activityState.requestAudit.ownerVerificationGets} 次 · 专用账号页加载 {activityState.requestAudit.accountPageNavigations} 次 · 作者主页加载 {activityState.requestAudit.authorHomepageNavigations} 次 · 观察到平台 GET {activityState.requestAudit.platformApiGetsObserved} 次</small>}
    </div>}
    {viewMode==='interest'&&<p className="creator-interest-help" data-testid="creator-interest-help">兴趣度采用手动添加：未添加的博主不进入这三个分区；调整兴趣度不会改变活跃度分组。</p>}
    <div className="creator-section-toolbar">
      <div className="creator-view-switch" role="group" aria-label="博主分组大类">
        <button type="button" data-testid="creator-view-activity" aria-pressed={viewMode==='activity'} onClick={()=>{setViewMode('activity');setActiveSection('active')}}>活跃度分组</button>
        <button type="button" data-testid="creator-view-interest" aria-pressed={viewMode==='interest'} onClick={()=>{setViewMode('interest');setActiveSection('interest-high')}}>兴趣度分组</button>
      </div>
      <div className="creator-section-switch" role="group" aria-label={viewMode==='activity'?'活跃度区域':'兴趣度区域'}>
        {(viewMode==='activity'?(['active','regular','inactive','dormant'] as const):(['interest-high','interest-medium','interest-weak'] as const)).map(key=><button type="button" key={key} id={`creator-section-${key}`} data-testid={`creator-section-${key}`}
          aria-pressed={activeSection===key} aria-controls="creator-section-content" onClick={()=>setActiveSection(key)}>
          {sectionMeta[key].title}<span>{key in sections?sections[key as CreatorLibrarySection].length:interestSections[key as CreatorInterestSection].length}</span>
        </button>)}
      </div>
      {viewMode==='activity'&&refreshScope&&<button className="button primary creator-section-refresh" data-testid={refreshScope==='all'?'refresh-creator-activity':`refresh-${refreshScope}-creators`}
        title={refreshScope==='anomaly'?'依次核验当前账号全部异常博主，连续补齐至旧记录或完整列表；不受搜索影响，可取消并继续剩余':`${refreshScope==='all'?'更新当前账号四档及待确认博主，异常在异常分组处理':`更新当前账号当前生效等级为${CREATOR_TIER_LABELS[refreshScope]}的博主，含手动权重`}；包含未到期博主，不受搜索影响`}
        disabled={!canRefresh||running||!refreshCounts[refreshScope]} onClick={()=>onRefresh(undefined,false,undefined,refreshScope)}>
        {CREATOR_REFRESH_SCOPE_LABELS[refreshScope]}<span className="creator-refresh-button-count">{refreshCounts[refreshScope]}</span>
      </button>}
      {viewMode==='interest'&&<><button type="button" className="button ghost" data-testid="add-interest-creators" disabled={!ownerSecUid} onClick={()=>setAddingInterest(interestTier)}>＋ 添加博主</button>
        <button className="button primary creator-section-refresh" data-testid={`refresh-interest-${interestTier}`} disabled={!canRefresh||running||!interestRefreshIds.length}
          title="刷新本分区已添加且基线正常的博主，包含未到期博主，不受搜索影响；异常博主请在卡片上单独核验并补齐" onClick={()=>onRefresh(undefined,false,interestRefreshIds)}>刷新 {CREATOR_INTEREST_LABELS[interestTier]}兴趣度<span className="creator-refresh-button-count">{interestRefreshIds.length}</span></button></>}
      <div className="creator-section-actions">
        {running?<button className="button ghost" onClick={onCancelRefresh}>取消刷新</button>:<>
          {!!activityState?.remainingIds.length&&<button className="button ghost" disabled={!canRefresh} onClick={()=>onRefresh(undefined,true)}>继续剩余 {activityState.remainingIds.length} 位</button>}
          {!!selectedVisible.length&&<button className="button ghost" data-testid="refresh-selected-creators" disabled={!canRefresh} onClick={()=>onRefresh(undefined,false,selectedVisible)}>更新所选 {selectedVisible.length} 位</button>}
        </>}
      </div>
      {viewMode==='activity'&&<button type="button" className="creator-anomaly-switch" id="creator-section-anomaly" data-testid="creator-section-anomaly" aria-pressed={activeSection==='anomaly'} aria-controls="creator-section-content" onClick={()=>setActiveSection('anomaly')}>异常<span>{sections.anomaly.length}</span></button>}
    </div>
    <div id="creator-section-content">{activeSection?renderSection(activeSection):<div className="creator-zone-empty">点击上方切换活跃度或兴趣度分组</div>}</div>
    {addingInterest&&ownerSecUid&&<CreatorInterestPicker creators={allCreators} tier={addingInterest} ownerSecUid={ownerSecUid} savingKeys={interestSavingKeys} onChange={interestCard} onClose={()=>setAddingInterest(null)}/>}
  </section>
}
