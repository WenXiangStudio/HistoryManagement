import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { FollowingDirectoryStore } from './followingDirectoryStore'
import { followingDiagnosticSchema, type FollowingSyncState } from '../shared/followingDirectory'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (entry) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[entry]!)
export class FollowingSyncService {
  readonly store: FollowingDirectoryStore
  private server: Server | null = null
  private token = ''
  private state: FollowingSyncState
  constructor(private readonly userData: string, private readonly changed: () => void) {
    this.store = new FollowingDirectoryStore(join(userData, 'following-directory.sqlite'))
    const latest = this.store.latest()
    this.state = { phase: 'idle', runId: latest?.runId ?? null, message: '点击开始同步，在 Chrome 确认登录后读取前 10 位关注博主',
      count: this.store.list().length, ownerSecUid: latest?.ownerSecUid ?? null, extensionDirectory: null,
      reportDirectory: null, databasePath: this.store.path, setupUrl: null }
  }
  status(): FollowingSyncState { return { ...this.state } }
  async start(): Promise<FollowingSyncState> {
    if (['awaiting-config', 'running'].includes(this.state.phase)) {
      if (this.state.setupUrl) this.openChrome(this.state.setupUrl)
      return this.status()
    }
    await this.stopServer()
    const runId = `following-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0,14)}-${randomBytes(8).toString('hex')}`
    const extensionDirectory = join(this.userData, 'following-extension')
    const reportDirectory = join(this.userData, 'following-runs', runId)
    const source = app.isPackaged ? join(process.resourcesPath, 'browser-connector', 'following-extension')
      : join(app.getAppPath(), 'browser-connector', 'following-extension')
    await cp(source, extensionDirectory, { recursive: true })
    await mkdir(reportDirectory, { recursive: true })
    this.token = randomBytes(32).toString('hex')
    this.state = { phase: 'awaiting-config', runId, message: '已打开 Chrome 配置页。请加载关注扩展、确认抖音已登录，然后在配置页点击开始读取。',
      count: 0, ownerSecUid: null, extensionDirectory, reportDirectory, databasePath: this.store.path, setupUrl: null }
    this.server = createServer((request, response) => {
      void (async () => {
        const address = this.server?.address()
        const origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
        const path = new URL(request.url || '/', origin).pathname
        const allowedOrigin = request.headers.origin
        if (allowedOrigin && allowedOrigin !== origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(allowedOrigin)) {
          response.writeHead(403); response.end(); return
        }
        if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
        response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type')
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
        if (request.method === 'GET' && path === `/following-setup/${runId}`) {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(this.guide(origin)); return
        }
        if (request.headers.authorization !== `Bearer ${this.token}`) { response.writeHead(403); response.end(); return }
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (path === '/status' && request.method === 'GET') { response.end(JSON.stringify(this.status())); return }
        if (path === '/open-folder' && request.method === 'POST') {
          const error = await shell.openPath(extensionDirectory)
          if (error) throw new Error(`扩展目录打开失败：${error}`)
          response.end(JSON.stringify({ message: '已请求打开扩展目录。若资源管理器未置前，请复制页面中的路径到“加载已解压的扩展程序”。' })); return
        }
        if (path === '/open-extensions' && request.method === 'POST') { this.openChrome('chrome://extensions/'); response.end(JSON.stringify({ message: '已在当前 Chrome 用户打开扩展管理页，请查找对应标签页。' })); return }
        if (request.method !== 'POST' || !['/progress', '/report'].includes(path)) { response.writeHead(404); response.end('{}'); return }
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) { size += chunk.length; if (size > 128 * 1024) throw new Error('关注报告过大'); chunks.push(chunk) }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (body.runId !== runId || !['awaiting-config','running'].includes(this.state.phase)) throw new Error('关注同步会话已失效')
        if (path === '/report') {
          const report = this.store.accept(body)
          this.state.count = report.creators.length; this.state.ownerSecUid = report.ownerSecUid
          const partial = report.creators.length < 10 && (report.contract === 'signaldesk-visible-following/v1' || report.hasMore)
          this.state.phase = partial ? 'blocked' : 'completed'
          this.state.message = partial ? `已保存 ${report.creators.length} 位关注博主基础信息，本轮还未达到 10 位。`
            : `已保存 ${report.creators.length} 位关注博主的头像、昵称和主页链接，可返回 APP 查看。`
          if (this.state.diagnostic) this.state.diagnostic = { ...this.state.diagnostic, stage: 'finished' }
          await writeFile(join(reportDirectory, 'following-report.json'), JSON.stringify(report, null, 2), 'utf8')
        } else {
          if (!['running','blocked'].includes(body.phase) || typeof body.message !== 'string') throw new Error('无效关注进度')
          const diagnostic = body.diagnostic === undefined ? undefined : followingDiagnosticSchema.parse(body.diagnostic)
          this.state.phase = body.phase; this.state.message = body.message.slice(0,500)
          if (diagnostic) this.state.diagnostic = diagnostic
          await writeFile(join(reportDirectory, 'following-progress.json'), JSON.stringify({
            updatedAt: new Date().toISOString(), ...this.status()
          }, null, 2), 'utf8')
        }
        this.changed(); response.end(JSON.stringify(this.status()))
      })().catch((error) => { if (!response.headersSent) response.writeHead(400); response.end(JSON.stringify({ error: error instanceof Error ? error.message : '关注同步失败' })) })
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('关注同步服务未启动')
    this.state.setupUrl = `http://127.0.0.1:${address.port}/following-setup/${runId}`
    this.openChrome(this.state.setupUrl)
    this.changed()
    return this.status()
  }
  private openChrome(url: string): void {
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter((value): value is string => Boolean(value)).map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    const executable = candidates.find(existsSync)
    if (!executable) throw new Error('未找到 Chrome，请安装后重试')
    let profileName: string | null = null
    try {
      const statePath = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Local State')
      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      const value = state.profile?.last_used
      if (typeof value === 'string' && /^(Default|Profile \d+)$/.test(value)) profileName = value
    } catch { /* Chrome uses its normal profile selection when metadata is unavailable. */ }
    const child = spawn(executable, [...(profileName ? [`--profile-directory=${profileName}`] : []), '--new-tab', url], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => { this.state.phase = 'blocked'; this.state.message = 'Chrome 启动失败'; this.changed() })
    child.unref()
  }
  private guide(origin: string): string {
    const config = JSON.stringify({ origin, token: this.token, runId: this.state.runId }).replace(/</g, '\\u003c')
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Signal Desk · 关注同步配置</title>
      <style>body{font:17px system-ui;max-width:850px;margin:70px auto;background:#f4f1ea;color:#26352d;line-height:1.8}button{padding:12px 22px;margin:10px 12px 10px 0;cursor:pointer;font-size:17px}code{overflow-wrap:anywhere}#status{padding:20px;background:white;border-radius:12px}</style>
      <h1>同步当前账号的前 10 位关注博主</h1><p>只保存博主头像、昵称、公开简介和主页链接。关注列表按网页默认顺序读取。</p>
      <ol><li>首次使用：在 Chrome 扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，加载下面的目录。<br><code>${escapeHtml(this.state.extensionDirectory!)}</code></li>
      <li>在抖音确认已登录。若页面出现登录或安全验证，请先人工处理。</li><li>加载扩展后刷新本配置页，再点击“配置完成，开始读取”。扩展会自动打开自己的主页和关注列表，结果自动返回 APP。</li></ol>
      <button id="folder">打开扩展目录</button><button id="extensions">打开扩展管理页</button><button id="login">打开抖音确认登录</button>
      <p><button id="start" disabled>等待关注扩展连接…</button><button id="refresh">扩展已加载，刷新连接</button></p><p id="action-result" role="status"></p><div id="status">等待配置。本页可保持打开。</div>
      <script id="following-config" type="application/json">${config}</script><script>
      const config=JSON.parse(document.getElementById('following-config').textContent);
      const request=async(path)=>{try{const response=await fetch(config.origin+path,{method:'POST',headers:{authorization:'Bearer '+config.token}});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');document.getElementById('action-result').textContent=result.message||'已打开';}catch(error){document.getElementById('action-result').textContent=String(error.message)}};
      document.getElementById('folder').onclick=()=>request('/open-folder');
      document.getElementById('extensions').onclick=()=>request('/open-extensions');
      document.getElementById('login').onclick=()=>window.open('https://www.douyin.com/user/self');
      document.getElementById('refresh').onclick=()=>location.reload();
      document.getElementById('start').onclick=()=>{document.getElementById('start').disabled=true;window.postMessage({type:'signaldesk.following.start',config},location.origin)};
      window.addEventListener('message',event=>{if(event.source!==window||event.origin!==location.origin)return;if(event.data?.type==='signaldesk.following.ready'){document.getElementById('start').textContent='配置完成，开始读取';document.getElementById('start').disabled=false}if(event.data?.type==='signaldesk.following.error'){document.getElementById('status').textContent=event.data.error;document.getElementById('start').disabled=false}});
      setInterval(()=>{window.postMessage({type:'signaldesk.following.ping'},location.origin);fetch(config.origin+'/status',{headers:{authorization:'Bearer '+config.token}}).then(r=>r.json()).then(s=>{document.getElementById('status').textContent=s.message;if(['completed','blocked','cancelled'].includes(s.phase))document.getElementById('start').disabled=true}).catch(()=>{document.getElementById('status').textContent='APP 已关闭，请返回 APP 重新开始'})},1500);
      </script></html>`
  }
  async cancel(): Promise<FollowingSyncState> {
    this.state.phase = 'cancelled'; this.state.message = '本轮关注同步已取消，已有目录保留'; this.changed()
    return this.status()
  }
  private async stopServer(): Promise<void> {
    const server = this.server; this.server = null
    if (server) await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
  }
  async stop(): Promise<void> { await this.stopServer(); this.store.close() }
}
