import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('browser-connector/extension/background.js', 'utf8')
const ports = []
const stateChanges = []
let runtimeMessageListener = null

function createPort() {
  let disconnectListener = null
  let messageListener = null
  const port = {
    onMessage: { addListener(listener) { messageListener = listener } },
    onDisconnect: { addListener(listener) { disconnectListener = listener } },
    postMessage() {},
    disconnect() { disconnectListener?.() },
    emitMessage(message) { return messageListener?.(message) }
  }
  ports.push(port)
  return port
}

const chrome = {
  runtime: {
    lastError: null,
    connectNative: createPort,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { runtimeMessageListener = listener } }
  },
  storage: { local: { set(value) { stateChanges.push(structuredClone(value.connectorState)) } } },
  tabs: {}
}

const context = vm.createContext({
  chrome,
  URL,
  Date,
  Error,
  setTimeout: () => 1,
  clearTimeout: () => {}
})
vm.runInContext(source, context, { filename: 'background.js' })

if (ports.length !== 1 || !runtimeMessageListener) throw new Error('Connector did not initialize the Native Host')

let firstRetryState = null
runtimeMessageListener({ type: 'connector.connect' }, {}, (state) => { firstRetryState = state })
if (ports.length !== 2 || !firstRetryState?.connected) {
  throw new Error(`Manual reconnect did not replace the existing port: ${JSON.stringify(firstRetryState)}`)
}

let secondRetryState = null
runtimeMessageListener({ type: 'connector.connect' }, {}, (state) => { secondRetryState = state })
if (ports.length !== 3 || !secondRetryState?.connected) {
  throw new Error(`Repeated manual reconnect lost the replacement port: ${JSON.stringify(secondRetryState)}`)
}

ports[2].emitMessage({ ok: true, body: { command: null } })
const latestState = stateChanges.at(-1)
if (!latestState?.desktopOnline || latestState.message !== '桌面端在线') {
  throw new Error(`Replacement port could not reach the online state: ${JSON.stringify(latestState)}`)
}

ports[2].emitMessage({
  ok: true,
  status: 202,
  body: {
    contract: 'browser-event-receipt/v1',
    accepted: false,
    commandId: 'rejected-command',
    code: 'invalid-collection-proof',
    error: '关注列表来源证明无效'
  }
})
const rejectedState = stateChanges.at(-1)
if (!rejectedState?.desktopOnline || rejectedState.busy || rejectedState.message !== '关注列表来源证明无效') {
  throw new Error(`Desktop rejection was misreported as offline: ${JSON.stringify(rejectedState)}`)
}

ports[2].emitMessage({ ok: false, status: 422, body: { error: '数据结构无效' }, error: 'HTTP error' })
const reachedDesktopError = stateChanges.at(-1)
if (!reachedDesktopError?.desktopOnline || reachedDesktopError.message !== '数据结构无效') {
  throw new Error(`HTTP response from the desktop was misreported as offline: ${JSON.stringify(reachedDesktopError)}`)
}

ports[2].emitMessage({ ok: false, error: 'Native Host 已断开' })
const offlineState = stateChanges.at(-1)
if (offlineState?.desktopOnline || offlineState.message !== 'Native Host 已断开') {
  throw new Error(`Native Host transport failure was not reported as offline: ${JSON.stringify(offlineState)}`)
}

const followingUrl = 'https://www.douyin.com/user/self?showTab=follow'
let existingTab = { id: 17, url: followingUrl, status: 'complete' }
let updateCount = 0
let createCount = 0
chrome.tabs.query = async () => [existingTab]
chrome.tabs.update = async (_id, patch) => {
  updateCount += 1
  existingTab = { ...existingTab, ...patch }
  return existingTab
}
chrome.tabs.create = async (patch) => {
  createCount += 1
  return { id: 18, ...patch }
}

await vm.runInContext(`openOrReuseTab(${JSON.stringify(followingUrl)})`, context)
if (updateCount !== 0 || createCount !== 0) {
  throw new Error('Reusing the already-open following route reloaded the page and would close its relationship dialog')
}

existingTab = { id: 17, url: 'https://www.douyin.com/user/self?showTab=work', status: 'complete' }
await vm.runInContext(`openOrReuseTab(${JSON.stringify(followingUrl)})`, context)
if (updateCount !== 1 || existingTab.url !== followingUrl) {
  throw new Error('A different self-profile route was not navigated to the following target')
}

let observerAttached = false
context.__attachObserver = async (tabId) => {
  if (tabId !== 17) throw new Error(`Unexpected observed tab ${tabId}`)
  observerAttached = true
}
existingTab = { id: 17, url: 'https://www.douyin.com/user/self?showTab=work', status: 'complete' }
chrome.tabs.update = async (_id, patch) => {
  if (!observerAttached) throw new Error('Navigation occurred before the Network Observer attached')
  existingTab = { ...existingTab, ...patch }
  return existingTab
}
await vm.runInContext(`openOrReuseTab(${JSON.stringify(followingUrl)}, { beforeNavigation: __attachObserver })`, context)
if (!observerAttached || existingTab.url !== followingUrl) {
  throw new Error('The connector did not enforce attach-before-navigation')
}

console.log('Browser connector reconnect, receipt, attach-before-navigation and relationship-dialog-preserving tab reuse OK')
