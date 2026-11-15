// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {VideoLibraryView} from '../../shared/videoInformation'
import type {WorkshopJob,WorkshopView} from '../../shared/videoWorkshop'
import type {WorkshopDeepResult,WorkshopDeepJob} from '../../shared/workshopDeep'
import type {VideoClassification} from '../../shared/videoWorkflow'
import {videoInformationFixture} from '../../shared/fixtures/videoInformationFixture'
import InformationWorkshopPage from './InformationWorkshopPage'

let root:Root,container:HTMLDivElement,library:VideoLibraryView
const getLibrary=vi.fn(),classify=vi.fn(),process=vi.fn(),testConnection=vi.fn(),open=vi.fn(),clipboard=vi.fn(),network=vi.fn()
const getWorkshop=vi.fn(),startWorkshop=vi.fn(),cancelWorkshop=vi.fn(),deepWorkshop=vi.fn(),getFrame=vi.fn(),ackDisplayed=vi.fn()
let workshop:WorkshopView,listeners:Set<()=>void>
const job=(change:Partial<WorkshopJob>={}):WorkshopJob=>({id:'job-1',url:'https://v.douyin.com/aBc123/',workId:null,title:null,authorName:null,phase:'downloading',message:'正在下载视频',createdAt:'2026-10-16T06:00:00.000Z',clickedAt:Date.parse('2026-10-16T06:00:00.000Z'),stageElapsedMs:{resolving:350},...change})
const view=(jobs:WorkshopJob[]):WorkshopView=>({jobs,running:jobs.some(item=>['resolving','downloading','classifying'].includes(item.phase)||['preparing','transcribing','recognizing','reporting'].includes(item.deep?.phase??'')),downloadRoot:'E:\\VideoDownload'})
const classification:VideoClassification={code:'speech',ruleVersion:'local-1',sourceSha256:'abc',strength:'本地检测到连续语音',basis:{speechPercent:83,speechBinCoverage:.83,retainedTextFrames:2,sampledFrames:6},frames:[],timing:{},asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false}
const ready=(change:Partial<WorkshopJob>={}):WorkshopJob=>job({phase:'completed',message:'已下载并完成本地分类',title:'已下载视频标题',classification,mediaPath:'E:\\VideoDownload\\video-workshop\\job-1\\source.mp4',...change})
const deep=(change:Partial<WorkshopDeepJob>={}):WorkshopDeepJob=>({phase:'transcribing',message:'正在调用豆包极速版',clickedAt:Date.now(),startedAt:new Date().toISOString(),...change})
const deepResult=():WorkshopDeepResult=>({sourceSha256:'abc',durationMs:20000,model:'Qwen/Qwen3.5-122B-A10B',promptVersion:'workshop-aligned-report/v1',generatedAt:'2026-10-16T06:03:00.000Z',speech:{state:'transcribed',text:'前一句。后一句。',segments:[{id:'speech-1',startMs:9250,endMs:10450,text:'前一句。'},{id:'speech-2',startMs:13210,endMs:15970,text:'后一句。'}],sourceSha256:'abc',durationMs:20000,model:'volc.bigasr.auc_turbo'},frames:[{id:'frame-1',timeMs:1500,path:'E:\\VideoDownload\\one.jpg',sha256:'one'},{id:'frame-2',timeMs:12567,path:'E:\\VideoDownload\\two.jpg',sha256:'two'},{id:'not-referenced',timeMs:19000,path:'E:\\VideoDownload\\unused.jpg',sha256:'unused'}],readings:[{frameId:'frame-1',timeMs:1500,text:'第一个画面文字',description:'第一张画面',uncertainties:[]},{frameId:'frame-2',timeMs:12567,text:'第二个画面文字',description:'第二张画面',uncertainties:['小字模糊']}],report:{overview:'基于原视频证据的全片总结',sections:[{id:'section-2',startMs:10000,endMs:20000,speechIds:['speech-1','speech-2'],frameIds:['frame-2'],title:'后半段',summary:'后半段要点',analysis:'依据第二张画面和对应语音的分析'},{id:'section-1',startMs:0,endMs:10000,speechIds:['speech-1'],frameIds:['frame-1'],title:'前半段',summary:'前半段要点',analysis:'依据第一张画面和对应语音的分析'}],limitations:['抽帧之间的瞬间动作未逐帧识别']},requests:[],timing:{preparationMs:10,transcriptionMs:20,recognitionMs:30,reportMs:40,processingMs:100},usage:{inputTokens:100,outputTokens:100}})
const props=(owner:string|null=null,focus:null|{workId:string;revision:number}=null)=>({ownerSecUid:owner,creators:[],focus,onOpenVideos:open})
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const {capture,command,time}=videoInformationFixture()
  const work={...capture.work,checkedAt:time,firstCollectedAt:time,runId:command.runId,sourceKind:'native-network' as const,content:{interest:'interested' as const,stages:{}}}
  library={ownerSecUid:'owner-sec',state:{phase:'idle',runId:null,ownerSecUid:'owner-sec',creatorId:null,message:''},records:[work]}
  getLibrary.mockReset().mockImplementation(async()=>library);classify.mockReset();process.mockReset();testConnection.mockReset();open.mockReset();clipboard.mockReset();network.mockReset()
  workshop=view([]);listeners=new Set();getWorkshop.mockReset().mockImplementation(async()=>workshop);startWorkshop.mockReset().mockImplementation(async()=>{workshop=view([job()]);return workshop});cancelWorkshop.mockReset().mockImplementation(async()=>{workshop=view([job({phase:'cancelled',message:'处理已取消'})]);return workshop})
  deepWorkshop.mockReset().mockImplementation(async({jobId,clickedAt}:{jobId:string;clickedAt:number})=>{workshop=view(workshop.jobs.map(item=>item.id===jobId?{...item,deep:deep({clickedAt})}:item));return workshop})
  getFrame.mockReset().mockImplementation(async({frameId}:{frameId:string})=>({id:frameId,timeMs:frameId==='frame-1'?1500:12567,dataUrl:'data:image/png;base64,verified'}));ackDisplayed.mockReset().mockImplementation(async()=>workshop)
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(performance.now()),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout)
  vi.stubGlobal('fetch',network)
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:clipboard}})
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getVideoLibrary:getLibrary,getVideoWorkshop:getWorkshop,processWorkshopVideo:startWorkshop,cancelWorkshopVideo:cancelWorkshop,deepProcessWorkshopVideo:deepWorkshop,getWorkshopFrame:getFrame,ackWorkshopDeepDisplayed:ackDisplayed,onDataChanged:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)},classifyVideoWorks:classify,processVideoWorks:process,testCloudConnection:testConnection}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})
async function mount(input=props()){await act(async()=>root.render(createElement(InformationWorkshopPage,input)))}
async function setInput(value:string){const input=container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
async function clickTab(text:string){const tab=[...container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button=>button.textContent===text)!;await act(async()=>tab.click())}
function button(text:string){return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!}

it('loads local workshop records without invoking download or cloud calls and requires a downloaded video for deep processing',async()=>{
  await mount()
  expect(container.querySelector('[data-testid=video-workshop-new]')).not.toBeNull()
  expect(container.querySelector('[data-testid=saved-workshop-history]')).toBeNull()
  expect(container.textContent).toContain('粘贴链接后点击处理，下载视频并完成本地分类。')
  expect(button('处理').disabled).toBe(true)
  expect(button('深度处理').disabled).toBe(true);expect(button('深度处理').getAttribute('aria-describedby')).toBe('video-workshop-deep-status')
  expect(container.querySelector('#video-workshop-deep-status')?.textContent).toContain('先完成视频下载与本地分类')
  for(const text of ['豆包极速版','volc.bigasr.auc_turbo','Qwen/Qwen3.5-122B-A10B','E:\\VideoDownload','E:\\AudioDownload','视频时间','对应画面','语音转写 · 画面文字','分析与总结'])expect(container.textContent).toContain(text)
  expect(container.querySelector('[data-testid=workshop-report-empty]')?.textContent).toContain('报告将在深度处理后生成')
  expect(container.querySelectorAll('img,video,audio')).toHaveLength(0)
  expect(getWorkshop).toHaveBeenCalledOnce()
  for(const fn of [getLibrary,classify,process,startWorkshop,cancelWorkshop,deepWorkshop,getFrame,ackDisplayed,testConnection,clipboard,network])expect(fn).not.toHaveBeenCalled()
})

it('enables processing for a recognized short link and rejects invalid destinations',async()=>{
  await mount()
  await setInput('复制打开抖音 https://v.douyin.com/aBc123/。')
  expect(container.querySelector('[data-testid=workshop-link-status]')?.textContent).toContain('https://v.douyin.com/aBc123/')
  expect(container.querySelector('[aria-label=抖音视频链接]')?.getAttribute('aria-invalid')).toBe('false')
  expect(container.querySelector<HTMLButtonElement>('.video-workshop-process')?.disabled).toBe(false)
  await setInput('https://www.douyin.com.evil.example/video/7123456789012345678')
  expect(container.querySelector('[aria-label=抖音视频链接]')?.getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('[data-testid=workshop-link-status]')?.textContent).toContain('仅支持抖音')
  expect(container.querySelector<HTMLButtonElement>('.video-workshop-process')?.disabled).toBe(true)
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label=清空视频链接]')!.click())
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')?.value).toBe('')
  expect(document.activeElement).toBe(container.querySelector('[aria-label=抖音视频链接]'))
  for(const fn of [getLibrary,classify,process,startWorkshop,cancelWorkshop,testConnection,clipboard,network])expect(fn).not.toHaveBeenCalled()
})

