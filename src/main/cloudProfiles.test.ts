import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {AppDatabase} from './database'
import {CloudProfiles} from './cloudProfiles'

let database:AppDatabase,profiles:CloudProfiles,secrets:Map<string,string>,writes:string[],blocked:boolean,failAfter:number
const factory=(ref:string)=>({
  getApiKey:()=>secrets.get(ref)??null,hasApiKey:()=>secrets.has(ref),
  setApiKey:(key:string)=>{if(--failAfter===0)throw Error('secure storage unavailable');writes.push(ref);secrets.set(ref,key)}
})
const operate=(input:Record<string,unknown>)=>profiles.save({expectedCloudProfileId:profiles.getSettings().activeCloudProfileId,...input})
beforeEach(()=>{
 database=new AppDatabase(':memory:');secrets=new Map([['legacy-text','old-text-secret'],['legacy-vision','old-vision-secret']]);writes=[];blocked=false;failAfter=Infinity
 database.saveSettings({textBaseUrl:'https://old.example/v1',textApiProtocol:'responses',textModel:'original-model',visionBaseUrl:'https://old-vision.example/v1',visionModel:'original-vision',textInputPricePerMillion:2,cacheLimitGb:37,interests:['金融']})
 profiles=new CloudProfiles(database,factory,()=>{if(blocked)throw Error('内容处理正在运行')})
})
afterEach(()=>database.close())

