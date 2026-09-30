if (/^\/following-setup\/following-[A-Za-z0-9-]+$/.test(location.pathname)) {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'signaldesk.following.status-from-popup') {
      try {
        const config = JSON.parse(document.getElementById('following-config').textContent)
        fetch(config.origin + '/status', { headers: { authorization: `Bearer ${config.token}` } })
          .then((response) => { if (!response.ok) throw new Error('APP 配置已失效'); return response.json() })
          .then((state) => respond({ ok: true, state }))
          .catch((error) => respond({ ok: false, error: String(error.message) }))
      } catch (error) { respond({ ok: false, error: String(error.message) }) }
      return true
    }
    if (message?.type !== 'signaldesk.following.start-from-popup') return false
    try {
      const config = JSON.parse(document.getElementById('following-config').textContent)
      chrome.runtime.sendMessage({ type: 'signaldesk.following.start', config })
        .then(respond).catch((error) => respond({ ok: false, error: String(error) }))
    } catch (error) { respond({ ok: false, error: String(error) }) }
    return true
  })
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    if (event.data?.type === 'signaldesk.following.ping') {
      window.postMessage({ type: 'signaldesk.following.ready' }, location.origin)
    }
    if (event.data?.type === 'signaldesk.following.start') {
      try {
        const result = await chrome.runtime.sendMessage({ type: 'signaldesk.following.start', config: event.data.config })
        if (!result?.ok) throw new Error(result?.error || '无法启动关注同步')
      } catch (error) {
        window.postMessage({ type: 'signaldesk.following.error', error: String(error) }, location.origin)
      }
    }
  })
}