it('submits the canonical URL once, blocks duplicate clicks and keeps results bound to the submitted URL when the draft changes',async()=>{
  let finish!:(next:WorkshopView)=>void
  startWorkshop.mockImplementation(()=>new Promise<WorkshopView>(resolve=>{finish=resolve}))
  await mount();await setInput('复制打开抖音 https://v.douyin.com/aBc123/?share=1。')
  const processButton=container.querySelector<HTMLButtonElement>('.video-workshop-process')!,before=Date.now()
  await act(async()=>{processButton.click();processButton.click()})
  expect(startWorkshop).toHaveBeenCalledOnce()
  expect(startWorkshop.mock.calls[0][0]).toEqual({url:'https://v.douyin.com/aBc123/',clickedAt:expect.any(Number)})
  expect(startWorkshop.mock.calls[0][0].clickedAt).toBeGreaterThanOrEqual(before)
  expect(processButton.disabled).toBe(true);expect(processButton.textContent).toContain('正在提交')
  await setInput('https://www.douyin.com/video/7123456789012345678')
  await act(async()=>finish(view([job()])))
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.getAttribute('data-job-id')).toBe('job-1')
  expect(container.querySelector('.video-workshop-submitted-url')?.textContent).toContain('https://v.douyin.com/aBc123/')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')?.value).toContain('7123456789012345678')
  expect(processButton.disabled).toBe(true)
  for(const fn of [classify,process,testConnection,network])expect(fn).not.toHaveBeenCalled()
})

