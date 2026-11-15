// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import SiliconFlowSettings from './SiliconFlowSettings'
import type {SiliconFlowInput,SiliconFlowView} from '../../shared/siliconFlow'

let root:Root,container:HTMLDivElement,view:SiliconFlowView,refresh:()=>void,revisionNumber:number
const save=vi.fn(),activate=vi.fn(),probe=vi.fn()
const field=(name:string)=>container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!
const button=(text:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===text)!
const deleteButton=(slot:number)=>container.querySelector<HTMLButtonElement>(`[aria-label="删除硅基流动模型${slot}"]`)!
const row=(slot:number)=>field(`硅基流动模型${slot}`).closest('.siliconflow-model')!
async function click(text:string){await act(async()=>button(text).click())}
async function remove(slot:number){await act(async()=>deleteButton(slot).click())}
async function input(name:string,value:string){await act(async()=>{const e=field(name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))})}
async function render(activeProfileId='old',disabled=false){await act(async()=>root.render(createElement(SiliconFlowSettings,{activeProfileId,onActivate:activate,disabled})))}
async function savedModels(){
  view={...view,hasSecret:true,slots:view.slots.map(s=>({...s,model:`org/model-${s.slot}`,visionEnabled:s.slot===3,hasSecret:true}))}
  await act(async()=>refresh())
}

beforeEach(async()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);activate.mockReset();revisionNumber=1
  probe.mockReset().mockResolvedValue({ok:true,message:'模型返回有效内容',elapsedMs:500,testedAt:'2026-10-16T01:02:03.000Z',model:'saved-model',service:'text'})
  view={baseUrl:'https://api.siliconflow.cn/v1',protocol:'chat-completions',revision:'rev1',hasSecret:false,
    slots:[1,2,3].map(slot=>({slot,profileId:`slot-${slot}`,profileName:`硅基流动 · 模型 ${slot}`,model:'',visionEnabled:false,hasSecret:false}))}
  save.mockReset().mockImplementation(async(request:SiliconFlowInput)=>{
    const previous=new Map(view.slots.map(slot=>[slot.slot,slot]))
    const hasSecret=!!request.secret||view.hasSecret
    view={...view,hasSecret,revision:`rev${++revisionNumber}`,slots:request.models.map(model=>{
      if(model.slot===undefined)throw new Error('The renderer must submit stable model slots')
      return {...model,slot:model.slot,profileId:previous.get(model.slot)?.profileId??`slot-${model.slot}`,
        profileName:previous.get(model.slot)?.profileName??`硅基流动 · 模型 ${model.slot}`,hasSecret}
    })}
    return structuredClone(view)
  })
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{
    getSiliconFlow:async()=>structuredClone(view),saveSiliconFlow:save,testCloudConnection:probe,
    onDataChanged:(cb:()=>void)=>{refresh=cb;return()=>{}}
  }})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  await render()
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})

it('shows saved placeholders and official endpoint, and saves stable slot IDs without auto activation',async()=>{
  expect(field('硅基流动服务地址').value).toBe('https://api.siliconflow.cn/v1')
  expect(field('硅基流动模型1').value).toBe('');expect(field('硅基流动模型2').value).toBe('');expect(field('硅基流动模型3').value).toBe('')
  expect(button('新增模型')).toBeDefined();expect(button('使用模型 1').disabled).toBe(true)
  await click('保存硅基流动配置')
  expect(save).toHaveBeenCalledWith({expectedRevision:'rev1',secret:'',models:[
    {slot:1,model:'',visionEnabled:false},{slot:2,model:'',visionEnabled:false},{slot:3,model:'',visionEnabled:false}
  ],deletedSlots:[]})
  expect(activate).not.toHaveBeenCalled();expect(button('使用模型 1').disabled).toBe(true)
})

