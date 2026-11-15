import {createHash} from 'node:crypto'
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {join} from 'node:path'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {z} from 'zod'
import type {VideoInformationCapture} from '../shared/videoInformation'

const mediaSourceSchema=z.object({urls:z.array(z.string().url().max(12000)).min(1).max(8),vid:z.string().max(200).nullable()}).strict()
export function isVideoMediaUrl(value:string):boolean {
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
    ['douyinvod.com','douyin.com','bytecdn.cn','ibytedtos.com'].some(domain=>u.hostname===domain||u.hostname.endsWith('.'+domain))}catch{return false}
}
/** URLs are transient execution data, never part of the persisted capture or logs. */
export async function saveVideoEvidence(root:string,capture:VideoInformationCapture,input:unknown,signal:AbortSignal){
  const source=mediaSourceSchema.parse(input)
  const urls=[...new Set(source.urls)].filter(isVideoMediaUrl)
  if(!urls.length)throw Error('VIDEO_MEDIA_SOURCE_UNAVAILABLE')
  const directory=join(root,'video-content','evidence',capture.ownerVerification.runId)
  await mkdir(directory,{recursive:true})
  const mediaPath=join(directory,'source.mp4'),part=mediaPath+'.part'
  let bytes=0,lastError='VIDEO_MEDIA_DOWNLOAD_FAILED'
  for(const original of urls){
    if(signal.aborted)throw Error('VIDEO_CANCELLED')
    try{
      let url=original,response:Response|undefined
      for(let redirects=0;redirects<4;redirects++){
        if(!isVideoMediaUrl(url))throw Error('VIDEO_MEDIA_REDIRECT_REJECTED')
        response=await fetch(url,{redirect:'manual',signal,headers:{'user-agent':'Mozilla/5.0','referer':'https://www.douyin.com/'}})
        if(![301,302,303,307,308].includes(response.status))break
        const location=response.headers.get('location');await response.body?.cancel()
        if(!location)throw Error('VIDEO_MEDIA_REDIRECT_REJECTED');url=new URL(location,url).href
      }
      if(!response?.ok||!response.body)throw Error('VIDEO_MEDIA_HTTP_FAILED')
      const length=Number(response.headers.get('content-length')||0)
      if(length>2*1024**3)throw Error('VIDEO_MEDIA_TOO_LARGE')
      const hash=createHash('sha256');bytes=0
      await pipeline(Readable.fromWeb(response.body as never),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length
        if(bytes>2*1024**3)return done(Error('VIDEO_MEDIA_TOO_LARGE'));hash.update(chunk);done(null,chunk)}}),createWriteStream(part),{signal})
      if(bytes===0)throw Error('VIDEO_MEDIA_EMPTY')
      if(signal.aborted)throw Error('VIDEO_CANCELLED')
      await rename(part,mediaPath)
      const result={directory,mediaPath,byteLength:bytes,sha256:hash.digest('hex'),capturedAt:new Date().toISOString()}
      await writeFile(join(directory,'proof.json'),JSON.stringify({capture,media:{...result,sourceHost:new URL(url).hostname,vid:source.vid}},null,2),'utf8')
      return result
    }catch(error){await unlink(part).catch(()=>{});if(signal.aborted)throw Error('VIDEO_CANCELLED')
      lastError=error instanceof Error&&/^VIDEO_[A-Z_]+$/.test(error.message)?error.message:'VIDEO_MEDIA_DOWNLOAD_FAILED'}
  }
  throw Error(lastError)
}
