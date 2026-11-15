// A user's explicit video URL only. No owner/profile reads, cookie export,
// pagination or database writes. CDN URLs live only until APP download begins.
export function isWorkshopMediaUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['douyinvod.com','douyin.com','bytecdn.cn','ibytedtos.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host))}catch{return false}
}
export function projectWorkshopDetail(raw,workId,allowMedia=isWorkshopMediaUrl){
  const root=raw?.data||raw,item=root?.aweme_detail||root?.awemeDetail
  if(!item)return null
  if(String(item.aweme_id??item.awemeId??'')!==workId)throw Error('WORKSHOP_VIDEO_ID_MISMATCH')
  if(item.is_delete||item.is_prohibited||item.status?.is_delete||item.status?.is_prohibited||[1,2].includes(item.status?.private_status))throw Error('WORKSHOP_VIDEO_UNAVAILABLE')
  const video=item.video,addresses=[video?.play_addr,video?.play_addr_h264,video?.play_addr_265]
  const urls=addresses.flatMap(address=>address?.url_list||address?.urlList||[])
  const mediaUrl=urls.find(allowMedia)
  if(!mediaUrl)return null
  return {workId,mediaUrl,title:typeof item.desc==='string'?item.desc.slice(0,2000):undefined,authorName:typeof item.author?.nickname==='string'?item.author.nickname.slice(0,200):undefined}
}
export function readWorkshopPage(workId){
  if(location.href==='about:blank')return {ready:false}
  if(location.origin!=='https://www.douyin.com'||location.pathname!=='/video/'+workId)return {errorCode:'WORKSHOP_VIDEO_ID_MISMATCH'}
  const text=(document.body?.innerText||'').slice(0,120000)
  if(/请完成.{0,8}验证|拖动滑块|验证码|安全验证/.test(text)&&document.querySelector('iframe[src*="verify"], [class*="captcha"], [id*="captcha"]'))return {errorCode:'WORKSHOP_CAPTCHA_REQUIRED'}
  if(/作品已删除|视频已删除|作品不存在|视频不存在|该作品已被删除|暂时无法播放|作品已失效|作品审核中|私密作品/.test(text))return {errorCode:'WORKSHOP_VIDEO_UNAVAILABLE'}
  if(document.querySelector('[data-e2e="login-dialog"]')&&/登录后.{0,12}(观看|播放)|登录才能/.test(text))return {errorCode:'WORKSHOP_LOGIN_REQUIRED'}
  // Only a source inside a DOM element explicitly bearing this exact aweme ID
  // can be used without a native detail payload. Ordinary preloaded videos do
  // not establish identity and are deliberately ignored.
  const holder=document.querySelector(`[data-aweme-id="${workId}"], [data-video-id="${workId}"]`)
  const video=holder?.querySelector('video')
  const mediaUrl=video?.currentSrc||video?.src
  if(mediaUrl)return {media:{workId,mediaUrl}}
  return {ready:document.readyState!=='loading'}
}
export async function fetchWorkshopDetail(workId,project,allowMedia){
  if(location.origin!=='https://www.douyin.com'||location.pathname!=='/video/'+workId)throw Error('WORKSHOP_VIDEO_ID_MISMATCH')
  const query=new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',version_code:'170400',aweme_id:workId})
  const response=await fetch('/aweme/v1/web/aweme/detail/?'+query,{method:'GET',credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)})
  if(response.status===401||response.status===403)throw Error('WORKSHOP_LOGIN_REQUIRED')
  if(!response.ok)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
  const text=await response.text()
  if(text.length>4*1024*1024)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
  const raw=JSON.parse(text),root=raw?.data||raw
  if(root.status_code!==0)throw Error('WORKSHOP_VIDEO_UNAVAILABLE')
  return project(raw,workId,allowMedia)
}