it('shows a start failure and lets the user retry without fabricating a successful job',async()=>{
  startWorkshop.mockRejectedValueOnce(Error('抖音页面需要登录，请在浏览器登录后重试'))
  await mount();await setInput('https://v.douyin.com/aBc123/')
  await act(async()=>button('处理').click())
  expect(container.querySelector('[role=alert]')?.textContent).toContain('抖音页面需要登录')
  expect(container.querySelector('[data-testid=workshop-processing-result]')).toBeNull()
  expect(button('处理').disabled).toBe(false)
  await act(async()=>button('处理').click())
  expect(startWorkshop).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role=alert]')).toBeNull()
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.textContent).toContain('正在下载视频')
})

it('restores saved jobs, shows their verified result and does not replace the draft on data refresh',async()=>{
  workshop=view([job({phase:'completed',workId:'7123456789012345678',title:'本地结果标题',authorName:'已核实作者',durationMs:65200,classification,mediaPath:'E:\\VideoDownload\\video-workshop\\job-1\\video.mp4',byteLength:5242880,elapsedMs:6700,stageElapsedMs:{resolve:350,download:2200,classification:3900}})])
  await mount();await setInput('https://v.douyin.com/nextVideo/')
  const result=container.querySelector('[data-testid=workshop-processing-result]')!
  for(const text of ['下载与分类完成','本地结果标题','已核实作者','1:05','口播主导或口播加图文类','83.0%','2/6 帧','E:\\VideoDownload\\video-workshop\\job-1\\video.mp4','6.7 秒','视频下载','2.2 秒'])expect(result.textContent).toContain(text)
  expect(button('深度处理').disabled).toBe(false)
  await act(async()=>{for(const listener of listeners)listener()})
  expect(getWorkshop).toHaveBeenCalledTimes(2)
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')?.value).toBe('https://v.douyin.com/nextVideo/')
  for(const fn of [startWorkshop,cancelWorkshop,classify,process,testConnection,network])expect(fn).not.toHaveBeenCalled()
})

