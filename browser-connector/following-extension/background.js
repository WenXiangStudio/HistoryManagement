let running=false
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function run(config){
  const post=async(path,body)=>{
    const response=await fetch(config.origin+path,{method:'POST',headers:{authorization:`Bearer ${config.token}`,
      'content-type':'application/json'},body:JSON.stringify({...body,runId:config.runId})})
    const result=await response.json();if(!response.ok)throw new Error(result.error||'APP 未接收结果');return result
  }
  let tab=null
  const feedback=async(phase,message,count=0)=>{
    try{await chrome.action.setBadgeText({text:phase==='completed'?String(count):phase==='blocked'?'!':'…'})}catch{}
    if(tab)try{await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.feedback',phase,message})}catch{}
  }
  const progress=async message=>{await post('/progress',{phase:'running',message});await feedback('running',message)}
  try{
    await progress('正在读取当前 Chrome 账号的关注列表…')
    tab=await chrome.tabs.create({url:'https://www.douyin.com/user/self',active:true})
    await chrome.tabs.update(tab.id,{active:true})
    let opened=null
    for(let attempt=0;attempt<30;attempt++){
      try{opened=await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.r8.open-following-dialog'});break}
      catch{await sleep(500)}
    }
    if(!opened?.ok && ['LOGIN_REQUIRED','CAPTCHA_OR_SECURITY_CHALLENGE'].includes(opened?.code))throw new Error(opened.code)
    await progress('关注列表已打开，正在提取前 10 位博主的头像、昵称和主页链接…')
    const result=await chrome.tabs.sendMessage(tab.id,{type:'signaldesk.following.collect-visible'})
    if(!result?.ok)throw new Error(result?.error||'未读到关注列表')
    if(result.creators.length===0)throw new Error('当前关注列表没有读到博主链接')
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result.creators))))]
      .map(value=>value.toString(16).padStart(2,'0')).join('')
    const report={contract:'signaldesk-visible-following/v1',runId:config.runId,collectedAt:new Date().toISOString(),
      ownerSecUid:null,ownerNickname:result.ownerNickname,sourceUrl:'https://www.douyin.com/user/self',
      sourceKind:'visible-following-list',activeFollowingTab:true,listStartedAtTop:true,hasMore:result.creators.length===10,
      visibleItemCount:result.visibleItemCount,creators:result.creators,projectionSha256:hash,
      activeApiRequests:0,workResponseBodiesRead:0}
    const saved=await post('/report',report)
    await feedback(saved.phase,saved.message,saved.count)
    await chrome.storage.local.set({lastFollowingResult:{runId:config.runId,count:saved.count,status:saved.phase==='completed'?'saved':'partial',message:saved.message}})
  }catch(error){
    const message=`关注同步未完成：${String(error.message).slice(0,300)}`
    try{await post('/progress',{phase:'blocked',message})}catch{}
    await feedback('blocked',message)
    await chrome.storage.local.set({lastFollowingResult:{runId:config.runId,status:'blocked',message}})
  }finally{running=false}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='signaldesk.following.start')return false
  try{
    const config=message.config;const url=new URL(sender.url)
    if(url.hostname!=='127.0.0.1'||url.origin!==config?.origin||url.pathname!==`/following-setup/${config.runId}`)throw new Error('配置页无效')
    if(running)throw new Error('正在同步')
    running=true;void run(config);respond({ok:true})
  }catch(error){respond({ok:false,error:String(error.message)})}
  return false
})
