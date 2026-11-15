// Read-only daily APP visual verification; never starts a real repair batch.
import {writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve('local-data/anomaly-batch-repair-20261013'),pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<80;i++){
  try{page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}
  await pause(100)
}
assert.ok(page,'Daily APP unavailable')
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
  await send('Runtime.enable');await pause(500)
  const creators=await evaluate('window.signalDesk.listCreators()'),state=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  const anomalies=creators.filter(c=>!c.isDemo&&c.activity?.anomaly)
  assert.ok(![state.phase,state.basic?.phase,state.activity?.phase,state.videoInformation?.phase].includes('running'))
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('博主资料库')).click()")
  await pause(400)
  await evaluate("document.querySelector('[data-testid=creator-section-anomaly]').click()")
  await pause(200)
  await evaluate("document.querySelector('.creator-section-toolbar').scrollIntoView({block:'start'})")
  await pause(200)
  const view=await evaluate("({label:document.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent,count:document.querySelector('[data-testid=refresh-anomaly-creators] .creator-refresh-button-count')?.textContent,disabled:document.querySelector('[data-testid=refresh-anomaly-creators]')?.disabled,title:document.querySelector('[data-testid=refresh-anomaly-creators]')?.title,cards:document.querySelectorAll('.creator-zone-anomaly .creator-card').length,overflow:document.documentElement.scrollWidth>innerWidth})")
  assert.equal(view.label,'一键核验并补齐'+anomalies.length);assert.equal(view.count,String(anomalies.length));assert.equal(view.cards,anomalies.length)
  assert.equal(view.disabled,!(state.connection?.online&&state.readiness?.phase==='ready'&&anomalies.length));assert.equal(view.overflow,false)
  await shot('anomaly-batch-wide.png')
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(300)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await shot('anomaly-batch-1120.png');await send('Emulation.clearDeviceMetricsOverride')
  const after=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  assert.equal(after.activity?.runId,state.activity?.runId,'Navigation must not start repair')
  assert.equal(errors.length,0)
  const report={at:new Date().toISOString(),version:'0.1.27',anomalyCount:anomalies.length,view,renderErrors:0,width1120NoOverflow:true,
    repairStarted:false,currentActivityRunUnchanged:true,online:state.connection?.online,readiness:state.readiness?.phase}
  writeFileSync(join(out,'daily-ui-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