it('cancels a restored running job and retries its saved URL rather than the edited draft',async()=>{
  workshop=view([job()]);await mount();await setInput('https://v.douyin.com/nextVideo/')
  expect(button('处理中…').disabled).toBe(true)
  await act(async()=>button('取消处理').click())
  expect(cancelWorkshop).toHaveBeenCalledExactlyOnceWith('job-1')
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.textContent).toContain('已取消')
  await act(async()=>button('重新处理').click())
  expect(startWorkshop).toHaveBeenCalledExactlyOnceWith({url:'https://v.douyin.com/aBc123/',clickedAt:expect.any(Number)})
})

it('polls only while a job is running and stops once the result is complete',async()=>{
  vi.useFakeTimers();workshop=view([job()]);await mount()
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
  expect(getWorkshop).toHaveBeenCalledTimes(2)
  workshop=view([job({phase:'completed',message:'已下载并完成本地分类',classification})])
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
  expect(getWorkshop).toHaveBeenCalledTimes(3)
  await act(async()=>{await vi.advanceTimersByTimeAsync(4000)})
  expect(getWorkshop).toHaveBeenCalledTimes(3)
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.textContent).toContain('下载与分类完成')
})

it('keeps the active job visible while selecting an older saved result and deduplicates record IDs',async()=>{
  const old=job({id:'old-job',phase:'failed',message:'历史失败，视频源不可用',title:'历史视频',url:'https://v.douyin.com/oldVideo/'})
  workshop=view([job(),old,old]);await mount()
  const picker=container.querySelector<HTMLSelectElement>('[aria-label=选择处理记录]')!
  expect(picker.options).toHaveLength(2)
  await act(async()=>{picker.value='old-job';picker.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(container.querySelectorAll('[data-testid=workshop-processing-result]')).toHaveLength(2)
  expect(button('重新处理').disabled).toBe(true)
  expect(button('取消处理').disabled).toBe(false)
})

it('enables deep processing only after classification and submits the selected saved job once without using the edited link',async()=>{
  workshop=view([job({phase:'classifying'})]);await mount()
  expect(button('深度处理').disabled).toBe(true)
  workshop=view([ready(),ready({id:'job-2',title:'第二条视频',url:'https://v.douyin.com/other/'})])
  await act(async()=>{for(const listener of listeners)listener()})
  expect(button('深度处理').disabled).toBe(false)
  expect(deepWorkshop).not.toHaveBeenCalled()
  const picker=container.querySelector<HTMLSelectElement>('[aria-label=选择处理记录]')!
  await act(async()=>{picker.value='job-2';picker.dispatchEvent(new Event('change',{bubbles:true}))})
  await setInput('https://v.douyin.com/unprocessedDraft/')
  let resolve!:(next:WorkshopView)=>void
  deepWorkshop.mockImplementation(()=>new Promise<WorkshopView>(done=>{resolve=done}))
  const before=Date.now()
  await act(async()=>{button('深度处理').click();button('深度处理').click()})
  expect(deepWorkshop).toHaveBeenCalledOnce()
  expect(deepWorkshop.mock.calls[0][0]).toEqual({jobId:'job-2',clickedAt:expect.any(Number)})
  expect(deepWorkshop.mock.calls[0][0].clickedAt).toBeGreaterThanOrEqual(before)
  await act(async()=>resolve(view([ready(),ready({id:'job-2',title:'第二条视频',deep:deep()})])))
  expect(container.querySelector('.video-workshop-deep-target')?.textContent).toContain('第二条视频')
  expect(button('取消深度处理').disabled).toBe(false)
  for(const fn of [startWorkshop,classify,process,testConnection,network])expect(fn).not.toHaveBeenCalled()
})

it('shows missing model configuration errors and retries deep processing without downloading the saved video again',async()=>{
  workshop=view([ready()]);deepWorkshop.mockRejectedValueOnce(Error('请先配置 Qwen/Qwen3.5-122B-A10B 的硅基流动 API Key'))
  await mount();await act(async()=>button('深度处理').click())
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Qwen/Qwen3.5-122B-A10B')
  expect(button('深度处理').disabled).toBe(false)
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.textContent).toContain('下载与分类完成')
  await act(async()=>button('深度处理').click())
  expect(deepWorkshop).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role=alert]')).toBeNull()
  workshop=view([ready({deep:deep({phase:'failed',message:'豆包极速版请求超时'})})])
  await act(async()=>{for(const listener of listeners)listener()})
  expect(button('重试深度处理').disabled).toBe(false)
  expect(container.querySelector('[role=alert]')?.textContent).toContain('已下载视频与本地分类已保留')
  await act(async()=>button('重试深度处理').click())
  expect(deepWorkshop).toHaveBeenCalledTimes(3)
  expect(startWorkshop).not.toHaveBeenCalled()
})

