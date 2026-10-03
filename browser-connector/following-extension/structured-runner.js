export async function runStructuredFollowingSync(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch}={}){
  const chrome=chromeApi,preparing=config.action==='prepare'
  const post=async(path,body)=>{
    const response=await fetchApi(config.origin+path,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},
      body:JSON.stringify({...body,...(preparing?{preparationId:config.preparationId}:{runId:config.runId})})})
    const value=await response.json();if(!response.ok)throw new Error(value.error||'APP_SESSION_REJECTED');return value
  }
  const active=async()=>{
    const response=await fetchApi(config.origin+'/status',{headers:{authorization:`Bearer ${config.token}`}})
    const state=await response.json()
    if(!response.ok||(preparing?state.readiness?.preparationId!==config.preparationId||!['connecting','checking'].includes(state.readiness.phase):state.runId!==config.runId||state.phase!=='running'))throw new Error('APP_SESSION_ENDED')
  }
  let target,tab,result
  try{
    await active()
    await post(preparing?'/readiness':'/progress',{phase:preparing?'checking':'running',message:preparing?'正在验证登录账号与关注数据接口…':'正在通过关注数据接口获取新博主…'})
    const existing=await chrome.tabs.query({url:'https://www.douyin.com/user/self*'})
    tab=(!config.backgroundStart&&existing.find(item=>item.id===config.preferredTabId))||existing.at(-1)||await chrome.tabs.create({url:'https://www.douyin.com/user/self',active:false})
    const deadline=Date.now()+12000
    while(Date.now()<deadline){
      const current=await chrome.tabs.get(tab.id)
      if(current.discarded)await chrome.tabs.reload(tab.id)
      else if(current.status==='complete')break
      await active();await new Promise(resolve=>setTimeout(resolve,100))
    }
    const current=await chrome.tabs.get(tab.id)
    if(current.status!=='complete'||new URL(current.url).origin!=='https://www.douyin.com')throw new Error('ACCOUNT_CONTEXT_UNAVAILABLE')
    target={tabId:tab.id};await chrome.debugger.attach(target,'1.3')
    const scope={prepareOnly:preparing,limit:preparing?1:config.limit,excludeSecUids:config.excludeSecUids||[],
      expectedOwnerSecUid:config.ownerSecUid||null,ownerNickname:config.ownerNickname||null}
    const evaluated=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{awaitPromise:true,returnByValue:true,
      expression:`(${readStructuredFollowingPage.toString()})(${JSON.stringify(scope)})`})
    if(evaluated.exceptionDetails)throw new Error('STRUCTURED_PAGE_EXECUTION_FAILED')
    result=evaluated.result.value
    if(!result?.ok)throw new Error(result?.code||'STRUCTURED_ACQUISITION_FAILED')
    await active()
    await chrome.storage.local.set({followingTabId:tab.id})
    let backgroundWindow=null
    if(config.backgroundStart){
      await chrome.debugger.detach(target);target=null
      backgroundWindow=await chrome.windows.update(tab.windowId,{state:'minimized'})
    }
    const browserExecution={source:'authorized same-origin structured GET',tabId:tab.id,tabActive:current.active===true,
      domQueries:0,uiClicks:0,pageReloads:current.discarded?1:0,requests:result.activeApiRequests,
      backgroundStart:config.backgroundStart===true,backgroundWindowState:backgroundWindow?.state??null}
    if(preparing)return {...await post('/readiness',{phase:'ready',message:'账号身份和关注数据接口已就绪，可以同步关注。',proof:result,browserExecution,tabId:tab.id}),tabId:tab.id}
    return await post('/report',{capture:result,browserExecution})
  }catch(error){
    const code=String(error.message)
    const message=code==='LOGIN_REQUIRED'?'登录会话已失效，请登录账号后重新检查。':code==='OWNER_IDENTITY_MISMATCH'?'当前浏览器账号与资料库账号不一致，请切回原账号。':`关注数据接口未就绪（${code}），已停止本次检查。`
    try{await post(preparing?'/readiness':'/progress',{phase:'blocked',message,code,failureCapture:result})}catch{}
    return {phase:'blocked',message,code,tabId:tab?.id}
  }finally{if(target)try{await chrome.debugger.detach(target)}catch{}}
}

