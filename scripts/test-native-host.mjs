import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hostPath = process.env.SIGNALDESK_NATIVE_HOST_EXE || join(process.cwd(), 'browser-connector', 'native-host', 'bin', 'SignalDesk.NativeHost.exe')
const testRoot = mkdtempSync(join(tmpdir(), 'signal-desk-native-host-'))

async function exchange(message, appData) {
  const child = spawn(hostPath, ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'], {
    cwd: process.cwd(),
    env: { ...process.env, APPDATA: appData },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length)
  child.stdin.write(Buffer.concat([header, payload]))
  let stdout = Buffer.alloc(0)
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]) })
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000) })
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Native Host response timed out. ${stderr}`)), 15_000)
    const inspect = () => {
      if (stdout.length < 4) return
      const length = stdout.readUInt32LE(0)
      if (length <= 0 || length > 8 * 1024 * 1024) {
        clearTimeout(timer)
        reject(new Error(`Invalid response length: ${length}`))
        return
      }
      if (stdout.length < length + 4) return
      clearTimeout(timer)
      resolve(JSON.parse(stdout.subarray(4, length + 4).toString('utf8')))
    }
    child.stdout.on('data', inspect)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => {
      if (stdout.length < 4) {
        clearTimeout(timer)
        reject(new Error(`Native Host exited before responding (${code}). ${stderr}`))
      }
    })
  })
  child.stdin.end()
  setTimeout(() => { if (!child.killed) child.kill() }, 250)
  return result
}

try {
  const offlineRoot = join(testRoot, 'offline')
  mkdirSync(offlineRoot, { recursive: true })
  const offline = await exchange({ type: 'poll' }, offlineRoot)
  if (!offline || typeof offline !== 'object' || offline.ok !== false) {
    throw new Error(`Expected a framed offline response, received: ${JSON.stringify(offline)}`)
  }

  const secret = 'native-host-test-secret'
  const server = createServer((request, response) => {
    if (request.headers['x-signaldesk-secret'] !== secret) {
      response.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    if (request.method === 'GET' && request.url === '/v1/commands') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ command: null, serverTime: '2026-08-27T00:00:00.000Z' }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/events') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const payload = JSON.parse(body)
        response.writeHead(202, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          contract: 'browser-event-receipt/v1',
          accepted: false,
          commandId: payload.commandId,
          code: 'invalid-collection-proof',
          error: 'mock proof rejection'
        }))
      })
      return
    }
    response.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock bridge did not bind to TCP')
  const onlineRoot = join(testRoot, 'online')
  const discoveryDir = join(onlineRoot, 'Signal Desk')
  mkdirSync(discoveryDir, { recursive: true })
  writeFileSync(join(discoveryDir, 'bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${address.port}`, secret }))
  const online = await exchange({ type: 'poll' }, onlineRoot)
  if (!online || typeof online !== 'object' || online.ok !== true || online.body?.command !== null) {
    throw new Error(`Expected a successful loopback proxy response, received: ${JSON.stringify(online)}`)
  }
  const receipt = await exchange({ type: 'event', payload: { commandId: 'proof-test' } }, onlineRoot)
  await new Promise((resolve) => server.close(resolve))
  if (receipt?.ok !== true || receipt.status !== 202 || receipt.body?.contract !== 'browser-event-receipt/v1' || receipt.body?.accepted !== false || receipt.body?.commandId !== 'proof-test') {
    throw new Error(`Expected the event receipt to be proxied unchanged, received: ${JSON.stringify(receipt)}`)
  }
  if (process.env.SIGNALDESK_LIVE_APPDATA) {
    const live = await exchange({ type: 'poll' }, process.env.SIGNALDESK_LIVE_APPDATA)
    if (!live || typeof live !== 'object' || live.ok !== true || !live.body?.serverTime) {
      throw new Error(`Expected a live desktop bridge response, received: ${JSON.stringify(live)}`)
    }
  }
  console.log(`Native Messaging offline framing, authenticated proxy, event receipt${process.env.SIGNALDESK_LIVE_APPDATA ? ' and live desktop bridge' : ''} OK`)
} finally {
  rmSync(testRoot, { recursive: true, force: true })
}