it('restores and cancels a running deep job and keeps polling until the cloud operation stops',async()=>{
  vi.useFakeTimers();workshop=view([ready({deep:deep({phase:'recognizing',message:'已识别 2/8 张画面'})})]);await mount()
  expect(container.querySelector('#video-workshop-deep-status')?.textContent).toContain('已识别 2/8 张画面')
  expect(deepWorkshop).not.toHaveBeenCalled()
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
  expect(getWorkshop).toHaveBeenCalledTimes(2)
  cancelWorkshop.mockImplementation(async()=>{workshop=view([ready({deep:deep({phase:'cancelled',message:'深度处理已取消'})})]);return workshop})
  await act(async()=>button('取消深度处理').click())
  expect(cancelWorkshop).toHaveBeenCalledExactlyOnceWith('job-1')
  expect(button('重试深度处理').disabled).toBe(false)
  await act(async()=>{await vi.advanceTimersByTimeAsync(4000)})
  expect(getWorkshop).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[data-testid=workshop-processing-result]')?.textContent).toContain('下载与分类完成')
})

it('shows chronologically aligned reports with actual frame timestamps and original overlapping speech intervals',async()=>{
  workshop=view([ready({deep:deep({phase:'completed',message:'报告已生成',elapsedMs:1234,result:deepResult()})})]);await mount();await setInput('https://v.douyin.com/unprocessedDraft/')
  const report=container.querySelector('[data-testid=workshop-deep-report]')!
  expect(report.getAttribute('data-job-id')).toBe('job-1')
  expect(report.textContent).toContain('已下载视频标题');expect(report.textContent).toContain('https://v.douyin.com/aBc123/')
  expect(report.textContent).not.toContain('unprocessedDraft')
  expect([...report.querySelectorAll('.video-workshop-timeline-section')].map(section=>section.getAttribute('data-start-ms'))).toEqual(['0','10000'])
  expect(report.textContent).toContain('00:00.000 – 00:10.000');expect(report.textContent).toContain('画面 00:12.567')
  expect(report.textContent).toContain('00:09.250 – 00:10.450');expect(report.textContent?.split('00:09.250 – 00:10.450')).toHaveLength(3)
  expect(report.textContent).toContain('00:13.210 – 00:15.970');expect(report.textContent).toContain('第二个画面文字')
  expect(report.textContent).toContain('识别存疑：小字模糊');expect(report.textContent).toContain('抽帧之间的瞬间动作')
  expect(getFrame).toHaveBeenCalledTimes(2)
  expect(getFrame.mock.calls.map(call=>call[0])).toEqual([{jobId:'job-1',frameId:'frame-1'},{jobId:'job-1',frameId:'frame-2'}])
  expect(report.querySelectorAll('img')).toHaveLength(2)
  expect(container.textContent).toContain('深度处理后台用时：1.2 秒')
  expect(ackDisplayed).not.toHaveBeenCalled()
  expect(deepWorkshop).not.toHaveBeenCalled()
})

