import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {AppDatabase} from './database'
import type {AppSettings} from '../shared/contracts'
import {cloudProviderSettings,EMPTY_CLOUD_SETTINGS,type CloudProviderSettings} from '../shared/cloudProfiles'
import {SILICON_FLOW_BASE_URL,type SiliconFlowSlot,type SiliconFlowView} from '../shared/siliconFlow'
import {cloudConnectionInputSchema} from '../shared/cloudConnection'
import {CloudConnectionError,type ConnectionProvider,type ModelConnectionInput} from './cloudConnection'

type SecretStore={setApiKey(value:string):void;getApiKey():string|null;hasApiKey():boolean}
type Profile={id:string;name:string;settings:CloudProviderSettings;credentials:{text:string|null;vision:string|null};provider?:'siliconflow';providerSlot?:SiliconFlowSlot['slot']}
type Profiles={version:1;activeId:string;profiles:Profile[];siliconFlowCredentialRef?:string|null}
const KEY='cloud-profiles'

/** Profile selection and active settings commit together; secret files are immutable versions.
 * A failed save may leave an unreferenced encrypted file, but never replaces another profile's key. */
export class CloudProfiles {
  constructor(private database:AppDatabase,private secrets:(ref:string)=>SecretStore,private assertIdle:()=>void=()=>{}) {
    if(!this.database.db.prepare('SELECT 1 FROM app_settings WHERE key=?').get(KEY)){
      const settings=this.database.getSettings(),id=randomUUID()
      this.write({version:1,activeId:id,profiles:[{id,name:settings.textModel?`原有方案 · ${settings.textModel}`.slice(0,80):'默认方案',
        settings:cloudProviderSettings(settings),credentials:{text:'legacy-text',vision:'legacy-vision'}}]})
    }
  }
  private read():Profiles {
    const row=this.database.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(KEY)
    const value=JSON.parse(String(row?.value_json)) as Profiles
    if(value.version!==1||!Array.isArray(value.profiles)||!value.profiles.some(p=>p.id===value.activeId))throw Error('云端方案记录不可用，请保留数据并检查备份')
    return value
  }
  private write(value:Profiles):void {
    this.database.db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
      .run(KEY,JSON.stringify(value),new Date().toISOString())
  }
  getApiKey(kind:'text'|'vision'):string|null {
    const state=this.read(),profile=state.profiles.find(p=>p.id===state.activeId)!,ref=profile.credentials[kind]
    return ref?this.secrets(ref).getApiKey():null
  }
  workflowProvider(model:string,vision=false):import('./videoSummary').SummaryProvider {
    const state=this.read()
    const profiles=state.profiles.map(p=>p.id===state.activeId?{...p,settings:cloudProviderSettings(this.database.getSettings())}:p)
    const profile=profiles.find(p=>p.settings.textBaseUrl.replace(/\/$/,'')===SILICON_FLOW_BASE_URL&&p.settings.textModel===model&&(!vision||p.settings.visionModel===model))
    const ref=profile?.credentials[vision?'vision':'text'],apiKey=ref?this.secrets(ref).getApiKey():null
    if(!profile||!apiKey)throw Error(`请在设置的硅基流动模型位配置 ${model}${vision?' 并开启图片输入':''}`)
    return {kind:'cloud',baseUrl:SILICON_FLOW_BASE_URL,model,apiKey,protocol:'chat-completions'}
  }
  getSettings():AppSettings {
    const state=this.read(),active=state.profiles.find(p=>p.id===state.activeId)!
    return {...this.database.getSettings(),activeCloudProfileId:state.activeId,cloudProfileName:active.name,
      activeCloudProfileRevision:this.activeRevision(active),
      cloudProfiles:state.profiles.map(({id,name})=>({id,name})),hasTextApiKey:!!this.getApiKey('text'),hasVisionApiKey:!!this.getApiKey('vision')}
  }
  private activeRevision(active:Profile):string {
    return createHash('sha256').update(JSON.stringify({profile:active,settings:cloudProviderSettings(this.database.getSettings())})).digest('hex')
  }
  /** Resolve only the explicitly requested saved target; never activate it or borrow another key. */
  connectionProvider(input:ModelConnectionInput):ConnectionProvider {
    const parsed=cloudConnectionInputSchema.safeParse(input)
    if(!parsed.success||parsed.data.kind==='doubao')throw new CloudConnectionError('invalid_input','连通测试参数无效，请重新打开设置后重试。')
    const request=parsed.data
    let profile:Profile,service:'text'|'vision'
    if(request.kind==='siliconflow'){
      const {managed,revision}=this.siliconFlowState()
      if(request.expectedRevision!==revision)throw new CloudConnectionError('stale_config','硅基流动配置已变化，请重新载入并保存配置后再测试。')
      const target=managed.find(p=>p.id===request.profileId)
      if(!target)throw new CloudConnectionError('missing_profile','要测试的硅基流动模型不存在，请重新载入设置。')
      profile=target;service=profile.settings.visionModel?'vision':'text'
    }else{
      const state=this.read(),active=state.profiles.find(p=>p.id===state.activeId)!
      if(request.profileId!==active.id||request.expectedRevision!==this.activeRevision(active))throw new CloudConnectionError('stale_config','当前云端方案已变化，请重新载入并保存配置后再测试。')
      profile={...active,settings:cloudProviderSettings(this.database.getSettings())};service=request.service
    }
    const ref=profile.credentials[service],apiKey=ref?this.secrets(ref).getApiKey():null
    if(!apiKey)throw new CloudConnectionError('missing_api_key','此模型尚未保存 API Key，请保存对应配置后再测试。')
    return {baseUrl:profile.settings[service+'BaseUrl' as 'textBaseUrl'|'visionBaseUrl'],model:profile.settings[service+'Model' as 'textModel'|'visionModel'],apiKey,
      protocol:service==='text'?profile.settings.textApiProtocol:'chat-completions',service}
  }
  private siliconFlowState(){
    const state=this.read()
    state.profiles.find(p=>p.id===state.activeId)!.settings=cloudProviderSettings(this.database.getSettings())
    const managed=state.profiles.filter(p=>p.provider==='siliconflow').sort((a,b)=>a.providerSlot!-b.providerSlot!)
    if(new Set(managed.map(p=>p.providerSlot)).size!==managed.length||managed.some(p=>!Number.isSafeInteger(p.providerSlot)||p.providerSlot!<=0))throw Error('硅基流动方案记录异常，请保留配置并检查')
    // Older installations kept the shared credential only on their model profiles.
    const sharedRef=state.siliconFlowCredentialRef??managed.map(p=>p.credentials.text).find(ref=>!!ref&&this.secrets(ref).hasApiKey())??managed.find(p=>p.credentials.text)?.credentials.text??null
    const revision=createHash('sha256').update(JSON.stringify({managed,sharedRef})).digest('hex')
    return {state,managed,sharedRef,revision}
  }
  getSiliconFlow():SiliconFlowView{
    const {managed,sharedRef,revision}=this.siliconFlowState()
    const slots=managed.map(profile=>({slot:profile.providerSlot!,profileId:profile.id,profileName:profile.name,
      model:profile.settings.textModel,visionEnabled:!!profile.settings.visionModel,
      hasSecret:!!profile.credentials.text&&this.secrets(profile.credentials.text).hasApiKey()}))
    return {baseUrl:SILICON_FLOW_BASE_URL,protocol:'chat-completions',revision,hasSecret:!!sharedRef&&this.secrets(sharedRef).hasApiKey(),slots}
  }
  saveSiliconFlow(input:unknown):SiliconFlowView{
    this.assertIdle()
    const slotSchema=z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    const modelSchema=z.object({slot:slotSchema.optional(),model:z.string().trim().max(200).refine(v=>!/[\s\u0000-\u001f]/.test(v),'模型ID不能包含空白或控制字符'),visionEnabled:z.boolean()}).strict()
    const request=z.object({expectedRevision:z.string(),secret:z.string().trim().max(2000).refine(v=>!/[\s\u0000-\u001f]/.test(v),'API Key不能包含空白或控制字符'),
      models:z.array(modelSchema),deletedSlots:z.array(slotSchema).optional()}).strict().parse(input)
    const {state,managed,sharedRef:previousRef,revision}=this.siliconFlowState()
    if(request.expectedRevision!==revision)throw Error('硅基流动配置已变化，请重新载入后保存')
    if(request.models.some(model=>model.slot!==undefined)&&request.models.some(model=>model.slot===undefined))throw Error('模型位编号必须全部填写或全部省略')
    const updates=request.models.map((model,index)=>({...model,slot:model.slot??index+1})),deleted=new Set(request.deletedSlots??[])
    if(new Set(updates.map(model=>model.slot)).size!==updates.length||deleted.size!==(request.deletedSlots?.length??0))throw Error('模型位编号不能重复')
    if(updates.some(model=>deleted.has(model.slot)))throw Error('同一模型位不能同时保存和删除')
    if([...deleted].some(slot=>!managed.some(profile=>profile.providerSlot===slot)))throw Error('要删除的模型位不存在，请重新载入后保存')
    this.database.db.exec('BEGIN IMMEDIATE')
    try{
      let sharedRef=previousRef
      if(request.secret){sharedRef=randomUUID();this.secrets(sharedRef).setApiKey(request.secret)}
      state.siliconFlowCredentialRef=sharedRef
      state.profiles=state.profiles.filter(profile=>profile.provider!=='siliconflow'||!deleted.has(profile.providerSlot!))
      // Omitted rows are retained for compatibility with older two/three-model clients.
      for(const model of updates){
        const slot=model.slot
        let target=managed.find(p=>p.providerSlot===slot)
        if(!target){
          const base=`硅基流动 · 模型 ${slot}`;let name=base,n=2
          while(state.profiles.some(p=>p.name===name))name=`${base} (${n++})`
          target={id:randomUUID(),name,settings:{...EMPTY_CLOUD_SETTINGS},credentials:{text:sharedRef,vision:null},provider:'siliconflow',providerSlot:slot}
          state.profiles.push(target)
        }
        target.settings={...target.settings,textBaseUrl:SILICON_FLOW_BASE_URL,textApiProtocol:'chat-completions',textModel:model.model,
          visionBaseUrl:model.visionEnabled?SILICON_FLOW_BASE_URL:'',visionModel:model.visionEnabled?model.model:''}
        target.credentials.vision=model.visionEnabled?target.credentials.text:null
      }
      const remaining=state.profiles.filter(profile=>profile.provider==='siliconflow').sort((a,b)=>a.providerSlot!-b.providerSlot!)
      if(request.secret)for(const target of remaining){target.credentials.text=sharedRef;target.credentials.vision=target.settings.visionModel?sharedRef:null}
      if(!state.profiles.some(profile=>profile.id===state.activeId)){
        const fallback=remaining.find(profile=>profile.settings.textModel&&profile.credentials.text&&this.secrets(profile.credentials.text).hasApiKey())??state.profiles.find(profile=>profile.provider!=='siliconflow')
        if(!fallback)throw Error('删除后没有可用的云端方案，请保留至少一个方案')
        state.activeId=fallback.id
      }
      const active=state.profiles.find(profile=>profile.id===state.activeId)!,currentSettings=cloudProviderSettings(this.database.getSettings())
      if(Object.keys(active.settings).some(key=>active.settings[key as keyof CloudProviderSettings]!==currentSettings[key as keyof CloudProviderSettings]))this.database.saveSettings(active.settings)
      this.write(state)
      this.database.db.exec('COMMIT')
    }catch(error){this.database.db.exec('ROLLBACK');throw error}
    return this.getSiliconFlow()
  }
  save(input:Record<string,unknown>):AppSettings {
    this.assertIdle()
    const state=this.read(),active=state.profiles.find(p=>p.id===state.activeId)!
    const expected=input.expectedCloudProfileId??input.activeCloudProfileId
    if((expected!==undefined&&expected!==state.activeId)||(expected===undefined&&state.profiles.length>1))throw Error('当前云端方案已变化，请重新打开设置后保存')
    const action=input.cloudProfileAction??'save'
    if(!['save','activate','create','duplicate'].includes(String(action)))throw Error('不支持的云端方案操作')
    let target=active
    if(action==='activate'){
      const match=state.profiles.find(p=>p.id===input.cloudProfileId)
      if(!match)throw Error('云端方案不存在')
      target=match
    }else if(action==='create'||action==='duplicate'){
      if(state.profiles.filter(profile=>profile.provider!=='siliconflow').length>=30)throw Error('最多保存30套云端方案')
      let name=action==='create'?'新方案':'方案副本',index=2
      while(state.profiles.some(p=>p.name===name))name=(action==='create'?'新方案 ':'方案副本 ')+index++
      target={id:randomUUID(),name,settings:action==='create'?{...EMPTY_CLOUD_SETTINGS}:{...cloudProviderSettings(this.database.getSettings())},
        credentials:action==='create'?{text:null,vision:null}:{...active.credentials}}
      state.profiles.push(target)
    }
    if(action==='save'&&input.cloudProfileName!==undefined){
      if(typeof input.cloudProfileName!=='string'||!input.cloudProfileName.trim()||input.cloudProfileName.trim().length>80)throw Error('方案名称请填写1至80个字符')
      const name=input.cloudProfileName.trim()
      if(state.profiles.some(p=>p.id!==target.id&&p.name===name))throw Error('已有同名云端方案，请换一个名称')
      target.name=name
    }
    // Validate all settings first. The SQL transaction also rolls back on secure-storage failure.
    this.database.db.exec('BEGIN IMMEDIATE')
    try{
      active.settings=cloudProviderSettings(this.database.getSettings())
      const saved=this.database.saveSettings(action==='save'?input:target.settings)
      target.settings=cloudProviderSettings(saved)
      if(action==='save')for(const kind of ['text','vision'] as const){
        const value=input[kind+'ApiKey']
        if(value!==undefined&&typeof value!=='string')throw Error('API Key 必须为文本')
        if(typeof value==='string'&&value.trim()){
          const ref=randomUUID();this.secrets(ref).setApiKey(value.trim());target.credentials[kind]=ref
        }
      }
      state.activeId=target.id;this.write(state)
      this.database.db.exec('COMMIT')
    }catch(error){this.database.db.exec('ROLLBACK');throw error}
    return this.getSettings()
  }
}
