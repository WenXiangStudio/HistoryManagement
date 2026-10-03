import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { FollowingDirectoryStore } from './followingDirectoryStore'
import { followingDiagnosticSchema, type FollowingSyncState,type FollowingConfiguration } from '../shared/followingDirectory'
import {z} from 'zod'
import {acceptStructuredFollowingCapture,verifyStructuredSource} from './structuredFollowingAcceptance'
import { deployFollowingConnection, FOLLOWING_VERSION } from './followingConnection'
import {FollowingPreferences,followingBrowserProfiles} from './followingPreferences'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (entry) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[entry]!)
type Scope = {runId:string;limit:10|20;ownerNickname:string|null;ownerSecUid:string|null;excludeSecUids:string[]}
type PrepareCommand={action:'prepare';preparationId:string;ownerNickname:string|null;ownerSecUid:string|null;origin:string;token:string;backgroundStart?:boolean}
type ProbeCommand={action:'probe';probeId:string;origin:string;token:string}
export class FollowingSyncService {
  readonly store: FollowingDirectoryStore
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
  private command: (Scope & {origin:string;token:string}|PrepareCommand|ProbeCommand) | null=null
  private probeId:string|null=null
  private preparationStarted=0
  private preparationDeadline:ReturnType<typeof setTimeout>|null=null
  private monitor:ReturnType<typeof setInterval>|null=null
  private monitoredOnline=false
  private retryPreparationAt=0
  private preparationRecoveryCount=0
  private lastSeen=0
  private extensionVersion: string | null=null
  private connectorInstance:string|null=null
  private preparedOwnerSecUid:string|null=null
  private runDeadline: ReturnType<typeof setTimeout> | null=null
  constructor(private readonly userData: string, private readonly changed: () => void) {
    this.store = new FollowingDirectoryStore(join(userData, 'following-directory.sqlite'))
    const defaultProfile=this.browserProfiles().find(profile=>profile.extensionInstalled)?.directory??this.browserProfiles()[0]?.directory??null
    this.preferences=new FollowingPreferences(userData,this.store.latest()?.ownerSecUid??null,defaultProfile)
    if(this.preferences.value.activeOwnerSecUid)this.store.selectAccount(this.preferences.value.activeOwnerSecUid)
    const latest = this.store.latest()
    this.state = { phase: 'idle', runId: latest?.runId ?? null, message: '点击同步，自动获取新博主资料',
      count: this.store.list().length, ownerSecUid: latest?.ownerSecUid ?? null, extensionDirectory: null,
      reportDirectory: null, databasePath: this.store.path, setupUrl: null,accountStatus:'unchecked',
      readiness:{phase:'offline',preparationId:null,message:'正在准备关注连接器和账号页面…'} }
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
  status(): FollowingSyncState { return { ...this.state, connection:{online:this.extensionVersion===FOLLOWING_VERSION&&Date.now()-this.lastSeen<30000,
    version:this.extensionVersion,expectedVersion:FOLLOWING_VERSION} } }
  private browserProfiles(){return followingBrowserProfiles(join(process.env.LOCALAPPDATA||'','Google','Chrome','User Data'),join(this.userData,'following-extension'))}
  configuration():FollowingConfiguration{
    return {chromeProfile:this.preferences.value.chromeProfile,activeOwnerSecUid:this.preferences.value.activeOwnerSecUid,
      profiles:this.browserProfiles(),accounts:this.store.accounts(),bindingPending:!!this.pendingBinding,connected:!!this.status().connection?.online,
      connectorVersion:this.extensionVersion,expectedVersion:FOLLOWING_VERSION,extensionDirectory:this.state.extensionDirectory}
  }
  hasDirectory():boolean{return !!this.preferences.value.activeOwnerSecUid||!!this.store.latest()}
  private resetAccountState():void{
    this.clearRunDeadline();this.clearPreparationDeadline();this.command=null;this.preparedOwnerSecUid=null;this.retryPreparationAt=0
    this.state={...this.state,phase:'idle',runId:null,count:this.store.list().length,totalCount:this.store.list().length,timing:undefined,reportDirectory:null,
      message:'账号已切换，正在重新准备同步。',ownerSecUid:this.preferences.value.activeOwnerSecUid,accountStatus:'unchecked',
      readiness:{phase:'offline',preparationId:null,message:'正在重新连接并验证所选账号…'}}
    this.changed()
  }
  private requireAccountIdle():void{if(['running','awaiting-config'].includes(this.state.phase))throw new Error('请等待本轮同步完成或取消后再切换账号')}
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
    await this.prepare(true,true)
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
          this.extensionVersion=String(request.headers['x-following-version']||'')
          if(this.extensionVersion!==FOLLOWING_VERSION){
            this.blockPreparation('关注扩展需要更新，请重新加载扩展。','EXTENSION_VERSION_MISMATCH')
            response.writeHead(409);response.end(JSON.stringify({error:'请重新加载新版关注扩展'}));return
          }
          const wasOnline=this.status().connection!.online
          this.lastSeen=Date.now()
          const instance=String(request.headers['x-following-instance']||'')
          const restarted=!!this.connectorInstance&&instance!==this.connectorInstance
          this.connectorInstance=instance
          if(!process.argv.includes('--structured-probe')&&(!wasOnline||restarted)&&!['running','awaiting-config'].includes(this.state.phase))void this.prepare(false,restarted)
          if(!wasOnline)this.changed()
          if(this.waiting&&!this.waiting.writableEnded)this.waiting.end(JSON.stringify({command:null}))
          this.waiting=response
          const deadline=setTimeout(()=>{if(this.waiting===response)this.waiting=null;if(!response.writableEnded)response.end(JSON.stringify({command:null}))},20000)
          response.on('close',()=>{clearTimeout(deadline);if(this.waiting===response)this.waiting=null})
          this.dispatch();return
        }
        if(path==='/status'&&request.method==='GET'){response.end(JSON.stringify(this.status()));return}
        if(path==='/open-folder'&&request.method==='POST'){
          const error=await shell.openPath(this.state.extensionDirectory!);if(error)throw new Error(error)
          response.end(JSON.stringify({message:'扩展目录已打开'}));return
        }
        if(path==='/open-extensions'&&request.method==='POST'){
          this.openChrome('chrome://extensions/');response.end(JSON.stringify({message:'扩展管理页已打开'}));return
        }
        if(request.method!=='POST'||!['/progress','/report','/readiness','/structured-probe','/connector-enroll'].includes(path)){response.writeHead(404);response.end('{}');return}
        let size=0
        const chunks:Buffer[]=[]
        for await(const chunk of request){size+=chunk.length;if(size>512*1024)throw new Error('关注报告过大');chunks.push(chunk)}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
        if(path==='/readiness'){
          if(body.preparationId!==this.state.readiness?.preparationId||!['checking','ready','blocked'].includes(body.phase))throw new Error('准备会话已失效')
          this.lastSeen=Date.now()
          if(body.phase==='ready'){
            if(!['connecting','checking'].includes(this.state.readiness!.phase))throw new Error('准备会话已结束')
            const proof=verifyStructuredSource(body.proof,this.expectedOwner())
            if(!proof.prepared)throw new Error('账号页面准备证明不一致')
            const firstBinding=!this.preferences.value.activeOwnerSecUid&&!this.pendingBinding
            this.store.recordAccount(proof.owner,{label:this.pendingBinding?.label||undefined,chromeProfile:this.preferences.value.chromeProfile,adoptLegacy:firstBinding})
            if(this.pendingBinding||firstBinding){
              this.preferences.value.activeOwnerSecUid=proof.owner.secUid;this.preferences.save();this.store.selectAccount(proof.owner.secUid)
              this.pendingBinding=null
              this.state={...this.state,phase:'idle',runId:null,timing:undefined,count:this.store.list().length,totalCount:this.store.list().length,
                ownerSecUid:proof.owner.secUid,message:'当前账号已绑定，已有账号资料分别保留。'}
            }
            this.preparedOwnerSecUid=proof.owner.secUid
            this.clearPreparationDeadline()
            this.state.readiness={phase:'ready',preparationId:body.preparationId,message:'登录账号身份和关注数据接口已就绪，可以同步关注。'}
            this.state.accountStatus='verified'
            this.retryPreparationAt=0
          }else if(body.phase==='blocked')this.blockPreparation(String(body.message),String(body.code||'PREPARATION_FAILED'))
          else{
            if(!['connecting','checking'].includes(this.state.readiness!.phase))throw new Error('准备会话已结束')
            this.state.readiness={...this.state.readiness!,phase:'checking',message:String(body.message).slice(0,300)}
          }
          await mkdir(join(this.userData,'following-preparation'),{recursive:true})
          const preparationRecord=JSON.stringify({updatedAt:new Date().toISOString(),elapsedMs:performance.now()-this.preparationStarted,...body,readiness:this.state.readiness},null,2)
          await writeFile(join(this.userData,'following-preparation','latest.json'),preparationRecord)
          await writeFile(join(this.userData,'following-preparation',`${body.preparationId}.json`),preparationRecord)
          this.changed();response.end(JSON.stringify({...this.status(),phase:body.phase}));return
        }
        const runId=this.state.runId,reportDirectory=this.state.reportDirectory!
        if(body.runId!==runId||!['awaiting-config','running'].includes(this.state.phase))throw new Error('关注同步会话已失效')
        this.lastSeen=Date.now()
        if(path==='/report'){
          const scope=this.scope
          if(!scope)throw new Error('关注范围已失效')
          const persistenceStart=performance.now()
          const accepted=acceptStructuredFollowingCapture(body.capture,scope)
          const currentIds=new Set(this.store.list().map(item=>new URL(item.profileUrl).pathname.split('/').at(-1)))
          if(accepted.report.creators.some(item=>currentIds.has(item.secUid)))throw new Error('本轮结果包含已保存博主')
          // Archive once before committing; the APP store owns the transaction.
          await writeFile(join(reportDirectory,'following-capture.json'),JSON.stringify(body.capture,null,2),'utf8')
          await writeFile(join(reportDirectory,'following-report.json'),JSON.stringify(accepted.report,null,2),'utf8')
          if(body.browserExecution)await writeFile(join(reportDirectory,'following-browser-execution.json'),JSON.stringify(body.browserExecution,null,2),'utf8')
          if(this.state.runId!==runId||!['awaiting-config','running'].includes(this.state.phase))throw new Error('关注同步已取消或会话已结束')
          const latestIds=new Set(this.store.list().map(item=>new URL(item.profileUrl).pathname.split('/').at(-1)))
          if(accepted.report.creators.some(item=>latestIds.has(item.secUid)))throw new Error('另一请求已经保存了本轮博主')
          const report = this.store.accept(accepted.report)
          const savedRows=this.store.list()
          for(const creator of report.creators){
            const saved=savedRows.find(item=>item.profileUrl===creator.profileUrl)
            if(!saved || saved.nickname!==creator.nickname || saved.avatarUrl!==creator.avatarUrl || saved.signature!==creator.signature)throw new Error('保存后的博主字段不一致')
          }
          this.state.count = report.creators.length; this.state.ownerSecUid = report.ownerSecUid
          this.state.totalCount=savedRows.length
          this.state.timing={...this.state.timing!,acquisitionMs:accepted.acquisitionMs,
            persistenceMs:performance.now()-persistenceStart,savedTotalMs:performance.now()-this.started}
          this.state.phase = 'completed'
          this.state.accountStatus='verified'
          this.state.errorCode=undefined
          this.clearRunDeadline()
          this.state.message = `已新增 ${report.creators.length} 位博主，资料库累计 ${savedRows.length} 位，已有资料保留。`
          if (this.state.diagnostic) this.state.diagnostic = { ...this.state.diagnostic, stage: 'finished' }
          await writeFile(join(reportDirectory,'following-timing.json'),JSON.stringify(this.state.timing,null,2),'utf8')
        } else {
          if (!['running','blocked'].includes(body.phase) || typeof body.message !== 'string') throw new Error('无效关注进度')
          const diagnostic = body.diagnostic === undefined ? undefined : followingDiagnosticSchema.parse(body.diagnostic)
          if(body.phase==='blocked'){
            this.clearRunDeadline()
            if(body.failureCapture)await writeFile(join(reportDirectory,'following-failure.json'),JSON.stringify(body.failureCapture,null,2),'utf8')
            if(body.browserExecution)await writeFile(join(reportDirectory,'following-browser-execution.json'),JSON.stringify(body.browserExecution,null,2),'utf8')
            this.state.errorCode=typeof body.code==='string'?body.code.slice(0,100):'FOLLOWING_CAPTURE_FAILED'
            this.state.accountStatus=body.code==='LOGIN_REQUIRED'?'login-required':'unavailable'
            this.blockPreparation('账号数据接口需要重新检查。',String(body.code||'SYNC_FAILED'))
          }
          this.state.phase = body.phase; this.state.message = body.message.slice(0,500)
          if (diagnostic) this.state.diagnostic = diagnostic
          await writeFile(join(reportDirectory, 'following-progress.json'), JSON.stringify({
            updatedAt: new Date().toISOString(), ...this.status()
          }, null, 2), 'utf8')
        }
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
  async prepare(launchBrowser=true,force=false,automaticRecovery=false):Promise<FollowingSyncState>{
    if(['running','awaiting-config'].includes(this.state.phase))return this.status()
    if(!force&&['connecting','checking'].includes(this.state.readiness?.phase||''))return this.status()
    await this.initialize()
    if(automaticRecovery)this.preparationRecoveryCount++
    else this.preparationRecoveryCount=0
    this.clearPreparationDeadline()
    const preparationId=randomBytes(12).toString('hex')
    this.retryPreparationAt=0
    this.preparationStarted=performance.now()
    this.state.readiness={phase:this.status().connection!.online?'checking':'connecting',preparationId,
      message:this.status().connection!.online?'正在自动检查账号身份和关注数据接口…':'正在自动启动浏览器并连接关注扩展…'}
    this.state.accountStatus='checking'
    const backgroundStart=launchBrowser&&!this.status().connection!.online
    this.command={action:'prepare',preparationId,...this.expectedOwner(),origin:this.origin,token:this.token,backgroundStart}
    this.preparationDeadline=setTimeout(()=>this.blockPreparation(this.status().connection!.online?'账号数据准备超时，请检查登录状态。':'尚未连接到关注扩展，请检查扩展是否启用。','PREPARATION_TIMEOUT'),35000)
    this.dispatch();this.changed()
    if(backgroundStart){
      try{this.openChrome()}catch(error){this.blockPreparation(error instanceof Error?error.message:'Chrome 启动失败','CHROME_START_FAILED')}
    }
    if(!this.monitor)this.monitor=setInterval(()=>{
      const online=this.status().connection!.online
      if(!online&&this.monitoredOnline){
        this.blockPreparation('关注连接器已离线，正在自动恢复连接。','CONNECTOR_OFFLINE')
        void this.prepare(true,true)
      }else if(online&&this.retryPreparationAt&&Date.now()>=this.retryPreparationAt)void this.prepare(false,true,true)
      this.monitoredOnline=online
    },1000)
    return this.status()
  }
  private clearPreparationDeadline():void{if(this.preparationDeadline)clearTimeout(this.preparationDeadline);this.preparationDeadline=null}
  private blockPreparation(message:string,code:string):void{
    this.clearPreparationDeadline()
    if(this.command&&'action' in this.command)this.command=null
    this.state.readiness={...this.state.readiness!,phase:'blocked',message:message.slice(0,300),code}
    this.state.accountStatus=code==='LOGIN_REQUIRED'?'login-required':'unavailable'
    const recoverable=['PAGE_INVALIDATED','CONNECTOR_OFFLINE','OWNER_PAGE_NOT_READY','FOLLOWING_DIALOG_NOT_READY','FOLLOWING_EXTENSION_NOT_READY'].includes(code)
      ||code.includes('message channel closed')
    this.retryPreparationAt=recoverable&&this.preparationRecoveryCount<1?Date.now()+1000:0
    this.changed()
  }
  async start(limit:10|20=20): Promise<FollowingSyncState> {
    if(![10,20].includes(limit))throw new Error('请选择 10 或 20 位新博主')
    if(['awaiting-config','running'].includes(this.state.phase))return this.status()
    if(!this.status().connection!.online||this.state.readiness?.phase!=='ready')throw new Error('关注连接器和账号页面尚未准备好，请等待自动准备完成')
    this.started=performance.now()
    const startedAt=new Date().toISOString()
    await this.initialize()
    const runId=`following-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${randomBytes(8).toString('hex')}`
    const reportDirectory=join(this.userData,'following-runs',runId)
    await mkdir(reportDirectory,{recursive:true})
    const ownerNickname=this.ownerNickname()
    this.scope={runId,limit,ownerNickname,ownerSecUid:this.preferences.value.activeOwnerSecUid??this.preparedOwnerSecUid,excludeSecUids:this.store.list().map(item=>new URL(item.profileUrl).pathname.split('/').at(-1)!)}
    this.state={...this.state,phase:'running',runId,reportDirectory,count:0,ownerSecUid:null,requestedCount:limit,totalCount:this.store.list().length,
      message:`正在后台获取另外 ${limit} 位博主…`,timing:{startedAt},diagnostic:undefined,accountStatus:'checking',errorCode:undefined}
    this.command={...this.scope,origin:this.origin,token:this.token}
    this.clearRunDeadline()
    this.runDeadline=setTimeout(()=>{
      if(this.state.runId!==runId||this.state.phase!=='running')return
      this.command=null;this.state.phase='blocked'
      this.state.accountStatus='unavailable'
      this.state.errorCode='FOLLOWING_TIMEOUT'
      this.blockPreparation('同步超时，正在重新检查账号页面。','FOLLOWING_TIMEOUT')
      this.state.message=this.status().connection!.online?'本轮读取未完成，请确认抖音登录状态后重试。':'关注连接未就绪，请连接扩展后重试。'
      this.changed()
    },30000)
    this.dispatch()
    if(!this.status().connection!.online)this.openChrome()
    this.changed();return this.status()
  }
  private dispatch():void{
    if(!this.command||!this.waiting||this.waiting.writableEnded)return
    const response=this.waiting,command=this.command
    this.waiting=null;this.command=null
    if(!('action' in command))this.state.timing={...this.state.timing!,dispatchMs:performance.now()-this.started}
    response.end(JSON.stringify({command}))
  }
  configure():FollowingSyncState{this.openChrome(this.state.setupUrl!);return this.status()}
  login():FollowingSyncState{this.openChrome('https://www.douyin.com/user/self');this.retryPreparationAt=Date.now()+1000;return this.status()}
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
    this.state.phase='cancelled';this.state.accountStatus='unchecked';this.state.message='本轮关注同步已取消，已有目录保留';this.changed()
    return this.status()
  }
  async rendered(runId:string,loadedCount:number):Promise<FollowingSyncState>{
    if(this.state.phase!=='completed'||this.state.runId!==runId||loadedCount!==this.state.totalCount)return this.status()
    if(!this.state.timing!.displayedTotalMs){
      const displayedTotalMs=performance.now()-this.started
      this.state.timing={...this.state.timing!,displayedTotalMs,averageDisplayedMs:displayedTotalMs/this.state.count}
      await writeFile(join(this.state.reportDirectory!,'following-timing.json'),JSON.stringify(this.state.timing,null,2),'utf8')
      this.changed()
    }
    return this.status()
  }
  async stop():Promise<void>{
    this.clearRunDeadline()
    this.clearPreparationDeadline()
    if(this.monitor)clearInterval(this.monitor)
    const server=this.server;this.server=null
    if(server)await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})
    await rm(join(this.userData,'following-bridge.json'),{force:true})
    this.store.close()
  }
}
