// An entire browser batch runs here without model/tool round trips.
export async function runVisibleFollowingSync(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch,
  delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const chrome=chromeApi,fetch=fetchApi
  const preparing=config.action==='prepare'
  const post=async(path,body)=>{
    const response=await fetch(config.origin+path,{method:'POST',headers:{authorization:`Bearer ${config.token}`,
      'content-type':'application/json'},body:JSON.stringify({...body,...(preparing?{preparationId:config.preparationId}:{runId:config.runId})})})
    const result=await response.json();if(!response.ok)throw new Error(result.error||'APP_SESSION_REJECTED');return result
  }
  let tab=null,failureCapture=null,debugTarget=null,browserExecution=null,previousActiveTab=null
  const active=async()=>{
    const response=await fetch(config.origin+'/status',{headers:{authorization:`Bearer ${config.token}`}})
    if(!response.ok)throw new Error('APP_UNAVAILABLE')
    const state=await response.json()
    if(preparing){
      if(state.readiness?.preparationId!==config.preparationId||!['connecting','checking'].includes(state.readiness.phase))throw new Error('APP_PREPARATION_ENDED')
      return
    }
    if(state.runId!==config.runId||!['awaiting-config','running'].includes(state.phase))throw new Error('APP_SESSION_ENDED')
  }
  const feedback=async(phase,message,count=0)=>{
    try{await chrome.action.setBadgeText({text:phase==='completed'?String(count):phase==='blocked'?'!':'…'})}catch{}
  }
  const progress=async message=>preparing?post('/readiness',{phase:'checking',message}):post('/progress',{phase:'running',message})
  const waitForContent=async()=>{
    const deadline=Date.now()+12000
    while(Date.now()<deadline){
      await active()
      const current=await chrome.tabs.get(tab.id)
      if(current.status!=='complete'||current.discarded){await delay(100);continue}
      let ready
      try{ready=await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.ping'})}catch{}
      if(ready?.ok&&ready.version===chrome.runtime.getManifest().version)return
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['following-timing.js','following-batch.js','following-trigger.js']})
      await delay(100)
    }
    throw new Error('FOLLOWING_EXTENSION_NOT_READY')
  }
  const reloadPage=async()=>{
    await active()
    // Listen before reloading: a message from the previous document must never
    // be mistaken for the newly loaded account page.
    let listener,deadline
    const loaded=new Promise((resolve,reject)=>{
      listener=(tabId,change)=>{if(tabId===tab.id&&change.status==='complete')resolve()}
      chrome.tabs.onUpdated.addListener(listener)
      deadline=setTimeout(()=>reject(new Error('OWNER_PAGE_NOT_READY')),12000)
    })
    try{await Promise.all([chrome.tabs.reload(tab.id),loaded])}
    finally{clearTimeout(deadline);chrome.tabs.onUpdated.removeListener(listener)}
    await waitForContent()
  }
  try{
    await active()
    await progress(preparing?'正在检查账号页面和关注列表…':`正在自动读取另外 ${config.limit} 位博主…`)
    const existing=await chrome.tabs.query({url:'https://www.douyin.com/user/self*'})
    tab=existing.find(item=>item.id===config.preferredTabId)||existing.at(-1)||await chrome.tabs.create({url:'https://www.douyin.com/user/self',active:false})
    // Douyin defers pagination while a background document is hidden. Keep only
    // this authorized page active internally; do not activate the tab/window.
    if(chrome.debugger){
      debugTarget={tabId:tab.id}
      await chrome.debugger.attach(debugTarget,'1.3')
      const readVisibility=async()=>{
        const result=await chrome.debugger.sendCommand(debugTarget,'Runtime.evaluate',{expression:'JSON.stringify({visibility:document.visibilityState,focused:document.hasFocus()})',returnByValue:true})
        return JSON.parse(result.result.value)
      }
      const before=await readVisibility()
      await chrome.debugger.sendCommand(debugTarget,'Emulation.setFocusEmulationEnabled',{enabled:true})
      browserExecution={reusedTab:existing.some(item=>item.id===tab.id),tabActive:tab.active===true,before,after:await readVisibility(),recoveryAttempts:[]}
    }
    browserExecution||={reusedTab:existing.some(item=>item.id===tab.id),tabActive:tab.active===true,recoveryAttempts:[]}
    const current=await chrome.tabs.get(tab.id)
    const coldRestoredPage=existing.some(item=>item.id===tab.id)&&!(config.readyTabIds||[]).includes(tab.id)
    if(preparing&&(!existing.some(item=>item.id===tab.id)||coldRestoredPage||current.discarded)&&tab.windowId!==undefined){
      const selected=await chrome.tabs.query({active:true,windowId:tab.windowId})
      previousActiveTab=selected.find(item=>item.id!==tab.id)||null
      // Startup readiness needs the actual page lifecycle, not only a mocked
      // visibility flag. Select inside Chrome without focusing its window,
      // and restore the user's selected tab after the check.
      await chrome.tabs.update(tab.id,{active:true})
      browserExecution.temporarilySelectedForPreparation=true
    }
    if(coldRestoredPage||current.discarded){
      await active()
      await progress('正在恢复账号页面并检查登录状态…')
      await reloadPage()
      browserExecution.coldPageRefreshed=true
    }
    await waitForContent()
    await active()
    const collect=async dialogTimeoutMs=>{
      const scope={limit:preparing?10:config.limit,ownerNickname:config.ownerNickname,excludeSecUids:preparing?[]:config.excludeSecUids,dialogTimeoutMs,
        ...(preparing?{prepareOnly:true}: {})}
      if(debugTarget)await chrome.debugger.sendCommand(debugTarget,'Emulation.setFocusEmulationEnabled',{enabled:true})
      let capture=await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.collect-visible',config:{...scope,...(debugTarget?{requestFollowingClick:true}:{})}})
      if(capture?.error==='FOLLOWING_ENTRY_CLICK_REQUIRED'&&debugTarget){
        if(!Number.isFinite(capture.click?.x)||!Number.isFinite(capture.click?.y)||capture.click.x<0||capture.click.y<0)throw new Error('FOLLOWING_ENTRY_NOT_READY')
        await active()
        const point={x:capture.click.x,y:capture.click.y,button:'left',clickCount:1}
        await chrome.debugger.sendCommand(debugTarget,'Input.dispatchMouseEvent',{type:'mousePressed',...point})
        await chrome.debugger.sendCommand(debugTarget,'Input.dispatchMouseEvent',{type:'mouseReleased',...point})
        browserExecution.followingTrigger='browser-input-on-verified-owner-control'
        capture=await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.collect-visible',config:{...scope,followingClicked:true}})
      }
      return capture
    }
    let capture=await collect(2000)
    if(!capture?.ok&&['FOLLOWING_DIALOG_NOT_READY','OWNER_PAGE_NOT_READY'].includes(capture?.error)){
      // Recover once inside the same APP run. Login, security challenges and
      // ownership mismatches cannot enter this branch.
      await active()
      browserExecution.recoveryAttempts.push({error:capture.error,timing:capture.timing,diagnostic:capture.diagnostic})
      await progress('账号页面尚未就绪，正在自动恢复并重新打开关注列表…')
      await reloadPage()
      await active()
      capture=await collect(5000)
    }
    if(!capture?.ok){failureCapture=capture;throw new Error(capture?.error||'FOLLOWING_CAPTURE_FAILED')}
    await active()
    if(preparing){
      await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.track-readiness',ownerNickname:capture.ownerNickname})
      await chrome.storage.local.set({followingTabId:tab.id})
      return await post('/readiness',{phase:'ready',message:'关注连接器和账号页面已准备好，可以同步关注。',
        proof:capture,browserExecution,tabId:tab.id})
    }
    const saved=await post('/report',{capture,browserExecution})
    await chrome.storage.local.set({followingTabId:tab.id})
    await feedback(saved.phase,saved.message,saved.count)
    await chrome.storage.local.set({lastFollowingResult:{runId:config.runId,count:saved.count,status:'saved',message:saved.message,timing:saved.timing}})
    return saved
  }catch(error){
    if(preparing){
      const code=String(error.message)
      const message=code==='LOGIN_REQUIRED'?'账号尚未登录，请完成登录后等待自动检查。':code==='CAPTCHA_OR_SECURITY_CHALLENGE'?'账号页面需要安全验证，请处理后等待自动检查。':code==='OWNER_DISPLAY_NAME_MISMATCH'?'当前账号与资料库账号不一致，请切回原账号。':'账号页面准备未完成，正在等待恢复。'
      try{await post('/readiness',{phase:'blocked',message,code,failureCapture,browserExecution})}catch{}
      return {phase:'blocked',message,code}
    }
    const message=`关注同步未完成：${String(error.message).slice(0,300)}`
    try{await post('/progress',{phase:'blocked',message,failureCapture,browserExecution,code:String(error.message)})}catch{}
    await feedback('blocked',message)
    await chrome.storage.local.set({lastFollowingResult:{runId:config.runId,status:'blocked',message}})
    return {phase:'blocked',message}
  }finally{
    if(debugTarget){
      try{await chrome.debugger.sendCommand(debugTarget,'Emulation.setFocusEmulationEnabled',{enabled:false})}catch{}
      try{await chrome.debugger.detach(debugTarget)}catch{}
    }
    if(previousActiveTab)try{await chrome.tabs.update(previousActiveTab.id,{active:true})}catch{}
  }
}
