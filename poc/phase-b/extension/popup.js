const controllerUrl = document.querySelector('#controllerUrl')
const targetSampleCount = document.querySelector('#targetSampleCount')
const status = document.querySelector('#status')
const start = document.querySelector('#start')
const stop = document.querySelector('#stop')

const saved = await chrome.storage.local.get(['phaseBControllerUrl', 'phaseBTargetSampleCount'])
if (saved.phaseBControllerUrl) controllerUrl.value = saved.phaseBControllerUrl
if (saved.phaseBTargetSampleCount) targetSampleCount.value = String(saved.phaseBTargetSampleCount)

async function refreshState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'phase-b.state' })
    status.textContent = JSON.stringify(response, null, 2)
    start.disabled = Boolean(response?.running)
  } catch (error) {
    status.textContent = String(error)
  }
}

start.addEventListener('click', async () => {
  const count = Number(targetSampleCount.value)
  await chrome.storage.local.set({
    phaseBControllerUrl: controllerUrl.value.trim(),
    phaseBTargetSampleCount: count
  })
  status.textContent = '正在启动自动关注验证与随机抽样…'
  const response = await chrome.runtime.sendMessage({
    type: 'phase-b.start',
    controllerUrl: controllerUrl.value.trim(),
    targetSampleCount: count
  })
  status.textContent = JSON.stringify(response, null, 2)
  await refreshState()
})

stop.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'phase-b.stop',
    controllerUrl: controllerUrl.value.trim()
  })
  status.textContent = JSON.stringify(response, null, 2)
  await refreshState()
})

chrome.storage.onChanged.addListener((changes) => {
  if (changes.phaseBState) void refreshState()
})

await refreshState()
