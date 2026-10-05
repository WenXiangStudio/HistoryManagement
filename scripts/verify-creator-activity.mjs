// Development validation of the actual APP buttons; not part of the product workflow.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const action=process.argv[2]||'status',output=resolve(process.argv[3]||'local-data/creator-activity-20261003'),singleName=process.argv[4]||'IT咖啡馆'
if(!['status','single','all','resume'].includes(action))throw new Error('Expected status, single, all or resume')
mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const value=JSON.parse(event.data);pending.get(value.id)?.(value);pending.delete(value.id)})
const send=(method,params)=>new Promise((resolve,reject)=>{const requestId=++id,timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('APP evaluation timed out'))},10000);pending.set(requestId,value=>{clearTimeout(timeout);value.error||value.result?.exceptionDetails?reject(new Error(JSON.stringify(value.error||value.result.exceptionDetails))):resolve(value.result)});socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
try{
  const deadline=Date.now()+40000
  let before
  do{before=JSON.parse(await evaluate('(async()=>JSON.stringify({state:await window.signalDesk.getFollowingSyncStatus(),creators:await window.signalDesk.listCreators()}))()'));if(before.state.readiness?.phase==='ready'&&before.state.connection?.online)break;await new Promise(resolve=>setTimeout(resolve,200))}while(Date.now()<deadline)
  if(action==='status'){console.log(JSON.stringify({state:before.state,creatorCount:before.creators.length,knownCounts:before.creators.filter(c=>c.activity?.workCount!==null).length},null,2))}
  else{
    if(before.state.readiness?.phase!=='ready'||!before.state.connection?.online)throw new Error('APP not ready')
    const single=before.creators.find(c=>c.nickname===singleName);if(action==='single'&&!single)throw new Error('Saved probe author unavailable')
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('博主资料库')).click()`)
    await new Promise(resolve=>setTimeout(resolve,250))
    const started=performance.now()
    await evaluate(action==='all'?`document.querySelector('[data-testid="refresh-creator-activity"]').click()`:action==='resume'?`[...document.querySelectorAll('.creator-activity-toolbar button')].find(b=>b.textContent.includes('继续剩余')).click()`:
      `(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('.creator-profile-link')?.getAttribute('href')===${JSON.stringify(single.profileUrl)});card.querySelector('[data-testid="refresh-one-creator"]').click()})()`)
    let runId,state
    const samples=[]
    const runDeadline=Date.now()+60*60*1000
    let lastLogAt=0
    do{
      state=JSON.parse(await evaluate('window.signalDesk.getFollowingSyncStatus().then(s=>JSON.stringify(s.activity))'))
      if(state.runId!==before.state.activity?.runId){runId=state.runId;samples.push({elapsedMs:performance.now()-started,phase:state.phase,done:state.done,succeeded:state.succeeded,failed:state.failed})}
      if(runId&&state.phase!=='running')break
      if(Date.now()-lastLogAt>30000){console.log(JSON.stringify({phase:state.phase,done:state.done,total:state.total,succeeded:state.succeeded,failed:state.failed,current:state.currentName}));lastLogAt=Date.now()}
      await new Promise(resolve=>setTimeout(resolve,1000))
    }while(Date.now()<runDeadline)
    if(!runId||state.phase==='running')throw new Error('Refresh timed out')
    await new Promise(resolve=>setTimeout(resolve,300))
    const result=JSON.parse(await evaluate(`(async()=>JSON.stringify({state:await window.signalDesk.getFollowingSyncStatus(),creators:await window.signalDesk.listCreators(),cards:[...document.querySelectorAll('.creator-card')].map(c=>({name:c.querySelector('h3')?.textContent,count:c.querySelector('[data-testid="creator-public-work-count"]')?.textContent,weekly:c.querySelector('[data-testid="creator-weekly-update"]')?.textContent,check:c.querySelector('.creator-activity-check')?.textContent})),loadedAvatars:[...document.querySelectorAll('.creator-card .avatar img')].filter(i=>i.complete&&i.naturalWidth).length}))()`))
    const artifact={action,observedClickToResultsMs:performance.now()-started,runId,...result,samples}
    writeFileSync(join(output,action+'-verification.json'),JSON.stringify(artifact,null,2))
    if(action==='single')await evaluate(`[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('.creator-profile-link')?.getAttribute('href')===${JSON.stringify(single.profileUrl)})?.scrollIntoView({block:'center'})`)
    else await evaluate(`document.querySelector('.workspace').scrollTop=0`)
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    writeFileSync(join(output,action+'-app.png'),Buffer.from(screenshot.data,'base64'))
    console.log(JSON.stringify({action,runId,phase:state.phase,total:state.total,succeeded:state.succeeded,failed:state.failed,creatorCount:result.creators.length,knownCounts:result.creators.filter(c=>c.activity?.workCount!==null).length,loadedAvatars:result.loadedAvatars,observedClickToResultsMs:artifact.observedClickToResultsMs,appTiming:result.state.activity.displayedTotalMs,example:action==='single'?result.creators.find(c=>c.id===single.id):result.creators.filter(c=>c.activity?.weeklyStatus==='updated').slice(0,3).map(c=>({name:c.nickname,activity:c.activity}))},null,2))
  }
}finally{socket.close()}
