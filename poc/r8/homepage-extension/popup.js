const start = document.querySelector('#start')
const status = document.querySelector('#status')
const select = document.querySelector('#creator')
async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'pilot.state' })
    const summary = state?.summary
    const detail = summary ? [
      `结果：${summary.status}`,
      summary.verifiedWorkId ? `已验证作品：${summary.verifiedWorkId}` : `主页候选：${summary.candidateCount}`,
      summary.retainedTabId ? '作品页已保留，可在浏览器中人工对照' : '',
      summary.reason ? `原因：${summary.reason}` : '',
      summary.reportDirectory ? `报告目录：${summary.reportDirectory}` : ''
    ].filter(Boolean).join('\n') : ''
    status.textContent = `${state?.phase || 'ready'}\n${state?.message || ''}${detail ? `\n${detail}` : ''}`
    start.disabled = !select.value || Boolean(state?.running) || state?.phase !== 'ready'
  } catch (error) { status.textContent = String(error) }
}
async function loadCatalog() {
  const catalog = await chrome.runtime.sendMessage({ type: 'pilot.catalog' })
  for (const creator of catalog?.creators ?? []) {
    const option = document.createElement('option')
    option.value = creator.uid
    option.textContent = `${creator.nickname} (${creator.followingState})`
    select.append(option)
  }
  await refresh()
}
start.addEventListener('click', async () => {
  start.disabled = true
  const result = await chrome.runtime.sendMessage({ type: 'pilot.start', creatorUid: select.value })
  if (!result?.accepted) status.textContent = result?.error || '无法启动'
  await refresh()
})
setInterval(refresh, 1_000)
void loadCatalog()