export async function runWorkshopVideo(config,{chromeApi=globalThis.chrome,fetchApi=globalThis.fetch,nativeWaitMs=6000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const chrome=chromeApi,headers={authorization:`Bearer ${config.token}`,'content-type':'application/json'},deadline=Date.now()+45000
  let target=null,detached=false,lastCheck=0,nativeMedia=null,nativeError=null,nativeRequests=0
  const pendingResponses=new Map(),bodyJobs=new Set()
  const request=async(path,body)=>{
    const response=await fetchApi(config.origin+path,{headers,signal:AbortSignal.timeout(5000),...(body?{method:'POST',body:JSON.stringify(body)}:{})})
    if(!response.ok)throw Error('WORKSHOP_APP_UNAVAILABLE')
    return response.json()
  }
  const active=async()=>{
    if(detached)throw Error('WORKSHOP_BROWSER_DISCONNECTED')
    if(Date.now()>deadline)throw Error('WORKSHOP_READ_TIMEOUT')
    if(nativeError)throw nativeError
    if(Date.now()-lastCheck>500){const state=await request('/workshop-video-state');lastCheck=Date.now()
      if(state.runId!==config.runId||state.phase!=='running')throw Error('WORKSHOP_CANCELLED')}
  }
  const send=async(method,params={})=>{
    let timeout
    try{return await Promise.race([chrome.debugger.sendCommand(target,method,params),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('WORKSHOP_READ_TIMEOUT')),10000)})])}
    finally{clearTimeout(timeout)}
  }
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails)throw Error('WORKSHOP_PAGE_EXECUTION_FAILED')
    return result.result?.value
  }
  const onDetach=source=>{if(source.tabId===target?.tabId)detached=true}
  const onEvent=(source,method,params)=>{
    if(source.tabId!==target?.tabId)return
    if(method==='Network.responseReceived'){
      let url
      try{url=new URL(params.response.url)}catch{return}
      if(url.origin!=='https://www.douyin.com'||url.pathname!=='/aweme/v1/web/aweme/detail/'||url.searchParams.get('aweme_id')!==config.expectedWorkId)return
      nativeRequests++
      if(params.response.status===401||params.response.status===403){nativeError=Error('WORKSHOP_LOGIN_REQUIRED');return}
      if(params.response.status!==200)return
      pendingResponses.set(params.requestId,true)
    }
    if(method==='Network.loadingFailed')pendingResponses.delete(params.requestId)
    if(method==='Network.loadingFinished'&&pendingResponses.delete(params.requestId)){
      const job=(async()=>{
        try{
          if(params.encodedDataLength>4*1024*1024)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
          const result=await send('Network.getResponseBody',{requestId:params.requestId})
          const text=result.base64Encoded?atob(result.body):result.body
          if(text.length>4*1024*1024)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
          const raw=JSON.parse(text),root=raw?.data||raw
          if(root.status_code!==0)throw Error('WORKSHOP_VIDEO_UNAVAILABLE')
          nativeMedia=projectWorkshopDetail(raw,config.expectedWorkId)
        }catch(error){if(/WORKSHOP_(VIDEO_ID_MISMATCH|VIDEO_UNAVAILABLE|LOGIN_REQUIRED)/.test(error?.message))nativeError=error}
      })()
      bodyJobs.add(job);void job.finally(()=>bodyJobs.delete(job))
    }
  }
  let report
  try{
    if(!/^\d{8,30}$/.test(config.expectedWorkId)||config.url!==`https://www.douyin.com/video/${config.expectedWorkId}`)throw Error('WORKSHOP_VIDEO_ID_MISMATCH')
    await active()
    const tab=await chrome.tabs.create({url:'about:blank',active:false});target={tabId:tab.id}
    await chrome.debugger.attach(target,'1.3');chrome.debugger.onDetach.addListener(onDetach);chrome.debugger.onEvent.addListener(onEvent)
    await send('Page.enable');await send('Network.enable',{maxResourceBufferSize:4*1024*1024,maxTotalBufferSize:8*1024*1024})
    await send('Page.navigate',{url:config.url})
    const nativeDeadline=Date.now()+nativeWaitMs
    let page,media
    while(Date.now()<nativeDeadline){
      await active()
      try{page=await evaluate(`(${readWorkshopPage.toString()})(${JSON.stringify(config.expectedWorkId)})`)}catch(error){if(error?.message==='WORKSHOP_READ_TIMEOUT')throw error}
      if(page?.errorCode)throw Error(page.errorCode)
      if(nativeMedia){media=nativeMedia;break}
      if(page?.media&&isWorkshopMediaUrl(page.media.mediaUrl)){media=page.media;break}
      await pause(200)
    }
    await active()
    if(!media){
      // A native denial or mismatched work never triggers another request.
      // Only a page which produced no native detail request permits one
      // ordinary same-origin GET using the browser's own logged-in session.
      if(nativeRequests)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
      const detail=await evaluate(`(async()=>{try{return {media:await (${fetchWorkshopDetail.toString()})(${JSON.stringify(config.expectedWorkId)},(${projectWorkshopDetail.toString()}),(${isWorkshopMediaUrl.toString()}))}}catch(error){return {errorCode:/^[A-Z0-9_-]{1,100}$/.test(error?.message)?error.message:'WORKSHOP_MEDIA_UNAVAILABLE'}}})()`)
      if(detail?.errorCode)throw Error(detail.errorCode)
      media=detail?.media
    }
    if(!media||!isWorkshopMediaUrl(media.mediaUrl)||media.workId!==config.expectedWorkId)throw Error('WORKSHOP_MEDIA_UNAVAILABLE')
    await active()
    const finalTab=await chrome.tabs.get(target.tabId),pageUrl=finalTab.url
    const final=new URL(pageUrl)
    if(final.origin!=='https://www.douyin.com'||final.pathname!==`/video/${config.expectedWorkId}`)throw Error('WORKSHOP_VIDEO_ID_MISMATCH')
    report={runId:config.runId,media:{...media,pageUrl}}
    await request('/workshop-video-report',report)
  }catch(error){
    const errorCode=/^[A-Z0-9_-]{1,100}$/.test(error?.message)?error.message:'WORKSHOP_READ_FAILED'
    report={runId:config.runId,errorCode};await request('/workshop-video-report',report).catch(()=>{})
  }finally{
    chrome.debugger.onEvent.removeListener(onEvent);chrome.debugger.onDetach.removeListener(onDetach)
    if(target){try{await chrome.debugger.detach(target)}catch{};try{await chrome.tabs.remove(target.tabId)}catch{}}
  }
  return report
}
