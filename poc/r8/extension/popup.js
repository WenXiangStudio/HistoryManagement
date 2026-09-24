const start = document.querySelector('#start')
const status = document.querySelector('#status')

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'r8.state' })
    status.textContent = `${state?.phase || 'ready'}\n${state?.message || ''}`
    start.disabled = Boolean(state?.running) || state?.phase === 'complete'
  } catch (error) {
    status.textContent = String(error)
  }
}

start.addEventListener('click', async () => {
  start.disabled = true
  const response = await chrome.runtime.sendMessage({ type: 'r8.start-t1' })
  if (!response?.accepted) status.textContent = response?.error || '无法启动 T1'
  await refresh()
})

setInterval(refresh, 1_000)
void refresh()