it('adds more than three models, saves their distinct IDs and activates a newly saved model',async()=>{
  await click('新增模型');await click('新增模型')
  expect(container.querySelectorAll('.siliconflow-model')).toHaveLength(5)
  await input('硅基流动API Key','synthetic-key')
  await input('硅基流动模型1','org/first');await input('硅基流动模型4','org/fourth');await input('硅基流动模型5','org/fifth')
  await act(async()=>field('硅基流动模型5图片输入').click())
  expect(button('使用模型 5').disabled).toBe(true)
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0]).toEqual({expectedRevision:'rev1',secret:'synthetic-key',models:[
    {slot:1,model:'org/first',visionEnabled:false},{slot:2,model:'',visionEnabled:false},{slot:3,model:'',visionEnabled:false},
    {slot:4,model:'org/fourth',visionEnabled:false},{slot:5,model:'org/fifth',visionEnabled:true}
  ],deletedSlots:[]})
  expect(field('硅基流动API Key').value).toBe('');expect(activate).not.toHaveBeenCalled()
  await click('使用模型 5');expect(activate).toHaveBeenCalledWith('slot-5')
})

it('deletes a middle saved model only on save while preserving neighboring identity, vision and credentials',async()=>{
  await savedModels()
  const thirdInput=field('硅基流动模型3')
  await input('硅基流动模型3','org/edited-third');await remove(2)
  expect(save).not.toHaveBeenCalled();expect(field('硅基流动模型2')).toBeNull()
  expect(field('硅基流动模型3')).toBe(thirdInput)
  expect(field('硅基流动模型3').value).toBe('org/edited-third');expect(field('硅基流动模型3图片输入').checked).toBe(true)
  expect(row(3).textContent).toContain('API Key 已保存')
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0]).toEqual({expectedRevision:'rev1',secret:'',models:[
    {slot:1,model:'org/model-1',visionEnabled:false},{slot:3,model:'org/edited-third',visionEnabled:true}
  ],deletedSlots:[2]})
  expect(field('硅基流动模型1').value).toBe('org/model-1')
  await click('使用模型 3');expect(activate).toHaveBeenCalledWith('slot-3')
})

it('keeps the active marker on its stable row and explains fallback when that model is staged for deletion',async()=>{
  await savedModels();await render('slot-3')
  expect(row(3).textContent).toContain('当前云端方案')
  await remove(2);expect(row(3).textContent).toContain('当前云端方案')
  await remove(3)
  expect(container.textContent).toContain('自动切换');expect(save).not.toHaveBeenCalled()
  await click('撤销删除')
  expect(row(3).textContent).toContain('当前云端方案')
  await click('保存硅基流动配置');expect(save.mock.calls[0][0].deletedSlots).toEqual([])
})

it('undoes staged saved-row deletions without losing their model and vision drafts',async()=>{
  await input('硅基流动模型2','org/edited-second')
  await act(async()=>field('硅基流动模型2图片输入').click())
  await remove(1);await remove(2)
  await click('撤销删除')
  expect([...container.querySelectorAll('.siliconflow-model h4')].map(h=>h.textContent)).toEqual(['模型 1','模型 2','模型 3'])
  expect(field('硅基流动模型2').value).toBe('org/edited-second');expect(field('硅基流动模型2图片输入').checked).toBe(true)
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0].deletedSlots).toEqual([])
  expect(save.mock.calls[0][0].models[1]).toEqual({slot:2,model:'org/edited-second',visionEnabled:true})
})

it('removes an unsaved row immediately and does not send it as a saved-model deletion',async()=>{
  await click('新增模型');await input('硅基流动模型4','discarded/unsaved');await remove(4)
  expect(field('硅基流动模型4')).toBeNull();expect(button('撤销删除')).toBeUndefined()
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0].models.map((model:{slot:number})=>model.slot)).toEqual([1,2,3])
  expect(save.mock.calls[0][0].deletedSlots).toEqual([])
})

