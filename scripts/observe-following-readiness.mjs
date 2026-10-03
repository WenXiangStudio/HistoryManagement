import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const output=resolve(process.argv[2]||'local-data/following-readiness-20261003')
mkdirSync(output,{recursive:true})
let page
const discoveryDeadline=Date.now()+15000
while(!page&&Date.now()<discoveryDeadline){
  try{page=(await fetch('http://127.0.0.1:9227/json').then(response=>response.json())).find(item=>item.type==='page'&&item.title==='Signal Desk')}catch{}
  if(!page)await new Promise(resolve=>setTimeout(resolve,100))
}
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0
const pending=new Map()
socket.addEventListener('message',event=>{const item=JSON.parse(event.data);if(pending.has(item.id)){pending.get(item.id)(item);pending.delete(item.id)}})
const send=(method,params)=>new Promise((resolve,reject)=>{
  const requestId=++id,timeout=setTimeout(()=>reject(new Error('Inspection timed out')),10000)
  pending.set(requestId,item=>{clearTimeout(timeout);item.error?reject(new Error(JSON.stringify(item.error))):resolve(item.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))
})
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
  return JSON.parse(result.result.value)
}
const samples=[]
let checkedGate=false,previousRun,previousCount,finished=false,lockedScreenshot=false
const start=performance.now(),deadline=Date.now()+60000
try{
  while(Date.now()<deadline){
    const sample=await evaluate(`(async()=>JSON.stringify({state:await window.signalDesk.getFollowingSyncStatus(),
      disabled:document.querySelector('[data-testid="start-following-sync"]')?.disabled,
      button:document.querySelector('[data-testid="start-following-sync"]')?.textContent,
      notice:document.querySelector('[data-testid="following-connection"]')?.innerText}))()`)
    sample.elapsedMs=performance.now()-start
    samples.push(sample)
    if(previousRun===undefined){previousRun=sample.state.runId;previousCount=(await evaluate('window.signalDesk.listCreators().then(rows=>JSON.stringify(rows.length))'))}
    if(sample.state.readiness?.phase!=='ready'&&sample.disabled===true&&!checkedGate){
      const rejection=await evaluate(`window.signalDesk.refreshFollowing(10).then(()=>JSON.stringify({rejected:false})).catch(error=>JSON.stringify({rejected:true,error:String(error)}))`)
      if(!rejection.rejected||!rejection.error.includes('尚未准备好'))throw new Error('Main process readiness gate failed')
      checkedGate=true
    }
    if(sample.disabled&&!lockedScreenshot){
      const shot=await send('Page.captureScreenshot',{format:'png'})
      writeFileSync(join(output,'app-preparing.png'),Buffer.from(shot.data,'base64'));lockedScreenshot=true
    }
    if(sample.state.readiness?.phase==='ready'&&sample.state.connection?.online&&sample.disabled===false){finished=true;break}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  const creators=await evaluate('window.signalDesk.listCreators().then(rows=>JSON.stringify(rows))')
  const last=samples.at(-1)
  const result={ok:finished,sawDisabled:samples.some(item=>item.disabled===true),mainGateRejected:checkedGate,
    previousRun,currentRun:last.state.runId,previousCount,currentCount:creators.length,unchangedRun:previousRun===last.state.runId,
    observedPreparationMs:last.elapsedMs,samples,creators}
  writeFileSync(join(output,'readiness-observation.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({ok:result.ok,sawDisabled:result.sawDisabled,mainGateRejected:checkedGate,previousCount,currentCount:creators.length,
    unchangedRun:result.unchangedRun,observedPreparationMs:result.observedPreparationMs,state:last.state},null,2))
  if(!finished||!result.sawDisabled||!checkedGate||!result.unchangedRun||previousCount!==creators.length)throw new Error('Readiness or zero-write verification failed')
}finally{socket.close()}
