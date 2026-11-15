// Local APP validation harness. It never connects to Chrome's debugging port.
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const action=process.argv[2]||'status',creatorId=Number(process.argv[3]||'-1000000512')
if(!['status','collect','collect-ui','open','screenshot'].includes(action))throw Error('Unknown validation action')
if(!Number.isSafeInteger(creatorId)||creatorId>=0)throw Error('Expected saved creator ID')
const output=resolve('local-data/video-information-20261010');mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Local review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const value=JSON.parse(event.data);pending.get(value.id)?.(value)})
const send=(method,params)=>new Promise((resolve,reject)=>{
  const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(Error('APP timed out'))},10000)
  pending.set(requestId,value=>{clearTimeout(timer);pending.delete(requestId);value.error||value.result?.exceptionDetails?reject(Error('APP evaluation failed: '+JSON.stringify(value.result?.exceptionDetails||value.error))):resolve(value.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))
})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
try{
  const status=await evaluate(`(async()=>{const s=await window.signalDesk.getFollowingSyncStatus();return {online:s.connection?.online,version:s.connection?.version,readiness:s.readiness?.phase,phase:s.phase,activity:s.activity?.phase,basic:s.basic?.phase}})()`)
  console.log(JSON.stringify(status))
  if(['open','collect-ui'].includes(action)){
    await evaluate(`document.querySelector('[aria-label="关闭视频信息"]')?.click()`)
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('博主资料库')).click()`)
    await new Promise(resolve=>setTimeout(resolve,300))
    const profile=await evaluate(`window.signalDesk.listCreators().then(cs=>cs.find(c=>c.id===${creatorId})?.profileUrl)`)
    if(!profile)throw Error('Saved creator not available')
    let found=false
    for(const section of ['active','regular','inactive','dormant','anomaly']){
      await evaluate(`document.querySelector('[data-testid="creator-section-${section}"]').click()`)
      await new Promise(resolve=>setTimeout(resolve,150))
      found=await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('.creator-profile-link')?.getAttribute('href')===${JSON.stringify(profile)});if(!card)return false;card.querySelector('[data-testid="open-video-information"]').click();return true})()`)
      if(found)break
    }
    if(!found)throw Error('Creator card not found')
    await new Promise(resolve=>setTimeout(resolve,300))
  }
  if(action==='collect'||action==='collect-ui'){
    if(!status.online||status.readiness!=='ready'||[status.phase,status.activity,status.basic].includes('running'))throw Error('APP is not idle and ready')
    const before=await evaluate(`window.signalDesk.getVideoInformationStatus()`)
    if(action==='collect-ui'&&await evaluate('document.visibilityState')!=='visible')throw Error('Restore the APP window before measuring click-to-display time')
    const started=performance.now()
    if(action==='collect-ui')await evaluate(`(()=>{const b=document.querySelector('[data-testid="collect-video-information"]');if(!b||b.disabled)throw Error('Collect button unavailable');b.click()})()`)
    else await evaluate(`window.signalDesk.collectVideoInformation(${creatorId})`)
    let state;const deadline=Date.now()+65000
    do{
      state=await evaluate('window.signalDesk.getVideoInformationStatus()')
      if(state.runId!==before.runId&&state.phase!=='running'&&(state.phase!=='completed'||action!=='collect-ui'||state.displayedTotalMs!==undefined))break
      await new Promise(resolve=>setTimeout(resolve,400))
    }while(Date.now()<deadline)
    const report={operatorStartToReportMs:performance.now()-started,...state,...(action==='collect-ui'?{view:await evaluate(`window.signalDesk.getCreatorVideos(${creatorId})`),displayText:await evaluate(`document.querySelector('[data-testid="video-information-page"]')?.innerText`)}:{})}
    writeFileSync(join(output,`${state.runId||'failed'}-verification.json`),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
    if(state.phase!=='completed'||(action==='collect-ui'&&state.displayedTotalMs===undefined))process.exitCode=1
  }else if(action==='status')console.log(JSON.stringify(await evaluate('window.signalDesk.getVideoInformationStatus()'),null,2))
  else{
    if(action==='open')console.log(JSON.stringify(await evaluate(`window.signalDesk.getCreatorVideos(${creatorId})`),null,2))
    const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    writeFileSync(join(output,'video-information-app.png'),Buffer.from(result.data,'base64'))
  }
}finally{socket.close()}
