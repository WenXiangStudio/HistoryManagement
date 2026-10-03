(async () => {
  const text = element => (element?.innerText || element?.textContent || '').trim()
  const shown = element => element?.getBoundingClientRect().width > 0 && element?.getBoundingClientRect().height > 0
    && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[aria-hidden="true"]')
  document.getElementById('signaldesk-following-page-result')?.remove()
  if (globalThis.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG?.openFollowing) {
    const controls = [...document.querySelectorAll('[data-e2e="user-info-follow"]')].filter(shown)
    if (controls.length !== 1) throw new Error('Current account following control is not unique')
    controls[0].click()
    await new Promise(resolve => setTimeout(resolve, 1200))
  }
  const roots = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(shown)
  const ownerImages = [...document.images].filter(image => /无限.*进步头像/.test(image.alt))
  const result = {
    ok: true, collectedAt: new Date().toISOString(), pageUrl: location.origin + location.pathname,
    ownerAvatarLabels: ownerImages.map(image => image.alt),
    requestedCards: [...document.querySelectorAll('[data-e2e="user-fans-container"] .OlxToPIh')]
      .filter(card => text(card).includes(globalThis.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG?.inspectNickname || '\u0000'))
      .map(card => ({ text: text(card), html: card.outerHTML })),
    followControls: [...document.querySelectorAll('span,button,a,div')].filter(element => shown(element)
      && element.children.length === 0 && text(element) === '关注').slice(0,12)
      .map(element => ({ tag: element.tagName, parentText: text(element.parentElement).slice(0,200),
        parentHtml: element.parentElement.outerHTML.slice(0,2400) })),
    tabs: [...document.querySelectorAll('[role="tab"]')].filter(shown).map(element => ({ text: text(element),
      selected: element.getAttribute('aria-selected'), html: element.outerHTML.slice(0,1200) })),
    roots: roots.map(root => ({ tag: root.tagName, className: root.className, text: text(root).slice(0,4500),
      html: root.innerHTML.slice(0,18000), scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
      ancestors: (() => { const chain = []; let element = root; for (let i=0; element && i<8; i++,element=element.parentElement)
        chain.push({ tag: element.tagName, id: element.id, role: element.getAttribute('role'),
          labelledBy: element.getAttribute('aria-labelledby'), className: element.className,
          selectedTabs: [...element.querySelectorAll('[role="tab"][aria-selected="true"]')].map(tab=>text(tab)),
          followingListCount: element.querySelectorAll('[data-e2e="user-fans-container"]').length }); return chain })() }))
  }
  const output = document.createElement('textarea')
  output.id = 'signaldesk-following-page-result'
  output.setAttribute('aria-label', 'Signal Desk 关注页面读取结果')
  output.style.cssText = 'position:fixed;inset:40px;z-index:2147483647;background:white;color:black;font:14px monospace;padding:20px'
  output.value = JSON.stringify(result, null, 2)
  document.body.appendChild(output)
})()
