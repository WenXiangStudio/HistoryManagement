// Page metadata only. Reuse an already loaded Douyin page without changing it.
export async function findCreatorActivityContext(chrome,active,{waitMs=12000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const tabs=await chrome.tabs.query({url:'https://www.douyin.com/*'})
  const candidates=[]
  for(const tab of tabs){
    await active()
    try{
      const current=await chrome.tabs.get(tab.id)
      if(new URL(current.url).origin==='https://www.douyin.com'&&!current.discarded)candidates.push(current)
    }catch{ /* A closed or non-platform tab is not a page context. */ }
  }
  const rank=tab=>Number(new URL(tab.url).pathname==='/user/self')
  candidates.sort((a,b)=>rank(b)-rank(a))
  const ready=candidates.find(tab=>tab.status==='complete')
  if(ready)return ready
  // An existing load can finish without a second navigation or a reload.
  const loading=candidates[0]
  if(!loading)return null
  const deadline=Date.now()+waitMs
  do{
    await active()
    let current
    try{current=await chrome.tabs.get(loading.id)}catch{throw Error('ACCOUNT_CONTEXT_CLOSED')}
    if(new URL(current.url).origin!=='https://www.douyin.com'||current.discarded)throw Error('ACCOUNT_CONTEXT_CHANGED')
    if(current.status==='complete')return current
    if(Date.now()>=deadline)throw Error('ACCOUNT_CONTEXT_TIMEOUT')
    await pause(100)
  }while(true)
}

// Runs in the page. Return a small identity result, never the full response.
export async function readCreatorActivityOwner(scope){
  if(location.origin!=='https://www.douyin.com')return {ok:false,code:'ACCOUNT_CONTEXT_CHANGED'}
  const controller=new AbortController()
  globalThis.__signalDeskCreatorActivity={runId:scope.runId,controller}
  const timeout=setTimeout(()=>controller.abort(),8000)
  try{
    const response=await fetch('/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web',
      {method:'GET',credentials:'include',signal:controller.signal})
    if(response.status!==200)return {ok:false,code:'ACTIVITY_HTTP_'+response.status}
    let root;try{root=await response.json();root=root.data||root}catch{return {ok:false,code:'ACTIVITY_JSON_UNAVAILABLE'}}
    const user=root.user||root.user_info
    if(root.status_code!==0||!user?.sec_uid)return {ok:false,code:'LOGIN_REQUIRED'}
    const uid=String(user.uid||''),secUid=user.sec_uid,id=/^[A-Za-z0-9._-]{1,240}$/
    if(!id.test(uid)||!id.test(secUid))return {ok:false,code:'ACCOUNT_IDENTITY_UNAVAILABLE'}
    if(secUid!==scope.ownerSecUid||(scope.ownerUid&&uid!==scope.ownerUid))return {ok:false,code:'OWNER_IDENTITY_MISMATCH'}
    return {ok:true,owner:{uid,secUid},observedAt:new Date().toISOString()}
  }catch(error){return {ok:false,code:error.name==='AbortError'?'ACCOUNT_VERIFICATION_TIMEOUT':'ACCOUNT_VERIFICATION_FAILED'}}
  finally{clearTimeout(timeout)}
}

// Counts only request events in the attached target during this run. Raw URLs,
// headers, response bodies, credentials and query parameters are never retained.
export function meterCreatorActivityRequests(chrome,target,counts){
  const listener=(source,method,params)=>{
    if(source.tabId!==target.tabId||method!=='Network.requestWillBeSent')return
    counts.networkRequestsObserved++
    try{
      const url=new URL(params.request?.url)
      if(params.request?.method!=='GET'||url.origin!=='https://www.douyin.com'||!url.pathname.startsWith('/aweme/'))return
      counts.platformApiGetsObserved++
      if(url.pathname==='/aweme/v1/web/user/profile/self/')counts.selfGetsObserved++
      if(url.pathname==='/aweme/v1/web/aweme/post/')counts.listGetsObserved++
    }catch{ /* Only counts are retained. */ }
  }
  chrome.debugger.onEvent.addListener(listener)
  return ()=>chrome.debugger.onEvent.removeListener(listener)
}
