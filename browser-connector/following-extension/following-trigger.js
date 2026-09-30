function r8Text(element) {
  return (element?.innerText || element?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function r8Visible(element) {
  if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
}

function r8PageIssue() {
  const body = r8Text(document.body).slice(0, 50_000)
  if (/验证码|安全验证|访问过于频繁/.test(body)) return 'CAPTCHA_OR_SECURITY_CHALLENGE'
  if (/扫码登录|登录后查看|请登录/.test(body)) return 'LOGIN_REQUIRED'
  return null
}

function r8VerifiedFollowingDialog() {
  const visibleList = [...document.querySelectorAll('[data-e2e="user-fans-container"]')]
    .find((element) => r8Visible(element) && element.querySelector('a[href*="/user/"]') && r8RelationshipMarkers(element).length > 0)
  if (visibleList) return true
  const followingPattern = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
  const fansPattern = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
  const active = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
    .filter((element) => r8Visible(element) && followingPattern.test(r8Text(element)))
  if (active.length !== 1) return false
  const tabList = active[0].closest('[role="tablist"]')
  if (!tabList) return false
  const tabs = [...tabList.querySelectorAll('[role="tab"]')].filter(r8Visible)
  if (tabs.filter((element) => followingPattern.test(r8Text(element))).length !== 1
    || tabs.filter((element) => fansPattern.test(r8Text(element))).length > 1) return false
  const containers = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(r8Visible)
  return containers.length === 1 && r8RelationshipMarkers(containers[0]).length > 0
}

function r8RelationshipMarkers(container) {
  return [container, ...container.querySelectorAll('button, [role="button"], span, div')]
    .filter((element) => r8Visible(element) && /^(?:已关注|相互关注)$/.test(r8Text(element)))
}

function r8FollowingUiOutline() {
  const followingPattern = /^关注(?:\s*[（(]\s*\d+\s*[）)])?$/
  const fansPattern = /^粉丝(?:\s*[（(]\s*\d+\s*[）)])?$/
  const active = [...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][aria-current="page"], [role="tab"][data-state="active"], [role="tab"][data-state="selected"]')]
    .filter((element) => r8Visible(element) && followingPattern.test(r8Text(element)))
  const tabList = active.length === 1 ? active[0].closest('[role="tablist"]') : null
  const tabs = tabList ? [...tabList.querySelectorAll('[role="tab"]')].filter(r8Visible) : []
  return {
    activeFollowingTabCount: active.length,
    followingTabCount: tabs.filter((element) => followingPattern.test(r8Text(element))).length,
    fansTabCount: tabs.filter((element) => fansPattern.test(r8Text(element))).length,
    visibleFansContainerCount: [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(r8Visible).length,
    explicitRelationshipMarkerCount: [...document.querySelectorAll('[data-e2e="user-fans-container"]')]
      .filter(r8Visible).reduce((count, container) => count + r8RelationshipMarkers(container).length, 0)
  }
}

async function r8OpenFollowingDialog() {
  const route = new URL(location.href)
  if (route.origin !== 'https://www.douyin.com' || route.pathname.replace(/\/+$/, '') !== '/user/self') {
    return { ok: false, code: 'FOLLOWING_ROUTE_MISMATCH' }
  }
  const pageIssue = r8PageIssue()
  if (pageIssue) return { ok: false, code: pageIssue }
  if (r8VerifiedFollowingDialog()) return { ok: true, mode: 'already-open' }

  const countPattern = /^(?:关注\s*[：:]?\s*[\d.,，万亿+]+|[\d.,，万亿+]+\s*关注)$/
  const raw = [...document.querySelectorAll('[data-e2e="user-info-follow"], [data-e2e="following-count"], [aria-label], a, button, [role="button"]')]
    .filter((element) => {
      if (!r8Visible(element) || element.closest('nav, aside')) return false
      const dataE2e = element.getAttribute('data-e2e') || ''
      const ariaLabel = (element.getAttribute('aria-label') || '').normalize('NFKC').trim()
      const label = r8Text(element)
      const semantic = dataE2e === 'user-info-follow' || dataE2e === 'following-count' || /^(?:我的)?关注(?:数量|列表)?$/.test(ariaLabel)
      return semantic ? /关注/.test(label || ariaLabel) : countPattern.test(label)
    })
    .map((element) => element.matches('button, a, [role="button"], [tabindex]')
      ? element
      : element.querySelector('button, a, [role="button"], [tabindex]')
        || element.closest('button, a, [role="button"], [tabindex]') || element)
    .filter((element) => r8Visible(element) && !element.closest('nav, aside'))
  const candidates = [...new Set(raw)].filter((element) => !raw.some((other) => other !== element && element.contains(other)))
  if (candidates.length !== 1) return { ok: false, code: 'FOLLOWING_ENTRY_NOT_UNIQUE', candidateCount: candidates.length, uiOutline: r8FollowingUiOutline() }
  candidates[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  candidates[0].click()
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const issue = r8PageIssue()
    if (issue) return { ok: false, code: issue }
    if (r8VerifiedFollowingDialog()) return { ok: true, mode: 'unique-semantic-click' }
  }
  return { ok: false, code: 'FOLLOWING_DIALOG_NOT_READY', uiOutline: r8FollowingUiOutline() }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if(message?.type === 'signaldesk.following.collect-visible') {
    collectVisibleFollowingCreators(10).then(value=>sendResponse({ok:true,...value}))
      .catch(error=>sendResponse({ok:false,error:String(error.message)}))
    return true
  }
  if (message?.type === 'signaldesk.following.feedback') {
    let banner = document.getElementById('signaldesk-following-feedback')
    if (!banner) {
      banner = document.createElement('aside')
      banner.id = 'signaldesk-following-feedback'
      banner.setAttribute('role', 'status')
      banner.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;width:380px;max-width:90vw;padding:20px;background:#f4f1ea;color:#26352d;border:2px solid #6b846f;border-radius:12px;font:16px/1.7 system-ui;box-shadow:0 4px 24px #0005'
      document.body.appendChild(banner)
    }
    banner.textContent = `Signal Desk 关注同步 · ${message.phase === 'completed' ? '已保存' : message.phase === 'blocked' ? '未完成' : '进行中'}\n${String(message.message || '').slice(0,500)}`
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === 'signaldesk.following.verify') {
    const issue = r8PageIssue()
    sendResponse({ ok: !issue && r8VerifiedFollowingDialog() && location.pathname.replace(/\/+$/, '') === '/user/self',
      code: issue || 'FOLLOWING_UI_NOT_VERIFIED' })
    return false
  }
  if (message?.type !== 'signaldesk.r8.open-following-dialog') return false
  r8OpenFollowingDialog().then(sendResponse).catch(() => sendResponse({ ok: false, code: 'FOLLOWING_TRIGGER_EXCEPTION' }))
  return true
})
