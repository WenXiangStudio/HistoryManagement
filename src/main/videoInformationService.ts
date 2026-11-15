import {randomBytes} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import type {CreatorListItem} from '../shared/contracts'
import {creatorNeedsVerification} from '../shared/creatorRefreshPolicy'
import {creatorActivityCaptureSchema,classifyActivityVisibility} from '../shared/creatorActivity'
import {acceptVideoInformation,videoInformationErrorMessage,type VideoInformationCommand,type VideoInformationState,type VideoInformationTarget} from '../shared/videoInformation'
import {VideoInformationStore} from './videoInformationStore'
import {saveVideoEvidence} from './videoEvidence'

// Single-video source/ownership proof precedes persistence. The current first
// step is intentionally separate from the gated full works/comments pipeline.
export class VideoInformationService {
  readonly store:VideoInformationStore
  private state:VideoInformationState={phase:'idle',runId:null,ownerSecUid:null,creatorId:null,message:'先采集一条已发现视频的基础信息'}
  private command:VideoInformationCommand|null=null
  private timer:ReturnType<typeof setTimeout>|null=null
  private started=0
  private evidenceAbort:AbortController|null=null
  constructor(private db:DatabaseSync,private userData:string,private changed:()=>void){this.store=new VideoInformationStore(db);this.store.interruptRuns()}
  status(owner:string|null):VideoInformationState {
    return this.state.ownerSecUid===owner?{...this.state}:(owner?this.store.latestState(owner):undefined)??{phase:'idle',runId:null,ownerSecUid:owner,creatorId:null,message:'尚未采集视频信息'}
  }
  get running():boolean{return this.state.phase==='running'}
  target(owner:string,creator:CreatorListItem):VideoInformationTarget {
    if(creator.isDemo||creator.id>=0||!creator.nativeUid)throw Error('请先补全这位博主的原生身份')
    if(creatorNeedsVerification(creator))throw Error('请先核验并补齐这位博主的作品基线或异常记录')
    const authorSecUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!
    const row=this.db.prepare("SELECT capture_json FROM creator_activity_snapshots WHERE owner_sec_uid=? AND creator_sec_uid=? AND id NOT IN (SELECT snapshot_id FROM creator_activity_reviews) AND json_extract(snapshot_json,'$.errorCode') IS NULL AND json_extract(snapshot_json,'$.coverage')<>'partial' ORDER BY id DESC LIMIT 1").get(owner,authorSecUid)
    if(!row)throw Error('请先刷新这位博主的主页状态，以取得可信作品记录')
    const capture=creatorActivityCaptureSchema.parse(JSON.parse(String(row.capture_json)))
    if(capture.ownerSecUid!==owner||capture.profile.uid!==creator.nativeUid||capture.profile.secUid!==authorSecUid)throw Error('本地作者身份不一致，请先重新核验')
    const work=capture.pages.flatMap(page=>page.records||[]).filter(work=>work.authorUid===creator.nativeUid&&work.authorSecUid===authorSecUid
      &&work.visibility.awemeType===0&&classifyActivityVisibility(work.visibility)==='public'&&work.publishedAt)
      .sort((a,b)=>b.publishedAt!.localeCompare(a.publishedAt!))[0]
    if(!work)throw Error('尚无可读取的公开视频记录，请先刷新主页状态')
    return {creatorId:creator.id,nickname:creator.nickname,authorUid:creator.nativeUid,authorSecUid,workId:work.workId,publishedAt:work.publishedAt!}
  }
  begin(owner:string,ownerUid:string,creator:CreatorListItem,captureEvidence=false,explicitTarget?:VideoInformationTarget):VideoInformationCommand {
    if(this.running)throw Error('视频信息正在采集，请等待或取消')
    const target=explicitTarget??this.target(owner,creator),runId='video-info-'+randomBytes(12).toString('hex')
    this.started=performance.now();this.command={...target,action:'video-information',runId,ownerSecUid:owner,ownerUid,...(captureEvidence?{captureEvidence:true}:{})}
    this.state={phase:'running',runId,ownerSecUid:owner,creatorId:creator.id,startedAt:new Date().toISOString(),message:`正在读取 ${creator.nickname} 的一条视频信息`}
    if(!captureEvidence)this.store.saveState(this.command,this.state)
    this.evidenceAbort=captureEvidence?new AbortController():null
    this.timer=setTimeout(()=>this.cancel('VIDEO_READ_TIMEOUT'),captureEvidence?600000:60000);this.timer.unref?.();this.changed()
    return this.command
  }
  async receive(input:unknown):Promise<VideoInformationState> {
    const body=input as {runId?:string;errorCode?:string;capture?:unknown;media?:unknown}
    if(!this.running||!this.command||body?.runId!==this.command.runId)throw Error('视频采集会话已结束')
    const command=this.command
    if(body.errorCode){
      this.cancel(/^[A-Z0-9_-]{1,100}$/.test(body.errorCode)?body.errorCode:'VIDEO_READ_FAILED')
      return this.status(command.ownerSecUid)
    }
    try {
      const capture=acceptVideoInformation(body.capture,command,this.state.startedAt!)
      if(command.captureEvidence){
        const evidence=await saveVideoEvidence(this.userData,capture,body.media,this.evidenceAbort!.signal)
        if(!this.running||this.command?.runId!==command.runId)throw Error('VIDEO_CANCELLED')
        if(this.timer)clearTimeout(this.timer);this.timer=null
        this.state={...this.state,phase:'completed',capture,evidence,savedTotalMs:performance.now()-this.started,message:'视频媒体已取得'}
        this.changed();return this.status(command.ownerSecUid)
      }
      const directory=join(this.userData,'video-information-runs',command.runId)
      await mkdir(directory,{recursive:true})
      const reportPath=join(directory,'capture.json')
      await writeFile(reportPath,JSON.stringify({command,capture},null,2),'utf8')
      if(!this.running||this.command?.runId!==command.runId)throw Error('VIDEO_CANCELLED')
      this.store.save(command,capture,this.state.startedAt!)
      if(this.timer)clearTimeout(this.timer);this.timer=null
      this.state={...this.state,phase:'completed',capture,reportPath,savedTotalMs:performance.now()-this.started,message:'已取得并核验 1 条视频信息'}
      this.store.saveState(command,this.state)
      this.changed();return this.status(command.ownerSecUid)
    }catch(error){if(this.command?.runId===command.runId)this.cancel(error instanceof Error&&/^VIDEO_[A-Z_]+$/.test(error.message)?error.message:'VIDEO_VALIDATION_FAILED');throw error}
  }
  rendered(owner:string|null,runId:string):VideoInformationState {
    if(this.state.ownerSecUid===owner&&this.command?.runId===runId&&this.state.phase==='completed'&&this.state.displayedTotalMs===undefined){
      this.state.displayedTotalMs=performance.now()-this.started;if(!this.command.captureEvidence)this.store.saveState(this.command,this.state)
    }
    return this.status(owner)
  }
  cancel(code='VIDEO_CANCELLED'):void {
    if(!this.running)return
    if(this.timer)clearTimeout(this.timer);this.timer=null
    this.state={...this.state,phase:code==='VIDEO_CANCELLED'?'cancelled':'blocked',errorCode:code,
      message:videoInformationErrorMessage(code)}
    this.evidenceAbort?.abort();this.evidenceAbort=null
    if(this.command&&!this.command.captureEvidence)this.store.saveState(this.command,this.state)
    this.command=null;this.changed()
  }
}
