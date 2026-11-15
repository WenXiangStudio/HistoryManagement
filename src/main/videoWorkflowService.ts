import {createHash} from 'node:crypto'
import {existsSync,readFileSync,realpathSync,readdirSync,statSync} from 'node:fs'
import {isAbsolute,join,relative} from 'node:path'
import {z} from 'zod'
import type {FollowingSyncService} from './followingSync'
import type {VideoContentRuntimeClient} from './videoContentRuntime'
import type {DoubaoSpeechService} from './doubaoSpeech'
import type {SummaryProvider} from './videoSummary'
import {recognizeCloudFrames} from './cloudFrameRecognition'
import {bodyHash,researchMaterial} from './materialResearch'
import type {ContentStage,VideoContentBatch,VideoInterest} from '../shared/videoContent'
import {effectiveVideoClass,processingRoute,WORKFLOW_CONCURRENCY,WORKFLOW_TEXT_MODEL,WORKFLOW_VISION_MODEL,
  type MaterialBody,type VideoClassification,type MaterialInboxState} from '../shared/videoWorkflow'

type Media={mediaPath:string;directory:string;sha256:string;byteLength:number}
const idsSchema=z.array(z.string().regex(/^\d{8,30}$/)).min(1).max(1000)
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class VideoWorkflowService {
  private abort:AbortController|null=null
  private queue:VideoContentBatch[]=[]
  private workers:VideoContentRuntimeClient[]=[]
  private workAborts=new Map<string,AbortController>()
  private activeBatch:VideoContentBatch|null=null
  private acquisitions=new Map<string,{owner:string;kind:'collect'|'discover';clickedAt:number}>()
  private automaticScheduled=false
  private closed=false
  constructor(private following:FollowingSyncService,private runtime:VideoContentRuntimeClient,private userData:string,
    private cloud:(model:string,vision?:boolean)=>SummaryProvider,private speech:()=>DoubaoSpeechService,
    private assertOtherIdle:()=>void,private changed:()=>void){}
  get running(){return !!this.abort||this.queue.length>0}
  trackAcquisition(owner:string,id:string,kind:'collect'|'discover',clickedAt=Date.now()){
    this.acquisitions.set(id,{owner,kind,clickedAt});this.acquisitionChanged()
  }
  acquisitionChanged(){
    if(this.automaticScheduled||!this.acquisitions.size||this.closed)return
    this.automaticScheduled=true
    setTimeout(()=>{this.automaticScheduled=false;this.checkAcquisitions()},50).unref?.()
  }
  private checkAcquisitions(){
    if(this.closed||this.running)return
    for(const [id,request] of this.acquisitions){
      let ids:string[]=[]
      if(request.kind==='collect'){
        const state=this.following.videoInformationStatus()
        if(state.runId!==id||state.phase==='running')continue
        this.acquisitions.delete(id)
        if(state.phase==='completed'&&state.capture)ids=[state.capture.work.workId]
      }else{
        const batch=this.following.videoContent.batch(request.owner,id)
        if(!batch||batch.state==='running'||batch.state==='queued')continue
        this.acquisitions.delete(id)
        if(batch.state==='completed'||batch.state==='partial'||batch.state==='failed')ids=batch.workIds
      }
      if(!ids.length)continue
      try{this.startTriage({ownerSecUid:request.owner,workIds:ids})}catch(error){
        this.following.videoContent.newBatch(request.owner,'process',ids,{provider:'triage',state:'failed',concurrency:WORKFLOW_CONCURRENCY,
          message:'自动分类未启动：'+this.error(error)})
        this.changed()
      }
      break
    }
  }
  private assertIdle(){
    if(this.running)throw Error('视频分类或素材处理正在运行')
    this.assertOtherIdle()
    const s=this.following.status()
    if(this.following.videoDiscovery.running||[s.phase,s.activity?.phase,s.basic?.phase,s.videoInformation?.phase].includes('running'))throw Error('请等待当前采集任务完成')
  }
  private requireWork(owner:string,id:string){
    this.following.requireOwner(owner)
    const work=this.following.videoInformation.store.list(owner).find(w=>w.workId===id)
    if(!work)throw Error('作品不属于当前账号')
    return work
  }
  private classification(owner:string,id:string){return this.following.videoContent.stage(owner,id,'classification',true)?.result as VideoClassification|undefined}
  private interested(owner:string,id:string){return this.following.videoContent.detail(owner,id).interest==='interested'}
  startTriage(input:unknown){
    this.assertIdle()
    const request=z.object({ownerSecUid:z.string(),workIds:idsSchema,clickedAt:z.number().finite().optional()}).strict().parse(input)
    for(const id of request.workIds)this.requireWork(request.ownerSecUid,id)
    if(!this.runtime.status().triageAvailable)throw Error('本地分类环境未就绪：需要 Python、Silero VAD 与 PP-OCRv5 mobile 文字区域检测器')
    const now=Date.now(),clickedAt=request.clickedAt??now
    if(clickedAt>now+1000||now-clickedAt>60000)throw Error('开始时间无效，请重新点击')
    const batch=this.following.videoContent.newBatch(request.ownerSecUid,'process',request.workIds,{provider:'triage',concurrency:WORKFLOW_CONCURRENCY,attemptStartedAt:new Date(clickedAt).toISOString()})
    this.queue.push(batch);this.drain();return batch
  }
  interest(owner:string,id:string,interest:VideoInterest){
    this.requireWork(owner,id)
    this.following.setVideoInterest(owner,id,interest)
    if(interest!=='interested')this.workAborts.get(id)?.abort()
    this.changed();return this.following.videoLibraryView()
  }
  startProcessing(input:unknown){
    this.assertIdle()
    const request=z.object({ownerSecUid:z.string().min(1),workIds:idsSchema}).strict().parse(input)
    const ids=[...new Set(request.workIds)]
    // Validate the complete explicit selection before creating any processing tasks.
    for(const id of ids){
      this.requireWork(request.ownerSecUid,id)
      if(!this.interested(request.ownerSecUid,id))throw Error('请先标记感兴趣，再手动开始处理')
      const classification=this.classification(request.ownerSecUid,id),route=processingRoute(classification)
      if(!classification)throw Error('请先完成本地分类，再手动开始处理')
      if(route==='review')throw Error('请先人工审核视频分类，再手动开始处理')
      if(route==='manual')throw Error('纯画面主导作品请人工观看，无需转写识别')
    }
    return ids.map(id=>this.enqueue(request.ownerSecUid,id)).filter((batch):batch is VideoContentBatch=>!!batch)
  }
  private enqueue(owner:string,id:string){
    const classification=this.classification(owner,id)
    if(!classification||['manual','review'].includes(processingRoute(classification)))return
    const store=this.following.videoContent,body=store.stage(owner,id,'body',true)?.result as MaterialBody|undefined
    const report=store.stage(owner,id,'research',true)
    if(body?.classificationHash===this.routeHash(classification)&&report?.inputHash===bodyHash(body.text))return
    if(store.batches(owner).some(b=>b.provider==='workflow'&&['queued','running'].includes(b.state)&&b.workIds.includes(id)))return
    const batch=store.newBatch(owner,'process',[id],{provider:'workflow',attemptStartedAt:new Date().toISOString()})
    this.queue.push(batch);this.drain();return batch
  }
  review(owner:string,id:string,input:unknown){
    this.requireWork(owner,id)
    const request=z.object({code:z.enum(['visual','visual_text','speech']),note:z.string().trim().min(1).max(2000)}).strict().parse(input)
    if(this.running)throw Error('请等待当前处理结束或取消后再更正分类')
    const previous=this.classification(owner,id);if(!previous)throw Error('请先完成本地分类')
    const result={...previous,manualReview:{...request,at:new Date().toISOString()}}
    this.following.videoContent.saveStage(owner,id,{stage:'classification',state:'completed',inputHash:hash(result),result})
    this.changed();return this.following.videoLibraryView()
  }
  reviseBody(owner:string,id:string,input:unknown){
    this.assertIdle();this.requireWork(owner,id)
    if(!this.interested(owner,id))throw Error('请先标记感兴趣')
    const text=z.string().trim().min(1).max(100000).parse(input),store=this.following.videoContent
    const previous=store.stage(owner,id,'body',true)?.result as MaterialBody|undefined
    const c=this.classification(owner,id)
    if(!previous||!c||previous.classificationHash!==this.routeHash(c))throw Error('当前类别尚无可校对的正文')
    const result={...previous,text,originalText:previous.originalText??previous.text,needsReview:false,reviewedAt:new Date().toISOString()}
    store.saveStage(owner,id,{stage:'body',state:'completed',inputHash:hash(result),result})
    this.enqueue(owner,id);this.changed();return result
  }
  private routeHash(c:VideoClassification){return hash({source:c.sourceSha256,code:effectiveVideoClass(c),version:'material-workflow/v1'})}
  inboxState(owner:string,id:string,state:MaterialInboxState){this.requireWork(owner,id);this.following.videoContent.setInboxState(owner,id,state);this.changed()}
  cancel(owner:string){
    this.following.requireOwner(owner)
    for(const [id,request] of this.acquisitions)if(request.owner===owner)this.acquisitions.delete(id)
    this.abort?.abort()
    for(const worker of this.workers)worker.stop()
    for(const batch of this.queue){batch.state='cancelled';batch.message='已取消，已有资料保留';this.following.videoContent.saveBatch(batch)}
    this.queue=[];this.changed()
  }
  resume(owner:string,id:string){
    this.assertIdle();this.following.requireOwner(owner)
    const batch=this.activeBatch?.id===id?this.activeBatch:this.following.videoContent.batch(owner,id)
    if(!batch||!['triage','workflow'].includes(batch.provider??'')||!['partial','failed','cancelled','interrupted'].includes(batch.state))throw Error('没有可继续的素材任务')
    const ids=batch.workIds.filter(workId=>!batch.completedWorkIds.includes(workId)&& (batch.provider==='triage'||this.interested(owner,workId)))
    if(!ids.length)throw Error('没有需要继续的作品；请先标记感兴趣')
    if(batch.provider==='triage')return this.startTriage({ownerSecUid:owner,workIds:ids})
    for(const workId of ids)this.enqueue(owner,workId)
  }
  rendered(owner:string,id:string,ids:string[]){
    this.following.requireOwner(owner)
    const batch=this.activeBatch?.id===id?this.activeBatch:this.following.videoContent.batch(owner,id)
    if(!batch||!['triage','workflow'].includes(batch.provider??'')||!batch.attemptStartedAt)return
    const seen=new Set(batch.displayedWorkIds??[])
    for(const workId of idsSchema.parse(ids))if(batch.completedWorkIds.includes(workId))seen.add(workId)
    const elapsed=Date.now()-Date.parse(batch.attemptStartedAt)
    if(seen.size)batch.firstDisplayedMs??=elapsed
    if(!['running','queued'].includes(batch.state)&&batch.completedWorkIds.length&&batch.completedWorkIds.every(id=>seen.has(id)))batch.displayedTotalMs??=elapsed
    batch.displayedWorkIds=[...seen];this.following.videoContent.saveBatch(batch)
  }
  frame(owner:string,id:string,frameId:string){
    this.requireWork(owner,id)
    const media=this.following.videoContent.stage(owner,id,'media',true)?.result as Media|undefined
    const frame=this.classification(owner,id)?.frames.find(f=>f.id===frameId)
    if(!frame||!media)throw Error('分类截图尚不可用')
    const path=realpathSync(frame.path),rel=relative(realpathSync(media.directory),path),bytes=readFileSync(path)
    if(rel.startsWith('..')||isAbsolute(rel)||!path.endsWith('.jpg')||bytes.length>1024*1024||createHash('sha256').update(bytes).digest('hex')!==frame.sha256)throw Error('分类截图未通过归属校验')
    return {id:frame.id,timeMs:frame.timeMs,dataUrl:'data:image/jpeg;base64,'+bytes.toString('base64')}
  }
  private async media(owner:string,id:string,signal:AbortSignal):Promise<Media>{
    const store=this.following.videoContent,work=this.requireWork(owner,id)
    let media=store.stage(owner,id,'media',true)?.result as Media|undefined
    if(!media||!existsSync(media.mediaPath)){
      const root=join(this.userData,'video-content','evidence')
      if(existsSync(root))for(const directory of readdirSync(root).reverse()){
        try{const proof=JSON.parse(readFileSync(join(root,directory,'proof.json'),'utf8'))
          if(proof.capture?.ownerVerification?.secUid===owner&&proof.capture?.work?.workId===id&&proof.capture?.work?.authorSecUid===work.authorSecUid&&proof.capture?.work?.authorUid===work.authorUid&&existsSync(join(root,directory,'source.mp4'))){media={...proof.media,directory:join(root,directory),mediaPath:join(root,directory,'source.mp4')};break}
        }catch{}
      }
    }
    if(!media||!existsSync(media.mediaPath))media=await this.following.captureWorkEvidence(owner,id,signal)
    this.requireWork(owner,id)
    const proof=JSON.parse(readFileSync(join(media.directory,'proof.json'),'utf8'))
    if(proof.capture?.ownerVerification?.secUid!==owner||proof.capture?.work?.workId!==id||proof.capture?.work?.authorSecUid!==work.authorSecUid||proof.capture?.work?.authorUid!==work.authorUid)throw Error('VIDEO_MEDIA_OWNER_MISMATCH')
    if(statSync(media.mediaPath).size!==media.byteLength||createHash('sha256').update(readFileSync(media.mediaPath)).digest('hex')!==media.sha256)throw Error('VIDEO_MEDIA_HASH_MISMATCH')
    store.saveStage(owner,id,{stage:'media',state:'completed',inputHash:media.sha256,result:media})
    return media
  }
  private drain(){
    if(this.abort||this.closed)return
    const batch=this.queue.shift();if(!batch)return
    const abort=new AbortController();this.abort=abort;this.activeBatch=batch;batch.state='running';batch.startedAt=new Date().toISOString()
    const save=()=>{if(!this.closed){this.following.videoContent.saveBatch(batch);this.changed()}}
    save()
    void (batch.provider==='triage'?this.triage(batch,abort.signal,save):this.process(batch,abort.signal,save))
      .then(()=>{batch.state=batch.failedWorkIds.length?'partial':'completed';batch.message=`${batch.provider==='triage'?'本地分类':'素材处理'}完成 ${batch.completedWorkIds.length} 条${batch.failedWorkIds.length?`，${batch.failedWorkIds.length} 条待处理`:''}`})
      .catch(error=>{batch.state=abort.signal.aborted?'cancelled':'failed';batch.message=abort.signal.aborted?'已取消，已完成资料保留':this.error(error)})
      .finally(()=>{
        batch.finishedAt=new Date().toISOString();batch.elapsedMs=Date.now()-Date.parse(batch.startedAt!)
        this.abort=null;this.activeBatch=null
        const workers=this.workers;this.workers=[]
        for(const worker of workers)worker.stop()
        // Publish the terminal result only after releasing this execution's busy state.
        // Queued work still counts as busy until the queue is drained.
        save();this.drain();this.acquisitionChanged()
      })
  }
  private error(error:unknown){return error instanceof Error?error.message:'本阶段未完成，可以继续处理'}
  private async triage(batch:VideoContentBatch,signal:AbortSignal,save:()=>void){
    const store=this.following.videoContent
    let index=0,acquisition:Promise<unknown>=Promise.resolve()
    this.workers=Array.from({length:Math.min(WORKFLOW_CONCURRENCY,batch.workIds.length)},()=>this.runtime.fork())
    let fatal:unknown
    const localAbort=new AbortController();signal=AbortSignal.any([signal,localAbort.signal])
    const results=await Promise.allSettled(this.workers.map(async worker=>{
      while(index<batch.workIds.length){
        if(signal.aborted)return;const id=batch.workIds[index++]
        try{
          const work=this.requireWork(batch.ownerSecUid,id)
          // Browser acquisition stays serial; up to eight local workers detect in parallel.
          const mediaPromise=acquisition.then(()=>this.media(batch.ownerSecUid,id,signal));acquisition=mediaPromise.catch(()=>{})
          const media=await mediaPromise,cached=this.classification(batch.ownerSecUid,id)
          if(!(cached?.sourceSha256===media.sha256&&cached.frames.every(f=>existsSync(f.path)))){
            store.saveStage(batch.ownerSecUid,id,{stage:'classification',state:'running',inputHash:media.sha256,result:null});save()
            const result:VideoClassification=await worker.request('classify',{mediaPath:media.mediaPath,outputDir:media.directory,expectedSha256:media.sha256,expectedDurationMs:work.durationMs},signal)
            signal.throwIfAborted();this.requireWork(batch.ownerSecUid,id)
            if(result.sourceSha256!==media.sha256||!['speech','visual_text','visual','pending'].includes(result.code)||result.cloudInvoked!==false||result.asrInvoked!==false||result.textRecognitionInvoked!==false)throw Error('本地分类返回未通过校验')
            store.saveStage(batch.ownerSecUid,id,{stage:'classification',state:'completed',inputHash:media.sha256,result})
          }
          batch.completedWorkIds.push(id);batch.firstAvailableMs??=Date.now()-Date.parse(batch.attemptStartedAt!);batch.message=`本地分类 ${batch.completedWorkIds.length}/${batch.workIds.length} · 并发 ${WORKFLOW_CONCURRENCY}`;save()
        }catch(error){
          if(signal.aborted)return
          batch.failedWorkIds.push(id);store.saveStage(batch.ownerSecUid,id,{stage:'classification',state:'failed',inputHash:id,result:null,error:this.error(error)});save()
          if(/OWNER|MISMATCH|DISCONNECTED|CAPTCHA/.test(this.error(error))){fatal=error;localAbort.abort();return}
        }
      }
    }))
    const rejected=results.find(r=>r.status==='rejected')
    if(rejected?.status==='rejected')throw rejected.reason
    if(fatal)throw fatal
    signal.throwIfAborted()
  }
  private async process(batch:VideoContentBatch,parent:AbortSignal,save:()=>void){
    const store=this.following.videoContent
    for(const id of batch.workIds){
      const abort=new AbortController(),signal=AbortSignal.any([parent,abort.signal]);this.workAborts.set(id,abort)
      let stage:ContentStage='body'
      try{
        this.requireWork(batch.ownerSecUid,id)
        if(!this.interested(batch.ownerSecUid,id))continue
        const c=this.classification(batch.ownerSecUid,id),route=processingRoute(c)
        if(!c||route==='review'||route==='manual')continue
        const mediaStarted=performance.now(),media=await this.media(batch.ownerSecUid,id,signal),classificationHash=this.routeHash(c)
        batch.stageElapsedMs={...batch.stageElapsedMs,media:performance.now()-mediaStarted}
        if(media.sha256!==c.sourceSha256)throw Error('VIDEO_MEDIA_HASH_MISMATCH')
        let body=store.stage(batch.ownerSecUid,id,'body',true)?.result as MaterialBody|undefined
        if(!body||body.classificationHash!==classificationHash){
          const bodyStarted=performance.now()
          store.saveStage(batch.ownerSecUid,id,{stage:'body',state:'running',inputHash:classificationHash,result:null});save()
          if(route==='speech'){
            batch.message='豆包语音识别极速版正在转写';save()
            const result=await this.speech().transcribeMaterial(media,this.requireWork(batch.ownerSecUid,id).durationMs??0,signal)
            body={text:result.text,source:'doubao-flash',sourceSha256:media.sha256,classificationHash,modelVersion:result.modelVersion,
              generatedAt:new Date().toISOString(),needsReview:false,limitations:[],requestId:result.requestId}
          }else{
            const provider=this.cloud(WORKFLOW_VISION_MODEL,true)
            batch.message='Qwen 正在识别画面文字，完成后请人工校对';save()
            const extracted=await this.runtime.request('frames',{mediaPath:media.mediaPath,outputDir:join(media.directory,'workflow-graphics'),expectedSha256:media.sha256,
              expectedDurationMs:this.requireWork(batch.ownerSecUid,id).durationMs,frameIntervalSeconds:2},signal)
            const result=await recognizeCloudFrames(provider,{directory:join(media.directory,'workflow-graphics'),durationMs:extracted.metadata.durationMs,
              frames:extracted.frames,sourceSha256:media.sha256,framesReused:false,preparationMs:extracted.elapsedMs},signal,(done,total)=>{batch.message=`画面文字识别 ${done}/${total}，待人工校对`;save()})
            const paragraphs:string[]=[]
            for(const r of result.readings)if(r.text.trim()&&r.text.trim()!==paragraphs.at(-1))paragraphs.push(r.text.trim())
            body={text:paragraphs.join('\n\n'),source:'qwen-vision',sourceSha256:media.sha256,classificationHash,modelVersion:WORKFLOW_VISION_MODEL,
              generatedAt:new Date().toISOString(),needsReview:true,limitations:['每2秒与场景切换抽样识别，短暂出现或看不清的文字可能遗漏，请人工结合原视频校对。','仅合并相邻完全相同的画面文案；滚动文字和部分重叠需人工整理。']}
            store.saveStage(batch.ownerSecUid,id,{stage:'visual',state:'completed',inputHash:classificationHash,result})
          }
          signal.throwIfAborted();this.requireWork(batch.ownerSecUid,id)
          if(!this.interested(batch.ownerSecUid,id))continue
          if(!body.text.trim())throw Error('未取得可用文案，请人工审核视频与分类')
          store.saveStage(batch.ownerSecUid,id,{stage:'body',state:'completed',inputHash:classificationHash,result:body});batch.stageElapsedMs.body=performance.now()-bodyStarted;save()
        }
        stage='research';signal.throwIfAborted();if(!this.interested(batch.ownerSecUid,id))continue
        const inputHash=bodyHash(body.text),cached=store.stage(batch.ownerSecUid,id,'research',true)
        if(cached?.inputHash!==inputHash){
          const researchStarted=performance.now()
          store.saveStage(batch.ownerSecUid,id,{stage,state:'running',inputHash,result:null});batch.message='正在生成正文研究报告';save()
          const result=await researchMaterial(this.cloud(WORKFLOW_TEXT_MODEL),body.text,join(media.directory,'workflow-research'),signal)
          signal.throwIfAborted();this.requireWork(batch.ownerSecUid,id);if(!this.interested(batch.ownerSecUid,id))continue
          store.saveStage(batch.ownerSecUid,id,{stage,state:'completed',inputHash,result});batch.stageElapsedMs.research=performance.now()-researchStarted
        }
        batch.completedWorkIds.push(id);batch.firstAvailableMs??=Date.now()-Date.parse(batch.attemptStartedAt!);save()
      }catch(error){
        if(!this.closed)store.saveStage(batch.ownerSecUid,id,{stage,state:signal.aborted?'cancelled':'failed',inputHash:id,result:null,error:abort.signal.aborted?'已取消兴趣，停止后续处理':this.error(error)})
        if(parent.aborted)throw error
        batch.failedWorkIds.push(id);batch.message=this.error(error);save()
      }finally{this.workAborts.delete(id)}
    }
  }
  stop(){if(this.running)this.following.videoContent.interrupt();this.closed=true;this.abort?.abort();for(const w of this.workers)w.stop();this.queue=[];this.acquisitions.clear();this.runtime.stop()}
}