describe('cloud provider profiles',()=>{
 it('resolves the selected inactive SiliconFlow model and its own vision credentials without changing settings',()=>{
  const before=profiles.getSettings(),initialRows=database.db.prepare('SELECT * FROM app_settings ORDER BY key').all()
  profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret:'silicon-only-key',models:[{model:'vision-model',visionEnabled:true},{model:'text-model',visionEnabled:false}]})
  const view=profiles.getSiliconFlow(),rows=database.db.prepare('SELECT * FROM app_settings ORDER BY key').all(),writesBefore=[...writes]
  expect(profiles.connectionProvider({kind:'siliconflow',profileId:view.slots[0].profileId!,expectedRevision:view.revision})).toMatchObject({model:'vision-model',service:'vision',apiKey:'silicon-only-key',protocol:'chat-completions'})
  expect(profiles.connectionProvider({kind:'siliconflow',profileId:view.slots[1].profileId!,expectedRevision:view.revision})).toMatchObject({model:'text-model',service:'text',apiKey:'silicon-only-key'})
  expect(database.db.prepare('SELECT * FROM app_settings ORDER BY key').all()).toEqual(rows);expect(writes).toEqual(writesBefore)
  expect(profiles.getSettings().activeCloudProfileId).toBe(before.activeCloudProfileId);expect(profiles.getApiKey('text')).toBe('old-text-secret');expect(initialRows).not.toEqual(rows)
 })
 it('resolves generic text and vision from only the active profile, with the selected text protocol',()=>{
  const settings=profiles.getSettings(),expectedRevision=settings.activeCloudProfileRevision!,profileId=settings.activeCloudProfileId!
  expect(profiles.connectionProvider({kind:'profile',profileId,expectedRevision,service:'text'})).toEqual({baseUrl:'https://old.example/v1',model:'original-model',apiKey:'old-text-secret',protocol:'responses',service:'text'})
  expect(profiles.connectionProvider({kind:'profile',profileId,expectedRevision,service:'vision'})).toEqual({baseUrl:'https://old-vision.example/v1',model:'original-vision',apiKey:'old-vision-secret',protocol:'chat-completions',service:'vision'})
  operate({cloudProfileAction:'create'});const next=operate({textBaseUrl:'https://other.example/v1',textModel:'no-key'})
  expect(()=>profiles.connectionProvider({kind:'profile',profileId,expectedRevision,service:'text'})).toThrow(/已变化/)
  expect(()=>profiles.connectionProvider({kind:'profile',profileId:next.activeCloudProfileId!,expectedRevision:next.activeCloudProfileRevision!,service:'text'})).toThrow(/API Key/)
  expect(profiles.getApiKey('text')).toBeNull()
 })
 it('rejects stale revisions after settings edits, credential rotation or SiliconFlow changes',()=>{
  const before=profiles.getSettings(),oldRequest={kind:'profile' as const,profileId:before.activeCloudProfileId!,expectedRevision:before.activeCloudProfileRevision!,service:'text' as const}
  operate({textApiKey:'rotated-key'});expect(profiles.getSettings().activeCloudProfileRevision).not.toBe(before.activeCloudProfileRevision);expect(()=>profiles.connectionProvider(oldRequest)).toThrow(/已变化/)
  const settings=profiles.getSettings();database.saveSettings({textModel:'changed-outside-profile'})
  expect(()=>profiles.connectionProvider({...oldRequest,expectedRevision:settings.activeCloudProfileRevision!})).toThrow(/已变化/)
  profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret:'sf-key',models:[{model:'sf-model',visionEnabled:false}]})
  const sf=profiles.getSiliconFlow(),request={kind:'siliconflow' as const,profileId:sf.slots[0].profileId!,expectedRevision:sf.revision}
  profiles.saveSiliconFlow({expectedRevision:sf.revision,secret:'sf-rotated',models:[]});expect(()=>profiles.connectionProvider(request)).toThrow(/已变化/)
  expect(JSON.stringify(profiles.getSettings())).not.toMatch(/rotated-key|sf-rotated|legacy-text/)
 })
 it('workflow picks the specified saved SiliconFlow model and credentials without changing the active profile',()=>{
  const original=profiles.getSettings().activeCloudProfileId
  profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret:'silicon-secret',models:[
    {model:'zai-org/GLM-5.3-Flash',visionEnabled:false},{model:'Qwen/Qwen3.5-4B',visionEnabled:true},{model:'',visionEnabled:false}]})
  expect(profiles.workflowProvider('zai-org/GLM-5.3-Flash')).toMatchObject({model:'zai-org/GLM-5.3-Flash',baseUrl:'https://api.siliconflow.cn/v1',apiKey:'silicon-secret',protocol:'chat-completions'})
  expect(profiles.workflowProvider('Qwen/Qwen3.5-4B',true)).toMatchObject({model:'Qwen/Qwen3.5-4B',apiKey:'silicon-secret'})
  expect(()=>profiles.workflowProvider('missing-model')).toThrow('请在设置')
  expect(profiles.getSettings().activeCloudProfileId).toBe(original)
 })
 it('adopts the legacy settings and both encrypted credentials without overwriting or copying them',()=>{
  const saved=profiles.getSettings()
  expect(saved).toMatchObject({textModel:'original-model',textApiProtocol:'responses',hasTextApiKey:true,hasVisionApiKey:true,cloudProfileName:'原有方案 · original-model'})
  expect(saved.cloudProfiles).toHaveLength(1);expect(writes).toEqual([])
  expect(profiles.getApiKey('text')).toBe('old-text-secret')
  expect(JSON.stringify(database.db.prepare('SELECT * FROM app_settings').all())).not.toContain('old-text-secret')
  expect(JSON.stringify(saved)).not.toContain('credentials')
 })
 it('creates an empty scheme, saves its own keys, and restores either provider after switching and reopening',()=>{
  const old=profiles.getSettings(),next=operate({cloudProfileAction:'create'})
  expect(next).toMatchObject({textBaseUrl:'',textModel:'',visionModel:'',hasTextApiKey:false,hasVisionApiKey:false,cacheLimitGb:37,interests:['金融']})
  const saved=operate({cloudProfileName:'第二厂商',textBaseUrl:' https://new.example/v1 ',textModel:'new-model',textApiProtocol:'chat-completions',textApiKey:'new-secret',visionApiKey:'vision-new-secret'})
  expect(saved.textBaseUrl).toBe('https://new.example/v1');expect(profiles.getApiKey('text')).toBe('new-secret')
  operate({cloudProfileAction:'activate',cloudProfileId:old.activeCloudProfileId})
  expect(profiles.getSettings()).toMatchObject({textBaseUrl:old.textBaseUrl,textModel:'original-model',visionModel:'original-vision',textApiProtocol:'responses',textInputPricePerMillion:2})
  expect(profiles.getApiKey('text')).toBe('old-text-secret');expect(profiles.getApiKey('vision')).toBe('old-vision-secret')
  operate({cloudProfileAction:'activate',cloudProfileId:next.activeCloudProfileId})
  profiles=new CloudProfiles(database,factory)
  expect(profiles.getSettings()).toMatchObject({textModel:'new-model',textApiProtocol:'chat-completions',cloudProfileName:'第二厂商'})
  expect(profiles.getApiKey('text')).toBe('new-secret');expect(profiles.getApiKey('vision')).toBe('vision-new-secret')
  expect(secrets.get('legacy-text')).toBe('old-text-secret')
 })
 it('does not substitute another profile key for a blank new key, and blank edits retain only the current profile key',()=>{
  operate({cloudProfileAction:'create'});operate({textModel:'no-key',textBaseUrl:'https://other.example/v1',textApiKey:''})
  expect(profiles.getApiKey('text')).toBeNull()
  operate({textApiKey:'scoped-secret'});operate({textApiKey:'  ',textModel:'edited'})
  expect(profiles.getApiKey('text')).toBe('scoped-secret')
 })
 it('duplicates into an independent configuration, and key rotation never changes the source profile',()=>{
  const old=profiles.getSettings();operate({cloudProfileAction:'duplicate'})
  expect(profiles.getSettings().textModel).toBe('original-model');expect(profiles.getApiKey('text')).toBe('old-text-secret')
  operate({cloudProfileName:'copy',textApiKey:'copy-secret',textModel:'copy-model'})
  operate({cloudProfileAction:'activate',cloudProfileId:old.activeCloudProfileId})
  expect(profiles.getApiKey('text')).toBe('old-text-secret');expect(profiles.getSettings().textModel).toBe('original-model')
 })
 it('rejects invalid settings before writing any credential and rolls back both settings and key references on failure',()=>{
  const before=profiles.getSettings()
  expect(()=>operate({textBaseUrl:'not a url',textApiKey:'must-not-save'})).toThrow(/有效地址/)
  expect(writes).toEqual([]);expect(profiles.getSettings()).toEqual(before)
  failAfter=2
  expect(()=>operate({textModel:'failed-model',textApiKey:'first-write',visionApiKey:'second-write'})).toThrow(/secure storage/)
  expect(profiles.getSettings()).toEqual(before);expect(profiles.getApiKey('text')).toBe('old-text-secret');expect(profiles.getApiKey('vision')).toBe('old-vision-secret')
 })
 it('rejects stale forms and unknown selections without sending a new key to the current profile',()=>{
  const original=profiles.getSettings();operate({cloudProfileAction:'create'})
  expect(()=>profiles.save({...original,textApiKey:'stale-secret'})).toThrow(/已变化/)
  expect(()=>profiles.save({textModel:'ambiguous-model'})).toThrow(/已变化/)
  expect(()=>operate({cloudProfileAction:'activate',cloudProfileId:'missing'})).toThrow(/不存在/)
  expect(profiles.getApiKey('text')).toBeNull();expect(writes).toEqual([])
 })
 it('blocks edits and profile switches during an active processing task',()=>{
  const before=profiles.getSettings();blocked=true
  expect(()=>operate({cloudProfileAction:'create'})).toThrow(/正在运行/)
  expect(()=>operate({textModel:'changed'})).toThrow(/正在运行/)
  expect(profiles.getSettings()).toEqual(before)
 })
 it('renames only the chosen scheme and rejects duplicate or empty names',()=>{
  const old=profiles.getSettings();operate({cloudProfileAction:'create'})
  expect(()=>operate({cloudProfileName:old.cloudProfileName})).toThrow(/同名/)
  expect(()=>operate({cloudProfileName:'   '})).toThrow(/名称/)
  const saved=operate({cloudProfileName:' 新厂商 '})
  expect(saved.cloudProfiles).toEqual([{id:old.activeCloudProfileId,name:old.cloudProfileName},{id:saved.activeCloudProfileId,name:'新厂商'}])
 })
})
