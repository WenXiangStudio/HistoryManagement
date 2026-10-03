import {it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {FollowingPreferences} from './followingPreferences'
it('restores the selected native account and connector for a Chrome profile without storing login credentials',()=>{
  const root=mkdtempSync(join(tmpdir(),'following-preferences-'))
  try{
    const preferences=new FollowingPreferences(root,'owner-a','Default')
    preferences.value={chromeProfile:'Profile 1',activeOwnerSecUid:'owner-b',connectors:{'Profile 1':'12345678-1234-1234-1234-123456789012'}}
    preferences.save()
    const restored=new FollowingPreferences(root,'owner-a','Default')
    expect(restored.value).toEqual(preferences.value)
    expect(Object.keys(restored.value)).toEqual(['chromeProfile','activeOwnerSecUid','connectors'])
  }finally{rmSync(root,{recursive:true,force:true})}
})
