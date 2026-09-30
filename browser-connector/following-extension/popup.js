let setupTab = null
const status = document.getElementById('status')
async function findSetup() {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' })
  setupTab = tabs.filter((tab) => /^\/following-setup\/following-[A-Za-z0-9-]+$/.test(new URL(tab.url).pathname)).at(-1)
  document.getElementById('setup').disabled = !setupTab
  document.getElementById('start').disabled = !setupTab
  if (!setupTab) { status.textContent = '请先在 Signal Desk APP 点击“开始同步关注”。Chrome 会打开配置页。'; return }
  const result = (await chrome.storage.local.get('lastFollowingResult')).lastFollowingResult
  const runId = new URL(setupTab.url).pathname.split('/').at(-1)
  status.textContent = result?.runId === runId && result?.status === 'blocked' ? result.message
    : result?.runId === runId && result?.status === 'saved' ? `本轮已保存 ${result.count} 位博主。可返回 APP 查看。`
      : '已找到 APP 配置页。确认本 Chrome 用户已登录抖音后，可以开始读取。'
}
async function updateStatus() {
  if (!setupTab) return
  try {
    const result = await chrome.tabs.sendMessage(setupTab.id, { type: 'signaldesk.following.status-from-popup' })
    if (!result?.ok) throw new Error(result?.error || '无法获取 APP 状态')
    status.textContent = result.state.message
    document.getElementById('start').disabled = result.state.phase !== 'awaiting-config'
  } catch { /* Keep the refresh instruction if an older configuration tab is still open. */ }
}
document.getElementById('setup').onclick = async () => {
  if (!setupTab) return
  await chrome.tabs.reload(setupTab.id)
  await chrome.tabs.update(setupTab.id, { active: true })
  await chrome.windows.update(setupTab.windowId, { focused: true })
  window.close()
}
document.getElementById('start').onclick = async () => {
  if (!setupTab) return
  document.getElementById('start').disabled = true
  try {
    const result = await chrome.tabs.sendMessage(setupTab.id, { type: 'signaldesk.following.start-from-popup' })
    if (!result?.ok) throw new Error(result?.error || '启动失败')
    status.textContent = '已开始读取；结果会自动返回 APP。'
  } catch (error) {
    status.textContent = `请先点击“返回 APP 配置页并刷新”，再开始。\n${String(error.message)}`
    document.getElementById('start').disabled = false
  }
}
void findSetup().then(updateStatus).catch((error) => { status.textContent = String(error.message) })
setInterval(() => void updateStatus(), 1000)
