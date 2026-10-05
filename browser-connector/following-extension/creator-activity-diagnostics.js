// Bounded observations only: never retain raw URLs, query strings, headers,
// response bodies, exception text or console messages.
export function classifyActivityCommandError(error) {
  const message=String(error?.message||error||'').toLowerCase()
  if(/not attached|not connected|detached/.test(message))return 'DEBUGGER_NOT_ATTACHED'
  if(/another debugger|already attached/.test(message))return 'DEBUGGER_BUSY'
  if(/target.*navigated or closed/.test(message))return 'TARGET_NAVIGATED_OR_CLOSED'
  if(/no tab|tab.*closed|target.*closed|target.*not found/.test(message))return 'TARGET_UNAVAILABLE'
  if(/execution context|context.*destroyed|context.*not found|cannot find context/.test(message))return 'EXECUTION_CONTEXT_UNAVAILABLE'
  if(/promise.*collected/.test(message))return 'PROMISE_COLLECTED'
  if(/cannot access|not allowed|permission|restricted/.test(message))return 'COMMAND_NOT_ALLOWED'
  if(/timed? ?out|timeout/.test(message))return 'COMMAND_TIMEOUT'
  if(/capture|screenshot|image|surface/.test(message))return 'SCREENSHOT_FAILED'
  if(/invalid parameter|invalid argument/.test(message))return 'INVALID_COMMAND_PARAMETERS'
  if(/method.*not found|wasn.t found/.test(message))return 'COMMAND_UNSUPPORTED'
  return 'COMMAND_FAILED'
}

// Observe the command boundary itself. It remains available when page execution
// and screenshots both fail. No expression, return value or raw error is retained.
export function traceActivityCommands(chrome) {
  const commands=[],connections=[]
  let sequence=0,dropped=0
  const push=(list,value,max)=>{if(list.length>=max){list.shift();dropped++}list.push(value)}
  const detach=(source,reason)=>{
    if(source.tabId!==currentTab)return
    push(connections,{at:new Date().toISOString(),event:'detached',reason:['target_closed','canceled_by_user'].includes(reason)?reason:'other'},16)
  }
  let currentTab=null
  chrome.debugger.onDetach?.addListener(detach)
  const sendCommand=async(target,method,params)=>{
    const label=method==='Runtime.evaluate'?(params?.expression?.includes('fetchCreatorActivityPage')?'list-read':params?.expression?.includes('readActivityPageState')?'failure-page':params?.expression?.includes('readCreatorProfileCount')?'profile-count':params?.expression?.includes('readCreatorActivityOwner')?'owner-read':'runtime-other')
      :method==='Page.captureScreenshot'?'failure-screenshot':method==='Page.navigate'?'navigate':method==='Network.getResponseBody'?'response-body':'setup'
    const entry={sequence:++sequence,at:new Date().toISOString(),operation:label,stage:'pending',elapsedMs:0,error:null,exceptionClass:null,resultType:null}
    const began=performance.now();push(commands,entry,64)
    try{
      const value=await chrome.debugger.sendCommand(target,method,params)
      entry.resultType=value?.result?.type&&['object','undefined','string','number','boolean','function','symbol','bigint'].includes(value.result.type)?value.result.type:null
      if(value?.exceptionDetails){
        entry.stage='exception';entry.error='PAGE_SCRIPT_EXCEPTION'
        const name=value.exceptionDetails.exception?.className
        entry.exceptionClass=['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','DOMException'].includes(name)?name:'other'
      }else if(method==='Runtime.evaluate'&&label!=='runtime-other'&&value?.result?.value===undefined){entry.stage='missing-result';entry.error='COMMAND_RESULT_MISSING'}
      else entry.stage='complete'
      return value
    }catch(error){entry.stage='rejected';entry.error=classifyActivityCommandError(error);throw error}
    finally{entry.elapsedMs=Math.max(0,performance.now()-began)}
  }
  return {sendCommand,setTarget(tabId){currentTab=tabId;push(connections,{at:new Date().toISOString(),event:'target-selected',reason:null},16)},
    snapshot(){return {commands:commands.map(row=>({...row})),connections:connections.map(row=>({...row})),dropped}},
    stop(){chrome.debugger.onDetach?.removeListener(detach)}}
}

