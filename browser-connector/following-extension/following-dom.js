async function collectVisibleFollowingCreators(limit = 10) {
  const text = (element) => (element?.innerText || element?.textContent || '').trim()
  const shown = (element) => element?.isConnected && getComputedStyle(element).display !== 'none'
    && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[aria-hidden="true"]')
  const root = [...document.querySelectorAll('[data-e2e="user-fans-container"]')].find(shown)
    || [...document.querySelectorAll('[role="dialog"]')].find((element) => shown(element) && /关注/.test(text(element)))
    || document.body
  const profile = (anchor) => {
    try {
      const url = new URL(anchor.href,location.href)
      const match = url.pathname.match(/^\/user\/([A-Za-z0-9._-]+)\/?$/)
      if (url.hostname !== 'www.douyin.com' || !match || match[1] === 'self') return null
      return {secUid:match[1],profileUrl:`https://www.douyin.com/user/${match[1]}`}
    } catch { return null }
  }
  let scroller = [root,...root.querySelectorAll('*')].find((element)=>element.scrollHeight>element.clientHeight+30
    && /auto|scroll/.test(getComputedStyle(element).overflowY))
  if (!scroller) {
    let parent=root.parentElement
    while(parent && parent!==document.body){if(parent.scrollHeight>parent.clientHeight+30 && /auto|scroll/.test(getComputedStyle(parent).overflowY)){scroller=parent;break}parent=parent.parentElement}
  }
  if(scroller) scroller.scrollTop=0
  await new Promise(resolve=>setTimeout(resolve,200))
  const found=new Map()
  const read=()=>{
    for(const anchor of root.querySelectorAll('a[href]')){
      const identity=profile(anchor)
      if(!identity || found.has(identity.secUid) || !shown(anchor))continue
      let card=anchor
      while(card.parentElement && card.parentElement!==root){
        const ids=new Set([...card.querySelectorAll('a[href]')].map(profile).filter(Boolean).map(item=>item.secUid))
        const relationship=[...card.querySelectorAll('button,[role="button"],span,div')].some(element=>/^(已关注|相互关注)$/.test(text(element)))
        if(ids.size===1 && card.querySelector('img') && [...card.querySelectorAll('a[href]')].some(link=>text(link)) && relationship)break
        card=card.parentElement
      }
      if(![...card.querySelectorAll('button,[role="button"],span,div')].some(element=>/^(已关注|相互关注)$/.test(text(element))))continue
      const matching=[...card.querySelectorAll('a[href]')].filter(link=>profile(link)?.secUid===identity.secUid)
      const nickname=text(matching.find(link=>text(link))).split('\n')[0].trim()
        || card.querySelector('img')?.alt?.replace(/头像$/,'').trim()
      if(!nickname)continue
      const image=matching.flatMap(link=>[...link.querySelectorAll('img')])
        .find(img=>img.alt===`${nickname}头像`)
      const avatar=image?.currentSrc || image?.src
      found.set(identity.secUid,{uid:null,...identity,nickname:nickname.slice(0,200),
        avatarUrl:avatar?.startsWith('https://')?avatar:null,
        signature:text(card.querySelector('[data-e2e="user-signature"],[aria-label="简介"]')).slice(0,2000)})
      if(found.size>=limit)break
    }
  }
  for(let attempt=0;attempt<8;attempt++){
    read();if(found.size>=limit || !scroller)break
    scroller.scrollTop+=Math.max(200,scroller.clientHeight*0.7)
    await new Promise(resolve=>setTimeout(resolve,350))
  }
  const ownerNickname=text(document.querySelector('[data-e2e="user-title"],[data-e2e="user-info-nickname"]')).slice(0,200)||null
  return {creators:[...found.values()].slice(0,limit),visibleItemCount:found.size,ownerNickname}
}
