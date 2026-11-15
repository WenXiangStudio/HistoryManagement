import CreatorsPage,{type CreatorCardRefreshRun} from './CreatorsPage'
import {Icon,Avatar,SearchBox,useEventCallback} from './ui'
import { Activity, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { AppSettings, CreatorListItem, DashboardSummary, DemoDataSummary, InboxItem, IsolatedPilotCatalog, IsolatedPilotState } from '../../shared/contracts'
import { STRUCTURED_SYNC_AVAILABLE } from '../../shared/featureFlags'
import { R7_CONTRACT_ONLY_UI_STATE } from '../../shared/r7EvidenceContracts'
import type { FollowingSyncState,FollowingConfiguration } from '../../shared/followingDirectory'
import type { CreatorActivityState } from '../../shared/creatorActivity'
import CreatorDatabasePage from './CreatorDatabasePage'
import {creatorsForRefreshScope,creatorNeedsVerification,effectiveCreatorTier,creatorRecentActivity,CREATOR_REFRESH_SCOPE_LABELS,type CreatorRefreshScope} from '../../shared/creatorRefreshPolicy'
import {CREATOR_TIER_LABELS,creatorPriorityBusyReason,creatorPriorityChangedSchema,applyCreatorPriorityChange,withCreatorPriority,type CreatorPriorityChanged,type CreatorPriorityMode} from '../../shared/creatorPriority'
import CreatorName,{CreatorNameProvider,CreatorNameOption,useCreatorNameAppearance,creatorNameClass} from './CreatorName'
import VideoInformationPage from './VideoInformationPage'
import InformationWorkshopPage from './InformationWorkshopPage'
import {CreatorBaselineTaskPanel} from './CreatorBaselineTaskPanel'
import MaterialInbox from './MaterialInbox'
import DoubaoSpeechSettings from './DoubaoSpeechSettings'
import SiliconFlowSettings from './SiliconFlowSettings'
import CloudConnectionTest from './CloudConnectionTest'
import {CLOUD_SETTING_KEYS} from '../../shared/cloudProfiles'
import {reconcileCreatorList} from './creatorListState'
import {RefreshQueue} from './refreshQueue'
import {creatorAnnotationChangedSchema,applyCreatorAnnotation,withCreatorAnnotation,type CreatorAnnotationChanged} from '../../shared/creatorAnnotation'
import {creatorInterestChangedSchema,applyCreatorInterestChange,withCreatorInterest,CREATOR_INTEREST_LABELS,type CreatorInterestChanged,type CreatorInterestTier} from '../../shared/creatorInterest'


type Route = 'inbox' | 'creators' | 'creator-database' | 'videos' | 'workshop' | 'jobs' | 'settings'
type CreatorLibrarySection = 'active' | 'regular' | 'inactive' | 'dormant' | 'anomaly'
type Job = {
  id: number
  kind: string
  state: string
  progress: number
  status_message: string
  error_message: string | null
  created_at: string
  updated_at: string
  payload: Record<string, unknown>
  resumable: boolean
}

const EMPTY_SUMMARY: DashboardSummary = {
  followingCount: 0, workCount: 0, unreadCount: 0, commentCount: 0,
  analyzedCount: 0, queuedJobs: 0, connectorOnline: false, lastSyncAt: null
}


function formatNumber(value: number | null): string {
  if (value === null) return '不可见'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return new Intl.NumberFormat('zh-CN').format(value)
}

function relativeTime(value: string | null): string {
  if (!value) return '时间未知'
  const hours = Math.max(0, (Date.now() - Date.parse(value)) / 3_600_000)
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟前`
  if (hours < 24) return `${Math.round(hours)} 小时前`
  if (hours < 24 * 7) return `${Math.round(hours / 24)} 天前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function exactTime(value: unknown): string {
  if (!value) return '页面未提供'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(date)
}

function routeTitle(route: Route): { eyebrow: string; title: string; description: string } {
  return {
    inbox: { eyebrow: 'DAILY SIGNALS', title: '今日内容收件箱', description: '查看感兴趣素材的完整文案与正文研究报告。' },
    creators: { eyebrow: 'CREATOR LIBRARY', title: '关注博主资料库', description: '按领域、批注和作品画像重新认识你的关注列表。' },
    'creator-database':{eyebrow:'CREATOR DATABASE',title:'博主数据库',description:'整理博主资料，通过图表查看发布间隔与人数分布。'},
    videos:{eyebrow:'VIDEO LIBRARY',title:'视频信息',description:'按日期汇集作品，先了解内容，再决定哪些值得观看。'},
    workshop:{eyebrow:'VIDEO WORKSHOP',title:'视频工坊',description:'从一条抖音链接开始，整理按时间对齐的图文分析与总结。'},
    jobs: { eyebrow: 'LOCAL PIPELINE', title: '同步与处理队列', description: '每一步都可暂停、续跑，并保留明确的失败原因。' },
    settings: { eyebrow: 'PRIVATE BY DEFAULT', title: '设置与数据边界', description: '媒体留在本机，云端调用逐批确认。' }
  }[route]
}

function followingStatusMessage(state:FollowingSyncState):string{
  if(state.phase==='blocked'&&/Detached while handling command|not attached to.*target|debugger.*detach/i.test(state.errorCode??state.message))
    return '浏览器读取连接中断，本轮关注清单尚未完成；已保存资料保留，可点击“继续关注清单”。'
  return state.message
}

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('inbox')
  const [databaseVisited,setDatabaseVisited]=useState(false)
  const [videosVisited,setVideosVisited]=useState(false)
  const [workshopVisited,setWorkshopVisited]=useState(false)
  const [workshopFocus,setWorkshopFocus]=useState<{workId:string;revision:number;ownerSecUid:string|null}|null>(null)
  const [videoFocus,setVideoFocus]=useState<{creatorId:number;revision:number;ownerSecUid:string|null}|null>(null)
  const [creatorFocus,setCreatorFocus]=useState<{creatorId:number;revision:number;ownerSecUid:string|null}|null>(null)
  const [databaseEditing,setDatabaseEditing]=useState(false)
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [materialUnread,setMaterialUnread]=useState(0)
  const [materialCount,setMaterialCount]=useState(0)
  const [allCreators,setAllCreators]=useState<CreatorListItem[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [inboxSearch, setInboxSearch] = useState('')
  const [creatorSearch, setCreatorSearch] = useState('')
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState('')
  const [debouncedCreatorSearch, setDebouncedCreatorSearch] = useState('')
  const creators=useMemo(()=>{
    const query=debouncedCreatorSearch.normalize('NFKC').trim().toLocaleLowerCase()
    return query?allCreators.filter(creator=>`${creator.nickname} ${creator.signature} ${creator.note}`.normalize('NFKC').toLocaleLowerCase().includes(query)):allCreators
  },[allCreators,debouncedCreatorSearch])
  const [inboxFilter, setInboxFilter] = useState('unread')
  const [selectedWork, setSelectedWork] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const prioritySaving=useRef(new Set<string>())
  const [prioritySavingKeys,setPrioritySavingKeys]=useState<string[]>([])
  const priorityConfirmed=useRef(new Map<string,CreatorPriorityChanged>())
  const priorityOwner=useRef<string|null>(null)
  const refreshPending=useRef(0)
  const refreshQueue=useRef(new RefreshQueue())
  const annotationConfirmed=useRef(new Map<string,CreatorAnnotationChanged>())
  const interestConfirmed=useRef(new Map<string,CreatorInterestChanged>())
  const interestSaving=useRef(new Set<string>())
  const [interestSavingKeys,setInterestSavingKeys]=useState<string[]>([])
  const annotationSaving=useRef(new Set<number>())
  const [annotationSavingIds,setAnnotationSavingIds]=useState<number[]>([])
  const [toast, setToast] = useState<ReactNode>(null)
  const [cloudEstimate, setCloudEstimate] = useState<Record<string, unknown> | null>(null)
  const [demoClearSummary, setDemoClearSummary] = useState<DemoDataSummary | null>(null)
  const [followingState, setFollowingState] = useState<FollowingSyncState | null>(null)
  const [followingConfiguration,setFollowingConfiguration]=useState<FollowingConfiguration|null>(null)
  const [activityRefreshRequest,setActivityRefreshRequest]=useState<{runId:string;creatorId?:number;nickname?:string;profileUrl?:string}|null>(null)
  const [singleRefreshSuccess,setSingleRefreshSuccess]=useState<{creatorId:number;attemptedAt:string}|null>(null)
  const [cardRefreshRun,setCardRefreshRun]=useState<CreatorCardRefreshRun|null>(null)
  priorityOwner.current=followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid??null
  const applyPriorityChange=useCallback((input:unknown):boolean=>{
    const interest=creatorInterestChangedSchema.safeParse(input)
    if(interest.success){
      const event=interest.data,owner=priorityOwner.current,key=owner+':'+event.secUid
      if(owner!==event.ownerSecUid||(interestConfirmed.current.get(key)?.interest.revision??-1)>=event.interest.revision)return true
      interestConfirmed.current.set(key,event)
      setAllCreators(current=>applyCreatorInterestChange(current,owner,event));return true
    }
    const annotation=creatorAnnotationChangedSchema.safeParse(input)
    if(annotation.success){
      const event=annotation.data,owner=priorityOwner.current,key=owner+':'+event.secUid
      if(owner!==event.ownerSecUid||(annotationConfirmed.current.get(key)?.revision??0)>=event.revision)return true
      annotationConfirmed.current.set(key,event)
      setAllCreators(current=>applyCreatorAnnotation(current,owner,event));return true
    }
    const parsed=creatorPriorityChangedSchema.safeParse(input)
    if(!parsed.success)return false
    const event=parsed.data,owner=priorityOwner.current
    if(owner!==event.ownerSecUid)return true
    const key=owner+':'+event.secUid,previous=priorityConfirmed.current.get(key)
    if(previous&&previous.priority.revision>=event.priority.revision)return true
    priorityConfirmed.current.set(key,event)
    setAllCreators(current=>applyCreatorPriorityChange(current,owner,event))
    return true
  },[])

  const [worksConfirmCreator, setWorksConfirmCreator] = useState<CreatorListItem | null>(null)
  const [isolatedCatalog, setIsolatedCatalog] = useState<IsolatedPilotCatalog | null>(null)
  const [isolatedPilotState, setIsolatedPilotState] = useState<IsolatedPilotState | null>(null)
  const [workerStatus, setWorkerStatus] = useState<Record<string, unknown> | null>(null)
  const [workerProgress, setWorkerProgress] = useState('')
  const refreshSequence = useRef(0)
  const displayedFollowingRun = useRef<string | null>(null)
  const timedFollowingRun=useRef<string|null>(null)
  const notifiedPreparation=useRef<string|null>(null)
  const displayedActivityRun=useRef<string|null>(null)
  const notifiedActivityRun=useRef<string|null>(null)
  useEffect(()=>{
    const activity=followingState?.activity
    if(!activityRefreshRequest||activity?.runId!==activityRefreshRequest.runId||activity.phase==='running'
      ||activity.phase==='idle'||notifiedActivityRun.current===activity.runId)return
    if(activity.phase==='completed'&&activity.total>0&&activity.succeeded===activity.total&&activity.failed===0){
      const creator=creators.find(item=>item.id===activityRefreshRequest.creatorId)
      // A status event can arrive before the corresponding creator read completes.
      if(creator&&activity.startedAt&&(!creator.activity?.lastAttemptAt
        ||Date.parse(creator.activity.lastAttemptAt)<Date.parse(activity.startedAt)))return
      notifiedActivityRun.current=activity.runId
      const noUpdates=creator?creatorRecentActivity(creator).status==='empty':false
      setToast(activityRefreshRequest.creatorId!==undefined
        ?<><CreatorName name={activityRefreshRequest.nickname||'博主'} profileUrl={activityRefreshRequest.profileUrl}/>{creator?.activity?.anomaly?'已检查 · 数据异常，待核验补齐':creator?.activity?.baselineStatus==='missing'?'已检查 · 待核验并补齐基线':`刷新成功${noUpdates?' · 最近七天暂无更新':''}`}</>
        :activity.repair?`核验并补齐完成，${activity.succeeded} 位博主核验通过`:activity.anomalyCount?`已检查 ${activity.succeeded} 位，${activity.anomalyCount} 位数据异常，需核验并补齐`:`刷新成功，已更新 ${activity.succeeded} 位博主资料${activity.unchangedCount?`，${activity.unchangedCount} 位未更新`:''}`)
      if(creator?.activity?.lastAttemptAt&&!creator.activity.errorCode&&!creatorNeedsVerification(creator)){
        setSingleRefreshSuccess({creatorId:creator.id,attemptedAt:creator.activity.lastAttemptAt})
      }
    }else{
      notifiedActivityRun.current=activity.runId
      setToast(activity.phase==='completed'?(activity.repair?`核验并补齐结束，${activity.succeeded} 位通过，${activity.failed} 位未完成`:`刷新结束，${activity.succeeded} 位成功，${activity.failed} 位资料待补齐`):activity.message)
    }
  },[followingState?.activity,activityRefreshRequest,creators])
  useEffect(()=>{
    const activity=followingState?.activity
    if((route!=='creators'&&!(route==='jobs'&&activity?.baselineTask))||activity?.phase!=='completed'||!activity.runId||displayedActivityRun.current===activity.runId)return
    const frame=requestAnimationFrame(()=>{
      displayedActivityRun.current=activity.runId
      void window.signalDesk.ackCreatorActivityRendered(activity.runId!)
    })
    return()=>cancelAnimationFrame(frame)
  },[route,followingState?.activity,creators])
  useEffect(()=>{
    const readiness=followingState?.readiness
    if(!readiness||!['ready','blocked'].includes(readiness.phase))return
    const key=`${readiness.preparationId}:${readiness.phase}:${readiness.code||''}`
    if(notifiedPreparation.current===key)return
    notifiedPreparation.current=key;setToast(readiness.message)
  },[followingState?.readiness])

  useEffect(() => {
    if (followingState?.phase !== 'completed' || displayedFollowingRun.current === followingState.runId) return
    displayedFollowingRun.current = followingState.runId
    setCreatorSearch('')
    setRoute(current=>current==='creator-database'||current==='videos'||current==='workshop'?current:'creators')
  }, [followingState])

  useEffect(()=>{
    if(route!=='creators'||followingState?.phase!=='completed'||!followingState.runId||!followingState.timing
      ||timedFollowingRun.current===followingState.runId||debouncedCreatorSearch||creators.filter(item=>!item.isDemo).length!==followingState.totalCount)return
    const runId=followingState.runId,total=creators.filter(item=>!item.isDemo).length
    let disposed=false
    // Cards are opened by section; preload saved avatars without mounting hidden cards.
    const images=creators.filter(item=>!item.isDemo&&item.avatarUrl).map(creator=>{
      const image=new Image();image.src=creator.avatarUrl!;return image
    })
    const check=():void=>{
      if(disposed||timedFollowingRun.current===runId||images.some(image=>!image.complete||!image.naturalWidth))return
      timedFollowingRun.current=runId
      void window.signalDesk.ackFollowingRendered(runId,total).then(state=>{if(!disposed)setFollowingState(state)})
    }
    const frame=requestAnimationFrame(check)
    images.forEach(image=>image.addEventListener('load',check))
    return ()=>{disposed=true;cancelAnimationFrame(frame);images.forEach(image=>image.removeEventListener('load',check))}
  },[route,followingState,creators,debouncedCreatorSearch])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInboxSearch(inboxSearch), 220)
    return () => clearTimeout(timer)
  }, [inboxSearch])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCreatorSearch(creatorSearch), 220)
    return () => clearTimeout(timer)
  }, [creatorSearch])

  const refresh = useCallback(() => {
    const sequence = ++refreshSequence.current
    return refreshQueue.current.request(async()=>{
    const annotationsAtRead=new Map(annotationConfirmed.current)
    const interestsAtRead=new Map(interestConfirmed.current)
    refreshPending.current++
    try{
    const [nextSummary, nextInbox, nextCreators, nextJobs, nextSettings, nextFollowingState,nextFollowingConfiguration] = await Promise.all([
      window.signalDesk.getDashboard(),
      window.signalDesk.listInbox({ state: inboxFilter, search: debouncedInboxSearch, limit: 200 }),
      window.signalDesk.listCreators(),
      window.signalDesk.listJobs(),
      window.signalDesk.getSettings(),
      window.signalDesk.getFollowingSyncStatus(),
      window.signalDesk.getFollowingConfiguration()
    ])
    if (sequence !== refreshSequence.current) return
    const nextOwner=nextFollowingConfiguration?.activeOwnerSecUid??nextFollowingState?.ownerSecUid??null
    const confirmed=(rows:CreatorListItem[])=>rows.map(creator=>{
      const event=priorityConfirmed.current.get(nextOwner+':'+new URL(creator.profileUrl).pathname.split('/').at(-1))
      const priority=event&&!creator.isDemo?withCreatorPriority(creator,event.priority):creator
      const annotationKey=nextOwner+':'+new URL(creator.profileUrl).pathname.split('/').at(-1)
      const annotation=annotationConfirmed.current.get(annotationKey)
      const annotated=annotation&&!creator.isDemo&&annotation.revision>(annotationsAtRead.get(annotationKey)?.revision??0)
        ?withCreatorAnnotation(priority,annotation):priority
      const interest=interestConfirmed.current.get(annotationKey)
      return interest&&!creator.isDemo&&interest.interest.revision>(interestsAtRead.get(annotationKey)?.interest.revision??-1)
        ?withCreatorInterest(annotated,interest.interest):annotated
    })
    setSummary(nextSummary)
    setInbox(nextInbox)
    setAllCreators(previous=>reconcileCreatorList(previous,confirmed(nextCreators)))
    setJobs(nextJobs)
    setSettings(nextSettings)
    setFollowingState(nextFollowingState)
    setFollowingConfiguration(nextFollowingConfiguration)
    }finally{refreshPending.current--}
    })
  }, [debouncedInboxSearch, inboxFilter])

  const pollStatus=useEventCallback(async()=>{
    // Idle polling must not repeatedly read/decorate the complete creator library.
    // Data-change events, searches and foregrounding still request a full snapshot.
    if(refreshPending.current)return
    const sequence=refreshSequence.current
    const [nextSummary,nextJobs,nextState]=await Promise.all([
      window.signalDesk.getDashboard(),window.signalDesk.listJobs(),window.signalDesk.getFollowingSyncStatus()
    ])
    if(sequence!==refreshSequence.current||refreshPending.current)return
    const collecting=(state:FollowingSyncState|null)=>!!state&&(['running','awaiting-config'].includes(state.phase)
      ||state.basic?.phase==='running'||state.activity?.phase==='running'||state.videoInformation?.phase==='running')
    if(collecting(followingState)||collecting(nextState)||nextJobs.some((job:Job)=>job.state==='running')
      ||followingState?.ownerSecUid!==nextState?.ownerSecUid||followingState?.activity?.runId!==nextState?.activity?.runId){await refresh();return}
    setSummary(nextSummary);setJobs(nextJobs);setFollowingState(nextState)
  })

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void pollStatus(), 5_000)
    const remove = window.signalDesk.onDataChanged(event=>{if(!applyPriorityChange(event))void refresh()})
    const foreground=()=>{void refresh()}
    window.addEventListener('focus',foreground)
    return () => { clearInterval(timer); remove();window.removeEventListener('focus',foreground) }
  }, [refresh,applyPriorityChange,pollStatus])

  useEffect(() => window.signalDesk.onWorkerSetupProgress((event) => setWorkerProgress(event.message)), [])

  useEffect(() => {
    if (route !== 'jobs') return
    let active = true
    const update = async (): Promise<void> => {
      try {
        const [catalog, state] = await Promise.all([
          window.signalDesk.getIsolatedPilotCatalog(), window.signalDesk.getIsolatedPilotStatus()
        ])
        if (active) { setIsolatedCatalog(catalog); setIsolatedPilotState(state) }
      } catch (error) {
        if (active) setToast(error instanceof Error ? error.message : String(error))
      }
    }
    void update()
    const timer = setInterval(() => void update(), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [route])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3_500)
    return () => clearTimeout(timer)
  }, [toast])

  const runAction = async (action: () => Promise<unknown>, success: ReactNode): Promise<void> => {
    setBusy(true)
    try {
      await action()
      setToast(success)
      await refresh()
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const refreshCreatorActivity=async(creatorId?:number,resume=false,creatorIds?:number[],scope?:CreatorRefreshScope):Promise<void>=>{
    setBusy(true)
    setActivityRefreshRequest(null)
    setSingleRefreshSuccess(null)
    setCardRefreshRun(null)
    try{
      const next:FollowingSyncState=scope?await window.signalDesk.refreshCreatorActivity(creatorId,resume,creatorIds,scope):await window.signalDesk.refreshCreatorActivity(creatorId,resume,creatorIds)
      if(!next?.activity?.runId){
        if(next?.activity?.phase==='completed'&&next.activity.total===0){setFollowingState(next);setToast(next.activity.message);await refresh();return}
        throw new Error('资料刷新未能启动，请重新尝试')
      }
      setFollowingState(next)
      setCardRefreshRun({ownerSecUid:followingConfiguration?.activeOwnerSecUid??next.ownerSecUid??null,
        runId:next.activity.runId,creatorIds:[...next.activity.remainingIds]})
      const requested=creators.find(item=>item.id===creatorId)
      setActivityRefreshRequest({runId:next.activity.runId,creatorId,nickname:requested?.nickname,profileUrl:requested?.profileUrl})
      setToast(scope==='anomaly'?'正在依次核验并补齐异常博主':`${scope?CREATOR_REFRESH_SCOPE_LABELS[scope]+' · ':''}正在更新作品总数与本周动态`)
      await refresh()
    }catch(error){
      setToast(error instanceof Error?error.message:String(error))
    }finally{
      setBusy(false)
    }
  }

  const changeCreatorPriority=useEventCallback(async(creator:CreatorListItem,mode:CreatorPriorityMode|null):Promise<void>=>{
    const owner=followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid
    if(!owner){setToast('请先绑定当前资料账号');return}
    const key=owner+':'+creator.profileUrl
    if(prioritySaving.current.has(key))return
    prioritySaving.current.add(key);setPrioritySavingKeys([...prioritySaving.current])
    try{
      const secUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!
      const priority=await window.signalDesk.updateCreatorPriority({ownerSecUid:owner,secUid,mode,revision:creator.refreshPriority?.revision??0})
      applyPriorityChange({source:'creator-priority',ownerSecUid:owner,secUid,priority})
      if(priorityOwner.current!==owner)return
      setToast(<><CreatorName name={creator.nickname} profileUrl={creator.profileUrl}/>{priority.mode?`已${priority.mode==='boost'?'加权':'降权'}，当前按${CREATOR_TIER_LABELS[priority.tier!]}分组更新`:'已关闭手动权重，恢复自动分类'}</>)
    }catch(error){if(priorityOwner.current===owner){setToast(error instanceof Error?error.message:String(error));void refresh()}}
    finally{prioritySaving.current.delete(key);setPrioritySavingKeys([...prioritySaving.current])}
  })
  const changeCreatorInterest=useEventCallback(async(creator:CreatorListItem,tier:CreatorInterestTier|null):Promise<boolean>=>{
    const owner=priorityOwner.current
    if(!owner){setToast('请先绑定当前资料账号');return false}
    const secUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!,key=owner+':'+secUid
    if(interestSaving.current.has(key))return false
    interestSaving.current.add(key);setInterestSavingKeys([...interestSaving.current])
    try{
      const interest=await window.signalDesk.updateCreatorInterest({ownerSecUid:owner,secUid,tier,revision:creator.interest?.revision??0})
      applyPriorityChange({source:'creator-interest',ownerSecUid:owner,secUid,interest})
      if(priorityOwner.current!==owner)return false
      setToast(tier?`已加入${CREATOR_INTEREST_LABELS[tier]}兴趣度分区`:'已从兴趣度分组移出');return true
    }catch(error){if(priorityOwner.current===owner){setToast(error instanceof Error?error.message:String(error));void refresh()}return false}
    finally{interestSaving.current.delete(key);setInterestSavingKeys([...interestSaving.current])}
  })
  const changeCreatorAnnotation=useEventCallback(async(id:number,input:{isStarred?:boolean;note?:string},success:string):Promise<boolean>=>{
    const owner=priorityOwner.current
    if(annotationSaving.current.has(id))return false
    annotationSaving.current.add(id);setAnnotationSavingIds([...annotationSaving.current])
    try{
      const event=await window.signalDesk.updateCreator(id,input,owner??undefined)
      if(priorityOwner.current!==owner)return false
      if(!applyPriorityChange(event))await refresh()
      setToast(success);return true
    }catch(error){if(priorityOwner.current===owner)setToast(error instanceof Error?error.message:String(error));return false}
    finally{annotationSaving.current.delete(id);setAnnotationSavingIds([...annotationSaving.current])}
  })

  const openWork = async (id: number): Promise<void> => {
    const detail = await window.signalDesk.getWork(id)
    setSelectedWork(detail)
    await window.signalDesk.updateInbox(id, 'read', 0)
    await refresh()
  }

  const prepareDemoClear = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.signalDesk.getDemoSummary()
      if (!next.creatorCount && !next.workCount) {
        setToast('当前没有需要清理的演示资料')
        return
      }
      setDemoClearSummary(next)
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const header = routeTitle(route)
  const navigate=(next:Route):void=>{if(route==='creator-database'&&databaseEditing&&next!==route){setToast('请先保存或取消正在编辑的内容');return}if(next==='creator-database')setDatabaseVisited(true);if(next==='videos')setVideosVisited(true);if(next==='workshop')setWorkshopVisited(true);setRoute(next)}
  const openCreatorVideos=(creator:CreatorListItem):void=>{setVideoFocus(previous=>({creatorId:creator.id,revision:(previous?.revision??0)+1,ownerSecUid}));navigate('videos')}
  const openVideoCreator=(creator:CreatorListItem):void=>{setCreatorSearch(creator.nickname);setCreatorFocus(previous=>({creatorId:creator.id,revision:(previous?.revision??0)+1,ownerSecUid}));navigate('creators')}
  const ownerSecUid=followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid??null
  const openInformationWorkshop=(workId:string):void=>{setWorkshopFocus(previous=>({workId,revision:(previous?.revision??0)+1,ownerSecUid}));navigate('workshop');void refresh()}
  useEffect(()=>{
    if(route!=='creators'||cardRefreshRun&&cardRefreshRun.ownerSecUid!==ownerSecUid)setCardRefreshRun(null)
  },[route,ownerSecUid,cardRefreshRun])
  const showFollowingPanels=route!=='creator-database'&&route!=='videos'&&route!=='workshop'
  const hasData = summary.workCount > 0 || summary.followingCount > 0

  return (
    <CreatorNameProvider owner={followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid??null} creators={allCreators}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>S</span><span>D</span></div>
          <div><strong>Signal Desk</strong><small>个人内容情报台</small></div>
        </div>
        <nav>
          <NavItem active={route === 'inbox'} icon="inbox" label="今日收件箱" badge={summary.unreadCount+materialUnread} onClick={() => navigate('inbox')} />
          <NavItem active={route === 'creators'} icon="people" label="博主资料库" badge={summary.followingCount} onClick={() => navigate('creators')} />
          <NavItem active={route === 'creator-database'} icon="database" label="博主数据库" onClick={() => navigate('creator-database')} />
          <NavItem active={route === 'videos'} icon="video" label="视频信息" onClick={() => navigate('videos')} />
          <NavItem active={route === 'workshop'} icon="workshop" label="视频工坊" onClick={() => {setWorkshopFocus(null);navigate('workshop')}} />
          <NavItem active={route === 'jobs'} icon="queue" label="任务中心" badge={summary.queuedJobs+Number(followingState?.activity?.phase==='running'&&!!followingState.activity.baselineTask)} onClick={() => navigate('jobs')} />
          <div className="nav-spacer" />
          <NavItem active={route === 'settings'} icon="settings" label="设置" onClick={() => navigate('settings')} />
        </nav>
        <div className="connector-card">
          <span className={`presence ${followingState?.connection?.online || summary.connectorOnline ? 'online' : ''}`} />
          <div><strong>{followingState?.connection?.online ? '关注连接器已连接' : summary.connectorOnline ? '浏览器已连接' : '等待浏览器连接'}</strong><small>{summary.lastSyncAt ? `同步于 ${relativeTime(summary.lastSyncAt)}` : '尚未同步真实账号'}</small></div>
        </div>
        <div className="local-note"><Icon name="database" size={17}/><span>数据保存在这台电脑</span></div>
      </aside>

      <main className={`workspace${route==='videos'||route==='workshop'?' workspace-videos':''}`}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{header.eyebrow}</p>
            <h1>{header.title}</h1>
            <p className="subtitle">{header.description}</p>
          </div>
          <div className="header-actions" style={!showFollowingPanels?{display:'none'}:undefined}>
            <button className="button ghost" onClick={() => void runAction(() => window.signalDesk.exportAll(true), '资料库已导出')} disabled={busy || !hasData}><Icon name="download" size={18}/>导出</button>
            {followingState?.plan?.resumable&&<button className="button ghost" onClick={()=>void runAction(()=>window.signalDesk.refreshFollowing(true),'正在继续未完成的关注清单')} disabled={busy||!followingState.connection?.online||followingState.basic?.phase==='running'||followingState.activity?.phase==='running'}>继续关注清单</button>}
            <button className="button primary" data-testid="start-following-sync" onClick={() => void runAction(() => window.signalDesk.refreshFollowing(), '正在同步完整关注清单')} disabled={busy || !followingState?.connection?.online || ['awaiting-config','running'].includes(followingState?.phase||'')||followingState?.basic?.phase==='running'||followingState?.activity?.phase==='running'} title="读取关注清单并保存基础资料"><Icon name="sync" size={18}/>{followingState?.phase === 'running' ? '正在同步关注清单…' : followingState?.connection?.online?'同步关注清单':'等待扩展连接'}</button>
          </div>
        </header>

        {route !== 'settings' && showFollowingPanels && <SummaryStrip summary={summary} />}
        {videosVisited&&<Activity mode={route==='videos'?'visible':'hidden'}>
          <VideoInformationPage key={ownerSecUid??'unbound'} ownerSecUid={ownerSecUid} creators={allCreators} focus={videoFocus?.ownerSecUid===ownerSecUid?videoFocus:null}
            canCollect={!busy&&followingState?.connection?.online===true&&followingState.readiness?.phase==='ready'&&!['running','awaiting-config'].includes(followingState.phase)&&followingState.basic?.phase!=='running'&&followingState.activity?.phase!=='running'}
            collectionState={followingState?.videoInformation} onOpenCreator={openVideoCreator} onOpenWorkshop={openInformationWorkshop}/>
        </Activity>}
        {workshopVisited&&<Activity mode={route==='workshop'?'visible':'hidden'}>
          <InformationWorkshopPage ownerSecUid={ownerSecUid} creators={allCreators} focus={workshopFocus?.ownerSecUid===ownerSecUid?workshopFocus:null} onOpenVideos={()=>navigate('videos')}/>
        </Activity>}
        {databaseVisited&&<Activity mode={route==='creator-database'?'visible':'hidden'}>
          <CreatorDatabasePage key={followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid??'unbound'} onEditingChange={setDatabaseEditing}/>
        </Activity>}
        {showFollowingPanels && followingState && <div className="following-connection" role="status" aria-live="polite" data-testid="following-connection"><span>{followingState.readiness?.message||'正在自动准备关注同步…'}</span>{followingState.readiness?.phase==='blocked'&&<><button className="button ghost" onClick={()=>void runAction(()=>window.signalDesk.prepareFollowing(),'正在重新准备关注同步')}>重新检查</button>{!followingState.connection?.online?<button className="button ghost" onClick={()=>void runAction(()=>window.signalDesk.configureFollowing(),'已打开连接说明')}>连接扩展</button>:<button className="button ghost" onClick={()=>void runAction(()=>window.signalDesk.loginFollowing(),'请在浏览器处理登录或验证，APP 将自动检查')}>{followingState.readiness.code==='LOGIN_REQUIRED'?'登录账号':'查看账号页面'}</button>}</>}</div>}
        {showFollowingPanels && followingState && followingState.phase !== 'idle' && <div className="following-status" role="status" data-testid="following-sync-status"><div><strong>{followingState.phase === 'completed' ? `关注清单已保存 · 本轮 ${followingState.count} 位` : followingState.phase === 'blocked' ? '关注同步需要处理' : '正在同步关注清单'}</strong><p>{followingStatusMessage(followingState)}</p>{followingState.phase === 'completed' && <small>已有资料保留{followingState.timing?.displayedTotalMs!==undefined&&` · 点击到资料与头像可用 ${(followingState.timing.displayedTotalMs/1000).toFixed(2)} 秒`}</small>}{followingState.phase==='completed'&&followingState.timing?.displayedTotalMs!==undefined&&<details><summary>查看耗时</summary><small>连接与派发 {((followingState.timing.dispatchMs||0)/1000).toFixed(3)} 秒 · 页面读取 {((followingState.timing.acquisitionMs||0)/1000).toFixed(3)} 秒 · 校验与保存 {((followingState.timing.persistenceMs||0)/1000).toFixed(3)} 秒 · 其余传输与展示 {((followingState.timing.displayedTotalMs-(followingState.timing.dispatchMs||0)-(followingState.timing.acquisitionMs||0)-(followingState.timing.persistenceMs||0))/1000).toFixed(3)} 秒</small></details>}</div><div>{followingState.phase === 'completed' && <button className="button ghost" onClick={() => setRoute('creators')}>查看关注博主</button>}{['awaiting-config','running'].includes(followingState.phase) && <button className="button ghost" onClick={() => void runAction(() => window.signalDesk.cancelFollowingSync(), '本轮关注同步已取消')}>取消本轮</button>}</div></div>}

        {showFollowingPanels && followingState?.plan?.runId&&<div className="following-status" role="status"><div><strong>{followingState.plan.complete?'本地关注清单已完成':'本地关注清单尚未完成'}</strong><p>本轮已读取并保存 {followingState.plan.count} 位 · 资料库累计保留 {allCreators.filter(c=>!c.isDemo).length} 位 · {followingState.basic?.pending||0} 位基础资料待补充</p><small>未建立作品基线的博主在“异常”分组核验并补齐；已有基线的博主可按分组独立更新</small></div><div>
          {followingState.basic?.phase==='running'?<button className="button ghost" onClick={()=>void runAction(()=>window.signalDesk.cancelFollowingBasics(),'已取消补充，已完成资料保留')}>取消补充</button>:<button className="button ghost" data-testid="complete-following-basics" onClick={()=>void runAction(()=>window.signalDesk.completeFollowingBasics(),'正在补全缺失的基础资料')} disabled={busy||!followingState.connection?.online||!followingState.plan.complete||!followingState.basic?.pending||followingState.phase==='running'||followingState.activity?.phase==='running'}>补全基础资料（最多 20 位）</button>}
        </div></div>}
        {showFollowingPanels && followingState?.basic&&followingState.basic.phase!=='idle'&&<div className="following-connection" role="status"><span>{followingState.basic.message} · {followingState.basic.done}/{followingState.basic.total}{followingState.basic.currentName&&<> · <CreatorName name={followingState.basic.currentName} profileUrl={followingState.basic.currentSecUid?`https://www.douyin.com/user/${followingState.basic.currentSecUid}`:undefined}/></>}</span></div>}

        {route === 'inbox' && (
          <InboxPage
            materialContent={<MaterialInbox key={ownerSecUid??'unbound'} owner={ownerSecUid??null} creators={allCreators} search={inboxSearch} filter={inboxFilter} onCount={setMaterialUnread} onAvailable={setMaterialCount} onOpenVideos={()=>navigate('videos')}/>}
            hasMaterials={materialCount>0}
            items={inbox} search={inboxSearch} setSearch={setInboxSearch} filter={inboxFilter} setFilter={setInboxFilter}
            onOpen={(id) => void openWork(id)} onAction={(id, state, feedback) => void runAction(() => window.signalDesk.updateInbox(id, state, feedback), '已更新')}
            onSeed={() => void runAction(() => window.signalDesk.seedDemo(), '演示资料已建立')}
          />
        )}
        {route === 'creators' && (
          <CreatorsPage key={ownerSecUid??'unbound'} ownerSecUid={ownerSecUid} creators={creators} allCreators={allCreators} search={creatorSearch} setSearch={setCreatorSearch} onUpdate={changeCreatorAnnotation} annotationSavingIds={annotationSavingIds} onInterestChange={changeCreatorInterest} interestSavingKeys={interestSavingKeys} onOpenVideos={openCreatorVideos} focus={creatorFocus?.ownerSecUid===ownerSecUid?creatorFocus:null}
            activityState={followingState?.activity??null} canRefresh={!busy&&followingState?.connection?.online===true&&followingState.readiness?.phase==='ready'&&!['running','awaiting-config'].includes(followingState.phase)&&followingState.basic?.phase!=='running'&&followingState.videoInformation?.phase!=='running'}
            singleRefreshSuccess={singleRefreshSuccess} cardRefreshRun={cardRefreshRun?.ownerSecUid===ownerSecUid?cardRefreshRun:null}
            canSetPriority={!busy&&!!(followingConfiguration?.activeOwnerSecUid??followingState?.ownerSecUid)&&!creatorPriorityBusyReason(followingState)}
            prioritySavingKeys={prioritySavingKeys}
            onPriorityChange={(creator,mode)=>void changeCreatorPriority(creator,mode)}
            onRefresh={(id,resume,ids,scope)=>void refreshCreatorActivity(id,resume,ids,scope)}
            onCancelRefresh={()=>void runAction(()=>window.signalDesk.cancelCreatorActivity(),'已取消刷新，已更新资料保留')} />
        )}
        {route === 'jobs' && (
          <JobsPage jobs={jobs} summary={summary} onPause={() => void runAction(async () => {if(followingState?.activity?.baselineTask&&followingState.activity.phase==='running')await window.signalDesk.cancelCreatorActivity();await window.signalDesk.pauseSync()}, '队列已暂停')} onResume={(jobId) => void runAction(() => window.signalDesk.resumeSync(jobId), `任务 #${jobId} 已恢复`)} onConnector={() => void window.signalDesk.openConnectorFolder()}>
            <CreatorBaselineTaskPanel state={followingState?.activity??null} creatorCount={creators.filter(c=>!c.isDemo).length}
              canStart={!busy&&followingState?.connection?.online===true&&followingState.readiness?.phase==='ready'&&!['running','awaiting-config'].includes(followingState.phase)&&![followingState.basic?.phase,followingState.activity?.phase,followingState.videoInformation?.phase].includes('running')}
              onStart={resume=>void runAction(async()=>{setFollowingState(await window.signalDesk.startCreatorBaseline(!!resume))},resume?'正在继续活跃度基线试采':'正在启动活跃度基线试采')}
              onCancel={()=>void runAction(async()=>{setFollowingState(await window.signalDesk.cancelCreatorActivity())},'基线试采已暂停，已保存记录保留')}/>
            <IsolatedPilotPanel catalog={isolatedCatalog} state={isolatedPilotState} busy={busy}
              onPrepare={(creatorUid) => void runAction(async () => {
                setIsolatedPilotState(await window.signalDesk.prepareIsolatedPilot(creatorUid))
              }, '隔离试跑已准备，请在 Chrome 加载扩展并从弹窗开始')}
              onOpenExtension={() => void runAction(() => window.signalDesk.openIsolatedPilotExtension(), '已打开隔离扩展目录')}
              onCancel={() => void runAction(async () => { setIsolatedPilotState(await window.signalDesk.cancelIsolatedPilot()) }, '本轮已结束，隔离报告保留')}
              onOpenReport={() => void runAction(() => window.signalDesk.openIsolatedPilotReport(), '已打开隔离报告目录')} />
          </JobsPage>
        )}
        {route === 'settings' && settings && (
          <SettingsPage
            followingConfiguration={followingConfiguration}
            followingState={followingState}
            onFollowingSave={(value)=>void runAction(()=>window.signalDesk.saveFollowingConfiguration(value),'浏览器与账号备注已保存')}
            onFollowingBind={(value)=>void runAction(()=>window.signalDesk.bindFollowingAccount(value),'正在读取并绑定当前登录账号，历史账号资料保留')}
            onFollowingSwitch={(secUid)=>void runAction(()=>window.signalDesk.switchFollowingAccount(secUid),'已切换资料账号，正在验证浏览器登录状态')}
            onFollowingLogin={()=>void runAction(()=>window.signalDesk.loginFollowing(),'已打开所选浏览器的账号页面')}
            onFollowingConnector={()=>void runAction(()=>window.signalDesk.configureFollowing(),'已打开所选浏览器的连接说明')}
            onFollowingCancelBind={()=>void runAction(()=>window.signalDesk.cancelFollowingAccountBinding(),'已取消新账号绑定，当前资料账号保留')}
            settings={settings}
            onSave={async(value) => {
              let saved:AppSettings|null=null
              await runAction(async()=>{saved=await window.signalDesk.saveSettings(value)}, '设置已安全保存')
              return saved
            }}
            onEstimate={async () => setCloudEstimate(await window.signalDesk.estimateCloud(100))}
            workerStatus={workerStatus}
            workerProgress={workerProgress}
            busy={busy}
            onWorkerCheck={() => void runAction(async () => { setWorkerStatus(await window.signalDesk.preflightWorker()); setWorkerProgress('检查完成') }, '本地 AI 检查完成')}
            onWorkerSetup={() => void runAction(async () => { setWorkerProgress('准备安装'); setWorkerStatus(await window.signalDesk.setupWorker()) }, '本地 ASR/OCR 已安装并验证')}
            onConnector={() => void window.signalDesk.openConnectorFolder()}
            onPrepareDemoClear={() => void prepareDemoClear()}
          />
        )}
      </main>

      {selectedWork && <WorkDrawer work={selectedWork} onClose={() => setSelectedWork(null)} onExternal={(url) => void window.signalDesk.openExternal(url)} onComments={(workId) => void runAction(() => window.signalDesk.startCommentsSync(workId, 20), '已创建独立评论任务，最多 20 条')} />}
      {cloudEstimate && (
        <CloudConfirm estimate={cloudEstimate} onCancel={() => setCloudEstimate(null)} onConfirm={() => {
          const batchId = Number(cloudEstimate.batchId || 0)
          setCloudEstimate(null)
          void runAction(() => window.signalDesk.runCloud(batchId), '云端分析批次已完成')
        }} />
      )}
      {STRUCTURED_SYNC_AVAILABLE && worksConfirmCreator && <CreatorWorksConfirm creator={worksConfirmCreator} connectorOnline={summary.connectorOnline} onCancel={() => setWorksConfirmCreator(null)} onConfirm={(worksPerCreator) => {
        const creator = worksConfirmCreator
        setWorksConfirmCreator(null)
        void runAction(() => window.signalDesk.startCreatorWorksSync(creator.platformCreatorId, worksPerCreator), <>已为 <CreatorName name={creator.nickname} profileUrl={creator.profileUrl}/> 创建独立作品任务</>)
      }} />}
      {demoClearSummary && <DemoClearConfirm summary={demoClearSummary} onCancel={() => setDemoClearSummary(null)} onConfirm={() => {
        const removed = demoClearSummary
        setDemoClearSummary(null)
        setSelectedWork(null)
        void runAction(() => window.signalDesk.clearDemo(), `已清除 ${removed.creatorCount} 位演示博主和 ${removed.workCount} 个演示作品`)
      }} />}
      {toast && <div className="toast" role="status" aria-live="polite" data-testid="toast"><span/><p>{toast}</p></div>}
    </div>
    </CreatorNameProvider>
  )
}

function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }): JSX.Element {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon}/><span>{label}</span>{badge ? <b>{badge > 999 ? '999+' : badge}</b> : null}</button>
}