export function readActivityPageState(scope) {
  const visible=element=>!!element&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'
  const tab=document.getElementById('semiTabpost')
  const panelId=tab?.getAttribute('aria-controls')
  const panel=panelId?document.getElementById(panelId):null
  const text=(document.body?.innerText||'').slice(0,20000)
  return {pathRelation:location.origin==='https://www.douyin.com'?(location.pathname==='/user/'+scope.secUid?'target':'other-platform'):'other-origin',
    readyState:document.readyState,visibilityState:document.visibilityState,
    worksTabPresent:!!tab,worksTabVisible:visible(tab),worksTabSelected:tab?.getAttribute('aria-selected')==='true'?true:tab?.getAttribute('aria-selected')==='false'?false:null,
    panelPresent:!!panel,panelVisible:visible(panel),
    visibleWorkLinks:Math.min(200,[...document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')].filter(visible).length),
    markers:{login:/登录后|请登录/.test(text),verification:/安全验证|验证码|完成验证/.test(text),
      unavailable:/暂时无法|加载失败|网络错误/.test(text),empty:/暂无作品|还没有发布作品/.test(text)}}
}

export async function observeActivityDiagnostics(chrome,target,secUid) {
  const requests=new Map(),events=[],documents=[],runtime=[]
  let dropped=0,scriptExceptions=0,nativeListRequests=0,explicit=false,denial=null,stopped=false
  const relation=raw=>{try{const url=new URL(raw);return url.origin!=='https://www.douyin.com'?'other-origin':url.pathname==='/user/'+secUid?'target':'other-platform'}catch{return 'missing'}}
  const listener=(source,method,params)=>{
    if(stopped||source.tabId!==target.tabId)return
    if(method==='Runtime.exceptionThrown'||method==='Runtime.executionContextsCleared'||method==='Runtime.executionContextDestroyed'){
      if(method==='Runtime.exceptionThrown')scriptExceptions=Math.min(100000,scriptExceptions+1)
      const name=params.exceptionDetails?.exception?.className
      if(runtime.length>=24){runtime.shift();dropped++}
      runtime.push({at:new Date().toISOString(),kind:method==='Runtime.exceptionThrown'?'exception':method==='Runtime.executionContextsCleared'?'contexts-cleared':'context-destroyed',
        exceptionClass:method==='Runtime.exceptionThrown'?(['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','DOMException'].includes(name)?name:'other'):null})
      return
    }
    if((method==='Page.frameNavigated'&&!params.frame?.parentId&&!source.sessionId)||method==='Page.navigatedWithinDocument'){
      if(documents.length<16)documents.push({at:new Date().toISOString(),kind:method==='Page.frameNavigated'?'committed':'same-document',pathRelation:relation(params.frame?.url||params.url),childSession:!!source.sessionId})
      else dropped++
    }
    if(method==='Network.requestWillBeSent'){
      let url;try{url=new URL(params.request?.url)}catch{return}
      if(url.origin!=='https://www.douyin.com'||!url.pathname.startsWith('/aweme/'))return
      const list=url.pathname==='/aweme/v1/web/aweme/post/'
      const methodClass=['GET','POST'].includes(params.request.method)?params.request.method:'other'
      const author=url.searchParams.get('sec_user_id'),cursor=url.searchParams.get('max_cursor')
      const match=!list?'other-endpoint':source.sessionId?'child-session':methodClass!=='GET'?'method':author!==secUid?'author':cursor===null||!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor))?'cursor':'target'
      if(list&&match==='target'&&!explicit)nativeListRequests++
      const event={at:new Date().toISOString(),updatedAt:new Date().toISOString(),endpoint:list?'works-list':url.pathname==='/aweme/v1/web/user/profile/self/'?'self':url.pathname==='/aweme/v1/web/user/profile/other/'?'profile':'other-api',
        method:methodClass,match,phase:explicit?'explicit':'page',stage:'request',httpStatus:null,json:'unknown'}
      // Reserve space for explicit requests even on a noisy homepage.
      if(events.length>=48){const old=events.shift();for(const [key,value] of requests)if(value===old)requests.delete(key);dropped++}
      events.push(event);requests.set((source.sessionId||'')+':'+params.requestId,event)
      return
    }
    const event=requests.get((source.sessionId||'')+':'+params.requestId)
    if(!event)return
    event.updatedAt=new Date().toISOString()
    if(method==='Network.responseReceived'){
      event.stage='response';event.httpStatus=Number.isInteger(params.response?.status)?params.response.status:null
      event.json=/json/i.test(params.response?.mimeType||'')?'mime-json':'unknown'
      if(event.match==='target'&&[401,403,429].includes(event.httpStatus))denial='ACTIVITY_HTTP_'+event.httpStatus
    }else if(method==='Network.loadingFailed')event.stage='load-failed'
    else if(method==='Network.loadingFinished')event.stage='loaded'
  }
  chrome.debugger.onEvent.addListener(listener)
  try{
    await chrome.debugger.sendCommand(target,'Page.enable')
    await chrome.debugger.sendCommand(target,'Runtime.enable')
    await chrome.debugger.sendCommand(target,'Network.enable')
  }catch(error){chrome.debugger.onEvent.removeListener(listener);throw error}
  return {get nativeListRequests(){return nativeListRequests},get denial(){return denial},beginExplicit(){explicit=true},
    snapshot(){return {events:events.map(event=>({...event})),documents:documents.map(document=>({...document})),runtime:runtime.map(row=>({...row})),dropped,scriptExceptions}},
    stop(){stopped=true;chrome.debugger.onEvent.removeListener(listener)}}
}

