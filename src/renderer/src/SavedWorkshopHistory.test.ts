// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {CreatorListItem} from '../../shared/contracts'
import type {VideoLibraryView} from '../../shared/videoInformation'
import type {VideoClassification} from '../../shared/videoWorkflow'
import {videoInformationFixture} from '../../shared/fixtures/videoInformationFixture'
import SavedWorkshopHistory from './SavedWorkshopHistory'

let root:Root,container:HTMLDivElement,library:VideoLibraryView,changed:()=>void
const creator={id:-1,nickname:'工坊博主',profileUrl:'https://www.douyin.com/user/author-sec'} as CreatorListItem
const frame=vi.fn(),interest=vi.fn(),classify=vi.fn(),process=vi.fn(),open=vi.fn()
const classification:VideoClassification={code:'speech',ruleVersion:'v1',sourceSha256:'source-hash',strength:'strong',basis:{speechPercent:90,speechBinCoverage:1,retainedTextFrames:8,sampledFrames:8},
  frames:Array.from({length:8},(_,i)=>({id:'frame-'+i,timeMs:i*1000,path:'source/'+i+'.jpg',sha256:'hash-'+i})),timing:{},asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false}
const props=(owner='owner-sec',focus:null|{workId:string;revision:number}=null)=>({ownerSecUid:owner,creators:[creator],focus,onOpenVideos:open})
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const {capture,command,time}=videoInformationFixture()
  const work={...capture.work,checkedAt:time,firstCollectedAt:time,runId:command.runId,sourceKind:'native-network' as const}
  library={ownerSecUid:'owner-sec',state:{phase:'idle',runId:null,ownerSecUid:'owner-sec',creatorId:null,message:''},records:[
    {...work,content:{interest:'interested',stages:{}}},
    {...work,workId:'7000000000000000002',title:'未标记作品',content:{interest:'unmarked',stages:{}}},
    {...work,workId:'7000000000000000003',title:'不感兴趣作品',content:{interest:'not-interested',stages:{}}}]}
  const listeners=new Set<()=>void>();changed=()=>{for(const f of listeners)f()}
  frame.mockReset().mockImplementation(async(_owner,id,frameId)=>({id:frameId,timeMs:0,dataUrl:'data:image/jpeg;base64,AA=='}))
  interest.mockReset();classify.mockReset();process.mockReset();open.mockReset()
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getVideoLibrary:vi.fn(async()=>library),
    onDataChanged:(callback:()=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)},getClassificationFrame:frame,
    setVideoInterest:interest,classifyVideoWorks:classify,processVideoWorks:process}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
async function mount(input=props()){await act(async()=>root.render(createElement(SavedWorkshopHistory,input)))}

it('collects an interested work immediately without requiring any classification or processing state',async()=>{
  await mount()
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(1)
  expect(container.querySelector('[data-testid=workshop-total]')?.textContent).toBe('1条')
  expect(container.querySelector('.video-library-description')?.textContent).toContain('保留第二行')
  expect(container.textContent).not.toContain('未标记作品');expect(container.textContent).not.toContain('不感兴趣作品')
  expect(interest).not.toHaveBeenCalled();expect(classify).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled()
})

it('displays saved screenshots and base information without exposing classification, review or processing results',async()=>{
  library.records[0].content={interest:'interested',classification,stages:{classification:{state:'completed',updatedAt:'now'},body:{state:'running',updatedAt:'now'},research:{state:'failed',updatedAt:'now',error:'private-stage-error'}},
    body:{text:'独立正文不能进入工坊',source:'doubao-flash',sourceSha256:'source-hash',classificationHash:'route',modelVersion:'model',generatedAt:'now',needsReview:true,limitations:[]}}
  await mount()
  expect(frame).toHaveBeenCalledTimes(8)
  expect(container.querySelectorAll('.triage-frames img')).toHaveLength(8)
  for(const text of ['待分类','处理中','待人工审核','已完成','口播主导','独立正文不能进入工坊','private-stage-error'])expect(container.textContent).not.toContain(text)
  expect(container.querySelector('.video-classification')).toBeNull();expect(container.querySelector('.video-stage-status')).toBeNull()
})

it('focuses the selected video on entry and supports search using base fields',async()=>{
  library.records.push({...library.records[0],workId:'7000000000000000004',title:'刚选择的作品'})
  await mount(props('owner-sec',{workId:'7000000000000000004',revision:1}))
  expect(container.querySelector('[data-testid=workshop-detail]')?.getAttribute('data-work-id')).toBe('7000000000000000004')
  const input=container.querySelector<HTMLInputElement>('[aria-label=搜索工坊作品]')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'刚选择');input.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(1)
})

it('removes a cancelled interest from display and restores a single card when the same work is interested again',async()=>{
  await mount()
  library.records[0].content!.interest='not-interested';await act(async()=>changed())
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(0)
  library.records[0].content!.interest='interested';await act(async()=>changed())
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(1)
  expect(library.records).toHaveLength(3)
})

it('ignores a late response from the previous account after an owner switch',async()=>{
  let resolveOld!:(value:VideoLibraryView)=>void
  const oldRequest=new Promise<VideoLibraryView>(resolve=>{resolveOld=resolve})
  const next={...library,ownerSecUid:'next-owner',records:[{...library.records[0],workId:'8000000000000000001',title:'另一个账号的作品'}]}
  window.signalDesk.getVideoLibrary=vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValue(next)
  await mount();await act(async()=>root.render(createElement(SavedWorkshopHistory,props('next-owner'))))
  expect(container.textContent).toContain('另一个账号的作品')
  await act(async()=>resolveOld(library))
  expect(container.textContent).toContain('另一个账号的作品');expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(1)
})

it('rejects a library response for a different owner',async()=>{
  library.ownerSecUid='other-owner';await mount()
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(0)
  expect(container.querySelector('[role=alert]')?.textContent).toContain('资料账号已变化')
})
