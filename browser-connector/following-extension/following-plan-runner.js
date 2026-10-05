// Production collection is continuous; only whitelisted identity/basic fields leave the browser.
export async function readFollowingPlanRequest(scope){
  const get=async(path,parameters)=>{
    const controller=new AbortController();globalThis.__signalDeskPlanRequest={runId:scope.runId,controller}
    const timer=setTimeout(()=>controller.abort(),8000)
    try{
      const response=await fetch(path+'?'+new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',...parameters}),
        {method:'GET',credentials:'include',signal:controller.signal})
      if(response.status!==200)throw Error('PLATFORM_HTTP_'+response.status)
      const text=await response.text();if(text.length>4*1024*1024)throw Error('PLATFORM_BODY_TOO_LARGE')
      let root;try{root=JSON.parse(text);root=root.data||root}catch{throw Error('PLATFORM_JSON_UNAVAILABLE')}
      if(root.status_code!==0)throw Error(scope.kind==='owner'?'LOGIN_REQUIRED':'PLATFORM_RESPONSE_REJECTED')
      return root
    }finally{clearTimeout(timer);delete globalThis.__signalDeskPlanRequest}
  }
  const identity=/^[A-Za-z0-9._-]{1,240}$/
  const project=row=>{
    const creator={uid:String(row?.uid||''),secUid:row?.sec_uid,nickname:row?.nickname,
      avatarUrl:(row?.avatar_thumb?.url_list||row?.avatar_medium?.url_list||[]).find(url=>typeof url==='string'&&url.startsWith('https://'))||null,
      signature:typeof row?.signature==='string'?row.signature:null,
      profileUrl:row?.sec_uid?'https://www.douyin.com/user/'+encodeURIComponent(row.sec_uid):null}
    if(!identity.test(creator.uid)||!identity.test(creator.secUid||'')||!creator.nickname)throw Error('CREATOR_IDENTITY_UNAVAILABLE')
    return creator
  }
  try{
    if(scope.kind==='owner'){
      const root=await get('/aweme/v1/web/user/profile/self/',{}),user=root.user||root.user_info
      const owner={uid:String(user?.uid||''),secUid:user?.sec_uid,nickname:user?.nickname}
      if(!identity.test(owner.uid)||!identity.test(owner.secUid||'')||!owner.nickname)throw Error('LOGIN_REQUIRED')
      if(scope.ownerSecUid&&owner.secUid!==scope.ownerSecUid)throw Error('OWNER_IDENTITY_MISMATCH')
      return {ok:true,owner,activeApiRequests:1}
    }
    if(scope.kind==='basic'){
      const root=await get('/aweme/v1/web/user/profile/other/',{sec_user_id:scope.creator.secUid}),creator=project(root.user||root.user_info)
      if(creator.uid!==scope.creator.uid||creator.secUid!==scope.creator.secUid)throw Error('CREATOR_IDENTITY_MISMATCH')
      return {ok:true,capture:{ownerSecUid:scope.ownerSecUid,creator,collectedAt:new Date().toISOString(),source:'profile-other',activeApiRequests:1}}
    }
    const root=await get('/aweme/v1/web/user/following/list/',{sec_user_id:scope.owner.secUid,count:'20',min_time:'0',max_time:String(scope.cursor),offset:String(scope.offset)})
    if(root.myself_user_id!==undefined&&String(root.myself_user_id)!==scope.owner.uid)throw Error('FOLLOWING_OWNER_RESPONSE_MISMATCH')
    const rows=root.followings||root.user_list||root.users
    if(!Array.isArray(rows)||rows.length>200||![true,false,0,1].includes(root.has_more))throw Error('FOLLOWING_SCHEMA_UNAVAILABLE')
    const hasMore=root.has_more===true||root.has_more===1,nextCursor=Number.isSafeInteger(root.min_time)&&root.min_time>=0?root.min_time:null,
      nextOffset=Number.isSafeInteger(root.offset)&&root.offset>=0?root.offset:null
    if(hasMore&&(nextCursor===null||nextCursor<=0||nextCursor===scope.cursor||!rows.length))throw Error('FOLLOWING_PAGINATION_STALLED')
    return {ok:true,page:{owner:scope.owner,position:scope.position,requestCursor:scope.cursor,requestOffset:scope.offset,
      nextCursor,nextOffset,hasMore,creators:rows.map(project),collectedAt:new Date().toISOString(),activeApiRequests:1}}
  }catch(error){return {ok:false,code:/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'PLATFORM_REQUEST_FAILED'}}
}

