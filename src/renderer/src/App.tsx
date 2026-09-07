import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { AppSettings, CreatorListItem, DashboardSummary, DemoDataSummary, InboxItem, SampleSyncOptions } from '../../shared/contracts'
import { STRUCTURED_SYNC_AVAILABLE } from '../../shared/featureFlags'

type Route = 'inbox' | 'creators' | 'jobs' | 'settings'
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

function Icon({ name, size = 20 }: { name: string; size?: number }): JSX.Element {
  const paths: Record<string, ReactNode> = {
    inbox: <><path d="M4 5h16v12H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2-6 5.5-6s5 2 5.5 6"/><circle cx="17" cy="9" r="2"/><path d="M16 14c3 0 4 1.5 4.5 4"/></>,
    queue: <><path d="M6 4h12M6 12h12M6 20h12"/><circle cx="3" cy="4" r=".5"/><circle cx="3" cy="12" r=".5"/><circle cx="3" cy="20" r=".5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    sync: <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    heart: <path d="M20 8c0 5-8 11-8 11S4 13 4 8c0-4 5-5 8-1 3-4 8-3 8 1Z"/>,
    comment: <path d="M4 5h16v11H9l-5 4Z"/>,
    bookmark: <path d="M7 4h10v16l-5-3-5 3Z"/>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m7 4 13 8-13 8Z"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 19h16"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    close: <path d="M5 5l14 14M19 5 5 19"/>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></>,
    key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9m-3 0v3m-3-3v2"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 2 4 3 8 3s8-1 8-3V5M4 12v7c0 2 4 3 8 3s8-1 8-3v-7"/></>
  }
  return <svg className={`icon icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
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
    inbox: { eyebrow: 'DAILY SIGNALS', title: '今日内容收件箱', description: '先看值得看的，再决定是否打开原视频。' },
    creators: { eyebrow: 'CREATOR LIBRARY', title: '关注博主资料库', description: '按领域、批注和作品画像重新认识你的关注列表。' },
    jobs: { eyebrow: 'LOCAL PIPELINE', title: '同步与处理队列', description: '每一步都可暂停、续跑，并保留明确的失败原因。' },
    settings: { eyebrow: 'PRIVATE BY DEFAULT', title: '设置与数据边界', description: '媒体留在本机，云端调用逐批确认。' }
  }[route]
}

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('inbox')
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [creators, setCreators] = useState<CreatorListItem[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [inboxSearch, setInboxSearch] = useState('')
  const [creatorSearch, setCreatorSearch] = useState('')
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState('')
  const [debouncedCreatorSearch, setDebouncedCreatorSearch] = useState('')
  const [inboxFilter, setInboxFilter] = useState('unread')
  const [selectedWork, setSelectedWork] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [cloudEstimate, setCloudEstimate] = useState<Record<string, unknown> | null>(null)
  const [demoClearSummary, setDemoClearSummary] = useState<DemoDataSummary | null>(null)
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)
  const [workerStatus, setWorkerStatus] = useState<Record<string, unknown> | null>(null)
  const [workerProgress, setWorkerProgress] = useState('')
  const refreshSequence = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInboxSearch(inboxSearch), 220)
    return () => clearTimeout(timer)
  }, [inboxSearch])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCreatorSearch(creatorSearch), 220)
    return () => clearTimeout(timer)
  }, [creatorSearch])

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    const [nextSummary, nextInbox, nextCreators, nextJobs, nextSettings] = await Promise.all([
      window.signalDesk.getDashboard(),
      window.signalDesk.listInbox({ state: inboxFilter, search: debouncedInboxSearch, limit: 200 }),
      window.signalDesk.listCreators(debouncedCreatorSearch),
      window.signalDesk.listJobs(),
      window.signalDesk.getSettings()
    ])
    if (sequence !== refreshSequence.current) return
    setSummary(nextSummary)
    setInbox(nextInbox)
    setCreators(nextCreators)
    setJobs(nextJobs)
    setSettings(nextSettings)
  }, [debouncedCreatorSearch, debouncedInboxSearch, inboxFilter])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    const remove = window.signalDesk.onDataChanged(() => void refresh())
    return () => { clearInterval(timer); remove() }
  }, [refresh])

  useEffect(() => window.signalDesk.onWorkerSetupProgress((event) => setWorkerProgress(event.message)), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3_500)
    return () => clearTimeout(timer)
  }, [toast])

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<void> => {
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
  const hasData = summary.workCount > 0 || summary.followingCount > 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>S</span><span>D</span></div>
          <div><strong>Signal Desk</strong><small>个人内容情报台</small></div>
        </div>
        <nav>
          <NavItem active={route === 'inbox'} icon="inbox" label="今日收件箱" badge={summary.unreadCount} onClick={() => setRoute('inbox')} />
          <NavItem active={route === 'creators'} icon="people" label="博主资料库" badge={summary.followingCount} onClick={() => setRoute('creators')} />
          <NavItem active={route === 'jobs'} icon="queue" label="任务中心" badge={summary.queuedJobs} onClick={() => setRoute('jobs')} />
          <div className="nav-spacer" />
          <NavItem active={route === 'settings'} icon="settings" label="设置" onClick={() => setRoute('settings')} />
        </nav>
        <div className="connector-card">
          <span className={`presence ${summary.connectorOnline ? 'online' : ''}`} />
          <div><strong>{summary.connectorOnline ? '浏览器已连接' : '等待浏览器连接'}</strong><small>{summary.lastSyncAt ? `同步于 ${relativeTime(summary.lastSyncAt)}` : '尚未同步真实账号'}</small></div>
        </div>
        <div className="local-note"><Icon name="database" size={17}/><span>数据保存在这台电脑</span></div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{header.eyebrow}</p>
            <h1>{header.title}</h1>
            <p className="subtitle">{header.description}</p>
          </div>
          <div className="header-actions">
            <button className="button ghost" onClick={() => void runAction(() => window.signalDesk.exportAll(true), '资料库已导出')} disabled={busy || !hasData}><Icon name="download" size={18}/>导出</button>
            <button className="button primary" onClick={() => setSyncConfirmOpen(true)} disabled={busy || !summary.connectorOnline || !STRUCTURED_SYNC_AVAILABLE} title={!STRUCTURED_SYNC_AVAILABLE ? '等待生产连接器完成 v2 结构化 envelope 桥接' : summary.connectorOnline ? '确认小样本范围后开始采集' : '请先连接浏览器只读连接器'}><Icon name="sync" size={18}/>{STRUCTURED_SYNC_AVAILABLE ? '小样本同步' : '结构化同步待接入'}</button>
          </div>
        </header>

        {route !== 'settings' && <SummaryStrip summary={summary} />}

        {route === 'inbox' && (
          <InboxPage
            items={inbox} search={inboxSearch} setSearch={setInboxSearch} filter={inboxFilter} setFilter={setInboxFilter}
            onOpen={(id) => void openWork(id)} onAction={(id, state, feedback) => void runAction(() => window.signalDesk.updateInbox(id, state, feedback), '已更新')}
            onSeed={() => void runAction(() => window.signalDesk.seedDemo(), '演示资料已建立')}
          />
        )}
        {route === 'creators' && (
          <CreatorsPage creators={creators} search={creatorSearch} setSearch={setCreatorSearch} onUpdate={(id, input, success) => void runAction(() => window.signalDesk.updateCreator(id, input), success)} />
        )}
        {route === 'jobs' && (
          <JobsPage jobs={jobs} summary={summary} onPause={() => void runAction(() => window.signalDesk.pauseSync(), '队列已暂停')} onResume={(jobId) => void runAction(() => window.signalDesk.resumeSync(jobId), `任务 #${jobId} 已恢复`)} onConnector={() => void window.signalDesk.openConnectorFolder()} />
        )}
        {route === 'settings' && settings && (
          <SettingsPage
            settings={settings}
            onSave={(value) => void runAction(() => window.signalDesk.saveSettings(value), '设置已安全保存')}
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

      {selectedWork && <WorkDrawer work={selectedWork} onClose={() => setSelectedWork(null)} onExternal={(url) => void window.signalDesk.openExternal(url)} />}
      {cloudEstimate && (
        <CloudConfirm estimate={cloudEstimate} onCancel={() => setCloudEstimate(null)} onConfirm={() => {
          const batchId = Number(cloudEstimate.batchId || 0)
          setCloudEstimate(null)
          void runAction(() => window.signalDesk.runCloud(batchId), '云端分析批次已完成')
        }} />
      )}
      {STRUCTURED_SYNC_AVAILABLE && syncConfirmOpen && <SampleSyncConfirm connectorOnline={summary.connectorOnline} onCancel={() => setSyncConfirmOpen(false)} onConfirm={(scope) => {
        setSyncConfirmOpen(false)
        void runAction(() => window.signalDesk.startSync(scope), `小样本同步已开始：最多 ${scope.creatorLimit} 位博主、每位 ${scope.worksPerCreator} 个作品`)
      }} />}
      {demoClearSummary && <DemoClearConfirm summary={demoClearSummary} onCancel={() => setDemoClearSummary(null)} onConfirm={() => {
        const removed = demoClearSummary
        setDemoClearSummary(null)
        setSelectedWork(null)
        void runAction(() => window.signalDesk.clearDemo(), `已清除 ${removed.creatorCount} 位演示博主和 ${removed.workCount} 个演示作品`)
      }} />}
      {toast && <div className="toast"><span/><p>{toast}</p></div>}
    </div>
  )
}

