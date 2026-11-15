// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import type {AppSettings} from '../../shared/contracts'
import App from './App'
import {cloudProviderSettings,EMPTY_CLOUD_SETTINGS} from '../../shared/cloudProfiles'

let root:Root,container:HTMLDivElement,settings:AppSettings,dataChanged:()=>void
const listeners=new Set<()=>void>()
const save=vi.fn(),probe=vi.fn()
const field=(name:string)=>[...container.querySelectorAll<HTMLLabelElement>('label.field')]
  .find(label=>label.querySelector('span')?.textContent===name)!.querySelector<HTMLInputElement>('input')!
async function input(name:string,value:string){
  await act(async()=>{
    const element=field(name)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value)
    element.dispatchEvent(new Event('input',{bubbles:true}))
  })
}
async function navigate(name:string){await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.includes(name))!.click())}
async function saveForm(){await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.settings-actions button')].find(button=>button.textContent==='保存设置')!.click())}

beforeEach(async()=>{
  listeners.clear();dataChanged=()=>{for(const listener of listeners)listener()}
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}})
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}})
  settings={textBaseUrl:'',textApiProtocol:'chat-completions',textModel:'',visionBaseUrl:'',visionModel:'',contextWindow:128000,
    textInputPricePerMillion:null,textOutputPricePerMillion:null,visionInputPricePerMillion:null,visionOutputPricePerMillion:null,
    imagePrice:null,asrModel:'small',cacheLimitGb:20,retentionHours:72,interests:[],hasTextApiKey:false,hasVisionApiKey:false}
  probe.mockReset().mockResolvedValue({ok:true,message:'服务已返回有效内容',elapsedMs:300,testedAt:'2026-10-16T01:02:03.000Z',model:'saved-model',service:'text'})
  save.mockReset().mockImplementation(async(value:Record<string,unknown>)=>{
    const {textApiKey,visionApiKey,...values}=value
    settings={...settings,...values,textBaseUrl:String(values.textBaseUrl).trim(),textModel:String(values.textModel).trim(),
      hasTextApiKey:!!textApiKey||settings.hasTextApiKey,hasVisionApiKey:!!visionApiKey||settings.hasVisionApiKey}
    return {...settings}
  })
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{
    getSiliconFlow:async()=>({baseUrl:'https://api.siliconflow.cn/v1',protocol:'chat-completions',revision:'initial',hasSecret:false,slots:[1,2,3].map(slot=>({slot,profileId:`slot-${slot}`,profileName:`硅基流动 · 模型 ${slot}`,model:'',visionEnabled:false,hasSecret:false}))}),
    getDoubaoSpeech:async()=>({settings:{authMode:'api-key',appId:'',hasSecret:false,resourceId:'volc.bigasr.auc_turbo',revision:'speech-r1'},trial:{state:'idle',message:'尚未提交豆包识别任务'},audioReady:false}),
    getDashboard:async()=>({followingCount:0,workCount:0,unreadCount:0,commentCount:0,analyzedCount:0,queuedJobs:0,connectorOnline:false,lastSyncAt:null}),
    listInbox:async()=>[],listCreators:async()=>[],listJobs:async()=>[],getSettings:async()=>structuredClone(settings),saveSettings:save,testCloudConnection:probe,
    getFollowingSyncStatus:async()=>({phase:'idle',runId:null,message:'',ownerSecUid:null,connection:{online:false}}),getFollowingConfiguration:async()=>null,
    onDataChanged:(callback:()=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)},onWorkerSetupProgress:()=>()=>{}
  }})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  await act(async()=>root.render(createElement(App)));await navigate('设置')
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})

it('keeps the independent Doubao credential draft through refreshes without exposing it to generic settings save',async()=>{
  const secret=container.querySelector<HTMLInputElement>('[aria-label="豆包语音凭据"]')!
  expect(secret.type).toBe('password')
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(secret,'doubao-draft-secret');secret.dispatchEvent(new Event('input',{bubbles:true}))})
  await act(async()=>vi.advanceTimersByTimeAsync(6000))
  expect(secret.value).toBe('doubao-draft-secret')
  await saveForm()
  expect(JSON.stringify(save.mock.calls)).not.toContain('doubao-draft-secret')
  expect(secret.value).toBe('doubao-draft-secret')
})
it('keeps the SiliconFlow key and model drafts isolated from generic settings and background refreshes',async()=>{
  const key=container.querySelector<HTMLInputElement>('[aria-label="硅基流动API Key"]')!
  const model=container.querySelector<HTMLInputElement>('[aria-label="硅基流动模型1"]')!
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(key,'silicon-draft-secret');key.dispatchEvent(new Event('input',{bubbles:true}))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(model,'org/draft-model');model.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await act(async()=>vi.advanceTimersByTimeAsync(10000));await saveForm()
  expect(key.value).toBe('silicon-draft-secret');expect(model.value).toBe('org/draft-model')
  expect(JSON.stringify(save.mock.calls)).not.toContain('silicon-draft-secret');expect(JSON.stringify(save.mock.calls)).not.toContain('org/draft-model')
})

