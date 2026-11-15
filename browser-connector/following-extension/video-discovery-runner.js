import {observeCreatorActivity,classifyActivityVisibility} from './creator-activity-network.js'
import {observeCreatorActivityOwner} from './creator-activity-owner-network.js'
import {readCreatorActivityOwner,meterCreatorActivityRequests} from './creator-activity-context.js'
import {readCreatorActivityGuard,readCreatorPageReadiness,fetchCreatorActivityPage} from './creator-activity-runner.js'
import {classifyActivityCommandError} from './creator-activity-diagnostics.js'
import {projectVideoInformation} from './video-information-core.js'
import {projectDiscoveryPage} from './video-discovery-core.js'

// One verified author's bounded date-range discovery. Each page is accepted and checkpointed by the APP.
export async function runVideoDiscovery(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch,nativeWaitOptions={}}={}) {
  const chrome=chromeApi,started=performance.now(),deadline=Date.now()+90000
  const headers={authorization:`Bearer ${config.token}`,'content-type':'application/json'}
  const pageScope={authorUid:config.authorUid,authorSecUid:config.authorSecUid,start:config.start,endExclusive:config.endExclusive}
  const audit={authorHomepageNavigations:0,ownerVerificationGets:0,activeWorkGets:0,networkRequestsObserved:0,platformApiGetsObserved:0,selfGetsObserved:0,listGetsObserved:0}
  let target=null,list=null,owner=null,stopMeter=null,detached=false,success=false,latestCheck=0
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const request=async(path,body)=>{
    // Media is downloaded in the APP, while this extension awaits its receipt.
    // Keep liveness local; a long download must not masquerade as a disconnected browser.
    const longReport=config.captureEvidence&&path==='/video-discovery-report'
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),longReport?600000:5000)
    const heartbeat=longReport?setInterval(()=>{void fetchApi(config.origin+'/video-discovery-state',{headers,signal:AbortSignal.timeout(5000)})
      .then(async response=>{if(!response.ok)throw Error();const state=await response.json();if(state.id!==config.batchId||['cancelled','blocked'].includes(state.phase))controller.abort()})
      .catch(()=>controller.abort())},5000):null
    try{
      const response=await fetchApi(config.origin+path,{headers,signal:controller.signal,...(body?{method:'POST',body:JSON.stringify(body)}:{})})
      if(!response.ok)throw Error('VIDEO_APP_UNAVAILABLE')
      return await response.json()
    }finally{clearTimeout(timeout);if(heartbeat)clearInterval(heartbeat)}
  }
  const active=async()=>{
    if(detached)throw Error('VIDEO_BROWSER_DISCONNECTED')
    if(Date.now()>deadline)throw Error('VIDEO_READ_TIMEOUT')
    if(Date.now()-latestCheck>=500){
      const state=await request('/video-discovery-state')
      if(state.state!=='running'||state.id!==config.batchId)throw Error('VIDEO_CANCELLED')
      latestCheck=Date.now()
    }
    if(list?.fatalError)throw Error(list.fatalError)
  }
  const send=async(method,params={})=>{
    let timer
    try{return await Promise.race([chrome.debugger.sendCommand(target,method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('VIDEO_COMMAND_TIMEOUT')),10000)})])}
    finally{clearTimeout(timer)}
  }
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails)throw Error('VIDEO_PAGE_EXECUTION_FAILED')
    return result.result?.value
  }
  const guard=async()=>{
    await active()
    const page=await chrome.tabs.get(target.tabId)
    const url=new URL(page.url||'about:blank')
    if(url.origin!=='https://www.douyin.com'||decodeURIComponent(url.pathname)!=='/user/'+config.authorSecUid)throw Error('VIDEO_PAGE_CHANGED')
    const code=await evaluate(`(${readCreatorActivityGuard.toString()})()`)
    if(code)throw Error(code)
  }
  const onDetach=source=>{if(source.tabId===target?.tabId)detached=true}
  let report
  try {
    await active()
    const tab=await chrome.tabs.create({url:'about:blank',active:false});target={tabId:tab.id}
    await chrome.debugger.attach(target,'1.3');chrome.debugger.onDetach.addListener(onDetach)
    stopMeter=meterCreatorActivityRequests(chrome,target,audit)
    owner=observeCreatorActivityOwner(chrome,target,{...config,firstAuthorSecUid:config.authorSecUid})
    await send('Page.enable')
    list=await observeCreatorActivity(chrome,target,config.authorSecUid,{lazy:true,project:input=>projectDiscoveryPage(input,config)})
    await active()
    const navigationStartedAt=owner.beginNavigation();audit.authorHomepageNavigations++
    owner.bindNavigation(await send('Page.navigate',{url:'https://www.douyin.com/user/'+encodeURIComponent(config.authorSecUid)}))
    const readyDeadline=Date.now()+12000
    while(true){
      await active()
      let ready
      try{ready=await evaluate(`(${readCreatorPageReadiness.toString()})(${JSON.stringify({secUid:config.authorSecUid})},(${readCreatorActivityGuard.toString()}))`)}
      catch(error){if(classifyActivityCommandError(error)!=='EXECUTION_CONTEXT_UNAVAILABLE')throw error}
      if(ready?.errorCode)throw Error(ready.errorCode)
      if(ready?.ready)break
      if(Date.now()>readyDeadline)throw Error('VIDEO_PAGE_NOT_READY')
      await pause(100)
    }
    await guard()
    let page=await list.availablePage(0,{active,waitMs:5000,arrivalWaitMs:5000,...nativeWaitOptions})
    const needsGet=page.errorCode==='ACTIVITY_NATIVE_LIST_UNAVAILABLE'&&list.nativeListRequests===0
    if(page.errorCode&&!needsGet)throw Error(page.errorCode)
    await guard()
    const nativeOwner=await owner.result({active});owner.stop()
    if(nativeOwner?.errorCode)throw Error(nativeOwner.errorCode)
    let ownerVerification=nativeOwner?.proof
    if(!ownerVerification){
      audit.ownerVerificationGets++
      const self=await evaluate(`(${readCreatorActivityOwner.toString()})(${JSON.stringify({runId:config.runId,ownerSecUid:config.ownerSecUid,ownerUid:config.ownerUid})})`)
      if(!self?.ok)throw Error(self?.code||'ACCOUNT_VERIFICATION_FAILED')
      ownerVerification={contract:'signaldesk-activity-owner/v1',kind:'active-get',runId:config.runId,
        uid:self.owner.uid,secUid:self.owner.secUid,endpoint:'/aweme/v1/web/user/profile/self/',method:'GET',httpStatus:200,
        observedAt:self.observedAt,navigationStartedAt,firstAuthorSecUid:config.authorSecUid,tabId:target.tabId}
    }
    let cursor=config.cursor
    for(let pageIndex=0;pageIndex<20;pageIndex++){
      await guard()
      if(cursor!==0)page=await list.availablePage(cursor,{active,waitMs:1200,arrivalWaitMs:200})
      const missing=page.errorCode==='ACTIVITY_NATIVE_LIST_UNAVAILABLE'
      if(page.errorCode&&!missing)throw Error(page.errorCode)
      if(missing){
        audit.activeWorkGets++
        page=await evaluate(`(${fetchCreatorActivityPage.toString()})(${JSON.stringify({runId:config.runId,secUid:config.authorSecUid,cursor})},root=>(${projectDiscoveryPage.toString()})(root,${JSON.stringify(pageScope)},(${classifyActivityVisibility.toString()}),(${projectVideoInformation.toString()})))`)
        if(!page||page.errorCode)throw Error(page?.errorCode||'VIDEO_RESPONSE_UNAVAILABLE')
      }
      const receipt=await request('/video-discovery-report',{runId:config.runId,batchId:config.batchId,creatorId:config.creatorId,
        ownerVerification,page:page.root,sourceProof:page.sourceProof,checkedAt:new Date().toISOString()})
      if(receipt.stop){success=true;break}
      cursor=page.root.max_cursor
      if(pageIndex===19)await request('/video-discovery-end',{runId:config.runId,batchId:config.batchId,partial:true})
    }
  }catch(error){
    const errorCode=/^[A-Z0-9_-]{1,100}$/.test(error?.message)?error.message:'VIDEO_READ_FAILED'
    report={runId:config.runId,batchId:config.batchId,errorCode,audit:{...audit}}
    await request('/video-discovery-end',report).catch(()=>{})
  }finally{
    owner?.stop();stopMeter?.();await list?.stop()
    chrome.debugger.onDetach.removeListener(onDetach)
    if(target){try{await chrome.debugger.detach(target)}catch{};if(success)try{await chrome.tabs.remove(target.tabId)}catch{}}
  }
  return report
}
