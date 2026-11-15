import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import readConfig from './read-active-cloud-config.cjs'

test('explicit probes read the selected profile secret, never a different provider fallback',()=>{
 const root=mkdtempSync(join(tmpdir(),'signal-desk-profile-read-'))
 const db=new DatabaseSync(join(root,'signal-desk.sqlite'))
 try{
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT)')
  const set=(key,value)=>db.prepare('INSERT OR REPLACE INTO app_settings VALUES(?,?)').run(key,JSON.stringify(value))
  set('settings',{textBaseUrl:'https://synthetic.example/v1',textModel:'synthetic'})
  mkdirSync(join(root,'credentials'));writeFileSync(join(root,'credentials','cloud-api-key.bin'),'legacy-secret')
  const storage={isEncryptionAvailable:()=>true,decryptString:b=>b.toString()}
  assert.equal(readConfig(root,storage).key,'legacy-secret')
  const ref='12345678-1234-1234-1234-123456789abc'
  writeFileSync(join(root,'credentials',`cloud-profile-${ref}.bin`),'active-secret')
  const state={version:1,activeId:'new',profiles:[{id:'old',credentials:{text:'legacy-text'}},{id:'new',credentials:{text:ref}}]}
  set('cloud-profiles',state);assert.equal(readConfig(root,storage).key,'active-secret')
  state.profiles[1].credentials.text=null;set('cloud-profiles',state)
  assert.throws(()=>readConfig(root,storage),/ACTIVE_PROFILE_TEXT_KEY_UNAVAILABLE/)
  state.profiles[1].credentials.text='../private';set('cloud-profiles',state)
  assert.throws(()=>readConfig(root,storage),/CLOUD_CREDENTIAL_REFERENCE_INVALID/)
 }finally{db.close();rmSync(root,{recursive:true,force:true})}
})