it('does not reuse a staged deleted slot when adding a replacement',async()=>{
  await remove(3);await click('新增模型')
  expect(field('硅基流动模型3')).toBeNull();expect(field('硅基流动模型4')).toBeTruthy()
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0].models.map((model:{slot:number})=>model.slot)).toEqual([1,2,4])
  expect(save.mock.calls[0][0].deletedSlots).toEqual([3])
})

it('allows saving zero models and reuses the saved group key when adding a model afterward',async()=>{
  await savedModels();await remove(1);await remove(2);await remove(3)
  expect(container.querySelectorAll('.siliconflow-model')).toHaveLength(0)
  expect(button('新增模型')).toBeDefined()
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0]).toEqual({expectedRevision:'rev1',secret:'',models:[],deletedSlots:[1,2,3]})
  expect(view.slots).toEqual([]);expect(view.hasSecret).toBe(true)
  expect(field('硅基流动API Key').placeholder).toContain('留空保留已保存密钥')
  await click('新增模型');await input('硅基流动模型1','org/after-empty')
  await click('保存硅基流动配置');expect(save.mock.calls[1][0].secret).toBe('')
  expect(button('使用模型 1').disabled).toBe(false)
  await click('使用模型 1');expect(activate).toHaveBeenCalledWith('slot-1')
})

it('loads an empty saved group without inventing fixed model slots and permits creating the first model',async()=>{
  view={...view,revision:'empty',slots:[]}
  await act(async()=>refresh())
  expect(container.querySelectorAll('.siliconflow-model')).toHaveLength(0)
  await click('新增模型');expect(field('硅基流动模型1').value).toBe('')
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0]).toEqual({expectedRevision:'empty',secret:'',models:[{slot:1,model:'',visionEnabled:false}],deletedSlots:[]})
})

it('keeps key, added models and staged deletions through polling, then clears only successfully saved key',async()=>{
  await input('硅基流动API Key','synthetic-secret');await input('硅基流动模型1','org/first')
  await remove(2);await click('新增模型');await input('硅基流动模型4','org/fourth')
  await act(async()=>{field('硅基流动模型4图片输入').click();refresh();await vi.advanceTimersByTimeAsync(10000)})
  expect(field('硅基流动API Key').value).toBe('synthetic-secret');expect(field('硅基流动模型4').value).toBe('org/fourth')
  expect(field('硅基流动模型2')).toBeNull()
  await click('保存硅基流动配置')
  expect(save.mock.calls[0][0]).toEqual({expectedRevision:'rev1',secret:'synthetic-secret',models:[
    {slot:1,model:'org/first',visionEnabled:false},{slot:3,model:'',visionEnabled:false},{slot:4,model:'org/fourth',visionEnabled:true}
  ],deletedSlots:[2]})
  expect(field('硅基流动API Key').value).toBe('');expect(activate).not.toHaveBeenCalled()
  await click('使用模型 4');expect(activate).toHaveBeenCalledWith('slot-4')
})

it('preserves failed-save drafts and pending deletions, then prevents overwriting external changes until reload',async()=>{
  await input('硅基流动API Key','keep-me');await input('硅基流动模型1','draft');await remove(2)
  await click('新增模型');await input('硅基流动模型4','new-draft')
  save.mockRejectedValueOnce(new Error('保存失败'));await click('保存硅基流动配置')
  expect(field('硅基流动API Key').value).toBe('keep-me');expect(container.textContent).toContain('保存失败')
  expect(field('硅基流动模型2')).toBeNull();expect(field('硅基流动模型4').value).toBe('new-draft')
  view={...view,revision:'external',slots:view.slots.map(s=>s.slot===1?{...s,model:'external'}:s)}
  await act(async()=>refresh())
  expect(field('硅基流动模型1').value).toBe('draft');expect(button('保存硅基流动配置').disabled).toBe(true)
  await click('放弃草稿并重新载入硅基流动配置')
  expect(field('硅基流动模型1').value).toBe('external');expect(field('硅基流动API Key').value).toBe('')
  expect(field('硅基流动模型2')).toBeTruthy();expect(field('硅基流动模型4')).toBeNull();expect(button('撤销删除')).toBeUndefined()
})

