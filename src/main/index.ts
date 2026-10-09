import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, screen } from 'electron'
import { AppDatabase } from './database'
import { BridgeServer } from './bridgeServer'
import { TaskRunner } from './taskRunner'
import { CredentialStore } from './credentialStore'
import { ExportService } from './exportService'
import { CloudService } from './cloudService'
import { WorkerClient } from './workerClient'
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

function registerIpc(textCredentials: CredentialStore, visionCredentials: CredentialStore, exporter: ExportService, cloud: CloudService): void {
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
  ipcMain.handle('creators:update', (_event, creatorId: number, input) => {
    if (creatorId < 0 && followingSync) followingSync.store.update(creatorId, input)
    else requireServices().database.updateCreator(creatorId, input)
    feishuProbe?.dataChanged()
    return { ok: true }
  })
  ipcMain.handle('creators:database-get',()=>{if(!followingSync)throw Error('博主数据库尚未就绪');return followingSync.getCreatorDatabase()})
  ipcMain.handle('creators:priority-update',(_event,input)=>{if(!followingSync)throw Error('博主资料库尚未就绪');return followingSync.updateCreatorPriority(input)})
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
  ipcMain.handle('settings:get', () => ({
    ...requireServices().database.getSettings(),
    hasTextApiKey: textCredentials.hasApiKey(),
    hasVisionApiKey: visionCredentials.hasApiKey()
  }))
  ipcMain.handle('settings:save', (_event, input: Record<string, unknown>) => {
    const { textApiKey, visionApiKey, ...settings } = input
    if (typeof textApiKey === 'string' && textApiKey.trim()) textCredentials.setApiKey(textApiKey.trim())
    if (typeof visionApiKey === 'string' && visionApiKey.trim()) visionCredentials.setApiKey(visionApiKey.trim())
    return {
      ...requireServices().database.saveSettings(settings),
      hasTextApiKey: textCredentials.hasApiKey(),
      hasVisionApiKey: visionCredentials.hasApiKey()
    }
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
  followingSync = new FollowingSyncService(userData, () => {
    if(mainWindow&&!mainWindow.webContents.isDestroyed())mainWindow.webContents.send('data:changed', { source: 'following-directory' })
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
  const textCredentials = new CredentialStore(join(userData, 'credentials', 'cloud-api-key.bin'))
  const visionCredentials = new CredentialStore(join(userData, 'credentials', 'vision-api-key.bin'))
  const exporter = new ExportService(database)
  const cloud = new CloudService(database, { text: textCredentials, vision: visionCredentials }, join(userData, 'cache'))
  registerIpc(textCredentials, visionCredentials, exporter, cloud)
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
