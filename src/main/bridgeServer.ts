import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  browserCollectionEnvelopeSchema,
  type BrowserCollectionEnvelope,
  type BrowserEventReceipt
} from '../shared/contracts'

export type BrowserCommand = {
  contract: 'browser-command/v1'
  commandId: string
  action: 'collect_following' | 'collect_creator_works' | 'collect_work_comments'
  payload: Record<string, unknown>
  createdAt: string
}

function readJsonBody(request: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        request.destroy()
        reject(new Error('Bridge payload exceeds 8 MiB'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(body)
}

export class BridgeServer extends EventEmitter {
  private server: Server | null = null
  private readonly secret = randomBytes(32).toString('base64url')
  private commands: BrowserCommand[] = []
  private envelopeHandler: ((envelope: BrowserCollectionEnvelope) => BrowserEventReceipt) | null = null
  private lastSeenAt = 0
  private port = 0

  constructor(private readonly userDataDir: string) {
    super()
  }

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to bind browser bridge')
    this.port = address.port
    mkdirSync(this.userDataDir, { recursive: true })
    writeFileSync(join(this.userDataDir, 'bridge.json'), JSON.stringify({
      contract: 'native-bridge-discovery/v1',
      url: `http://127.0.0.1:${this.port}`,
      secret: this.secret,
      pid: process.pid,
      createdAt: new Date().toISOString()
    }), { encoding: 'utf8', mode: 0o600 })
  }

  async stop(): Promise<void> {
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    rmSync(join(this.userDataDir, 'bridge.json'), { force: true })
  }

  queueCommand(command: BrowserCommand): void {
    if (!this.commands.some((item) => item.commandId === command.commandId)) this.commands.push(command)
  }

  setEnvelopeHandler(handler: (envelope: BrowserCollectionEnvelope) => BrowserEventReceipt): void {
    if (this.envelopeHandler) throw new Error('Browser envelope handler is already registered')
    this.envelopeHandler = handler
  }

  isOnline(): boolean {
    return Date.now() - this.lastSeenAt < 15_000
  }

  private authorized(request: IncomingMessage): boolean {
    const value = request.headers['x-signaldesk-secret']
    if (typeof value !== 'string') return false
    const left = createHash('sha256').update(value).digest()
    const right = createHash('sha256').update(this.secret).digest()
    return left.length === right.length && left.equals(right)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      sendJson(response, 403, { error: 'Loopback only' })
      return
    }
    if (!this.authorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized' })
      return
    }
    this.lastSeenAt = Date.now()
    this.emit('presence', true)
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${this.port}`)
      if (request.method === 'GET' && url.pathname === '/v1/commands') {
        const command = this.commands.shift() ?? null
        sendJson(response, 200, { command, serverTime: new Date().toISOString() })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/events') {
        const body = await readJsonBody(request)
        const parsed = browserCollectionEnvelopeSchema.safeParse(body)
        if (!parsed.success) {
          const commandId = body && typeof body === 'object' && 'commandId' in body && typeof body.commandId === 'string'
            ? body.commandId
            : null
          const error = '连接器返回的数据结构无效，已拒绝入库；请重新加载新版连接器后恢复任务'
          if (commandId) this.emit('status', { type: 'blocked', commandId, message: error, at: new Date().toISOString() })
          sendJson(response, 202, {
            contract: 'browser-event-receipt/v1',
            accepted: false,
            commandId,
            code: 'invalid-envelope',
            error
          } satisfies BrowserEventReceipt)
          return
        }
        if (!this.envelopeHandler) throw new Error('Browser envelope handler is not registered')
        const receipt = this.envelopeHandler(parsed.data satisfies BrowserCollectionEnvelope)
        if (receipt.accepted) this.emit('envelope', parsed.data)
        else this.emit('status', {
          type: 'blocked',
          commandId: receipt.commandId,
          message: receipt.error || '桌面端拒绝了未通过校验的采集结果',
          at: new Date().toISOString()
        })
        sendJson(response, 202, receipt)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/status') {
        const body = await readJsonBody(request, 128 * 1024) as Record<string, unknown>
        this.emit('status', body)
        sendJson(response, 202, { accepted: true })
        return
      }
      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
