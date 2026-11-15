// Read-only current APP UI check. Does not click interest, classify or cloud processing.
import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve('local-data/video-workflow-20261013')
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page')
if(!page)throw Error('Current APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0
await new Promise(resolveOpen=>socket.addEventListener('open',resolveOpen,{once:true}))
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id)pending.get(m.id)?.(m)
  if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params)})
const send=(method,params={})=>new Promise((resolveCall,reject)=>{const requestId=++id;pending.set(requestId,m=>{pending.delete(requestId);m.error||m.result?.exceptionDetails?reject(Error(JSON.stringify(m.error??m.result.exceptionDetails))):resolveCall(m.result)});socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  await send('Runtime.enable');await pause(600)
  const library=await evaluate('window.signalDesk.getVideoLibrary()'),creators=await evaluate('window.signalDesk.listCreators()')
  assert.equal(library.records.length,79);assert.equal(library.records.filter(w=>w.content?.classification).length,14)
  assert.ok(creators.length>=295)
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()");await pause(700)
  const workId='7694535682575860393'
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${workId}');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(200)
  await evaluate(`document.querySelector('[data-work-id="${workId}"]').click()`);await pause(700)
  await evaluate("document.querySelector('.video-library-reading').scrollTop=240");await pause(200)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  assert.equal(await evaluate("document.querySelectorAll('.triage-frames img').length"),8)
  assert.ok(await evaluate("document.querySelector('.video-classification').textContent.includes('已人工确认')"))
  assert.equal(await evaluate("[...document.querySelectorAll('.video-interest-actions button')].find(b=>b.textContent==='感兴趣').disabled"),false)
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(out,'current-video-information.png'),Buffer.from(screenshot.data,'base64'))
  const settings=await evaluate('window.signalDesk.getSettings()'),status=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  const report={at:new Date().toISOString(),version:'0.1.26',videoCount:library.records.length,classificationCount:14,creatorCount:creators.length,
    screenshotsShown:8,acceptedLabelsShown:true,interestActionsEnabled:true,horizontalOverflow:false,activeModel:settings.textModel,
    connectionOnline:status.connection?.online,readiness:status.readiness?.phase,errors}
  assert.equal(errors.length,0);writeFileSync(join(out,'current-app-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
  const final=await evaluate('window.signalDesk.getVideoLibrary()')
  assert.deepEqual(final.records.map(w=>[w.workId,w.content?.interest]),library.records.map(w=>[w.workId,w.content?.interest]))
}finally{socket.close()}
