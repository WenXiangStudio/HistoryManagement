import {projectCreatorActivityResponse, classifyActivityVisibility,creatorWorkBelongsTo,observeCreatorActivity,recoverableNativeListErrors} from './creator-activity-network.js'
import {observeActivityDiagnostics,captureActivityFailure,traceActivityCommands,freezeActivityFailure,classifyActivityCommandError} from './creator-activity-diagnostics.js'
import {readCreatorActivityOwner,meterCreatorActivityRequests} from './creator-activity-context.js'
import {observeCreatorActivityOwner} from './creator-activity-owner-network.js'
import {waitForCreatorRefresh,finishInterruptedWait} from './creator-activity-pacing.js'
import {createCreatorActivityRecovery,readCreatorRecoveryPage,readCreatorActivityPendingResult,RECOVERABLE_ACTIVITY_ERRORS} from './creator-activity-recovery.js'

function activityReadError(error){
  if(/^[A-Z0-9_-]{1,100}$/.test(error?.message))return error.message
  const classified=classifyActivityCommandError(error)
  return classified==='COMMAND_FAILED'?'ACTIVITY_READ_FAILED':classified
}

export function readCreatorActivityGuard(){
  const visible=element=>!!element&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'
  const panels=[...document.querySelectorAll('[role="dialog"],iframe[src*="verify"],iframe[src*="captcha"],.captcha_verify_container')].filter(visible)
  if(panels.some(element=>element.tagName==='IFRAME'||/安全验证|验证码|完成验证|访问过于频繁/.test(element.textContent||'')))return 'CAPTCHA_OR_SECURITY_CHALLENGE'
  const text=(document.body?.innerText||'').slice(0,20000)
  if(!document.querySelector('#semiTabpost')&&/安全验证|验证码|完成验证|访问过于频繁/.test(text))return 'CAPTCHA_OR_SECURITY_CHALLENGE'
  if(!document.querySelector('#semiTabpost')&&/登录后查看|请登录|扫码登录/.test(text))return 'LOGIN_REQUIRED'
  return null
}

// Only observe readiness: this does not fetch, click, dismiss challenges or accept author data.
export function readCreatorPageReadiness(scope,guard=()=>null){
  const blocked=guard();if(blocked)return {ready:false,errorCode:blocked}
  if(location.origin!=='https://www.douyin.com'||decodeURIComponent(location.pathname)!=='/user/'+scope.secUid)return {ready:false}
  if(document.readyState==='complete')return {ready:true}
  const tab=document.getElementById('semiTabpost'),count=tab?.querySelector('[data-e2e="user-tab-count"]')
  const visible=count&&count.getClientRects().length>0&&getComputedStyle(count).visibility!=='hidden'
  const text=count?.textContent?.trim()||'',label=tab?.querySelector('h2 span:first-child')?.textContent?.trim()
  return {ready:document.readyState==='interactive'&&!!visible&&label==='作品'&&/^\d+(?:,\d{3})*$/.test(text)}
}

