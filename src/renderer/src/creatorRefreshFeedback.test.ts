// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorListItem } from '../../shared/contracts'
import type { CreatorActivityState } from '../../shared/creatorActivity'
import type { FollowingSyncState } from '../../shared/followingDirectory'
import { calendarWeek } from '../../shared/calendarWeek'
import App from './App'
import {adjustedCreatorTier} from '../../shared/creatorPriority'
import {creatorRefreshTier} from '../../shared/creatorRefreshPolicy'

const now='2026-10-07T04:00:00.000Z'
const week=calendarWeek(now)
let root:Root,container:HTMLDivElement,rows:CreatorListItem[],state:FollowingSyncState,dataChanged:()=>void
let runNumber:number
const startRefresh=vi.fn()
const setPriority=vi.fn()

function activity(input:Partial<CreatorActivityState>={}):CreatorActivityState{
  return {phase:'idle',runId:null,message:'更新作品总数与本周动态',total:0,done:0,succeeded:0,failed:0,
    currentName:null,remainingIds:[],startedAt:null,weekStart:week.start,weekEndExclusive:week.endExclusive,...input}
}
function creator(input:Partial<NonNullable<CreatorListItem['activity']>>={}):CreatorListItem{
  return {id:-1,isDemo:false,platformCreatorId:'creator-1',nickname:'测试博主',avatarUrl:null,signature:'测试简介',
    profileUrl:'https://www.douyin.com/user/test-sec',isFollowing:true,isStarred:true,note:'保留的批注',domains:[],
    workCount:0,analyzedCount:0,lastPublishedAt:null,activity:{workCount:628,countCheckedAt:now,checkedAt:now,
      weeklyUpdateCount:1,weekStart:week.start,weekEndExclusive:week.endExclusive,latestPublishedAt:'2026-10-06T06:36:00.000Z',
      weeklyStatus:'updated',errorCode:null,lastAttemptAt:now,recentActivity:{status:'updated',checkedAt:now,latestPublishedAt:'2026-10-06T06:36:00.000Z'},...input}}
}
async function mount(section:'active'|'regular'|'inactive'|'dormant'|'anomaly'|null='dormant'):Promise<void>{
  await act(async()=>root.render(createElement(App)))
  const nav=[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.includes('博主资料库'))!
  await act(async()=>nav.click())
  if(section)await clickSection(section)
}
async function clickSection(section:'active'|'regular'|'inactive'|'dormant'|'anomaly'):Promise<void>{await clickRefresh(`[data-testid=creator-section-${section}]`)}
async function clickRefresh(selector='[data-testid="refresh-one-creator"]'):Promise<void>{
  await act(async()=>container.querySelector<HTMLButtonElement>(selector)!.click())
}
async function publish():Promise<void>{await act(async()=>dataChanged())}
async function complete(input:Partial<NonNullable<CreatorListItem['activity']>>={},run:Partial<CreatorActivityState>={}):Promise<void>{
  rows=[creator({lastAttemptAt:'2026-10-07T04:00:01.000Z',checkedAt:'2026-10-07T04:00:01.000Z',...input})]
  state={...state,activity:{...state.activity!,phase:'completed',done:1,succeeded:1,failed:0,...run}}
  await publish()
}
const toast=()=>container.querySelector('[data-testid="toast"]')?.textContent??''

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(now)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('ResizeObserver',class {observe():void{} unobserve():void{} disconnect():void{}})
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}})
  runNumber=0;rows=[creator()]
  state={phase:'idle',runId:null,message:'',count:1,ownerSecUid:'test-owner',extensionDirectory:null,reportDirectory:null,
    databasePath:'',setupUrl:null,connection:{online:true,version:'0.7.9',expectedVersion:'0.7.9'},
    readiness:{phase:'ready',preparationId:'test-preparation',message:'已准备'},activity:activity()}
  startRefresh.mockReset().mockImplementation(async()=>{
    state={...state,activity:activity({phase:'running',runId:`run-${++runNumber}`,total:1,remainingIds:[-1],startedAt:now})}
    return state
  })
  setPriority.mockReset().mockImplementation(async input=>{
    rows=rows.map(row=>new URL(row.profileUrl).pathname.split('/').at(-1)===input.secUid?{...row,refreshPriority:{mode:input.mode,tier:input.mode?adjustedCreatorTier(creatorRefreshTier(row.activity?.publicationInterval?.meanHours),input.mode):null,revision:(row.refreshPriority?.revision??0)+1}}:row)
    return rows.find(row=>new URL(row.profileUrl).pathname.split('/').at(-1)===input.secUid)!.refreshPriority
  })
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{
    getDashboard:async()=>({followingCount:1,workCount:0,unreadCount:0,commentCount:0,analyzedCount:0,queuedJobs:0,connectorOnline:true,lastSyncAt:null}),
    listInbox:async()=>[],listCreators:async(search?:string)=>search?rows.filter(row=>row.nickname.includes(search)):rows,listJobs:async()=>[],getSettings:async()=>null,
    getFollowingSyncStatus:async()=>state,getFollowingConfiguration:async()=>null,
    onDataChanged:(callback:()=>void)=>{dataChanged=callback;return()=>{}},onWorkerSetupProgress:()=>()=>{},
    refreshCreatorActivity:startRefresh,ackCreatorActivityRendered:async()=>state.activity,updateCreatorPriority:setPriority
  }})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})

