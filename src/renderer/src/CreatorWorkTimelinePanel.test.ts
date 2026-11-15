// @vitest-environment jsdom
import {createElement,act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,vi,afterEach} from 'vitest'
import CreatorWorkTimelinePanel from './CreatorWorkTimelinePanel'
import type {CreatorTimelineView} from '../../shared/creatorWorkTimeline'
let root:Root|undefined,element:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());element?.remove();vi.unstubAllGlobals()})
it('loads cumulative timestamp-ordered records only when expanded, preserves invalid labels and their original publication times',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const view:CreatorTimelineView={ownerSecUid:'owner',creatorSecUid:'sec',count:1,countCheckedAt:'2026-10-14T10:00:00Z',lastSnapshotId:2,latest:{workId:'700000002',publishedAt:'2026-10-12T08:00:00Z'},
    works:[{workId:'700000001',publishedAt:'2026-08-02T08:00:00Z',pinned:true,firstSeenAt:'2026-10-06T10:00:00Z',lastSeenAt:'2026-10-13T10:00:00Z',state:'invalid',invalidatedAt:'2026-10-14T10:00:00Z',invalidReason:'missing-in-covered-range'},
      {workId:'700000002',publishedAt:'2026-10-12T08:00:00Z',pinned:false,firstSeenAt:'2026-10-13T10:00:00Z',lastSeenAt:'2026-10-14T10:00:00Z',state:'active',invalidatedAt:null,invalidReason:null}],
    observation:{checkedAt:'2026-10-14T10:00:00Z',timeBaseline:'2026-10-12T08:00:00Z',previousCount:2,currentCount:1,countChange:-1,newWorkIds:[],historicalWorkIds:[],invalidatedWorkIds:['700000001'],restoredWorkIds:[],coverage:'complete',coverageStart:null,newWorksComplete:true,sampledPublicCount:1}}
  const get=vi.fn(async()=>view)
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getCreatorWorkTimeline:get}})
  element=document.createElement('div');document.body.append(element);root=createRoot(element)
  await act(async()=>root!.render(createElement(CreatorWorkTimelinePanel,{owner:'owner',creatorId:-1,observation:view.observation!,invalidCount:1})))
  expect(get).not.toHaveBeenCalled()
  await act(async()=>{const details=element!.querySelector('details')!;details.open=true;details.dispatchEvent(new Event('toggle'))})
  expect(get).toHaveBeenCalledWith('owner',-1)
  expect(element.querySelectorAll('li')).toHaveLength(2)
  expect(element.querySelector('li')?.className).toBe('invalid');expect(element.querySelector('li')?.textContent).toContain('已失效')
  expect(element.querySelector('li')?.querySelector('time')?.textContent).toContain('2026/8/2')
  expect(element.textContent).toContain('继续参与间隔计算')
})
