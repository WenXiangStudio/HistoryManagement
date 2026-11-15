import {existsSync,readFileSync,readdirSync,statSync,realpathSync,writeFileSync} from 'node:fs'
import {join,relative,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {FollowingSyncService} from './followingSync'
import type {VideoContentRuntimeClient} from './videoContentRuntime'
import {generateVideoSummary,summaryInputHash,type SummaryProvider} from './videoSummary'
import type {ContentEvidence,ContentStage,VideoContentBatch,SavedContentSummary} from '../shared/videoContent'
import {analyzeVideoFrames} from './videoVision'
import {prepareContentCache} from './videoContentCache'
import type {AppSettings} from '../shared/contracts'
import {assertQwenVideoProvider,qwenProviderIdentity,prepareQwenMedia,transcribeQwen,readQwenFrames} from './qwenVideo'
import {assertCloudFrameProvider,cloudFrameIdentity,prepareCloudFrames,recognizeCloudFrames} from './cloudFrameRecognition'

type Media={directory:string;mediaPath:string;byteLength:number;sha256:string;capturedAt:string}
export class VideoContentService{
  private current:VideoContentBatch|null=null
  private abort:AbortController|null=null
  private closed=false
  constructor(private following:FollowingSyncService,private runtime:VideoContentRuntimeClient,private userData:string,
    private cloud:(kind?:'text'|'vision')=>SummaryProvider,private changed:()=>void,private settings?:()=>AppSettings){following.contentRunning=()=>this.running}
  get running(){return !!this.abort}
  rendered(owner:string,id:string,workIds:string[]){
    this.following.requireOwner(owner);const batch=this.following.videoContent.batch(owner,id)
    if(!batch||batch.kind!=='process'||!batch.attemptStartedAt)return
    const ids=z.array(z.string()).max(1000).parse(workIds),seen=new Set(batch.displayedWorkIds??[])
    const before=seen.size
    const completed=batch.completedWorkIds.filter(id=>!batch.attemptWorkIds||batch.attemptWorkIds.includes(id))
    for(const workId of ids)if(completed.includes(workId))seen.add(workId)
    const finish=batch.state!=='running'&&batch.state!=='queued'&&completed.length>0&&completed.every(id=>seen.has(id))
    if(before===seen.size&&(!finish||batch.displayedTotalMs!==undefined))return
    const elapsed=Date.now()-Date.parse(batch.attemptStartedAt)
    if(seen.size)batch.firstDisplayedMs??=elapsed
    if(finish)batch.displayedTotalMs??=elapsed
    batch.displayedWorkIds=[...seen]
    this.following.videoContent.saveBatch(batch)
    if(this.current?.id===id){this.current.firstDisplayedMs=batch.firstDisplayedMs;this.current.displayedTotalMs=batch.displayedTotalMs;this.current.displayedWorkIds=batch.displayedWorkIds}
    this.changed()
  }
  estimate(owner:string,workIds:string[],vision=false){
    this.following.requireOwner(owner);const provider=this.cloud(vision?'vision':'text'),settings=this.settings?.()
    const ids=z.array(z.string().regex(/^\d{8,30}$/)).min(1).max(1000).parse(workIds)
    let inputTokens=0,outputTokens=0,imageCount=0,missingEvidenceWorkCount=0
    for(const id of new Set(ids)){
      if(!this.following.videoContent.owns(owner,id))throw Error('作品不属于当前账号')
      const transcript=this.following.videoContent.stage(owner,id,'transcript',true)?.result as any,visual=this.following.videoContent.stage(owner,id,'visual',true)?.result as any
      if(vision){const count=Math.min(12,visual?.frames?.length??0);if(!count)missingEvidenceWorkCount++;imageCount+=count;inputTokens+=500+count*1600;outputTokens+=1200}
      else{const text=JSON.stringify({segments:transcript?.segments,blocks:visual?.blocks});if(!transcript?.segments)missingEvidenceWorkCount++
        const chunks=Math.max(1,Math.ceil(text.length/9000));inputTokens+=Math.ceil(text.length/2)+chunks*800;outputTokens+=chunks*1400}
    }
    const inPrice=vision?settings?.visionInputPricePerMillion:settings?.textInputPricePerMillion,outPrice=vision?settings?.visionOutputPricePerMillion:settings?.textOutputPricePerMillion
    const known=inPrice!=null&&outPrice!=null&&(!vision||settings?.imagePrice!=null)&&missingEvidenceWorkCount===0
    return {workCount:new Set(ids).size,model:provider.model,kind:vision?'vision':'text',estimatedInputTokens:inputTokens,estimatedOutputTokens:outputTokens,imageCount,missingEvidenceWorkCount,
      estimatedCost:known?inputTokens/1e6*inPrice!+outputTokens/1e6*outPrice!+(vision?imageCount*settings!.imagePrice!:0):null,
      reason:missingEvidenceWorkCount?'部分作品还未提取内容，实际范围和费用需以处理后为准':known?'按配置单价和材料量估算；实际费用以服务商为准':'未配置完整单价，费用未知'}
  }
  frame(owner:string,workId:string,frameId:string){
    this.following.requireOwner(owner)
    const visual=this.following.videoContent.stage(owner,workId,'visual',true)?.result as any
    const media=this.following.videoContent.stage(owner,workId,'media',true)?.result as Media|undefined
    const frame=visual?.frames?.find((f:any)=>f.id===frameId)
    if(!frame||!media)throw Error('画面证据不可用')
    const path=realpathSync(frame.path),rel=relative(realpathSync(media.directory),path)
    if(rel.startsWith('..')||isAbsolute(rel)||!path.endsWith('.jpg')||statSync(path).size>1024*1024)throw Error('VIDEO_FRAME_PATH_REJECTED')
    return {id:frameId,timeMs:frame.timeMs,dataUrl:'data:image/jpeg;base64,'+readFileSync(path).toString('base64')}
  }
  start(input:unknown){
    if(this.running||this.following.videoDiscovery.running)throw Error('请等待当前视频任务完成或取消')
    const current=this.following.status()
    if([current.phase,current.activity?.phase,current.basic?.phase,current.videoInformation?.phase].includes('running'))throw Error('请等待当前浏览器任务完成或取消')
    const request=z.object({ownerSecUid:z.string(),workIds:z.array(z.string().regex(/^\d{8,30}$/)).min(1).max(1000),provider:z.enum(['local','cloud','cloud-omni','cloud-frames']).default('local'),includeVision:z.boolean().default(false),clickedAt:z.number().finite().optional()}).strict().parse(input)
    this.following.requireOwner(request.ownerSecUid)
    for(const id of request.workIds)if(!this.following.videoContent.owns(request.ownerSecUid,id))throw Error('作品不属于当前账号')
    if(request.provider==='cloud-frames'){
      const provider=this.cloud('vision');assertCloudFrameProvider(provider)
      if(request.workIds.length!==1)throw Error('请先选择一条视频验证云端画面识别')
      const now=Date.now(),clickedAt=request.clickedAt??now
      if(clickedAt>now||now-clickedAt>60000)throw Error('开始时间无效，请重新点击')
      this.current=this.following.videoContent.newBatch(request.ownerSecUid,'process',request.workIds,{provider:'cloud-frames',cloudIdentity:cloudFrameIdentity(provider),modelVersion:provider.model,attemptStartedAt:new Date(clickedAt).toISOString()})
      this.run();return this.current
    }
    if(request.provider==='cloud-omni'){
      if(request.includeVision)throw Error('单模型流程使用当前文本方案，不使用独立视觉配置')
      const provider=this.cloud();assertQwenVideoProvider(provider)
      this.current=this.following.videoContent.newBatch(request.ownerSecUid,'process',request.workIds,{provider:'cloud-omni',cloudIdentity:qwenProviderIdentity(provider),modelVersion:provider.model})
      this.run();return this.current
    }
    const needsLocal=!(request.provider==='cloud'||request.includeVision)||request.workIds.some(id=>!this.hasDerivedInput(request.ownerSecUid,id,request.includeVision))
    if(needsLocal&&(!this.runtime.status().pythonAvailable||!this.runtime.status().asrAvailable))throw Error(this.runtime.status().message)
    if(request.provider==='cloud')this.cloud()
    if(request.includeVision)this.cloud('vision')
    this.current=this.following.videoContent.newBatch(request.ownerSecUid,'process',request.workIds,{provider:request.provider,includeVision:request.includeVision})
    this.run();return this.current
  }
  resume(owner:string,id:string){
    this.following.requireOwner(owner);if(this.running)throw Error('内容处理正在运行')
    const batch=this.following.videoContent.batch(owner,id)
    if(!batch||batch.kind!=='process'||batch.state==='completed')throw Error('没有可继续的内容任务')
    if(batch.provider==='cloud-omni'){const provider=this.cloud();assertQwenVideoProvider(provider);if(qwenProviderIdentity(provider)!==batch.cloudIdentity)throw Error('请切回启动此任务时的云端方案后继续')}
    if(batch.provider==='cloud-frames'&&cloudFrameIdentity(this.cloud('vision'))!==batch.cloudIdentity)throw Error('请切回启动此任务时的硅基流动视觉方案')
    this.current=batch;batch.failedWorkIds=[];this.run();return batch
  }
  cancel(owner:string){this.following.requireOwner(owner);if(this.current&&this.abort){this.current.state='cancelled';this.current.message='正在取消，已完成内容保留';this.abort.abort();this.runtime.stop();this.save()}return this.current}
  private save(){if(this.closed)return;if(this.current)this.following.videoContent.saveBatch(this.current);this.changed()}
  private hasDerivedInput(owner:string,workId:string,needFrames:boolean){
    const store=this.following.videoContent,media=store.stage(owner,workId,'media',true),transcript=store.stage(owner,workId,'transcript',true),visual=store.stage(owner,workId,'visual',true)?.result as any
    return !!media&&!!transcript&&(!needFrames||!!visual?.frames?.length&&visual.frames.every((f:any)=>existsSync(f.path)))
  }
  private reusableMedia(owner:string,workId:string):Media|null{
    const work=this.following.videoInformation.store.list(owner).find(w=>w.workId===workId)
    const saved=this.following.videoContent.stage(owner,workId,'media',true)?.result as Media|undefined
    if(saved&&existsSync(saved.mediaPath)&&statSync(saved.mediaPath).size===saved.byteLength)return saved
    const root=join(this.userData,'video-content','evidence')
    if(!existsSync(root))return null
    for(const dir of readdirSync(root).reverse()){
      try{const proof=JSON.parse(readFileSync(join(root,dir,'proof.json'),'utf8'))
        const mediaPath=join(root,dir,'source.mp4')
        if(proof.capture.ownerVerification.secUid===owner&&proof.capture.work.workId===workId&&proof.capture.work.authorSecUid===work?.authorSecUid&&proof.capture.work.authorUid===work?.authorUid&&existsSync(mediaPath))return {...proof.media,mediaPath,directory:join(root,dir)}
      }catch{}
    }
    return null
  }
  private run(){
    const batch=this.current!,abort=new AbortController(),initialFrameStart=batch.provider==='cloud-frames'&&batch.state==='queued'?batch.attemptStartedAt:undefined;this.abort=abort;batch.state='running';batch.startedAt??=new Date().toISOString();batch.attemptStartedAt=initialFrameStart??new Date().toISOString();batch.attemptWorkIds=batch.workIds.filter(id=>!batch.completedWorkIds.includes(id));batch.displayedWorkIds=[];batch.firstDisplayedMs=undefined;batch.displayedTotalMs=undefined;batch.firstAvailableMs=undefined;batch.message='开始处理选中的作品';this.save()
    batch.finishedAt=undefined;batch.elapsedMs=undefined;this.save()
    void this.execute(batch,abort.signal).catch(error=>{
      batch.state=abort.signal.aborted?'cancelled':'failed';batch.message=abort.signal.aborted?'已取消，已完成内容保留':this.error(error);this.save()
    }).finally(()=>{this.abort=null;this.runtime.stop();this.save()})
  }
  private error(reason:unknown){return reason instanceof Error&&/^[A-Z0-9_]+$/.test(reason.message)?reason.message:'本阶段处理未完成，可继续重试'}
  private async execute(batch:VideoContentBatch,signal:AbortSignal){
    const store=this.following.videoContent,started=performance.now()
    for(const workId of batch.workIds){
      if(batch.completedWorkIds.includes(workId))continue
      signal.throwIfAborted();this.following.requireOwner(batch.ownerSecUid)
      const work=this.following.videoInformation.store.list(batch.ownerSecUid).find(w=>w.workId===workId)
      if(!work)throw Error('VIDEO_WORK_UNAVAILABLE')
      batch.currentWorkId=workId
      const stage=async<T>(name:ContentStage,hash:string,action:()=>Promise<T>):Promise<T>=>{
        batch.currentStage=name;batch.message=`${batch.completedWorkIds.length+batch.failedWorkIds.length+1}/${batch.workIds.length} · ${{media:'读取媒体',transcript:'提取讲述',visual:'识别画面文字',summary:'生成内容摘要',classification:'本地分类',body:'文案正文',research:'正文研究报告'}[name]}`;this.save()
        const previous=store.stage(batch.ownerSecUid,workId,name,true)
        if(previous?.inputHash===hash&&(name!=='media'||existsSync((previous.result as Media).mediaPath)))return previous.result as T
        store.saveStage(batch.ownerSecUid,workId,{stage:name,state:'running',inputHash:hash,result:null})
        try{const result=await action();signal.throwIfAborted();this.following.requireOwner(batch.ownerSecUid)
          store.saveStage(batch.ownerSecUid,workId,{stage:name,state:'completed',inputHash:hash,result});this.changed();return result
        }catch(error){if(!this.closed)store.saveStage(batch.ownerSecUid,workId,{stage:name,state:signal.aborted?'cancelled':'failed',inputHash:hash,result:null,error:this.error(error)});throw error}
      }
      try{
        this.runtime.stopSummary()
        if(batch.provider==='cloud-frames'){
          const provider=this.cloud('vision');assertCloudFrameProvider(provider)
          if(cloudFrameIdentity(provider)!==batch.cloudIdentity)throw Error('CLOUD_PROFILE_CHANGED')
          const media=store.stage(batch.ownerSecUid,workId,'media',true)?.result as Media|undefined
          if(!media||!existsSync(media.mediaPath))throw Error('CLOUD_FRAME_LOCAL_MEDIA_UNAVAILABLE')
          const proof=JSON.parse(readFileSync(join(media.directory,'proof.json'),'utf8'))
          if(proof.capture?.ownerVerification?.secUid!==batch.ownerSecUid||proof.capture?.work?.workId!==workId
            ||proof.capture?.work?.authorUid!==work.authorUid||proof.capture?.work?.authorSecUid!==work.authorSecUid)throw Error('VIDEO_MEDIA_OWNER_MISMATCH')
          batch.message='正在核验本地原片并抽取代表画面';this.save()
          const prepared=await prepareCloudFrames(media,this.runtime.paths(),work.durationMs,signal)
          await stage('visual',media.sha256+':'+batch.cloudIdentity,()=>recognizeCloudFrames(provider,prepared,signal,(done,total)=>{
            this.following.requireOwner(batch.ownerSecUid);batch.message=`硅基流动 ${provider.model} 已识别画面 ${done}/${total}`;this.save()}))
          batch.completedWorkIds.push(workId);batch.firstAvailableMs??=performance.now()-started;this.save();continue
        }
        if(batch.provider==='cloud-omni'){
          const provider=this.cloud();assertQwenVideoProvider(provider)
          if(qwenProviderIdentity(provider)!==batch.cloudIdentity)throw Error('CLOUD_PROFILE_CHANGED')
          const media=await stage('media',workId,async()=>this.reusableMedia(batch.ownerSecUid,workId)??await this.following.captureWorkEvidence(batch.ownerSecUid,workId,signal))
          batch.message='核对原片并准备完整音轨与抽样画面';this.save()
          // FFmpeg only; never start the local ASR/OCR worker on this route.
          const prepared=await prepareQwenMedia(media,this.runtime.paths(),work.durationMs,signal)
          const identity=media.sha256+':'+batch.cloudIdentity
          const transcript=await stage('transcript',identity,()=>transcribeQwen(provider,prepared,signal,(done,total)=>{
            batch.message=`${provider.model} 转写音轨 ${done}/${total} 段`;this.save()}))
          const visual=await stage('visual',identity,()=>readQwenFrames(provider,prepared,signal))
          const evidence:ContentEvidence[]=transcript.segments.map(s=>({...s,kind:'speech'}))
          for(const block of visual.blocks)if(!block.needsReview)evidence.push({id:block.id,kind:'frame-text',startMs:block.timeMs,endMs:block.timeMs,text:block.text,frameRef:block.frameId})
          for(const [index,item] of visual.vision.observations.entries()){
            const frame=visual.frames.find(f=>f.id===item.frameIds[0])!
            if(item.text.trim())evidence.push({id:`cloud-visual-${index+1}`,kind:'visual',startMs:frame.timeMs,endMs:frame.timeMs,text:item.text,frameRef:frame.id})
          }
          evidence.sort((a,b)=>a.startMs-b.startMs)
          const limitations=[`${provider.model} 完成音轨转写、抽样画面读取与摘要，未使用本地ASR/OCR。`,
            '转写时间标记为音频分段范围，不是逐句或逐词对齐；分段边界可能断句。',
            `已提交${prepared.durationMs/1000}秒时间轴的音轨；机器听写仍需核对专名、数字、否定与条件。`,
            `画面仅为全时间轴${prepared.frames.length}张静态抽样，不代表完整动作过程。`,'以下内容是作者表达，未经外部事实核验。',
            ...(!prepared.hasAudio?['原片无音轨，仅使用画面材料。']:[]),...(!transcript.segments.length?['未识别到可转写语音。']:[]),
            ...transcript.uncertainties.slice(0,4),...visual.vision.limitations.slice(0,4)]
          await stage<SavedContentSummary>('summary',summaryInputHash(provider,evidence,limitations),()=>generateVideoSummary(provider,evidence,limitations,signal,(done,total)=>{
            batch.message=`${provider.model} 整理摘要 ${done}/${total}`;this.save()},entry=>writeFileSync(join(prepared.directory,`summary-${Date.now()}.json`),JSON.stringify(entry,null,2))))
          batch.completedWorkIds.push(workId);batch.firstAvailableMs??=performance.now()-started;this.save();continue
        }
        await prepareContentCache(join(this.userData,'video-content','evidence'))
        const useDerived=!!(batch.provider==='cloud'||batch.includeVision)&&this.hasDerivedInput(batch.ownerSecUid,workId,!!batch.includeVision)
        const cachedVisual=store.stage(batch.ownerSecUid,workId,'visual',true)?.result as any
        const media=useDerived?store.stage(batch.ownerSecUid,workId,'media',true)!.result as Media:await stage('media',workId,async()=>this.reusableMedia(batch.ownerSecUid,workId)??await this.following.captureWorkEvidence(batch.ownerSecUid,workId,signal))
        const params={mediaPath:media.mediaPath,outputDir:media.directory,expectedDurationMs:work.durationMs,expectedSha256:media.sha256}
        const transcript=useDerived?store.stage(batch.ownerSecUid,workId,'transcript',true)!.result as any:await stage<any>('transcript',media.sha256+':small-v1',()=>this.runtime.request('transcribe',params,signal))
        let visual:any=useDerived?cachedVisual??null:null
        if((!useDerived||batch.includeVision)&&(this.runtime.status().ocrAvailable||batch.includeVision)){
          const visionProvider=batch.includeVision?this.cloud('vision'):null
          try{visual=await stage('visual',media.sha256+':ocr-v5-mobile-timeline-v1:'+(visionProvider?.model||'local'),async()=>{
            const frames=cachedVisual?.frames?.length&&cachedVisual.frames.every((f:any)=>existsSync(f.path))?cachedVisual:await this.runtime.request('frames',params,signal)
            const ocr=cachedVisual?.blocks?cachedVisual:this.runtime.status().ocrAvailable?await this.runtime.request('ocr',{...params,frames:frames.frames},signal):{blocks:[]}
            const vision=visionProvider?await analyzeVideoFrames(visionProvider,frames.frames,media.directory,signal):null
            return {...ocr,vision,frames:frames.frames,coverage:frames.coverage}
          })}catch(error){if(signal.aborted||batch.includeVision)throw error}
        }
        const evidence:ContentEvidence[]=(transcript.segments??[]).map((s:any)=>({id:s.id,kind:'speech',startMs:s.startMs,endMs:s.endMs,text:s.text}))
        const seen=new Set<string>()
        for(const block of visual?.blocks??[]){if(block.confidence<.8||seen.has(block.text))continue;seen.add(block.text);evidence.push({id:block.id,kind:'frame-text',startMs:block.timeMs,endMs:block.timeMs,text:block.text,frameRef:block.frameId})}
        for(const [i,item] of (visual?.vision?.observations??[]).entries()){
          const frames=visual.frames.filter((f:any)=>item.frameIds.includes(f.id))
          if(frames.length)evidence.push({id:'visual-'+i,kind:'visual',startMs:Math.min(...frames.map((f:any)=>f.timeMs)),endMs:Math.max(...frames.map((f:any)=>f.timeMs)),text:item.text,frameRef:item.frameIds.join(',')})
        }
        evidence.sort((a,b)=>a.startMs-b.startMs)
        const limitations=['口播为机器转写，专有名词和数字可能有误。',visual?.vision?'画面仅依据抽样静态帧分析，未覆盖完整动作和声音表现。':visual?'画面为抽样文字识别，未完成动态画面理解。':'画面文字尚未取得，画面主导内容可能缺失。','内容为作者表达，未经外部事实核验。',...(visual?.vision?.limitations??[])]
        if(!transcript.segments?.length)limitations.push('未识别到口播，当前仅依据已取得的画面文字。')
        if(batch.provider!=='cloud'&&!this.runtime.status().localSummaryValidated){
          store.saveStage(batch.ownerSecUid,workId,{stage:'summary',state:'partial',inputHash:media.sha256,result:null,error:'本地摘要质量尚未通过验证，请使用云端补充摘要；本地材料已保存'});
          (batch.pendingSummaryWorkIds??=[]).push(workId);batch.completedWorkIds.push(workId);batch.message='本地材料已提取，等待云端摘要';this.save();continue
        }
        const provider=batch.provider==='cloud'?this.cloud():await this.runtime.summaryProvider(signal)
        const inputHash=summaryInputHash(provider,evidence,limitations)
        await stage<SavedContentSummary>('summary',inputHash,()=>generateVideoSummary(provider,evidence,limitations,signal,(done,total)=>{
          batch.message=`正在整理内容片段 ${done}/${total}`;this.save()}))
        batch.completedWorkIds.push(workId);batch.firstAvailableMs??=performance.now()-started;this.save()
      }catch(error){
        if(signal.aborted)throw error
        batch.failedWorkIds.push(workId);batch.message=this.error(error);this.save()
        if(/OWNER|MISMATCH|DISCONNECTED|CAPTCHA|HTTP_403|HTTP_429/.test(error instanceof Error?error.message:''))throw error
      }
    }
    batch.state=batch.failedWorkIds.length||batch.pendingSummaryWorkIds?.length?'partial':'completed';batch.finishedAt=new Date().toISOString();batch.elapsedMs=performance.now()-started
    batch.message=batch.provider==='cloud-frames'?`云端画面识别已完成 ${batch.completedWorkIds.length} 条${batch.failedWorkIds.length?'，有未完成任务：'+batch.message:''}`:batch.provider==='cloud-omni'?`单模型已处理 ${batch.completedWorkIds.length} 条视频${batch.failedWorkIds.length?`，${batch.failedWorkIds.length} 条未完成`:''}`:batch.provider!=='cloud'&&!this.runtime.status().localSummaryValidated?`已保存 ${batch.completedWorkIds.length} 条本地材料，${batch.pendingSummaryWorkIds?.length||0} 条待补充摘要${batch.failedWorkIds.length?`，${batch.failedWorkIds.length} 条未完成`:''}`:`已生成 ${batch.completedWorkIds.length} 条摘要${batch.failedWorkIds.length?`，${batch.failedWorkIds.length} 条需要继续处理`:''}`;batch.currentWorkId=undefined;batch.currentStage=undefined;this.save()
  }
  stop(){if(this.closed)return;if(this.abort)this.following.videoContent.interrupt();this.closed=true;this.abort?.abort();this.runtime.stop()}
}
