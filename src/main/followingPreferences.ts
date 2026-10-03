import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {z} from 'zod'
import type {FollowingBrowserProfile} from '../shared/followingDirectory'

const profileName=z.string().regex(/^(Default|Profile \d+)$/)
const preferencesSchema=z.object({chromeProfile:profileName.nullable(),activeOwnerSecUid:z.string().regex(/^[A-Za-z0-9._-]{1,240}$/).nullable(),
  connectors:z.record(profileName,z.string().regex(/^[a-f0-9-]{36}$/))})
export class FollowingPreferences{
  readonly path:string
  value:z.infer<typeof preferencesSchema>
  constructor(root:string,defaultOwner:string|null,defaultProfile:string|null){
    this.path=join(root,'following-settings.json')
    this.value={chromeProfile:defaultProfile,activeOwnerSecUid:defaultOwner,connectors:{}}
    try{this.value=preferencesSchema.parse(JSON.parse(readFileSync(this.path,'utf8')))}catch{ /* initial settings */ }
  }
  save():void{mkdirSync(dirname(this.path),{recursive:true});writeFileSync(this.path,JSON.stringify(this.value,null,2),'utf8')}
}
export function followingBrowserProfiles(chromeRoot:string,extensionDirectory:string):FollowingBrowserProfile[]{
  try{
    const state=JSON.parse(readFileSync(join(chromeRoot,'Local State'),'utf8'))
    return Object.entries(state.profile?.info_cache||{}).filter(([directory])=>profileName.safeParse(directory).success)
      .map(([directory,value])=>{
        let extensionInstalled=false
        for(const file of ['Secure Preferences','Preferences']){
          try{
            const preferences=JSON.parse(readFileSync(join(chromeRoot,directory,file),'utf8'))
            extensionInstalled||=Object.values(preferences.extensions?.settings||{}).some((entry:any)=>entry.path?.toLowerCase()===extensionDirectory.toLowerCase())
          }catch{ /* profile has no extension */ }
        }
        return {directory,name:String((value as any).name||directory),extensionInstalled}
      })
  }catch{return []}
}
