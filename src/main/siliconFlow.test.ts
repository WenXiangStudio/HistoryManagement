import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {AppDatabase} from './database'
import {CloudProfiles} from './cloudProfiles'
import {SILICON_FLOW_BASE_URL} from '../shared/siliconFlow'
let db:AppDatabase,profiles:CloudProfiles,secrets:Map<string,string>,blocked:boolean,failSecret:boolean
const blank=()=>[{model:'',visionEnabled:false},{model:'',visionEnabled:false},{model:'',visionEnabled:false}] as const
beforeEach(()=>{
  db=new AppDatabase(':memory:');secrets=new Map([['legacy-text','original-secret']]);blocked=false;failSecret=false
  db.saveSettings({textBaseUrl:'https://old.example/v1',textApiProtocol:'responses',textModel:'old-model',cacheLimitGb:37,interests:['科技']})
  db.db.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('doubao-speech',JSON.stringify({secretRef:'doubao-ref',authMode:'api-key'}),'old')
  profiles=new CloudProfiles(db,ref=>({getApiKey:()=>secrets.get(ref)??null,hasApiKey:()=>secrets.has(ref),setApiKey:key=>{if(failSecret)throw Error('DPAPI unavailable');secrets.set(ref,key)}}),()=>{if(blocked)throw Error('busy')})
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No provider call allowed during configuration')}))
})
afterEach(()=>{db.close();vi.unstubAllGlobals()})
const save=(secret='',models:unknown=blank())=>profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret,models})
const snapshot=()=>JSON.stringify(db.db.prepare('SELECT * FROM app_settings ORDER BY key').all())
const state=()=>JSON.parse(String(db.db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get()!.value_json))
const activate=(id:string)=>profiles.save({cloudProfileAction:'activate',cloudProfileId:id,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
const remove=(deletedSlots:number[],models:unknown[]=[],secret='')=>profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret,models,deletedSlots})
describe('SiliconFlow model configuration',()=>{
  it('reads an unconfigured group as empty without creating records or borrowing unrelated credentials',()=>{
    const before=snapshot(),view=profiles.getSiliconFlow()
    expect(view).toMatchObject({slots:[],hasSecret:false,baseUrl:SILICON_FLOW_BASE_URL})
    expect(snapshot()).toBe(before)
  })
  it('creates three empty official presets once without changing active provider or using any old key',()=>{
    const prior=profiles.getSettings(),settingsRow=db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get(),doubao=db.db.prepare("SELECT * FROM app_settings WHERE key='doubao-speech'").get()
    const saved=save()
    expect(saved.slots).toHaveLength(3);expect(saved.baseUrl).toBe(SILICON_FLOW_BASE_URL)
    expect(saved.slots.every(s=>!s.model&&!s.visionEnabled&&!s.hasSecret&&s.profileId)).toBe(true)
    expect(profiles.getSettings()).toMatchObject({activeCloudProfileId:prior.activeCloudProfileId,textModel:'old-model',cacheLimitGb:37})
    expect(profiles.getApiKey('text')).toBe('original-secret')
    expect(db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get()).toEqual(settingsRow)
    expect(db.db.prepare("SELECT * FROM app_settings WHERE key='doubao-speech'").get()).toEqual(doubao)
    save();expect(profiles.getSettings().cloudProfiles).toHaveLength(4)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shares one encrypted credential reference across three independent models and activates through existing profiles',()=>{
    const original=profiles.getSettings().activeCloudProfileId
    const view=save('silicon-secret',[{model:'org/text-model',visionEnabled:false},{model:'org/vision-model',visionEnabled:true},{model:'org/third-model',visionEnabled:true}])
    expect(snapshot()).not.toContain('silicon-secret');expect(JSON.stringify(view)).not.toContain('secretRef')
    expect(view.slots.every(s=>s.hasSecret)).toBe(true)
    const activate=(id:string)=>profiles.save({cloudProfileAction:'activate',cloudProfileId:id,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    expect(activate(view.slots[0].profileId!)).toMatchObject({textModel:'org/text-model',textApiProtocol:'chat-completions',textBaseUrl:SILICON_FLOW_BASE_URL,visionModel:'',hasVisionApiKey:false})
    expect(profiles.getApiKey('text')).toBe('silicon-secret')
    expect(activate(view.slots[1].profileId!)).toMatchObject({textModel:'org/vision-model',visionModel:'org/vision-model',visionBaseUrl:SILICON_FLOW_BASE_URL,hasVisionApiKey:true})
    expect(profiles.getApiKey('vision')).toBe('silicon-secret')
    expect(activate(view.slots[2].profileId!)).toMatchObject({textModel:'org/third-model',visionModel:'org/third-model',hasTextApiKey:true,hasVisionApiKey:true})
    activate(original!);expect(profiles.getApiKey('text')).toBe('original-secret')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves stored keys on blank input and safely rotates all SiliconFlow slots with a new reference',()=>{
    save('first-key');const refsBefore=new Set(secrets.keys());save()
    expect(new Set(secrets.keys())).toEqual(refsBefore)
    save('second-key');expect(secrets.size).toBe(refsBefore.size+1)
    expect([...secrets.values()]).toContain('first-key');expect([...secrets.values()]).toContain('original-secret')
    const v=profiles.getSiliconFlow();profiles.save({cloudProfileAction:'activate',cloudProfileId:v.slots[0].profileId,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    expect(profiles.getApiKey('text')).toBe('second-key')
  })
  it('rejects stale dedicated drafts after generic profile edits and leaves other profile settings intact',()=>{
    const v=save('key',[{model:'first',visionEnabled:false},{model:'second',visionEnabled:false}])
    profiles.save({cloudProfileAction:'activate',cloudProfileId:v.slots[0].profileId,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    profiles.save({textModel:'changed-elsewhere',expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    const before=snapshot()
    expect(()=>profiles.saveSiliconFlow({expectedRevision:v.revision,secret:'',models:blank()})).toThrow(/已变化/)
    expect(snapshot()).toBe(before);expect(profiles.getSiliconFlow().slots[0].model).toBe('changed-elsewhere')
  })
  it('updates active SiliconFlow settings atomically without changing selected provider or local preferences',()=>{
    const v=save('key');profiles.save({cloudProfileAction:'activate',cloudProfileId:v.slots[1].profileId,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    save('',[{model:'one',visionEnabled:false},{model:'two',visionEnabled:true}])
    expect(profiles.getSettings()).toMatchObject({activeCloudProfileId:v.slots[1].profileId,textModel:'two',visionModel:'two',cacheLimitGb:37,interests:['科技']})
  })
  it('keeps previous configuration on validation, busy or secure-storage failures',()=>{
    const before=snapshot()
    expect(()=>save('key\nother')).toThrow();expect(()=>save('',[{model:'bad model',visionEnabled:false},{model:'',visionEnabled:false}])).toThrow()
    failSecret=true;expect(()=>save('key')).toThrow(/DPAPI/);expect(snapshot()).toBe(before)
    failSecret=false;blocked=true;expect(()=>save()).toThrow(/busy/);expect(snapshot()).toBe(before)
  })
  it('does not adopt or overwrite an unrelated profile that happens to have the same name',()=>{
    profiles.save({cloudProfileName:'硅基流动 · 模型 1',expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    const v=save();expect(v.slots[0].profileName).toBe('硅基流动 · 模型 1 (2)')
    expect(profiles.getSettings().textModel).toBe('old-model');expect(profiles.getApiKey('text')).toBe('original-secret')
  })
  it('reads existing two slots without adding placeholders and adds a third only when requested',()=>{
    const created=save('saved-silicon-key',[{model:'zai-org/GLM-5.3-Flash',visionEnabled:true},{model:'Qwen/Qwen3.5-4B',visionEnabled:true}])
    profiles.save({cloudProfileAction:'activate',cloudProfileId:created.slots[1].profileId,expectedCloudProfileId:profiles.getSettings().activeCloudProfileId})
    const state=JSON.parse(String(db.db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get()!.value_json))
    state.profiles=state.profiles.filter((p:any)=>p.providerSlot!==3)
    db.db.prepare("UPDATE app_settings SET value_json=? WHERE key='cloud-profiles'").run(JSON.stringify(state))
    const previous=structuredClone(state.profiles),settingsRow=db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get(),secretRefs=new Set(secrets.keys())
    const read=profiles.getSiliconFlow();expect(read.slots).toHaveLength(2);expect(read.hasSecret).toBe(true)
    const upgraded=profiles.saveSiliconFlow({expectedRevision:read.revision,secret:'',models:[{model:read.slots[0].model,visionEnabled:true},{model:read.slots[1].model,visionEnabled:true},{model:'',visionEnabled:false}]})
    expect(upgraded.slots[2]).toMatchObject({model:'',visionEnabled:false,hasSecret:true})
    const after=JSON.parse(String(db.db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get()!.value_json))
    for(const p of previous)expect(after.profiles.find((v:any)=>v.id===p.id)).toEqual(p)
    expect(after.activeId).toBe(state.activeId);expect(after.profiles).toHaveLength(previous.length+1)
    expect(after.profiles.find((p:any)=>p.providerSlot===3).credentials.text).toBe(after.profiles.find((p:any)=>p.providerSlot===1).credentials.text)
    expect(db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get()).toEqual(settingsRow);expect(new Set(secrets.keys())).toEqual(secretRefs)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('legacy two-slot saves preserve an already configured third model',()=>{
    const input=[{model:'one',visionEnabled:false},{model:'two',visionEnabled:true},{model:'three',visionEnabled:true}]
    save('first',input);const third=profiles.getSiliconFlow().slots[2]
    save('',input.slice(0,2));expect(profiles.getSiliconFlow().slots[2]).toEqual(third)
    save('rotated',input.slice(0,2));expect(profiles.getSiliconFlow().slots[2]).toMatchObject({model:'three',visionEnabled:true,hasSecret:true})
  })
  it('adds more than thirty models with stable sparse slot identities and the existing SiliconFlow key',()=>{
    const first=save('shared-key',[{slot:5,model:'first',visionEnabled:true}]).slots[0],refs=new Set(secrets.keys())
    const models=Array.from({length:45},(_,i)=>({slot:1000+i*1000,model:`org/model-${i}`,visionEnabled:i%2===0}))
    const view=save('',models)
    expect(view.slots).toHaveLength(46);expect(view.slots[0]).toEqual(first)
    expect(view.slots.every(slot=>slot.hasSecret&&slot.profileId)).toBe(true)
    expect(view.slots.at(-1)?.slot).toBe(45000);expect(new Set(secrets.keys())).toEqual(refs)
    const stored=state(),shared=stored.profiles.find((p:any)=>p.providerSlot===5).credentials.text
    expect(stored.profiles.filter((p:any)=>p.provider==='siliconflow').every((p:any)=>p.credentials.text===shared&&p.credentials.vision===(p.settings.visionModel?shared:null))).toBe(true)
    expect(stored.siliconFlowCredentialRef).toBe(shared)
  })
  it('does not let SiliconFlow models consume the thirty ordinary cloud-profile quota',()=>{
    const original=profiles.getSettings().activeCloudProfileId
    const view=save('shared-key',Array.from({length:35},(_,i)=>({slot:i+1,model:`org/model-${i}`,visionEnabled:false})))
    const created=profiles.save({cloudProfileAction:'create',expectedCloudProfileId:original})
    expect(created).toMatchObject({textModel:'',hasTextApiKey:false,cacheLimitGb:37,interests:['科技']})
    expect(created.cloudProfiles).toHaveLength(37);expect(profiles.getSiliconFlow().slots).toEqual(view.slots)
    const duplicated=profiles.save({cloudProfileAction:'duplicate',expectedCloudProfileId:created.activeCloudProfileId})
    expect(duplicated.cloudProfiles).toHaveLength(38)
  })
  it('deletes only explicit model identities while preserving every remaining profile and unrelated settings',()=>{
    const before=save('key',[{slot:2,model:'two',visionEnabled:true},{slot:9,model:'nine',visionEnabled:false},{slot:100,model:'hundred',visionEnabled:true}])
    const previousState=state(),settingsRow=db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get(),doubao=db.db.prepare("SELECT * FROM app_settings WHERE key='doubao-speech'").get()
    const result=remove([9])
    expect(result.slots).toEqual([before.slots[0],before.slots[2]])
    const after=state()
    for(const profile of previousState.profiles.filter((p:any)=>p.providerSlot!==9))expect(after.profiles.find((p:any)=>p.id===profile.id)).toEqual(profile)
    expect(db.db.prepare("SELECT * FROM app_settings WHERE key='settings'").get()).toEqual(settingsRow)
    expect(db.db.prepare("SELECT * FROM app_settings WHERE key='doubao-speech'").get()).toEqual(doubao)
    expect(profiles.getApiKey('text')).toBe('original-secret')
  })
  it('keeps omitted rows and allows explicit edits and removal in the same save',()=>{
    const initial=save('key',[{slot:3,model:'three',visionEnabled:true},{slot:8,model:'eight',visionEnabled:false},{slot:40,model:'forty',visionEnabled:false}])
    const view=remove([8],[{slot:40,model:'changed',visionEnabled:true}])
    expect(view.slots[0]).toEqual(initial.slots[0]);expect(view.slots[1]).toMatchObject({slot:40,profileId:initial.slots[2].profileId,model:'changed',visionEnabled:true,hasSecret:true})
    save('',[]);expect(profiles.getSiliconFlow()).toEqual(view)
  })
  it('selects the first remaining configured SiliconFlow model after deleting the active model',()=>{
    const view=save('shared-key',[{slot:20,model:'active',visionEnabled:false},{slot:2,model:'',visionEnabled:false},{slot:50,model:'fallback',visionEnabled:true},{slot:80,model:'later',visionEnabled:false}])
    activate(view.slots.find(slot=>slot.slot===20)!.profileId!)
    const fallback=view.slots.find(slot=>slot.slot===50)!
    remove([20])
    expect(profiles.getSettings()).toMatchObject({activeCloudProfileId:fallback.profileId,textModel:'fallback',visionModel:'fallback',cacheLimitGb:37,interests:['科技']})
    expect(profiles.getApiKey('text')).toBe('shared-key');expect(profiles.getApiKey('vision')).toBe('shared-key')
  })
  it('returns to an unrelated profile if remaining SiliconFlow models lack a model or credential',()=>{
    const original=profiles.getSettings(),view=save('',[{slot:4,model:'active',visionEnabled:true},{slot:7,model:'no-key',visionEnabled:false}])
    activate(view.slots[0].profileId!);remove([4])
    expect(profiles.getSettings()).toMatchObject({activeCloudProfileId:original.activeCloudProfileId,textModel:'old-model',textApiProtocol:'responses',cacheLimitGb:37,interests:['科技']})
    expect(profiles.getApiKey('text')).toBe('original-secret')
  })
  it('retains the group credential after all models are removed and reuses it for a later model',()=>{
    const original=profiles.getSettings(),view=save('retained-key',[{slot:12,model:'first',visionEnabled:true}])
    activate(view.slots[0].profileId!)
    const empty=remove([12]),refs=new Set(secrets.keys())
    expect(empty).toMatchObject({slots:[],hasSecret:true});expect(profiles.getSettings().activeCloudProfileId).toBe(original.activeCloudProfileId)
    profiles=new CloudProfiles(db,ref=>({getApiKey:()=>secrets.get(ref)??null,hasApiKey:()=>secrets.has(ref),setApiKey:key=>secrets.set(ref,key)}))
    const next=save('',[{slot:9001,model:'later',visionEnabled:true}])
    expect(next.slots[0]).toMatchObject({slot:9001,model:'later',hasSecret:true})
    activate(next.slots[0].profileId!);expect(profiles.getApiKey('text')).toBe('retained-key');expect(profiles.getApiKey('vision')).toBe('retained-key')
    expect(new Set(secrets.keys())).toEqual(refs)
  })
  it('derives the group credential from old profiles before deleting the final legacy model',()=>{
    save('legacy-silicon-key',[{slot:8,model:'old',visionEnabled:false}])
    const old=state();delete old.siliconFlowCredentialRef
    db.db.prepare("UPDATE app_settings SET value_json=? WHERE key='cloud-profiles'").run(JSON.stringify(old))
    expect(profiles.getSiliconFlow().hasSecret).toBe(true)
    remove([8]);const next=save('',[{slot:1000000,model:'new',visionEnabled:false}])
    activate(next.slots[0].profileId!);expect(profiles.getApiKey('text')).toBe('legacy-silicon-key')
  })
  it('rotates omitted models as well as newly added models without rotating unrelated providers',()=>{
    const original=profiles.getSettings().activeCloudProfileId,view=save('first',[{slot:5,model:'five',visionEnabled:true},{slot:9,model:'nine',visionEnabled:false}])
    const next=save('rotated',[{slot:90,model:'ninety',visionEnabled:true}])
    for(const slot of next.slots){activate(slot.profileId!);expect(profiles.getApiKey('text')).toBe('rotated');expect(profiles.getApiKey('vision')).toBe(slot.visionEnabled?'rotated':null)}
    expect(next.slots.slice(0,2).map(slot=>slot.profileId)).toEqual(view.slots.map(slot=>slot.profileId))
    activate(original!);expect(profiles.getApiKey('text')).toBe('original-secret')
  })
  it('includes the group credential in revision checks even when there are no saved models',()=>{
    const initial=profiles.getSiliconFlow();save('first',[]);const keyed=profiles.getSiliconFlow()
    expect(keyed).toMatchObject({slots:[],hasSecret:true});expect(keyed.revision).not.toBe(initial.revision)
    const before=snapshot()
    expect(()=>profiles.saveSiliconFlow({expectedRevision:initial.revision,secret:'stale',models:[]})).toThrow(/已变化/)
    expect(snapshot()).toBe(before);expect([...secrets.values()]).not.toContain('stale')
  })
  it('rejects invalid, duplicate, ambiguous, unknown or overlapping slot operations without changing configuration',()=>{
    save('key',[{slot:8,model:'eight',visionEnabled:true}]);const before=snapshot(),refs=new Set(secrets.keys())
    const model={model:'changed',visionEnabled:false},invalid=[
      {models:[{...model,slot:0}]},{models:[{...model,slot:-1}]},{models:[{...model,slot:1.5}]},{models:[{...model,slot:Number.MAX_SAFE_INTEGER+1}]},
      {models:[{...model,slot:8},{...model,slot:8}]},{models:[{...model,slot:8},model]},
      {models:[],deletedSlots:[8,8]},{models:[],deletedSlots:[9]},{models:[{...model,slot:8}],deletedSlots:[8]},
      {models:[],deletedSlots:[-2]}
    ]
    for(const input of invalid){expect(()=>profiles.saveSiliconFlow({expectedRevision:profiles.getSiliconFlow().revision,secret:'must-not-save',...input})).toThrow();expect(snapshot()).toBe(before)}
    expect(new Set(secrets.keys())).toEqual(refs)
  })
  it('rolls back active profile deletion and settings if secure credential storage fails',()=>{
    const view=save('key',[{slot:6,model:'active',visionEnabled:true},{slot:9,model:'other',visionEnabled:false}])
    activate(view.slots[0].profileId!);const before=snapshot();failSecret=true
    expect(()=>remove([6],[],'failed-key')).toThrow(/DPAPI/)
    expect(snapshot()).toBe(before);expect(profiles.getSettings().activeCloudProfileId).toBe(view.slots[0].profileId)
    expect(profiles.getApiKey('text')).toBe('key')
  })
  it('rolls back deletion, active selection and local settings when persisting the fallback fails',()=>{
    const view=save('key',[{slot:6,model:'active',visionEnabled:true},{slot:9,model:'fallback',visionEnabled:false}])
    activate(view.slots[0].profileId!);const before=snapshot(),persist=db.saveSettings.bind(db)
    const failingSave=vi.spyOn(db,'saveSettings').mockImplementation(input=>{persist(input);throw Error('settings write failed')})
    expect(()=>remove([6])).toThrow(/settings write failed/)
    failingSave.mockRestore()
    expect(snapshot()).toBe(before);expect(profiles.getSettings()).toMatchObject({activeCloudProfileId:view.slots[0].profileId,textModel:'active',visionModel:'active',cacheLimitGb:37,interests:['科技']})
    expect(profiles.getApiKey('text')).toBe('key')
  })
})
