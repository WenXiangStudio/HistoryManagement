// @vitest-environment jsdom
import {act,createElement,memo} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import CreatorName,{CreatorNameProvider,CreatorNameOption,useCreatorNameAppearance} from './CreatorName'
import type {CreatorListItem} from '../../shared/contracts'
import {calendarWeek} from '../../shared/calendarWeek'
it('notifies only the changed identity when one priority is saved or an equivalent IPC snapshot arrives',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const container=document.createElement('div'),root=createRoot(container),renders=vi.fn()
  const Probe=memo(({secUid}:{secUid:string})=>{const appearance=useCreatorNameAppearance({profileUrl:`https://www.douyin.com/user/${secUid}`});renders(secUid);return createElement('span',null,appearance.priority?.tier)})
  const children=['one','two','three'].map(secUid=>createElement(Probe,{key:secUid,secUid}))
  const rows=['one','two','three'].map(secUid=>({profileUrl:`https://www.douyin.com/user/${secUid}`,refreshPriority:{mode:null,tier:null,revision:0}})) as CreatorListItem[]
  const render=(creators:CreatorListItem[])=>createElement(CreatorNameProvider,{owner:'owner',creators,children})
  try{
    await act(async()=>root.render(render(rows)));renders.mockClear()
    const changed=rows.map((creator,index)=>index===1?{...creator,refreshPriority:{mode:'boost' as const,tier:'active' as const,revision:1}}:creator)
    await act(async()=>root.render(render(changed)))
    expect(renders.mock.calls.map(([secUid])=>secUid)).toEqual(['two'])
    renders.mockClear();await act(async()=>root.render(render(structuredClone(changed))))
    expect(renders).not.toHaveBeenCalled()
    await act(async()=>root.render(render(rows)))
    expect(renders.mock.calls.map(([secUid])=>secUid)).toEqual(['two'])
  }finally{await act(async()=>root.unmount());vi.unstubAllGlobals()}
})
it('matches global names by identity within the current owner, never by a duplicate nickname',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const container=document.createElement('div'),root=createRoot(container)
  const rows=[{nickname:'同名博主',profileUrl:'https://www.douyin.com/user/one',nativeUid:'uid1',refreshPriority:{mode:'boost',tier:'active',revision:1}},
    {nickname:'同名博主',profileUrl:'https://www.douyin.com/user/two',nativeUid:'uid2',refreshPriority:{mode:null,tier:null,revision:0}}] as CreatorListItem[]
  const render=(creators:CreatorListItem[])=>createElement(CreatorNameProvider,{owner:'owner',creators,children:[
    createElement(CreatorName,{key:'one',name:'同名博主',profileUrl:'https://www.douyin.com/user/one/?tab=post'}),
    createElement(CreatorName,{key:'two',name:'同名博主',profileUrl:'https://www.douyin.com/user/two'}),
    createElement(CreatorName,{key:'uid',name:'新昵称',nativeUid:'uid1'}),
    createElement(CreatorName,{key:'foreign',name:'同名博主',nativeUid:'uid1',ownerSecUid:'other'})]})
  try{
    await act(async()=>root.render(render(rows)));expect(container.querySelectorAll('.creator-priority-name')).toHaveLength(2)
    expect([...container.children].map(el=>el.getAttribute('data-priority'))).toEqual(['boost',null,'boost',null])
    await act(async()=>root.render(render(rows.map(row=>({...row,refreshPriority:{mode:null,tier:null,revision:2}})))))
    expect(container.querySelectorAll('.creator-priority-name')).toHaveLength(0)
  }finally{await act(async()=>root.unmount());vi.unstubAllGlobals()}
})

it('keeps manual priority purple ahead of global no-update red, restores red when disabled, and excludes unknown or foreign creators',async()=>{
  vi.useFakeTimers();vi.setSystemTime('2026-10-09T04:00:00Z');vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const container=document.createElement('div'),root=createRoot(container),week=calendarWeek()
  const activity={weekStart:week.start,weekEndExclusive:week.endExclusive,weeklyStatus:'empty',weeklyUpdateCount:0,recentActivity:{status:'empty',checkedAt:'2026-10-09T04:00:00Z',latestPublishedAt:'2026-09-01T00:00:00Z'}}
  const rows=[
    {profileUrl:'https://www.douyin.com/user/empty',nativeUid:'empty-uid',activity,refreshPriority:{mode:'boost',tier:'active',revision:1}},
    {profileUrl:'https://www.douyin.com/user/plain',activity},
    {profileUrl:'https://www.douyin.com/user/pending',activity:{...activity,weeklyStatus:'pending',weeklyUpdateCount:null,recentActivity:{status:'unknown',checkedAt:null,latestPublishedAt:null}}},
    {profileUrl:'https://www.douyin.com/user/partial',activity:{...activity,weeklyStatus:'partial',recentActivity:{status:'unknown',checkedAt:null,latestPublishedAt:null}}},
    {profileUrl:'https://www.douyin.com/user/expired',activity:{...activity,weekStart:calendarWeek('2026-10-01').start,recentActivity:{status:'updated',checkedAt:'2026-10-02T04:00:00Z',latestPublishedAt:'2026-10-01T04:00:00Z'}}},
    {profileUrl:'https://www.douyin.com/user/demo',activity,isDemo:true}
  ] as CreatorListItem[]
  const render=(creators=rows)=>createElement(CreatorNameProvider,{owner:'owner',creators,children:[
    ...creators.map((row,index)=>createElement(CreatorName,{key:index,name:'同名博主',profileUrl:row.profileUrl,priority:row.refreshPriority})),
    createElement(CreatorName,{key:'uid',name:'已改名',nativeUid:'empty-uid'}),
    createElement(CreatorName,{key:'foreign',name:'同名博主',nativeUid:'empty-uid',ownerSecUid:'other'}),
    createElement('select',{key:'select'},createElement(CreatorNameOption,{name:'同名博主',value:'empty',nativeUid:'empty-uid'}))]})
  try{
    await act(async()=>root.render(render()))
    expect(container.querySelectorAll('.creator-no-updates-name')).toHaveLength(1)
    expect(container.querySelector('.creator-priority-option')).not.toBeNull()
    expect(container.querySelectorAll('.creator-priority-name')).toHaveLength(2)
    expect(container.firstElementChild?.getAttribute('data-priority')).toBe('boost')
    await act(async()=>root.render(render(rows.map(row=>({...row,refreshPriority:{mode:null,tier:null,revision:2}})))))
    expect(container.querySelectorAll('.creator-no-updates-name')).toHaveLength(3)
    expect(container.querySelector('.creator-no-updates-option')).not.toBeNull()
    expect(container.querySelector('.creator-priority-name')).toBeNull()
    await act(async()=>root.render(render()))
    // Calendar rollover does not rewrite the last successful seven-day verification.
    await act(async()=>{vi.setSystemTime('2026-10-11T15:59:59Z');window.dispatchEvent(new Event('focus'))})
    await act(async()=>vi.advanceTimersByTimeAsync(1000))
    expect(container.querySelectorAll('.creator-no-updates-name')).toHaveLength(1)
    expect(container.querySelectorAll('.creator-priority-name')).toHaveLength(2)
    expect(container.querySelector('.creator-priority-option')).not.toBeNull()
  }finally{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals()}
})
