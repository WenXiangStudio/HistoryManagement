import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { FollowingDirectoryStore } from './followingDirectoryStore'
import { type FollowingSyncState,type FollowingConfiguration } from '../shared/followingDirectory'
import {z} from 'zod'
import {FollowingPlanStore} from './followingPlanStore'
import {planOwnerSchema} from '../shared/followingPlan'
import { deployFollowingConnection, FOLLOWING_VERSION } from './followingConnection'
import {FollowingPreferences,followingBrowserProfiles} from './followingPreferences'
import {CreatorActivityService} from './creatorActivityService'
import type {CreatorListItem} from '../shared/contracts'
import {creatorActivityProgressSchema} from '../shared/creatorActivity'
import { DEFAULT_CREATOR_REFRESH_PACING, creatorsForRefreshScope, CREATOR_REFRESH_SCOPE_LABELS, type CreatorRefreshScope } from '../shared/creatorRefreshPolicy'
import {CreatorDatabaseStore} from './creatorDatabaseStore'
import {CreatorPriorityStore} from './creatorPriorityStore'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (entry) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[entry]!)
type Scope = {action:'list';runId:string;ownerSecUid:string|null;cursor:number;offset:number;pageCount:number}
type PrepareCommand={action:'account';preparationId:string;ownerNickname:string|null;ownerSecUid:string|null;origin:string;token:string}
type ProbeCommand={action:'probe';probeId:string;origin:string;token:string}
export class FollowingSyncService {
  readonly store: FollowingDirectoryStore
  readonly activity: CreatorActivityService
  readonly plan: FollowingPlanStore
  readonly creatorDatabase:CreatorDatabaseStore
  readonly creatorPriority:CreatorPriorityStore
  private readonly preferences:FollowingPreferences
  private pendingBinding:{label:string;expectedOwner:string|null}|null=null
  private enrollmentNonce:string|null=null
  private server: Server | null = null
  private token = randomBytes(32).toString('hex')
  private origin = ''
  private state: FollowingSyncState
  private started=0
  private scope: Scope | null=null
  private waiting: ServerResponse | null=null
  private command: (Scope & {origin:string;token:string}|PrepareCommand|ProbeCommand|(NonNullable<ReturnType<CreatorActivityService['begin']>>&{origin:string;token:string})|(ReturnType<FollowingPlanStore['beginBasic']>&{origin:string;token:string})) | null=null
  private probeId:string|null=null
  private preparationDeadline:ReturnType<typeof setTimeout>|null=null
  private monitor:ReturnType<typeof setInterval>|null=null
  private monitoredOnline=false
  private retryPreparationAt=0
  private lastSeen=0
  private extensionVersion: string | null=null
  private connectorInstance:string|null=null
  private preparedOwnerSecUid:string|null=null
  private runDeadline: ReturnType<typeof setTimeout> | null=null
  constructor(private readonly userData: string, private readonly changed: () => void) {
    this.store = new FollowingDirectoryStore(join(userData, 'following-directory.sqlite'))
    this.activity = new CreatorActivityService(this.store.db, changed)
    this.plan = new FollowingPlanStore(this.store)
    this.creatorDatabase=new CreatorDatabaseStore(this.store.db)
    this.creatorPriority=new CreatorPriorityStore(this.store.db)
    const defaultProfile=this.browserProfiles().find(profile=>profile.extensionInstalled)?.directory??this.browserProfiles()[0]?.directory??null
    this.preferences=new FollowingPreferences(userData,this.store.latest()?.ownerSecUid??null,defaultProfile)
    if(this.preferences.value.activeOwnerSecUid)this.store.selectAccount(this.preferences.value.activeOwnerSecUid)
    const latest = this.store.latest()
    this.state = { phase: 'idle', runId: latest?.runId ?? null, message: '同步完整关注清单，基础资料按需补全',
      count: this.store.list().length, ownerSecUid: latest?.ownerSecUid ?? null, extensionDirectory: null,
      reportDirectory: null, databasePath: this.store.path, setupUrl: null,accountStatus:'unchecked',
      readiness:{phase:'offline',preparationId:null,message:'正在连接关注扩展…'} }
    if(latest?.visible){
      try{
        const reportDirectory=join(userData,'following-runs',latest.runId)
        const timing=JSON.parse(readFileSync(join(reportDirectory,'following-timing.json'),'utf8'))
        const row=this.store.db.prepare('SELECT report_json FROM visible_directory_runs WHERE run_id=?').get(latest.runId)!
        const count=JSON.parse(String(row.report_json)).creators.length
        if(Number.isFinite(timing.displayedTotalMs)&&timing.displayedTotalMs>0){
          this.state={...this.state,phase:'completed',count,totalCount:this.store.list().length,reportDirectory,timing,
            message:`最近一次新增 ${count} 位博主，资料库累计 ${this.store.list().length} 位。`}
        }
      }catch{ /* Historical imports without a display receipt remain idle. */ }
    }
  }
  status(): FollowingSyncState { return { ...this.state, plan:this.plan.plan(this.preferences.value.activeOwnerSecUid),basic:this.plan.basicStatus(this.preferences.value.activeOwnerSecUid),activity:this.activity.status(this.preferences.value.activeOwnerSecUid), connection:{online:this.extensionVersion===FOLLOWING_VERSION&&Date.now()-this.lastSeen<30000,
    version:this.extensionVersion,expectedVersion:FOLLOWING_VERSION} } }
  private browserProfiles(){return followingBrowserProfiles(join(process.env.LOCALAPPDATA||'','Google','Chrome','User Data'),join(this.userData,'following-extension'))}
  configuration():FollowingConfiguration{
    return {chromeProfile:this.preferences.value.chromeProfile,activeOwnerSecUid:this.preferences.value.activeOwnerSecUid,
      profiles:this.browserProfiles(),accounts:this.store.accounts(),bindingPending:!!this.pendingBinding,connected:!!this.status().connection?.online,
      connectorVersion:this.extensionVersion,expectedVersion:FOLLOWING_VERSION,extensionDirectory:this.state.extensionDirectory}
  }
  hasDirectory():boolean{return !!this.preferences.value.activeOwnerSecUid||!!this.store.latest()}
  getCreatorDatabase(){return this.creatorDatabase.view(this.preferences.value.activeOwnerSecUid,this.listCreators())}
  updateCreatorDatabase(input:unknown){
    const result=this.creatorDatabase.update(this.preferences.value.activeOwnerSecUid,this.listCreators(),input)
    this.changed();return result
  }
  updateCreatorPriority(input:unknown){
    this.requireAccountIdle()
    const result=this.creatorPriority.update(this.preferences.value.activeOwnerSecUid,this.listCreators(),input)
    this.changed();return result
  }
  private resetAccountState():void{
    this.clearRunDeadline();this.clearPreparationDeadline();this.command=null;this.preparedOwnerSecUid=null;this.retryPreparationAt=0
    this.state={...this.state,phase:'idle',runId:null,count:this.store.list().length,totalCount:this.store.list().length,timing:undefined,reportDirectory:null,
      message:'账号已切换，正在重新准备同步。',ownerSecUid:this.preferences.value.activeOwnerSecUid,accountStatus:'unchecked',
      readiness:{phase:'offline',preparationId:null,message:'正在重新连接并验证所选账号…'}}
    this.changed()
  }
  private requireAccountIdle():void{if(['running','awaiting-config'].includes(this.state.phase)||this.status().activity?.phase==='running'||this.status().basic?.phase==='running')throw new Error('请等待本轮同步或资料刷新完成，或取消后再切换账号')}
  listCreators(search=''):CreatorListItem[]{
    const owner=this.preferences.value.activeOwnerSecUid
    const pending=new Set(owner?this.store.db.prepare("SELECT sec_uid FROM following_basic_fields WHERE owner_sec_uid=? AND (signature_status<>'done' OR avatar_status<>'done')").all(owner).map(row=>String(row.sec_uid)):[])
    return this.activity.decorate(owner,this.creatorPriority.decorate(owner,this.store.list(search))).map(row=>({...row,basicPending:pending.has(new URL(row.profileUrl).pathname.split('/').at(-1)!)}))
  }
  startActivity(creatorId?:number,resume=false,creatorIds?:number[],scope?:CreatorRefreshScope):FollowingSyncState{
    if(scope!==undefined&&(!['active','regular','inactive','all'].includes(scope)||creatorId!==undefined||creatorIds!==undefined||resume))throw new Error('更新分组无效')
    if(creatorIds!==undefined&&(!Array.isArray(creatorIds)||!creatorIds.length||creatorIds.length>10000
      ||creatorIds.some(id=>!Number.isSafeInteger(id)||id>=0)||new Set(creatorIds).size!==creatorIds.length
      ||creatorId!==undefined||resume))throw new Error('所选博主范围无效')
    if(this.status().basic?.phase==='running')throw new Error('请等待基础资料补充完成')
    if(['running','awaiting-config'].includes(this.state.phase))throw new Error('请等待新增博主同步完成')
    if(!this.status().connection?.online||this.state.readiness?.phase!=='ready')throw new Error('请等待连接器与账号准备完成')
    const owner=this.preferences.value.activeOwnerSecUid
    if(!owner)throw new Error('请先绑定当前资料账号')
    const creators=this.listCreators(),group=creatorId!==undefined||resume?creators:creatorsForRefreshScope(creators,scope??'all')
    if(scope&&!group.length)throw new Error(`${CREATOR_REFRESH_SCOPE_LABELS[scope]}：当前账号没有符合条件的博主`)
    let targets=group.map(item=>({id:item.id,secUid:new URL(item.profileUrl).pathname.split('/').at(-1)!,uid:item.nativeUid??null,nickname:item.nickname}))
    if(creatorIds){
      targets=targets.filter(item=>creatorIds.includes(item.id))
      if(targets.length!==creatorIds.length)throw new Error('部分所选博主不属于当前账号，请重新选择')
    }
    const command=this.activity.begin(owner,targets,creatorId,resume,true,{pacing:DEFAULT_CREATOR_REFRESH_PACING,scope})
    if(!command)return this.status()
    this.command={...command,origin:this.origin,token:this.token};this.dispatch();return this.status()
  }
  cancelActivity():FollowingSyncState{if(this.command&&'action' in this.command&&this.command.action==='activity')this.command=null;this.activity.cancel();return this.status()}
  async saveConfiguration(input:unknown):Promise<FollowingConfiguration>{
    this.requireAccountIdle()
    const values=z.object({chromeProfile:z.string().regex(/^(Default|Profile \d+)$/),label:z.string().trim().max(100).optional()}).parse(input)
    if(!this.browserProfiles().some(profile=>profile.directory===values.chromeProfile))throw new Error('所选 Chrome 用户配置不存在')
    const changed=values.chromeProfile!==this.preferences.value.chromeProfile
    this.preferences.value.chromeProfile=values.chromeProfile;this.preferences.save()
    const owner=this.preferences.value.activeOwnerSecUid?this.store.account(this.preferences.value.activeOwnerSecUid):null
    if(owner)this.store.recordAccount(owner,{label:values.label||owner.label,...(!changed?{chromeProfile:values.chromeProfile}:{})})
    if(changed){
      this.lastSeen=0;this.resetAccountState()
      this.enrollmentNonce=this.preferences.value.connectors[values.chromeProfile]?null:randomBytes(16).toString('hex')
      if(this.waiting&&!this.waiting.writableEnded)this.waiting.end(JSON.stringify({command:null}));this.waiting=null
      if(this.enrollmentNonce)this.openChrome(this.state.setupUrl!)
      await this.prepare(true,true)
    }
    this.changed();return this.configuration()
  }
  async switchAccount(secUid:string):Promise<FollowingConfiguration>{
    this.requireAccountIdle()
    const owner=this.store.account(secUid);if(!owner)throw new Error('请选择已保存账号')
    this.pendingBinding=null
    this.preferences.value.activeOwnerSecUid=owner.secUid;this.store.selectAccount(owner.secUid)
    this.resetAccountState()
    if(owner.chromeProfile&&owner.chromeProfile!==this.preferences.value.chromeProfile)return this.saveConfiguration({chromeProfile:owner.chromeProfile})
    this.preferences.save();await this.prepare(true,true)
    return this.configuration()
  }
  async bindCurrentAccount(input:unknown):Promise<FollowingConfiguration>{
    this.requireAccountIdle()
    const values=z.object({label:z.string().trim().max(100).default(''),profileUrl:z.union([z.literal(''),z.string().url()]).default('')}).parse(input)
    let expectedOwner:string|null=null
    if(values.profileUrl){
      const url=new URL(values.profileUrl),match=url.pathname.match(/^\/user\/([A-Za-z0-9._-]{1,240})\/?$/)
      if(url.origin!=='https://www.douyin.com'||!match||match[1]==='self')throw new Error('请填写具体账号的抖音主页链接，或留空自动读取')
      expectedOwner=match[1]
    }
    this.pendingBinding={label:values.label,expectedOwner}
    this.resetAccountState()
    await this.initialize()
    if(!this.status().connection?.online)throw new Error('请先连接关注扩展')
    const preparationId=randomBytes(12).toString('hex')
    this.state.readiness={phase:'checking',preparationId,message:'正在核验要绑定的抖音账号…'}
    this.command={action:'account',preparationId,...this.expectedOwner(),origin:this.origin,token:this.token}
    this.dispatch();this.changed()
    return this.configuration()
  }
  async cancelBinding():Promise<FollowingConfiguration>{
    this.requireAccountIdle();this.pendingBinding=null;this.resetAccountState();await this.prepare(true,true);return this.configuration()
  }
  async initialize(): Promise<void> {
    if(this.server)return
    const sourceRoot = app.isPackaged ? join(process.resourcesPath, 'browser-connector') : join(app.getAppPath(), 'browser-connector')
    this.state.extensionDirectory=await deployFollowingConnection(sourceRoot,this.userData)
    this.server=createServer((request,response)=>{
      void (async()=>{
        const path=new URL(request.url||'/',this.origin).pathname
        const allowedOrigin=request.headers.origin
        if(allowedOrigin&&allowedOrigin!==this.origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(allowedOrigin)){
          response.writeHead(403);response.end();return
        }
        if(allowedOrigin)response.setHeader('Access-Control-Allow-Origin',allowedOrigin)
        response.setHeader('Access-Control-Allow-Headers','authorization,content-type,x-following-version,x-following-instance,x-following-connector')
        response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        response.setHeader('Cache-Control','no-store')
        response.setHeader('X-Content-Type-Options','nosniff')
        if(request.method==='OPTIONS'){response.writeHead(204);response.end();return}
        if(path==='/following-connect'&&request.method==='GET'){
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(this.guide());return
        }
        if(request.headers.authorization!==`Bearer ${this.token}`){response.writeHead(403);response.end();return}
        response.setHeader('Content-Type','application/json; charset=utf-8')
        if(path==='/commands'&&request.method==='GET'){
          const connector=String(request.headers['x-following-connector']||'')
          if(!/^[a-f0-9-]{36}$/.test(connector)){response.writeHead(409);response.end(JSON.stringify({error:'请更新关注扩展'}));return}
          const selectedProfile=this.preferences.value.chromeProfile
          const expected=selectedProfile?this.preferences.value.connectors[selectedProfile]:null
          if(this.enrollmentNonce||(expected&&expected!==connector)){response.writeHead(409);response.end(JSON.stringify({error:'请连接 APP 所选 Chrome 用户配置'}));return}
          if(selectedProfile&&!expected){this.preferences.value.connectors[selectedProfile]=connector;this.preferences.save()}
          const wasOnline=this.status().connection!.online
          this.extensionVersion=String(request.headers['x-following-version']||'')
          if(this.extensionVersion!==FOLLOWING_VERSION){
            this.blockPreparation('关注扩展需要更新，请重新加载扩展。','EXTENSION_VERSION_MISMATCH')
            response.writeHead(409);response.end(JSON.stringify({error:'请重新加载新版关注扩展'}));return
          }
          this.lastSeen=Date.now()
          const instance=String(request.headers['x-following-instance']||'')
          const restarted=!!this.connectorInstance&&instance!==this.connectorInstance
          this.connectorInstance=instance
          if(!process.argv.includes('--structured-probe')&&(!wasOnline||restarted)&&!['running','awaiting-config'].includes(this.state.phase)&&this.status().activity?.phase!=='running'&&this.status().basic?.phase!=='running')void this.prepare(false,restarted)
          if(!wasOnline)this.changed()
          if(this.waiting&&!this.waiting.writableEnded)this.waiting.end(JSON.stringify({command:null}))
          this.waiting=response
          const deadline=setTimeout(()=>{if(this.waiting===response)this.waiting=null;if(!response.writableEnded)response.end(JSON.stringify({command:null}))},20000)
          response.on('close',()=>{clearTimeout(deadline);if(this.waiting===response)this.waiting=null})
          this.dispatch();return
        }
        if(path==='/status'&&request.method==='GET'){response.end(JSON.stringify(this.status()));return}
        if(path==='/basic-state'&&request.method==='GET'){response.end(JSON.stringify(this.plan.basicStatus(this.preferences.value.activeOwnerSecUid)));return}
        if(path==='/activity-state'&&request.method==='GET'){this.lastSeen=Date.now();response.end(JSON.stringify(this.status().activity));return}
        if(path==='/open-folder'&&request.method==='POST'){
          const error=await shell.openPath(this.state.extensionDirectory!);if(error)throw new Error(error)
          response.end(JSON.stringify({message:'扩展目录已打开'}));return
        }
        if(path==='/open-extensions'&&request.method==='POST'){
          this.openChrome('chrome://extensions/');response.end(JSON.stringify({message:'扩展管理页已打开'}));return
        }
        if(request.method!=='POST'||!['/progress','/report','/readiness','/structured-probe','/connector-enroll','/activity-progress','/activity-report','/list-owner','/list-page','/basic-progress','/basic-report'].includes(path)){response.writeHead(404);response.end('{}');return}
        let size=0
        const chunks:Buffer[]=[]
        for await(const chunk of request){size+=chunk.length;if(size>512*1024)throw new Error('同步报告过大');chunks.push(chunk)}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if(path==='/activity-report'||path==='/activity-progress'){
          this.lastSeen=Date.now()
          const runId=z.string().parse(body.runId)
          const state=path==='/activity-report'?this.activity.receive(runId,z.number().int().negative().parse(body.creatorId),body.capture,
            body.errorCode===undefined?undefined:z.string().regex(/^[A-Z0-9_-]{1,100}$/).parse(body.errorCode))
            :this.activity.progress(runId,creatorActivityProgressSchema.parse(body))
          if(body.blocked&&body.errorCode==='OWNER_IDENTITY_MISMATCH')this.blockPreparation('浏览器登录账号已变化，请重新检查所选账号。','OWNER_IDENTITY_MISMATCH')
          response.end(JSON.stringify(state));return
        }
        if(path==='/connector-enroll'){
          if(!this.enrollmentNonce||body.nonce!==this.enrollmentNonce||!this.preferences.value.chromeProfile||!/^[a-f0-9-]{36}$/.test(body.connectorId))throw new Error('浏览器连接绑定已失效')
          this.preferences.value.connectors[this.preferences.value.chromeProfile]=body.connectorId;this.preferences.save();this.enrollmentNonce=null
          await this.prepare(false,true)
          response.end(JSON.stringify({ok:true,message:'所选浏览器连接已绑定'}));return
        }
        if(path==='/structured-probe'){
          if(body.probeId!==this.probeId)throw new Error('探测会话已失效')
          const directory=join(this.userData,'following-structured-probe')
          await mkdir(directory,{recursive:true})
          await writeFile(join(directory,'latest.json'),JSON.stringify(body.report,null,2))
          response.end(JSON.stringify({ok:true,report:body.report}));return
        }
        if(path==='/basic-report'||path==='/basic-progress'){
          const runId=z.string().parse(body.runId)
          const state=path==='/basic-report'?this.plan.receiveBasic(runId,z.string().parse(body.secUid),body.capture,body.errorCode)
            :this.plan.basicProgress(runId,z.object({secUid:z.string().optional(),finished:z.boolean().optional(),blocked:z.boolean().optional(),errorCode:z.string().max(100).optional()}).parse(body))
          this.changed();response.end(JSON.stringify(state));return
        }
        if(path==='/readiness'){
          if(body.preparationId!==this.state.readiness?.preparationId)throw new Error('账号核验会话已失效')
          if(body.phase==='ready'){
            const owner=planOwnerSchema.parse(body.owner),expected=this.expectedOwner()
            if(expected.ownerSecUid&&owner.secUid!==expected.ownerSecUid)throw new Error('OWNER_IDENTITY_MISMATCH')
            this.adoptOwner(owner);this.state.accountStatus='verified'
            this.state.readiness={phase:'ready',preparationId:body.preparationId,message:'扩展已连接，账号已绑定'}
          }else this.blockPreparation(String(body.message||'账号核验失败'),String(body.code||'LOGIN_REQUIRED'))
          this.changed();response.end(JSON.stringify(this.status()));return
        }
        const runId=this.state.runId,reportDirectory=this.state.reportDirectory!
        if(body.runId!==runId||this.state.phase!=='running')throw new Error('关注清单会话已结束')
        this.lastSeen=Date.now()
        if(path==='/list-owner'){
          const owner=this.plan.bindOwner(runId!,body.owner,this.scope?.ownerSecUid??null)
          this.adoptOwner(owner);this.state.ownerSecUid=owner.secUid;this.state.accountStatus='verified'
        }else if(path==='/list-page'){
          const persistenceStart=performance.now(),result=this.plan.page(runId!,body.page)
          this.state.count=result.count;this.state.totalCount=this.store.list().length
          this.state.timing={...this.state.timing!,persistenceMs:(this.state.timing?.persistenceMs||0)+performance.now()-persistenceStart}
          if(result.complete){
            this.state.phase='completed';this.state.errorCode=undefined;this.clearRunDeadline()
            this.state.timing={...this.state.timing!,acquisitionMs:body.acquisitionMs,savedTotalMs:performance.now()-this.started}
            this.state.message=`关注清单已完成：本轮 ${result.count} 位，资料库累计 ${this.state.totalCount} 位。`
            await writeFile(join(reportDirectory,'following-timing.json'),JSON.stringify(this.state.timing,null,2),'utf8')
          }else this.state.message=`已保存 ${result.count} 位博主的基础资料，继续读取关注清单…`
        }else if(path==='/progress'){
          if(body.phase==='blocked'){
            this.clearRunDeadline();this.plan.stop(runId!,'blocked');this.state.phase='blocked'
            this.state.errorCode=String(body.code||'FOLLOWING_LIST_FAILED');this.state.accountStatus=body.code==='LOGIN_REQUIRED'?'login-required':'unavailable'
          }
          this.state.message=String(body.message||'正在读取关注清单').slice(0,500)
        }else throw new Error('当前版本不接受旧关注同步回报')
        this.changed();response.end(JSON.stringify(this.status()))
      })().catch(error=>{if(!response.headersSent)response.writeHead(400);response.end(JSON.stringify({error:error instanceof Error?error.message:'关注同步失败'}))})
    })
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',resolve)})
    const address=this.server.address()
    if(!address||typeof address==='string')throw new Error('关注同步服务未启动')
    this.origin=`http://127.0.0.1:${address.port}`
    this.state.setupUrl=this.origin+'/following-connect'
    await writeFile(join(this.userData,'following-bridge.json'),JSON.stringify({origin:this.origin,token:this.token,pid:process.pid}),{mode:0o600})
  }
  private ownerNickname():string|null{
    if(this.preferences.value.activeOwnerSecUid)return this.store.account(this.preferences.value.activeOwnerSecUid)?.nickname??null
    const latest=this.store.latest()
    return latest?.visible?String(this.store.db.prepare('SELECT account_label FROM visible_directory_runs WHERE run_id=?').get(latest.runId)?.account_label||'')||null:null
  }
  private expectedOwner():{ownerNickname:string|null;ownerSecUid:string|null}{
    return this.pendingBinding?{ownerNickname:null,ownerSecUid:this.pendingBinding.expectedOwner}:{ownerNickname:this.ownerNickname(),
      ownerSecUid:this.preferences.value.activeOwnerSecUid??null}
  }
  probeStructured():FollowingSyncState{
    this.clearPreparationDeadline();this.retryPreparationAt=0
    this.probeId=randomBytes(12).toString('hex')
    this.state.readiness={phase:'checking',preparationId:null,message:'正在验证底层关注数据通路…'}
    this.command={action:'probe',probeId:this.probeId,origin:this.origin,token:this.token}
    this.dispatch();this.changed();return this.status()
  }
  async prepare(_launchBrowser=true,_force=false):Promise<FollowingSyncState>{
    await this.initialize()
    if(this.pendingBinding&&this.state.readiness?.phase==='checking')return this.status()
    if(this.status().connection?.online){
      this.state.readiness={phase:'ready',preparationId:null,message:'关注扩展已连接，点击同步时核验抖音账号'}
    }else this.state.readiness={phase:'offline',preparationId:null,message:'等待关注扩展连接，请在 Chrome 启用扩展'}
    if(!this.monitor)this.monitor=setInterval(()=>{
      const online=this.status().connection!.online
      if(online!==this.monitoredOnline){
        this.monitoredOnline=online
        if(!online){
          if(this.state.phase==='running'&&this.state.runId){this.plan.stop(this.state.runId,'blocked');this.state.phase='blocked';this.state.message='连接已断开，已保存清单保留'}
          this.plan.cancelBasic()
          if(this.status().activity?.phase==='running')this.activity.cancel()
        }
        this.state.readiness={phase:online?'ready':'offline',preparationId:null,message:online?'关注扩展已连接，点击同步时核验抖音账号':'等待关注扩展连接，请在 Chrome 启用扩展'}
        this.changed()
      }
    },1000)
    this.changed();return this.status()
  }
  private clearPreparationDeadline():void{if(this.preparationDeadline)clearTimeout(this.preparationDeadline);this.preparationDeadline=null}
  private blockPreparation(message:string,code:string):void{
    this.clearPreparationDeadline();this.state.readiness={phase:'blocked',preparationId:null,message:message.slice(0,300),code}
    this.state.accountStatus=code==='LOGIN_REQUIRED'?'login-required':'unavailable';this.changed()
  }
  private adoptOwner(owner:{uid:string;secUid:string;nickname:string}):void{
    const firstBinding=!this.preferences.value.activeOwnerSecUid&&!this.pendingBinding
    this.store.recordAccount(owner,{label:this.pendingBinding?.label||undefined,chromeProfile:this.preferences.value.chromeProfile,adoptLegacy:firstBinding})
    if(this.pendingBinding||firstBinding){this.preferences.value.activeOwnerSecUid=owner.secUid;this.preferences.save();this.store.selectAccount(owner.secUid);this.pendingBinding=null}
  }
  async start(_legacyLimit?:number,resume=false):Promise<FollowingSyncState>{
    this.requireAccountIdle()
    if(!this.status().connection?.online)throw new Error('请先连接关注扩展')
    if(this.pendingBinding)throw new Error('请先完成账号绑定')
    await this.initialize();this.started=performance.now()
    const owner=this.preferences.value.activeOwnerSecUid,previous=this.plan.plan(owner)
    const runId=resume&&previous.resumable?previous.runId!:'following-'+randomBytes(12).toString('hex')
    if(resume&&!previous.resumable)throw new Error('没有可以继续的关注清单')
    const checkpoint=this.plan.begin(runId,owner,resume)
    const reportDirectory=join(this.userData,'following-runs',runId);await mkdir(reportDirectory,{recursive:true})
    this.scope={action:'list',runId,ownerSecUid:owner,...checkpoint}
    this.state={...this.state,phase:'running',runId,reportDirectory,count:resume?previous.count:0,totalCount:this.store.list().length,
      message:'正在核验账号并读取完整关注清单…',timing:{startedAt:new Date().toISOString()},errorCode:undefined}
    this.command={...this.scope,origin:this.origin,token:this.token}
    this.clearRunDeadline();this.runDeadline=setTimeout(()=>{
      if(this.state.runId!==runId||this.state.phase!=='running')return
      this.command=null;this.plan.stop(runId,'blocked');this.state.phase='blocked';this.state.errorCode='FOLLOWING_TIMEOUT'
      this.state.message='关注清单读取超时，已保存数据保留，可继续剩余页';this.changed()
    },180000)
    this.dispatch();this.changed();return this.status()
  }
  startBasic():FollowingSyncState{
    this.requireAccountIdle()
    if(!this.status().connection?.online)throw new Error('请先连接关注扩展')
    const owner=this.preferences.value.activeOwnerSecUid;if(!owner)throw new Error('请先同步关注清单')
    this.command={...this.plan.beginBasic(owner),origin:this.origin,token:this.token};this.dispatch();this.changed();return this.status()
  }
  cancelBasic():FollowingSyncState{if(this.command&&'action' in this.command&&this.command.action==='basic')this.command=null;this.plan.cancelBasic();this.changed();return this.status()}
  private dispatch():void{
    if(!this.command||!this.waiting||this.waiting.writableEnded)return
    const response=this.waiting,command=this.command
    this.waiting=null;this.command=null
    if('action' in command&&command.action==='list')this.state.timing={...this.state.timing!,dispatchMs:performance.now()-this.started}
    response.end(JSON.stringify({command}))
  }
  configure():FollowingSyncState{this.openChrome(this.state.setupUrl!);return this.status()}
  login():FollowingSyncState{this.openChrome('https://www.douyin.com/user/self');return this.status()}
  private openChrome(url?: string): void {
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter((value): value is string => Boolean(value)).map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    const executable = candidates.find(existsSync)
    if (!executable) throw new Error('未找到 Chrome，请安装后重试')
    let profileName: string | null = this.preferences.value.chromeProfile
    try {
      const chromeRoot=join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
      const statePath = join(chromeRoot,'Local State')
      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      const value = state.profile?.last_used
      if (!profileName&&typeof value === 'string' && /^(Default|Profile \d+)$/.test(value)) profileName = value
      // Launch the profile that installed this APP's extension, even when the
      // user most recently browsed with a different Chrome account.
      for(const candidate of this.preferences.value.chromeProfile?[]:Object.keys(state.profile?.info_cache||{})){
        if(!/^(Default|Profile \d+)$/.test(candidate))continue
        for(const file of ['Secure Preferences','Preferences']){
          try{
            const preferences=JSON.parse(readFileSync(join(chromeRoot,candidate,file),'utf8'))
            if(Object.values(preferences.extensions?.settings||{}).some((entry:any)=>entry.path?.toLowerCase()===this.state.extensionDirectory?.toLowerCase()))profileName=candidate
          }catch{ /* This profile has no matching installed extension. */ }
        }
      }
    } catch { /* Chrome uses its normal profile selection when metadata is unavailable. */ }
    // A cold Chrome launch with --no-startup-window can exit successfully before
    // any MV3 extension starts. Keep a real, minimized account window alive;
    // the connector reuses this page without opening its setup/extension UI.
    const preparationId=this.state.readiness?.preparationId
    const child = spawn(executable, [...(profileName ? [`--profile-directory=${profileName}`] : []),
      ...(url ? ['--new-tab', url] : ['--new-window', '--start-minimized', '--hide-crash-restore-bubble', 'https://www.douyin.com/user/self'])], { windowsHide: true, stdio: 'ignore' })
    const failed=(message:string):void=>{
      if(url||this.state.readiness?.preparationId===preparationId)this.blockPreparation(message,'CHROME_START_FAILED')
    }
    child.on('error', error => failed(`Chrome 启动失败：${error.message}`))
    child.on('exit', code => {
      // Exit 0 can mean Chrome forwarded the request to an existing process.
      if(code!==null&&code!==0&&!this.status().connection!.online)failed(`Chrome 启动失败（退出码 ${code}）`)
    })
    child.unref()
  }
  private guide():string{
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Signal Desk · 首次连接</title>
      <style>body{font:17px/1.8 system-ui;max-width:850px;margin:60px auto;background:#f4f1ea;color:#26352d}code{overflow-wrap:anywhere}button{padding:12px;margin:10px}</style>
      <h1>连接关注同步</h1><p>首次安装或扩展更新时完成一次连接。连接后，回到 APP 点击同步即可。</p>
      <p>在 Chrome 扩展管理页启用开发者模式，加载以下目录；已安装时点击该扩展的“重新加载”。</p>
      <code>${escapeHtml(this.state.extensionDirectory!)}</code><p><button id="extensions">扩展管理</button><button id="folder">扩展目录</button></p>
      <p id="status">等待关注扩展连接…</p><script id="following-config" type="application/json">${JSON.stringify({origin:this.origin,token:this.token,nonce:this.enrollmentNonce}).replace(/</g,'\\u003c')}</script><script>
      const origin=${JSON.stringify(this.origin)},token=${JSON.stringify(this.token)};
      document.getElementById('extensions').onclick=()=>fetch(origin+'/open-extensions',{method:'POST',headers:{authorization:'Bearer '+token}});
      document.getElementById('folder').onclick=()=>fetch(origin+'/open-folder',{method:'POST',headers:{authorization:'Bearer '+token}});
      setInterval(()=>fetch(origin+'/status',{headers:{authorization:'Bearer '+token}}).then(r=>r.json()).then(s=>{
        document.getElementById('status').textContent=s.connection.online?'已连接。请回到 APP 同步；本页可关闭。':'等待连接：安装或更新后请重新加载扩展。'
        if(s.connection.online&&!window.connected){window.connected=true;setTimeout(()=>window.close(),1000)}
      }).catch(()=>{}),500);
      </script></html>`
  }
  private clearRunDeadline():void{if(this.runDeadline)clearTimeout(this.runDeadline);this.runDeadline=null}
  async cancel(): Promise<FollowingSyncState> {
    this.clearRunDeadline();this.command=null
    if(this.state.runId)this.plan.stop(this.state.runId)
    this.state.phase='cancelled';this.state.accountStatus='unchecked';this.state.message='本轮关注同步已取消，已有目录保留';this.changed()
    return this.status()
  }
  async rendered(runId:string,loadedCount:number):Promise<FollowingSyncState>{
    if(this.state.phase!=='completed'||this.state.runId!==runId||loadedCount!==this.state.totalCount||!this.state.timing||!this.started)return this.status()
    if(!this.state.timing!.displayedTotalMs){
      const displayedTotalMs=performance.now()-this.started
      this.state.timing={...this.state.timing!,displayedTotalMs,averageDisplayedMs:this.state.count?displayedTotalMs/this.state.count:0}
      await writeFile(join(this.state.reportDirectory!,'following-timing.json'),JSON.stringify(this.state.timing,null,2),'utf8')
      this.changed()
    }
    return this.status()
  }
  async stop():Promise<void>{
    this.activity.cancel();this.plan.cancelBasic()
    this.clearRunDeadline()
    this.clearPreparationDeadline()
    if(this.monitor)clearInterval(this.monitor)
    const server=this.server;this.server=null
    if(server)await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})
    await rm(join(this.userData,'following-bridge.json'),{force:true})
    this.store.close()
  }
}
