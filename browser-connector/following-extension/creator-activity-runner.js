import {projectCreatorActivityResponse, classifyActivityVisibility} from './creator-activity-network.js'
import {observeActivityDiagnostics,captureActivityFailure,traceActivityCommands,freezeActivityFailure} from './creator-activity-diagnostics.js'
import {readCreatorActivityOwner,meterCreatorActivityRequests} from './creator-activity-context.js'
import {observeCreatorActivityOwner} from './creator-activity-owner-network.js'

// Existing user-selected total source; the work LIST is obtained only from JSON network responses.
export async function readCreatorProfileCount(scope) {
  const selector='#semiTabpost [data-e2e="user-tab-count"]',profileUrl='https://www.douyin.com/user/'+encodeURIComponent(scope.secUid)
  const deadline=Date.now()+10_000
  let prior=null,stableSince=0
  while(Date.now()<deadline){
    if(location.origin!=='https://www.douyin.com'||decodeURIComponent(location.pathname)!=='/user/'+scope.secUid)return {count:null,errorCode:'PROFILE_PAGE_MISMATCH'}
    const tab=document.getElementById('semiTabpost'),element=document.querySelector(selector),text=element?.textContent?.trim()||''
    const visible=element&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'
    const label=tab?.querySelector('h2 span:first-child')?.textContent?.trim()
    if(document.readyState==='complete'&&visible&&label==='作品'&&/^\d+(?:,\d{3})*$/.test(text)){
      if(text!==prior){prior=text;stableSince=Date.now()}
      else if(Date.now()-stableSince>=500){
        const count=Number(text.replaceAll(',',''))
        if(Number.isSafeInteger(count)&&count>=0)return {count,text,profileUrl,secUid:scope.secUid,checkedAt:new Date().toISOString(),selector}
      }
    }else{prior=null;stableSince=0}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  return {count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}
}

export async function fetchCreatorActivityPage(scope, project) {
  const cancellation={runId:scope.runId,cancelled:false,controller:new AbortController()}
  globalThis.__signalDeskCreatorActivity=cancellation
  const deadline=setTimeout(()=>cancellation.controller.abort(),8000)
  const diagnostic={cursor:scope.cursor,stage:'context',httpStatus:null,json:'pending',errorCode:null}
  let activeRequest=false
  try {
    if(location.origin!=='https://www.douyin.com'||location.pathname!=='/user/'+scope.secUid)throw Error('ACTIVITY_PAGE_MISMATCH')
    const parameters={device_platform:'webapp',aid:'6383',channel:'channel_pc_web',publish_video_strategy_type:'2',pc_client_type:'1',
      version_code:'170400',version_name:'17.4.0',update_version_code:'170400',pc_libra_divert:'Windows',
      sec_user_id:scope.secUid,count:'20',max_cursor:String(scope.cursor)}
    diagnostic.stage='request';activeRequest=true
    const response=await fetch('/aweme/v1/web/aweme/post/?'+new URLSearchParams(parameters),
      {method:'GET',credentials:'include',signal:cancellation.controller.signal,cache:'no-store',redirect:'error'})
    diagnostic.stage='response';diagnostic.httpStatus=response.status
    if(response.status!==200)throw new Error('ACTIVITY_HTTP_'+response.status)
    if(response.redirected)throw Error('ACTIVITY_RESPONSE_REDIRECTED')
    const text=await response.text()
    diagnostic.stage='body'
    if(text.length>4*1024*1024)throw new Error('ACTIVITY_BODY_TOO_LARGE')
    let root;try{root=JSON.parse(text);diagnostic.json='valid'}catch{diagnostic.json='invalid';throw new Error('ACTIVITY_JSON_UNAVAILABLE')}
    diagnostic.stage='projection'
    const projected=project(root)
    if(cancellation.cancelled)throw Error('ACTIVITY_SESSION_ENDED')
    if(location.origin!=='https://www.douyin.com'||location.pathname!=='/user/'+scope.secUid)throw Error('ACTIVITY_PAGE_MISMATCH')
    diagnostic.stage='complete'
    return {root:projected,sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:scope.secUid,
      requestCursor:scope.cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest,diagnostic}
  }catch(error){
    const errorCode=cancellation.cancelled?'ACTIVITY_SESSION_ENDED':cancellation.controller.signal.aborted?'ACTIVITY_REQUEST_TIMEOUT':/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'ACTIVITY_REQUEST_FAILED'
    diagnostic.errorCode=errorCode
    return {errorCode,activeRequest,diagnostic}
  }
  finally{clearTimeout(deadline);if(globalThis.__signalDeskCreatorActivity===cancellation)delete globalThis.__signalDeskCreatorActivity}
}

// Runs in the extension. readPage supplies an explicit first or later-page
// GET; no page selectors, DOM fallback or per-work detail requests are used here.
export async function readCreatorActivityPage(scope,{readPage,active=async()=>{},nativeRequests=()=>0}={}) {
  const started = performance.now(), id = /^[A-Za-z0-9._-]{1,240}$/
  let requests = 0, reusedNativePages=0, profile, failure = null
  const pages = [], seen = new Set(), cursors = new Set([0]),start=Date.parse(scope.weekStart)
  try {
    // Saved native identity is used only for weekly author verification, never to fetch a count.
    profile={uid:String(scope.uid||''),secUid:scope.secUid,workCount:null}
    if(!id.test(profile.uid)||profile.secUid!==scope.secUid||(scope.uid&&profile.uid!==scope.uid))throw new Error('ACTIVITY_AUTHOR_MISMATCH')
    let cursor=0,previousTime=Infinity,ordered=true
    for(let index=0;index<10;index++){
      await active()
      const result=await readPage(cursor)
      if(result.activeRequest)requests++
      if(result.errorCode)throw new Error(result.errorCode)
      const {root,sourceProof}=result
      if(sourceProof?.secUid!==scope.secUid||sourceProof.requestCursor!==cursor||sourceProof.httpStatus!==200||sourceProof.method!=='GET'
        ||sourceProof.endpoint!=='/aweme/v1/web/aweme/post/'||sourceProof.kind!=='active-get')throw new Error('ACTIVITY_SOURCE_UNVERIFIED')
      if(!Array.isArray(root.aweme_list)||root.aweme_list.length>200||![true,false,0,1].includes(root.has_more))throw new Error('ACTIVITY_LIST_SCHEMA_INVALID')
      const records=root.aweme_list.map(row=>{
        const authorUid=String(row.author?.uid||''),authorSecUid=row.author?.sec_uid,workId=String(row.aweme_id||'')
        if(!id.test(authorUid)||!id.test(authorSecUid||'')||!/^\d{8,30}$/.test(workId)
          ||((authorUid===profile.uid)!==(authorSecUid===scope.secUid)))throw new Error('ACTIVITY_WORK_AUTHOR_OR_TIME_INVALID')
        const time=row.create_time,item={workId,authorUid,authorSecUid,
          publishedAt:Number.isSafeInteger(time)&&time>0?new Date(time*1000).toISOString():null,
          pinned:[true,false,0,1].includes(row.is_top)?row.is_top===true||row.is_top===1:null,
          visibility:{privateStatus:row.status?.private_status??null,isDelete:row.status?.is_delete??null,isProhibited:row.status?.is_prohibited??null,
            allowShare:row.status?.allow_share??null,isStory:row.is_story??null,is24Story:row.is_24_story??null,awemeType:row.aweme_type??null}}
        if(authorUid===profile.uid&&classifyActivityVisibility(item.visibility)==='public'&&!item.publishedAt)throw new Error('ACTIVITY_WORK_AUTHOR_OR_TIME_INVALID')
        return item
      })
      const hasMore=root.has_more===true||root.has_more===1,next=Number.isSafeInteger(root.max_cursor)&&root.max_cursor>=0?root.max_cursor:null
      if(hasMore&&(next===null||next===cursor))throw new Error('ACTIVITY_PAGINATION_STALLED')
      if(hasMore&&cursors.has(next))throw new Error('ACTIVITY_PAGINATION_STALLED')
      let newCount=0
      for(const item of records){if(seen.has(item.workId))continue;seen.add(item.workId);newCount++}
      let crossed=false
      for(const item of records){
        if(item.authorUid!==profile.uid)continue
        if(item.pinned===null||!item.publishedAt)ordered=false
        else if(!item.pinned){const time=Date.parse(item.publishedAt);if(time>previousTime)ordered=false;previousTime=time;if(time<start)crossed=true}
      }
      if(hasMore&&!newCount)throw new Error(root.aweme_list.length?'ACTIVITY_REPEATED_PAGE':'ACTIVITY_EMPTY_PAGE_WITH_MORE')
      pages.push({requestCursor:cursor,responseCursor:next,hasMore,items:[],excludedAuthors:[],excludedNonPublic:[],records,sourceProof})
      if(sourceProof.kind==='native-network')reusedNativePages++
      if(!hasMore||(ordered&&crossed))break
      cursors.add(next)
      cursor=next
      if(index===9)failure='ACTIVITY_PAGE_LIMIT'
    }
  }catch(error){failure=/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'ACTIVITY_READ_FAILED'}
  if(!profile||!id.test(profile.uid)||profile.secUid!==scope.secUid||(scope.uid&&profile.uid!==scope.uid))return {ok:false,code:failure||'ACTIVITY_AUTHOR_MISMATCH'}
  return {ok:true,capture:{contract:'signaldesk-creator-activity/v7',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:scope.ownerSecUid,requestedSecUid:scope.secUid,profile,
    frontendCount:scope.frontendCount||{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'},
    checkedAt:new Date().toISOString(),weekStart:scope.weekStart,weekEndExclusive:scope.weekEndExclusive,pages,errorCode:failure,
    activeApiRequests:requests,reusedNativePages,nativeListRequests:nativeRequests(),acquisitionMs:performance.now()-started}}
}

export async function runCreatorActivityRefresh(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch}={}){
  const trace=traceActivityCommands(chromeApi)
  const chrome={...chromeApi,debugger:{...chromeApi.debugger,sendCommand:trace.sendCommand}},headers={authorization:`Bearer ${config.token}`,'content-type':'application/json'}
  const post=async(path,body)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
    try{const response=await fetchApi(config.origin+path,{method:'POST',headers,body:JSON.stringify({runId:config.runId,...body}),signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'ACTIVITY_SESSION_REJECTED');return result}
    finally{clearTimeout(timer)}
  }
  const active=async()=>{const response=await fetchApi(config.origin+'/activity-state',{headers});const state=await response.json();if(!response.ok||state.runId!==config.runId||state.phase!=='running')throw new Error('ACTIVITY_SESSION_ENDED');return state}
  let target,heartbeat,profileTabId,observer,stopMeter,ownerObserver,navigationStartedAt,firstFrontendCount,currentAuthor,stage='preparing-context',failureSaved=false,diagnosticSaveFailed=false
  let attempts=[]
  let failureCapturePromise=null,preserveFailureTab=false
  const requestAudit={contextSource:'first-author-page',accountPageNavigations:0,ownerVerificationGets:0,authorHomepageNavigations:0,
    ownerVerificationSource:'pending',nativeOwnerRequestsObserved:0,
    networkRequestsObserved:0,platformApiGetsObserved:0,selfGetsObserved:0,listGetsObserved:0}
  const detach=async()=>{
    if(observer){observer.stop();observer=null}
    if(stopMeter){stopMeter();stopMeter=null}
    if(target){try{await chrome.debugger.detach(target)}catch{};target=null}
  }
  const prepareAuthor=async(author,first=false)=>{
    currentAuthor=author;attempts=[];failureSaved=false;stage='preparing-context'
    await active()
    if(!profileTabId){const page=await chrome.tabs.create({url:'about:blank',active:false});profileTabId=page.id}
    await detach();target={tabId:profileTabId};trace.setTarget(profileTabId);await chrome.debugger.attach(target,'1.3')
    stopMeter=meterCreatorActivityRequests(chrome,target,requestAudit)
    if(first){
      ownerObserver=observeCreatorActivityOwner(chrome,target,{runId:config.runId,ownerSecUid:config.ownerSecUid,ownerUid:config.ownerUid,firstAuthorSecUid:author.secUid})
      await chrome.debugger.sendCommand(target,'Page.enable')
    }
    observer=await observeActivityDiagnostics(chrome,target,author.secUid)
    await active()
    requestAudit.authorHomepageNavigations++
    if(first)navigationStartedAt=ownerObserver.beginNavigation()
    const navigation=await chrome.debugger.sendCommand(target,'Page.navigate',{url:'https://www.douyin.com/user/'+encodeURIComponent(author.secUid)})
    if(first)ownerObserver.bindNavigation(navigation)
    const deadline=Date.now()+12000
    do{
      await active()
      const page=await chrome.tabs.get(profileTabId)
      if(page.status==='complete'&&page.url==='https://www.douyin.com/user/'+encodeURIComponent(author.secUid))return
      if(Date.now()>=deadline)throw Error('AUTHOR_CONTEXT_TIMEOUT')
      await new Promise(resolve=>setTimeout(resolve,100))
    }while(true)
  }
  const saveFailure=async code=>{
    if(failureSaved||!currentAuthor||code==='ACTIVITY_SESSION_ENDED')return
    if(failureCapturePromise)return failureCapturePromise
    // Freeze synchronously before any await, screenshot or local APP request.
    preserveFailureTab=!!profileTabId
    if(heartbeat){clearInterval(heartbeat);heartbeat=null}
    const frozen=freezeActivityFailure(target,currentAuthor,observer,code,stage,attempts,trace)
    failureCapturePromise=(async()=>{
      const cache=async diagnostic=>{if(chrome.storage?.local)await chrome.storage.local.set({signalDeskLatestFailure:{runId:config.runId,diagnostic}})}
      // Independent copies survive APP write failures. A receipt precedes cleanup.
      await cache(frozen).catch(()=>{})
      const early=post('/activity-progress',{failureDiagnostic:frozen}).catch(()=>null)
      const failureDiagnostic=await captureActivityFailure(chrome,target,currentAuthor,observer,code,stage,attempts,trace,frozen)
      await cache(failureDiagnostic).catch(()=>{})
      await early
      await post('/activity-progress',{failureDiagnostic});failureSaved=true
    })()
    return failureCapturePromise
  }
  try{
    await active()
    await post('/activity-progress',{stage:'preparing-context'})
    if(!config.targets?.length)throw Error('ACTIVITY_TARGETS_UNAVAILABLE')
    // This homepage is needed for count/list in every run. Use its NEW native
    // owner response too, without a preliminary page or a redundant owner GET.
    await prepareAuthor(config.targets[0],true)
    heartbeat=setInterval(()=>{void active().catch(()=>{
      if(target)void chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:`(()=>{const s=globalThis.__signalDeskCreatorActivity;if(s?.runId===${JSON.stringify(config.runId)}){s.cancelled=true;s.controller?.abort()}})()`}).catch(()=>{})
    })},1000)
    // The frontend count is required anyway. Read it while the native owner
    // response finishes, rather than adding a delay or deciding fallback too soon.
    await active()
    stage='reading-count'
    const firstCount=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
      expression:`(${readCreatorProfileCount.toString()})(${JSON.stringify(config.targets[0])})`})
    firstFrontendCount=firstCount.exceptionDetails||!firstCount.result?.value?{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}:firstCount.result.value
    stage='verifying-owner';await active();await post('/activity-progress',{stage})
    const nativeOwner=await ownerObserver.result({active})
    requestAudit.nativeOwnerRequestsObserved=ownerObserver.observedRequests
    requestAudit.ownerSourceDiagnostics=ownerObserver.diagnostics()
    ownerObserver.stop();ownerObserver=null
    if(nativeOwner?.errorCode)throw Error(nativeOwner.errorCode)
    let ownerVerification=nativeOwner?.proof
    if(ownerVerification)requestAudit.ownerVerificationSource='native-network'
    else{
      requestAudit.ownerVerificationGets++
      const self=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(${readCreatorActivityOwner.toString()})(${JSON.stringify({runId:config.runId,ownerSecUid:config.ownerSecUid,ownerUid:config.ownerUid})})`})
      await active()
      if(self.exceptionDetails)throw Error('ACCOUNT_VERIFICATION_FAILED')
      if(!self.result.value?.ok)throw Error(self.result.value?.code||'ACCOUNT_VERIFICATION_FAILED')
      ownerVerification={contract:'signaldesk-activity-owner/v1',kind:'active-get',runId:config.runId,
        uid:self.result.value.owner.uid,secUid:self.result.value.owner.secUid,endpoint:'/aweme/v1/web/user/profile/self/',method:'GET',
        httpStatus:200,observedAt:self.result.value.observedAt,navigationStartedAt,firstAuthorSecUid:config.targets[0].secUid,tabId:target.tabId}
      requestAudit.ownerVerificationSource='active-get'
    }
    await active()
    await post('/activity-progress',{ownerVerification,requestAudit:{...requestAudit}})
    for(const [index,author] of config.targets.entries()){
      await active();await post('/activity-progress',{currentId:author.id,stage:'reading-author'})
      if(index!==0)await prepareAuthor(author)
      await active()
      stage='reading-count'
      const counted=index===0?null:await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(${readCreatorProfileCount.toString()})(${JSON.stringify(author)})`})
      const frontendCount=index===0?firstFrontendCount:counted.exceptionDetails||!counted.result?.value?{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}:counted.result.value
      await active()
      stage='reading-list'
      const result=await readCreatorActivityPage({...author,frontendCount,runId:config.runId,ownerSecUid:config.ownerSecUid,
        weekStart:config.weekStart,weekEndExclusive:config.weekEndExclusive},{active,nativeRequests:()=>observer.nativeListRequests,
        readPage:async cursor=>{
          await active()
          // An already observed access rejection is a stop, never a retry trigger.
          if(observer.denial)return {errorCode:observer.denial,activeRequest:false}
          observer.beginExplicit()
          let value
          try{
            const evaluated=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
              expression:`(${fetchCreatorActivityPage.toString()})(${JSON.stringify({runId:config.runId,secUid:author.secUid,cursor})},(${projectCreatorActivityResponse.toString()}))`})
            value=evaluated.exceptionDetails||!evaluated.result?.value?{errorCode:'ACTIVITY_PAGE_EXECUTION_FAILED',activeRequest:true}:evaluated.result.value
          }catch{value={errorCode:'ACTIVITY_PAGE_EXECUTION_FAILED',activeRequest:true}}
          attempts.push(value.diagnostic||{cursor,stage:'execution',httpStatus:null,json:'pending',errorCode:value.errorCode})
          if(value.errorCode)try{await saveFailure(value.errorCode)}catch{diagnosticSaveFailed=true}
          return value
        }})
      const failure=result?.code||result?.capture?.errorCode||(frontendCount?.count===null?frontendCount.errorCode:null)
      if(failure)try{await saveFailure(failure)}catch{diagnosticSaveFailed=true}
      await active()
      stage='saving'
      const saved=await post('/activity-report',{creatorId:author.id,...(result?.ok?{capture:result.capture}:{errorCode:result?.code||'ACTIVITY_READ_FAILED'})})
      await post('/activity-progress',{requestAudit:{...requestAudit}})
      if(failure)throw new Error(failure)
      if(saved.failed>0)throw Error('ACTIVITY_VALIDATION_INCOMPLETE')
      await new Promise(resolve=>setTimeout(resolve,200))
    }
    return await post('/activity-progress',{finished:true,requestAudit:{...requestAudit}})
  }catch(error){if(ownerObserver){requestAudit.nativeOwnerRequestsObserved=ownerObserver.observedRequests;requestAudit.ownerSourceDiagnostics=ownerObserver.diagnostics()}const code=/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'ACTIVITY_READ_FAILED';try{await saveFailure(code);if(failureSaved)diagnosticSaveFailed=false}catch{diagnosticSaveFailed=true}try{await post('/activity-progress',{blocked:true,errorCode:code,diagnosticSaveFailed,requestAudit:{...requestAudit}})}catch{};return {phase:'blocked'}}
  finally{if(heartbeat)clearInterval(heartbeat);if(ownerObserver)ownerObserver.stop();if(observer)await observer.stop();await detach();trace.stop();if(profileTabId&&!preserveFailureTab)try{await chrome.tabs.remove(profileTabId)}catch{}}
}
