import {writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
const output=resolve(process.argv[2]||'local-data/following-fast-flow-20261001')
const limit=Number(process.argv[3]||20)
if(![10,20].includes(limit))throw new Error('Expected 10 or 20 creators')
mkdirSync(output,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(response=>response.json())
const page=pages.find(item=>item.type==='page'&&item.title==='Signal Desk')
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
const pending=new Map();let id=0
socket.addEventListener('message',event=>{const item=JSON.parse(event.data);if(pending.has(item.id)){pending.get(item.id)(item);pending.delete(item.id)}})
const evaluate=expression=>new Promise((resolve,reject)=>{
  const requestId=++id,timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('APP benchmark timed out'))},40000)
  pending.set(requestId,item=>{clearTimeout(timeout);if(item.error||item.result?.exceptionDetails)reject(new Error(JSON.stringify(item.error||item.result.exceptionDetails)))
    else resolve(JSON.parse(item.result.result.value))})
  socket.send(JSON.stringify({id:requestId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))
})
try{
  const result=await evaluate(`(async()=>{
    const before=await window.signalDesk.listCreators();const known=new Set(before.map(item=>item.profileUrl))
    const previousRun=(await window.signalDesk.getFollowingSyncStatus()).runId
    const select=document.querySelector('select[aria-label="本次新增博主数量"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${limit})
    select.dispatchEvent(new Event('change',{bubbles:true}))
    const startedAt=new Date().toISOString(),start=performance.now()
    document.querySelector('[data-testid="start-following-sync"]').click()
    const deadline=performance.now()+30000
    let state
    while(performance.now()<deadline){
      state=await window.signalDesk.getFollowingSyncStatus()
      if(state.runId===previousRun){await new Promise(resolve=>setTimeout(resolve,50));continue}
      if(state.phase==='blocked')return JSON.stringify({ok:false,startedAt,elapsedMs:performance.now()-start,state})
      if(state.phase==='completed'&&state.timing?.displayedTotalMs!==undefined)break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    if(state?.phase!=='completed'||state.timing?.displayedTotalMs===undefined)throw new Error('Full flow did not finish with rendered acknowledgement: '+JSON.stringify(state))
    const after=await window.signalDesk.listCreators(),added=after.filter(item=>!known.has(item.profileUrl))
    const cards=[...document.querySelectorAll('.creator-card')].map(card=>({nickname:card.querySelector('h3')?.innerText,
      profileUrl:card.querySelector('.creator-profile-link')?.getAttribute('href'),avatarUrl:card.querySelector('.avatar img')?.currentSrc,
      loaded:!!card.querySelector('.avatar img')?.naturalWidth}))
    return JSON.stringify({ok:true,startedAt,finishedAt:new Date().toISOString(),observedClickToReadyMs:performance.now()-start,state,
      beforeCount:before.length,afterCount:after.length,added,creators:after,cards,
      retained:before.every(prior=>after.some(saved=>saved.id===prior.id&&saved.nickname===prior.nickname&&saved.avatarUrl===prior.avatarUrl&&saved.profileUrl===prior.profileUrl&&saved.note===prior.note&&saved.isStarred===prior.isStarred))})
  })()`)
  writeFileSync(output+'/app-benchmark.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify({ok:result.ok,elapsedMs:result.observedClickToReadyMs||result.elapsedMs,state:result.state,
    beforeCount:result.beforeCount,afterCount:result.afterCount,addedCount:result.added?.length,retained:result.retained},null,2))
  if(!result.ok)throw new Error(result.state.message)
}finally{socket.close()}
