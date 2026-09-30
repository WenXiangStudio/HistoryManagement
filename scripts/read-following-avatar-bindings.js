// Run in the current logged-in following page. Each image is located through
// its own profile anchor, never through row position or screen coordinates.
(async () => {
  const targets = new Map((globalThis.SIGNAL_DESK_AVATAR_TARGETS || []).map(item => [item.secUid, item.nickname]))
  if (targets.size !== 10) throw new Error('Expected the ten saved author identities')
  document.getElementById('signaldesk-avatar-bindings')?.remove()
  if (![...document.images].some(img => img.alt === '爱学习的乔同学头像')) {
    const count = [...document.querySelectorAll('span,div,p')].find(el => el.children.length === 0 && /^\d+$/.test(el.textContent.trim())
      && /关注/.test(el.parentElement?.innerText || ''))
    if (count) {
      count.parentElement.click()
      await new Promise(resolve => setTimeout(resolve, 1300))
    }
  }
  const records = []
  const seen = new Set()
  const anchors = [...document.querySelectorAll('a[href]')]
  for (const anchor of anchors) {
    let url
    try { url = new URL(anchor.href, location.href) } catch { continue }
    const match = url.pathname.match(/^\/user\/([A-Za-z0-9._-]+)\/?$/)
    if (url.hostname !== 'www.douyin.com' || !match || match[1] === 'self') continue
    const secUid = match[1]
    if (!targets.has(secUid)) continue
    const images = [...anchor.querySelectorAll('img')]
    if (!images.length) continue
    for (const img of images) {
      const avatarUrl = img.currentSrc || img.src
      if (!avatarUrl?.startsWith('https://') || seen.has(secUid)) continue
      if (img.alt !== `${targets.get(secUid)}头像`) throw new Error(`Avatar alt differs from saved author for ${secUid}`)
      seen.add(secUid)
      const sameAuthorAnchors = anchors.filter(item => {
        try { return new URL(item.href, location.href).pathname.replace(/\/$/, '') === `/user/${secUid}` } catch { return false }
      })
      const nickname = sameAuthorAnchors.map(item => item.innerText?.trim()).find(Boolean)
        || img.alt.replace(/头像$/, '')
      if (nickname !== targets.get(secUid)) throw new Error(`Nickname differs from saved author for ${secUid}`)
      records.push({ secUid, nickname, profileUrl: `https://www.douyin.com/user/${secUid}`,
        avatarUrl, imageAlt: img.alt, imageLoaded: img.complete && img.naturalWidth > 0,
        anchorProfileUrl: url.origin + url.pathname, bindingMethod: 'image-inside-exact-profile-anchor' })
    }
  }
  const prior = document.getElementById('signaldesk-avatar-bindings')
  prior?.remove()
  const output = document.createElement('textarea')
  output.id = 'signaldesk-avatar-bindings'
  output.setAttribute('aria-label', 'Signal Desk 头像归属采集结果')
  output.style.cssText = 'position:fixed;inset:40px;z-index:2147483647;background:white;color:black;font:14px monospace;padding:20px'
  output.value = JSON.stringify({ collectedAt: new Date().toISOString(), pageUrl: location.origin + location.pathname, records }, null, 2)
  document.body.appendChild(output)
  output.focus()
  output.select()
})()
