import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {CreatorListItem} from '../shared/contracts'
import {creatorNeedsVerification} from '../shared/creatorRefreshPolicy'
import {publicationRange,type VideoContentBatch} from '../shared/videoContent'
import {videoDiscoveryPageSchema,type VideoDiscoveryCommand} from '../shared/videoDiscovery'
import type {VideoContentStore} from './videoContentStore'
import type {VideoInformationStore} from './videoInformationStore'

export class VideoDiscoveryService{
  private current:VideoContentBatch|null=null
  private command:VideoDiscoveryCommand|null=null
  private timer:ReturnType<typeof setTimeout>|null=null
  private uid=''
  constructor(private content:VideoContentStore,private videos:VideoInformationStore,private creators:()=>CreatorListItem[],
    private dispatch:(command:VideoDiscoveryCommand)=>void,private changed:()=>void){}
  get running(){return this.current?.state==='running'}
  status(owner:string|null){return this.current?.ownerSecUid===owner?this.current:null}
  begin(owner:string,uid:string,input:unknown):VideoContentBatch{
    const request=z.object({ownerSecUid:z.literal(owner),creatorIds:z.array(z.number().int().negative()).min(1).max(1000),
      startDate:z.string(),endDate:z.string()}).strict().parse(input)
    publicationRange(request.startDate,request.endDate)
    const ids=[...new Set(request.creatorIds)],creators=this.creators()
    for(const id of ids){const c=creators.find(c=>c.id===id);if(!c?.nativeUid||c.isDemo||creatorNeedsVerification(c))throw Error('所选博主身份未补齐或存在异常')}
    this.uid=uid
    this.current=this.content.newBatch(owner,'discover',[],{discovery:{creatorIds:ids,startDate:request.startDate,endDate:request.endDate,authorIndex:0,cursor:0,pageCount:0,coverage:'partial',seenIds:[],ordered:true}})
    this.next();return this.current
  }
  resume(owner:string,uid:string,id:string):VideoContentBatch{
    const batch=this.content.batch(owner,id)
    if(!batch||batch.kind!=='discover'||batch.state==='completed'||!batch.discovery)throw Error('没有可继续的日期查找')
    this.current=batch;this.uid=uid;this.next();return batch
  }
  private save(){if(this.current)this.content.saveBatch(this.current);this.changed()}
  private next(){
    const batch=this.current!,d=batch.discovery!
    if(d.authorIndex>=d.creatorIds.length){batch.state='completed';batch.finishedAt=new Date().toISOString();d.coverage='complete';batch.message=`范围查找完成，取得 ${batch.workIds.length} 条普通公开视频`;this.command=null;this.save();return}
    const creator=this.creators().find(c=>c.id===d.creatorIds[d.authorIndex])
    if(!creator?.nativeUid||creatorNeedsVerification(creator)){this.end({batchId:batch.id,errorCode:'VIDEO_AUTHOR_UNAVAILABLE'});return}
    batch.state='running';batch.startedAt??=new Date().toISOString();batch.message=`正在查找 ${creator.nickname} 的指定日期作品`
    this.command={action:'video-discovery',runId:'discover-'+randomUUID(),batchId:batch.id,ownerSecUid:batch.ownerSecUid,ownerUid:this.uid,
      creatorId:creator.id,authorUid:creator.nativeUid,authorSecUid:new URL(creator.profileUrl).pathname.split('/').at(-1)!,
      ...publicationRange(d.startDate,d.endDate),cursor:d.cursor,startedAt:new Date().toISOString()}
    this.timer=setTimeout(()=>this.end({batchId:batch.id,runId:this.command?.runId,errorCode:'VIDEO_DISCOVERY_TIMEOUT'}),95000);this.timer.unref?.()
    this.save();this.dispatch(this.command)
  }
  receive(input:unknown):{stop:boolean}{
    if(!this.running||!this.command||!this.current)throw Error('日期查找会话已结束')
    const value=videoDiscoveryPageSchema.parse(input),c=this.command,b=this.current,d=b.discovery!,page=value.page,owner=value.ownerVerification
    if(value.runId!==c.runId||value.batchId!==b.id||value.creatorId!==c.creatorId||owner.runId!==c.runId||owner.uid!==c.ownerUid||owner.secUid!==c.ownerSecUid||owner.firstAuthorSecUid!==c.authorSecUid
      ||value.sourceProof.secUid!==c.authorSecUid||value.sourceProof.requestCursor!==d.cursor)throw Error('VIDEO_DISCOVERY_IDENTITY_MISMATCH')
    const start=Date.parse(c.startedAt),end=Date.parse(value.checkedAt)
    if(end<start||end>Date.now()+60000||[owner.observedAt,owner.navigationStartedAt,value.sourceProof.observedAt].some(t=>Date.parse(t)<start||Date.parse(t)>end))throw Error('VIDEO_DISCOVERY_EVIDENCE_TIME_INVALID')
    const seen=new Set(d.seenIds),records=new Map(page.records.map(r=>[r.workId,r]))
    if(records.size!==page.records.length||page.works.length!==new Set(page.works.map(w=>w.workId)).size)throw Error('VIDEO_DISCOVERY_DUPLICATE_ID')
    for(const work of page.works){const record=records.get(work.workId)
      if(!record||record.visibility!=='public'||record.awemeType!==0||record.publishedAt!==work.publishedAt||work.authorUid!==c.authorUid||work.authorSecUid!==c.authorSecUid
        ||work.publishedAt<c.start||work.publishedAt>=c.endExclusive||Date.parse(work.publishedAt)>end+60000)throw Error('VIDEO_DISCOVERY_WORK_MISMATCH')}
    for(const record of page.records){
      if(record.visibility==='public'&&record.awemeType===0&&record.publishedAt>=c.start&&record.publishedAt<c.endExclusive&&!page.works.some(w=>w.workId===record.workId))throw Error('VIDEO_DISCOVERY_WORK_MISSING')
    }
    const fresh=page.records.filter(r=>!seen.has(r.workId))
    const uncertain=page.records.some(r=>r.publishedAt>=c.start&&r.publishedAt<c.endExclusive&&(r.visibility==='unknown'||r.awemeType===null))
    let crossed=false
    for(const record of fresh){
      if(record.visibility==='unknown'||record.pinned===null)d.ordered=false
      if(record.pinned===false){const at=Date.parse(record.publishedAt);if(d.previousTime!==undefined&&at>d.previousTime)d.ordered=false;d.previousTime=at;if(record.publishedAt<c.start)crossed=true}
    }
    // Save only after the entire projected page passes validation. Never infer range completeness from counts.
    for(const work of page.works){
      if(seen.has(work.workId))continue
      this.videos.saveDiscovered(b.ownerSecUid,c.runId,work,value.checkedAt,value.sourceProof)
      if(!b.workIds.includes(work.workId))b.workIds.push(work.workId)
    }
    d.seenIds=[...new Set([...d.seenIds,...page.records.map(r=>r.workId)])];d.pageCount++
    if(uncertain){this.end({batchId:b.id,errorCode:'VIDEO_VISIBILITY_UNVERIFIED'});return {stop:true}}
    const complete=!page.has_more||d.ordered!==false&&crossed
    if(complete){
      if(this.timer)clearTimeout(this.timer);this.timer=null
      d.authorIndex++;d.cursor=0;d.seenIds=[];d.previousTime=undefined;d.ordered=true
      this.save();this.next();return {stop:true}
    }
    if(page.max_cursor===d.cursor||!fresh.length){this.end({batchId:b.id,errorCode:'VIDEO_CURSOR_NOT_ADVANCING'});return {stop:true}}
    d.cursor=page.max_cursor;b.message=`已读取 ${d.pageCount} 页、找到 ${b.workIds.length} 条，继续查找`;this.save();return {stop:false}
  }
  end(input:{batchId?:string;runId?:string;errorCode?:string;partial?:boolean}){
    if(!this.current||!this.running||input.batchId!==this.current.id||input.runId&&input.runId!==this.command?.runId)return
    if(this.timer)clearTimeout(this.timer);this.timer=null;this.command=null
    this.current.state=input.errorCode?'failed':'partial';this.current.message=input.errorCode?`查找已停止：${input.errorCode}，已取得作品保留`:'本次查找到达页数或时间边界，可继续'
    this.save()
  }
  cancel(){if(this.running&&this.current){this.end({batchId:this.current.id});this.current.state='cancelled';this.current.message='已取消查找，已取得作品保留';this.save()}}
  stop(){if(this.timer)clearTimeout(this.timer);this.timer=null;if(this.running&&this.current){this.current.state='interrupted';this.current.message='应用退出中断，可继续查找';this.command=null;this.save()}}
}
