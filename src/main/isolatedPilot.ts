import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { STRUCTURED_SYNC_AVAILABLE } from '../shared/featureFlags'
import type { IsolatedPilotCatalog, IsolatedPilotState } from '../shared/contracts'
import { homepagePilotReportSchema } from '../shared/homepagePilotReport'
import { IsolatedSyncRun } from './isolatedSyncRun'

const ID = /^[A-Za-z0-9._-]{1,240}$/
const CATALOG_APPLICATION_ID = 0x53445238

type VerifiedCreator = IsolatedPilotCatalog['creators'][number]

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配隔离控制器端口')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

export class IsolatedPilotService {
  private child: ChildProcess | null = null
  private session: IsolatedSyncRun | null = null
  private cancelled = false
  private lastTasks: Array<{ kind: string; state: string; message: string }> = []
  private current: { runId: string; runDirectory: string; extensionDirectory: string;
    creatorUid: string; creatorName: string; preparedAt: string } | null = null

  constructor(private readonly options: { tempRoot?: string; resourceRoot?: string;
    connectorRoot?: string; runtimeExecutable?: string } = {}) {}

  private get r8Root(): string { return this.options.tempRoot ?? join(tmpdir(), 'signal-desk-r8') }
  private get catalogPath(): string { return join(this.r8Root, 'verified-catalog.sqlite') }
  private get resourceRoot(): string {
    return this.options.resourceRoot ?? (app.isPackaged ? process.resourcesPath : app.getAppPath())
  }

  catalog(): IsolatedPilotCatalog {
    if (!existsSync(this.catalogPath)) return { available: false, ownerSecUid: null, creators: [], reason: '尚无已验证的隔离作者目录' }
    const db = new DatabaseSync(this.catalogPath, { readOnly: true })
    try {
      const applicationId = Number(db.prepare('PRAGMA application_id').get()!.application_id)
      if (applicationId !== CATALOG_APPLICATION_ID) throw new Error('隔离作者目录标识无效')
      const owner = db.prepare('SELECT sec_uid,verified_at,source FROM owners LIMIT 1').get() as {
        sec_uid: string; verified_at: string; source: string
      } | undefined
      if (!owner || !ID.test(owner.sec_uid) || !Number.isFinite(Date.parse(owner.verified_at))
        || owner.source !== 'browser-following-route') throw new Error('隔离目录缺少已验证 owner')
      const rows = db.prepare(`SELECT uid,sec_uid AS secUid,nickname,profile_url AS profileUrl,
        following_state AS followingState FROM creators WHERE owner_sec_uid=?
        AND following_state IN ('active','stale')
        AND identity_source='following-list-structured-response' ORDER BY id`).all(owner.sec_uid) as Array<{
          uid: string; secUid: string; nickname: string; profileUrl: string; followingState: 'active' | 'stale'
        }>
      const creators: VerifiedCreator[] = rows.filter((row) => ID.test(row.uid) && ID.test(row.secUid)
        && row.profileUrl === `https://www.douyin.com/user/${encodeURIComponent(row.secUid)}`)
      return { available: creators.length > 0, ownerSecUid: owner.sec_uid, creators,
        reason: creators.length ? null : '目录中没有身份已验证且仍可同步的作者' }
    } finally { db.close() }
  }

