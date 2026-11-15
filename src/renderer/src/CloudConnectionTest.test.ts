// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import CloudConnectionTest from './CloudConnectionTest'
import type {CloudConnectionInput,CloudConnectionResult} from '../../shared/cloudConnection'

let root:Root,container:HTMLDivElement
const probe=vi.fn()
const input:CloudConnectionInput={kind:'profile',profileId:'saved-text',service:'text',expectedRevision:'rev-1'}
const result:CloudConnectionResult={ok:true,message:'模型已返回有效文本',elapsedMs:1234,testedAt:'2026-10-16T04:05:06.000Z',model:'saved-model',service:'text'}
const button=()=>container.querySelector('button')!
const render=async(resetKey='same',disabled=false,request:CloudConnectionInput|null=input)=>act(async()=>root.render(createElement(CloudConnectionTest,{input:request,disabled,resetKey,ariaLabel:'测试文本服务连通性',hint:disabled?'请先保存配置再测试':'点击发起最小文本请求'})))

beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);probe.mockReset().mockResolvedValue(result)
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{testCloudConnection:probe}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})

it('waits for a click, uses the saved request identity, and shows result duration and last tested time',async()=>{
  await render();await render()
  expect(probe).not.toHaveBeenCalled();expect(button().textContent).toBe('连通测试')
  await act(async()=>button().click())
  expect(probe).toHaveBeenCalledWith(input);expect(container.textContent).toContain('连接成功')
  expect(container.textContent).toContain('1.23 秒');expect(container.querySelector('time')!.dateTime).toBe(result.testedAt)
  await render();expect(container.textContent).toContain('连接成功');expect(probe).toHaveBeenCalledTimes(1)
})

it('disables drafts and missing configurations without making a request',async()=>{
  await render('draft',true);expect(button().disabled).toBe(true);expect(container.textContent).toContain('请先保存配置再测试')
  await act(async()=>button().click());await render('empty',false,null);await act(async()=>button().click())
  expect(button().disabled).toBe(true);expect(probe).not.toHaveBeenCalled()
})

it('deduplicates same-event clicks and keeps the button disabled until the request settles',async()=>{
  let finish!:(value:CloudConnectionResult)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await render();await act(async()=>{button().click();button().click()})
  expect(probe).toHaveBeenCalledTimes(1);expect(button().disabled).toBe(true);expect(button().textContent).toBe('测试中…')
  await act(async()=>finish(result));expect(button().disabled).toBe(false)
})

it('shows actionable service failures and recovers from IPC rejection on retry',async()=>{
  probe.mockResolvedValueOnce({...result,ok:false,message:'API Key 无效或没有此模型权限',httpStatus:401})
  await render();await act(async()=>button().click())
  expect(container.textContent).toContain('连接失败');expect(container.textContent).toContain('API Key 无效')
  probe.mockRejectedValueOnce(new Error('服务暂时不可用，请重试'));await act(async()=>button().click())
  expect(container.textContent).toContain('服务暂时不可用，请重试');expect(button().disabled).toBe(false)
  await act(async()=>button().click());expect(container.textContent).toContain('连接成功')
})

it('hides old results after edits and ignores a late completion after profile or revision changes',async()=>{
  await render();await act(async()=>button().click());expect(container.textContent).toContain('连接成功')
  let finish!:(value:CloudConnectionResult)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>button().click());await render('edited',true,null)
  expect(container.textContent).not.toContain('连接成功');expect(container.textContent).not.toContain('测试中…')
  await render('saved-next',false,{...input,profileId:'next-profile',expectedRevision:'rev-2'})
  await act(async()=>button().click());expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({profileId:'next-profile',expectedRevision:'rev-2'}))
  await act(async()=>finish({...result,ok:false,message:'过期模型的失败'}))
  expect(container.textContent).toContain('连接成功');expect(container.textContent).not.toContain('过期模型')
})

it('ignores request completion after the settings section unmounts',async()=>{
  let finish!:(value:CloudConnectionResult)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await render();await act(async()=>button().click());await act(async()=>root.render(null))
  await act(async()=>finish(result));expect(container.textContent).toBe('')
})

it('does not resurrect an earlier result when switching away from and back to the same saved profile',async()=>{
  await render();await act(async()=>button().click());expect(container.textContent).toContain('连接成功')
  await render('other-profile',false,{...input,profileId:'other-profile'})
  await render()
  expect(container.textContent).not.toContain('连接成功');expect(probe).toHaveBeenCalledTimes(1)
})
