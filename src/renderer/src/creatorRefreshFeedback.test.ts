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
import {effectiveCreatorTier} from '../../shared/creatorRefreshPolicy'
import {videoInformationFixture} from '../../shared/fixtures/videoInformationFixture'

const now='2026-10-07T04:00:00.000Z'
const week=calendarWeek(now)
let root:Root,container:HTMLDivElement,rows:CreatorListItem[],state:FollowingSyncState,dataChanged:(event?:unknown)=>void
let runNumber:number
const startRefresh=vi.fn()
const setPriority=vi.fn()
const setInterest=vi.fn()
const priorityRenders=vi.hoisted(()=>vi.fn())
vi.mock('./CreatorPriorityControls',async()=>{
  const original=await vi.importActual<typeof import('./CreatorPriorityControls')>('./CreatorPriorityControls')
  return {default:(props:Parameters<typeof original.default>[0])=>{priorityRenders(props.creator.id);return createElement(original.default,props)}}
})

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
  state={...state,activity:{...state.activity!,phase:'completed',done:1,succeeded:1,failed:0,remainingIds:[],...run}}
  await publish()
}
const toast=()=>container.querySelector('[data-testid="toast"]')?.textContent??''

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(now)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('ResizeObserver',class {observe():void{} unobserve():void{} disconnect():void{}})
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}})
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true}})
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false}})
  runNumber=0;rows=[creator()]
  const dataListeners=new Set<(event?:unknown)=>void>()
  dataChanged=event=>{for(const listener of dataListeners)listener(event)}
  state={phase:'idle',runId:null,message:'',count:1,ownerSecUid:'test-owner',extensionDirectory:null,reportDirectory:null,
    databasePath:'',setupUrl:null,connection:{online:true,version:'0.7.9',expectedVersion:'0.7.9'},
    readiness:{phase:'ready',preparationId:'test-preparation',message:'已准备'},activity:activity()}
  startRefresh.mockReset().mockImplementation(async()=>{
    state={...state,activity:activity({phase:'running',runId:`run-${++runNumber}`,total:1,remainingIds:[-1],startedAt:now})}
    return state
  })
  setPriority.mockReset().mockImplementation(async input=>{
    rows=rows.map(row=>new URL(row.profileUrl).pathname.split('/').at(-1)===input.secUid?{...row,refreshPriority:{mode:input.mode,tier:input.mode?adjustedCreatorTier(effectiveCreatorTier(row),input.mode):null,revision:(row.refreshPriority?.revision??0)+1}}:row)
    return rows.find(row=>new URL(row.profileUrl).pathname.split('/').at(-1)===input.secUid)!.refreshPriority
  })
  setInterest.mockReset().mockImplementation(async input=>{
    const row=rows.find(row=>new URL(row.profileUrl).pathname.split('/').at(-1)===input.secUid)!
    const interest={tier:input.tier,revision:(row.interest?.revision??0)+1}
    rows=rows.map(item=>item===row?{...item,interest}:item)
    dataChanged({source:'creator-interest',ownerSecUid:input.ownerSecUid,secUid:input.secUid,interest});return interest
  })
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{
    getDashboard:async()=>({followingCount:1,workCount:0,unreadCount:0,commentCount:0,analyzedCount:0,queuedJobs:0,connectorOnline:true,lastSyncAt:null}),
    listInbox:async()=>[],listCreators:async(search?:string)=>search?rows.filter(row=>row.nickname.includes(search)):rows,listJobs:async()=>[],getSettings:async()=>null,
    getFollowingSyncStatus:async()=>state,getFollowingConfiguration:async()=>null,
    getVideoLibrary:async()=>({ownerSecUid:'test-owner',records:[],contentBatches:[],state:{phase:'idle'}}),
    onDataChanged:(callback:(event?:unknown)=>void)=>{dataListeners.add(callback);return()=>{dataListeners.delete(callback)}},onWorkerSetupProgress:()=>()=>{},
    refreshCreatorActivity:startRefresh,ackCreatorActivityRendered:async()=>state.activity,updateCreatorPriority:setPriority,updateCreatorInterest:setInterest,
    updateCreator:vi.fn(async(id,input,owner)=>{
      const row=rows.find(row=>row.id===id)!,event={source:'creator-annotation',ownerSecUid:owner,secUid:new URL(row.profileUrl).pathname.split('/').at(-1),revision:1,isStarred:input.isStarred??row.isStarred,note:input.note??row.note}
      rows=rows.map(row=>row.id===id?{...row,isStarred:event.isStarred,note:event.note}:row);return event
    })
  }})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})