export async function runFollowingPlan(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch}={}){
  const chrome=chromeApi,basic=config.action==='basic',account=config.action==='account',started=performance.now()
  const headers={authorization:`Bearer ${config.token}`,'content-type':'application/json'}
  const post=async(path,body)=>{
    const response=await fetchApi(config.origin+path,{method:'POST',headers,body:JSON.stringify({...body,...(account?{preparationId:config.preparationId}:{runId:config.runId})})})
    const value=await response.json();if(!response.ok)throw Error('APP_SESSION_ENDED');return value
  }
  const active=async()=>{
    const response=await fetchApi(config.origin+(basic?'/basic-state':'/status'),{headers});const state=await response.json()
    const valid=account?state.readiness?.preparationId===config.preparationId&&state.readiness.phase==='checking'
      :basic?state.runId===config.runId&&state.phase==='running':state.runId===config.runId&&state.phase==='running'
    if(!response.ok||!valid)throw Error('APP_SESSION_ENDED')
  }
  let target,heartbeat,ended=false
  try{
    await active()
    const tabs=await chrome.tabs.query({url:'https://www.douyin.com/user/self*'})
    const tab=tabs.at(-1)||await chrome.tabs.create({url:'https://www.douyin.com/user/self',active:false})
    const deadline=Date.now()+12000
    while(Date.now()<deadline){
      const current=await chrome.tabs.get(tab.id)
      if(current.discarded)await chrome.tabs.reload(tab.id)
      else if(current.status==='complete')break
      await active();await new Promise(resolve=>setTimeout(resolve,100))
    }
    const current=await chrome.tabs.get(tab.id)
    if(current.status!=='complete'||new URL(current.url).origin!=='https://www.douyin.com')throw Error('ACCOUNT_CONTEXT_UNAVAILABLE')
    target={tabId:tab.id};await chrome.debugger.attach(target,'1.3')
    heartbeat=setInterval(()=>{void active().catch(()=>{
      ended=true
      if(target)void chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:`(()=>{const state=globalThis.__signalDeskPlanRequest;if(state?.runId===${JSON.stringify(config.runId)})state.controller.abort()})()`}).catch(()=>{})
    })},1000)
    const request=async scope=>{
      await active();if(ended)throw Error('APP_SESSION_ENDED')
      const result=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(${readFollowingPlanRequest.toString()})(${JSON.stringify({...scope,runId:config.runId})})`})
      await active()
      if(result.exceptionDetails)throw Error('PLATFORM_PAGE_EXECUTION_FAILED')
      if(!result.result.value?.ok)throw Error(result.result.value?.code||'PLATFORM_REQUEST_FAILED')
      return result.result.value
    }
    const {owner}=await request({kind:'owner',ownerSecUid:config.ownerSecUid})
    if(account)return await post('/readiness',{phase:'ready',owner})
    if(basic){
      for(const creator of config.targets){
        await active();await post('/basic-progress',{secUid:creator.secUid})
        try{
          const {capture}=await request({kind:'basic',ownerSecUid:owner.secUid,creator})
          await post('/basic-report',{secUid:creator.secUid,capture})
        }catch(error){
          if(['APP_SESSION_ENDED','LOGIN_REQUIRED','OWNER_IDENTITY_MISMATCH','PLATFORM_HTTP_403','PLATFORM_HTTP_429','PLATFORM_JSON_UNAVAILABLE','PLATFORM_RESPONSE_REJECTED'].includes(error.message))throw error
          await post('/basic-report',{secUid:creator.secUid,errorCode:error.message})
        }
      }
      return await post('/basic-progress',{finished:true})
    }
    await post('/list-owner',{owner})
    let cursor=config.cursor||0,offset=config.offset||0,position=(config.pageCount||0)+1
    for(;position<=100;position++){
      const {page}=await request({kind:'list',owner,cursor,offset,position})
      const state=await post('/list-page',{page,acquisitionMs:performance.now()-started})
      if(!page.hasMore)return state
      cursor=page.nextCursor;offset=page.nextOffset??0
    }
    throw Error('FOLLOWING_PAGE_LIMIT')
  }catch(error){
    const code=String(error.message).slice(0,100)
    const message=code==='LOGIN_REQUIRED'?'抖音账号未登录，请登录后重新同步。':code==='OWNER_IDENTITY_MISMATCH'?'抖音账号与所选资料库不一致，请切回对应账号。':`本轮已停止（${code}），已保存资料保留。`
    try{await post(account?'/readiness':basic?'/basic-progress':'/progress',{phase:'blocked',blocked:true,message,code,errorCode:code})}catch{}
    return {phase:'blocked',code,message}
  }finally{if(heartbeat)clearInterval(heartbeat);if(target)try{await chrome.debugger.detach(target)}catch{}}
}
