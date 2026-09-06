const status = document.querySelector('#status')
const meter = document.querySelector('#meter')
const connectButton = document.querySelector('#connect')

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'connector.state' })
  status.textContent = state?.message || '未连接'
  meter.className = state?.desktopOnline ? 'online' : state?.connected ? 'waiting' : 'offline'
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true
  connectButton.textContent = '正在重新连接…'
  status.textContent = '正在连接桌面端…'
  meter.className = 'offline'
  try {
    await chrome.runtime.sendMessage({ type: 'connector.connect' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await refresh()
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
    meter.className = 'offline'
  } finally {
    connectButton.disabled = false
    connectButton.textContent = '重新连接桌面端'
  }
})
document.querySelector('#following').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.douyin.com/user/self?showTab=follow' }))
void refresh()