async function readStructuredFollowingPage(scope){
  const started=performance.now(),ID=/^[A-Za-z0-9._-]{1,240}$/
  let requests=0
  const get=async(path,parameters)=>{
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),8000)
    try{
      requests++
      const response=await fetch(path+'?'+new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',...parameters}),{credentials:'include',signal:controller.signal})
      if(response.status!==200)throw new Error('STRUCTURED_HTTP_'+response.status)
      const text=await response.text();if(text.length>4*1024*1024)throw new Error('STRUCTURED_BODY_TOO_LARGE')
      let json;try{json=JSON.parse(text)}catch{throw new Error('STRUCTURED_JSON_UNAVAILABLE')}
      const root=json.data||json
      if(root.status_code!==0)throw new Error(path.includes('profile/self')?'LOGIN_REQUIRED':'FOLLOWING_RESPONSE_REJECTED')
      return root
    }finally{clearTimeout(deadline)}
  }
  try{
    const self=await get('/aweme/v1/web/user/profile/self/',{})
    const user=self.user||self.user_info
    const owner={uid:String(user?.uid||''),secUid:user?.sec_uid,nickname:user?.nickname}
    if(!ID.test(owner.uid)||!ID.test(owner.secUid||'')||!owner.nickname)throw new Error('LOGIN_REQUIRED')
    if(scope.expectedOwnerSecUid?owner.secUid!==scope.expectedOwnerSecUid:scope.ownerNickname&&owner.nickname!==scope.ownerNickname)throw new Error('OWNER_IDENTITY_MISMATCH')
    const excluded=new Set(scope.excludeSecUids),selected=new Map(),seen=new Set(),pages=[]
    let cursor=0,offset=0,hasMore=true
    for(let page=0;page<20&&hasMore&&selected.size<scope.limit;page++){
      const root=await get('/aweme/v1/web/user/following/list/',{sec_user_id:owner.secUid,count:'20',offset:String(offset),min_time:'0',max_time:String(cursor)})
      if(root.myself_user_id!==undefined&&String(root.myself_user_id)!==owner.uid)throw new Error('FOLLOWING_OWNER_RESPONSE_MISMATCH')
      const users=root.followings||root.user_list||root.users
      if(!Array.isArray(users)||![true,false,0,1].includes(root.has_more))throw new Error('FOLLOWING_SCHEMA_UNAVAILABLE')
      const projected=users.map(row=>{
        const avatarUrl=(row.avatar_thumb?.url_list||row.avatar_medium?.url_list||[]).find(url=>typeof url==='string'&&url.startsWith('https://'))
        const creator={uid:String(row.uid||''),secUid:row.sec_uid,nickname:row.nickname,signature:typeof row.signature==='string'?row.signature:'',
          avatarUrl:avatarUrl||null,profileUrl:row.sec_uid?'https://www.douyin.com/user/'+encodeURIComponent(row.sec_uid):null}
        if(!ID.test(creator.uid)||!ID.test(creator.secUid||'')||!creator.nickname||!creator.avatarUrl)throw new Error('FOLLOWING_CREATOR_FIELDS_INVALID')
        return creator
      })
      pages.push({position:page+1,requestOwnerSecUid:owner.secUid,responseOwnerUid:root.myself_user_id===undefined?null:String(root.myself_user_id),
        requestMaxTime:cursor,requestOffset:offset,responseMinTime:root.min_time??null,responseOffset:root.offset??null,
        hasMore:root.has_more===true||root.has_more===1,creators:projected})
      for(const row of projected){seen.add(row.secUid);if(!excluded.has(row.secUid)&&!selected.has(row.secUid)&&selected.size<scope.limit)selected.set(row.secUid,row)}
      if(scope.prepareOnly)break
      hasMore=root.has_more===true||root.has_more===1
      if(selected.size<scope.limit&&hasMore){
        const next=root.min_time,nextOffset=root.offset
        if(!Number.isSafeInteger(next)||next<=0||next===cursor)throw new Error('FOLLOWING_PAGINATION_STALLED')
        cursor=next;offset=Number.isSafeInteger(nextOffset)&&nextOffset>=0?nextOffset:0
      }
    }
    if(!scope.prepareOnly&&selected.size!==scope.limit)throw new Error('INSUFFICIENT_NEW_CREATORS')
    return {ok:true,contract:'signaldesk-structured-following-capture/v1',prepared:scope.prepareOnly,sourceUrl:'https://www.douyin.com/user/self',
      owner,requestedCount:scope.prepareOnly?1:scope.limit,creators:scope.prepareOnly?[]:[...selected.values()],pages,
      selfStatusCode:0,followingStatusCode:0,activeApiRequests:requests,workResponseBodiesRead:0,domQueries:0,uiClicks:0,
      collectedAt:new Date().toISOString(),hasMore:pages.at(-1).hasMore,seenCount:seen.size,acquisitionMs:performance.now()-started}
  }catch(error){return {ok:false,code:String(error.message),activeApiRequests:requests,elapsedMs:performance.now()-started,domQueries:0,uiClicks:0}}
}