describe('manual creator refresh feedback',()=>{
  it('keeps unadded creators outside the three interest sections without starting a refresh',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位',profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount('active')
    await clickRefresh('[data-testid=creator-view-interest]')
    expect(container.querySelector('[data-testid=creator-view-interest]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid=creator-view-activity]')?.getAttribute('aria-pressed')).toBe('false')
    expect([...container.querySelectorAll<HTMLButtonElement>('.creator-section-switch button')].map(button=>button.textContent)).toEqual(['高0','中0','弱0'])
    expect(container.querySelector('[data-testid=creator-zone-interest-high]')?.textContent).toContain('仅展示手动添加')
    const refresh=container.querySelector<HTMLButtonElement>('[data-testid=refresh-interest-high]')!
    expect(refresh.disabled).toBe(true);expect(refresh.textContent).toContain('0')
    await clickRefresh('[data-testid=creator-section-interest-medium]')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-interest-medium]')?.disabled).toBe(true)
    await clickRefresh('[data-testid=creator-view-activity]')
    expect(container.querySelector('[data-testid=creator-section-active]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid=refresh-active-creators]')).not.toBeNull()
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('adds only the chosen creator from the picker, moves and removes membership while retaining activity, stars and notes',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位',profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount();const list=vi.spyOn(window.signalDesk,'listCreators')
    await clickRefresh('[data-testid=creator-view-interest]');await clickRefresh('[data-testid=add-interest-creators]')
    expect(container.querySelector('dialog')?.open).toBe(true)
    await clickRefresh('[data-creator-id="-1"] [data-testid=add-creator-interest]')
    expect(setInterest).toHaveBeenCalledWith({ownerSecUid:'test-owner',secUid:'test-sec',tier:'high',revision:0})
    expect(container.querySelector('[data-creator-id="-1"] [data-testid=add-creator-interest]')?.textContent).toBe('已添加')
    await clickRefresh('dialog .creator-interest-picker-heading button')
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('1 位')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    const select=container.querySelector<HTMLSelectElement>('[data-testid=creator-interest-select]')!
    await act(async()=>{select.value='weak';select.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('0 位')
    await clickRefresh('[data-testid=creator-section-interest-weak]')
    expect(container.querySelector('[data-testid=creator-zone-interest-weak-count]')?.textContent).toBe('1 位')
    await clickRefresh('[data-testid=remove-creator-interest]')
    expect(container.querySelector('[data-testid=creator-zone-interest-weak-count]')?.textContent).toBe('0 位')
    expect(rows[0]).toMatchObject({isStarred:true,note:'保留的批注',interest:{tier:null,revision:3}})
    expect(rows[1].interest).toBeUndefined();expect(list).not.toHaveBeenCalled()
    await clickRefresh('[data-testid=creator-view-activity]');await clickSection('dormant')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(2)
  })
  it('keeps an addition uncommitted on failure and disables only the pending creator',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位',profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount();await clickRefresh('[data-testid=creator-view-interest]');await clickRefresh('[data-testid=add-interest-creators]')
    let reject:(reason:Error)=>void=()=>{}
    setInterest.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail}))
    await clickRefresh('[data-creator-id="-1"] [data-testid=add-creator-interest]')
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-1"] [data-testid=add-creator-interest]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-2"] [data-testid=add-creator-interest]')?.disabled).toBe(false)
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('0 位')
    await act(async()=>reject(Error('保存失败')))
    expect(toast()).toBe('保存失败');expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('0 位')
    await clickRefresh('[data-creator-id="-1"] [data-testid=add-creator-interest]')
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('1 位')
  })
  it('refreshes only eligible members of the selected interest group across the whole account regardless of search',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位',profileUrl:'https://www.douyin.com/user/second-sec'},{...creator(),id:-3,nickname:'第三位',profileUrl:'https://www.douyin.com/user/third-sec'},
      {...creator({baselineStatus:'missing'}),id:-4,nickname:'异常博主',profileUrl:'https://www.douyin.com/user/anomaly-sec'}]
    rows=rows.map((row,index)=>({...row,interest:{tier:index===2?'medium':'high',revision:1}}))
    await mount();await clickRefresh('[data-testid=creator-view-interest]')
    await act(async()=>{const input=container.querySelector<HTMLInputElement>('[placeholder="搜索博主、领域或你的批注"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'测试博主');input.dispatchEvent(new Event('input',{bubbles:true}));await vi.advanceTimersByTimeAsync(250)})
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('1 位')
    expect(container.querySelector('[data-testid=refresh-interest-high]')?.textContent).toContain('2')
    await clickRefresh('[data-testid=refresh-interest-high]')
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,[-1,-2])
  })
  it('retains interest against a delayed older snapshot and ignores stale and foreign events',async()=>{
    await mount();let finish:(value:CreatorListItem[])=>void=()=>{}
    vi.spyOn(window.signalDesk,'listCreators').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await publish()
    const event={source:'creator-interest',ownerSecUid:'test-owner',secUid:'test-sec',interest:{tier:'medium',revision:2}}
    await act(async()=>dataChanged(event));await act(async()=>finish(rows))
    await act(async()=>dataChanged({...event,interest:{tier:'high',revision:1}}))
    await act(async()=>dataChanged({...event,ownerSecUid:'other-owner',interest:{tier:'weak',revision:3}}))
    await clickRefresh('[data-testid=creator-view-interest]');await clickRefresh('[data-testid=creator-section-interest-medium]')
    expect(container.querySelector('[data-testid=creator-zone-interest-medium-count]')?.textContent).toBe('1 位')
  })
  it('bounds the picker to twenty simple rows and searches the account library independently of page search',async()=>{
    rows=Array.from({length:25},(_,index)=>({...creator(),id:-index-1,nickname:`博主${index}`,profileUrl:`https://www.douyin.com/user/sec${index}`}))
    await mount();await clickRefresh('[data-testid=creator-view-interest]');await clickRefresh('[data-testid=add-interest-creators]')
    expect(container.querySelectorAll('.creator-interest-picker-row')).toHaveLength(20)
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button=>button.textContent==='下一页')!.click())
    expect(container.querySelectorAll('.creator-interest-picker-row')).toHaveLength(5)
    await act(async()=>{const input=container.querySelector<HTMLInputElement>('dialog input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'sec24');input.dispatchEvent(new Event('input',{bubbles:true}))})
    expect(container.querySelectorAll('.creator-interest-picker-row')).toHaveLength(1)
    expect(container.querySelector('.creator-interest-picker-row')?.textContent).toContain('博主24')
  })
  it('closes the picker on account change and ignores an old account save that finishes later',async()=>{
    await mount();await clickRefresh('[data-testid=creator-view-interest]');await clickRefresh('[data-testid=add-interest-creators]')
    let finish:(value:any)=>void=()=>{}
    setInterest.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await clickRefresh('[data-testid=add-creator-interest]')
    state={...state,ownerSecUid:'another-owner'};await publish()
    expect(container.querySelector('dialog')).toBeNull()
    await act(async()=>finish({tier:'high',revision:1}))
    await clickRefresh('[data-testid=creator-view-interest]')
    expect(container.querySelector('[data-testid=creator-zone-interest-high-count]')?.textContent).toBe('0 位')
    expect(toast()).not.toContain('已加入')
  })
  it('saves stars locally without a global busy lock or full snapshot reload',async()=>{
    rows=[creator(),{...creator(),id:-2,profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount()
    const list=vi.spyOn(window.signalDesk,'listCreators'),dashboard=vi.spyOn(window.signalDesk,'getDashboard')
    let finish:(value:unknown)=>void=()=>{}
    vi.mocked(window.signalDesk.updateCreator).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await clickRefresh('[data-creator-id="-1"] .star-button')
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-1"] .star-button')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-2"] .star-button')?.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-2"] [data-testid=creator-priority-boost]')?.disabled).toBe(false)
    await act(async()=>finish({source:'creator-annotation',ownerSecUid:'test-owner',secUid:'test-sec',revision:1,isStarred:false,note:'保留的批注'}))
    expect(container.querySelector('[data-creator-id="-1"] .star-button')?.textContent).toBe('星标')
    expect(list).not.toHaveBeenCalled();expect(dashboard).not.toHaveBeenCalled()
  })
  it('preserves a note draft after a failed save and closes the editor only after a confirmed write',async()=>{
    await mount();await clickRefresh('.creator-note')
    const textarea=container.querySelector('textarea')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'待保存批注');textarea.dispatchEvent(new Event('input',{bubbles:true}))})
    vi.mocked(window.signalDesk.updateCreator).mockRejectedValueOnce(Error('保存失败'))
    await clickRefresh('.note-editor button:last-child')
    expect(container.querySelector('textarea')?.value).toBe('待保存批注');expect(toast()).toBe('保存失败')
    await clickRefresh('.note-editor button:last-child')
    expect(container.querySelector('textarea')).toBeNull();expect(container.querySelector('.creator-note')?.textContent).toBe('待保存批注')
  })
  it('retains a confirmed annotation against a delayed older full read and ignores foreign or stale annotation events',async()=>{
    await mount();let finish:(value:CreatorListItem[])=>void=()=>{}
    vi.spyOn(window.signalDesk,'listCreators').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await publish()
    const event={source:'creator-annotation',ownerSecUid:'test-owner',secUid:'test-sec',revision:2,isStarred:false,note:'新批注'}
    await act(async()=>dataChanged(event));await act(async()=>finish(rows))
    await act(async()=>dataChanged({...event,revision:1,note:'旧批注'}))
    await act(async()=>dataChanged({...event,ownerSecUid:'another-owner',revision:3,note:'其他账号'}))
    expect(container.querySelector('.creator-note')?.textContent).toBe('新批注')
  })
  it('filters the single retained snapshot locally without fetching a second creator directory',async()=>{
    await mount();const list=vi.spyOn(window.signalDesk,'listCreators')
    await act(async()=>{const input=container.querySelector<HTMLInputElement>('[placeholder="搜索博主、领域或你的批注"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'没有这个名字');input.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>vi.advanceTimersByTimeAsync(250))
    expect(container.querySelector('.creator-card')).toBeNull();expect(list).not.toHaveBeenCalled()
  })
  it('accepts a later externally edited annotation after the in-flight snapshot guard expires',async()=>{
    await mount()
    await act(async()=>dataChanged({source:'creator-annotation',ownerSecUid:'test-owner',secUid:'test-sec',revision:1,isStarred:false,note:'本地批注'}))
    rows=rows.map(row=>({...row,isStarred:false,note:'后续外部编辑'}))
    await publish()
    expect(container.querySelector('.creator-note')?.textContent).toBe('后续外部编辑')
  })
  it('keeps interest marking in video information and opens its saved history explicitly without creating a new workshop task',async()=>{
    const {capture,time}=videoInformationFixture()
    const work={...capture.work,authorSecUid:'test-sec',checkedAt:time,firstCollectedAt:time,runId:'saved-video',sourceKind:'native-network' as const,content:{interest:'unmarked' as 'unmarked'|'interested'|'not-interested',stages:{}}}
    const library={ownerSecUid:'test-owner',records:[work],state:{phase:'idle' as const,runId:null,ownerSecUid:'test-owner',creatorId:null,message:''}}
    window.signalDesk.getVideoLibrary=vi.fn(async()=>library)
    window.signalDesk.setVideoInterest=vi.fn(async(_owner,id,interest)=>{expect(id).toBe(work.workId);work.content.interest=interest;dataChanged();return library})
    await mount(null)
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='视频信息')!.click())
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.video-interest-actions button')].find(button=>button.textContent==='感兴趣')!.click())
    expect(container.querySelector('nav .active span')?.textContent).toBe('视频信息')
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='查看历史资料')!.click())
    expect(container.querySelector('nav .active span')?.textContent).toBe('视频工坊')
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('历史资料')
    expect(container.querySelector('[data-testid=workshop-detail]')?.getAttribute('data-work-id')).toBe(work.workId)
    expect(container.querySelector('[data-testid=workshop-total]')?.textContent).toBe('1条')
    expect(container.querySelector('[data-testid=saved-workshop-history]')?.textContent).not.toContain('待分类')
    expect(container.querySelector('[data-testid=saved-workshop-history] .video-classification')).toBeNull()
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='视频信息')!.click())
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.video-interest-actions button')].find(button=>button.textContent==='不感兴趣')!.click())
    expect(container.querySelector('nav .active span')?.textContent).toBe('视频信息')
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='视频工坊')!.click())
    expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('新建处理')
    expect(container.querySelector('[data-testid=workshop-total]')).toBeNull()
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button=>button.textContent==='历史资料')!.click())
    expect(container.querySelector('[data-testid=workshop-total]')?.textContent).toBe('0条')
  })
  it('explains a detached following read as incomplete and separates this run from the accumulated creator count',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位'}]
    state={...state,phase:'blocked',runId:'following-run',count:140,totalCount:302,message:'本轮已停止（Detached while handling command.），已保存资料保留。',errorCode:'Detached while handling command.',
      plan:{runId:'following-run',complete:false,count:140,pageCount:7,nextCursor:100,nextOffset:0,resumable:true,checkedAt:now}}
    await mount(null)
    expect(container.querySelector('[data-testid=following-sync-status]')?.textContent).toContain('浏览器读取连接中断')
    expect(container.textContent).toContain('本轮已读取并保存 140 位 · 资料库累计保留 2 位')
    expect(container.textContent).toContain('本地关注清单尚未完成')
    expect([...container.querySelectorAll('button')].some(b=>b.textContent==='继续关注清单')).toBe(true)
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('groups missing baselines as anomalies, explains the reason, excludes them from ordinary refresh and offers initial repair',async()=>{
    rows=[creator({baselineStatus:'missing'}),{...creator({baselineStatus:'ready'}),id:-2,nickname:'已核验作者'}]
    await mount('dormant')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    expect(container.querySelector('[data-testid=refresh-creator-activity]')?.textContent).toBe('全量更新1')
    await clickSection('anomaly')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    expect(container.querySelector('[data-testid=creator-baseline-missing]')?.textContent).toContain('尚未建立本地作品基线')
    expect(container.querySelector('[data-testid=creator-anomaly-detail]')).toBeNull()
    expect(container.querySelector('[data-testid=refresh-one-creator]')?.textContent).toBe('核验并补齐')
    expect(container.querySelector('[data-testid=select-creator-refresh]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-boost]')?.disabled).toBe(true)
    expect(container.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent).toBe('一键核验并补齐1')
    await clickRefresh()
    await complete({baselineStatus:'ready'},{repair:true})
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    await clickSection('dormant')
    expect(container.querySelector('[data-testid=creator-baseline-missing]')).toBeNull()
    expect(container.querySelector('[data-testid=creator-current-refresh]')).not.toBeNull()
  })
  const observation={checkedAt:'2026-10-06T04:00:00.000Z',timeBaseline:'2026-10-05T10:40:00.000Z',previousCount:211,currentCount:213,countChange:2,
    newWorkIds:['700000001','700000002'],historicalWorkIds:[],invalidatedWorkIds:[],restoredWorkIds:[],coverage:'time-range' as const,
    coverageStart:'2026-10-04T04:00:00.000Z',newWorksComplete:true,sampledPublicCount:20}
  it('dates saved observations without treating a stored completed run as a current refresh',async()=>{
    rows=[creator({workObservation:observation})]
    state={...state,activity:activity({phase:'completed',runId:'old-run',total:1,done:1,succeeded:1,startedAt:now})}
    await mount()
    const result=container.querySelector('[data-testid=creator-time-observation]')!
    expect(result.textContent).toContain('最近采集结果 · 2026-10-06 12:00')
    expect(result.textContent).toContain('新增作品 2 条')
    expect(result.textContent).not.toContain('本次读取到')
    expect(result.classList.contains('refreshed-this-run')).toBe(false)
    expect(container.querySelector('[data-testid=creator-current-refresh]')).toBeNull()
    expect(result.querySelector('details summary')?.textContent).toContain('统计区间与累计作品记录')
    expect(result.querySelector('details')?.textContent).toContain('发布时间晚于')
  })
  it('marks only successfully saved participants during a batch and retains their badges if a later participant fails',async()=>{
    rows=[creator({workObservation:observation,lastAttemptAt:observation.checkedAt}),
      {...creator({workObservation:observation,lastAttemptAt:observation.checkedAt}),id:-2,nickname:'第二位'},
      {...creator({workObservation:observation}),id:-3,nickname:'未参与'}]
    startRefresh.mockImplementation(async()=>{
      state={...state,activity:activity({phase:'running',runId:`run-${++runNumber}`,total:2,remainingIds:[-1,-2],startedAt:now})};return state
    })
    await mount();await clickRefresh('[data-testid=refresh-creator-activity]')
    expect(container.querySelector('[data-testid=creator-current-refresh]')).toBeNull()
    rows=rows.map(row=>row.id===-1?{...row,activity:{...row.activity!,lastAttemptAt:'2026-10-07T04:00:01.000Z',workObservation:{...observation,checkedAt:'2026-10-07T04:00:01.000Z'}}}:row)
    state={...state,activity:{...state.activity!,done:1,succeeded:1,remainingIds:[-2]}}
    await publish()
    expect(container.querySelectorAll('[data-testid=creator-current-refresh]')).toHaveLength(1)
    expect(container.querySelector('[data-creator-id="-1"] [data-testid=creator-current-refresh]')?.textContent).toBe('本轮已刷新')
    expect(container.querySelector('[data-creator-id="-2"] [data-testid=creator-current-refresh]')).toBeNull()
    expect(container.querySelector('[data-creator-id="-3"] [data-testid=creator-current-refresh]')).toBeNull()
    rows=rows.map(row=>row.id===-2?{...row,activity:{...row.activity!,lastAttemptAt:'2026-10-07T04:00:02.000Z',errorCode:'READ_FAILED'}}:row)
    state={...state,activity:{...state.activity!,phase:'blocked',done:2,failed:1}}
    await publish()
    expect(container.querySelectorAll('[data-testid=creator-current-refresh]')).toHaveLength(1)
    await clickRefresh('[data-testid=refresh-creator-activity]')
    expect(container.querySelector('[data-testid=creator-current-refresh]')).toBeNull()
  })
  it('clears current-round badges on leaving the library and does not restore them on return',async()=>{
    rows=[creator({workObservation:observation})];await mount();await clickRefresh()
    await complete({workObservation:{...observation,checkedAt:'2026-10-07T04:00:01.000Z'}})
    expect(container.querySelector('[data-testid=creator-current-refresh]')).not.toBeNull()
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.startsWith('今日收件箱'))!.click())
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.startsWith('博主资料库'))!.click())
    await clickSection('dormant')
    expect(container.querySelector('[data-testid=creator-time-observation]')?.textContent).toContain('最近采集结果')
    expect(container.querySelector('[data-testid=creator-current-refresh]')).toBeNull()
    expect(container.querySelector('[data-testid=creator-refresh-success]')).toBeNull()
  })
  it('offers one-click anomaly repair for the whole account even while search hides part of the group, disables during running, and keeps cancel available',async()=>{
    const anomaly={detectedAt:now,baselineSnapshotId:1,comparison:{previousCount:638,currentCount:680,increase:42,newPublicWorks:18,overlapWorks:0,anchorFound:false,listEnded:false,completePublicList:false,connected:false,reasons:['count-jump','missing-new-works','history-gap']}}
    const a=creator({anomaly:anomaly as any}),b={...creator({anomaly:anomaly as any}),id:-2,nickname:'另一个异常博主',profileUrl:'https://www.douyin.com/user/other-sec'}
    rows=[a,b,creator()];await mount('anomaly')
    expect(container.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent).toBe('一键核验并补齐2')
    const input=container.querySelector<HTMLInputElement>('.search-box input')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'测试博主');input.dispatchEvent(new Event('input',{bubbles:true}));await vi.advanceTimersByTimeAsync(250)})
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    expect(container.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent).toBe('一键核验并补齐2')
    await clickRefresh('[data-testid=refresh-anomaly-creators]')
    expect(startRefresh).toHaveBeenCalledWith(undefined,false,undefined,'anomaly')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-anomaly-creators]')?.disabled).toBe(true)
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='取消刷新')?.disabled).toBe(false)
  })
  it('disables one-click repair when the anomaly group is empty or the connector is unavailable',async()=>{
    await mount('anomaly')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-anomaly-creators]')?.disabled).toBe(true)
    rows=[creator({anomaly:{detectedAt:now,comparison:{previousCount:10,currentCount:30,increase:20,newPublicWorks:5,connected:false}} as any})];state={...state,connection:{online:false,version:'0.7.9',expectedVersion:'0.7.9'}}
    await publish()
    expect(container.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent).toBe('一键核验并补齐1')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=refresh-anomaly-creators]')?.disabled).toBe(true)
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('reports completed anomaly repairs and offers remaining work without claiming incomplete repairs succeeded',async()=>{
    const anomaly={detectedAt:now,comparison:{previousCount:10,currentCount:30,increase:20,newPublicWorks:5,connected:false}}
    rows=[creator({anomaly:anomaly as any})];await mount('anomaly')
    await clickRefresh('[data-testid=refresh-anomaly-creators]')
    await complete({anomaly:null},{repair:true,scope:'anomaly',remainingIds:[]})
    expect(toast()).toBe('核验并补齐完成，1 位博主核验通过')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(0)
    rows=[creator({anomaly:anomaly as any})];state={...state,activity:activity()};await publish()
    await clickRefresh('[data-testid=refresh-anomaly-creators]')
    await complete({anomaly:anomaly as any},{repair:true,scope:'anomaly',succeeded:0,failed:1,remainingIds:[-1],anomalyCount:1})
    expect(toast()).toBe('核验并补齐结束，0 位通过，1 位未完成')
    expect(container.querySelectorAll('.creator-card')).toHaveLength(1)
    expect([...container.querySelectorAll('button')].some(b=>b.textContent==='继续剩余 1 位')).toBe(true)
  })
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
  it('moves one tier per click across all four groups and restores automatic classification explicitly',async()=>{
    rows=[{...creator({publicationInterval:{workCount:2,gapCount:1,meanHours:40*24,earliestPublishedAt:now,latestPublishedAt:now}}),nickname:'连续调档博主'}]
    await mount('dormant')
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-reduce]')?.disabled).toBe(true)
    for(const section of ['inactive','regular','active'] as const){
      await clickRefresh('[data-testid=creator-priority-boost]')
      await clickSection(section)
      expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe({active:'高频',regular:'中频',inactive:'低频'}[section])
      expect(container.querySelector('.creator-card h3 .creator-priority-name')?.textContent).toBe('连续调档博主')
      expect(container.querySelector('.creator-card')?.textContent).toContain('保留的批注')
    }
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-boost]')?.disabled).toBe(true)
    for(const section of ['regular','inactive','dormant'] as const){
      await clickRefresh('[data-testid=creator-priority-reduce]')
      await clickSection(section)
      expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe({regular:'中频',inactive:'低频',dormant:'极低频'}[section])
    }
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-reduce]')?.disabled).toBe(true)
    await clickRefresh('[data-testid=creator-priority-boost]');await clickSection('inactive')
    await clickRefresh('[data-testid=creator-priority-reset]');await clickSection('dormant')
    expect(container.querySelector('[data-testid=creator-priority-reset]')).toBeNull()
    expect(container.querySelector('.creator-card h3 .creator-priority-name')).toBeNull()
    expect(setPriority.mock.calls.map(([input])=>input.mode)).toEqual(['boost','boost','boost','reduce','reduce','reduce','boost',null])
    expect(setPriority.mock.calls.map(([input])=>input.revision)).toEqual([0,1,2,3,4,5,6,7])
    expect(startRefresh).not.toHaveBeenCalled()
  })
  it('retains the old priority on save failure and prevents changes during refresh',async()=>{
    await mount();setPriority.mockRejectedValueOnce(Error('保存失败，请重试'))
    await clickRefresh('[data-testid=creator-priority-boost]')
    expect(toast()).toBe('保存失败，请重试');expect(container.querySelector('.creator-card h3 .creator-priority-name')).toBeNull()
    expect(container.querySelector('[data-testid=creator-priority-state]')?.textContent).toBeUndefined()
    state={...state,activity:activity({phase:'running'})};await publish()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-boost]')?.disabled).toBe(true)
  })
  it('updates confirmed priority without reloading unrelated data and disables only the saving creator',async()=>{
    rows=[creator(),{...creator(),id:-2,nickname:'第二位博主',profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount()
    const dashboard=vi.spyOn(window.signalDesk,'getDashboard'),list=vi.spyOn(window.signalDesk,'listCreators')
    let finish:(value:any)=>void=()=>{}
    setPriority.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({mode:'reduce',tier:'dormant',revision:1})
    await clickRefresh('[data-creator-id="-1"] [data-testid=creator-priority-reduce]')
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-1"] [data-testid=creator-priority-reduce]')?.disabled).toBe(true)
    expect(container.querySelector('[data-creator-id="-1"] [data-testid=creator-priority]')?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector<HTMLButtonElement>('[data-creator-id="-2"] [data-testid=creator-priority-reduce]')?.disabled).toBe(false)
    expect(container.querySelector('[data-creator-id="-1"] [data-testid=creator-priority-state]')?.textContent).toBeUndefined()
    await clickRefresh('[data-creator-id="-2"] [data-testid=creator-priority-reduce]')
    await act(async()=>finish({mode:'reduce',tier:'dormant',revision:1}))
    expect(setPriority).toHaveBeenCalledTimes(2)
    expect(dashboard).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled()
    for(const id of [-1,-2]){
      expect(container.querySelector(`[data-creator-id="${id}"] [data-testid=creator-priority-state]`)?.textContent).toBe('手动设置')
      expect(container.querySelector(`[data-creator-id="${id}"]`)?.textContent).toContain('保留的批注')
    }
  })
  it('keeps unchanged cards out of priority, selection and periodic full-refresh renders',async()=>{
    rows=Array.from({length:40},(_,index)=>({...creator(),id:-(index+1),profileUrl:`https://www.douyin.com/user/sec${index}`}))
    await mount()
    const list=vi.spyOn(window.signalDesk,'listCreators')
    priorityRenders.mockClear()
    await clickRefresh('[data-creator-id="-1"] [data-testid=select-creator-refresh]')
    expect(priorityRenders.mock.calls.map(([id])=>id)).toEqual([-1])
    priorityRenders.mockClear()
    rows=structuredClone(rows)
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(list).not.toHaveBeenCalled()
    expect(priorityRenders).not.toHaveBeenCalled()
    await act(async()=>dataChanged({source:'creator-priority',ownerSecUid:'test-owner',secUid:'sec0',priority:{mode:'reduce',tier:'dormant',revision:1}}))
    expect(priorityRenders.mock.calls.map(([id])=>id)).toEqual([-1])
    priorityRenders.mockClear()
    await act(async()=>dataChanged({source:'creator-priority',ownerSecUid:'test-owner',secUid:'sec0',priority:{mode:'boost',tier:'regular',revision:2}}))
    // Only the viewport rows may be regrouped; the other creators stay out of the DOM.
    expect(container.querySelector('[data-testid=creator-zone-dormant-count]')?.textContent).toBe('39 位')
    expect(container.querySelectorAll('.creator-card').length).toBeLessThanOrEqual(8)
    expect(priorityRenders.mock.calls.length).toBeLessThanOrEqual(8)
  })
  it('keeps active collection fallback polling and reloads the library on foreground or generic data changes',async()=>{
    await mount()
    const list=vi.spyOn(window.signalDesk,'listCreators')
    state={...state,activity:activity({phase:'running',runId:'running-without-event'})}
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(list).toHaveBeenCalledTimes(1)
    state={...state,activity:{...state.activity!,phase:'completed'}}
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(list).toHaveBeenCalledTimes(2)
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(list).toHaveBeenCalledTimes(2)
    await act(async()=>window.dispatchEvent(new Event('focus')))
    expect(list).toHaveBeenCalledTimes(3)
    await publish();expect(list).toHaveBeenCalledTimes(4)
  })
  it('applies scoped priority events to the matching identity and ignores older or other-account events without a full reload',async()=>{
    rows=[creator(),{...creator(),id:-2,profileUrl:'https://www.douyin.com/user/second-sec'}]
    await mount()
    const dashboard=vi.spyOn(window.signalDesk,'getDashboard')
    const event={source:'creator-priority',ownerSecUid:'test-owner',secUid:'second-sec',priority:{mode:'reduce',tier:'dormant',revision:2}}
    await act(async()=>dataChanged({...event,ownerSecUid:'another-owner'}))
    expect(container.querySelector('[data-creator-id="-2"] [data-testid=creator-priority-state]')?.textContent).toBeUndefined()
    await act(async()=>dataChanged(event))
    expect(container.querySelector('[data-creator-id="-2"] [data-testid=creator-priority-state]')?.textContent).toBe('手动设置')
    expect(container.querySelector('[data-creator-id="-1"] [data-testid=creator-priority-state]')?.textContent).toBeUndefined()
    await act(async()=>dataChanged({...event,priority:{mode:null,tier:null,revision:1}}))
    expect(container.querySelector('[data-creator-id="-2"] [data-testid=creator-priority-state]')?.textContent).toBe('手动设置')
    expect(dashboard).not.toHaveBeenCalled()
  })
  it('retains a confirmed priority when an older full-directory read completes later',async()=>{
    await mount()
    let finish:(value:CreatorListItem[])=>void=()=>{}
    vi.spyOn(window.signalDesk,'listCreators').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await publish()
    await act(async()=>dataChanged({source:'creator-priority',ownerSecUid:'test-owner',secUid:'test-sec',priority:{mode:'reduce',tier:'dormant',revision:1}}))
    await act(async()=>finish(rows))
    expect(container.querySelector('[data-testid=creator-priority-state]')?.textContent).toBe('手动设置')
    expect(container.querySelector('[data-testid=creator-effective-tier]')?.textContent).toBe('极低频')
  })
  it('does not apply a late saved priority or success toast to a newly selected account',async()=>{
    await mount()
    let finish:(value:any)=>void=()=>{}
    setPriority.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await clickRefresh('[data-testid=creator-priority-reduce]')
    state={...state,ownerSecUid:'another-owner'};await publish();await clickSection('dormant')
    await act(async()=>finish({mode:'reduce',tier:'dormant',revision:1}))
    expect(container.querySelector('[data-testid=creator-priority-state]')?.textContent).toBeUndefined()
    expect(toast()).not.toContain('已降权')
  })
  it('allows priority changes with a completed collection and independent video processing, then unlocks immediately after a new collection finishes',async()=>{
    state={...state,phase:'completed',activity:activity({phase:'completed',runId:'finished-baseline',done:1,total:1,succeeded:1}),
      videoInformation:{phase:'running',runId:'independent-video',ownerSecUid:'test-owner',creatorId:-1,message:'读取视频信息'}}
    await mount()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-reduce]')?.disabled).toBe(false)
    await clickRefresh('[data-testid=creator-priority-reduce]')
    expect(setPriority).toHaveBeenCalledWith({ownerSecUid:'test-owner',secUid:'test-sec',mode:'reduce',revision:0})
    expect(toast()).toContain('已降权')
    state={...state,activity:activity({phase:'running',runId:'next-refresh',total:1,remainingIds:[-1]})};await publish()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-reduce]')?.disabled).toBe(true)
    state={...state,activity:{...state.activity!,phase:'completed',done:1,succeeded:1,remainingIds:[]}};await publish()
    expect(container.querySelector<HTMLButtonElement>('[data-testid=creator-priority-reset]')?.disabled).toBe(false)
    await clickRefresh('[data-testid=creator-priority-reset]')
    expect(setPriority).toHaveBeenLastCalledWith({ownerSecUid:'test-owner',secUid:'test-sec',mode:null,revision:1})
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
    expect(card.querySelector('[data-testid="creator-refresh-success"]')?.textContent).toBe('本轮已刷新')
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
  it('opens video information as a peer page from a creator card and returns to that creator section',async()=>{
    window.signalDesk.getVideoLibrary=vi.fn().mockResolvedValue({ownerSecUid:'test-owner',records:[],state:{phase:'idle',runId:null,ownerSecUid:'test-owner',creatorId:null,message:''}})
    await mount()
    await clickRefresh('[data-testid="open-video-information"]')
    expect(container.querySelector('nav .active')?.textContent).toBe('视频信息')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector<HTMLSelectElement>('[aria-label="筛选博主"]')?.value).toBe('-1')
    expect(container.querySelector('[data-testid="following-sync-status"]')).toBeNull()
    const back=[...container.querySelectorAll<HTMLButtonElement>('.video-library-empty-detail button')].find(button=>button.textContent==='查看博主资料')!
    await act(async()=>back.click())
    expect(container.querySelector('nav .active')?.textContent).toContain('博主资料库')
    expect(container.querySelector('.creator-card h3')?.textContent).toContain('测试博主')
    const nav=[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='视频信息')!
    await act(async()=>nav.click())
    expect(container.querySelector<HTMLSelectElement>('[aria-label="筛选博主"]')?.value).toBe('-1')
  })
})