it('ignores late screenshots after switching saved jobs and rejects mismatched frame timestamps',async()=>{
  let late!:(value:{id:string;timeMs:number;dataUrl:string})=>void
  getFrame.mockImplementation(({jobId,frameId}:{jobId:string;frameId:string})=>jobId==='job-1'?new Promise(resolve=>{if(frameId==='frame-1')late=resolve}):Promise.resolve({id:frameId,timeMs:0,dataUrl:'data:image/png;base64,wrong'}))
  workshop=view([ready({deep:deep({phase:'completed',result:deepResult()})}),ready({id:'job-2',title:'第二个报告',deep:deep({phase:'completed',result:deepResult()})})]);await mount()
  const picker=container.querySelector<HTMLSelectElement>('[aria-label=选择处理记录]')!
  await act(async()=>{picker.value='job-2';picker.dispatchEvent(new Event('change',{bubbles:true}))})
  await act(async()=>late({id:'frame-1',timeMs:1500,dataUrl:'data:image/png;base64,old-job'}))
  const report=container.querySelector('[data-testid=workshop-deep-report]')!
  expect(report.getAttribute('data-job-id')).toBe('job-2')
  expect(report.querySelectorAll('img')).toHaveLength(0)
  expect(report.textContent).toContain('截图与报告时间不一致')
  expect(report.textContent).toContain('尚未记录图文全部可用的全程耗时')
})

it('acknowledges live click-to-report availability only after all verified screenshots actually load',async()=>{
  vi.useFakeTimers();workshop=view([ready()]);await mount()
  deepWorkshop.mockImplementation(async({clickedAt}:{clickedAt:number})=>{workshop=view([ready({deep:deep({phase:'completed',clickedAt,result:deepResult()})})]);return workshop})
  ackDisplayed.mockImplementation(async()=>{workshop=view(workshop.jobs.map(item=>({...item,deep:{...item.deep!,displayedTotalMs:2500}})));return workshop})
  await act(async()=>button('深度处理').click())
  await act(async()=>{await vi.advanceTimersByTimeAsync(50)})
  expect(ackDisplayed).not.toHaveBeenCalled()
  const images=container.querySelectorAll('img')
  await act(async()=>{images[0].dispatchEvent(new Event('load'));await vi.advanceTimersByTimeAsync(50)})
  expect(ackDisplayed).not.toHaveBeenCalled()
  await act(async()=>{images[1].dispatchEvent(new Event('load'))})
  await act(async()=>{await vi.advanceTimersByTimeAsync(50)})
  expect(ackDisplayed).toHaveBeenCalledExactlyOnceWith({jobId:'job-1',displayedAt:expect.any(Number)})
  expect(container.textContent).toContain('点击深度处理到图文报告与截图可用：2.5 秒')
})

