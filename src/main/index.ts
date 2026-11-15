import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, screen } from 'electron'
import { AppDatabase } from './database'
import { BridgeServer } from './bridgeServer'
import { TaskRunner } from './taskRunner'
import { CredentialStore } from './credentialStore'
import {CloudProfiles} from './cloudProfiles'
import {CloudConnectionService} from './cloudConnection'
import {cloudConnectionInputSchema} from '../shared/cloudConnection'
import {DoubaoSpeechService} from './doubaoSpeech'
import { ExportService } from './exportService'
import { CloudService } from './cloudService'
import { WorkerClient } from './workerClient'
import {VideoContentRuntimeClient} from './videoContentRuntime'
import {VideoContentService} from './videoContentService'
import {VideoWorkflowService} from './videoWorkflowService'
import {VideoWorkshopService} from './videoWorkshopService'
import {createWorkshopBrowserDownloader} from './workshopBrowser'
import {WORKSHOP_DEEP_MODEL} from '../shared/workshopDeep'
import { IsolatedPilotService } from './isolatedPilot'
import { FollowingSyncService } from './followingSync'
import {createHash} from 'node:crypto'
import {FeishuCreatorProbe} from './feishuCreatorProbe'
import {DesktopWindowController,type WindowLog} from './desktopWindow'
import {windowLifecycleLog} from './windowLifecycleLog'
import type {CreatorRefreshScope} from '../shared/creatorRefreshPolicy'

app.setName('Signal Desk')
if (process.env.SIGNAL_DESK_SMOKE_TEST === '1') app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let bridge: BridgeServer | null = null
let runner: TaskRunner | null = null
let worker: WorkerClient | null = null
let videoRuntime:VideoContentRuntimeClient|null=null
let videoContent:VideoContentService|null=null
let videoWorkflow:VideoWorkflowService|null=null
let videoWorkshop:VideoWorkshopService|null=null
let doubaoSpeech:DoubaoSpeechService|null=null
let isolatedPilot = new IsolatedPilotService()
let followingSync: FollowingSyncService | null = null
let feishuProbe: FeishuCreatorProbe | null = null
let logWindow:WindowLog=()=>{}
const desktopWindows=new DesktopWindowController({create:()=>{mainWindow=createWindow();return mainWindow},
  workAreas:()=>screen.getAllDisplays().map(display=>display.workArea),log:(event,details)=>logWindow(event,details),
  inactive:process.env.SIGNAL_DESK_SMOKE_TEST==='1'})

