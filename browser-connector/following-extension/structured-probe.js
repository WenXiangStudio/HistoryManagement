// Minimal real feasibility probe. Never touches DOM selectors, follows, notes,
// cookies, browser credentials or business storage; only whitelisted public JSON.
export async function runStructuredFollowingProbe(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch}={}){
  const chrome=chromeApi
  let target=null
  const existing=await chrome.tabs.query({url:'https://www.douyin.com/user/self*'})
  const tab=existing.at(-1)||await chrome.tabs.create({url:'https://www.douyin.com/user/self',active:false})
  try{
    target={tabId:tab.id}
    await chrome.debugger.attach(target,'1.3')
    await chrome.debugger.sendCommand(target,'Emulation.setFocusEmulationEnabled',{enabled:true})
    const deadline=Date.now()+12000
    while((await chrome.tabs.get(tab.id)).status!=='complete'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
    const result=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(${probePage.toString()})()`})
    const report=result.exceptionDetails?{ok:false,code:'PAGE_EXECUTION_FAILED'}:result.result.value
    const response=await fetchApi(config.origin+'/structured-probe',{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify({probeId:config.probeId,report})})
    return await response.json()
  }finally{
    if(target){try{await chrome.debugger.sendCommand(target,'Emulation.setFocusEmulationEnabled',{enabled:false})}catch{};try{await chrome.debugger.detach(target)}catch{}}
  }
}
async function probePage(){
  const started=performance.now()
  const get=async path=>{
    const response=await fetch(path,{credentials:'include'})
    const text=await response.text()
    let body;try{body=JSON.parse(text)}catch{}
    return {httpStatus:response.status,json:!!body,bodyBytes:text.length,body}
  }
  const self=await get('/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web')
  const selfRoot=self.body?.data||self.body
  const owner=selfRoot?.user||selfRoot?.user_info
  const selfEvidence={endpointPath:'/aweme/v1/web/user/profile/self/',httpStatus:self.httpStatus,json:self.json,bodyBytes:self.bodyBytes,
    statusCode:selfRoot?.status_code??null,rootKeys:Object.keys(selfRoot||{}).slice(0,25)}
  if(!owner?.sec_uid)return {ok:false,code:'SELF_STRUCTURED_IDENTITY_UNAVAILABLE',self:selfEvidence,elapsedMs:performance.now()-started}
  const ownerIdentity={uid:String(owner.uid||''),secUid:owner.sec_uid,nickname:owner.nickname}
  const parameters=new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',sec_user_id:owner.sec_uid,count:'20',offset:'0',min_time:'0',max_time:'0'})
  const following=await get('/aweme/v1/web/user/following/list/?'+parameters)
  const root=following.body?.data||following.body
  const users=root?.user_list||root?.users||root?.followings
  const creators=Array.isArray(users)?users.map(user=>({uid:String(user.uid||''),secUid:user.sec_uid,nickname:user.nickname,
    signature:typeof user.signature==='string'?user.signature:'',avatarUrl:(user.avatar_thumb?.url_list||user.avatar_medium?.url_list||[]).find(url=>url.startsWith('https://'))||null,
    profileUrl:user.sec_uid?'https://www.douyin.com/user/'+encodeURIComponent(user.sec_uid):null})):[]
  return {ok:self.httpStatus===200&&following.httpStatus===200&&Array.isArray(users)&&creators.length>0,
    owner:ownerIdentity,self:selfEvidence,following:{endpointPath:'/aweme/v1/web/user/following/list/',httpStatus:following.httpStatus,
      json:following.json,bodyBytes:following.bodyBytes,statusCode:root?.status_code??null,rootKeys:Object.keys(root||{}).slice(0,25),
      count:creators.length,hasMore:root?.has_more??null,maxTime:root?.max_time??null,minTime:root?.min_time??null},
    creators,elapsedMs:performance.now()-started,source:'authorized same-origin GET; no DOM access'}
}
