// Read-only verification of one saved frontend counter and its card; never starts collection.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const output=resolve(process.argv[2]||'local-data/frontend-work-count-20261004'),name=process.argv[3]||'Boujoy'
mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);pending.get(m.id)?.(m);pending.delete(m.id)})
const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('UI check timed out'))},10000);pending.set(requestId,m=>{clearTimeout(timer);m.error||m.result?.exceptionDetails?reject(new Error(JSON.stringify(m.error||m.result.exceptionDetails))):resolve(m.result)});socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
const inspect=()=>evaluate(`(async()=>{
  const rows=await window.signalDesk.listCreators(),row=rows.find(r=>r.nickname===${JSON.stringify(name)}),cards=[...document.querySelectorAll('.creator-card')],card=cards.find(c=>Number(c.dataset.creatorId)===row.id),workspace=document.querySelector('.workspace')
  card.scrollIntoView({block:'center'})
  return {creators:rows.length,cards:cards.length,unique:new Set(cards.map(c=>c.dataset.creatorId)).size,name:row.nickname,saved:row.activity.workCount,
    displayed:card.querySelector('[data-testid="creator-public-work-count"]').textContent,checkedAt:row.activity.countCheckedAt,
    noHorizontalOverflow:workspace.scrollWidth<=workspace.clientWidth,
    noBiographyOverlap:cards.every(c=>c.querySelector('.creator-biography').getBoundingClientRect().bottom<=c.querySelector('.creator-profile-link').getBoundingClientRect().top+.5),
    analyzedPreserved:cards.every(c=>c.querySelector('[data-testid="creator-analyzed-count"]').textContent==='—'),
    zones:Object.fromEntries(['today','week','none'].map(key=>[key,document.querySelector('[data-testid="creator-zone-'+key+'"]').querySelectorAll('.creator-card').length]))}
})()`)
const verify=r=>{assert.equal(r.creators,200);assert.equal(r.cards,200);assert.equal(r.unique,200);assert.equal(r.displayed,String(r.saved));assert.ok(r.noHorizontalOverflow&&r.noBiographyOverlap&&r.analyzedPreserved)}
try{
  const deadline=Date.now()+10000
  while(Date.now()<deadline){
    if(await evaluate(`[...document.querySelectorAll('nav button')].some(b=>b.textContent.includes('博主资料库'))`))break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('博主资料库')).click()`);await frames();await evaluate('document.fonts.ready.then(()=>true)');await frames()
  while(Date.now()<deadline){if(await evaluate('document.querySelectorAll(".creator-card").length===200'))break;await new Promise(resolve=>setTimeout(resolve,100))}
  const normal=await inspect();verify(normal);await frames()
  let screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,'frontend-count-card.png'),Buffer.from(screenshot.data,'base64'))
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await frames()
  const compact=await inspect();verify(compact);await frames()
  screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,'frontend-count-compact.png'),Buffer.from(screenshot.data,'base64'))
  const result={recordedAt:new Date().toISOString(),normal,compact,newCollectionStarted:false}
  writeFileSync(join(output,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