it('retains unsaved text and vision fields across repeated five-second refreshes and credential-status updates',async()=>{
  await input('文本服务 Base URL','https://text.example.com/v1')
  await act(async()=>vi.advanceTimersByTimeAsync(15000))
  expect(field('文本服务 Base URL').value).toBe('https://text.example.com/v1')
  await input('文本模型','draft-model');await input('视觉服务 Base URL','https://vision.example.com/v1')
  await input('文本输入单价 / 百万 token','1.5')
  settings={...settings,hasTextApiKey:true}
  await act(async()=>dataChanged())
  expect(field('文本模型').value).toBe('draft-model')
  expect(field('视觉服务 Base URL').value).toBe('https://vision.example.com/v1')
  expect(field('文本输入单价 / 百万 token').value).toBe('1.5')
  expect(container.textContent).toContain('密钥已安全保存')
  expect(save).not.toHaveBeenCalled()
})

it('saves the edited values, clears the submitted secret and loads saved settings when the page is reopened',async()=>{
  await input('文本服务 Base URL',' https://text.example.com/v1 ')
  await input('文本模型',' saved-model ');await input('文本服务 API Key','synthetic-test-secret')
  await act(async()=>vi.advanceTimersByTimeAsync(10000));await saveForm()
  expect(save).toHaveBeenCalledWith(expect.objectContaining({textBaseUrl:' https://text.example.com/v1 ',textModel:' saved-model ',textApiKey:'synthetic-test-secret'}))
  expect(field('文本服务 API Key').value).toBe('')
  expect(field('文本服务 Base URL').value).toBe('https://text.example.com/v1')
  await navigate('任务中心');await navigate('设置')
  expect(field('文本服务 Base URL').value).toBe('https://text.example.com/v1')
  expect(field('文本模型').value).toBe('saved-model')
  expect(container.textContent).toContain('密钥已安全保存')
})

it('keeps an intentionally cleared field and a failed-save draft through background refreshes',async()=>{
  settings={...settings,textBaseUrl:'https://saved.example.com/v1',textModel:'saved-model'}
  await act(async()=>dataChanged())
  expect(field('文本服务 Base URL').value).toBe('https://saved.example.com/v1')
  await input('文本服务 Base URL','');await input('文本模型','replacement-model')
  save.mockRejectedValueOnce(new Error('合成保存失败'))
  await saveForm()
  expect(container.textContent).toContain('合成保存失败')
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(field('文本服务 Base URL').value).toBe('')
  expect(field('文本模型').value).toBe('replacement-model')
})

it('does not overwrite newer typing when an earlier save completes',async()=>{
  let finish!:(value:AppSettings)=>void
  save.mockImplementationOnce(()=>new Promise<AppSettings>(resolve=>{finish=resolve}))
  await input('文本服务 Base URL','https://first.example.com/v1');await input('文本模型','first-model')
  await saveForm()
  await input('文本服务 Base URL','https://newer.example.com/v1')
  settings={...settings,textBaseUrl:'https://first.example.com/v1',textModel:'first-model'}
  await act(async()=>finish({...settings}));await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(field('文本服务 Base URL').value).toBe('https://newer.example.com/v1')
  expect(field('文本模型').value).toBe('first-model')
})
it('retains a Responses selection through polling and saves it for the reopened settings page',async()=>{
  const selector=()=>[...container.querySelectorAll('label.field')].find(label=>label.querySelector('span')?.textContent==='文本接口协议')!.querySelector('select')!
  await act(async()=>{selector().value='responses';selector().dispatchEvent(new Event('change',{bubbles:true}))})
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(selector().value).toBe('responses');await saveForm()
  expect(save).toHaveBeenCalledWith(expect.objectContaining({textApiProtocol:'responses'}))
  await navigate('任务中心');await navigate('设置');expect(selector().value).toBe('responses')
})