it('explains absent audio without inventing aligned transcript text',async()=>{
  const result=deepResult();result.speech={...result.speech,state:'no-audio',segments:[],text:''};result.report.sections=result.report.sections.map(section=>({...section,speechIds:[]}))
  workshop=view([ready({deep:deep({phase:'completed',result})})]);await mount()
  expect(container.textContent).toContain('原视频无音轨，报告依据画面与画面文字生成')
  expect(container.textContent).toContain('本时段没有可对齐的语音转写')
  expect(container.textContent).not.toContain('前一句。')
})

it('displays record load errors and recovers through a local reload',async()=>{
  getWorkshop.mockRejectedValueOnce(Error('本地处理记录暂时不可读'))
  await mount();await setInput('https://v.douyin.com/aBc123/')
  expect(container.querySelector('[role=alert]')?.textContent).toContain('本地处理记录暂时不可读')
  expect(button('处理').disabled).toBe(true)
  await act(async()=>button('重新读取').click())
  expect(container.querySelector('[role=alert]')).toBeNull();expect(button('处理').disabled).toBe(false)
})

it('tolerates missing APIs in older renderer hosts and shows a useful start error',async()=>{
  const api=window.signalDesk as unknown as Record<string,unknown>
  delete api.getVideoWorkshop;delete api.processWorkshopVideo
  await mount();await setInput('https://v.douyin.com/aBc123/')
  await act(async()=>button('处理').click())
  expect(container.querySelector('[role=alert]')?.textContent).toContain('视频处理服务未就绪')
})

it('loads saved works only through the history tab and preserves the new-link draft between views',async()=>{
  await mount(props('owner-sec'));await setInput('https://www.douyin.com/video/7123456789012345678')
  expect(getLibrary).not.toHaveBeenCalled()
  await clickTab('历史资料')
  expect(container.querySelector('[data-testid=saved-workshop-history]')).not.toBeNull()
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(1)
  expect(container.querySelector('[data-testid=workshop-total]')?.textContent).toBe('1条')
  await clickTab('新建处理')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')?.value).toBe('https://www.douyin.com/video/7123456789012345678')
  expect(container.querySelector('[data-testid=saved-workshop-history]')).toBeNull()
})

it('honors explicit saved-work focus and returns to new processing when direct navigation clears focus',async()=>{
  const workId=library.records[0].workId
  await mount(props('owner-sec',{workId,revision:1}))
  expect(container.querySelector('[data-testid=workshop-detail]')?.getAttribute('data-work-id')).toBe(workId)
  await clickTab('新建处理')
  await mount(props('owner-sec',{workId,revision:2}))
  expect(container.querySelector('[data-testid=saved-workshop-history]')).not.toBeNull()
  await mount(props('owner-sec'))
  expect(container.querySelector('[data-testid=video-workshop-new]')).not.toBeNull()
})

it('retains draft input across account changes and prevents another account history from appearing',async()=>{
  await mount(props('owner-sec'));await setInput('https://v.douyin.com/aBc123/')
  await mount(props('next-owner'))
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label=抖音视频链接]')?.value).toBe('https://v.douyin.com/aBc123/')
  await clickTab('历史资料')
  expect(container.querySelectorAll('[data-workshop-work-id]')).toHaveLength(0)
  expect(container.querySelector('[role=alert]')?.textContent).toContain('资料账号已变化')
})

it('supports keyboard navigation between the two workflow tabs',async()=>{
  await mount(props('owner-sec'))
  const first=container.querySelector<HTMLButtonElement>('#workshop-new-tab')!
  await act(async()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
  expect(container.querySelector('#workshop-history-tab')?.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(container.querySelector('#workshop-history-tab'))
  await act(async()=>container.querySelector<HTMLButtonElement>('#workshop-history-tab')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})))
  expect(container.querySelector('[data-testid=video-workshop-new]')).not.toBeNull()
})