function requireServices(): { database: AppDatabase; bridge: BridgeServer; runner: TaskRunner; worker: WorkerClient } {
  if (!database || !bridge || !runner || !worker) throw new Error('Application services are not ready')
  return { database, bridge, runner, worker }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f4f1ea',
    title: 'Signal Desk',
    autoHideMenuBar: true,
    show: process.env.SIGNAL_DESK_SMOKE_TEST !== '1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Unable to load preload script ${preloadPath}:`, error)
  })
  window.once('closed',()=>{if(mainWindow===window)mainWindow=null})
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function registerIpc(profiles:CloudProfiles, exporter: ExportService, cloud: CloudService): void {
  ipcMain.handle('video-workshop:get',()=>videoWorkshop!.view())
  ipcMain.handle('video-workshop:process',(_event,input)=>videoWorkshop!.start(input))
  ipcMain.handle('video-workshop:cancel',(_event,id)=>videoWorkshop!.cancel(id))
  ipcMain.handle('video-workshop:deep',(_event,input)=>videoWorkshop!.deep(input))
  ipcMain.handle('video-workshop:frame',(_event,input)=>videoWorkshop!.frame(input))
  ipcMain.handle('video-workshop:deep-displayed',(_event,input)=>videoWorkshop!.displayed(input))
  const connections=new CloudConnectionService(input=>profiles.connectionProvider(input))
  ipcMain.handle('cloud:connection-test',(_event,input)=>{
    const request=cloudConnectionInputSchema.parse(input)
    return request.kind==='doubao'?doubaoSpeech!.testConnection(request.expectedRevision):connections.test(request)
  })
  ipcMain.handle('siliconflow:get',()=>profiles.getSiliconFlow())
  ipcMain.handle('siliconflow:save',(_event,input)=>{
    const value=profiles.saveSiliconFlow(input)
    mainWindow?.webContents.send('data:changed',{source:'siliconflow'})
    return value
  })
  ipcMain.handle('doubao-speech:get',()=>doubaoSpeech!.view())
  ipcMain.handle('doubao-speech:save',(_event,input)=>doubaoSpeech!.save(input))
  ipcMain.handle('doubao-speech:prepare',async()=>{await doubaoSpeech!.prepareAudio();shell.showItemInFolder(doubaoSpeech!.audioPath)})
  ipcMain.handle('doubao-speech:start',(_event,url)=>doubaoSpeech!.start(url))
  ipcMain.handle('doubao-speech:flash-start',(_event,input)=>doubaoSpeech!.startFlash(input))
  ipcMain.handle('doubao-speech:flash-displayed',(_event,input)=>doubaoSpeech!.markFlashDisplayed(input))
  ipcMain.handle('doubao-speech:resume',()=>doubaoSpeech!.resume())
  ipcMain.handle('doubao-speech:stop',()=>doubaoSpeech!.stop())
  let workerSetup: Promise<Record<string, unknown>> | null = null
  ipcMain.handle('dashboard:get', () => {
    const services = requireServices()
    const summary = services.database.getSummary(services.bridge.isOnline())
    if (followingSync?.hasDirectory()) {
      summary.followingCount = followingSync.store.list().length
      summary.lastSyncAt = followingSync.store.latest()?.collectedAt??null
    }
    return summary
  })
  ipcMain.handle('inbox:list', (_event, options) => requireServices().database.getInbox(options || {}))
  ipcMain.handle('work:get', (_event, workId: number) => requireServices().database.getWorkDetail(workId))
  ipcMain.handle('inbox:update', (_event, workId: number, state: 'unread' | 'read' | 'later' | 'saved', feedback = 0) => {
    requireServices().database.updateInboxState(workId, state, feedback)
    return { ok: true }
  })
  ipcMain.handle('creators:list', (_event, search = '') => {
    const existing = requireServices().database.getCreators(String(search))
    return followingSync?.hasDirectory()
      ? [...followingSync.listCreators(String(search)), ...existing.filter((entry) => entry.isDemo)] : existing
  })
  ipcMain.handle('creators:update', (_event, creatorId: number, input,ownerSecUid?:string) => {
    if (creatorId < 0 && followingSync) return followingSync.updateCreatorAnnotation(ownerSecUid,creatorId,input)
    requireServices().database.updateCreator(creatorId, input)
    feishuProbe?.dataChanged()
    return { ok: true }
  })
  ipcMain.handle('creators:database-get',()=>{if(!followingSync)throw Error('博主数据库尚未就绪');return followingSync.getCreatorDatabase()})
  ipcMain.handle('creators:priority-update',(_event,input)=>{if(!followingSync)throw Error('博主资料库尚未就绪');return followingSync.updateCreatorPriority(input)})
  ipcMain.handle('creators:interest-update',(_event,input)=>{if(!followingSync)throw Error('博主资料库尚未就绪');return followingSync.updateCreatorInterest(input)})
  ipcMain.handle('creators:database-update',(_event,input)=>{if(!followingSync)throw Error('博主数据库尚未就绪');return followingSync.updateCreatorDatabase(input)})
  ipcMain.handle('feishu:state',()=>{if(!feishuProbe)throw Error('飞书服务尚未就绪');return feishuProbe.state()})
  ipcMain.handle('feishu:save',(_event,input)=>{if(!feishuProbe)throw Error('飞书服务尚未就绪');return feishuProbe.save(input)})
  ipcMain.handle('feishu:probe',(_event,input)=>{if(!feishuProbe)throw Error('飞书服务尚未就绪');return feishuProbe.probe(input)})
  ipcMain.handle('feishu:sync',(_event,input)=>{if(!feishuProbe)throw Error('飞书服务尚未就绪');return feishuProbe.syncAll(input)})
  ipcMain.handle('feishu:automatic',(_event,input)=>{if(!feishuProbe)throw Error('飞书服务尚未就绪');return feishuProbe.setAutomatic(input)})
  ipcMain.handle('jobs:list', () => requireServices().database.getJobs())
  ipcMain.handle('following:refresh', (_event, resume = false) => {
    if (!followingSync) throw new Error('关注同步服务未就绪')
    return followingSync.start(undefined,Boolean(resume))
  })
  ipcMain.handle('following:basic-start', () => followingSync?.startBasic())
  ipcMain.handle('following:basic-cancel', () => followingSync?.cancelBasic())
  ipcMain.handle('following:status', () => followingSync?.status())
  ipcMain.handle('creators:activity-refresh', (_event,creatorId?:number,resume=false,creatorIds?:number[],scope?:CreatorRefreshScope) => {
    if(creatorId!==undefined&&(!Number.isSafeInteger(creatorId)||creatorId>=0))throw new Error('博主目录身份无效')
    return followingSync?.startActivity(creatorId,Boolean(resume),creatorIds,scope)
  })
  ipcMain.handle('creators:activity-cancel', () => followingSync?.cancelActivity())
  ipcMain.handle('creators:baseline-start', (_event,resume=false,creatorIds?:number[]) => followingSync?.startActivity(undefined,Boolean(resume),creatorIds,undefined,true))
  ipcMain.handle('creators:work-timeline',(_event,owner:string,creatorId:number)=>followingSync!.creatorWorkTimeline(owner,creatorId))
  ipcMain.handle('video-information:evidence',(_event,creatorId:number)=>followingSync?.startVideoInformation(creatorId,true))
  ipcMain.handle('video-content:interest',(_event,owner:string,workId:string,interest:import('../shared/videoContent').VideoInterest)=>videoWorkflow!.interest(owner,workId,interest))
  ipcMain.handle('video-workflow:classify',(_event,input)=>videoWorkflow!.startTriage(input))
  ipcMain.handle('video-workflow:start',(_event,input)=>videoWorkflow!.startProcessing(input))
  ipcMain.handle('video-workflow:review',(_event,owner:string,id:string,input)=>videoWorkflow!.review(owner,id,input))
  ipcMain.handle('video-workflow:body',(_event,owner:string,id:string,text:string)=>videoWorkflow!.reviseBody(owner,id,text))
  ipcMain.handle('video-workflow:inbox',(_event,owner:string,id:string,state:import('../shared/videoWorkflow').MaterialInboxState)=>videoWorkflow!.inboxState(owner,id,state))
  ipcMain.handle('video-workflow:cancel',(_event,owner:string)=>videoWorkflow!.cancel(owner))
  ipcMain.handle('video-workflow:resume',(_event,owner:string,id:string)=>videoWorkflow!.resume(owner,id))
  ipcMain.handle('video-workflow:frame',(_event,owner:string,id:string,frameId:string)=>videoWorkflow!.frame(owner,id,frameId))
  ipcMain.handle('video-workflow:rendered',(_event,owner:string,id:string,ids:string[])=>videoWorkflow!.rendered(owner,id,ids))
  ipcMain.handle('video-content:detail',(_event,owner:string,workId:string)=>followingSync?.videoContentDetail(owner,workId))
  ipcMain.handle('video-content:discover',(_event,input)=>{
    const batch=followingSync!.discoverVideos(input)
    videoWorkflow!.trackAcquisition(batch.ownerSecUid,batch.id,'discover')
    return batch
  })
  ipcMain.handle('video-content:discovery-cancel',(_event,owner:string)=>followingSync?.cancelDiscovery(owner))
  ipcMain.handle('video-content:discovery-resume',(_event,owner:string,id:string)=>{
    followingSync!.requireOwner(owner);const batch=followingSync!.discoverVideos(null,id)
    videoWorkflow!.trackAcquisition(owner,batch.id,'discover');return batch
  })
  ipcMain.handle('video-content:process',(_event,input)=>{if(videoWorkflow?.running)throw Error('分类或素材处理正在运行');return videoContent?.start(input)})
  ipcMain.handle('video-content:cancel',(_event,owner:string)=>videoContent?.cancel(owner))
  ipcMain.handle('video-content:resume',(_event,owner:string,id:string)=>{if(videoWorkflow?.running)throw Error('分类或素材处理正在运行');return videoContent?.resume(owner,id)})
  ipcMain.handle('video-content:runtime',()=>videoRuntime?.status())
  ipcMain.handle('video-content:frame',(_event,owner:string,workId:string,frameId:string)=>videoContent?.frame(owner,workId,frameId))
  ipcMain.handle('video-content:estimate',(_event,owner:string,ids:string[],vision:boolean)=>videoContent?.estimate(owner,ids,vision))
  ipcMain.handle('video-content:rendered',(_event,owner:string,id:string,ids:string[])=>videoContent?.rendered(owner,id,ids))
  ipcMain.handle('video-information:status',()=>followingSync?.videoInformationStatus())
  ipcMain.handle('video-information:library',(_event,options)=>({...followingSync?.videoLibraryView(options),runtime:videoRuntime?.status()}))
  ipcMain.handle('video-information:list',(_event,creatorId:number)=>followingSync?.videoInformationView(creatorId))
  ipcMain.handle('video-information:rendered',(_event,runId:string)=>followingSync?.videoInformationRendered(runId))
  ipcMain.handle('video-information:start',(_event,creatorId:number)=>{
    if(!Number.isSafeInteger(creatorId)||creatorId>=0)throw Error('博主身份无效')
    const state=followingSync!.startVideoInformation(creatorId)
    if(state.ownerSecUid&&state.runId)videoWorkflow!.trackAcquisition(state.ownerSecUid,state.runId,'collect')
    return state
  })
  ipcMain.handle('video-information:cancel',()=>followingSync?.cancelVideoInformation())
  ipcMain.handle('creators:activity-rendered', (_event,runId:string) => followingSync?.activity.rendered(runId))
  ipcMain.handle('following:configuration', () => followingSync?.configuration())
  ipcMain.handle('following:configuration-save', (_event,input) => followingSync?.saveConfiguration(input))
  ipcMain.handle('following:account-switch', (_event,secUid:string) => followingSync?.switchAccount(secUid))
  ipcMain.handle('following:account-bind', (_event,input) => followingSync?.bindCurrentAccount(input))
  ipcMain.handle('following:account-bind-cancel', () => followingSync?.cancelBinding())
  ipcMain.handle('following:configure', () => followingSync?.configure())
  ipcMain.handle('following:login', () => followingSync?.login())
  ipcMain.handle('following:prepare', () => followingSync?.prepare(true,true))
  ipcMain.handle('following:structured-probe', () => followingSync?.probeStructured())
  ipcMain.handle('following:cancel', () => followingSync?.cancel())
  ipcMain.handle('following:rendered', (_event,runId:string,loadedCount:number) => followingSync?.rendered(runId,loadedCount))
  ipcMain.handle('works:sync', (_event, creatorUid: string, worksPerCreator: number) => requireServices().runner.startCreatorWorksSync(creatorUid, worksPerCreator))
  ipcMain.handle('sync:comments', (_event, workId: string, commentsPerWork: number) => requireServices().runner.startCommentsSync(workId, commentsPerWork))
  ipcMain.handle('isolated-pilot:catalog', () => isolatedPilot.catalog())
  ipcMain.handle('isolated-pilot:prepare', (_event, creatorUid: string) => isolatedPilot.prepare(creatorUid))
  ipcMain.handle('isolated-pilot:status', () => isolatedPilot.status())
  ipcMain.handle('isolated-pilot:cancel', () => isolatedPilot.cancel())
  ipcMain.handle('isolated-pilot:open-extension', async () => {
    const path = isolatedPilot.extensionDirectory()
    if (!path) throw new Error('请先准备一轮隔离试跑')
    await shell.openPath(path)
    return { path }
  })
  ipcMain.handle('isolated-pilot:open-report', async () => {
    const path = isolatedPilot.reportDirectory()
    if (!path) throw new Error('目前没有隔离报告目录')
    await shell.openPath(path)
    return { path }
  })
  ipcMain.handle('sync:pause', () => {
    requireServices().database.cancelActiveJobs()
    return { ok: true }
  })
  ipcMain.handle('sync:resume', (_event, jobId: number) => {
    const resumed = requireServices().database.resumeJob(Number(jobId))
    if (!resumed) throw new Error('该任务当前不可恢复，其他任务未受影响')
    return { ok: true, resumed, jobId: Number(jobId) }
  })
  ipcMain.handle('demo:seed', () => {
    requireServices().database.seedDemo()
    return { ok: true }
  })
  ipcMain.handle('demo:summary', () => requireServices().database.getDemoDataSummary())
  ipcMain.handle('demo:clear', () => requireServices().database.clearDemoData())
  ipcMain.handle('settings:get', () => profiles.getSettings())
  ipcMain.handle('settings:save', (_event, input: Record<string, unknown>) => {
    const saved=profiles.save(input)
    mainWindow?.webContents.send('data:changed',{source:'settings'})
    return saved
  })
  ipcMain.handle('cloud:estimate', (_event, limit = 100) => cloud.estimateBatch(Number(limit)))
  ipcMain.handle('cloud:run', (_event, batchId: number) => cloud.runApprovedBatch(Number(batchId)))
  ipcMain.handle('worker:preflight', () => requireServices().worker.preflight())
  ipcMain.handle('worker:setup', (event) => {
    if (!workerSetup) {
      const sender = event.sender
      workerSetup = requireServices().worker.setup((message) => {
        if (!sender.isDestroyed()) sender.send('worker:setup-progress', { message })
      }).finally(() => { workerSetup = null })
    }
    return workerSetup
  })
  ipcMain.handle('export:all', async (_event, anonymize = true) => {
    const choice = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Signal Desk 导出目录' })
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true }
    return { canceled: false, ...exporter.exportAll(choice.filePaths[0], Boolean(anonymize)) }
  })
  ipcMain.handle('connector:open-folder', async () => {
    const path = app.isPackaged ? join(process.resourcesPath, 'browser-connector') : join(app.getAppPath(), 'browser-connector')
    await shell.openPath(path)
    return { path }
  })
  ipcMain.handle('external:open', async (_event, url: string) => {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol')
    await shell.openExternal(parsed.toString())
    return { ok: true }
  })
}

