const HOST_NAME = 'com.signaldesk.bridge'
let nativePort = null
let pollTimer = null
let pendingCommand = null
let state = { connected: false, desktopOnline: false, busy: false, message: '等待连接桌面端', lastSeenAt: null }

function updateState(patch) {
  state = { ...state, ...patch }
  chrome.storage.local.set({ connectorState: state })
}

function connectNative({ force = false } = {}) {
  if (force && nativePort) {
    const previousPort = nativePort
    nativePort = null
    previousPort.disconnect()
  }
  if (nativePort) return
  clearTimeout(pollTimer)
  updateState({ connected: false, desktopOnline: false, busy: false, message: '正在连接桌面端…' })
  try {
    const port = chrome.runtime.connectNative(HOST_NAME)
    nativePort = port
    updateState({ connected: true, message: 'Native Host 已连接' })
    port.onMessage.addListener(handleNativeMessage)
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return
      const message = chrome.runtime.lastError?.message || 'Native Host 已断开'
      nativePort = null
      pendingCommand = null
      updateState({ connected: false, desktopOnline: false, busy: false, message })
      clearTimeout(pollTimer)
      pollTimer = setTimeout(connectNative, 5000)
    })
    schedulePoll(100)
  } catch (error) {
    updateState({ connected: false, desktopOnline: false, message: String(error) })
    pollTimer = setTimeout(connectNative, 5000)
  }
}

function schedulePoll(delay = 1800) {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(() => {
    if (!nativePort || state.busy) {
      schedulePoll()
      return
    }
    nativePort.postMessage({ type: 'poll' })
    schedulePoll()
  }, delay)
}

async function handleNativeMessage(message) {
  if (!message?.ok) {
    const reachedDesktop = Number.isInteger(message?.status)
    const detail = message?.body?.error || message?.error || (reachedDesktop ? '桌面端拒绝了请求' : '桌面端未运行')
    pendingCommand = null
    updateState({ desktopOnline: reachedDesktop, busy: false, message: detail })
    return
  }
  const body = message.body
  if (body?.contract === 'browser-event-receipt/v1') {
    const command = pendingCommand
    pendingCommand = null
    updateState({
      desktopOnline: true,
      busy: false,
      lastSeenAt: new Date().toISOString(),
      message: body.accepted
        ? `桌面端已接收：${labelFor(command?.action || '采集结果')}`
        : body.error || '桌面端拒绝了未通过校验的采集结果'
    })
    return
  }
  updateState({ desktopOnline: true, lastSeenAt: new Date().toISOString(), message: state.busy ? state.message : '桌面端在线' })
  const command = body?.command
  if (!command || state.busy) return
  pendingCommand = command
  updateState({ busy: true, message: `正在执行：${labelFor(command.action)}` })
  try {
    const envelope = await executeCommand(command)
    nativePort?.postMessage({ type: 'event', payload: envelope })
    updateState({ busy: true, message: `已提交桌面端校验：${labelFor(command.action)}` })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    pendingCommand = null
    nativePort?.postMessage({
      type: 'status',
      payload: { type: 'blocked', commandId: command.commandId, message: detail, at: new Date().toISOString() }
    })
    updateState({ busy: false, message: detail })
  }
}

function labelFor(action) {
  return ({ collect_following: '关注列表', collect_creator_works: '博主作品', collect_work_comments: '作品评论' })[action] || action
}

async function executeCommand(command) {
  const targetUrl = command.action === 'collect_following'
    ? 'https://www.douyin.com/user/self?showTab=follow'
    : command.payload.profileUrl || command.payload.sourceUrl
  if (!targetUrl || !targetUrl.startsWith('https://www.douyin.com/')) throw new Error('连接器拒绝非抖音目标地址')
  const tab = await openOrReuseTab(targetUrl)
  await waitForTab(tab.id, 45_000)
  let result
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: 'signaldesk.collect', command })
  } catch (error) {
    throw new Error(`无法读取抖音页面，请刷新页面或重新登录：${String(error)}`)
  }
  if (!result?.ok) throw new Error(result?.error || '页面采集失败')
  return result.envelope
}

async function openOrReuseTab(url) {
  const tabs = await chrome.tabs.query({ url: ['https://www.douyin.com/*'] })
  const exact = tabs.find((tab) => tab.url && new URL(tab.url).pathname === new URL(url).pathname)
  if (exact?.id) {
    const currentUrl = new URL(exact.url)
    const targetUrl = new URL(url)
    const alreadyAtTarget = currentUrl.origin === targetUrl.origin
      && currentUrl.pathname === targetUrl.pathname
      && currentUrl.search === targetUrl.search
    if (!alreadyAtTarget) await chrome.tabs.update(exact.id, { url, active: false })
    return exact
  }
  return await chrome.tabs.create({ url, active: false })
}

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('抖音页面加载超时'))
    }, timeoutMs)
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 1500)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 1500)
      }
    })
  })
}

chrome.runtime.onInstalled.addListener(connectNative)
chrome.runtime.onStartup.addListener(connectNative)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'connector.state') sendResponse(state)
  if (message?.type === 'connector.connect') {
    connectNative({ force: true })
    sendResponse(state)
  }
  return true
})

connectNative()
