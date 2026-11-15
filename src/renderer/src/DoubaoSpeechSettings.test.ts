// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import DoubaoSpeechSettings from './DoubaoSpeechSettings'
import type {DoubaoSpeechView} from '../../shared/doubaoSpeech'
let container:HTMLDivElement,root:Root,view:DoubaoSpeechView,refresh:()=>void
const start=vi.fn(),display=vi.fn(),probe=vi.fn(),save=vi.fn()
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  view={settings:{authMode:'api-key',appId:'',hasSecret:true,resourceId:'volc.bigasr.auc_turbo',revision:'speech-r1'},trial:{state:'idle',message:'ready'},audioReady:true}
  probe.mockReset().mockResolvedValue({ok:true,message:'语音服务已响应',elapsedMs:200,testedAt:'2026-10-16T01:02:03.000Z',model:'volc.bigasr.auc_turbo',service:'speech'})
  save.mockReset().mockImplementation(async(input)=>{view={...view,settings:{...view.settings,authMode:input.authMode,appId:input.appId,hasSecret:true,revision:'speech-r2'}};return view})
  start.mockReset().mockImplementation(async()=>{view={...view,trial:{state:'running',message:'识别中',requestId:'flash-id'}};return view})
  display.mockReset().mockImplementation(async()=>{view={...view,trial:{...view.trial,displayedAt:new Date().toISOString(),displayedTotalMs:1000}};return view})
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getDoubaoSpeech:async()=>view,startDoubaoFlash:start,testCloudConnection:probe,saveDoubaoSpeech:save,
    markDoubaoFlashDisplayed:display,onDataChanged:(cb:()=>void)=>{refresh=cb;return()=>{}}}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  await act(async()=>root.render(createElement(DoubaoSpeechSettings)))
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
const button=(text:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===text)!
it('starts from the saved credential and local audio with no URL input, then marks original text displayed',async()=>{
  expect(container.querySelector('[aria-label="豆包测试音频链接"]')).toBeNull()
  expect(container.textContent).toContain('录音文件识别极速版');expect(container.textContent).not.toContain('TOS')
  expect(button('仅转写这条视频').disabled).toBe(false)
  await act(async()=>button('仅转写这条视频').click())
  expect(start).toHaveBeenCalledTimes(1);expect(start).toHaveBeenCalledWith({clickedAt:expect.any(Number)})
  expect(button('仅转写这条视频').disabled).toBe(true)
  view={...view,trial:{...view.trial,state:'completed',text:' 原文\n',message:'完成'}}
  await act(async()=>{refresh();await new Promise(r=>setTimeout(r,80))})
  await act(async()=>new Promise(r=>setTimeout(r,80)))
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="豆包转写原文"]')!.value).toBe(' 原文\n')
  expect(display).toHaveBeenCalledTimes(1);expect(button('本条转写已完成').disabled).toBe(true)
})
it('blocks uncertain flash retry and does not present the legacy query action',async()=>{
  view={...view,trial:{state:'uncertain',message:'结果未知',requestId:'uncertain'}}
  await act(async()=>refresh())
  expect(button('仅转写这条视频').disabled).toBe(true);expect(container.textContent).not.toContain('继续查询原任务')
  expect(start).not.toHaveBeenCalled()
})
it('displays standard history distinctly and does not record reopening as the original click timing',async()=>{
  view={...view,trial:{state:'completed',text:'flash',message:'完成',requestId:'flash-id'},
    standardTrial:{state:'completed',message:'旧结果',text:'standard',resourceId:'volc.seedasr.auc'}}
  await act(async()=>refresh())
  expect(container.textContent).toContain('标准版2.0历史记录')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="豆包标准版历史原文"]')!.value).toBe('standard')
  expect(display).not.toHaveBeenCalled()
})

const testButton=()=>container.querySelector<HTMLButtonElement>('[aria-label="测试豆包语音连通性"]')!
async function secret(value:string){await act(async()=>{const input=container.querySelector<HTMLInputElement>('[aria-label="豆包语音凭据"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}

it('tests saved speech credentials independently from the local transcription and preserves results across polling',async()=>{
  expect(testButton().disabled).toBe(false);expect(probe).not.toHaveBeenCalled()
  await act(async()=>testButton().click())
  expect(probe).toHaveBeenCalledWith({kind:'doubao',expectedRevision:'speech-r1'});expect(start).not.toHaveBeenCalled()
  expect(container.textContent).toContain('1 秒合成音频');expect(container.textContent).toContain('连接成功')
  await act(async()=>refresh());expect(container.textContent).toContain('连接成功');expect(probe).toHaveBeenCalledTimes(1)
  await secret('new-speech-secret');expect(testButton().disabled).toBe(true)
  expect(container.textContent).toContain('请先保存配置再测试');expect(container.textContent).not.toContain('连接成功')
  await act(async()=>button('保存豆包语音配置').click());await act(async()=>testButton().click())
  expect(probe).toHaveBeenLastCalledWith({kind:'doubao',expectedRevision:'speech-r2'})
})

it('hides speech results on revision changes and ignores old in-flight responses after draft edits',async()=>{
  let finish!:(value:unknown)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>testButton().click());await secret('changed-secret')
  await act(async()=>finish({ok:true,message:'old-speech-result',elapsedMs:1,testedAt:'2026-10-16T01:02:03Z',model:'speech',service:'speech'}))
  expect(container.textContent).not.toContain('old-speech-result')
  await act(async()=>button('保存豆包语音配置').click());await act(async()=>testButton().click())
  expect(container.textContent).toContain('连接成功')
  view={...view,settings:{...view.settings,revision:'external-speech-r3'}};await act(async()=>refresh())
  expect(container.textContent).not.toContain('连接成功');expect(probe).toHaveBeenCalledTimes(2)
})

it('keeps connection testing disabled without saved credentials and while a local transcription is running',async()=>{
  view={...view,settings:{...view.settings,hasSecret:false}};await act(async()=>refresh())
  expect(testButton().disabled).toBe(true);expect(container.textContent).toContain('请先保存语音凭据')
  view={...view,settings:{...view.settings,hasSecret:true},trial:{state:'running',message:'识别中'}};await act(async()=>refresh())
  expect(testButton().disabled).toBe(true);await act(async()=>testButton().click());expect(probe).not.toHaveBeenCalled()
})
