import {runFollowingPlan} from './following-plan-runner.js'
import {runStructuredFollowingProbe} from './structured-probe.js'
import {runCreatorActivityRefresh} from './creator-activity-runner.js'
const version=chrome.runtime.getManifest().version
let nativePort=null,reconnecting=false,connection=null,running=false
let activePreparationId=null,preparedTabId=null
async function connectorIdentity(){
  const {followingConnectorId}=await chrome.storage.local.get('followingConnectorId')
  if(followingConnectorId)return followingConnectorId
  const id=crypto.randomUUID();await chrome.storage.local.set({followingConnectorId:id});return id
}
function invalidatePage(){
  if(!connection||!activePreparationId||running)return
  void fetch(connection.origin+'/readiness',{method:'POST',headers:{authorization:`Bearer ${connection.token}`,'content-type':'application/json'},body:JSON.stringify({preparationId:activePreparationId,phase:'blocked',message:'账号页面已变化，正在重新检查。',code:'PAGE_INVALIDATED'})}).catch(()=>{})
  activePreparationId=null
}
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(tabId===preparedTabId&&(change.status==='loading'||change.discarded||change.url))invalidatePage()})
chrome.tabs.onRemoved.addListener(tabId=>{if(tabId===preparedTabId)invalidatePage()})
function disconnect(port){
  if(nativePort!==port)return
  nativePort=null;connection=null
  port.disconnect()
  void chrome.storage.local.set({followingConnection:{online:false,version}})
  setTimeout(connect,1000)
}

// Native Messaging holds the worker alive; long polling delivers APP clicks
// immediately without a setup tab or periodic browser launches.
async function connect(){
  if(nativePort||reconnecting)return
  reconnecting=true
  let port
  try{
    port=chrome.runtime.connectNative('com.signaldesk.following')
    nativePort=port
    port.onDisconnect.addListener(()=>{
      void chrome.runtime.lastError
      if(nativePort!==port)return
      nativePort=null;connection=null
      void chrome.storage.local.set({followingConnection:{online:false,version}})
      setTimeout(connect,1000)
    })
    port.onMessage.addListener(message=>{
      if(!message.ok){disconnect(port);return}
      connection=message.discovery
      void listen(port,connection)
    })
    port.postMessage({type:'discover'})
  }catch{if(nativePort===port)nativePort=null;setTimeout(connect,1000)}
  finally{reconnecting=false}
}
async function listen(port,bridge){
  const instanceId=crypto.randomUUID()
  const connectorId=await connectorIdentity()
  try{
    while(nativePort===port){
      const response=await fetch(bridge.origin+'/commands',{headers:{authorization:`Bearer ${bridge.token}`,'x-following-version':version,'x-following-instance':instanceId,'x-following-connector':connectorId}})
      const result=await response.json()
      if(!response.ok)throw new Error(result.error||'APP_OFFLINE')
      await chrome.storage.local.set({followingConnection:{online:true,version}})
      if(!result.command)continue
      if(running)continue
      running=true
      try{
        if(result.command.action==='activity'){
          await runCreatorActivityRefresh(result.command)
          continue
        }
        if(result.command.action==='probe'){
          await runStructuredFollowingProbe(result.command)
          continue
        }
        await runFollowingPlan(result.command)
      }finally{running=false}
    }
  }catch{disconnect(port)}
}
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.type==='signaldesk.following.enroll'){
    const config=message.config
    try{
      const senderUrl=new URL(_sender.url)
      if(senderUrl.origin!==config.origin||senderUrl.hostname!=='127.0.0.1'||senderUrl.pathname!=='/following-connect')throw new Error('连接页面无效')
      void connectorIdentity().then(async connectorId=>{
        const response=await fetch(config.origin+'/connector-enroll',{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify({nonce:config.nonce,connectorId})})
        const result=await response.json();respond(result)
      }).catch(error=>respond({ok:false,error:String(error.message)}))
    }catch(error){respond({ok:false,error:String(error.message)})}
    return true
  }
  if(message?.type==='signaldesk.following.page-invalidated'){
    respond({ok:true})
    invalidatePage()
    return false
  }
  if(message?.type!=='signaldesk.following.connection')return false
  respond({ok:true,online:!!connection,version,running})
  if(!nativePort)void connect()
  return false
})
void connect()
