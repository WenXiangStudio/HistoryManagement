import {readdir,stat,unlink,statfs} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
const names=new Set(['source.mp4','source.mp4.part','audio.wav'])
/** Only disposable media files under the owned evidence directory; transcripts and frames remain. */
export async function prepareContentCache(root:string,activeDirectories:string[]=[],limitBytes=20*1024**3,retentionMs=72*60*60*1000){
  const base=resolve(root),active=new Set(activeDirectories.map(p=>resolve(p)))
  const files:{path:string;size:number;modified:number;active:boolean}[]=[]
  for(const entry of await readdir(base,{withFileTypes:true}).catch(()=>[])){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue
    const directory=resolve(base,entry.name),rel=relative(base,directory)
    if(rel.startsWith('..')||isAbsolute(rel))throw Error('VIDEO_CACHE_PATH_REJECTED')
    for(const file of await readdir(directory,{withFileTypes:true})){
      if(!file.isFile()||file.isSymbolicLink()||!names.has(file.name))continue
      const path=join(directory,file.name),info=await stat(path)
      files.push({path,size:info.size,modified:info.mtimeMs,active:active.has(directory)})
    }
  }
  let size=files.reduce((sum,f)=>sum+f.size,0)
  for(const file of files.filter(f=>!f.active).sort((a,b)=>a.modified-b.modified)){
    if(Date.now()-file.modified>retentionMs){await unlink(file.path);size-=file.size}
  }
  if(size>=limitBytes)throw Error('VIDEO_CACHE_FULL')
  const disk=await statfs(base).catch(()=>null)
  if(disk&&disk.bavail*disk.bsize<2*1024**3)throw Error('VIDEO_DISK_SPACE_LOW')
  return {bytes:size,limitBytes}
}
