// Shared by the extension and desktop diagnostics. Read only verified account
// following cards, and complete the batch without per-author fixed sleeps.
async function collectVisibleFollowingBatch(config) {
  const timer=createFollowingBatchTimer(config.limit),stageMs={},diagnostic={}
  const structure=globalThis.signalDeskFollowingStructure||(globalThis.signalDeskFollowingStructure={})
  const text=element=>(element?.innerText||element?.textContent||'').trim()
  const displayText=element=>!element?'':[...element.childNodes].map(node=>node.nodeType===Node.TEXT_NODE
    ?node.textContent:node.nodeName==='IMG'?node.getAttribute('alt')||'':node.nodeName==='BR'?'\n':displayText(node)).join('').trim()
  const shown=element=>element?.isConnected&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0
    &&getComputedStyle(element).visibility!=='hidden'&&!element.closest('[hidden],[aria-hidden="true"]')
  const profile=anchor=>{try{const url=new URL(anchor.href,location.href),match=url.pathname.match(/^\/user\/([A-Za-z0-9._-]+)\/?$/)
    return url.origin==='https://www.douyin.com'&&match&&match[1]!=='self'?{secUid:match[1],profileUrl:`${url.origin}/user/${match[1]}`}:null}catch{return null}}
  const issue=()=>{
    const body=text(document.body).replace(text(document.getElementById('signaldesk-following-feedback')),'')
    if(/验证码|安全验证|访问过于频繁/.test(body))throw new Error('CAPTCHA_OR_SECURITY_CHALLENGE')
    if(!document.querySelector('[data-e2e="user-info-follow"]')&&/扫码登录|请登录/.test(body))throw new Error('LOGIN_REQUIRED')
    if(location.origin!=='https://www.douyin.com'||location.pathname.replace(/\/$/,'')!=='/user/self')throw new Error('FOLLOWING_ROUTE_MISMATCH')
  }
  const waitFor=(predicate,timeoutMs,code)=>new Promise((resolve,reject)=>{
    let observer,deadline,poll,done=false
    const finish=(error,value)=>{if(done)return;done=true;observer?.disconnect();clearTimeout(deadline);clearInterval(poll);error?reject(error):resolve(value)}
    const check=()=>{try{issue();const value=predicate();if(value)finish(null,value)}catch(error){finish(error)}}
    observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true})
    deadline=setTimeout(()=>finish(new Error(code)),timeoutMs);poll=setInterval(check,100);check()
  })
  try{
    if(![10,20].includes(config.limit)||!Array.isArray(config.excludeSecUids))throw new Error('INVALID_BATCH_SCOPE')
    issue()
    const started=performance.now()
    const ownerControl=await waitFor(()=>shown(structure.ownerControl)?structure.ownerControl:
      (structure.ownerControl=[...document.querySelectorAll('[data-e2e="user-info-follow"]')].find(shown)),8000,'OWNER_PAGE_NOT_READY')
    const ownerImage=await waitFor(()=>{
      const labels=[...document.images].filter(image=>/头像$/.test(image.alt)&&!image.closest('[data-e2e="user-fans-container"]'))
      return config.ownerNickname?labels.find(image=>image.alt===`${config.ownerNickname}头像`)
        :labels.find(image=>image.closest('[data-e2e="user-info"]'))||labels[0]
    },8000,'OWNER_DISPLAY_NAME_MISMATCH')
    const ownerNickname=ownerImage.alt.replace(/头像$/,'')
    const findRoot=()=>{
      const roots=[...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(shown)
      if(roots.length>1)throw new Error('FOLLOWING_LIST_NOT_UNIQUE')
      const root=roots[0];if(!root)return null
      const tabs=[...root.parentElement.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(shown)
      return tabs.length===1&&/^关注\s*[（(]\d+[）)]$/.test(text(tabs[0]))?root:null
    }
    let retry
    if(!findRoot()&&config.requestFollowingClick){
      const controls=[...document.querySelectorAll('[data-e2e="user-info-follow"]')].filter(shown)
      if(controls.length!==1)throw new Error('FOLLOWING_ENTRY_NOT_UNIQUE')
      ownerControl.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})
      const rect=ownerControl.getBoundingClientRect()
      return {ok:false,error:'FOLLOWING_ENTRY_CLICK_REQUIRED',ownerNickname,click:{x:rect.left+rect.width/2,y:rect.top+rect.height/2}}
    }
    if(!findRoot()&&!config.followingClicked){
      ownerControl.click()
      // A freshly rendered React control can precede its event binding. Retry
      // the same unique entry once only if no dialog has opened in that time.
      retry=setTimeout(()=>{
        try{issue();if(!findRoot()&&![...document.querySelectorAll('[data-e2e="user-fans-container"]')].some(shown)&&shown(ownerControl))ownerControl.click()}catch{}
      },600)
    }
    let root
    try{root=await waitFor(findRoot,config.dialogTimeoutMs||8000,'FOLLOWING_DIALOG_NOT_READY')}finally{clearTimeout(retry)}
    structure.root=root
    await waitFor(()=>root.querySelector('a[href*="/user/"]')&&[...root.querySelectorAll('button')].some(button=>/^(已关注|相互关注)$/.test(text(button))),8000,'FOLLOWING_CARDS_NOT_READY')
    root.scrollTop=0
    const activeTabText=text(root.parentElement.querySelector('[role="tab"][aria-selected="true"]'))
    stageMs.openFollowing=performance.now()-started
    // Startup preparation proves the same real source used by collection,
    // without reading author rows, scrolling or sending a directory report.
    if(config.prepareOnly)return {ok:true,prepared:true,ownerNickname,sourceUrl:'https://www.douyin.com/user/self',
      activeFollowingTab:true,uniqueFollowingList:true,readyMs:performance.now()-started}
    const discoveryStart=performance.now(),excluded=new Set(config.excludeSecUids),found=new Map(),order=new Map()
    let pendingHydration=false
    const readRows=()=>{
      pendingHydration=false
      for(const anchor of root.querySelectorAll('a[href]')){
        const identity=profile(anchor);if(!identity||found.has(identity.secUid))continue
        if(excluded.has(identity.secUid)){
          if(!order.has(identity.secUid))order.set(identity.secUid,order.size+1)
          continue
        }
        let card=anchor
        while(card&&card!==root){
          const ids=new Set([...card.querySelectorAll('a[href]')].map(profile).filter(Boolean).map(item=>item.secUid))
          const relations=[...card.querySelectorAll('button')].filter(button=>/^(已关注|相互关注)$/.test(text(button)))
          if(ids.size===1&&relations.length===1&&card.querySelector('img'))break
          card=card.parentElement
        }
        if(!card||card===root)continue
        if(!order.has(identity.secUid))order.set(identity.secUid,order.size+1)
        if(excluded.has(identity.secUid))continue
        const matching=[...card.querySelectorAll('a[href]')].filter(link=>profile(link)?.secUid===identity.secUid)
        const nameAnchor=matching.find(link=>!link.querySelector('img[alt$="头像"]')&&displayText(link)),nickname=displayText(nameAnchor)
        if(!nickname||nickname.includes('\n'))throw new Error('AMBIGUOUS_AUTHOR_NICKNAME')
        const images=[...card.querySelectorAll('img')].filter(image=>image.alt===`${nickname}头像`)
        if(images.length!==1){
          if(images.length>1 || [...card.querySelectorAll('img')].some(image=>/头像$/.test(image.alt)))throw new Error(`Avatar identity missing for ${nickname}`)
          pendingHydration=true;continue
        }
        const signatures=[...card.querySelectorAll('.ceyzKypd,[data-e2e="user-signature"]')]
        if(signatures.length>1)throw new Error(`Ambiguous signature for ${nickname}`)
        found.set(identity.secUid,{...identity,nickname,card,image:images[0],nameAnchor,signatureElement:signatures[0]||null,
          relationship:text([...card.querySelectorAll('button')].find(button=>/^(已关注|相互关注)$/.test(text(button))))})
        if(found.size===config.limit)break
      }
      return found.size
    }
    readRows()
    if(pendingHydration)await waitFor(()=>{readRows();return !pendingHydration},8000,'AUTHOR_CARD_NOT_READY')
    let scroller=root
    while(scroller&&scroller!==document.body&&!(scroller.scrollHeight>scroller.clientHeight+20&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement
    diagnostic.initialKnownCount=order.size;diagnostic.initialNewCount=found.size
    diagnostic.scrollTarget={tag:scroller?.tagName,className:scroller?.className,top:scroller?.scrollTop,height:scroller?.scrollHeight,clientHeight:scroller?.clientHeight}
    const deadline=performance.now()+12000
    while(found.size<config.limit&&performance.now()<deadline){
      if(!scroller||scroller===document.body)throw new Error(`Only ${found.size} new authors; following scroll target unavailable`)
      const previous=order.size;scroller.scrollTop=scroller.scrollHeight
      diagnostic.finalScrollTop=scroller.scrollTop;diagnostic.scrollHeight=scroller.scrollHeight;diagnostic.knownCount=order.size;diagnostic.newCount=found.size
      await waitFor(()=>{readRows();return found.size>=config.limit||order.size>previous},Math.max(1,deadline-performance.now()),'FOLLOWING_NO_MORE_NEW_AUTHORS')
    }
    const selected=[...found.values()].sort((a,b)=>order.get(a.secUid)-order.get(b.secUid)).slice(0,config.limit)
    if(selected.length!==config.limit)throw new Error(`Only ${selected.length} of ${config.limit} new authors available`)
    stageMs.discovery=performance.now()-discoveryStart
    const avatarStart=performance.now()
    await Promise.all(selected.map(row=>row.image.complete&&row.image.naturalWidth>0?Promise.resolve():new Promise((resolve,reject)=>{
      let deadline
      const finish=error=>{clearTimeout(deadline);row.image.removeEventListener('load',loaded);row.image.removeEventListener('error',failed);error?reject(error):resolve()}
      const loaded=()=>row.image.naturalWidth>0?finish():finish(new Error(`Avatar failed to load for ${row.nickname}`))
      const failed=()=>finish(new Error(`Avatar failed to load for ${row.nickname}`))
      row.image.addEventListener('load',loaded,{once:true});row.image.addEventListener('error',failed,{once:true})
      deadline=setTimeout(failed,6000);row.card.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})
      if(row.image.complete&&row.image.naturalWidth>0)loaded()
    })))
    stageMs.avatarWait=performance.now()-avatarStart
    const creators=[],bindings=[]
    for(const row of selected){
      timer.beginCreator(row.secUid,row.nickname);issue()
      if(!row.card.isConnected||displayText(row.nameAnchor)!==row.nickname||profile(row.nameAnchor)?.secUid!==row.secUid
        ||row.image.alt!==`${row.nickname}头像`||!row.image.complete||row.image.naturalWidth===0)throw new Error(`Author card changed for ${row.nickname}`)
      const avatarUrl=row.image.currentSrc||row.image.src;if(!avatarUrl?.startsWith('https://'))throw new Error('AVATAR_URL_INVALID')
      const creator={position:creators.length+1,sourceListPosition:order.get(row.secUid),uid:null,secUid:row.secUid,
        nickname:row.nickname,profileUrl:row.profileUrl,avatarUrl,signature:displayText(row.signatureElement)}
      creators.push(creator)
      bindings.push({...creator,imageAlt:row.image.alt,imageLoaded:true,anchorProfileUrl:profile(row.image.closest('a[href]'))?.profileUrl||null,
        avatarLinkUrl:row.image.closest('a[href]')?.href||null,nicknameAnchorProfileUrl:profile(row.nameAnchor)?.profileUrl,
        relationship:row.relationship,signatureHtml:row.signatureElement?.outerHTML||null,cardText:text(row.card),bindingMethod:'image-and-signature-inside-exact-profile-card'})
      timer.finishCreator()
    }
    const timing=timer.finish('completed');timing.stageMs=stageMs
    timing.perCreatorScope='final author field and identity verification; shared discovery and concurrent avatar waiting are separate stages'
    return {ok:true,collectedAt:new Date().toISOString(),sourceUrl:'https://www.douyin.com/user/self',sourceKind:'current-account-visible-following-list',
      collectionMethod:'event-driven Chrome DOM batch',ownerNickname,ownerSecUid:null,activeFollowingTab:true,listStartedAtTop:true,activeTabText,
      excludedSecUids:[...excluded],skippedSavedCount:[...order.keys()].filter(id=>excluded.has(id)).length,visibleItemCount:order.size,hasMore:true,
      activeApiRequests:0,workResponseBodiesRead:0,batchNumber:config.batchNumber||0,requestedCount:config.limit,creators,bindings,timing}
  }catch(error){
    diagnostic.pageReadyState=document.readyState
    diagnostic.ownerControlVisible=[...document.querySelectorAll('[data-e2e="user-info-follow"]')].some(shown)
    diagnostic.visibleListCount=[...document.querySelectorAll('[data-e2e="user-fans-container"]')].filter(shown).length
    const control=[...document.querySelectorAll('[data-e2e="user-info-follow"]')].find(shown)
    if(control){
      const rect=control.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)
      diagnostic.followingEntry={html:control.outerHTML.slice(0,1600),rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
        hitInsideControl:control.contains(hit),hitHtml:hit?.outerHTML.slice(0,1200),viewport:{width:innerWidth,height:innerHeight}}
    }
    diagnostic.selectedRelationshipTabs=[...document.querySelectorAll('[data-e2e="user-fans-container"]')]
      .filter(shown).flatMap(root=>[...root.parentElement.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(shown).map(text))
    return {ok:false,collectedAt:new Date().toISOString(),error:String(error.message),diagnostic,timing:timer.finish('failed')}
  }
}