// Existing user-selected total source; the work LIST is obtained only from JSON network responses.
export async function readCreatorProfileCount(scope,guard=()=>null) {
  const selector='#semiTabpost [data-e2e="user-tab-count"]',profileUrl='https://www.douyin.com/user/'+encodeURIComponent(scope.secUid)
  const deadline=Date.now()+10_000
  let prior=null,stableSince=0
  while(Date.now()<deadline){
    const blocked=guard();if(blocked)return {count:null,errorCode:blocked}
    if(location.origin!=='https://www.douyin.com'||decodeURIComponent(location.pathname)!=='/user/'+scope.secUid)return {count:null,errorCode:'PROFILE_PAGE_MISMATCH'}
    const tab=document.getElementById('semiTabpost'),element=document.querySelector(selector),text=element?.textContent?.trim()||''
    const visible=element&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'
    const label=tab?.querySelector('h2 span:first-child')?.textContent?.trim()
    if(['interactive','complete'].includes(document.readyState)&&visible&&label==='作品'&&/^\d+(?:,\d{3})*$/.test(text)){
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
  let activeRequest=false,cache
  const finish=value=>{if(cache)cache.value=value;return value}
  try {
    if(location.origin!=='https://www.douyin.com'||location.pathname!=='/user/'+scope.secUid)throw Error('ACTIVITY_PAGE_MISMATCH')
    if(scope.readToken){
      globalThis.__signalDeskCreatorActivityReads??={}
      cache={runId:scope.runId,secUid:scope.secUid,cursor:scope.cursor,value:null}
      globalThis.__signalDeskCreatorActivityReads[scope.readToken]=cache
    }
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
    return finish({root:projected,sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:scope.secUid,
      requestCursor:scope.cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest,diagnostic})
  }catch(error){
    const errorCode=cancellation.cancelled?'ACTIVITY_SESSION_ENDED':cancellation.controller.signal.aborted?'ACTIVITY_REQUEST_TIMEOUT':/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'ACTIVITY_REQUEST_FAILED'
    diagnostic.errorCode=errorCode
    return finish({errorCode,activeRequest,diagnostic})
  }
  finally{clearTimeout(deadline);if(globalThis.__signalDeskCreatorActivity===cancellation)delete globalThis.__signalDeskCreatorActivity}
}

// Runs in the extension. readPage supplies an explicit first or later-page
// GET; no page selectors, DOM fallback or per-work detail requests are used here.
export async function readCreatorActivityPage(scope,{readPage,active=async()=>{},nativeRequests=()=>0,onPage=()=>{}}={}) {
  const started = performance.now(), id = /^[A-Za-z0-9._-]{1,240}$/
  let requests = 0, reusedNativePages=0, profile, failure = null
  const pages = [], seen = new Set(), cursors = new Set([0]),start=Date.parse(scope.weekStart)
  try {
    // Saved native identity is used only for weekly author verification, never to fetch a count.
    profile={uid:String(scope.uid||''),secUid:scope.secUid,workCount:null}
    if(!id.test(profile.uid)||profile.secUid!==scope.secUid||(scope.uid&&profile.uid!==scope.uid))throw new Error('ACTIVITY_AUTHOR_MISMATCH')
    let cursor=0,previousTime=Infinity,ordered=true
    const pageLimit=scope.repair?200:10
    for(let index=0;index<pageLimit;index++){
      await active()
      const result=await readPage(cursor)
      if(result.activeRequest)requests++
      if(result.errorCode)throw new Error(result.errorCode)
      const {root,sourceProof}=result
      if(sourceProof?.secUid!==scope.secUid||sourceProof.requestCursor!==cursor||sourceProof.httpStatus!==200||sourceProof.method!=='GET'
        ||sourceProof.endpoint!=='/aweme/v1/web/aweme/post/'||(!['native-network','active-get'].includes(sourceProof.kind))
        ||(sourceProof.kind==='native-network'&&!scope.optimized))throw new Error('ACTIVITY_SOURCE_UNVERIFIED')
      if(!Array.isArray(root.aweme_list)||root.aweme_list.length>200||![true,false,0,1].includes(root.has_more))throw new Error('ACTIVITY_LIST_SCHEMA_INVALID')
      const records=root.aweme_list.map(row=>{
        const authorUid=String(row.author?.uid||''),authorSecUid=row.author?.sec_uid,workId=String(row.aweme_id||'')
        if(!id.test(authorUid)||!id.test(authorSecUid||'')||!/^\d{8,30}$/.test(workId))throw new Error('ACTIVITY_WORK_AUTHOR_OR_TIME_INVALID')
        const time=row.create_time,item={workId,authorUid,authorSecUid,profileOwner:{uid:profile.uid,secUid:scope.secUid},
          publishedAt:Number.isSafeInteger(time)&&time>0?new Date(time*1000).toISOString():null,
          pinned:[true,false,0,1].includes(row.is_top)?row.is_top===true||row.is_top===1:null,
          visibility:{privateStatus:row.status?.private_status??null,isDelete:row.status?.is_delete??null,isProhibited:row.status?.is_prohibited??null,
            allowShare:row.status?.allow_share??null,isStory:row.is_story??null,is24Story:row.is_24_story??null,awemeType:row.aweme_type??null}}
        if(classifyActivityVisibility(item.visibility)==='public'&&!item.publishedAt)throw new Error('ACTIVITY_WORK_AUTHOR_OR_TIME_INVALID')
        return item
      })
      const hasMore=root.has_more===true||root.has_more===1,next=Number.isSafeInteger(root.max_cursor)&&root.max_cursor>=0?root.max_cursor:null
      if(hasMore&&(next===null||next===cursor))throw new Error('ACTIVITY_PAGINATION_STALLED')
      if(hasMore&&cursors.has(next))throw new Error('ACTIVITY_PAGINATION_STALLED')
      let newCount=0
      for(const item of records){if(seen.has(item.workId))continue;seen.add(item.workId);newCount++}
      let crossed=false
      for(const item of records){
        if(!creatorWorkBelongsTo(item,profile.uid,profile.secUid))continue
        if(item.pinned===null||!item.publishedAt)ordered=false
        else if(!item.pinned){const time=Date.parse(item.publishedAt);if(time>previousTime)ordered=false;previousTime=time;if(time<start)crossed=true}
      }
      if(hasMore&&!newCount)throw new Error(root.aweme_list.length?'ACTIVITY_REPEATED_PAGE':'ACTIVITY_EMPTY_PAGE_WITH_MORE')
      pages.push({requestCursor:cursor,responseCursor:next,hasMore,items:[],excludedAuthors:[],excludedNonPublic:[],records,sourceProof})
      onPage(pages.length)
      if(sourceProof.kind==='native-network')reusedNativePages++
      const comparison=compareActivityContinuity(pages,scope.comparisonBaseline,scope.frontendCount?.count,profile,new Date().toISOString())
      if(index===0&&!scope.baselinePolicy&&!scope.repair&&comparison?.increase>=10)break
      if(index===0&&!scope.baselinePolicy&&!scope.repair&&scope.baseline&&scope.frontendCount?.count===scope.baseline.workCount&&(!comparison||comparison.connected)){
        const fingerprint=latestCreatorWork(records,profile,hasMore)
        if(fingerprint.ready&&JSON.stringify(fingerprint.latest)===JSON.stringify(scope.baseline.latest)&&sourceProof.kind==='native-network'){
          return {ok:true,unchanged:{contract:'signaldesk-activity-unchanged/v1',ownerSecUid:scope.ownerSecUid,requestedSecUid:scope.secUid,authorUid:scope.uid,
            baselineSnapshotId:scope.baseline.snapshotId,frontendCount:scope.frontendCount,checkedAt:new Date().toISOString(),reason:'latest-unchanged',firstPage:pages[0],nativeListRequests:nativeRequests()}}
        }
      }
      const m=scope.comparisonBaseline?.timeBaseline??scope.comparisonBaseline?.latest?.publishedAt??scope.comparisonBaseline?.anchor?.publishedAt
      const reachedTimeBaseline=!m||Number.isFinite(previousTime)&&previousTime<=Date.parse(m)
      if(scope.baselinePolicy){
        const countBased=scope.baselinePolicy.version===2,cutoff=countBased?-Infinity:Date.parse(scope.baselinePolicy.windowStart),valid=new Map()
        let ordinaryRecent=0
        for(const page of pages)for(const item of page.records){
          if(valid.has(item.workId)||!creatorWorkBelongsTo(item,profile.uid,profile.secUid)||classifyActivityVisibility(item.visibility)!=='public'||!item.publishedAt)continue
          valid.set(item.workId,item)
          if(!item.pinned&&Date.parse(item.publishedAt)>=cutoff)ordinaryRecent++
        }
        if(!ordered)throw Error('ACTIVITY_BASELINE_ORDER_UNVERIFIED')
        if(!hasMore||ordinaryRecent>=scope.baselinePolicy.limit||!countBased&&previousTime<cutoff)break
      }else if(!hasMore||(ordered&&crossed&&reachedTimeBaseline&&(!scope.repair||scope.needsBaseline||comparison?.connected)))break
      cursors.add(next)
      cursor=next
      if(index===pageLimit-1||scope.repair&&performance.now()-started>90_000){failure=scope.repair?'ACTIVITY_REPAIR_LIMIT':'ACTIVITY_PAGE_LIMIT';break}
    }
  }catch(error){failure=activityReadError(error)}
  if(!profile||!id.test(profile.uid)||profile.secUid!==scope.secUid||(scope.uid&&profile.uid!==scope.uid))return {ok:false,code:failure||'ACTIVITY_AUTHOR_MISMATCH'}
  return {ok:true,capture:{contract:'signaldesk-creator-activity/v9',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},ownerSecUid:scope.ownerSecUid,requestedSecUid:scope.secUid,profile,
    frontendCount:scope.frontendCount||{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'},
    checkedAt:new Date().toISOString(),weekStart:scope.weekStart,weekEndExclusive:scope.weekEndExclusive,pages,errorCode:failure,
    activeApiRequests:requests,reusedNativePages,nativeListRequests:nativeRequests(),acquisitionMs:performance.now()-started}}
}

export function latestCreatorWork(records,profile,hasMore){
  let latest=null,ordinary=false
  for(const record of records){
    if(!creatorWorkBelongsTo(record,profile.uid,profile.secUid))continue
    const verdict=classifyActivityVisibility(record.visibility)
    if(verdict==='unknown'||record.pinned===null)return {ready:false,latest:null}
    if(record.pinned===false)ordinary=true
    if(verdict!=='public')continue
    if(!record.publishedAt||!Number.isFinite(Date.parse(record.publishedAt)))return {ready:false,latest:null}
    if(!latest||Date.parse(record.publishedAt)>Date.parse(latest.publishedAt)||(record.publishedAt===latest.publishedAt&&record.workId>latest.workId))latest={workId:record.workId,publishedAt:record.publishedAt}
  }
  return {ready:!hasMore||ordinary,latest}
}

// Browser-side stopping only; the main process independently validates IDs and continuity before promotion.
export function compareActivityContinuity(pages,baseline,count,profile,checkedAt=new Date().toISOString()){
  if(!baseline?.knownWorkIds||count===null||count===undefined)return null
  const works=new Map(),known=new Set(baseline.knownWorkIds)
  for(const page of pages)for(const record of page.records){
    if(creatorWorkBelongsTo(record,profile.uid,profile.secUid)&&classifyActivityVisibility(record.visibility)==='public'&&record.publishedAt)works.set(record.workId,record)
  }
  const m=baseline.timeBaseline??baseline.latest?.publishedAt??baseline.anchor?.publishedAt
  const increase=count-baseline.workCount,newPublicWorks=m?[...works.values()].filter(work=>Date.parse(work.publishedAt)>Date.parse(m)&&Date.parse(work.publishedAt)<=Date.parse(checkedAt)).length:0
  const complete=!!pages.length&&!pages.at(-1).hasMore&&works.size===count
  const invalid=new Set(baseline.invalidWorkIds??[]),restored=[...works.keys()].filter(id=>invalid.has(id)).length
  return {increase,newPublicWorks,connected:complete||(!!baseline.anchor&&works.has(baseline.anchor.workId)&&newPublicWorks+restored>=Math.max(0,increase))}
}

export async function runCreatorActivityRefresh(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch,waitOptions={},nativeWaitOptions={},recoveryOptions={}}={}){
  const trace=traceActivityCommands(chromeApi)
  const chrome={...chromeApi,debugger:{...chromeApi.debugger,sendCommand:trace.sendCommand}},headers={authorization:`Bearer ${config.token}`,'content-type':'application/json'}
  const post=async(path,body)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
    try{const response=await fetchApi(config.origin+path,{method:'POST',headers,body:JSON.stringify({runId:config.runId,...body}),signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'ACTIVITY_SESSION_REJECTED');return result}
    finally{clearTimeout(timer)}
  }
  const localActive=async()=>{const response=await fetchApi(config.origin+'/activity-state',{headers});const state=await response.json();if(!response.ok||state.runId!==config.runId||state.phase!=='running')throw new Error('ACTIVITY_SESSION_ENDED');if(config.pacing&&Date.now()>=Date.parse(config.weekEndExclusive))throw Error('ACTIVITY_WEEK_CHANGED');return state}
  const safely=operation=>recovery?recovery.run(operation):operation()
  const active=async()=>{await localActive();await safely(async()=>trace.assertConnected())}
  let target,heartbeat,profileTabId,observer,listObserver,stopMeter,ownerObserver,navigationStartedAt,firstFrontendCount,currentAuthor,stage='preparing-context',failureSaved=false,diagnosticSaveFailed=false
  let recovery=null,ownerConfirmed=false,preservedPages=0
  let attempts=[]
  let milestones=[],strategy='pending',countSame=null,retainedNative=null,retainedNetwork=null
  const mark=step=>{if(milestones.length<16)milestones.push({step,at:new Date().toISOString()})}
  const observation=(phase,errorCode=null)=>({contract:'signaldesk-activity-observation/v1',creatorId:currentAuthor.id,secUid:currentAuthor.secUid,
    capturedAt:new Date().toISOString(),phase,stage,strategy:phase==='failed'?'failed':strategy,countSame,errorCode,milestones:milestones.map(m=>({...m})),
    native:listObserver?.snapshot()??retainedNative,network:observer?.snapshot()??retainedNetwork??{events:[],documents:[],dropped:0,scriptExceptions:0},browser:trace.snapshot()})
  const persistObservation=async value=>{
    if(chrome.storage?.local)await chrome.storage.local.set({signalDeskLatestObservation:{runId:config.runId,observation:value}}).catch(()=>{})
    try{await post('/activity-progress',{readObservation:value})}catch{throw Error('ACTIVITY_OBSERVATION_SAVE_FAILED')}
  }
  let failureCapturePromise=null,preserveFailureTab=false
  const requestAudit={contextSource:'first-author-page',accountPageNavigations:0,ownerVerificationGets:0,authorHomepageNavigations:0,
    ownerVerificationSource:'pending',nativeOwnerRequestsObserved:0,
    networkRequestsObserved:0,platformApiGetsObserved:0,selfGetsObserved:0,listGetsObserved:0}
  const inspectRecovery=async()=>{
    if(observer?.denial)throw Error(observer.denial)
    if(listObserver?.fatalError&&!RECOVERABLE_ACTIVITY_ERRORS.has(listObserver.fatalError))throw Error(listObserver.fatalError)
    if(trace.detachReason==='canceled_by_user')throw Error('ACTIVITY_RECOVERY_USER_DETACHED')
    let page;try{page=await chrome.tabs.get(profileTabId)}catch{throw Error('ACTIVITY_RECOVERY_PAGE_UNAVAILABLE')}
    const matches=raw=>{try{const u=new URL(raw);return u.origin==='https://www.douyin.com'&&decodeURIComponent(u.pathname)==='/user/'+currentAuthor.secUid}catch{return false}}
    if(page.discarded)throw Error('ACTIVITY_RECOVERY_PAGE_UNAVAILABLE')
    if(!matches(page.url)||page.pendingUrl&&!matches(page.pendingUrl))throw Error('ACTIVITY_RECOVERY_PAGE_CHANGED')
    const values=await chrome.scripting.executeScript({target:{tabId:profileTabId},func:readCreatorRecoveryPage,
      args:[{secUid:currentAuthor.secUid}],world:'MAIN'})
    const state=values?.[0]?.result
    if(!state)throw Error('ACTIVITY_RECOVERY_PAGE_UNAVAILABLE')
    if(state.errorCode)throw Error(state.errorCode)
    return state
  }
  const makeRecovery=()=>createCreatorActivityRecovery({policy:config.recoveryPolicy,enabled:()=>ownerConfirmed,
    ...recoveryOptions,active:localActive,identity:()=>({creatorId:currentAuthor.id,secUid:currentAuthor.secUid}),preservedPages:()=>preservedPages,
    inspect:inspectRecovery,progress:value=>post('/activity-progress',{recovery:value,requestAudit:{...requestAudit}}),
    reconnect:async()=>{
      const attached=(await chrome.debugger.getTargets()).find(t=>t.tabId===profileTabId)?.attached
      if(attached&&trace.detached)throw Error('DEBUGGER_BUSY')
      if(!attached)await chrome.debugger.attach(target,'1.3')
      trace.reconnected();listObserver?.clearTransportFailure()
      await chrome.debugger.sendCommand(target,'Page.enable');await chrome.debugger.sendCommand(target,'Runtime.enable')
      await chrome.debugger.sendCommand(target,'Network.enable')
    },verify:async()=>{
      const deadline=Date.now()+12000
      while(!(await inspectRecovery()).ready){await localActive();if(Date.now()>=deadline)throw Error('ACTIVITY_RECOVERY_PAGE_UNAVAILABLE');await new Promise(r=>setTimeout(r,100))}
      requestAudit.ownerVerificationGets++;requestAudit.recoveryOwnerGets=(requestAudit.recoveryOwnerGets??0)+1
      const evaluated=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(${readCreatorActivityOwner.toString()})(${JSON.stringify({runId:config.runId,ownerSecUid:config.ownerSecUid,ownerUid:config.ownerUid})})`})
      const value=evaluated.result?.value
      if(evaluated.exceptionDetails||!value?.ok)throw Error(value?.code??'ACCOUNT_VERIFICATION_FAILED')
      if(value.owner?.secUid!==config.ownerSecUid||value.owner?.uid!==config.ownerUid)throw Error('OWNER_IDENTITY_MISMATCH')
      await inspectRecovery();trace.assertConnected()
    }})
  const detach=async()=>{
    if(listObserver){await listObserver.stop({keepNetworkEnabled:true});listObserver=null}
    if(observer){observer.stop();observer=null}
    if(stopMeter){stopMeter();stopMeter=null}
    if(target){trace.expectDetach(target.tabId);try{await chrome.debugger.detach(target)}catch{};target=null}
  }
  const releaseCompletedAuthor=async()=>{
    stage='releasing-context'
    retainedNative=listObserver?.snapshot()??retainedNative;retainedNetwork=observer?.snapshot()??retainedNetwork
    await detach()
    if(profileTabId){
      try{await chrome.tabs.remove(profileTabId)}catch(error){
        if(classifyActivityCommandError(error)!=='TARGET_UNAVAILABLE')throw Error('ACTIVITY_PAGE_RELEASE_FAILED')
      }
      profileTabId=null
    }
    mark('released')
    await persistObservation(observation('released'))
  }
  const waitProgress=async wait=>{
    stage=wait?(wait.kind==='batch'?'batch-rest':wait.kind==='resume'?'resume-wait':'author-wait'):'preparing-context'
    await post('/activity-progress',{wait})
  }
  const prepareAuthor=async(author,first=false)=>{
    currentAuthor=author;attempts=[];failureSaved=false;failureCapturePromise=null;stage='preparing-context'
    milestones=[];strategy='pending';countSame=null;retainedNative=null;retainedNetwork=null;trace.beginAuthor();preservedPages=0;recovery=null
    await active()
    if(!profileTabId){const page=await chrome.tabs.create({url:'about:blank',active:false});profileTabId=page.id}
    await detach();target={tabId:profileTabId};trace.setTarget(profileTabId);await chrome.debugger.attach(target,'1.3')
    if(config.recoveryPolicy)recovery=makeRecovery()
    stopMeter=meterCreatorActivityRequests(chrome,target,requestAudit)
    if(first){
      ownerObserver=observeCreatorActivityOwner(chrome,target,{runId:config.runId,ownerSecUid:config.ownerSecUid,ownerUid:config.ownerUid,firstAuthorSecUid:author.secUid})
      await chrome.debugger.sendCommand(target,'Page.enable')
    }
    observer=await observeActivityDiagnostics(chrome,target,author.secUid)
    if(config.pacing)listObserver=await observeCreatorActivity(chrome,target,author.secUid,{lazy:true})
    mark('listener-ready');await persistObservation(observation('prepared'))
    await active()
    requestAudit.authorHomepageNavigations++
    if(first)navigationStartedAt=ownerObserver.beginNavigation()
    mark('navigation')
    const navigation=await chrome.debugger.sendCommand(target,'Page.navigate',{url:'https://www.douyin.com/user/'+encodeURIComponent(author.secUid)})
    if(first)ownerObserver.bindNavigation(navigation)
    if(navigation?.errorText)throw Error('AUTHOR_CONTEXT_NAVIGATION_FAILED')
    const deadline=Date.now()+12000
    do{
      await active()
      if(observer?.denial)throw Error(observer.denial)
      if(listObserver?.fatalError)throw Error(listObserver.fatalError)
      const page=await chrome.tabs.get(profileTabId)
      trace.assertConnected()
      const url=new URL(page.url||'about:blank')
      if(url.origin==='https://www.douyin.com'&&decodeURIComponent(url.pathname)==='/user/'+author.secUid){
        let readiness
        try{
          const evaluated=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{returnByValue:true,
            expression:`(${readCreatorPageReadiness.toString()})(${JSON.stringify({secUid:author.secUid})},(${readCreatorActivityGuard.toString()}))`})
          trace.assertConnected()
          if(evaluated.exceptionDetails)throw Error('AUTHOR_CONTEXT_CHECK_FAILED')
          readiness=evaluated.result?.value
        }catch(error){
          // The main document can replace its initial execution context while committing.
          trace.assertConnected()
          if(classifyActivityCommandError(error)!=='EXECUTION_CONTEXT_UNAVAILABLE')throw error
        }
        if(readiness?.errorCode)throw Error(readiness.errorCode)
        if(readiness?.ready===true){mark('page-ready');return}
      }
      if(Date.now()>=deadline)throw Error('AUTHOR_CONTEXT_TIMEOUT')
      await new Promise(resolve=>setTimeout(resolve,100))
    }while(true)
  }
  const guard=async()=>safely(async()=>{
    trace.assertConnected()
    if(observer?.denial)throw Error(observer.denial)
    if(listObserver?.fatalError)throw Error(listObserver.fatalError)
    if(!target)return
    const result=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{returnByValue:true,expression:`(${readCreatorActivityGuard.toString()})()`})
    if(result.result?.value&&typeof result.result.value==='string')throw Error(result.result.value)
  })
  const saveFailure=async code=>{
    if(failureSaved||!currentAuthor||code==='ACTIVITY_SESSION_ENDED')return
    if(failureCapturePromise)return failureCapturePromise
    // Freeze synchronously before any await, screenshot or local APP request.
    preserveFailureTab=!!profileTabId
    if(heartbeat){clearInterval(heartbeat);heartbeat=null}
    const failureTarget=target||(profileTabId?{tabId:profileTabId}:null)
    mark('failure')
    const readObservation=failureTarget?observation('failed',code):undefined
    const frozen=freezeActivityFailure(failureTarget,currentAuthor,observer,code,stage,attempts,trace)
    failureCapturePromise=(async()=>{
      const cache=async diagnostic=>{if(chrome.storage?.local)await chrome.storage.local.set({signalDeskLatestFailure:{runId:config.runId,diagnostic}})}
      // Independent copies survive APP write failures. A receipt precedes cleanup.
      await cache(frozen).catch(()=>{})
      if(readObservation&&chrome.storage?.local)await chrome.storage.local.set({signalDeskLatestObservation:{runId:config.runId,observation:readObservation}}).catch(()=>{})
      const early=post('/activity-progress',{failureDiagnostic:frozen,...(readObservation?{readObservation}:{} )}).catch(()=>null)
      const failureDiagnostic=await captureActivityFailure(chrome,failureTarget,currentAuthor,observer,code,stage,attempts,trace,frozen)
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
    await finishInterruptedWait(config.initialWaitUntil,config.targets.length,config.pacing,{...waitOptions,active,progress:waitProgress})
    // This homepage is needed for count/list in every run. Use its NEW native
    // owner response too, without a preliminary page or a redundant owner GET.
    await prepareAuthor(config.targets[0],true)
    heartbeat=setInterval(()=>{void localActive().catch(()=>{
      if(target)void chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:`(()=>{const s=globalThis.__signalDeskCreatorActivity;if(s?.runId===${JSON.stringify(config.runId)}){s.cancelled=true;s.controller?.abort()}})()`}).catch(()=>{})
    })},1000)
    // The frontend count is required anyway. Read it while the native owner
    // response finishes, rather than adding a delay or deciding fallback too soon.
    await active()
    stage='reading-count'
    const firstCount=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
      expression:`(${readCreatorProfileCount.toString()})(${JSON.stringify(config.targets[0])},(${readCreatorActivityGuard.toString()}))`})
    firstFrontendCount=firstCount.exceptionDetails||!firstCount.result?.value?{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}:firstCount.result.value
    mark('count-ready')
    if(['CAPTCHA_OR_SECURITY_CHALLENGE','LOGIN_REQUIRED'].includes(firstFrontendCount.errorCode))throw Error(firstFrontendCount.errorCode)
    await guard()
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
    ownerConfirmed=true
    for(const [index,author] of config.targets.entries()){
      if(config.pacing&&Date.now()>=Date.parse(config.weekEndExclusive))throw Error('ACTIVITY_WEEK_CHANGED')
      if(index>0){
        await waitForCreatorRefresh(index,config.targets.length,config.pacing,{...waitOptions,
          active,progress:waitProgress})
      }
      await active();await post('/activity-progress',{currentId:author.id,stage:'reading-author'})
      if(index!==0)await prepareAuthor(author)
      await active()
      stage='reading-count'
      const counted=index===0?null:await safely(()=>chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(${readCreatorProfileCount.toString()})(${JSON.stringify(author)},(${readCreatorActivityGuard.toString()}))`}))
      const frontendCount=index===0?firstFrontendCount:counted.exceptionDetails||!counted.result?.value?{count:null,errorCode:'PROFILE_TAB_COUNT_UNAVAILABLE'}:counted.result.value
      if(index!==0)mark('count-ready')
      countSame=author.baseline&&frontendCount.count!==null?frontendCount.count===author.baseline.workCount:null
      await active()
      if(['CAPTCHA_OR_SECURITY_CHALLENGE','LOGIN_REQUIRED'].includes(frontendCount.errorCode))throw Error(frontendCount.errorCode)
      await guard()
      stage='reading-list'
      const native=await listObserver?.availablePage(0,{...nativeWaitOptions,active:async()=>{await active();await guard()}})
      mark('native-decision')
      if(native?.errorCode&&!recoverableNativeListErrors.has(native.errorCode))throw Error(native.errorCode)
      if(!config.baselinePolicy&&author.baseline&&frontendCount.count===author.baseline.workCount&&!native?.root){
        await guard();await active()
        stage='saving'
        strategy='count-only';mark('decision');await persistObservation(observation('decision',native?.errorCode??null))
        const saved=await post('/activity-report',{creatorId:author.id,capture:{contract:'signaldesk-activity-unchanged/v1',ownerSecUid:config.ownerSecUid,
          requestedSecUid:author.secUid,authorUid:author.uid,baselineSnapshotId:author.baseline.snapshotId,checkedAt:new Date().toISOString(),
          frontendCount,reason:'count-unchanged',nativeListRequests:observer.nativeListRequests}})
        if(saved.failed>0)throw Error('ACTIVITY_VALIDATION_INCOMPLETE')
        mark('save-ack')
        await releaseCompletedAuthor()
        await post('/activity-progress',{requestAudit:{...requestAudit}})
        continue
      }
      const result=await readCreatorActivityPage({...author,baselinePolicy:config.baselinePolicy,frontendCount,runId:config.runId,ownerSecUid:config.ownerSecUid,
        optimized:!!config.pacing,weekStart:config.weekStart,weekEndExclusive:config.weekEndExclusive},{active,nativeRequests:()=>observer.nativeListRequests,onPage:count=>{preservedPages=count},
        readPage:async cursor=>{
          await active()
          await guard()
          if(cursor===0&&native?.root)return native
          // An already observed access rejection is a stop, never a retry trigger.
          if(observer.denial)return {errorCode:observer.denial,activeRequest:false}
          observer.beginExplicit()
          let value
          let issued=false
          const readScope={runId:config.runId,secUid:author.secUid,cursor,...(config.recoveryPolicy?{readToken:`${config.runId}:${author.id}:${cursor}`}:{})}
          try{
            value=await safely(async()=>{
              if(issued){
                const deadline=Date.now()+9000
                while(true){
                  await localActive()
                  const checked=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{returnByValue:true,
                    expression:`(${readCreatorActivityPendingResult.toString()})(${JSON.stringify(readScope)})`})
                  const cached=checked.result?.value
                  if(cached?.phase==='settled')return cached.value
                  if(cached?.phase!=='pending'||Date.now()>=deadline)throw Error('ACTIVITY_RECOVERY_REQUEST_UNCERTAIN')
                  await new Promise(r=>setTimeout(r,100))
                }
              }
              issued=true
              const evaluated=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
                expression:`(${fetchCreatorActivityPage.toString()})(${JSON.stringify(readScope)},(${projectCreatorActivityResponse.toString()}))`})
              return evaluated.exceptionDetails||!evaluated.result?.value?{errorCode:'ACTIVITY_PAGE_EXECUTION_FAILED',activeRequest:true}:evaluated.result.value
            })
          }catch(error){value={errorCode:activityReadError(error),activeRequest:true}}
          attempts.push(value.diagnostic||{cursor,stage:'execution',httpStatus:null,json:'pending',errorCode:value.errorCode})
          if(value.errorCode)try{await saveFailure(value.errorCode)}catch{diagnosticSaveFailed=true}
          return value
        }})
      const failure=result?.code||result?.capture?.errorCode||(frontendCount?.count===null?frontendCount.errorCode:null)
      if(failure)try{await saveFailure(failure)}catch{diagnosticSaveFailed=true}
      if(config.recoveryPolicy&&failure&&(failure.startsWith('ACTIVITY_RECOVERY_')||['OWNER_IDENTITY_MISMATCH','LOGIN_REQUIRED','CAPTCHA_OR_SECURITY_CHALLENGE','ACTIVITY_HTTP_401','ACTIVITY_HTTP_403','ACTIVITY_HTTP_429'].includes(failure)))throw Error(failure)
      await active()
      if(!failure)await guard()
      stage='saving'
      strategy=result?.unchanged?'native-latest':result?.capture?.reusedNativePages?'full-native':'full-active'
      mark('decision');if(!failure)await persistObservation(observation('decision'))
      const saved=await post('/activity-report',{creatorId:author.id,...(result?.ok?{capture:result.unchanged||result.capture}:{errorCode:result?.code||'ACTIVITY_READ_FAILED'})})
      if(failure)throw new Error(failure)
      if(saved.failed>0)throw Error('ACTIVITY_VALIDATION_INCOMPLETE')
      mark('save-ack')
      // Persistence acknowledged: this author's browser session ends before any
      // pacing or local progress I/O. Never read a completed page while waiting.
      await releaseCompletedAuthor()
      await post('/activity-progress',{requestAudit:{...requestAudit}})
    }
    return await post('/activity-progress',{finished:true,requestAudit:{...requestAudit}})
  }catch(error){if(ownerObserver){requestAudit.nativeOwnerRequestsObserved=ownerObserver.observedRequests;requestAudit.ownerSourceDiagnostics=ownerObserver.diagnostics()}const code=activityReadError(error);try{await saveFailure(code);if(failureSaved)diagnosticSaveFailed=false}catch{diagnosticSaveFailed=true}try{await post('/activity-progress',{blocked:true,errorCode:code,diagnosticSaveFailed,requestAudit:{...requestAudit}})}catch{};return {phase:'blocked'}}
  finally{if(heartbeat)clearInterval(heartbeat);if(ownerObserver)ownerObserver.stop();if(observer)await observer.stop();await detach();trace.stop();if(profileTabId&&!preserveFailureTab)try{await chrome.tabs.remove(profileTabId)}catch{}}
}
