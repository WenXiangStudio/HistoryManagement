import {createHash,randomUUID} from 'node:crypto'
import {createReadStream,existsSync,mkdirSync,readFileSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve} from 'node:path'
import {z} from 'zod'
import {parseDouyinWorkshopLink,type WorkshopJob,type WorkshopView} from '../shared/videoWorkshop'
import type {VideoClassification} from '../shared/videoWorkflow'
import {downloadWorkshopVideo,WORKSHOP_MAX_BYTES,type WorkshopDownloader} from './workshopDownload'
import {processWorkshopDeep} from './workshopDeep'
import type {WorkshopSpeech} from '../shared/workshopDeep'
import type {SummaryProvider} from './videoSummary'

type RuntimeWorker={request:(method:string,params:Record<string,unknown>,signal:AbortSignal)=>Promise<any>;stop:()=>void}
type Runtime={status:()=>{triageAvailable?:boolean};fork:()=>RuntimeWorker}
type Options={downloadRoot?:string;download?:WorkshopDownloader;deep?:{
  provider:()=>SummaryProvider;
  transcribe:(media:{mediaPath:string;directory:string;sha256:string},durationMs:number,signal:AbortSignal)=>Promise<WorkshopSpeech>
}}
const inputSchema=z.object({url:z.string().min(1).max(6000),clickedAt:z.number().finite().nonnegative().optional()}).strict()
const jobSchema=z.object({id:z.string().uuid(),url:z.string().max(6000),workId:z.string().regex(/^\d{8,30}$/).nullable(),title:z.string().nullable(),authorName:z.string().nullable(),
  phase:z.enum(['resolving','downloading','classifying','completed','failed','cancelled']),message:z.string(),createdAt:z.string(),clickedAt:z.number().finite(),
  finishedAt:z.string().optional(),elapsedMs:z.number().nonnegative().optional(),stageElapsedMs:z.record(z.string(),z.number().nonnegative()),
  mediaPath:z.string().optional(),byteLength:z.number().nonnegative().optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),durationMs:z.number().positive().optional(),
  classification:z.unknown().optional(),deep:z.unknown().optional()})
const active=(job:WorkshopJob)=>['resolving','downloading','classifying'].includes(job.phase)

async function sha256(file:string,signal:AbortSignal){
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(file,{signal})){signal.throwIfAborted();hash.update(chunk)}
  return hash.digest('hex')
}
function containedFile(directory:string,file:string){
  if(!isAbsolute(file)||!existsSync(file))throw Error('视频文件不存在，请重新处理链接')
  const rel=relative(realpathSync(directory),realpathSync(file))
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(file).isFile())throw Error('视频证据文件不在本次下载目录中')
}

