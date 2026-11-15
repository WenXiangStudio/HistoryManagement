import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {isAbsolute,join,relative,resolve} from 'node:path'
import {createRequire} from 'node:module'

const require=createRequire(import.meta.url)
export const WORKSHOP_MAX_BYTES=2*1024**3
export type WorkshopDownloadInput={url:string;expectedWorkId:string|null}
export type WorkshopDownloadedMedia={workId:string;title?:string;authorName?:string;mediaPath:string}
export type WorkshopDownloader=(input:WorkshopDownloadInput,outputDir:string,signal:AbortSignal,onPhase:(message:string)=>void)=>Promise<WorkshopDownloadedMedia>

export function findWorkshopDownloader():string|null{
  const configured=process.env.SIGNALDESK_YTDLP
  if(configured&&existsSync(configured))return configured
  for(const candidate of ['D:\\yt_dlp\\yt-dlp.exe',...((process.env.PATH||process.env.Path||'').split(process.platform==='win32'?';':':').filter(Boolean).map(directory=>join(directory,process.platform==='win32'?'yt-dlp.exe':'yt-dlp')))]){
    if(existsSync(candidate))return candidate
  }
  return null
}

export function validateWorkshopDownloadIdentity(input:WorkshopDownloadInput,metadata:unknown):{workId:string;title?:string;authorName?:string}{
  if(!metadata||typeof metadata!=='object')throw Error('下载器未返回可校验的抖音作品信息')
  const info=metadata as Record<string,unknown>,workId=String(info.id??'')
  if(!/^\d{8,30}$/.test(workId))throw Error('下载器未返回有效的抖音作品编号')
  if(input.expectedWorkId&&input.expectedWorkId!==workId)throw Error('下载视频与输入链接的作品编号不一致，已停止处理')
  const extractor=String(info.extractor_key??info.extractor??'')
  if(!/^douyin$/i.test(extractor))throw Error('下载器返回的作品不是抖音视频，已停止处理')
  return {workId,title:typeof info.title==='string'?info.title.slice(0,2000):undefined,
    authorName:typeof info.uploader==='string'?info.uploader.slice(0,200):undefined}
}

function killDownload(child:ReturnType<typeof spawn>){
  if(!child.pid||child.exitCode!==null)return
  if(process.platform==='win32'){
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})
    killer.once('error',()=>child.kill())
  }else child.kill('SIGKILL')
}

/** A single explicit URL is downloaded; browser cookies and account stores are never read here. */
export const downloadWorkshopVideo:WorkshopDownloader=async(input,outputDir,signal,onPhase)=>{
  signal.throwIfAborted()
  const executable=findWorkshopDownloader()
  if(!executable)throw Error('未找到视频下载器，请安装 yt-dlp 或配置 SIGNALDESK_YTDLP 后重试')
  mkdirSync(outputDir,{recursive:true})
  const ffmpeg=(require('@ffmpeg-installer/ffmpeg') as {path:string}).path.replace('app.asar','app.asar.unpacked')
  const args=['--ignore-config','--no-playlist','--no-progress','--no-overwrites','--restrict-filenames',
    '--socket-timeout','30','--retries','2','--max-filesize',String(WORKSHOP_MAX_BYTES),
    '--ffmpeg-location',ffmpeg,'--format','best[ext=mp4]/best','--write-info-json',
    '--print','after_move:filepath','--no-simulate','--output',join(outputDir,'source.%(ext)s'),'--',input.url]
  onPhase('正在解析抖音链接并下载视频')
  const stdout=await new Promise<string>((accept,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let out='',error='',failure:Error|null=null,settled=false
    const finish=(reason?:Error)=>{
      if(settled)return;settled=true;clearTimeout(timeout);clearInterval(monitor);signal.removeEventListener('abort',abort)
      if(signal.aborted)reject(Error('已取消视频处理'))
      else if(reason)reject(reason)
      else accept(out)
    }
    const abort=()=>{failure=Error('已取消视频处理');killDownload(child)}
    const timeout=setTimeout(()=>{failure=Error('视频下载超过 10 分钟，请检查网络后重试');killDownload(child)},10*60_000)
    const monitor=setInterval(()=>{
      try{
        if(readdirSync(outputDir).some(name=>statSync(join(outputDir,name)).isFile()&&statSync(join(outputDir,name)).size>WORKSHOP_MAX_BYTES)){
          failure=Error('视频文件超过 2 GB，已停止下载');killDownload(child)
        }
      }catch{ /* The process exit carries any filesystem failure. */ }
    },1000)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
    child.stdout.on('data',chunk=>{out=(out+chunk.toString('utf8')).slice(-1_000_000)})
    child.stderr.on('data',chunk=>{error=(error+chunk.toString('utf8')).slice(-8000)})
    child.once('error',()=>finish(Error('无法启动视频下载器，请检查 yt-dlp 安装')))
    child.once('close',code=>{
      if(failure){finish(failure);return}
      if(code!==0){
        finish(Error(/fresh cookies|cookies|login|登录|captcha|verification/i.test(error)?
          '抖音限制了该作品的公开下载，暂未取得视频文件；请确认作品可公开访问或更换链接':
          /unsupported url|not a video|image post/i.test(error)?'该链接没有可下载的视频，请确认是抖音视频作品':
          /404|not found|not available|private|deleted/i.test(error)?'视频不可用，可能已删除、设为私密或链接已失效':
          '抖音视频下载失败，请检查链接和网络后重试'))
      }else finish()
    })
  })
  signal.throwIfAborted()
  const metadataPath=join(outputDir,'source.info.json')
  if(!existsSync(metadataPath))throw Error('下载器没有返回作品信息，无法确认视频归属')
  const identity=validateWorkshopDownloadIdentity(input,JSON.parse(readFileSync(metadataPath,'utf8')))
  const lines=stdout.trim().split(/\r?\n/).filter(Boolean),mediaPath=resolve(lines.at(-1)||'')
  const rel=relative(resolve(outputDir),mediaPath)
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!/^source\.(mp4|webm|mkv|mov)$/i.test(rel)||!existsSync(mediaPath))throw Error('下载器未生成可验证的本地视频文件')
  const stat=statSync(mediaPath)
  if(!stat.isFile()||stat.size<=0||stat.size>WORKSHOP_MAX_BYTES)throw Error('本地视频文件为空或超过 2 GB，无法继续处理')
  return {...identity,mediaPath}
}
