// @vitest-environment jsdom
import {createElement,act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,vi,afterEach} from 'vitest'
import MaterialResearchView from './MaterialResearchView'
import type {MaterialBody,ResearchReport} from '../../shared/videoWorkflow'
let root:Root|undefined,element:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());element?.remove();vi.unstubAllGlobals()})
const body:MaterialBody={text:'第一段完整正文。\n\n最后一段正文也必须显示。',source:'qwen-vision',sourceSha256:'hash',classificationHash:'route',modelVersion:'Qwen/Qwen3.5-4B',generatedAt:'2026-10-13T00:00:00Z',needsReview:true,limitations:['抽样画面需人工核对']}
const report:ResearchReport={overview:'概括内容',analysis:'正文分析内容',keyPoints:[{viewpoint:'主要观点',explanation:'展开观点与依据关系',quotes:['第一段完整正文。']}],domains:[{name:'可能领域',reasoning:'依据文案推测',quotes:['最后一段正文也必须显示。']}],limitations:[],modelVersion:'zai-org/GLM-5.3-Flash',generatedAt:'2026-10-13T00:00:00Z',bodyHash:'body',promptVersion:'v1'}
it('renders the full body without timestamps, all report sections and the human editing path',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);element=document.createElement('div');document.body.append(element);root=createRoot(element)
  const revise=vi.fn(async()=>{})
  await act(async()=>root!.render(createElement(MaterialResearchView,{body,report,onRevise:revise})))
  const text=element.querySelector('[data-testid="material-body"]')!
  expect(text.textContent).toContain('最后一段正文也必须显示。');expect(text.querySelector('time')).toBeNull()
  expect(element.textContent).toContain('内容总结与概括');expect(element.textContent).toContain('正文分析');expect(element.textContent).toContain('主要观点与原文依据');expect(element.textContent).toContain('可能涉及的领域');expect(element.textContent).toContain('模型推测')
  expect(element.querySelectorAll('blockquote')).toHaveLength(2)
  await act(async()=>[...element!.querySelectorAll('button')].find(b=>b.textContent==='人工校对')!.click())
  const editor=element.querySelector('textarea')!
  expect(editor.value).toBe(body.text)
  await act(async()=>element!.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(revise).toHaveBeenCalledWith(body.text)
})
