// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import FeishuConnectionPanel from './FeishuConnectionPanel'
import {DEFAULT_CREATOR_DATABASE_COLUMNS,type CreatorDatabaseView} from '../../shared/creatorDatabase'
let root:Root,container:HTMLDivElement
const save=vi.fn(),probe=vi.fn(),dirty=vi.fn(),sync=vi.fn(),automatic=vi.fn()
const state={ownerSecUid:'owner',appId:'cli_test',tableUrl:'https://example.feishu.cn/base/BaseTest?table=tblTest',hasSecret:true,busy:false,receipt:null,automatic:false,sync:null}
const view:CreatorDatabaseView={ownerSecUid:'owner',revision:0,columns:DEFAULT_CREATOR_DATABASE_COLUMNS,rows:[{
  secUid:'creator',nickname:'样本博主',profileUrl:'https://www.douyin.com/user/creator',values:{},automatic:{},manualColumns:[]
}]}
const mount=async()=>act(async()=>root.render(createElement(FeishuConnectionPanel,{view,onDirtyChange:dirty})))
const button=(text:string)=>[...container.querySelectorAll('button')].find(button=>button.textContent===text)!
const click=async(text:string)=>act(async()=>button(text).click())
const input=async(label:string,value:string)=>act(async()=>{
  const element=container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value)
  element.dispatchEvent(new Event('input',{bubbles:true}))
})
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);dirty.mockReset();save.mockReset().mockResolvedValue(state)
  probe.mockReset().mockResolvedValue({ownerSecUid:'owner',secUid:'creator',nickname:'样本博主',recordId:'recTest',action:'created',verifiedFields:11,verifiedAt:'2026-10-08T04:00:00Z',elapsedMs:1200})
  sync.mockReset().mockResolvedValue({phase:'success',stage:'done',runId:'test',trigger:'manual',total:1,written:1,verified:1,created:0,updated:1,unchanged:0,startedAt:'2026-10-08T04:00:00Z',finishedAt:'2026-10-08T04:00:01Z',elapsedMs:1000,error:null})
  automatic.mockReset().mockImplementation(async input=>({...state,automatic:input.enabled}))
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getFeishuState:vi.fn().mockResolvedValue(state),saveFeishuConfiguration:save,probeFeishuCreator:probe,syncFeishuCreators:sync,setFeishuAutomatic:automatic,openExternal:vi.fn()}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
it('keeps a saved secret blank, verifies the chosen owner and creator, and displays read-back evidence',async()=>{
  await mount();expect(container.querySelector<HTMLInputElement>('[aria-label="飞书 App Secret"]')!.value).toBe('')
  await click('写入一位并核验');expect(probe).toHaveBeenCalledWith({ownerSecUid:'owner',secUid:'creator'})
  expect(container.textContent).toContain('11 个字段读回一致');expect(container.textContent).toContain('全库同步包含当前账号全部博主')
})
it('prevents writes while credentials are unsaved, masks the secret and clears it after saving',async()=>{
  await mount();await input('飞书 App Secret','test-only-new-secret')
  expect(button('写入一位并核验').disabled).toBe(true);expect(dirty).toHaveBeenLastCalledWith(true)
  expect(container.querySelector<HTMLInputElement>('[aria-label="飞书 App Secret"]')!.type).toBe('password')
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(save).toHaveBeenCalledWith({ownerSecUid:state.ownerSecUid,appId:state.appId,tableUrl:state.tableUrl,appSecret:'test-only-new-secret'})
  expect(container.querySelector<HTMLInputElement>('[aria-label="飞书 App Secret"]')!.value).toBe('')
  expect(button('写入一位并核验').disabled).toBe(false)
})
it('requires a verified sample before full sync and exposes automatic mode with the current owner',async()=>{
  await mount();expect(button('同步全部博主').disabled).toBe(true)
  await click('写入一位并核验');expect(button('同步全部博主').disabled).toBe(false)
  await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="自动同步到飞书"]')!.click())
  expect(automatic).toHaveBeenCalledWith({ownerSecUid:'owner',enabled:true})
  await click('写入一位并核验');await click('同步全部博主')
  expect(sync).toHaveBeenCalledWith({ownerSecUid:'owner'});expect(container.textContent).toContain('已核验 1 位博主')
  expect(container.textContent).toContain('点击到结果可用')
})
it('preserves the selected creator and shows a failure without a success receipt',async()=>{
  await mount();probe.mockRejectedValueOnce(Error('飞书读回核验未通过'));await click('写入一位并核验')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('核验未通过')
  expect(container.querySelector('.feishu-success')).toBeNull();expect(button('写入一位并核验').disabled).toBe(false)
  await click('写入一位并核验');expect(container.querySelector('.feishu-success')).not.toBeNull()
})
