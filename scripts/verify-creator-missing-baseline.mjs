// Read-only daily/candidate UI verification; no collection, repair or model task is started.
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const port=Number(process.argv[2]??9227),label=process.argv[3]??'daily',out=resolve('local-data/creator-missing-baseline-20261013')
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
  const real=creators.filter(c=>!c.isDemo),missing=real.filter(c=>c.activity?.baselineStatus==='missing')
  const anomalies=real.filter(c=>c.activity?.baselineStatus==='missing'||c.activity?.anomaly)
  assert.equal(real.length,302);assert.equal(missing.length,9);assert.equal(real.filter(c=>c.activity?.baselineStatus==='ready').length,293)
  const expectedMissing=['独夫之心前进四','独夫战备','程序员三千','洋洋洋聊AI','晚点聊LateTalk','李奇奇读书号','feliks','Xilo今天Ai了吗','王二讲Agent']
  assert.deepEqual(missing.map(c=>c.nickname).sort(),expectedMissing.sort())
  assert.equal(state.plan?.complete,false);assert.equal(state.plan?.count,140);assert.equal(state.plan?.pageCount,7)
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('博主资料库')).click()");await pause(250)
  const summary=await evaluate('document.body.innerText')
  assert.ok(summary.includes('本轮已读取并保存 140 位 · 资料库累计保留 302 位'))
  assert.ok(summary.includes('本地关注清单尚未完成'))
  await evaluate("document.querySelector('[data-testid=creator-section-anomaly]').click()");await pause(200)
  await evaluate("document.querySelector('.creator-section-toolbar').scrollIntoView({block:'start'})");await pause(200)
  const group=await evaluate(`({button:document.querySelector('[data-testid=refresh-anomaly-creators]')?.textContent,
    cards:[...document.querySelectorAll('.creator-card')].map(e=>({id:Number(e.dataset.creatorId),missing:!!e.querySelector('[data-testid=creator-baseline-missing]'),
      selectable:!!e.querySelector('[data-testid=select-creator-refresh]'),repair:e.querySelector('[data-testid=refresh-one-creator]')?.textContent})),
    overflow:document.documentElement.scrollWidth>innerWidth})`)
  assert.equal(group.button,'一键核验并补齐'+anomalies.length)
  assert.deepEqual(group.cards.map(c=>c.id).sort((a,b)=>a-b),anomalies.map(c=>c.id).sort((a,b)=>a-b))
  assert.equal(group.cards.filter(c=>c.missing).length,9);assert.ok(group.cards.every(c=>!c.selectable&&c.repair==='核验并补齐'))
  assert.equal(group.overflow,false);await shot('anomaly-wide')
  await evaluate(`document.querySelector('[data-creator-id="${missing[0].id}"]').scrollIntoView({block:'start'})`);await pause(200)
  await shot('missing-card-wide')
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await shot('missing-card-1120')
  await send('Emulation.clearDeviceMetricsOverride')
  await evaluate("document.querySelector('[data-testid=creator-section-dormant]').click()");await pause(200)
  assert.equal(await evaluate("document.querySelector('[data-testid=refresh-creator-activity]')?.textContent"),'全量更新'+(real.length-anomalies.length))
  for(const key of ['active','regular','inactive','dormant']){
    await evaluate(`document.querySelector('[data-testid=creator-section-${key}]').click()`);await pause(100)
    assert.equal(await evaluate("document.querySelectorAll('[data-testid=creator-baseline-missing]').length"),0)
  }
  await evaluate("document.querySelector('[data-testid=creator-section-anomaly]').click()");await pause(150)
  await evaluate("document.querySelector('.creator-section-toolbar').scrollIntoView({block:'start'})")
  const after=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  assert.equal(after.activity?.runId,state.activity?.runId);assert.equal(after.plan?.count,state.plan?.count);assert.equal(errors.length,0)
  const report={at:new Date().toISOString(),version:'0.1.31',realCreators:302,missingBaselines:missing.map(c=>({id:c.id,nickname:c.nickname})),verifiedBaselines:293,
    anomalyCount:anomalies.length,ordinaryRefreshCount:real.length-anomalies.length,plan:{count:140,pageCount:7,complete:false},group,
    renderErrors:0,width1120NoOverflow:true,newCollection:false,newModelCalls:0}
  writeFileSync(join(out,`${label}-ui.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
