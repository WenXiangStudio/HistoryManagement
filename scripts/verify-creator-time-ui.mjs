// Read-only QA of the daily APP, corrected counts and persisted inactive timeline labels.
import {writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve('local-data/creator-time-baseline-20261013'),pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<100;i++){try{page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}await pause(100)}
assert.ok(page)
const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0
await new Promise(r=>socket.addEventListener('open',r,{once:true}))
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id)pending.get(m.id)?.(m)
  if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params)})
const send=(method,params={})=>new Promise((resolveCall,reject)=>{const requestId=++id,timer=setTimeout(()=>reject(Error('APP timeout')),15000)
  pending.set(requestId,m=>{clearTimeout(timer);pending.delete(requestId);m.error||m.result?.exceptionDetails?reject(Error(JSON.stringify(m.error??m.result.exceptionDetails))):resolveCall(m.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(out,name),Buffer.from(r.data,'base64'))}
try{
  await send('Runtime.enable');await pause(600)
  const creators=await evaluate('window.signalDesk.listCreators()'),state=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  const curve=creators.find(c=>c.nickname==='曲木古也'),foye=creators.find(c=>c.nickname==='foyege')
  assert.equal(curve.activity.anomaly.comparison.newPublicWorks,14);assert.equal(foye.activity.anomaly.comparison.newPublicWorks,1)
  const timeline=await evaluate(`window.signalDesk.getCreatorWorkTimeline(${JSON.stringify(state.ownerSecUid)},${foye.id})`)
  assert.ok(timeline.works.some(w=>w.state==='invalid'))
  assert.ok(timeline.works.every((w,i)=>!i||w.publishedAt>=timeline.works[i-1].publishedAt))
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('博主资料库')).click()");await pause(250)
  await evaluate("document.querySelector('[data-testid=creator-section-anomaly]').click()");await pause(200)
  await evaluate("document.querySelector('.creator-section-toolbar').scrollIntoView({block:'start'})");await pause(200)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await shot('corrected-counts-wide.png')
  const shown=await evaluate(`({curve:document.querySelector('[data-creator-id="${curve.id}"] [data-testid=creator-time-observation]').textContent,foye:document.querySelector('[data-creator-id="${foye.id}"] [data-testid=creator-time-observation]').textContent})`)
  assert.ok(shown.curve.includes('14 条新作品'));assert.ok(shown.foye.includes('1 条新作品'))
  await evaluate(`(()=>{const d=document.querySelector('[data-creator-id="${foye.id}"] .creator-work-timeline');d.open=true;d.dispatchEvent(new Event('toggle'))})()`);await pause(350)
  const rows=await evaluate(`({count:document.querySelectorAll('[data-creator-id="${foye.id}"] .creator-work-timeline li').length,invalid:document.querySelectorAll('[data-creator-id="${foye.id}"] .creator-work-timeline li.invalid').length,text:document.querySelector('[data-creator-id="${foye.id}"] .creator-work-timeline').textContent})`)
  assert.ok(rows.count>0);assert.ok(rows.invalid>0);assert.ok(rows.text.includes('已失效'))
  await evaluate(`document.querySelector('[data-creator-id="${foye.id}"] .creator-time-observation').scrollIntoView({block:'center'})`);await pause(250)
  await evaluate(`document.querySelector('[data-creator-id="${foye.id}"] .creator-work-timeline li.invalid').scrollIntoView({block:'center'})`);await pause(200)
  await shot('timeline-invalid-wide.png')
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(300)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await shot('timeline-invalid-1120.png');await send('Emulation.clearDeviceMetricsOverride')
  const after=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  assert.equal(after.activity?.runId,state.activity?.runId);assert.equal(errors.length,0)
  const report={at:new Date().toISOString(),version:'0.1.28',curveNewWorks:14,foyeNewWorks:1,cumulativeSorted:true,inactiveRetained:true,
    timelineRecords:timeline.works.length,inactiveRecords:timeline.works.filter(w=>w.state==='invalid').length,renderErrors:0,horizontalOverflow:false,
    originalActivityRunUnchanged:true,newBrowserCollection:false,newModelCalls:0}
  writeFileSync(join(out,'daily-ui-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