function SummaryStrip({ summary }: { summary: DashboardSummary }): JSX.Element {
  const stats = [
    ['未读内容', summary.unreadCount, '今日优先'], ['关注博主', summary.followingCount, '累计保存'],
    ['已收作品', summary.workCount, `${summary.analyzedCount} 已分析`], ['公开评论', summary.commentCount, '本机入库']
  ]
  return <section className="summary-strip">{stats.map(([label, value, note], index) => <div className="summary-stat" key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString('zh-CN')}</strong><small>{note}</small>{index < stats.length - 1 && <i/>}</div>)}</section>
}


function InboxPage({ items, search, setSearch, filter, setFilter, onOpen, onAction, onSeed,materialContent,hasMaterials }: {
  items: InboxItem[]; search: string; setSearch: (value: string) => void; filter: string; setFilter: (value: string) => void;
  onOpen: (id: number) => void; onAction: (id: number, state: InboxItem['readState'], feedback: number) => void; onSeed: () => void
  materialContent?:ReactNode;hasMaterials?:boolean
}): JSX.Element {
  return <section className="page-section">
    <div className="toolbar"><SearchBox value={search} onChange={(value) => { setSearch(value); if (value.trim()) setFilter('all') }} placeholder="搜索标题、摘要、转写、OCR、领域或关键词"/><div className="segmented">{[['unread','未读'],['later','稍后看'],['saved','已收藏'],['all','全部']].map(([value,label]) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div></div>
    {materialContent}
    {items.length ? <div className="inbox-grid">{items.map((item) => <WorkCard key={item.id} item={item} onOpen={onOpen} onAction={onAction}/>)}</div> : !hasMaterials&&<EmptyLibrary onSeed={onSeed} search={search}/>}
  </section>
}

function WorkCard({ item, onOpen, onAction }: { item: InboxItem; onOpen: (id: number) => void; onAction: (id: number, state: InboxItem['readState'], feedback: number) => void }): JSX.Element {
  return <article className={`work-card ${item.readState === 'unread' ? 'unread' : ''}`}>
    <button className="cover" onClick={() => onOpen(item.id)} style={item.coverUrl ? { backgroundImage: `linear-gradient(180deg, transparent 45%, rgba(10,18,15,.78)), url("${item.coverUrl}")` } : undefined}>
      {!item.coverUrl && <span className="cover-placeholder">{item.workType === 'video' ? 'VIDEO' : 'POST'}</span>}
      <span className="work-type">{item.workType === 'video' ? '视频' : '图文'}</span>
      <div className="cover-author"><Avatar name={item.creatorName} src={item.creatorAvatar}/><div><strong><CreatorName name={item.creatorName} profileUrl={item.creatorProfileUrl}/></strong><small><Icon name="clock" size={13}/>{relativeTime(item.publishedAt || item.discoveredAt)}</small></div></div>
    </button>
    <div className="work-body">
      <div className="card-title-row"><h3 onClick={() => onOpen(item.id)}>{item.title || '未命名作品'}</h3>{item.readState === 'unread' && <span className="unread-dot"/>}</div>
      <p className="work-summary">{item.summary || item.description || '内容已采集，等待本地证据处理或云端摘要。'}</p>
      <div className="tag-row">{item.domains.slice(0, 2).map((tag) => <span key={`domain-${tag}`} title="作品领域">作品·{tag}</span>)}{item.keywords.slice(0, Math.max(0, 4 - item.domains.length)).map((tag) => <span key={`keyword-${tag}`}>#{tag}</span>)}{item.performance === 'high' && <span className="performance-high">高于该博主常态</span>}{item.performance === 'low' && <span className="performance-low">低于该博主常态</span>}{item.analysisStatus !== 'completed' && <span className="pending-tag">待分析</span>}</div>
      <div className="metrics"><span><Icon name="heart" size={16}/>{formatNumber(item.likeCount)}</span><span><Icon name="comment" size={16}/>{formatNumber(item.commentCount)}</span><span><Icon name="bookmark" size={16}/>{formatNumber(item.collectCount)}</span><button title="感兴趣" onClick={() => onAction(item.id, item.readState, 1)}>＋兴趣</button></div>
    </div>
    <div className="card-actions"><button onClick={() => onAction(item.id, 'later', 0)} className={item.readState === 'later' ? 'active' : ''}>稍后看</button><button onClick={() => onAction(item.id, 'saved', 0)} className={item.readState === 'saved' ? 'active' : ''}><Icon name="bookmark" size={15}/>收藏</button><button className="detail-button" onClick={() => onOpen(item.id)}>查看分析<Icon name="chevron" size={16}/></button></div>
  </article>
}

function EmptyLibrary({ onSeed, search }: { onSeed: () => void; search: string }): JSX.Element {
  return <div className="empty-library"><div className="empty-visual"><span/><span/><span/><Icon name={search ? 'search' : 'inbox'} size={38}/></div><h2>{search ? '没有找到匹配内容' : '收件箱还是空的'}</h2><p>{search ? '没有内容包含这个关键词，请尝试作品标题、博主名称、领域或关键词。' : '连接 Chrome/Edge 后开始同步；也可以先载入一套离线演示资料，体验完整工作流。'}</p>{!search && <div><button className="button primary" onClick={onSeed}>载入演示资料</button><small>演示数据完全在本机生成，不访问抖音或云端。</small></div>}</div>
}


function JobsPage({ jobs, summary, onPause, onResume, onConnector, children }: { jobs: Job[]; summary: DashboardSummary; onPause: () => void; onResume: (jobId: number) => void; onConnector: () => void; children?: ReactNode }): JSX.Element {
  const labels: Record<string, string> = { 'collection.following': '同步关注列表', 'collection.creator_works': '采集博主历史作品', 'collection.work_comments': '补齐作品评论', 'media.process': '提取音频、关键帧与 OCR', 'cloud.work_text': '作品文本分析', 'cloud.work_vision': '精选关键帧分析', 'cloud.comments': '公开评论分析' }
  return <section className="page-section">
    <div className="pipeline-banner"><div className={`pipeline-icon ${summary.connectorOnline ? 'online' : ''}`}><Icon name="sync" size={26}/></div><div><h3>{summary.connectorOnline ? '浏览器连接器在线' : '真实同步需要浏览器连接器'}</h3><p>应用不会保存抖音账号密码。登录、验证码和安全验证只在你的浏览器中完成；恢复操作只影响所选任务。</p></div><button className="button ghost" onClick={onConnector}>打开连接器目录</button><button className="button ghost" onClick={onPause}><Icon name="pause" size={17}/>暂停活动任务</button></div>
    {children}
    <div className="job-list-header"><span>任务</span><span>状态</span><span>进度</span><span>操作 / 更新时间</span></div>
    <div className="job-list">{jobs.length ? jobs.map((job) => <div className="job-row" key={job.id}><div><span className={`job-kind ${job.kind.split('.')[0]}`}><Icon name={job.kind.startsWith('collection') ? 'sync' : job.kind.startsWith('media') ? 'database' : 'key'} size={17}/></span><div><strong>{labels[job.kind] || job.kind}</strong><small>{job.status_message || job.error_message || `任务 #${job.id}`}</small></div></div><StatusPill status={job.state}/><div className="progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }}/><span>{Math.round(job.progress * 100)}%</span></div><div className="job-actions">{job.resumable && <button className="button primary compact" onClick={() => onResume(job.id)}><Icon name="play" size={14}/>恢复此任务</button>}<time>{relativeTime(job.updated_at)}</time></div></div>) : <div className="empty-rows">正式任务队列为空。可在上方使用已验证作者进行隔离单作品试跑。</div>}</div>
  </section>
}

function IsolatedPilotPanel({ catalog, state, busy, onPrepare, onOpenExtension, onOpenReport, onCancel }: {
  catalog: IsolatedPilotCatalog | null; state: IsolatedPilotState | null; busy: boolean;
  onPrepare: (creatorUid: string) => void; onOpenExtension: () => void; onOpenReport: () => void; onCancel: () => void
}): JSX.Element {
  const [creatorUid, setCreatorUid] = useState('')
  const selected = catalog?.creators.find((entry) => entry.uid === creatorUid) ?? catalog?.creators[0]
  const selectedAppearance=useCreatorNameAppearance({nativeUid:selected?.uid,ownerSecUid:catalog?.ownerSecUid})
  const result = state?.result
  return <section className="isolated-pilot-panel">
    <div><p className="eyebrow">R8 · 独立作品任务</p><h3>从已保存作者验证一个作品</h3>
      <p>这是单独的作者作品任务，只读取已保存目录。不会刷新当前账号关注，也不会创建关注任务。浏览器最多访问首页、作者主页和一个作品页；结果只写入系统临时目录。</p></div>
    <div className="isolated-pilot-controls">
      <label>已验证作者
        <select className={creatorNameClass(selectedAppearance,true)} value={selected?.uid ?? ''} onChange={(event) => setCreatorUid(event.target.value)} disabled={!catalog?.available || busy}>
          {(catalog?.creators ?? []).map((creator) => <CreatorNameOption key={creator.uid} value={creator.uid} name={creator.nickname} profileUrl={creator.profileUrl} ownerSecUid={catalog?.ownerSecUid} suffix={` · ${creator.followingState === 'stale' ? '关注状态待刷新' : '关注已验证'}`}/>)}
        </select>
      </label>
      <button className="button primary" disabled={!selected || busy || state?.phase === 'prepared'} onClick={() => selected && onPrepare(selected.uid)}>准备单作品试跑</button>
    </div>
    {!catalog?.available && <p className="isolated-pilot-hint">{catalog?.reason ?? '正在读取隔离作者目录…'}。首次自动关注发现与目录建立仍待验证。</p>}
    {state?.phase === 'prepared' && <div className="isolated-pilot-result"><strong>已准备：<CreatorName name={state.creatorName??""} nativeUid={state.creatorUid}/></strong><p>打开扩展目录，在 Chrome 的扩展管理页首次加载或重新加载该固定目录，再从隔离扩展弹窗点击开始。页面出现安全验证时试跑会停止。</p><button className="button ghost" onClick={onOpenExtension}>打开扩展目录</button><button className="button ghost" onClick={onOpenReport}>打开报告目录</button><button className="button ghost" onClick={onCancel} disabled={busy}>结束本轮</button></div>}
    {state?.phase === 'finished' && result && <div className="isolated-pilot-result"><strong>{result.status === 'verified' ? '作品已验证' : result.status === 'candidate-only' ? '仅有候选，证据不足' : '试跑被阻断'} · <CreatorName name={state.creatorName??''} nativeUid={state.creatorUid}/></strong><p>候选 {result.candidateCount} 个；页面导航 {result.navigationCount} 次；扩展主动接口请求 {result.activeApiRequests} 次。</p>{result.workId && <p>作品 {result.workId}：{result.title}</p>}{result.reason && <p>原因：{result.reason}</p>}{result.workProofHash && <p className="proof-hash">作品列表投影 SHA-256：{result.workProofHash}</p>}{result.detailProofHash && <p className="proof-hash">详情投影 SHA-256：{result.detailProofHash}</p>}<button className="button ghost" onClick={onOpenReport}>打开原始报告</button></div>}
    {state?.phase === 'failed' && <p className="isolated-pilot-hint">隔离控制器已退出且没有有效报告。请查看报告目录后重新准备。</p>}
    {state?.phase === 'cancelled' && <p className="isolated-pilot-hint">本轮已结束，已有隔离文件保留。可以选择作者准备下一轮。</p>}
    {!!state?.tasks?.length && <div className="isolated-task-states">{state.tasks.map((task) => <p key={task.kind}><strong>作者作品同步</strong> · {task.message}</p>)}</div>}
  </section>
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const labels: Record<string, string> = { queued: '等待中', running: '运行中', paused: '已暂停', blocked_user_action: '需要操作', pending_cloud: '待确认费用', retryable_failed: '可重试', permanent_failed: '已失败', completed: '已完成' }
  return <span className={`status-pill ${status}`}>{status === 'completed' && <Icon name="check" size={13}/>} {labels[status] || status}</span>
}

function SettingsPage({ settings, onSave, onEstimate, onConnector, workerStatus, workerProgress, onWorkerCheck, onWorkerSetup, onPrepareDemoClear, busy,
  followingConfiguration,followingState,onFollowingSave,onFollowingBind,onFollowingSwitch,onFollowingLogin,onFollowingConnector,onFollowingCancelBind }: {
  followingConfiguration:FollowingConfiguration|null
  followingState:FollowingSyncState|null
  onFollowingSave:(value:{chromeProfile:string;label:string})=>void
  onFollowingBind:(value:{label:string;profileUrl:string})=>void
  onFollowingSwitch:(secUid:string)=>void
  onFollowingLogin:()=>void
  onFollowingConnector:()=>void
  onFollowingCancelBind:()=>void
  settings: AppSettings
  onSave: (value: Record<string, unknown>) => Promise<AppSettings|null>
  onEstimate: () => void
  onConnector: () => void
  workerStatus: Record<string, unknown> | null
  workerProgress: string
  onWorkerCheck: () => void
  onWorkerSetup: () => void
  onPrepareDemoClear: () => void
  busy: boolean
}): JSX.Element {
  const [form, setForm] = useState<Record<string, unknown>>({ ...settings, textApiKey: '', visionApiKey: '' })
  const lastSaved=useRef<Record<string,unknown>>({...settings})
  const editRevision=useRef(0)
  const cloudEditRevision=useRef(0)
  const [changingProfile,setChangingProfile]=useState(false)
  const [pendingProfile,setPendingProfile]=useState<{action:string;id?:string}|null>(null)
  const editableKeys=(value:Record<string,unknown>)=>Object.keys(value).filter(key=>!['cloudProfiles','hasTextApiKey','hasVisionApiKey','activeCloudProfileRevision'].includes(key))
  const cloudDraftKeys:readonly string[]=[...CLOUD_SETTING_KEYS,'cloudProfileName','textApiKey','visionApiKey']
  const isDirty=(value:Record<string,unknown>,saved:Record<string,unknown>)=>editableKeys(value).some(key=>
    key==='textApiKey'||key==='visionApiKey'?Boolean(value[key]):JSON.stringify(value[key])!==JSON.stringify(saved[key]))
  useEffect(() => {
    const previous=lastSaved.current
    lastSaved.current={...settings}
    // Background polling may update saved values, but never replaces an edited field.
    setForm(current=>{
      if(current.activeCloudProfileId!==settings.activeCloudProfileId){
        return isDirty(current,previous)?{...current,cloudProfiles:settings.cloudProfiles}:{...settings,textApiKey:'',visionApiKey:''}
      }
      const next={...current}
      for(const [key,value] of Object.entries(settings)){
        if(JSON.stringify(current[key])===JSON.stringify(previous[key]))next[key]=value
      }
      return next
    })
  }, [settings])
  const update = (key: string, value: unknown): void => {editRevision.current++;if(cloudDraftKeys.includes(key))cloudEditRevision.current++;setForm((current) => ({ ...current, [key]: value }))}
  const save=async():Promise<boolean>=>{
    const revision=editRevision.current
    const submitted=form,saved=await onSave(submitted)
    if(!saved)return false
    setForm(current=>{
      const next={...current}
      // Keep changes typed while saving; clear only credentials that were submitted successfully.
      for(const [key,value] of Object.entries({...saved,textApiKey:'',visionApiKey:''})){
        if(JSON.stringify(current[key])===JSON.stringify(submitted[key]))next[key]=value
      }
      return next
    })
    return revision===editRevision.current
  }
  const performProfile=async(operation:{action:string;id?:string}):Promise<void>=>{
    setChangingProfile(true)
    try{
      const saved=await onSave({cloudProfileAction:operation.action,cloudProfileId:operation.id,expectedCloudProfileId:settings.activeCloudProfileId})
      if(saved){lastSaved.current={...saved};setForm({...saved,textApiKey:'',visionApiKey:''});setPendingProfile(null)}
    }finally{setChangingProfile(false)}
  }
  const requestProfile=(action:string,id?:string)=>{
    const operation={action,id}
    if(isDirty(form,lastSaved.current))setPendingProfile(operation)
    else void performProfile(operation)
  }
  const profileChanged=form.activeCloudProfileId!==settings.activeCloudProfileId
  const cloudDirty=cloudDraftKeys.some(key=>key==='textApiKey'||key==='visionApiKey'?Boolean(form[key]):JSON.stringify(form[key])!==JSON.stringify(settings[key as keyof AppSettings]))
  const cloudTestBlocked=busy||changingProfile||profileChanged||cloudDirty
  const cloudTestResetKey=JSON.stringify([settings.activeCloudProfileId,settings.activeCloudProfileRevision,form.activeCloudProfileId,cloudEditRevision.current,cloudDirty])
  const cloudTestHint=(service:'text'|'vision')=>profileChanged?'请先载入当前云端方案':cloudDirty?'请先保存配置再测试':!settings[service==='text'?'hasTextApiKey':'hasVisionApiKey']?'请先保存 API Key':!settings[service==='text'?'textBaseUrl':'visionBaseUrl']||!settings[service==='text'?'textModel':'visionModel']?'请先填写服务地址和模型并保存':!settings.activeCloudProfileId||!settings.activeCloudProfileRevision?'请先保存云端方案':service==='vision'?'点击发送合成图片，验证视觉服务':'点击发起最小文本请求'
  const cloudTestInput=(service:'text'|'vision')=>!cloudTestBlocked&&settings.activeCloudProfileId&&settings.activeCloudProfileRevision&&settings[service==='text'?'hasTextApiKey':'hasVisionApiKey']&&settings[service==='text'?'textBaseUrl':'visionBaseUrl']&&settings[service==='text'?'textModel':'visionModel']?{kind:'profile' as const,profileId:settings.activeCloudProfileId,service,expectedRevision:settings.activeCloudProfileRevision}:null
  return <section className="settings-layout">
    <div className="settings-main">
      <DoubaoSpeechSettings/>
      <SiliconFlowSettings activeProfileId={settings.activeCloudProfileId} disabled={busy||changingProfile||profileChanged}
        onActivate={id=>requestProfile('activate',id)}/>
      {followingConfiguration&&<FollowingAccountSettings configuration={followingConfiguration} state={followingState} busy={busy}
        onSave={onFollowingSave} onBind={onFollowingBind} onSwitch={onFollowingSwitch} onLogin={onFollowingLogin} onConnector={onFollowingConnector} onCancelBind={onFollowingCancelBind}/>}
      <SettingsCard icon="key" title="云端兼容 API" description="文本与视觉服务可分别配置。保存后，在视频信息页勾选作品，选择云端摘要或画面补充；执行前展示范围与费用信息。">
        {settings.cloudProfiles&&<div className="cloud-profile-controls" data-testid="cloud-profile-controls">
          <div className="field-grid">
            <Field label="云端方案"><select aria-label="云端方案" value={String(form.activeCloudProfileId||'')} disabled={busy||changingProfile||profileChanged} onChange={event=>requestProfile('activate',event.target.value)}>
              {settings.cloudProfiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select></Field>
            <Field label="方案名称"><input aria-label="方案名称" value={String(form.cloudProfileName||'')} maxLength={80} disabled={changingProfile} onChange={event=>update('cloudProfileName',event.target.value)} placeholder="例如：厂商名 · 模型名"/></Field>
          </div>
          <p className="setting-hint">每套方案分别保存服务地址、协议、模型和密钥。新建方案保留原配置；切换后用于后续云端任务。</p>
          <div className="cloud-profile-actions"><button className="button ghost" disabled={busy||changingProfile||profileChanged} onClick={()=>requestProfile('create')}>新建方案</button><button className="button ghost" disabled={busy||changingProfile||profileChanged} onClick={()=>requestProfile('duplicate')}>复制为新方案</button></div>
          {pendingProfile&&<div className="cloud-profile-pending" role="status"><p>当前有未保存修改，请选择如何继续。保存期间新输入的内容也会保留。</p><div className="cloud-profile-actions">
            <button className="button primary" disabled={busy||changingProfile||profileChanged} onClick={async()=>{if(await save())await performProfile(pendingProfile)}}>保存并继续</button>
            <button className="button ghost" disabled={busy||changingProfile} onClick={()=>void performProfile(pendingProfile)}>放弃修改并继续</button>
            <button className="button ghost" disabled={busy||changingProfile} onClick={()=>setPendingProfile(null)}>继续编辑</button>
          </div></div>}
          {profileChanged&&<div className="cloud-profile-pending" role="status"><p>当前生效方案已变化，原草稿已保留。请核对后重新载入当前方案。</p><button className="button ghost" onClick={()=>{lastSaved.current={...settings};setForm({...settings,textApiKey:'',visionApiKey:''});setPendingProfile(null)}}>放弃草稿并载入当前方案</button></div>}
        </div>}
        <fieldset className="cloud-profile-fields" disabled={changingProfile}>
        <div className="cloud-provider-group">
          <div className="cloud-provider-head"><div><strong>文本分析服务</strong><span>用于作品、转写、OCR 与评论分析</span></div><span className={settings.hasTextApiKey ? 'credential-state saved' : 'credential-state'}>{settings.hasTextApiKey ? '密钥已安全保存' : '未保存密钥'}</span></div>
          <div className="field-grid">
            <Field label="文本服务 Base URL" wide><input value={String(form.textBaseUrl || '')} onChange={(e) => update('textBaseUrl', e.target.value)} placeholder="https://text-provider.example.com/v1"/></Field>
            <Field label="文本接口协议"><select value={String(form.textApiProtocol || 'chat-completions')} onChange={(e) => update('textApiProtocol', e.target.value)}><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></Field>
            <Field label="文本服务 API Key" wide><input type="password" value={String(form.textApiKey || '')} onChange={(e) => update('textApiKey', e.target.value)} placeholder={settings.hasTextApiKey ? '留空保持现有密钥' : 'sk-…'}/></Field>
            <Field label="文本模型"><input value={String(form.textModel || '')} onChange={(e) => update('textModel', e.target.value)} placeholder="text-model-id"/></Field>
            <Field label="上下文窗口"><input type="number" value={Number(form.contextWindow || 128000)} onChange={(e) => update('contextWindow', Number(e.target.value))}/></Field>
            <Field label="文本输入单价 / 百万 token"><input type="number" step="0.01" value={form.textInputPricePerMillion === null ? '' : Number(form.textInputPricePerMillion)} onChange={(e) => update('textInputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
            <Field label="文本输出单价 / 百万 token"><input type="number" step="0.01" value={form.textOutputPricePerMillion === null ? '' : Number(form.textOutputPricePerMillion)} onChange={(e) => update('textOutputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
          </div>
          <CloudConnectionTest ariaLabel="测试文本服务连通性" input={cloudTestInput('text')} disabled={cloudTestBlocked} resetKey={cloudTestResetKey} hint={cloudTestHint('text')}/>
        </div>
        <div className="cloud-provider-group optional-provider">
          <div className="cloud-provider-head"><div><strong>视觉分析服务 · 可选</strong><span>仅用于用户确认上传的压缩关键帧</span></div><span className={settings.hasVisionApiKey ? 'credential-state saved' : 'credential-state'}>{settings.hasVisionApiKey ? '密钥已安全保存' : '未保存密钥'}</span></div>
          <div className="field-grid">
            <Field label="视觉服务 Base URL" wide><input value={String(form.visionBaseUrl || '')} onChange={(e) => update('visionBaseUrl', e.target.value)} placeholder="https://vision-provider.example.com/v1；留空禁用视觉分析"/></Field>
            <Field label="视觉服务 API Key" wide><input type="password" value={String(form.visionApiKey || '')} onChange={(e) => update('visionApiKey', e.target.value)} placeholder={settings.hasVisionApiKey ? '留空保持现有密钥' : 'sk-…；可与文本服务不同'}/></Field>
            <Field label="视觉模型"><input value={String(form.visionModel || '')} onChange={(e) => update('visionModel', e.target.value)} placeholder="vision-model-id"/></Field>
            <Field label="图片单价 / 张"><input type="number" step="0.0001" value={form.imagePrice === null ? '' : Number(form.imagePrice)} onChange={(e) => update('imagePrice', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
            <Field label="视觉输入单价 / 百万 token"><input type="number" step="0.01" value={form.visionInputPricePerMillion === null ? '' : Number(form.visionInputPricePerMillion)} onChange={(e) => update('visionInputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
            <Field label="视觉输出单价 / 百万 token"><input type="number" step="0.01" value={form.visionOutputPricePerMillion === null ? '' : Number(form.visionOutputPricePerMillion)} onChange={(e) => update('visionOutputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
          </div>
          <CloudConnectionTest ariaLabel="测试视觉服务连通性" input={cloudTestInput('vision')} disabled={cloudTestBlocked} resetKey={cloudTestResetKey} hint={cloudTestHint('vision')}/>
        </div>
        <p className="setting-hint">连通测试使用已保存配置发起最小请求，可能产生少量用量。</p>
        <div className="settings-actions"><button className="button ghost" onClick={onEstimate}>预估收件箱待分析批次</button><button className="button primary" onClick={() => void save()} disabled={busy||changingProfile||profileChanged}>保存设置</button></div>
        </fieldset>
      </SettingsCard>
      <SettingsCard icon="database" title="本地媒体与保留策略" description="原片只是临时处理材料，成功提取证据后自动删除。">
        <p className="setting-hint">以下本地策略用于收件箱流程。视频信息页使用独立的已安装内容处理环境，就绪状态在该页显示；云端文本与视觉配置共用。</p>
        <div className="field-grid"><Field label="ASR 模型"><select value={String(form.asrModel || 'small')} onChange={(e) => update('asrModel', e.target.value)}><option value="small">faster-whisper small · 推荐</option><option value="medium">faster-whisper medium · 更慢</option></select></Field><Field label="缓存上限（GB）"><input type="number" min="1" max="500" value={Number(form.cacheLimitGb || 20)} onChange={(e) => update('cacheLimitGb', Number(e.target.value))}/></Field><Field label="失败缓存保留（小时）"><input type="number" min="1" max="720" value={Number(form.retentionHours || 72)} onChange={(e) => update('retentionHours', Number(e.target.value))}/></Field><Field label="兴趣标签（逗号分隔）"><input value={Array.isArray(form.interests) ? form.interests.join(', ') : ''} onChange={(e) => update('interests', e.target.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean))} placeholder="AI, 金融, 历史"/></Field></div>
        <div className="local-ai-status">
          <div><strong>本地 AI 运行环境</strong><span>{workerProgress || '尚未检查；应用不会在启动时自动安装大型依赖。'}</span></div>
          {workerStatus && <div className="local-ai-checks"><span className={workerStatus.ffmpeg ? 'ok' : 'missing'}>FFmpeg</span><span className={workerStatus.ffprobe ? 'ok' : 'missing'}>FFprobe</span><span className={(workerStatus.modules as Record<string, unknown> | undefined)?.faster_whisper ? 'ok' : 'missing'}>faster-whisper</span><span className={(workerStatus.modules as Record<string, unknown> | undefined)?.paddleocr ? 'ok' : 'missing'}>PaddleOCR</span></div>}
        </div>
        <div className="settings-actions"><button className="button ghost" onClick={onWorkerCheck} disabled={busy}>检查本地 AI</button><button className="button ghost" onClick={onWorkerSetup} disabled={busy}>安装本地 ASR/OCR</button><button className="button primary" onClick={() => void save()} disabled={busy||changingProfile||profileChanged}>保存本地策略</button></div>
      </SettingsCard>
      <SettingsCard icon="check" title="R7 证据合同状态" description="媒体、ASR/OCR、证据映射与事实核验当前仅开放离线合同和合成基准，不会因此自动处理媒体或调用外部服务。">
        <div className="r7-contract-state" data-external-calls={R7_CONTRACT_ONLY_UI_STATE.externalCallsAllowed ? 'allowed' : 'blocked'}>
          <div><span>媒体处理</span><strong>合同已就绪</strong><small>未开始下载或解码</small></div>
          <div><span>ASR / OCR</span><strong>等待显式任务</strong><small>当前未检查 provider</small></div>
          <div><span>证据映射</span><strong>逐点引用</strong><small>悬空引用会被拒绝</small></div>
          <div><span>事实核验</span><strong>无证据则弃权</strong><small>外部检索与费用仍锁定</small></div>
        </div>
        <div className="r7-boundary-note"><Icon name="check" size={15}/><span>离线基准不会读取媒体、启动浏览器或访问网络；真实外部调用必须同时取得网络与费用批准。</span></div>
      </SettingsCard>
      <SettingsCard icon="trash" title="演示资料管理" description="真实同步前可移除离线演示样本，避免演示内容与真实账号资料混在一起。">
        <div className="demo-cleanup-row"><div><strong>只清除带演示标记的资料</strong><span>执行前会列出准确范围。真实博主、真实作品及其收藏和批注不会受到影响。</span></div><button className="button danger" onClick={onPrepareDemoClear} disabled={busy}><Icon name="trash" size={16}/>查看并清除</button></div>
      </SettingsCard>
    </div>
    <aside className="privacy-panel"><p className="eyebrow">COLLECTION BOUNDARY</p><h2>浏览器只是一座桥</h2><p>所有管理、搜索和分析都在桌面端完成。APP 启动时检查授权账号与连接状态，点击同步后按账号保存博主资料。</p><ul><li><Icon name="check" size={15}/>不保存抖音密码</li><li><Icon name="check" size={15}/>不导出 Cookie 或请求令牌</li><li><Icon name="check" size={15}/>不点赞、评论、关注或私信</li><li><Icon name="check" size={15}/>遇到验证码立即暂停</li></ul><button className="button dark" onClick={onConnector}>查看安装说明<Icon name="external" size={16}/></button><div className="privacy-foot"><span className="presence"/><div><strong>Native Messaging</strong><small>只连接本机回环地址</small></div></div></aside>
  </section>
}

function FollowingAccountSettings({configuration,state,busy,onSave,onBind,onSwitch,onLogin,onConnector,onCancelBind}:{
  configuration:FollowingConfiguration;state:FollowingSyncState|null;busy:boolean;
  onSave:(value:{chromeProfile:string;label:string})=>void;onBind:(value:{label:string;profileUrl:string})=>void;
  onSwitch:(secUid:string)=>void;onLogin:()=>void;onConnector:()=>void
  onCancelBind:()=>void
}):JSX.Element{
  const active=configuration.accounts.find(account=>account.secUid===configuration.activeOwnerSecUid)
  const [profile,setProfile]=useState(configuration.chromeProfile||'')
  const [label,setLabel]=useState(active?.label||'')
  const [newLabel,setNewLabel]=useState('')
  const [profileUrl,setProfileUrl]=useState('')
  useEffect(()=>{setProfile(configuration.chromeProfile||'');setLabel(active?.label||'')},[configuration.chromeProfile,active?.secUid,active?.label])
  const locked=busy||state?.phase==='running'||state?.phase==='awaiting-config'
  return <SettingsCard icon="people" title="关注账号与浏览器" description="选择登录账号所在的浏览器配置；各账号的博主资料、星标和批注分别累计保存。">
    <div data-testid="following-account-settings">
      <div className="field-grid">
        <Field label="Chrome 用户配置"><select aria-label="关注同步 Chrome 用户配置" value={profile} disabled={locked} onChange={event=>setProfile(event.target.value)}>
          {!profile&&<option value="">请选择浏览器配置</option>}
          {configuration.profiles.map(item=><option key={item.directory} value={item.directory}>{item.name} · {item.directory}{item.extensionInstalled?' · 扩展已安装':' · 需安装扩展'}</option>)}
        </select></Field>
        <Field label="当前资料账号"><select aria-label="当前关注资料账号" value={configuration.activeOwnerSecUid||''} disabled={locked} onChange={event=>{if(event.target.value)onSwitch(event.target.value)}}>
          {!configuration.activeOwnerSecUid&&<option value="">尚未绑定账号</option>}
          {configuration.accounts.map(account=><option key={account.secUid} value={account.secUid}>{account.label} · {account.creatorCount} 位博主</option>)}
        </select></Field>
        <Field label="账号备注名"><input aria-label="关注账号备注名" value={label} onChange={event=>setLabel(event.target.value)} maxLength={100} placeholder="例如：个人账号、工作账号" disabled={locked}/></Field>
        <Field label="接口确认的账号昵称"><input readOnly value={active?.nickname||'等待接口验证'} /></Field>
      </div>
      <p className="following-config-note">{state?.readiness?.message||'正在读取连接状态'}{configuration.bindingPending?' · 正在绑定当前浏览器账号':''}</p>
      <div className="settings-actions">
        <button className="button ghost" disabled={locked||!profile} onClick={()=>onSave({chromeProfile:profile,label})}>保存浏览器与备注</button>
        <button className="button ghost" disabled={locked||profile!==configuration.chromeProfile} onClick={onLogin}>打开浏览器登录 / 切换账号</button>
        <button className="button ghost" disabled={locked||profile!==configuration.chromeProfile} onClick={onConnector}>连接所选浏览器</button>
      </div>
      <div className="following-account-bind">
        <strong>绑定另一个登录账号</strong>
        <p>先保存浏览器配置，在该浏览器中登录目标抖音账号，再读取并绑定。账号身份由接口确认，旧账号可随时切回。</p>
        <div className="field-grid">
          <Field label="新账号备注名"><input aria-label="新关注账号备注名" value={newLabel} onChange={event=>setNewLabel(event.target.value)} maxLength={100} placeholder="留空使用账号昵称" disabled={locked}/></Field>
          <Field label="目标账号主页链接（可选）"><input aria-label="目标关注账号主页链接" value={profileUrl} onChange={event=>setProfileUrl(event.target.value)} placeholder="留空自动读取；填写后会核对身份" disabled={locked}/></Field>
        </div>
        <div className="settings-actions"><button className="button primary" disabled={locked||!configuration.connected||profile!==configuration.chromeProfile||configuration.bindingPending} onClick={()=>onBind({label:newLabel,profileUrl})}>读取并绑定当前登录账号</button>{configuration.bindingPending&&<button className="button ghost" disabled={locked} onClick={onCancelBind}>取消新账号绑定</button>}</div>
      </div>
      <details className="following-connector-details"><summary>账号身份与连接器信息</summary>
        <p>当前账号主页：{active?`https://www.douyin.com/user/${active.secUid}`:'尚未绑定'}</p>
        <p>账号 UID：{active?.uid||'等待接口读取'}</p>
        <p>连接器：{configuration.connected?'已连接':'待连接'} · 扩展 {configuration.connectorVersion||'未连接'} / APP 需要 {configuration.expectedVersion}</p>
        <p>扩展目录：{configuration.extensionDirectory||'正在准备'}</p>
      </details>
    </div>
  </SettingsCard>
}

function SettingsCard({ icon, title, description, children }: { icon: string; title: string; description: string; children: ReactNode }): JSX.Element {
  return <article className="settings-card"><div className="settings-card-head"><span><Icon name={icon}/></span><div><h3>{title}</h3><p>{description}</p></div></div>{children}</article>
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }): JSX.Element {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>
}

function WorkDrawer({ work, onClose, onExternal, onComments }: { work: Record<string, any>; onClose: () => void; onExternal: (url: string) => void; onComments: (workId: string) => void }): JSX.Element {
  const metrics = Array.isArray(work.metrics) ? work.metrics as Array<Record<string, unknown>> : []
  const latest = metrics[0] || {}
  const keyPoints = Array.isArray(work.keyPoints) ? work.keyPoints as string[] : []
  const keywords = Array.isArray(work.keywords) ? work.keywords as Array<Record<string, unknown>> : []
  const workDomains = Array.isArray(work.workDomains) ? work.workDomains.map(String) : []
  const creatorDomains = Array.isArray(work.creatorDomains) ? work.creatorDomains.map(String) : []
  const comments = Array.isArray(work.comments) ? work.comments as Array<Record<string, unknown>> : []
  const transcript = Array.isArray(work.transcript) ? work.transcript as Array<Record<string, unknown>> : []
  const visual = work.visualAnalysis && typeof work.visualAnalysis === 'object' ? work.visualAnalysis as Record<string, unknown> : null
  const visualPoints = visual && Array.isArray(visual.keyPoints) ? visual.keyPoints as string[] : []
  const isDemo = Boolean(work.is_demo)
  const metricValue = (key: string): number | null => latest[key] === null || latest[key] === undefined ? null : Number(latest[key])

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="work-drawer">
      <div className="drawer-head">
        <div><p className="eyebrow">WORK EVIDENCE</p><h2>{String(work.title || '未命名作品')}</h2><span><CreatorName name={String(work.creator_name)} profileUrl={work.profile_url as string}/> · {relativeTime(work.published_at as string | null)}</span></div>
        <button onClick={onClose}><Icon name="close"/></button>
      </div>
      <div className="drawer-scroll">
        {isDemo && <div className="demo-notice"><strong>离线演示作品</strong><span>标题、指标、评论和分析均为本地模拟数据，不对应真实抖音作品，因此没有可打开的原作品页面。</span></div>}
        <section className="drawer-summary">
          <p>{String(work.summary || work.description || '尚未生成作品摘要。')}</p>
          {work.core_expression && <blockquote><span>作者核心表达</span>{String(work.core_expression)}</blockquote>}
        </section>
        <div className="drawer-metrics">
          <div><Icon name="heart"/><strong>{formatNumber(metricValue('like_count'))}</strong><span>公开点赞</span></div>
          <div><Icon name="comment"/><strong>{formatNumber(metricValue('comment_count'))}</strong><span>公开评论</span></div>
          <div><Icon name="bookmark"/><strong>{formatNumber(metricValue('collect_count'))}</strong><span>公开收藏</span></div>
        </div>
        <p className="metric-note">指标在页面未展示或未采集到时显示“不可见”，并保持为空，不会按 0 处理。</p>
        {keyPoints.length > 0 && <DrawerSection title="重点梳理"><ol>{keyPoints.map((point, index) => <li key={index}><span>{index + 1}</span><p>{point}</p></li>)}</ol></DrawerSection>}
        {visual && <DrawerSection title="精选关键帧补充分析"><p className="visual-summary">{String(visual.summary || '')}</p>{visualPoints.length > 0 && <ol>{visualPoints.map((point, index) => <li key={index}><span>{index + 1}</span><p>{point}</p></li>)}</ol>}<small className="muted">视觉结论仅来自抽取的静态帧，不代表完整视频画面。</small></DrawerSection>}
        <DrawerSection title="作品分类与关键词">
          <div className="domain-groups">
            <div><small>作品领域</small><div className="tag-row large">{workDomains.length ? workDomains.map((domain) => <span key={domain}>#{domain}</span>) : <span className="pending-tag">待分类</span>}</div></div>
            <div><small>博主领域</small><div className="tag-row large">{creatorDomains.length ? creatorDomains.map((domain) => <span key={domain}>#{domain}</span>) : <span className="pending-tag">待分类</span>}</div></div>
            <div><small>作品关键词</small><div className="tag-row large">{keywords.length ? keywords.map((item) => <span key={String(item.keyword)}>#{String(item.keyword)}</span>) : <span className="pending-tag">待提炼</span>}</div></div>
          </div>
        </DrawerSection>
        <DrawerSection title={`带时间戳转写 · ${transcript.length} 段`}>{transcript.length ? <div className="transcript">{transcript.slice(0, 80).map((segment, index) => <p key={index}><time>{Math.floor(Number(segment.start_ms) / 60000)}:{String(Math.floor(Number(segment.start_ms) / 1000) % 60).padStart(2,'0')}</time><span>{String(segment.text)}</span></p>)}</div> : <p className="muted">尚未取得音频转写；页面简介仍可用于基础分析。</p>}</DrawerSection>
        <DrawerSection title={`采集评论 · ${comments.length}`}>
          {comments.length
            ? <div className="comment-samples">{comments.slice(0, 50).map((comment, index) => <CommentAuditCard key={String(comment.platform_comment_id || index)} comment={comment} work={work} onExternal={onExternal}/>)}</div>
            : <p className="muted">当前作品尚未保存评论。</p>}
        </DrawerSection>
      </div>
      <div className="drawer-footer">
        <button className="button ghost" onClick={onClose}>关闭</button>
        <button className="button ghost" disabled={isDemo || !STRUCTURED_SYNC_AVAILABLE} title={STRUCTURED_SYNC_AVAILABLE ? '为此作品创建独立任务，最多读取 20 条一级评论' : '评论采集待独立验收'} onClick={() => onComments(String(work.platform_work_id))}>按需补评论</button>
        <button className="button primary" disabled={isDemo} title={isDemo ? '演示作品不对应真实抖音页面' : '在默认浏览器打开抖音原页'} onClick={() => { if (!isDemo) onExternal(String(work.source_url)) }}>{isDemo ? '演示作品无原页' : '打开抖音原页'}<Icon name="external" size={16}/></button>
      </div>
    </aside>
  </div>
}

function CommentAuditCard({ comment, work, onExternal }: { comment: Record<string, unknown>; work: Record<string, any>; onExternal: (url: string) => void }): JSX.Element {
  const verified = Number(comment.source_verified) === 1
  const publicAuthor = String(comment.public_author_name || '').trim()
  const idKind = String(comment.platform_comment_id_kind || 'legacy-unknown')
  const idKindLabel = idKind === 'page-attribute'
    ? '抖音页面提供的评论 ID'
    : idKind === 'synthetic-content-hash'
      ? '页面未提供稳定 ID；由作品、作者和正文生成'
      : '旧版记录，ID 来源未验证'
  return <article className={`comment-audit-card ${verified ? 'verified' : 'unverified'}`}>
    <div className="comment-audit-head">
      <div><small>公开作者</small><strong>{publicAuthor || '作者信息缺失'}</strong></div>
      <span>{verified ? '来源已验证' : '来源未验证'}</span>
    </div>
    <p className="comment-body">{String(comment.body || '') || '正文为空'}</p>
    {!verified && <p className="comment-warning">此记录来自旧版或缺少严格评论 DOM 证明，不能作为有效评论验收。</p>}
    <dl className="comment-audit-meta">
      <div><dt>评论 ID</dt><dd>{String(comment.platform_comment_id || '页面未提供')}</dd></div>
      <div><dt>ID 来源</dt><dd>{idKindLabel}</dd></div>
      <div><dt>公开作者 ID</dt><dd>{String(comment.public_author_id || '页面未提供')}</dd></div>
      <div><dt>点赞数</dt><dd>{comment.like_count === null || comment.like_count === undefined ? '页面未提供' : String(comment.like_count)}</dd></div>
      <div><dt>发布时间</dt><dd>{exactTime(comment.published_at)}</dd></div>
      <div><dt>采集时间</dt><dd>{exactTime(comment.collected_at)}</dd></div>
      <div><dt>所属作品</dt><dd>{String(work.platform_work_id || '未知')}</dd></div>
      <div><dt>采集结构</dt><dd>{verified ? '评论列表 → 评论项 → 作者信息 → 相邻正文' : '未验证'}</dd></div>
    </dl>
    <button className="comment-source-link" onClick={() => onExternal(String(work.source_url))}>打开所属作品原页<Icon name="external" size={14}/></button>
  </article>
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return <section className="drawer-section"><h3>{title}</h3>{children}</section>
}

function CloudConfirm({ estimate, onCancel, onConfirm }: { estimate: Record<string, unknown>; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  const cost = estimate.estimatedCost
  const textCost = estimate.estimatedTextCost
  const visionCost = estimate.estimatedVisionCost
  const formatCost = (value: unknown): string => value === null || value === undefined ? '单价不完整' : `配置币种 ${Number(value).toFixed(4)}`
  return <div className="modal-backdrop"><div className="confirm-modal"><span className="confirm-icon"><Icon name="key" size={26}/></span><p className="eyebrow">EXPLICIT COST GATE · BATCH #{Number(estimate.batchId || 0)}</p><h2>确认本批云端分析</h2><p>只有点击确认后，派生文本和精选关键帧才会分别发往对应的文本或视觉服务。不会上传原视频；确认后执行的是此处固化的批次清单。</p><div className="estimate-grid"><div><span>文本作品 / 评论作品</span><strong>{Number(estimate.workCount || 0)} / {Number(estimate.commentWorkCount || 0)}</strong></div><div><span>视觉作品 / 关键帧</span><strong>{Number(estimate.visionWorkCount || 0)} / {Number(estimate.imageCount || 0)}</strong></div><div><span>文本输入 / 输出</span><strong>{Number(estimate.textInputTokens || 0).toLocaleString()} / {Number(estimate.textOutputTokens || 0).toLocaleString()}</strong></div><div><span>视觉输入 / 输出</span><strong>{Number(estimate.visionInputTokens || 0).toLocaleString()} / {Number(estimate.visionOutputTokens || 0).toLocaleString()}</strong></div><div><span>文本服务预计费用</span><strong>{formatCost(textCost)}</strong></div><div><span>视觉服务预计费用</span><strong>{formatCost(visionCost)}</strong></div><div><span>纳入评论</span><strong>{Number(estimate.commentCount || 0)}</strong></div><div><span>合计预计费用</span><strong>{cost === null || cost === undefined ? '单价不完整，无法估算' : `配置币种 ${Number(cost).toFixed(4)}`}</strong></div></div><div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" onClick={onConfirm} disabled={!Number(estimate.subjectCount) || !Number(estimate.batchId)}>确认并执行</button></div></div></div>
}

function FollowingRefreshConfirm({ connectorOnline, onCancel, onConfirm }: { connectorOnline: boolean; onCancel: () => void; onConfirm: (creatorLimit: number) => void }): JSX.Element {
  const [creatorLimit, setCreatorLimit] = useState(3)
  const valid = Number.isInteger(creatorLimit) && creatorLimit >= 1 && creatorLimit <= 5
  return <div className="modal-backdrop"><div className="confirm-modal"><span className="confirm-icon"><Icon name="sync" size={25}/></span><p className="eyebrow">FOLLOWING DIRECTORY</p><h2>确认关注目录刷新范围</h2><p>本动作只读取当前账号的关注关系，并更新已验证作者目录及刷新状态。</p><div className="sync-scope-grid"><label><span>本次最多确认作者</span><input type="number" min="1" max="5" value={creatorLimit} onChange={(event) => setCreatorLimit(Number(event.target.value))}/><small>允许范围 1～5</small></label></div><div className="sample-boundary"><strong>只刷新关注目录</strong><span>不会打开作者作品页、排入作品或评论任务，也不会启动媒体或云端处理。数量上限不代表完整关注快照；未闭合时不会据此判断取关。</span></div>{!connectorOnline && <div className="destructive-note blocked"><strong>浏览器连接器当前离线</strong><span>请恢复连接后再开始。</span></div>}<div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" onClick={() => onConfirm(creatorLimit)} disabled={!connectorOnline || !valid}>确认刷新关注目录</button></div></div></div>
}

function CreatorWorksConfirm({ creator, connectorOnline, onCancel, onConfirm }: { creator: CreatorListItem; connectorOnline: boolean; onCancel: () => void; onConfirm: (worksPerCreator: number) => void }): JSX.Element {
  const [worksPerCreator, setWorksPerCreator] = useState(1)
  const valid = Number.isInteger(worksPerCreator) && worksPerCreator >= 1 && worksPerCreator <= 10
  return <div className="modal-backdrop"><div className="confirm-modal"><span className="confirm-icon"><Icon name="sync" size={25}/></span><p className="eyebrow">SAVED AUTHOR WORKS</p><h2>同步 <CreatorName name={creator.nickname} profileUrl={creator.profileUrl}/> 的作品</h2><p>只从这位作者已验证的主页开始，独立记录作品任务状态。</p><div className="sync-scope-grid"><label><span>本次最多作品</span><input type="number" min="1" max="10" value={worksPerCreator} onChange={(event) => setWorksPerCreator(Number(event.target.value))}/><small>允许范围 1～10</small></label></div><div className="sample-boundary"><strong>仅同步此作者作品</strong><span>不会刷新账号关注目录，不会自动补充评论，也不会启动媒体或云端处理。</span></div>{!connectorOnline && <div className="destructive-note blocked"><strong>浏览器连接器当前离线</strong><span>请恢复连接后再开始。</span></div>}<div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" onClick={() => onConfirm(worksPerCreator)} disabled={!connectorOnline || !valid}>确认同步作品</button></div></div></div>
}

function DemoClearConfirm({ summary, onCancel, onConfirm }: { summary: DemoDataSummary; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false)
  const personalStateCount = summary.savedCount + summary.laterCount + summary.starredCreatorCount + summary.notedCreatorCount
  return <div className="modal-backdrop"><div className="confirm-modal danger-modal"><span className="confirm-icon"><Icon name="trash" size={25}/></span><p className="eyebrow">DEMO DATA CLEANUP</p><h2>确认清除演示资料</h2><p>本操作只删除标记为离线演示的博主和作品；真实采集资料不会被删除。删除在本地事务中执行，完成后无法从应用内撤销。</p><div className="estimate-grid"><div><span>演示博主</span><strong>{summary.creatorCount}</strong></div><div><span>演示作品</span><strong>{summary.workCount}</strong></div><div><span>演示评论</span><strong>{summary.commentCount}</strong></div><div><span>分析记录</span><strong>{summary.analysisCount}</strong></div><div><span>关联任务 / 云批次</span><strong>{summary.relatedJobCount} / {summary.relatedBatchCount}</strong></div><div><span>证据帧索引</span><strong>{summary.evidenceFrameCount}</strong></div></div>{personalStateCount > 0 && <div className="destructive-note"><strong>注意：演示记录上的个人状态也会一起删除</strong><span>收藏 {summary.savedCount}、稍后看 {summary.laterCount}、博主星标 {summary.starredCreatorCount}、博主批注 {summary.notedCreatorCount}。这些状态依附于将被删除的演示记录；真实资料上的状态不受影响。</span></div>}{summary.blockingOperationCount > 0 && <div className="destructive-note blocked"><strong>当前不能清理</strong><span>有 {summary.blockingOperationCount} 个关联任务或批次正在执行，请等待结束后重新打开本确认框。</span></div>}<label className="destructive-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>我确认只需要保留真实资料，并清除以上演示资料。</span></label><div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button danger" onClick={onConfirm} disabled={!acknowledged || summary.blockingOperationCount > 0}>清除演示资料</button></div></div></div>
}
