// Local operator helper for an explicitly launched Signal Desk review build.
// It talks only to the loopback DevTools port and the app's existing IPC bridge.
const action = process.argv[2] || 'catalog'
const creatorUid = process.argv[3] || ''
if (!['catalog', 'status', 'prepare', 'cancel'].includes(action)) throw new Error('Unknown action')
if (action === 'prepare' && !/^[A-Za-z0-9._-]{1,240}$/.test(creatorUid)) throw new Error('Invalid creator UID')

const pages = await (await fetch('http://127.0.0.1:9227/json')).json()
const page = pages.find((entry) => entry.type === 'page' && entry.title === 'Signal Desk')
if (!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/')) throw new Error('Review app not available')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
try {
  const expression = action === 'catalog'
    ? 'window.signalDesk.getIsolatedPilotCatalog()'
    : action === 'status'
      ? 'window.signalDesk.getIsolatedPilotStatus()'
      : action === 'cancel'
        ? 'window.signalDesk.cancelIsolatedPilot()'
        : `window.signalDesk.prepareIsolatedPilot(${JSON.stringify(creatorUid)})`
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('App IPC timed out')), 10_000)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      clearTimeout(timer)
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
      } else resolve(message.result.result.value)
    })
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: `${expression}.then((value) => JSON.stringify({ ok: true, value })).catch((error) => JSON.stringify({ ok: false, error: String(error) }))`,
      awaitPromise: true, returnByValue: true
    } }))
  })
  const result = JSON.parse(value)
  if (!result.ok) throw new Error(result.error)
  console.log(JSON.stringify(result.value, null, 2))
} finally { socket.close() }