async function enableProfiles(){
  settings={...settings,...EMPTY_CLOUD_SETTINGS,textBaseUrl:'https://old.example/v1',textModel:'old-model',hasTextApiKey:true,
    activeCloudProfileId:'old',activeCloudProfileRevision:'old-r1',cloudProfileName:'原有方案',cloudProfiles:[{id:'old',name:'原有方案'}]}
  const records=new Map([['old',{values:cloudProviderSettings(settings),name:'原有方案',hasKey:true}]])
  let revision=1
  save.mockImplementation(async(value:Record<string,unknown>)=>{
    const current=settings.activeCloudProfileId!
    if(value.cloudProfileAction){
      let target=String(value.cloudProfileId||'')
      if(value.cloudProfileAction==='create'||value.cloudProfileAction==='duplicate'){
        target='new-'+records.size;records.set(target,{values:value.cloudProfileAction==='create'?{...EMPTY_CLOUD_SETTINGS}:cloudProviderSettings(settings),name:'新方案',hasKey:value.cloudProfileAction==='duplicate'&&settings.hasTextApiKey})
      }
      const selected=records.get(target)!
      settings={...settings,...selected.values,activeCloudProfileId:target,cloudProfileName:selected.name,hasTextApiKey:selected.hasKey,hasVisionApiKey:false}
    }else{
      const {textApiKey,visionApiKey,...values}=value
      settings={...settings,...values,hasTextApiKey:!!textApiKey||settings.hasTextApiKey}
      records.set(current,{values:cloudProviderSettings(settings),name:settings.cloudProfileName!,hasKey:settings.hasTextApiKey})
    }
    settings.activeCloudProfileRevision=`${settings.activeCloudProfileId}-r${++revision}`
    settings.cloudProfiles=[...records].map(([id,record])=>({id,name:record.name}))
    return structuredClone(settings)
  })
  await act(async()=>dataChanged())
}
const clickText=async(text:string)=>act(async()=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click())
const chooseProfile=async(id:string)=>act(async()=>{
  const select=container.querySelector<HTMLSelectElement>('[aria-label="云端方案"]')!
  select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}))
})
it('creates and names a blank profile without old credentials, then restores the saved original via the selector',async()=>{
  await enableProfiles();await clickText('新建方案')
  expect(field('文本模型').value).toBe('');expect(field('文本服务 API Key').value).toBe('')
  expect(settings.hasTextApiKey).toBe(false)
  await input('方案名称','新厂商');await input('文本模型','new-model');await input('文本服务 API Key','new-profile-secret')
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(field('方案名称').value).toBe('新厂商');await saveForm()
  expect(field('文本服务 API Key').value).toBe('')
  await chooseProfile('old')
  expect(field('文本模型').value).toBe('old-model');expect(field('方案名称').value).toBe('原有方案')
  expect(field('文本服务 Base URL').value).toBe('https://old.example/v1');expect(settings.hasTextApiKey).toBe(true)
  await chooseProfile('new-1');expect(field('文本模型').value).toBe('new-model')
  await navigate('任务中心');await navigate('设置');expect(field('方案名称').value).toBe('新厂商')
})
it('keeps unsaved configuration and key on a switch attempt, and explicitly saves before creating another profile',async()=>{
  await enableProfiles();await input('文本模型','draft-model');await input('文本服务 API Key','draft-secret')
  await clickText('新建方案');expect(save).not.toHaveBeenCalled()
  expect(container.textContent).toContain('当前有未保存修改');await clickText('继续编辑')
  expect(field('文本模型').value).toBe('draft-model');expect(field('文本服务 API Key').value).toBe('draft-secret')
  await clickText('新建方案');await clickText('保存并继续')
  expect(settings.cloudProfiles).toHaveLength(2);expect(field('文本服务 API Key').value).toBe('')
  await chooseProfile('old');expect(field('文本模型').value).toBe('draft-model')
})
it('supports discarding a draft for a switch and preserves the draft if the backend refuses switching',async()=>{
  await enableProfiles();await input('文本模型','discard-me');await clickText('新建方案');await clickText('放弃修改并继续')
  await chooseProfile('old');expect(field('文本模型').value).toBe('old-model')
  save.mockRejectedValueOnce(new Error('内容处理正在运行'))
  await chooseProfile('new-1')
  expect(field('文本模型').value).toBe('old-model');expect(settings.activeCloudProfileId).toBe('old')
  expect(container.textContent).toContain('内容处理正在运行')
})
it('preserves a stale draft when the active scheme changes externally and requires explicit reload',async()=>{
  await enableProfiles();await input('文本模型','unsaved-old');await input('文本服务 API Key','do-not-transfer')
  settings={...settings,activeCloudProfileId:'external',cloudProfileName:'外部方案',textModel:'external-model',cloudProfiles:[...settings.cloudProfiles!,{id:'external',name:'外部方案'}]}
  await act(async()=>dataChanged());expect(field('文本模型').value).toBe('unsaved-old')
  expect(field('文本服务 API Key').value).toBe('do-not-transfer')
  expect(container.textContent).toContain('当前生效方案已变化')
  await clickText('放弃草稿并载入当前方案');expect(field('文本模型').value).toBe('external-model');expect(field('文本服务 API Key').value).toBe('')
})
it('does not switch away when additional edits were typed during save-and-continue',async()=>{
  await enableProfiles();await input('文本模型','first-draft');await clickText('新建方案')
  let finish!:(value:AppSettings)=>void
  save.mockImplementationOnce(()=>new Promise<AppSettings>(resolve=>{finish=resolve}))
  await clickText('保存并继续');await input('文本模型','newer-draft')
  settings={...settings,textModel:'first-draft'};await act(async()=>finish({...settings}))
  expect(settings.cloudProfiles).toHaveLength(1);expect(field('文本模型').value).toBe('newer-draft')
  expect(container.textContent).toContain('当前有未保存修改')
})