  async prepare(creatorUid: string): Promise<IsolatedPilotState> {
    if (STRUCTURED_SYNC_AVAILABLE) throw new Error('隔离试跑仅在正式同步能力门关闭时可用')
    if (!ID.test(creatorUid)) throw new Error('作者 ID 无效')
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      throw new Error('已有一轮隔离试跑正在等待结果，请先完成该轮')
    }
    const catalog = this.catalog()
    const creator = catalog.creators.find((entry) => entry.uid === creatorUid)
    if (!creator || !catalog.ownerSecUid) throw new Error('请选择当前已验证目录中的作者')
    this.session?.close()
    this.session = null
    this.cancelled = false
    this.lastTasks = []
    await mkdir(this.r8Root, { recursive: true })
    const runId = `r8-homepage-client-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
    const runDirectory = join(this.r8Root, runId)
    const extensionDirectory = join(this.r8Root, 'client-homepage-extension')
    await mkdir(runDirectory, { recursive: true })
    await mkdir(extensionDirectory, { recursive: true })
    const pilotSource = app.isPackaged && !this.options.resourceRoot
      ? join(this.resourceRoot, 'isolated-pilot', 'homepage-extension')
      : join(this.resourceRoot, 'poc', 'r8', 'homepage-extension')
    const connectorSource = this.options.connectorRoot ?? join(this.resourceRoot, 'browser-connector', 'extension')
    for (const filename of ['manifest.json', 'background.js', 'popup.html', 'popup.js']) {
      await copyFile(join(pilotSource, filename), join(extensionDirectory, filename))
    }
    for (const filename of ['network-observer.js', 'r8-homepage-pilot-core.js', 'r8-homepage-pilot-presentation.js']) {
      await copyFile(join(connectorSource, filename), join(extensionDirectory, filename))
    }
    const port = await reservePort()
    const token = randomBytes(32).toString('hex')
    await writeFile(join(extensionDirectory, 'session-config.js'),
      `export const PILOT_CONFIG = Object.freeze(${JSON.stringify({
        runId, controllerOrigin: `http://127.0.0.1:${port}`, reportDirectory: runDirectory, token
      })})\n`)
    await writeFile(join(runDirectory, 'START_HERE.txt'),
      `Signal Desk 隔离试跑：${creator.nickname}\n\n在 Chrome 扩展管理页加载或重新加载此固定目录：\n${extensionDirectory}\n\n打开隔离扩展弹窗并点击开始。最多访问一个作者主页和一个作品页；不主动请求接口、评论、媒体或云端服务。结果保存在此目录，不写正式数据库。\n`)
    const controller = app.isPackaged && !this.options.resourceRoot
      ? join(this.resourceRoot, 'isolated-pilot', 'homepage-pilot-controller.mjs')
      : join(this.resourceRoot, 'poc', 'r8', 'homepage-pilot-controller.mjs')
    const child = spawn(this.options.runtimeExecutable ?? process.execPath, [controller, '--output', runDirectory, '--port', String(port),
      '--token', token, '--owner-sec-uid', catalog.ownerSecUid, '--selected-creator-uid', creator.uid,
      '--catalog-path', this.catalogPath], {
      windowsHide: true, stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    this.child = child
    let launchError = false
    child.once('error', () => { launchError = true })
    this.current = { runId, runDirectory, extensionDirectory,
      creatorUid: creator.uid, creatorName: creator.nickname, preparedAt: new Date().toISOString() }
    let ready = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (launchError || child.exitCode !== null || child.signalCode !== null) break
      if (existsSync(join(runDirectory, 'controller-session.json'))) { ready = true; break }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!ready) {
      child.kill()
      this.current = null
      this.child = null
      throw new Error('隔离控制器未能启动，请检查运行时是否支持 node:sqlite')
    }
    try {
      this.session = new IsolatedSyncRun(join(runDirectory, 'isolated-sync.sqlite'), runId, catalog.ownerSecUid, creator)
    } catch (error) {
      await this.stop()
      throw error
    }
    return this.status()
  }

  async status(): Promise<IsolatedPilotState> {
    if (!this.current) return { phase: 'idle', runId: null, creatorName: null,
      extensionDirectory: null, reportDirectory: null, result: null }
    const reportPath = join(this.current.runDirectory, 'pilot-report.json')
    if (existsSync(reportPath)) {
      const report = homepagePilotReportSchema.parse(JSON.parse(await readFile(reportPath, 'utf8')))
      if (report.runId !== this.current.runId || !['verified', 'candidate-only', 'blocked'].includes(report.result.status)) {
        throw new Error('隔离报告与当前 run 不匹配')
      }
      this.session?.acceptReport(report)
      return { phase: 'finished', runId: this.current.runId, creatorName: this.current.creatorName,
        extensionDirectory: this.current.extensionDirectory, reportDirectory: this.current.runDirectory,
        tasks: this.session?.jobs() ?? this.lastTasks,
        result: { status: report.result.status as 'verified' | 'candidate-only' | 'blocked',
          reason: report.result.reason, navigationCount: report.result.navigationCount,
          activeApiRequests: report.result.activeApiRequests,
          candidateCount: report.result.candidates.length,
          workId: report.result.verifiedWork?.workId ?? null,
          title: report.result.verifiedWork?.title ?? null,
          workProofHash: report.result.workProof?.projectionSha256 ?? null,
          detailProofHash: report.result.detailProof?.projectionSha256 ?? null } }
    }
    return { phase: this.cancelled ? 'cancelled' : this.child && this.child.exitCode === null && this.child.signalCode === null ? 'prepared' : 'failed',
      runId: this.current.runId, creatorName: this.current.creatorName,
      tasks: this.session?.jobs() ?? this.lastTasks,
      extensionDirectory: this.current.extensionDirectory,
      reportDirectory: this.current.runDirectory, result: null }
  }

  async stop(): Promise<void> {
    this.lastTasks = this.session?.jobs() ?? this.lastTasks
    this.session?.close()
    this.session = null
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
      child.kill()
    })
  }

  async cancel(): Promise<IsolatedPilotState> {
    if (this.session) this.session.database.updateJob(this.session.worksJobId, 'paused', { message: '用户结束本轮隔离试跑' })
    this.cancelled = true
    await this.stop()
    return this.status()
  }

  reportDirectory(): string | null { return this.current?.runDirectory ?? null }
  extensionDirectory(): string | null { return this.current?.extensionDirectory ?? null }
}
