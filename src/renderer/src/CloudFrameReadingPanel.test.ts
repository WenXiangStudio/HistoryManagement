// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import CloudFrameReadingPanel from './CloudFrameReadingPanel'
import type {CloudFrameResult} from '../../shared/videoContent'
let root:Root|undefined,container:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;container?.remove();vi.unstubAllGlobals()})
it('displays model, untouched frame text and uncertainty beside original images before acknowledging availability',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const ready=vi.fn(),getFrame=vi.fn(async(_owner,_work,id)=>({id,timeMs:1000,dataUrl:'data:image/png;base64,cGlj'}))
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getVideoFrame:getFrame}})
  const result={mode:'cloud-frames-only',modelVersion:'Qwen/Qwen3.5-4B',frames:[{id:'f1',timeMs:1000,sha256:'hash',path:'local'}],
    readings:[{frameId:'f1',timeMs:1000,text:' 原始文字\n第二行',description:'白色背景上有文字。',uncertainties:['右下角模糊']}],
    timing:{preparationMs:100,requestMs:500},usage:{inputTokens:100,outputTokens:50}} as CloudFrameResult
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  await act(async()=>root!.render(createElement(CloudFrameReadingPanel,{owner:'owner',workId:'work',result,onReady:ready})))
  expect(container.querySelector('.cloud-frame-text')?.textContent).toBe(' 原始文字\n第二行')
  expect(container.textContent).toContain('右下角模糊');expect(container.textContent).toContain('硅基流动 · Qwen/Qwen3.5-4B')
  expect(ready).not.toHaveBeenCalled()
  await act(async()=>{container!.querySelector('img')!.dispatchEvent(new Event('load'));await new Promise(r=>setTimeout(r,20))})
  await act(async()=>new Promise(r=>setTimeout(r,50)))
  expect(ready).toHaveBeenCalledTimes(1)
  await act(async()=>container!.querySelector<HTMLButtonElement>('.cloud-frame-image')!.click())
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();expect(getFrame).toHaveBeenCalledTimes(1)
})