async function startDesktop(): Promise<void> {
  await app.whenReady()
  const userData = app.getPath('userData')
  logWindow=windowLifecycleLog(userData)
  logWindow('desktop-starting')
  if (process.env.SIGNAL_DESK_SMOKE_TEST === '1') isolatedPilot = new IsolatedPilotService({ tempRoot: join(userData, 'isolated-r8') })
  database = new AppDatabase(join(userData, 'signal-desk.sqlite'))
  followingSync = new FollowingSyncService(userData, event => {
    if(!event)videoWorkflow?.acquisitionChanged()
    if(mainWindow&&!mainWindow.webContents.isDestroyed())mainWindow.webContents.send('data:changed', event??{ source: 'following-directory' })
    feishuProbe?.dataChanged()
  })
  if(process.env.SIGNAL_DESK_SMOKE_TEST !== '1')await followingSync.initialize()
  feishuProbe = new FeishuCreatorProbe(() => ({view: followingSync!.getCreatorDatabase(), creators: followingSync!.listCreators()}),
    owner => new CredentialStore(join(userData, 'credentials', `feishu-${createHash('sha256').update(owner).digest('hex')}.bin`)), undefined,
    () => {if(mainWindow&&!mainWindow.webContents.isDestroyed())mainWindow.webContents.send('data:changed',{source:'feishu'})})
  if(process.env.SIGNAL_DESK_SMOKE_TEST !== '1')feishuProbe.startAutomatic()
  bridge = new BridgeServer(userData)
  await bridge.start()
  worker = new WorkerClient(join(userData, 'runtime'))
  runner = new TaskRunner(database, bridge, worker, join(userData, 'cache'))
  runner.start()
  // Keep the original credential path for text analysis so existing encrypted keys remain valid after upgrade.
  const profiles=new CloudProfiles(database,ref=>{
    if(ref!=='legacy-text'&&ref!=='legacy-vision'&&!/^[a-f0-9-]{36}$/.test(ref))throw Error('云端密钥引用无效')
    return new CredentialStore(join(userData,'credentials',ref==='legacy-text'?'cloud-api-key.bin':ref==='legacy-vision'?'vision-api-key.bin':`cloud-profile-${ref}.bin`))
  },()=>{
    if(videoContent?.running||videoWorkflow?.running||doubaoSpeech?.running||database!.db.prepare("SELECT 1 FROM analysis_batches WHERE state='running' LIMIT 1").get())throw Error('内容处理正在运行，请完成或取消后再修改云端方案')
  })
  const textCredentials={getApiKey:()=>profiles.getApiKey('text')}
  const visionCredentials={getApiKey:()=>profiles.getApiKey('vision')}
  const exporter = new ExportService(database)
  const cloud = new CloudService(database, { text: textCredentials, vision: visionCredentials }, join(userData, 'cache'))
  videoRuntime=new VideoContentRuntimeClient(userData,join(app.isPackaged?process.resourcesPath:app.getAppPath(),'worker','video_content_worker.py'))
  videoWorkshop=new VideoWorkshopService(userData,videoRuntime,()=>mainWindow?.webContents.send('data:changed',{source:'video-workshop'}),{
    download:createWorkshopBrowserDownloader(followingSync),deep:{provider:()=>profiles.workflowProvider(WORKSHOP_DEEP_MODEL,true),
      transcribe:(media,durationMs,signal)=>doubaoSpeech!.transcribeWorkshop(media,durationMs,signal)}})
  videoContent=new VideoContentService(followingSync,videoRuntime,userData,(kind='text')=>{
    const settings=database!.getSettings(),apiKey=(kind==='text'?textCredentials:visionCredentials).getApiKey(),baseUrl=kind==='text'?settings.textBaseUrl:settings.visionBaseUrl,model=kind==='text'?settings.textModel:settings.visionModel
    if(!baseUrl||!model||!apiKey)throw Error(`请先在设置配置云端${kind==='text'?'文本':'视觉'}服务`)
    return {kind:'cloud',baseUrl,model,apiKey,...(kind==='text'?{protocol:settings.textApiProtocol}:{})}
  },()=>mainWindow?.webContents.send('data:changed',{source:'video-content'}),()=>database!.getSettings())
  doubaoSpeech=new DoubaoSpeechService(database.db,userData,ref=>{
    if(!/^[a-f0-9-]{36}$/.test(ref))throw Error('豆包凭据引用无效')
    return new CredentialStore(join(userData,'credentials',`doubao-speech-${ref}.bin`))
  },followingSync,videoRuntime,()=>{
    const state=followingSync!.status()
    if(videoContent?.running||videoWorkflow?.running||followingSync!.videoDiscovery.running||[state.phase,state.basic?.phase,state.activity?.phase,state.videoInformation?.phase].includes('running'))throw Error('请等待当前内容或采集任务完成')
  },()=>mainWindow?.webContents.send('data:changed',{source:'doubao-speech'}))
  videoWorkflow=new VideoWorkflowService(followingSync,videoRuntime,userData,(model,vision)=>profiles.workflowProvider(model,vision),()=>doubaoSpeech!,()=>{
    if(videoContent?.running||doubaoSpeech?.running)throw Error('请等待当前内容处理完成')
  },()=>mainWindow?.webContents.send('data:changed',{source:'video-workflow'}))
  followingSync.contentRunning=()=>!!videoContent?.running||!!doubaoSpeech?.running||!!videoWorkflow?.running||!!videoWorkshop?.running
  registerIpc(profiles, exporter, cloud)
  bridge.on('envelope', () => mainWindow?.webContents.send('data:changed', { source: 'browser' }))
  bridge.on('status', () => mainWindow?.webContents.send('data:changed', { source: 'connector' }))
  desktopWindows.start()
  if(process.env.SIGNAL_DESK_SMOKE_TEST !== '1'&&!process.argv.includes('--structured-probe'))void followingSync.prepare()
  app.on('activate', () => {
    desktopWindows.open()
  })
}

// A single writer per userData directory prevents two desktop instances creating the same remote row.
if(app.requestSingleInstanceLock())void startDesktop().catch(error=>{
  logWindow('startup-failed',{name:error instanceof Error?error.name:'UnknownError'})
  dialog.showErrorBox('Signal Desk 启动失败','APP 未能完成初始化，请重新打开。\n'+(error instanceof Error?error.message:String(error)))
  app.quit()
})
else app.quit()
app.on('second-instance',()=>{logWindow('second-instance');desktopWindows.open()})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  desktopWindows.stop()
  logWindow('desktop-quitting')
  feishuProbe?.stop()
  doubaoSpeech?.close()
  videoContent?.stop()
  videoWorkflow?.stop()
  videoWorkshop?.stop()
  void followingSync?.stop()
  void isolatedPilot.stop()
  runner?.stop()
  worker?.stop()
  void bridge?.stop()
  database?.close()
  runner = null
  worker = null
  bridge = null
  database = null
})