it('locks editing, additions and deletions during save and prevents duplicate submission',async()=>{
  let finish!:(v:SiliconFlowView)=>void;save.mockImplementationOnce(()=>new Promise<SiliconFlowView>(resolve=>{finish=resolve}))
  await click('保存硅基流动配置')
  expect(container.querySelector('fieldset')!.disabled).toBe(true)
  await click('新增模型');await remove(1);await click('保存硅基流动配置')
  expect(save).toHaveBeenCalledTimes(1);expect(container.querySelectorAll('.siliconflow-model')).toHaveLength(3)
  await act(async()=>finish(view));expect(container.querySelector('fieldset')!.disabled).toBe(false)
})

it('respects the parent disabled state for adding, deleting and saving models',async()=>{
  await render('old',true)
  expect(container.querySelector('fieldset')!.disabled).toBe(true)
  await click('新增模型');await remove(1);await click('保存硅基流动配置')
  expect(container.querySelectorAll('.siliconflow-model')).toHaveLength(3);expect(save).not.toHaveBeenCalled()
})

const testButton=(slot:number)=>container.querySelector<HTMLButtonElement>(`[aria-label="测试硅基流动模型${slot}连通性"]`)!
it('provides a separate manual connection test for every saved model, including new dynamic rows',async()=>{
  expect(container.querySelectorAll('.cloud-connection-test')).toHaveLength(3)
  expect(testButton(1).disabled).toBe(true);expect(probe).not.toHaveBeenCalled()
  await savedModels();await act(async()=>{testButton(1).click();testButton(3).click()})
  expect(probe.mock.calls.map(call=>call[0])).toEqual([
    {kind:'siliconflow',profileId:'slot-1',expectedRevision:'rev1'},
    {kind:'siliconflow',profileId:'slot-3',expectedRevision:'rev1'}
  ])
  expect(row(3).textContent).toContain('验证图片输入能力')
  await click('新增模型');await input('硅基流动模型4','org/fourth')
  expect(testButton(4).disabled).toBe(true);expect(row(4).textContent).toContain('请先保存配置再测试')
  await click('保存硅基流动配置');await act(async()=>testButton(4).click())
  expect(probe).toHaveBeenLastCalledWith({kind:'siliconflow',profileId:'slot-4',expectedRevision:'rev2'})
})

it('preserves tested results through polling, invalidates them on drafts, and ignores a late old revision',async()=>{
  await savedModels();await act(async()=>testButton(1).click())
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(row(1).textContent).toContain('连接成功');expect(probe).toHaveBeenCalledTimes(1)
  let finish!:(value:unknown)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>testButton(2).click());await input('硅基流动API Key','replacement-key')
  expect(row(1).textContent).not.toContain('连接成功');expect(testButton(2).disabled).toBe(true)
  await click('保存硅基流动配置')
  await act(async()=>finish({ok:true,message:'过期密钥结果',elapsedMs:1,testedAt:'2026-10-16T01:02:03Z',model:'old',service:'text'}))
  expect(row(2).textContent).not.toContain('过期密钥结果');expect(probe).toHaveBeenCalledTimes(2)
  await act(async()=>testButton(2).click());expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({expectedRevision:'rev2'}))
})

it('invalidates saved model results when an external revision replaces the configuration',async()=>{
  await savedModels();await act(async()=>testButton(3).click())
  view={...view,revision:'external-r2',slots:view.slots.map(slot=>({...slot,model:'external-model'}))}
  await act(async()=>refresh())
  expect(row(3).textContent).not.toContain('连接成功');expect(field('硅基流动模型3').value).toBe('external-model')
  await act(async()=>testButton(3).click());expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({profileId:'slot-3',expectedRevision:'external-r2'}))
})