function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }): JSX.Element {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon}/><span>{label}</span>{badge ? <b>{badge > 999 ? '999+' : badge}</b> : null}</button>
}

function SummaryStrip({ summary }: { summary: DashboardSummary }): JSX.Element {
  const stats = [
    ['未读内容', summary.unreadCount, '今日优先'], ['关注博主', summary.followingCount, '当前可见'],
    ['已收作品', summary.workCount, `${summary.analyzedCount} 已分析`], ['公开评论', summary.commentCount, '本机入库']
  ]
  return <section className="summary-strip">{stats.map(([label, value, note], index) => <div className="summary-stat" key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString('zh-CN')}</strong><small>{note}</small>{index < stats.length - 1 && <i/>}</div>)}</section>
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }): JSX.Element {
  return <label className="search-box"><Icon name="search" size={18}/><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/>{value && <button type="button" aria-label="清空搜索" onClick={() => onChange('')}><Icon name="close" size={14}/></button>}</label>
}

function InboxPage({ items, search, setSearch, filter, setFilter, onOpen, onAction, onSeed }: {
  items: InboxItem[]; search: string; setSearch: (value: string) => void; filter: string; setFilter: (value: string) => void;
  onOpen: (id: number) => void; onAction: (id: number, state: InboxItem['readState'], feedback: number) => void; onSeed: () => void
}): JSX.Element {
  return <section className="page-section">
    <div className="toolbar"><SearchBox value={search} onChange={(value) => { setSearch(value); if (value.trim()) setFilter('all') }} placeholder="搜索标题、摘要、转写、OCR、领域或关键词"/><div className="segmented">{[['unread','未读'],['later','稍后看'],['saved','已收藏'],['all','全部']].map(([value,label]) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div></div>
    {items.length ? <div className="inbox-grid">{items.map((item) => <WorkCard key={item.id} item={item} onOpen={onOpen} onAction={onAction}/>)}</div> : <EmptyLibrary onSeed={onSeed} search={search}/>} 
  </section>
}

function WorkCard({ item, onOpen, onAction }: { item: InboxItem; onOpen: (id: number) => void; onAction: (id: number, state: InboxItem['readState'], feedback: number) => void }): JSX.Element {
  return <article className={`work-card ${item.readState === 'unread' ? 'unread' : ''}`}>
    <button className="cover" onClick={() => onOpen(item.id)} style={item.coverUrl ? { backgroundImage: `linear-gradient(180deg, transparent 45%, rgba(10,18,15,.78)), url("${item.coverUrl}")` } : undefined}>
      {!item.coverUrl && <span className="cover-placeholder">{item.workType === 'video' ? 'VIDEO' : 'POST'}</span>}
      <span className="work-type">{item.workType === 'video' ? '视频' : '图文'}</span>
      <div className="cover-author"><Avatar name={item.creatorName} src={item.creatorAvatar}/><div><strong>{item.creatorName}</strong><small><Icon name="clock" size={13}/>{relativeTime(item.publishedAt || item.discoveredAt)}</small></div></div>
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

function CreatorsPage({ creators, search, setSearch, onUpdate }: { creators: CreatorListItem[]; search: string; setSearch: (value: string) => void; onUpdate: (id: number, input: { isStarred?: boolean; note?: string }, success: string) => void }): JSX.Element {
  const [editing, setEditing] = useState<number | null>(null)
  const [note, setNote] = useState('')
  return <section className="page-section">
    <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="搜索博主、领域或你的批注"/><span className="result-count">{creators.length} 位博主</span></div>
    {creators.length ? <div className="creator-grid">{creators.map((creator) => <article className="creator-card" key={creator.id}>
      <div className="creator-top"><Avatar name={creator.nickname} src={creator.avatarUrl} large/><button type="button" title={creator.isStarred ? '取消星标' : '星标博主'} aria-label={creator.isStarred ? `取消星标 ${creator.nickname}` : `星标 ${creator.nickname}`} className={`star-button ${creator.isStarred ? 'active' : ''}`} onClick={() => onUpdate(creator.id, { isStarred: !creator.isStarred }, creator.isStarred ? '已取消博主星标' : '已星标博主')}><Icon name="star" size={16}/><span>{creator.isStarred ? '已星标' : '星标'}</span></button></div>
      <h3>{creator.nickname}</h3><p>{creator.signature || '这个博主还没有可用的公开简介。'}</p>
      <div className="tag-row">{creator.domains.length ? creator.domains.map((domain) => <span key={domain}>#{domain}</span>) : <span className="pending-tag">待分类</span>}</div>
      <div className="creator-stats"><div><strong>{creator.workCount}</strong><span>作品</span></div><div><strong>{creator.analyzedCount}</strong><span>已分析</span></div><div><strong>{creator.lastPublishedAt ? relativeTime(creator.lastPublishedAt) : '—'}</strong><span>最近更新</span></div></div>
      {editing === creator.id ? <div className="note-editor"><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：宏观金融观点清楚，但不看荐股内容。"/><div><button onClick={() => setEditing(null)}>取消</button><button onClick={() => { onUpdate(creator.id, { note }, '博主批注已保存'); setEditing(null) }}>保存批注</button></div></div> : <button className="creator-note" onClick={() => { setEditing(creator.id); setNote(creator.note) }}>{creator.note || '＋ 添加我的批注'}</button>}
    </article>)}</div> : <div className="empty-search"><Icon name="search" size={30}/><h3>没有找到匹配博主</h3><p>可以搜索博主名称、领域标签或你的批注；清空搜索后会恢复全部博主。</p></div>}
  </section>
}

function JobsPage({ jobs, summary, onPause, onResume, onConnector }: { jobs: Job[]; summary: DashboardSummary; onPause: () => void; onResume: (jobId: number) => void; onConnector: () => void }): JSX.Element {
  const labels: Record<string, string> = { 'collection.following': '同步关注列表', 'collection.creator_works': '采集博主历史作品', 'collection.work_comments': '补齐作品评论', 'media.process': '提取音频、关键帧与 OCR', 'cloud.work_text': '作品文本分析', 'cloud.work_vision': '精选关键帧分析', 'cloud.comments': '公开评论分析' }
  return <section className="page-section">
    <div className="pipeline-banner"><div className={`pipeline-icon ${summary.connectorOnline ? 'online' : ''}`}><Icon name="sync" size={26}/></div><div><h3>{summary.connectorOnline ? '浏览器连接器在线' : '真实同步需要浏览器连接器'}</h3><p>应用不会保存抖音账号密码。登录、验证码和安全验证只在你的浏览器中完成；恢复操作只影响所选任务。</p></div><button className="button ghost" onClick={onConnector}>打开连接器目录</button><button className="button ghost" onClick={onPause}><Icon name="pause" size={17}/>暂停活动任务</button></div>
    <div className="job-list-header"><span>任务</span><span>状态</span><span>进度</span><span>操作 / 更新时间</span></div>
    <div className="job-list">{jobs.length ? jobs.map((job) => <div className="job-row" key={job.id}><div><span className={`job-kind ${job.kind.split('.')[0]}`}><Icon name={job.kind.startsWith('collection') ? 'sync' : job.kind.startsWith('media') ? 'database' : 'key'} size={17}/></span><div><strong>{labels[job.kind] || job.kind}</strong><small>{job.status_message || job.error_message || `任务 #${job.id}`}</small></div></div><StatusPill status={job.state}/><div className="progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }}/><span>{Math.round(job.progress * 100)}%</span></div><div className="job-actions">{job.resumable && <button className="button primary compact" onClick={() => onResume(job.id)}><Icon name="play" size={14}/>恢复此任务</button>}<time>{relativeTime(job.updated_at)}</time></div></div>) : <div className="empty-rows">还没有任务。点击右上角“小样本同步”，确认范围后建立第一条队列。</div>}</div>
  </section>
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const labels: Record<string, string> = { queued: '等待中', running: '运行中', paused: '已暂停', blocked_user_action: '需要操作', pending_cloud: '待确认费用', retryable_failed: '可重试', permanent_failed: '已失败', completed: '已完成' }
  return <span className={`status-pill ${status}`}>{status === 'completed' && <Icon name="check" size={13}/>} {labels[status] || status}</span>
}

function SettingsPage({ settings, onSave, onEstimate, onConnector, workerStatus, workerProgress, onWorkerCheck, onWorkerSetup, onPrepareDemoClear, busy }: {
  settings: AppSettings
  onSave: (value: Record<string, unknown>) => void
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
  useEffect(() => setForm((current) => ({
    ...settings,
    textApiKey: current.textApiKey || '',
    visionApiKey: current.visionApiKey || ''
  })), [settings])
  const update = (key: string, value: unknown): void => setForm((current) => ({ ...current, [key]: value }))
  return <section className="settings-layout">
    <div className="settings-main">
      <SettingsCard icon="key" title="云端兼容 API" description="文本与视觉服务可分别选择服务商和密钥；批次执行前始终再次确认。">
        <div className="cloud-provider-group">
          <div className="cloud-provider-head"><div><strong>文本分析服务</strong><span>用于作品、转写、OCR 与评论分析</span></div><span className={settings.hasTextApiKey ? 'credential-state saved' : 'credential-state'}>{settings.hasTextApiKey ? '密钥已安全保存' : '未保存密钥'}</span></div>
          <div className="field-grid">
            <Field label="文本服务 Base URL" wide><input value={String(form.textBaseUrl || '')} onChange={(e) => update('textBaseUrl', e.target.value)} placeholder="https://text-provider.example.com/v1"/></Field>
            <Field label="文本服务 API Key" wide><input type="password" value={String(form.textApiKey || '')} onChange={(e) => update('textApiKey', e.target.value)} placeholder={settings.hasTextApiKey ? '留空保持现有密钥' : 'sk-…'}/></Field>
            <Field label="文本模型"><input value={String(form.textModel || '')} onChange={(e) => update('textModel', e.target.value)} placeholder="text-model-id"/></Field>
            <Field label="上下文窗口"><input type="number" value={Number(form.contextWindow || 128000)} onChange={(e) => update('contextWindow', Number(e.target.value))}/></Field>
            <Field label="文本输入单价 / 百万 token"><input type="number" step="0.01" value={form.textInputPricePerMillion === null ? '' : Number(form.textInputPricePerMillion)} onChange={(e) => update('textInputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
            <Field label="文本输出单价 / 百万 token"><input type="number" step="0.01" value={form.textOutputPricePerMillion === null ? '' : Number(form.textOutputPricePerMillion)} onChange={(e) => update('textOutputPricePerMillion', e.target.value ? Number(e.target.value) : null)} placeholder="可选"/></Field>
          </div>
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
        </div>
        <div className="settings-actions"><button className="button ghost" onClick={onEstimate}>预估待分析批次</button><button className="button primary" onClick={() => onSave(form)}>保存设置</button></div>
      </SettingsCard>
      <SettingsCard icon="database" title="本地媒体与保留策略" description="原片只是临时处理材料，成功提取证据后自动删除。">
        <div className="field-grid"><Field label="ASR 模型"><select value={String(form.asrModel || 'small')} onChange={(e) => update('asrModel', e.target.value)}><option value="small">faster-whisper small · 推荐</option><option value="medium">faster-whisper medium · 更慢</option></select></Field><Field label="缓存上限（GB）"><input type="number" min="1" max="500" value={Number(form.cacheLimitGb || 20)} onChange={(e) => update('cacheLimitGb', Number(e.target.value))}/></Field><Field label="失败缓存保留（小时）"><input type="number" min="1" max="720" value={Number(form.retentionHours || 72)} onChange={(e) => update('retentionHours', Number(e.target.value))}/></Field><Field label="兴趣标签（逗号分隔）"><input value={Array.isArray(form.interests) ? form.interests.join(', ') : ''} onChange={(e) => update('interests', e.target.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean))} placeholder="AI, 金融, 历史"/></Field></div>
        <div className="local-ai-status">
          <div><strong>本地 AI 运行环境</strong><span>{workerProgress || '尚未检查；应用不会在启动时自动安装大型依赖。'}</span></div>
          {workerStatus && <div className="local-ai-checks"><span className={workerStatus.ffmpeg ? 'ok' : 'missing'}>FFmpeg</span><span className={workerStatus.ffprobe ? 'ok' : 'missing'}>FFprobe</span><span className={(workerStatus.modules as Record<string, unknown> | undefined)?.faster_whisper ? 'ok' : 'missing'}>faster-whisper</span><span className={(workerStatus.modules as Record<string, unknown> | undefined)?.paddleocr ? 'ok' : 'missing'}>PaddleOCR</span></div>}
        </div>
        <div className="settings-actions"><button className="button ghost" onClick={onWorkerCheck} disabled={busy}>检查本地 AI</button><button className="button ghost" onClick={onWorkerSetup} disabled={busy}>安装本地 ASR/OCR</button><button className="button primary" onClick={() => onSave(form)} disabled={busy}>保存本地策略</button></div>
      </SettingsCard>
      <SettingsCard icon="trash" title="演示资料管理" description="真实同步前可移除离线演示样本，避免演示内容与真实账号资料混在一起。">
        <div className="demo-cleanup-row"><div><strong>只清除带演示标记的资料</strong><span>执行前会列出准确范围。真实博主、真实作品及其收藏和批注不会受到影响。</span></div><button className="button danger" onClick={onPrepareDemoClear} disabled={busy}><Icon name="trash" size={16}/>查看并清除</button></div>
      </SettingsCard>
    </div>
    <aside className="privacy-panel"><p className="eyebrow">COLLECTION BOUNDARY</p><h2>浏览器只是一座桥</h2><p>所有管理、搜索和分析都在桌面端完成。连接器只在你点击同步后读取当前登录权限下公开可见的内容。</p><ul><li><Icon name="check" size={15}/>不保存抖音密码</li><li><Icon name="check" size={15}/>不导出 Cookie 或请求令牌</li><li><Icon name="check" size={15}/>不点赞、评论、关注或私信</li><li><Icon name="check" size={15}/>遇到验证码立即暂停</li></ul><button className="button dark" onClick={onConnector}>查看安装说明<Icon name="external" size={16}/></button><div className="privacy-foot"><span className="presence"/><div><strong>Native Messaging</strong><small>只连接本机回环地址</small></div></div></aside>
  </section>
}

function SettingsCard({ icon, title, description, children }: { icon: string; title: string; description: string; children: ReactNode }): JSX.Element {
  return <article className="settings-card"><div className="settings-card-head"><span><Icon name={icon}/></span><div><h3>{title}</h3><p>{description}</p></div></div>{children}</article>
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }): JSX.Element {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>
}

function WorkDrawer({ work, onClose, onExternal }: { work: Record<string, any>; onClose: () => void; onExternal: (url: string) => void }): JSX.Element {
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
        <div><p className="eyebrow">WORK EVIDENCE</p><h2>{String(work.title || '未命名作品')}</h2><span>{String(work.creator_name)} · {relativeTime(work.published_at as string | null)}</span></div>
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

function SampleSyncConfirm({ connectorOnline, onCancel, onConfirm }: { connectorOnline: boolean; onCancel: () => void; onConfirm: (scope: SampleSyncOptions) => void }): JSX.Element {
  const [scope, setScope] = useState<SampleSyncOptions>({ creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 })
  const update = (key: keyof SampleSyncOptions, value: string): void => setScope((current) => ({ ...current, [key]: Number(value) }))
  const valid = Number.isInteger(scope.creatorLimit) && scope.creatorLimit >= 1 && scope.creatorLimit <= 5
    && Number.isInteger(scope.worksPerCreator) && scope.worksPerCreator >= 1 && scope.worksPerCreator <= 10
    && Number.isInteger(scope.commentsPerWork) && scope.commentsPerWork >= 1 && scope.commentsPerWork <= 30
  const workMaximum = valid ? scope.creatorLimit * scope.worksPerCreator : 0
  const commentMaximum = valid ? workMaximum * scope.commentsPerWork : 0
  return <div className="modal-backdrop"><div className="confirm-modal"><span className="confirm-icon"><Icon name="sync" size={25}/></span><p className="eyebrow">BOUNDED SAMPLE SYNC</p><h2>确认真实小样本范围</h2><p>连接器只读取当前 Chrome 登录权限下公开可见的抖音页面。以下数字是硬上限，即使页面返回更多记录，桌面端也会再次截断。</p><div className="sync-scope-grid"><label><span>最多采集博主</span><input type="number" min="1" max="5" value={scope.creatorLimit} onChange={(event) => update('creatorLimit', event.target.value)}/><small>允许范围 1～5，建议首次使用 3</small></label><label><span>每位博主最多作品</span><input type="number" min="1" max="10" value={scope.worksPerCreator} onChange={(event) => update('worksPerCreator', event.target.value)}/><small>允许范围 1～10，建议首次使用 5</small></label><label><span>每个作品最多评论</span><input type="number" min="1" max="30" value={scope.commentsPerWork} onChange={(event) => update('commentsPerWork', event.target.value)}/><small>允许范围 1～30，建议首次使用 20</small></label></div><div className="sample-boundary"><strong>本次最多入库 {workMaximum} 个作品、{commentMaximum} 条评论</strong><span>本阶段只采集页面资料，不启动媒体下载、ASR/OCR 或云端分析，也不会调用你配置的 API Key。连接器可能在后台依次打开抖音关注页、博主主页和作品页。</span></div>{!connectorOnline && <div className="destructive-note blocked"><strong>浏览器连接器当前离线</strong><span>请恢复到“浏览器已连接”后再开始。</span></div>}<div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" onClick={() => onConfirm(scope)} disabled={!connectorOnline || !valid}>确认并开始小样本同步</button></div></div></div>
}

function DemoClearConfirm({ summary, onCancel, onConfirm }: { summary: DemoDataSummary; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false)
  const personalStateCount = summary.savedCount + summary.laterCount + summary.starredCreatorCount + summary.notedCreatorCount
  return <div className="modal-backdrop"><div className="confirm-modal danger-modal"><span className="confirm-icon"><Icon name="trash" size={25}/></span><p className="eyebrow">DEMO DATA CLEANUP</p><h2>确认清除演示资料</h2><p>本操作只删除标记为离线演示的博主和作品；真实采集资料不会被删除。删除在本地事务中执行，完成后无法从应用内撤销。</p><div className="estimate-grid"><div><span>演示博主</span><strong>{summary.creatorCount}</strong></div><div><span>演示作品</span><strong>{summary.workCount}</strong></div><div><span>演示评论</span><strong>{summary.commentCount}</strong></div><div><span>分析记录</span><strong>{summary.analysisCount}</strong></div><div><span>关联任务 / 云批次</span><strong>{summary.relatedJobCount} / {summary.relatedBatchCount}</strong></div><div><span>证据帧索引</span><strong>{summary.evidenceFrameCount}</strong></div></div>{personalStateCount > 0 && <div className="destructive-note"><strong>注意：演示记录上的个人状态也会一起删除</strong><span>收藏 {summary.savedCount}、稍后看 {summary.laterCount}、博主星标 {summary.starredCreatorCount}、博主批注 {summary.notedCreatorCount}。这些状态依附于将被删除的演示记录；真实资料上的状态不受影响。</span></div>}{summary.blockingOperationCount > 0 && <div className="destructive-note blocked"><strong>当前不能清理</strong><span>有 {summary.blockingOperationCount} 个关联任务或批次正在执行，请等待结束后重新打开本确认框。</span></div>}<label className="destructive-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>我确认只需要保留真实资料，并清除以上演示资料。</span></label><div className="modal-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button danger" onClick={onConfirm} disabled={!acknowledged || summary.blockingOperationCount > 0}>清除演示资料</button></div></div></div>
}

function Avatar({ name, src, large = false }: { name: string; src: string | null; large?: boolean }): JSX.Element {
  return <span className={`avatar ${large ? 'large' : ''}`}>{src ? <img src={src} alt=""/> : name.slice(0, 1)}</span>
}