describe('manual creator refresh feedback',()=>{
  it('keeps anomalies separate, excludes them from all refreshes, and offers individual repair without a success claim',async()=>{
    const anomaly={detectedAt:now,baselineSnapshotId:1,comparison:{previousCount:638,currentCount:680,increase:42,newPublicWorks:18,overlapWorks:0,anchorFound:false,listEnded:false,completePublicList:false,connected:false,reasons:['count-jump','missing-new-works','history-gap'] as const}}
    rows=[creator({anomaly:anomaly as any})]
    await mount('dormant')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    expect(container.querySelector('[data-testid=refresh-creator-activity]')?.textContent).toBe('全量更新0')
    expect(container.querySelector('.creator-section-switch [data-testid=creator-section-anomaly]')).toBeNull()
    await clickSection('anomaly')
    expect(container.querySelector('[data-testid=creator-anomaly-detail]')?.textContent).toContain('638 → 680')
    expect(container.querySelector('[data-testid=select-creator-refresh]')).toBeNull()
    expect(container.querySelector('[data-testid=refresh-one-creator]')?.textContent).toBe('核验并补齐')
    await clickRefresh();await complete({anomaly:anomaly as any},{anomalyCount:1})
    expect(startRefresh).toHaveBeenCalledWith(-1,false,undefined)
    expect(toast()).toContain('数据异常，待核验补齐')
    expect(container.querySelector('[data-testid=creator-refresh-success]')).toBeNull()
  })
  it('uses the last verified seven-day result independently of calendar week and moves stale high-frequency creators into the middle',async()=>{
    rows=[creator({publicationInterval:{meanHours:24,workCount:2,gapCount:1,earliestPublishedAt:now,latestPublishedAt:now},weeklyStatus:'empty',weeklyUpdateCount:0,
      recentActivity:{checkedAt:now,latestPublishedAt:'2026-10-04T04:00:00.000Z',status:'updated'}})]
    await mount('active')
    expect(container.querySelector('.creator-no-updates-name')).toBeNull()
    expect(container.querySelector('[data-testid=creator-last-update-reminder]')).toBeNull()
    await act(async()=>{vi.setSystemTime('2026-12-01T04:00:00Z');window.dispatchEvent(new Event('focus'))})
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    expect(container.querySelector('.creator-no-updates-name')).toBeNull()
    rows=[{...rows[0],activity:{...rows[0].activity!,recentActivity:{checkedAt:'2026-10-12T04:00:00.000Z',latestPublishedAt:'2026-10-04T04:00:00.000Z',status:'empty'}}}]
    await publish();expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    await clickSection('regular')
    expect(container.querySelector('.creator-no-updates-name')).not.toBeNull()
    expect(container.querySelector('[data-testid=creator-last-update-reminder]')).not.toBeNull()
    rows=[{...rows[0],activity:{...rows[0].activity!,recentActivity:{checkedAt:'2026-12-01T04:00:00.000Z',latestPublishedAt:'2026-10-04T04:00:00.000Z',status:'empty'}}}]
    await publish();expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    await clickSection('dormant')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('极低频')
    expect(container.querySelector('.creator-no-updates-name')).not.toBeNull()
    expect(container.querySelector('[data-testid=creator-last-update-reminder]')).not.toBeNull()
  })
  it('measures biography overflow only near the viewport and cancels measurements when the section changes',async()=>{
    let visibility:(visible:boolean)=>void=()=>{}
    const disconnect=vi.fn()
    vi.stubGlobal('IntersectionObserver',class {
      constructor(callback:IntersectionObserverCallback){visibility=visible=>callback([{isIntersecting:visible} as IntersectionObserverEntry],this as unknown as IntersectionObserver)}
      observe():void{}
      disconnect=disconnect
    })
    await mount()
    const paragraph=container.querySelector('[data-testid=creator-biography-text]')!
    const scrollHeight=vi.fn(()=>160),clientHeight=vi.fn(()=>60)
    Object.defineProperty(paragraph,'scrollHeight',{configurable:true,get:scrollHeight})
    Object.defineProperty(paragraph,'clientHeight',{configurable:true,get:clientHeight})
    await act(async()=>vi.advanceTimersByTimeAsync(32))
    expect(scrollHeight).not.toHaveBeenCalled()
    await act(async()=>{visibility(true);await vi.advanceTimersByTimeAsync(32)})
    expect(scrollHeight).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid=creator-biography-toggle]')?.textContent).toContain('展开简介')
    await act(async()=>visibility(false))
    await act(async()=>visibility(true))
    await clickSection('active')
    await act(async()=>vi.advanceTimersByTimeAsync(32))
    expect(scrollHeight).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalled()
  })
  it('waits for saved avatars to become available without requiring all cards to be opened',async()=>{
    class SavedAvatar extends EventTarget {src='';complete=false;naturalWidth=0;constructor(){super();images.push(this)}}
    const images:SavedAvatar[]=[]
    vi.stubGlobal('Image',SavedAvatar)
    rows=[{...creator(),avatarUrl:'file:///saved-avatar.jpg'}]
    state={...state,phase:'completed',runId:'following-complete',totalCount:1,timing:{startedAt:now}}
    const ack=vi.fn(async()=>state)
    window.signalDesk.ackFollowingRendered=ack
    await mount(null)
    await act(async()=>vi.advanceTimersByTimeAsync(20))
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    expect(ack).not.toHaveBeenCalled()
    await act(async()=>{const avatar=images.at(-1)!;avatar.complete=true;avatar.naturalWidth=80;avatar.dispatchEvent(new Event('load'))})
    expect(ack).toHaveBeenCalledExactlyOnceWith('following-complete',1)
  })
  it('waits for a section click, shows only its members and offers one matching update action',async()=>{
    rows=[24,14*24,30*24,null].map((meanHours,index)=>({...creator({publicationInterval:{workCount:2,gapCount:1,meanHours,earliestPublishedAt:now,latestPublishedAt:now}}),id:-(index+1),nickname:`博主${index}`}))
    await mount(null)
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    expect(container.querySelectorAll('.creator-section-refresh')).toHaveLength(0)
    for(const [section,ids,label] of [['active',[-1],'高频更新1'],['regular',[-2],'中频更新1'],['inactive',[-3],'低频更新1'],['dormant',[-4],'全量更新4']] as const){
      await clickSection(section)
      expect([...container.querySelectorAll<HTMLElement>('.creator-card')].map(card=>Number(card.dataset.creatorId))).toEqual(ids)
      expect(container.querySelectorAll('.creator-section-refresh')).toHaveLength(1)
      expect(container.querySelector('.creator-section-refresh')?.textContent).toBe(label)
      expect(container.querySelector(`[data-testid=creator-section-${section}]`)?.getAttribute('aria-pressed')).toBe('true')
    }
    expect(container.querySelector('[data-testid=creator-zone-dormant]')?.textContent).toContain('1 位待确认')
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('limits selected refreshes to the visible section while retaining card annotations across switches',async()=>{
    rows=[24,14*24].map((meanHours,index)=>({...creator({publicationInterval:{workCount:2,gapCount:1,meanHours,earliestPublishedAt:now,latestPublishedAt:now}}),id:-(index+1)}))
    await mount('active');await clickRefresh('[data-testid=select-creator-refresh]')
    await clickSection('regular')
    expect(container.querySelector('[data-testid=refresh-selected-creators]')).toBeNull()
    await clickRefresh('[data-testid=select-creator-refresh]')
    await clickRefresh('[data-testid=refresh-selected-creators]')
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,[-2])
    await clickSection('active')
    expect(container.querySelector('.creator-card')?.textContent).toContain('保留的批注')
    expect(container.querySelector('.creator-card')?.textContent).toContain('已星标')
  })
  it('shows automatic activity, toggles exclusive priorities with purple names, and updates group counts after confirmed saves',async()=>{
    rows=[{...creator({publicationInterval:{workCount:2,gapCount:1,meanHours:14*24,earliestPublishedAt:now,latestPublishedAt:now}}),nickname:'普通博主'}]
    await mount('regular')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('中频')
    expect(container.querySelector('[data-testid=creator-priority-boost]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid=refresh-regular-creators]')?.textContent).toBe('中频更新1')
    await clickRefresh('[data-testid=creator-priority-boost]')
    expect(setPriority).toHaveBeenCalledWith({ownerSecUid:'test-owner',secUid:'test-sec',mode:'boost',revision:0})
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    expect(container.querySelector('[data-testid=refresh-regular-creators]')?.textContent).toBe('中频更新0')
    await clickSection('active')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('高频')
    expect(container.querySelector('.creator-card h3 .creator-priority-name')?.textContent).toBe('普通博主')
    expect(container.querySelector('[data-testid=toast] .creator-priority-name')?.textContent).toBe('普通博主')
    expect(container.querySelector('[data-testid=refresh-active-creators]')?.textContent).toBe('高频更新1')
    await clickRefresh('[data-testid=creator-priority-boost]')
    await clickSection('regular')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('中频')
    expect(container.querySelector('.creator-card h3 .creator-priority-name')).toBeNull()
    await clickRefresh('[data-testid=creator-priority-reduce]')
    expect(container.querySelector('[data-testid=refresh-regular-creators]')?.textContent).toBe('中频更新0')
    await clickSection('inactive')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('低频')
    await clickRefresh('[data-testid=creator-priority-boost]')
    await clickSection('active')
    expect(container.querySelector('[data-testid=creator-priority-boost]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid=creator-priority-reduce]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('高频')
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('retains the old priority on save failure and prevents changes during refresh',async()=>{
    await mount();setPriority.mockRejectedValueOnce(Error('保存失败，请重试'))
    await clickRefresh('[data-testid=creator-priority-boost]')
    expect(toast()).toBe('保存失败，请重试');expect(container.querySelector('.creator-card h3 .creator-priority-name')).toBeNull()
    expect(container.querySelector('[data-testid=creator-priority-boost]')?.getAttribute('aria-pressed')).toBe('false')
    state={...state,activity:activity({phase:'running'})};await publish()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-boost]')?.disabled).toBe(true)
  })
  it.each(['active','regular','all'] as const)('starts %s for the entire account even when search matches nothing',async scope=>{
    rows=[0,7*24,7*24+1,14*24,30*24,null].map((meanHours,index)=>({...creator({publicationInterval:{workCount:meanHours===null?1:2,gapCount:meanHours===null?0:1,meanHours,earliestPublishedAt:now,latestPublishedAt:now}}),id:-(index+1),nickname:`博主${index}`,profileUrl:`https://www.douyin.com/user/sec${index}`}))
    rows.push({...rows[0],id:9,isDemo:true,nickname:'演示博主'})
    await mount(scope==='all'?'dormant':scope)
    expect(container.querySelector('.creator-section-refresh')?.textContent).toBe({active:'高频更新2',regular:'中频更新2',all:'全量更新6'}[scope])
    await act(async()=>{const element=container.querySelector<HTMLInputElement>('[placeholder="搜索博主、领域或你的批注"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,'没有这个博主');element.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>vi.advanceTimersByTimeAsync(250))
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    const selector=scope==='all'?'[data-testid=refresh-creator-activity]':`[data-testid=refresh-${scope}-creators]`
    expect(container.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(false)
    await clickRefresh(selector)
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,undefined,scope)
    expect(container.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(true)
    expect([...container.querySelectorAll('button')].some(button=>button.textContent==='取消刷新')).toBe(true)
  })
  it('disables empty frequency groups while allowing all to include unknown intervals',async()=>{
    await mount('active')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-active-creators]')?.disabled).toBe(true)
    await clickSection('regular')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-regular-creators]')?.disabled).toBe(true)
    await clickSection('dormant')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-creator-activity]')?.disabled).toBe(false)
  })
  it('shows each card interval in days and hours and updates it when new local results arrive',async()=>{
    rows=[creator({publicationInterval:{workCount:4,gapCount:3,meanHours:1312,earliestPublishedAt:'2026-04-25T16:00:00.000Z',latestPublishedAt:'2026-10-06T16:00:00.000Z'}})]
    await mount()
    expect(container.querySelector('[data-testid="creator-publication-interval-value"]')?.textContent).toBe('54天16小时')
    expect(container.querySelector('[data-testid="creator-publication-interval"]')?.textContent).toContain('依据 4 条已保存作品')
    rows=[creator({publicationInterval:{workCount:5,gapCount:4,meanHours:25,earliestPublishedAt:now,latestPublishedAt:now}})];await publish()
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    await clickSection('active')
    expect(container.querySelector('[data-testid="creator-publication-interval-value"]')?.textContent).toBe('1天1小时')
    rows=[creator({publicationInterval:{workCount:1,gapCount:0,meanHours:null,earliestPublishedAt:now,latestPublishedAt:now}})];await publish()
    await clickSection('dormant')
    expect(container.querySelector('[data-testid="creator-publication-interval-value"]')?.textContent).toBe('记录不足')
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('shows no updates and a success notice without changing the frequency section',async()=>{
    await mount()
    expect(container.querySelector('[data-testid="creator-zone-dormant"] .creator-card')).not.toBeNull()
    await clickRefresh()
    expect(startRefresh).toHaveBeenCalledWith(-1,false,undefined)
    expect(toast()).not.toContain('刷新成功')
    await complete({weeklyStatus:'empty',weeklyUpdateCount:0,latestPublishedAt:null,recentActivity:{status:'empty',checkedAt:now,latestPublishedAt:null}})
    const card=container.querySelector('[data-testid="creator-zone-dormant"] .creator-card')!
    expect(card.querySelector('[data-testid="creator-no-recent-updates"]')?.textContent).toBe('最近七天暂无更新')
    expect(card.querySelector('[data-testid="creator-last-update-reminder"]')?.textContent).toBe('上次更新日期：暂无可用日期')
    expect(card.querySelector('[data-testid="creator-weekly-update"]')?.hasAttribute('datetime')).toBe(false)
    expect(card.querySelector('[data-testid="creator-refresh-success"]')?.textContent).toBe('刷新成功')
    expect(toast()).toBe('测试博主刷新成功 · 最近七天暂无更新')
    expect(card.textContent).toContain('保留的批注')
    expect(card.textContent).toContain('已星标')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
  })

  it('shows the cross-week last publication in Beijing dates alongside no updates',async()=>{
    rows=[creator({weeklyStatus:'empty',weeklyUpdateCount:0,latestPublishedAt:null,recentActivity:{status:'empty',checkedAt:now,latestPublishedAt:'2026-09-27T16:30:00.000Z'},
      refreshSchedule:{tier:'active',intervalDays:1,lastCheckedAt:now,latestKnownPublishedAt:'2026-09-27T16:30:00.000Z',nextDueAt:'2026-10-07T16:00:00.000Z',due:false}})]
    await mount()
    const card=container.querySelector('[data-testid="creator-zone-dormant"] .creator-card')!
    expect(card.querySelector('[data-testid="creator-no-recent-updates"]')?.textContent).toBe('最近七天暂无更新')
    expect(card.querySelector('[data-testid="creator-last-update-reminder"]')?.textContent).toBe('上次更新日期：2026年9月28日')
    expect(card.querySelector('[data-testid="creator-last-update-reminder"]')?.classList.contains('creator-last-update-reminder')).toBe(true)
    expect(card.querySelector('[data-testid="creator-weekly-update"]')?.getAttribute('datetime')).toBe('2026-09-27T16:30:00.000Z')
    expect(card.querySelector('[data-testid="creator-weekly-count"]')?.textContent).toContain('0 条')
    expect(startRefresh).not.toHaveBeenCalled()
  })

  it('announces success for a new publication and retains the weekly count and date',async()=>{
    await mount();await clickRefresh()
    await complete({latestPublishedAt:'2026-10-07T03:00:00.000Z',weeklyUpdateCount:3,recentActivity:{status:'updated',checkedAt:now,latestPublishedAt:'2026-10-07T03:00:00.000Z'}})
    const card=container.querySelector('[data-testid="creator-zone-dormant"] .creator-card')!
    expect(card.querySelector('[data-testid="creator-weekly-count"]')?.textContent).toContain('3 条')
    expect(card.querySelector('[data-testid="creator-weekly-update"]')?.textContent).toBe('2026-10-07 11:00')
    expect(toast()).toBe('测试博主刷新成功')
    expect(card.querySelector('[data-testid="creator-refresh-success"]')).not.toBeNull()
  })

  it('does not classify pending, incomplete or expired data as no updates',async()=>{
    rows=[creator({weeklyStatus:'pending',weeklyUpdateCount:null,latestPublishedAt:null,checkedAt:null})]
    await mount()
    expect(container.querySelector('[data-testid="creator-no-recent-updates"]')).toBeNull()
    expect(container.querySelector('[data-testid="creator-weekly-count"]')?.textContent).toContain('待确认')
    rows=[creator({weeklyStatus:'partial',weeklyUpdateCount:null,latestPublishedAt:null})];await publish()
    expect(container.querySelector('[data-testid="creator-no-recent-updates"]')).toBeNull()
    expect(container.querySelector('[data-testid="creator-weekly-count"]')?.textContent).toContain('待确认')
    const previous=calendarWeek('2026-10-03T04:00:00.000Z')
    rows=[creator({weekStart:previous.start,weekEndExclusive:previous.endExclusive,weeklyStatus:'empty',weeklyUpdateCount:0,latestPublishedAt:null})]
    await publish()
    expect(container.querySelector('[data-testid="creator-no-recent-updates"]')).toBeNull()
    expect(container.querySelector('[data-testid="creator-weekly-count"]')?.textContent).toContain('待确认')
  })

  it('shows completion with missing data without claiming refresh success',async()=>{
    await mount();await clickRefresh()
    await complete({weeklyStatus:'partial',weeklyUpdateCount:null,latestPublishedAt:null,errorCode:'READ_FAILED'}, {succeeded:0,failed:1})
    expect(toast()).toBe('刷新结束，0 位成功，1 位资料待补齐')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
    expect(container.querySelector('[data-testid="creator-no-recent-updates"]')).toBeNull()
  })

  it('shows the stop reason and never announces success for blocked or cancelled runs',async()=>{
    await mount();await clickRefresh()
    state={...state,activity:{...state.activity!,phase:'blocked',message:'账号核验失败，资料刷新已停止'}};await publish()
    expect(toast()).toBe('账号核验失败，资料刷新已停止')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
    await clickRefresh()
    state={...state,activity:{...state.activity!,phase:'cancelled',message:'资料刷新已取消'}};await publish()
    expect(toast()).toBe('资料刷新已取消')
  })

  it('does not announce a stored completed run when opening the app',async()=>{
    state={...state,activity:activity({phase:'completed',runId:'old-run',total:1,done:1,succeeded:1})}
    await mount()
    expect(toast()).not.toContain('刷新成功')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
  })

  it('waits for this run\'s creator result before showing its no-update message',async()=>{
    rows=[creator({lastAttemptAt:'2026-10-06T04:00:00.000Z'})]
    await mount();await clickRefresh()
    state={...state,activity:{...state.activity!,phase:'completed',done:1,succeeded:1,failed:0}}
    await publish()
    expect(toast()).not.toContain('刷新成功')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
    await complete({weeklyStatus:'empty',weeklyUpdateCount:0,latestPublishedAt:null,recentActivity:{status:'empty',checkedAt:now,latestPublishedAt:null}})
    expect(toast()).toBe('测试博主刷新成功 · 最近七天暂无更新')
  })

  it('announces completion once per run and clears the old card success when refreshing again',async()=>{
    await mount();await clickRefresh();await complete()
    expect(toast()).toBe('测试博主刷新成功')
    await act(async()=>{vi.advanceTimersByTime(3500)})
    await publish()
    expect(toast()).toBe('')
    await clickRefresh()
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
    await complete({lastAttemptAt:'2026-10-07T04:00:02.000Z'})
    expect(toast()).toBe('测试博主刷新成功')
  })

  it('announces the batch result for all-creator refreshes',async()=>{
    await mount();await clickRefresh('[data-testid="refresh-creator-activity"]');await complete()
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,undefined,'all')
    expect(toast()).toBe('刷新成功，已更新 1 位博主资料')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
  })

  it('shows the due frequency and distinguishes a lightweight unchanged check from a full refresh',async()=>{
    rows=[creator({refreshSchedule:{tier:'inactive',intervalDays:14,lastCheckedAt:now,latestKnownPublishedAt:'2026-07-01T00:00:00.000Z',nextDueAt:'2026-10-13T16:00:00.000Z',due:false},
      refreshCheck:{checkedAt:now,reason:'count-unchanged',lastFullCheckedAt:'2026-10-06T04:00:00.000Z',basisWeekStart:week.start}})]
    await mount()
    expect(container.querySelector('[data-testid="creator-refresh-due-summary"]')?.textContent).toContain('0 位到期，1 位未到期')
    expect(container.querySelector('[data-testid="creator-refresh-schedule"]')?.textContent).toContain('低频 · 每 14 天检查')
    expect(container.querySelector('[data-testid="creator-refresh-unchanged"]')?.textContent).toContain('未更新 · 作品总数相同')
    expect(container.querySelector('[data-testid="creator-refresh-unchanged"]')?.textContent).toContain('动态沿用上次核验')
  })

  it('lets the all-creator button start a refresh when every creator is not due',async()=>{
    rows=[creator({refreshSchedule:{tier:'inactive',intervalDays:14,lastCheckedAt:now,latestKnownPublishedAt:'2026-07-01T00:00:00.000Z',nextDueAt:'2026-10-13T16:00:00.000Z',due:false}})]
    await mount()
    expect(container.querySelector('[data-testid="refresh-creator-activity"]')?.getAttribute('title')).toContain('包含未到期博主')
    await clickRefresh('[data-testid="refresh-creator-activity"]')
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,undefined,'all')
    expect(state.activity?.phase).toBe('running')
    expect(container.querySelector('[data-testid="creator-refresh-due-summary"]')?.textContent).toContain('分组更新包含未到期博主')
    expect(container.querySelector('[data-testid="creator-refresh-success"]')).toBeNull()
  })

  it('shows the batch wait and retains an enabled cancellation button',async()=>{
    await mount();await clickRefresh('[data-testid="refresh-creator-activity"]')
    state={...state,activity:{...state.activity!,waiting:{kind:'batch',until:'2026-10-07T04:04:00.000Z',durationMs:240000,batchNumber:2,totalBatches:9},plannedWaitingMs:240000}}
    await publish()
    expect(container.querySelector('[data-testid="creator-refresh-wait"]')?.textContent).toContain('批间休息 · 第 2/9 批')
    const cancel=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='取消刷新')!
    expect(cancel.disabled).toBe(false)
  })
})
