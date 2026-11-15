// Read-only helper for explicit local probes. Call only after Electron safeStorage is ready.
// Never falls back to a legacy key when the active profile has no credential.
const {DatabaseSync}=require('node:sqlite')
const {readFileSync}=require('node:fs')
const {join}=require('node:path')
module.exports=function readActiveCloudConfig(source,safeStorage){
  const db=new DatabaseSync(join(source,'signal-desk.sqlite'),{readOnly:true})
  try{
    db.exec('BEGIN')
    const settings=JSON.parse(db.prepare("SELECT value_json FROM app_settings WHERE key='settings'").get()?.value_json||'{}')
    const row=db.prepare("SELECT value_json FROM app_settings WHERE key='cloud-profiles'").get()
    let ref='legacy-text',profileId=null
    if(row){
      const state=JSON.parse(row.value_json),active=state.profiles?.find(p=>p.id===state.activeId)
      if(state.version!==1||!active)throw Error('ACTIVE_CLOUD_PROFILE_INVALID')
      profileId=active.id;ref=active.credentials?.text
      if(!ref)throw Error('ACTIVE_PROFILE_TEXT_KEY_UNAVAILABLE')
    }
    if(ref!=='legacy-text'&&!/^[a-f0-9-]{36}$/.test(ref))throw Error('CLOUD_CREDENTIAL_REFERENCE_INVALID')
    if(!safeStorage.isEncryptionAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE')
    const key=safeStorage.decryptString(readFileSync(join(source,'credentials',ref==='legacy-text'?'cloud-api-key.bin':`cloud-profile-${ref}.bin`)))
    if(!key.trim())throw Error('ACTIVE_PROFILE_TEXT_KEY_UNAVAILABLE')
    return {settings,key,profileId}
  }finally{db.close()}
}
