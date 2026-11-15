// Read-only visual checks. This script never starts creator collection or model processing.
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const port=Number(process.argv[2]??9227),label=process.argv[3]??'daily',out=resolve('local-data/creator-card-refresh-20261013')
mkdirSync(out,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<100;i++){try{page=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}await pause(100)}
assert.ok(page,'APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0
await new Promise(r=>socket.addEventListener('open',r,{once:true}))
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id)pending.get(m.id)?.(m)
  if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params)})
const send=(method,params={})=>new Promise((resolveCall,reject)=>{const requestId=++id,timer=setTimeout(()=>reject(Error('APP timeout')),15000)
  pending.set(requestId,m=>{clearTimeout(timer);pending.delete(requestId);m.error||m.result?.exceptionDetails?reject(Error(JSON.stringify(m.error??m.result.exceptionDetails))):resolveCall(m.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(out,`${label}-${name}.png`),Buffer.from(r.data,'base64'))}
try{
  await send('Runtime.enable');await pause(600)
  const creators=await evaluate('window.signalDesk.listCreators()'),state=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  assert.ok(![state.phase,state.basic?.phase,state.activity?.phase,state.videoInformation?.phase].includes('running'))
  const target=creators.find(c=>!c.isDemo&&c.activity?.workObservation?.previousCount===211&&c.activity.workObservation.countChange===2)
    ??creators.find(c=>!c.isDemo&&c.activity?.workObservation?.timeBaseline&&c.activity.workObservation.newWorkIds.length>0)
    ??creators.find(c=>!c.isDemo&&c.activity?.workObservation)
  assert.ok(target)
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('博主资料库')).click()");await pause(250)
  let section
  for(const key of ['active','regular','inactive','dormant','anomaly']){
    await evaluate(`document.querySelector('[data-testid=creator-section-${key}]').click()`);await pause(150)
    if(await evaluate(`!!document.querySelector('[data-creator-id="${target.id}"]')`)){section=key;break}
  }
  assert.ok(section,'Saved target card unavailable')
  await evaluate("document.querySelector('.creator-section-toolbar').scrollIntoView({block:'start'})");await pause(200)
  const saved=await evaluate(`(()=>{const results=[...document.querySelectorAll('[data-testid=creator-time-observation]')];return {
    cards:results.length,dated:results.every(e=>e.querySelector('.creator-observation-header time[datetime]')&&e.textContent.includes('最近采集结果')),
    oldWording:results.some(e=>e.textContent.includes('本次读取到')),freshBadges:document.querySelectorAll('[data-testid=creator-current-refresh]').length,
    backgrounds:[...new Set(results.map(e=>getComputedStyle(e).backgroundColor))],overflow:document.documentElement.scrollWidth>innerWidth}})()`)
  assert.ok(saved.cards>0);assert.ok(saved.dated);assert.equal(saved.oldWording,false);assert.equal(saved.freshBadges,0)
  assert.deepEqual(saved.backgrounds,['rgb(248, 249, 250)']);assert.equal(saved.overflow,false)
  await shot('saved-results-wide')
  await evaluate(`document.querySelector('[data-creator-id="${target.id}"] [data-testid=creator-time-observation]').scrollIntoView({block:'center'})`);await pause(200)
  await shot('saved-card-wide')
  const panel=await evaluate(`(()=>{const r=document.querySelector('[data-creator-id="${target.id}"] [data-testid=creator-time-observation]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
  const clipped=await send('Page.captureScreenshot',{format:'png',clip:panel,captureBeyondViewport:false})
  writeFileSync(join(out,`${label}-saved-card-panel.png`),Buffer.from(clipped.data,'base64'))
  await evaluate(`(()=>{const d=document.querySelector('[data-creator-id="${target.id}"] .creator-work-timeline');d.open=true;d.dispatchEvent(new Event('toggle'))})()`);await pause(350)
  const details=await evaluate(`(()=>{const e=document.querySelector('[data-creator-id="${target.id}"] .creator-work-timeline');return {text:e.textContent,rows:e.querySelectorAll('li').length}})()`)
  assert.ok(details.rows>0);assert.ok(details.text.includes('统计区间：发布时间晚于'))
  await shot('expanded-interval-wide')
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await shot('saved-card-1120');await send('Emulation.clearDeviceMetricsOverride')
  await evaluate(`document.querySelector('[data-creator-id="${target.id}"] .creator-work-timeline').open=false`)
  const after=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  assert.equal(after.activity?.runId,state.activity?.runId);assert.equal(errors.length,0)
  const report={at:new Date().toISOString(),version:'0.1.29',target:{id:target.id,nickname:target.nickname,section},saved,timelineRows:details.rows,intervalAvailable:true,
    width1120NoOverflow:true,renderErrors:0,newBrowserCollection:false,newModelCalls:0,originalActivityRunUnchanged:true}
  writeFileSync(join(out,`${label}-ui.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
