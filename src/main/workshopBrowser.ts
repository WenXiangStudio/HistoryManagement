import {createHash} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {mkdir,rename,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {z} from 'zod'
import {downloadWorkshopVideo,WORKSHOP_MAX_BYTES,type WorkshopDownloader,type WorkshopDownloadInput} from './workshopDownload'

export const workshopBrowserMediaSchema=z.object({
  workId:z.string().regex(/^\d{8,30}$/),pageUrl:z.string().url().max(12000),
  mediaUrl:z.string().url().max(12000),title:z.string().max(2000).optional(),authorName:z.string().max(200).optional()
}).strict()
export type WorkshopBrowserMedia=z.infer<typeof workshopBrowserMediaSchema>
export type WorkshopBrowserReader={readWorkshopVideo(input:WorkshopDownloadInput,signal:AbortSignal):Promise<WorkshopBrowserMedia>}

export function isWorkshopMediaUrl(value:string):boolean{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    ['douyinvod.com','douyin.com','bytecdn.cn','ibytedtos.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host))}catch{return false}
}
function officialUrl(value:string):URL{
  const url=new URL(value)
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.douyin.com','douyin.com','v.douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(url.hostname))throw Error('抖音链接跳转到了非官方地址，已停止处理')
  return url
}
export function workshopWorkIdFromUrl(value:string):string|null{
  const url=officialUrl(value),id=url.pathname.match(/^\/(?:share\/)?video\/(\d{8,30})\/?$/)?.[1]??url.searchParams.get('modal_id')
  return id&&/^\d{8,30}$/.test(id)?id:null
}
/** Resolve only the explicitly supplied official share URL; never read account cookies. */
export async function resolveWorkshopBrowserInput(input:WorkshopDownloadInput,signal:AbortSignal,fetchApi:typeof fetch=fetch):Promise<WorkshopDownloadInput&{expectedWorkId:string}>{
  let url=officialUrl(input.url).href
  for(let count=0;count<=4;count++){
    signal.throwIfAborted()
    const workId=workshopWorkIdFromUrl(url)
    if(workId){if(input.expectedWorkId&&input.expectedWorkId!==workId)throw Error('抖音分享链接与输入的作品编号不一致，已停止处理')
      return {url:`https://www.douyin.com/video/${workId}`,expectedWorkId:workId}}
    const response=await fetchApi(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{'user-agent':'Mozilla/5.0'}})
    await response.body?.cancel()
    if(![301,302,303,307,308].includes(response.status))throw Error('未能从抖音分享链接取得作品编号，请粘贴完整视频链接后重试')
    const location=response.headers.get('location')
    if(!location||count===4)throw Error('抖音分享链接跳转过多或缺少有效地址')
    url=officialUrl(new URL(location,url).href).href
  }
  throw Error('无法解析抖音作品编号')
}
export function validateWorkshopBrowserMedia(input:WorkshopDownloadInput,raw:unknown):WorkshopBrowserMedia{
  const media=workshopBrowserMediaSchema.parse(raw)
  if(!input.expectedWorkId||media.workId!==input.expectedWorkId||workshopWorkIdFromUrl(media.pageUrl)!==media.workId)throw Error('浏览器返回的视频与输入作品不一致，已停止下载')
  const page=new URL(media.pageUrl)
  if(page.origin!=='https://www.douyin.com'||page.pathname!==`/video/${media.workId}`||!isWorkshopMediaUrl(media.mediaUrl))throw Error('浏览器返回的抖音视频来源无效，已停止下载')
  return media
}
function canUseBrowserFallback(error:unknown){
  return error instanceof Error&&/公开下载|下载失败|下载器|无法启动|403|cookies|HTTP Error/i.test(error.message)
}
/** Public downloader first, then the installed connector's ordinary official video page. */
export function createWorkshopBrowserDownloader(browser:WorkshopBrowserReader,primary:WorkshopDownloader=downloadWorkshopVideo,fetchApi:typeof fetch=fetch):WorkshopDownloader{
  return async(input,outputDir,signal,onPhase)=>{
    try{return await primary(input,outputDir,signal,onPhase)}catch(error){signal.throwIfAborted();if(!canUseBrowserFallback(error))throw error}
    onPhase('公开下载受限，正在通过已连接的 Chrome 读取该抖音作品')
    const resolved=await resolveWorkshopBrowserInput(input,signal,fetchApi)
    const media=validateWorkshopBrowserMedia(resolved,await browser.readWorkshopVideo(resolved,signal))
    signal.throwIfAborted()
    onPhase('已核验作品编号，正在下载浏览器可播放的视频')
    await mkdir(outputDir,{recursive:true})
    const mediaPath=join(outputDir,'source.mp4'),part=mediaPath+'.part'
    const downloadSignal=AbortSignal.any([signal,AbortSignal.timeout(10*60_000)])
    try{
      let url=media.mediaUrl,response:Response|undefined
      for(let redirects=0;redirects<=4;redirects++){
        if(!isWorkshopMediaUrl(url))throw Error('视频媒体跳转到了非抖音媒体域名，已停止下载')
        response=await fetchApi(url,{redirect:'manual',signal:downloadSignal,headers:{'user-agent':'Mozilla/5.0','referer':'https://www.douyin.com/'}})
        if(![301,302,303,307,308].includes(response.status))break
        const location=response.headers.get('location');await response.body?.cancel()
        if(!location||redirects===4)throw Error('视频媒体跳转无效或次数过多，已停止下载')
        url=new URL(location,url).href
      }
      if(!response?.ok||!response.body)throw Error('浏览器取得了视频来源，但媒体下载失败，请检查网络后重试')
      const length=Number(response.headers.get('content-length')||0)
      if(length>WORKSHOP_MAX_BYTES){await response.body.cancel();throw Error('视频文件超过 2 GB，已停止下载')}
      const hash=createHash('sha256');let bytes=0
      await pipeline(Readable.fromWeb(response.body as never),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length
        if(bytes>WORKSHOP_MAX_BYTES)return done(Error('视频文件超过 2 GB，已停止下载'));hash.update(chunk);done(null,chunk)}}),createWriteStream(part),{signal:downloadSignal})
      if(!bytes)throw Error('下载的视频文件为空，无法继续处理')
      hash.digest('hex');signal.throwIfAborted();await rename(part,mediaPath)
      return {workId:media.workId,title:media.title,authorName:media.authorName,mediaPath}
    }catch(error){await unlink(part).catch(()=>{});throw error}
  }
}