// No navigation, page interactions or platform requests during failure capture.
export function freezeActivityFailure(target,scope,observer,errorCode,stage,attempts,trace) {
  return {contract:'signaldesk-activity-failure/v1',creatorId:scope.id,secUid:scope.secUid,
    capturedAt:new Date().toISOString(),errorCode,stage,page:null,pageError:null,screenshot:null,screenshotError:null,
    capturePhase:'frozen',retainedTabId:target?.tabId??null,
    network:observer?.snapshot()||{events:[],documents:[],dropped:0,scriptExceptions:0},attempts:attempts.map(row=>({...row})).slice(-10),
    ...(trace?{browser:trace.snapshot()}:{})}
}

export async function captureActivityFailure(chrome,target,scope,observer,errorCode,stage,attempts,trace,frozen) {
  const result=frozen?structuredClone(frozen):freezeActivityFailure(target,scope,observer,errorCode,stage,attempts,trace)
  result.capturePhase='complete'
  result.pageError=null;result.screenshotError=null
  const bounded=async promise=>{
    let timer
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),2000)})])}
    finally{clearTimeout(timer)}
  }
  result.environment={tabExists:false,status:'unknown',discarded:null,pathRelation:'missing',pageSource:'unavailable',diagnosticReattached:false,tabError:null,recoveryError:null}
  if(!target){result.pageError='UNAVAILABLE';result.screenshotError='UNAVAILABLE';result.completedAt=new Date().toISOString();return result}
  try{
    const tab=await bounded(chrome.tabs.get(target.tabId)),url=new URL(tab.url||'about:blank')
    Object.assign(result.environment,{tabExists:true,status:['loading','complete'].includes(tab.status)?tab.status:'unknown',discarded:typeof tab.discarded==='boolean'?tab.discarded:null,
      pathRelation:url.origin!=='https://www.douyin.com'?'other-origin':url.pathname==='/user/'+scope.secUid?'target':'other-platform'})
  }catch(error){result.environment.tabError=classifyActivityCommandError(error)}
  const readPage=async()=>{
  try{
    const evaluated=await bounded(chrome.debugger.sendCommand(target,'Runtime.evaluate',{returnByValue:true,
      expression:`(${readActivityPageState.toString()})(${JSON.stringify({secUid:scope.secUid})})`}))
    if(evaluated.exceptionDetails){result.pageError='UNAVAILABLE';result.pageFailureReason='PAGE_SCRIPT_EXCEPTION'}
    else if(!evaluated.result?.value){result.pageError='UNAVAILABLE';result.pageFailureReason='COMMAND_RESULT_MISSING'}
    else {result.page=evaluated.result.value;result.environment.pageSource='debugger'}
  }catch(error){result.pageError='UNAVAILABLE';result.pageFailureReason=classifyActivityCommandError(error)}
  }
  const screenshot=async()=>{
  try{
    const screenshot=await bounded(chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'jpeg',quality:45,captureBeyondViewport:false}))
    if(typeof screenshot.data!=='string'||!screenshot.data.startsWith('/9j/')){result.screenshotError='UNAVAILABLE';result.screenshotFailureReason='COMMAND_RESULT_MISSING'}
    else if(screenshot.data.length>262144)result.screenshotError='TOO_LARGE'
    else result.screenshot=screenshot.data
  }catch(error){result.screenshotError='UNAVAILABLE';result.screenshotFailureReason=classifyActivityCommandError(error)}
  }
  await Promise.allSettled([readPage(),screenshot()])
  // The original failure snapshot remains immutable. Independent extension APIs
  // can still inspect an existing page after the debugger has disconnected.
  if(!result.page&&result.environment.pathRelation==='target'&&chrome.scripting?.executeScript){
    try{
      const rows=await bounded(chrome.scripting.executeScript({target:{tabId:target.tabId},func:readActivityPageState,args:[{secUid:scope.secUid}]}))
      if(rows?.[0]?.result){result.page=rows[0].result;result.pageError=null;result.environment.pageSource='extension-script'}
    }catch(error){result.environment.recoveryError=classifyActivityCommandError(error)}
  }
  if(!result.screenshot&&result.environment.pathRelation==='target'&&result.screenshotFailureReason==='DEBUGGER_NOT_ATTACHED'&&chrome.debugger.getTargets){
    try{
      const targets=await bounded(chrome.debugger.getTargets()),current=targets.find(row=>row.tabId===target.tabId)
      if(current?.attached===false){
        await bounded(chrome.debugger.attach(target,'1.3'));result.environment.diagnosticReattached=true
        await screenshot() // Read-only recovery, no navigation, fetch or business retry.
        if(result.screenshot)result.screenshotError=null
      }
    }catch(error){result.environment.recoveryError=classifyActivityCommandError(error)}
  }
  if(trace)result.captureBrowser=trace.snapshot()
  result.completedAt=new Date().toISOString()
  return result
}
