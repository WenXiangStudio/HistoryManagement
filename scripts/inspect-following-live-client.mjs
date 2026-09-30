// Operator access is restricted to the explicitly launched review APP, never Chrome's profile.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const action = process.argv[2] || 'status'
if (!['status','start','creators','screenshot','stop'].includes(action)) throw new Error('Unknown action')
const pages = await fetch('http://127.0.0.1:9227/json').then((response) => response.json())
const page = pages.find((entry) => entry.type === 'page' && entry.title === 'Signal Desk')
if (!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/')) throw new Error('Review APP is unavailable')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let id = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
})
function send(method, params) {
  const requestId = ++id
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('APP inspection timed out')) }, 10000)
    pending.set(requestId, (value) => { clearTimeout(timeout); value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result) })
  })
  socket.send(JSON.stringify({ id: requestId, method, params }))
  return result
}
try {
  if (action === 'stop') {
    await send('Runtime.evaluate', { expression: `Promise.all([window.signalDesk.cancelFollowingSync(),window.signalDesk.pauseSync(),window.signalDesk.cancelIsolatedPilot()])`, awaitPromise: true })
  }
  if (action === 'start') {
    await send('Runtime.evaluate', { expression: `document.querySelector('[data-testid="start-following-sync"]').click()` })
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  if (action === 'creators' || action === 'screenshot') {
    await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('博主资料库')).click()` })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (action === 'screenshot' && process.argv[4] !== undefined) {
      const index = Number(process.argv[4])
      if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error('Invalid screenshot card index')
      await send('Runtime.evaluate', { expression: `document.querySelectorAll('.creator-card')[${index}]?.scrollIntoView({block:'start'})` })
    }
  }
  const result = await send('Runtime.evaluate', { expression: `(async()=>JSON.stringify({
    state:await window.signalDesk.getFollowingSyncStatus(),summary:await window.signalDesk.getDashboard(),
    creators:await window.signalDesk.listCreators(),
    ui:{text:document.querySelector('[data-testid="following-sync-status"]')?.innerText,
      cards:[...document.querySelectorAll('.creator-card')].map(card=>({nickname:card.querySelector('h3')?.innerText,
        profileUrl:card.querySelector('.creator-profile-link')?.getAttribute('href'),
        avatarLoaded:!!card.querySelector('.avatar img')?.naturalWidth}))}
  }))()`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  console.log(result.result.value)
  if (action === 'screenshot') {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const target = resolve(process.argv[3] || 'docs/evidence/following-client-20260930/app-creators.png')
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(screenshot.data, 'base64'))
    console.log(`Screenshot: ${target}`)
  }
} finally { socket.close() }