export async function validateWorkshopClassification(value:unknown,sourceSha256:string,durationMs:number,directory:string,signal:AbortSignal):Promise<VideoClassification>{
  const finite=z.number().finite().nonnegative()
  const schema=z.object({code:z.enum(['speech','visual_text','visual','pending']),sourceSha256:z.literal(sourceSha256),ruleVersion:z.literal('existence-detection-triage-v1'),strength:z.string().min(1),
    basis:z.object({speechPercent:finite.max(100),speechBinCoverage:finite.max(1),retainedTextFrames:finite.int().max(8),sampledFrames:z.literal(8)}),
    frames:z.array(z.object({id:z.string().min(1),timeMs:finite.max(durationMs),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough()).length(8),
    timing:z.record(z.string(),finite),asrInvoked:z.literal(false),textRecognitionInvoked:z.literal(false),cloudInvoked:z.literal(false)}).passthrough()
  let result:VideoClassification
  try{result=schema.parse(value) as VideoClassification}catch{throw Error('本地分类返回未通过校验，未标记为处理完成')}
  const ids=new Set<string>();let previous=-1
  for(const frame of result.frames){
    signal.throwIfAborted()
    if(ids.has(frame.id)||frame.timeMs<previous)throw Error('本地分类画面时间或编号未通过校验')
    ids.add(frame.id);previous=frame.timeMs;containedFile(directory,frame.path)
    if(statSync(frame.path).size>20*1024**2||await sha256(frame.path,signal)!==frame.sha256)throw Error('本地分类画面文件校验失败')
  }
  return result
}

/** Standalone workshop jobs never modify followed creators, interests, or historical library rows. */
export class VideoWorkshopService{
  private jobs:WorkshopJob[]=[]
  private execution:{jobId:string;abort:AbortController;worker:RuntimeWorker|null}|null=null
  private readonly storePath:string
  private readonly downloadRoot:string
  private readonly download:WorkshopDownloader
  private readonly deepOptions:Options['deep']
  private closed=false
  private liveDeepDisplays=new Set<string>()
  constructor(private readonly userData:string,private readonly runtime:Runtime,private readonly changed:()=>void,options:Options={}){
    this.downloadRoot=resolve(options.downloadRoot??'E:\\VideoDownload\\video-workshop')
    this.download=options.download??downloadWorkshopVideo
    this.deepOptions=options.deep
    this.storePath=join(userData,'video-workshop','jobs.json')
    if(existsSync(this.storePath)){
      // Invalid persistence is surfaced rather than silently replacing existing workshop history.
      const parsed=z.array(jobSchema).parse(JSON.parse(readFileSync(this.storePath,'utf8')))
      this.jobs=parsed as WorkshopJob[]
      let interrupted=false
      for(const job of this.jobs)if(active(job)){
        job.phase='cancelled';job.message='上次处理因 APP 退出而中断，已下载文件保留，可以重新处理';job.finishedAt=new Date().toISOString();interrupted=true
      }
      for(const job of this.jobs)if(job.deep&&['preparing','transcribing','recognizing','reporting'].includes(job.deep.phase)){
        job.deep.phase='cancelled';job.deep.message='上次深度处理因 APP 退出而中断，已完成阶段保留，可继续处理';job.deep.finishedAt=new Date().toISOString();interrupted=true
      }
      if(interrupted)this.save()
    }
  }
  get running(){return this.execution!==null}
  view():WorkshopView{return structuredClone({jobs:this.jobs,running:this.running,downloadRoot:this.downloadRoot})}
  start(input:unknown):WorkshopView{
    if(this.closed)throw Error('视频工坊正在关闭，请重新打开 APP')
    const request=inputSchema.parse(input),link=parseDouyinWorkshopLink(request.url)
    if(link.state!=='valid')throw Error(link.state==='invalid'?link.message:'请先粘贴一条抖音视频链接')
    if(this.running)throw Error('已有视频正在处理，请等待完成或先取消')
    if(!this.runtime.status().triageAvailable)throw Error('本地视频分类环境未就绪，请先在设置中配置 Python 与画面检测模型')
    const now=Date.now(),job:WorkshopJob={id:randomUUID(),url:link.canonicalUrl,workId:link.workId,title:null,authorName:null,
      phase:'resolving',message:'正在解析抖音链接',createdAt:new Date(now).toISOString(),clickedAt:Math.min(now,request.clickedAt??now),stageElapsedMs:{}}
    this.jobs.unshift(job)
    const execution={jobId:job.id,abort:new AbortController(),worker:null as RuntimeWorker|null};this.execution=execution
    try{this.save()}catch(error){this.execution=null;this.jobs.shift();throw error}
    this.notify()
    void this.process(job,link.workId,execution).catch(error=>{
      job.phase=execution.abort.signal.aborted?'cancelled':'failed'
      job.message=execution.abort.signal.aborted?'已取消处理，已下载文件与历史资料保留':this.error(error)
    }).finally(()=>{
      execution.worker?.stop();if(this.execution===execution)this.execution=null
      job.finishedAt=new Date().toISOString();job.elapsedMs=Math.max(0,Date.now()-job.clickedAt)
      try{this.save()}catch{job.phase='failed';job.message='处理结果保存失败，请检查 APP 数据目录可写权限后重试'}
      this.notify()
    })
    return this.view()
  }
  cancel(jobId:string):WorkshopView{
    if(this.execution&&this.execution.jobId===jobId){
      const job=this.jobs.find(j=>j.id===jobId)
      if(job){if(job.deep&&['preparing','transcribing','recognizing','reporting'].includes(job.deep.phase))job.deep.message='正在取消深度处理…';else job.message='正在取消视频处理…'}
      this.execution.abort.abort();this.execution.worker?.stop();this.notify()
    }
    return this.view()
  }
  deep(input:unknown):WorkshopView{
    if(this.closed)throw Error('视频工坊正在关闭，请重新打开 APP')
    const request=z.object({jobId:z.string().uuid(),clickedAt:z.number().finite().nonnegative().optional()}).strict().parse(input)
    if(this.running)throw Error('已有视频正在处理，请等待完成或先取消')
    const job=this.jobs.find(item=>item.id===request.jobId)
    if(!job||job.phase!=='completed'||!job.mediaPath||!job.sha256||!job.durationMs||!job.classification)throw Error('请先完成所选视频的下载与本地分类')
    if(!this.deepOptions)throw Error('深度处理服务尚未就绪，请重新打开 APP')
    if(job.deep?.phase==='completed'&&job.deep.result?.sourceSha256===job.sha256)return this.view()
    const provider=this.deepOptions.provider()
    const now=Date.now(),previous=job.deep
    job.deep={phase:'preparing',message:'正在校验原视频并准备深度处理',clickedAt:Math.min(now,request.clickedAt??now),startedAt:new Date(now).toISOString()}
    const execution={jobId:job.id,abort:new AbortController(),worker:this.runtime.fork()};this.execution=execution
    try{this.save()}catch(error){this.execution=null;job.deep=previous;execution.worker.stop();throw error}
    this.notify()
    const deep=job.deep
    this.liveDeepDisplays.add(job.id)
    void processWorkshopDeep({media:{mediaPath:job.mediaPath,directory:join(this.downloadRoot,job.id),sha256:job.sha256,byteLength:job.byteLength!},
      durationMs:job.durationMs,provider,worker:execution.worker,transcribe:this.deepOptions.transcribe,signal:execution.abort.signal,
      onProgress:(phase,message)=>{execution.abort.signal.throwIfAborted();deep.phase=phase;deep.message=message;this.update(job)}})
      .then(result=>{execution.abort.signal.throwIfAborted();deep.result=result;deep.phase='completed';deep.message='深度处理与时间对齐图文报告已完成'})
      .catch(error=>{deep.phase=execution.abort.signal.aborted?'cancelled':'failed';deep.message=execution.abort.signal.aborted?'深度处理已取消，已完成阶段保留，可继续处理':this.error(error)})
      .finally(()=>{execution.worker.stop();if(this.execution===execution)this.execution=null;deep.finishedAt=new Date().toISOString();deep.elapsedMs=Math.max(0,Date.now()-deep.clickedAt)
        try{this.save()}catch{deep.phase='failed';deep.message='深度处理结果保存失败，请检查数据目录可写权限'}this.notify()})
    return this.view()
  }
  frame(input:unknown):{id:string;timeMs:number;dataUrl:string}{
    const {jobId,frameId}=z.object({jobId:z.string().uuid(),frameId:z.string().min(1).max(120)}).strict().parse(input)
    const job=this.jobs.find(item=>item.id===jobId),frame=job?.deep?.result?.frames.find(item=>item.id===frameId)
    if(!job?.sha256||job.deep?.result?.sourceSha256!==job.sha256||!frame)throw Error('该报告对应的视频帧不可用')
    containedFile(join(this.downloadRoot,job.id),frame.path)
    if(statSync(frame.path).size>4*1024**2||! /\.(jpe?g|png)$/i.test(frame.path))throw Error('报告视频帧未通过校验')
    const bytes=readFileSync(frame.path)
    if(createHash('sha256').update(bytes).digest('hex')!==frame.sha256)throw Error('报告视频帧内容校验失败')
    return {id:frame.id,timeMs:frame.timeMs,dataUrl:`data:image/${/\.png$/i.test(frame.path)?'png':'jpeg'};base64,`+bytes.toString('base64')}
  }
  displayed(input:unknown):WorkshopView{
    const {jobId,displayedAt}=z.object({jobId:z.string().uuid(),displayedAt:z.number().finite()}).strict().parse(input)
    const deep=this.jobs.find(item=>item.id===jobId)?.deep,now=Date.now()
    if(!deep||deep.phase!=='completed'||deep.displayedTotalMs!==undefined||!this.liveDeepDisplays.has(jobId))return this.view()
    if(!deep.finishedAt||displayedAt<Date.parse(deep.finishedAt)||displayedAt>now+1000||now-displayedAt>10000)throw Error('报告展示时间无效')
    deep.displayedTotalMs=displayedAt-deep.clickedAt;this.liveDeepDisplays.delete(jobId);this.save();this.notify();return this.view()
  }
  stop(){this.closed=true;this.execution?.abort.abort();this.execution?.worker?.stop()}
  private notify(){try{this.changed()}catch{ /* Rendering notification must not alter a recorded job result. */ }}
  private save(){
    const directory=join(this.userData,'video-workshop');mkdirSync(directory,{recursive:true})
    const temporary=this.storePath+'.tmp';writeFileSync(temporary,JSON.stringify(this.jobs,null,2),'utf8');renameSync(temporary,this.storePath)
  }
  private update(job:WorkshopJob){this.save();this.notify()}
  private error(error:unknown){
    const message=error instanceof Error?error.message:'视频处理未完成，请重试'
    return /VIDEO_MEDIA_HASH_MISMATCH/.test(message)?'本地视频内容校验失败，请重新下载':
      /VIDEO_TRACK_UNAVAILABLE|INVALID_MEDIA_DURATION|VIDEO_MEDIA_DURATION_INVALID/.test(message)?'下载结果不是可用的视频文件':
      /VIDEO_WORKER_TIMEOUT/.test(message)?'本地视频分类超时，请重试':
      /VIDEO_RUNTIME_UNAVAILABLE|VIDEO_WORKER_STOPPED/.test(message)?'本地视频分类环境不可用，请检查设置后重试':message.slice(0,1500)
  }
  private async process(job:WorkshopJob,expectedWorkId:string|null,execution:NonNullable<VideoWorkshopService['execution']>){
    const signal=execution.abort.signal,directory=join(this.downloadRoot,job.id)
    mkdirSync(directory,{recursive:true});signal.throwIfAborted()
    const downloadStarted=Date.now()
    const media=await this.download({url:job.url,expectedWorkId},directory,signal,message=>{
      signal.throwIfAborted();job.phase='downloading';job.message=message;this.update(job)
    })
    signal.throwIfAborted();job.stageElapsedMs.download=Date.now()-downloadStarted
    if(!/^\d{8,30}$/.test(media.workId)||(expectedWorkId&&media.workId!==expectedWorkId))throw Error('下载视频与输入链接的作品编号不一致，已停止处理')
    containedFile(directory,media.mediaPath)
    const size=statSync(media.mediaPath).size
    if(size<=0||size>WORKSHOP_MAX_BYTES)throw Error('下载的视频文件为空或超过 2 GB')
    job.workId=media.workId;job.title=media.title??null;job.authorName=media.authorName??null;job.mediaPath=media.mediaPath;job.byteLength=size
    job.phase='classifying';job.message='视频已下载，正在验证视频并进行本地分类';this.update(job)
    const verifyStarted=Date.now(),digest=await sha256(media.mediaPath,signal)
    const worker=this.runtime.fork();execution.worker=worker
    const metadata=await worker.request('probe',{mediaPath:media.mediaPath,expectedSha256:digest},signal)
    signal.throwIfAborted()
    if(metadata?.hasVideo!==true||metadata?.sha256!==digest||!Number.isFinite(metadata?.durationMs)||metadata.durationMs<=0||metadata.durationMs>7200000)throw Error('下载结果不是可用的视频，或视频时长超过两小时')
    job.sha256=digest;job.durationMs=metadata.durationMs;job.stageElapsedMs.verify=Date.now()-verifyStarted;this.update(job)
    const classificationStarted=Date.now()
    const classification=await worker.request('classify',{mediaPath:media.mediaPath,outputDir:directory,expectedSha256:digest,expectedDurationMs:metadata.durationMs},signal)
    signal.throwIfAborted()
    job.classification=await validateWorkshopClassification(classification,digest,metadata.durationMs,directory,signal)
    signal.throwIfAborted();job.stageElapsedMs.classify=Date.now()-classificationStarted
    job.phase='completed';job.message='视频下载与本地分类已完成'
    this.update(job)
  }
}