const testButton=(service:'文本'|'视觉')=>container.querySelector<HTMLButtonElement>(`[aria-label="测试${service}服务连通性"]`)!
const testArea=(service:'文本'|'视觉')=>testButton(service).closest('.cloud-provider-group')!
async function enableVision(){
  settings={...settings,visionBaseUrl:'https://vision.example/v1',visionModel:'vision-model',hasVisionApiKey:true}
  await act(async()=>dataChanged())
}

it('offers manual tests for text and vision with the exact saved profile revision and no automatic requests',async()=>{
  expect(testButton('文本').disabled).toBe(true);expect(testButton('视觉').disabled).toBe(true)
  await enableProfiles();expect(testButton('文本').disabled).toBe(false);expect(testButton('视觉').disabled).toBe(true)
  await enableVision();await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(probe).not.toHaveBeenCalled()
  await act(async()=>{testButton('文本').click();testButton('视觉').click()})
  expect(probe.mock.calls.map(call=>call[0])).toEqual([
    {kind:'profile',profileId:'old',service:'text',expectedRevision:'old-r1'},
    {kind:'profile',profileId:'old',service:'vision',expectedRevision:'old-r1'}
  ])
  expect(testArea('文本').textContent).toContain('连接成功');expect(testArea('视觉').textContent).toContain('连接成功')
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(testArea('文本').textContent).toContain('连接成功');expect(probe).toHaveBeenCalledTimes(2)
})

it('keeps tests available for local policy edits but blocks cloud drafts and ignores late draft responses',async()=>{
  await enableProfiles();await enableVision();await act(async()=>testButton('文本').click())
  await input('缓存上限（GB）','30')
  expect(testButton('文本').disabled).toBe(false);expect(testArea('文本').textContent).toContain('连接成功')
  let finish!:(value:unknown)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>testButton('视觉').click());await input('文本模型','draft-model')
  expect(testButton('文本').disabled).toBe(true);expect(testButton('视觉').disabled).toBe(true)
  expect(testArea('文本').textContent).toContain('请先保存配置再测试');expect(testArea('文本').textContent).not.toContain('连接成功')
  await act(async()=>finish({ok:true,message:'old vision response',elapsedMs:1,testedAt:'2026-10-16T01:02:03Z',model:'old',service:'vision'}))
  expect(container.textContent).not.toContain('old vision response')
  await saveForm();expect(probe).toHaveBeenCalledTimes(2);expect(testButton('文本').disabled).toBe(false)
  await act(async()=>testButton('文本').click())
  expect(probe).toHaveBeenLastCalledWith({kind:'profile',profileId:'old',service:'text',expectedRevision:'old-r2'})
})

it('uses the newly activated profile identity and cannot attach the previous profile response to it',async()=>{
  await enableProfiles()
  let finish!:(value:unknown)=>void;probe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>testButton('文本').click());await clickText('复制为新方案')
  expect(settings.activeCloudProfileId).toBe('new-1');expect(testButton('文本').disabled).toBe(false)
  await act(async()=>testButton('文本').click())
  expect(probe).toHaveBeenLastCalledWith({kind:'profile',profileId:'new-1',service:'text',expectedRevision:'new-1-r2'})
  await act(async()=>finish({ok:false,message:'old profile failure',elapsedMs:1,testedAt:'2026-10-16T01:02:03Z',model:'old',service:'text'}))
  expect(testArea('文本').textContent).toContain('连接成功');expect(container.textContent).not.toContain('old profile failure')
  await chooseProfile('old');expect(testArea('文本').textContent).not.toContain('连接成功')
})

it('invalidates a result on an external revision without treating saved metadata as unsaved input',async()=>{
  await enableProfiles();await act(async()=>testButton('文本').click())
  settings={...settings,activeCloudProfileRevision:'external-r2'};await act(async()=>dataChanged())
  expect(testArea('文本').textContent).not.toContain('连接成功');expect(testButton('文本').disabled).toBe(false)
  await act(async()=>testButton('文本').click());expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({expectedRevision:'external-r2'}))
  await clickText('新建方案');expect(settings.activeCloudProfileId).toBe('new-1')
  expect(container.textContent).not.toContain('当前有未保存修改');expect(testButton('文本').disabled).toBe(true)
})
