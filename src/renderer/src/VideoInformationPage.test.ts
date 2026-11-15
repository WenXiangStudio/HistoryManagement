// @vitest-environment jsdom
import {createElement,act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,vi,afterEach} from 'vitest'
import VideoInformationPage from './VideoInformationPage'
import {videoInformationFixture} from '../../shared/fixtures/videoInformationFixture'
import type {CreatorListItem} from '../../shared/contracts'
import type {VideoLibraryView} from '../../shared/videoInformation'
import type {VideoClassification} from '../../shared/videoWorkflow'

let root:Root|undefined,element:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;element?.remove();vi.unstubAllGlobals()})
const creator={id:-1,nickname:'测试博主',profileUrl:'https://www.douyin.com/user/author-sec',nativeUid:'author-uid'} as CreatorListItem
const second={...creator,id:-2,nickname:'另一位博主',profileUrl:'https://www.douyin.com/user/second-sec',nativeUid:'second-uid'}
function data():VideoLibraryView {
  const {command,capture,time}=videoInformationFixture()
  return {ownerSecUid:command.ownerSecUid,state:{phase:'idle',runId:null,ownerSecUid:command.ownerSecUid,creatorId:null,message:''},records:[
    {...capture.work,checkedAt:time,firstCollectedAt:time,runId:command.runId,sourceKind:'native-network'},
    {...capture.work,workId:'7000000000000000002',authorSecUid:'second-sec',authorUid:'second-uid',title:'第二条视频',description:'独立正文',checkedAt:time,firstCollectedAt:time,runId:'second-run',sourceKind:'native-network'}]}
}
async function mount(input:{focus?:{creatorId:number;revision:number}|null;onOpenWorkshop?:(workId:string)=>void}={focus:null}){
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  element=document.createElement('div');document.body.append(element);root=createRoot(element)
  const open=vi.fn()
  await act(async()=>root!.render(createElement(VideoInformationPage,{creators:[creator,second],ownerSecUid:'owner-sec',canCollect:true,onOpenCreator:open,focus:null,...input})))
  return open
}
function mockLibrary(value=data()){
  const collect=vi.fn()
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{collectVideoInformation:collect,getVideoLibrary:async()=>value}})
  return collect
}
it('shows all saved videos and exact counts, switches detail without collecting, and links back to the author',async()=>{
  const collect=mockLibrary(),open=await mount()
  expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(2)
  expect(element!.textContent).toContain('12,345');expect(element!.textContent).toContain('未取得')
  expect(element!.querySelector('.video-library-description')?.textContent).toBe('完整发布文案\n保留第二行')
  await act(async()=>element!.querySelector<HTMLButtonElement>('[data-work-id="7000000000000000002"]')!.click())
  expect(element!.querySelector('.video-library-description')?.textContent).toBe('独立正文')
  await act(async()=>element!.querySelector<HTMLButtonElement>('.video-library-author button')!.click())
  expect(open).toHaveBeenCalledWith(second);expect(collect).not.toHaveBeenCalled()
})
it('a creator-card entry filters by stable identity and can return to all videos',async()=>{
  mockLibrary();await mount({focus:{creatorId:-2,revision:1}})
  expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(1)
  expect(element!.querySelector('.video-library-title')?.textContent).toBe('第二条视频')
  await act(async()=>element!.querySelector<HTMLButtonElement>('.video-library-list-heading button')!.click())
  expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(2)
})
it('search matches full text and produces an empty state without requesting platform data',async()=>{
  const collect=mockLibrary();await mount()
  const input=element!.querySelector<HTMLInputElement>('[aria-label="搜索视频"]')!
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!
  await act(async()=>{set.call(input,'独立正文');input.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(1)
  await act(async()=>{set.call(input,'不存在的文案');input.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(0);expect(element!.textContent).toContain('没有匹配的视频');expect(collect).not.toHaveBeenCalled()
})
it('rejects a response from another account',async()=>{
  const other=data();other.ownerSecUid='foreign';mockLibrary(other);await mount()
  expect(element!.textContent).toContain('资料账号已变化');expect(element!.querySelectorAll('[data-work-id]')).toHaveLength(0)
})
it('classifies selected works locally without any cloud processing or interest side effects',async()=>{
  const value=data();value.runtime={ready:true,pythonAvailable:true,asrAvailable:true,ocrAvailable:true,summaryAvailable:false,localSummaryValidated:false,triageAvailable:true,message:''}
  mockLibrary(value);const classify=vi.fn(async()=>({id:'triage'})),process=vi.fn(),interest=vi.fn()
  Object.assign(window.signalDesk,{classifyVideoWorks:classify,processVideoWorks:process,setVideoInterest:interest})
  await mount()
  await act(async()=>element!.querySelector<HTMLInputElement>('.video-selectable-row input')!.click())
  await act(async()=>[...element!.querySelectorAll('button')].find(b=>b.textContent?.startsWith('分类选中'))!.click())
  expect(classify).toHaveBeenCalledWith({ownerSecUid:'owner-sec',workIds:[data().records[0].workId],clickedAt:expect.any(Number)})
  expect(process).not.toHaveBeenCalled();expect(interest).not.toHaveBeenCalled()
  expect(element!.textContent).not.toContain('单模型转写与摘要')
})
it('interest actions use the backend route without choosing models or asking for confirmation',async()=>{
  mockLibrary();const interest=vi.fn(async()=>{}),process=vi.fn(),confirm=vi.spyOn(window,'confirm')
  Object.assign(window.signalDesk,{setVideoInterest:interest,startVideoWorkflow:process,processVideoWorks:process})
  await mount()
  await act(async()=>[...element!.querySelectorAll('.video-interest-actions button')].find(b=>b.textContent==='感兴趣')!.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  expect(interest).toHaveBeenCalledWith('owner-sec',data().records[0].workId,'interested')
  expect(process).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();vi.restoreAllMocks()
})
const classification=(code:VideoClassification['code']):VideoClassification=>({code,ruleVersion:'test',sourceSha256:'test-source',strength:'较强',basis:{speechPercent:80,speechBinCoverage:1,retainedTextFrames:0,sampledFrames:8},frames:[],timing:{},asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false})
it.each(['speech','visual_text'] as const)('starts processing a marked %s video only through the explicit button',async code=>{
  const value=data();value.records[0].content={interest:'interested',stages:{},classification:classification(code)}
  mockLibrary(value);const process=vi.fn(async()=>[]),interest=vi.fn()
  Object.assign(window.signalDesk,{startVideoWorkflow:process,setVideoInterest:interest})
  await mount()
  expect(process).not.toHaveBeenCalled()
  expect(element!.querySelector('[data-testid=manual-video-processing]')?.textContent).toContain('需手动开始')
  await act(async()=>element!.querySelector<HTMLButtonElement>('[data-testid=start-video-workflow]')!.click())
  expect(process).toHaveBeenCalledWith({ownerSecUid:'owner-sec',workIds:[value.records[0].workId]})
  expect(interest).not.toHaveBeenCalled()
})
it.each(['pending','visual',null] as const)('requires classification or manual viewing instead of starting processing for %s',async code=>{
  const value=data();value.records[0].content={interest:'interested',stages:{},classification:code?classification(code):undefined}
  mockLibrary(value);const process=vi.fn();Object.assign(window.signalDesk,{startVideoWorkflow:process})
  await mount()
  expect(element!.querySelector<HTMLButtonElement>('[data-testid=start-video-workflow]')?.disabled).toBe(true)
  expect(process).not.toHaveBeenCalled()
})
it('keeps interest marking in place and opens saved history only through its explicit button',async()=>{
  const value=data();mockLibrary(value);const enter=vi.fn();let saved!:()=>void
  const pending=new Promise<void>(resolve=>{saved=resolve})
  Object.assign(window.signalDesk,{setVideoInterest:vi.fn(async()=>{await pending;value.records[0].content={interest:'interested',stages:{}}})})
  await mount({onOpenWorkshop:enter})
  await act(async()=>[...element!.querySelectorAll<HTMLButtonElement>('.video-interest-actions button')].find(b=>b.textContent==='感兴趣')!.click())
  expect(enter).not.toHaveBeenCalled()
  expect([...element!.querySelectorAll('button')].find(b=>b.textContent==='查看历史资料')).toBeUndefined()
  await act(async()=>saved())
  expect(enter).not.toHaveBeenCalled()
  expect(element!.textContent).toContain('新的视频处理任务请在视频工坊粘贴地址')
  await act(async()=>[...element!.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='查看历史资料')!.click())
  expect(enter).toHaveBeenCalledWith(data().records[0].workId)
})
it('stays in video information when the interest write fails or the work is marked not interested',async()=>{
  mockLibrary();const enter=vi.fn(),save=vi.fn().mockRejectedValueOnce(Error('保存失败')).mockResolvedValue(undefined)
  Object.assign(window.signalDesk,{setVideoInterest:save})
  await mount({onOpenWorkshop:enter})
  await act(async()=>[...element!.querySelectorAll<HTMLButtonElement>('.video-interest-actions button')].find(b=>b.textContent==='感兴趣')!.click())
  expect(enter).not.toHaveBeenCalled();expect(element!.querySelector('[role=alert]')?.textContent).toContain('保存失败')
  await act(async()=>[...element!.querySelectorAll<HTMLButtonElement>('.video-interest-actions button')].find(b=>b.textContent==='不感兴趣')!.click())
  expect(enter).not.toHaveBeenCalled()
})
