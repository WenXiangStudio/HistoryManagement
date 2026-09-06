import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

const require = createRequire(import.meta.url)

function workerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'worker', 'media_worker.py')
    : join(app.getAppPath(), 'worker', 'media_worker.py')
}

function runtimePaths(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg') as { path: string }
  const ffprobe = require('@ffprobe-installer/ffprobe') as { path: string }
  if (!ffmpeg.path || !ffprobe.path) throw new Error('Bundled FFmpeg runtime is unavailable')
  return { ffmpeg: ffmpeg.path, ffprobe: ffprobe.path }
}

function findOnPath(filename: string): string | null {
  const value = process.env.PATH || process.env.Path || ''
  for (const directory of value.split(';').filter(Boolean)) {
    const candidate = join(directory, filename)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export class WorkerClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private carry = ''
  private sequence = 0
  private pending = new Map<number, PendingRequest>()

  constructor(private readonly runtimeRoot: string) {}

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs = 30 * 60_000): Promise<T> {
    const child = this.ensureProcess()
    const id = ++this.sequence
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async processMedia(params: { workId: string; mediaUrl: string; cacheRoot: string; asrModel: string }): Promise<Record<string, unknown>> {
    const paths = runtimePaths()
    return await this.request<Record<string, unknown>>('process_media', {
      ...params,
      ...paths,
      maxFrames: 120,
      maxBytes: 2 * 1024 ** 3,
      keepEvidence: true
    })
  }

  async preflight(): Promise<Record<string, unknown>> {
    return await this.request<Record<string, unknown>>('preflight', runtimePaths(), 30_000)
  }

  async setup(onProgress?: (message: string) => void): Promise<Record<string, unknown>> {
    this.stop()
    const venv = join(this.runtimeRoot, 'python')
    const bootstrap = this.bootstrapPython()
    onProgress?.('正在建立受控 Python 3.11 环境')
    await this.runProcess(bootstrap.executable, [...bootstrap.args, '-m', 'venv', venv])
    const venvPython = join(venv, 'Scripts', 'python.exe')
    onProgress?.('正在安装本地 ASR 与 OCR 依赖')
    await this.runProcess(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '-r', join(workerPath(), '..', 'requirements.txt')])
    onProgress?.('正在验证本地 AI 运行环境')
    return await this.preflight()
  }

  stop(): void {
    if (this.process) this.process.kill()
    this.process = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Media worker stopped'))
    }
    this.pending.clear()
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process
    const script = workerPath()
    if (!existsSync(script)) throw new Error(`Media worker not found: ${script}`)
    const runtime = this.workerPython()
    const executable = runtime.executable
    const args = [...runtime.args, script]
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => {
      const sanitized = chunk.toString('utf8').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      if (sanitized.trim()) console.warn('[media-worker]', sanitized.trim().slice(-1000))
    })
    child.on('error', (error) => {
      this.process = null
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`无法启动本地 AI 工作器：${error.message}`))
      }
      this.pending.clear()
    })
    child.on('exit', (code) => {
      this.process = null
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`Media worker exited with code ${code}`))
      }
      this.pending.clear()
    })
    this.process = child
    return child
  }

  private onData(data: string): void {
    this.carry += data
    const lines = this.carry.split(/\r?\n/)
    this.carry = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line) as { id: number; result?: unknown; error?: { message?: string } }
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message || 'Media worker failed'))
        else pending.resolve(message.result)
      } catch (error) {
        console.warn('[media-worker] invalid response', error)
      }
    }
  }

  private workerPython(): { executable: string; args: string[] } {
    const venvPython = join(this.runtimeRoot, 'python', 'Scripts', 'python.exe')
    if (existsSync(venvPython)) return { executable: venvPython, args: [] }
    return this.bootstrapPython()
  }

  private bootstrapPython(): { executable: string; args: string[] } {
    const configured = process.env.SIGNALDESK_PYTHON311
    if (configured && existsSync(configured)) return { executable: configured, args: [] }
    const bundled = app.isPackaged ? join(process.resourcesPath, 'python311', 'python.exe') : ''
    if (bundled && existsSync(bundled)) return { executable: bundled, args: [] }
    const localAppData = process.env.LOCALAPPDATA || ''
    const launcher = localAppData ? join(localAppData, 'Programs', 'Python', 'Launcher', 'py.exe') : ''
    if (launcher && existsSync(launcher)) return { executable: launcher, args: ['-3.11'] }
    const standardInstall = localAppData ? join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe') : ''
    if (standardInstall && existsSync(standardInstall)) return { executable: standardInstall, args: [] }
    const pathLauncher = findOnPath('py.exe')
    if (pathLauncher) return { executable: pathLauncher, args: ['-3.11'] }
    return { executable: 'py', args: ['-3.11'] }
  }

  private async runProcess(executable: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let error = ''
      child.stderr.on('data', (chunk: Buffer) => { error = `${error}${chunk.toString('utf8')}`.slice(-4000) })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(error || `${executable} exited with code ${code}`)))
    })
  }
}
