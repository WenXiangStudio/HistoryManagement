// Read-only APP UI verification. Does not click collection or access Chrome CDP.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
const output=resolve('local-data/video-library-20261010');mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Local review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const data=JSON.parse(event.data);pending.get(data.id)?.(data)})
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(Error('APP timed out'))},10000)
  pending.set(requestId,value=>{clearTimeout(timer);pending.delete(requestId);value.error||value.result?.exceptionDetails?reject(Error('APP evaluation failed')):resolve(value.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))
})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const screenshot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,name),Buffer.from(r.data,'base64'))}
try{
  const library=await evaluate('window.signalDesk.getVideoLibrary()')
  assert.ok(library.records.length>0,'Need existing saved records for read-only visual QA')
  const stateBefore=await evaluate('window.signalDesk.getVideoInformationStatus()')
  await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()`)
  const deadline=Date.now()+5000
  while(!await evaluate(`!!document.querySelector('[data-work-id]')`)){if(Date.now()>deadline)throw Error('Video page did not load');await pause(100)}
  const longest=[...library.records].sort((a,b)=>(b.description?.length||0)-(a.description?.length||0))[0]
  await evaluate(`document.querySelector('[data-work-id="${longest.workId}"]').click()`)
  await pause(250)
  const initial=await evaluate(`({navigation:document.querySelector('nav .active')?.textContent,description:document.querySelector('.video-library-description')?.textContent,count:document.querySelectorAll('[data-work-id]').length,dialog:!!document.querySelector('[role="dialog"]'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth})`)
  assert.equal(initial.navigation,'视频信息');assert.equal(initial.description,longest.description);assert.equal(initial.dialog,false);assert.equal(initial.horizontalOverflow,false)
  await screenshot('video-library-wide.png')
  // Search a phrase from the full description through the same input events as typing.
  const query=longest.description?.slice(0,6)||longest.workId
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await pause(100);assert.ok(await evaluate(`!!document.querySelector('[data-work-id="${longest.workId}"]')`))
  await evaluate(`document.querySelector('[aria-label="清空搜索"]').click()`)
  await evaluate(`document.querySelector('[data-work-id="${longest.workId}"]').click()`)
  await evaluate(`document.querySelector('.video-library-author button').click()`)
  await pause(500)
  assert.ok((await evaluate(`document.querySelector('nav .active').textContent`)).includes('博主资料库'))
  assert.equal(await evaluate(`document.querySelectorAll('.creator-card').length`),1)
  await evaluate(`document.querySelector('[data-testid="open-video-information"]').click()`)
  await pause(250)
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-id]').length`),1)
  await evaluate(`document.querySelector('.video-library-list-heading button').click()`)
  await evaluate(`document.querySelector('[data-work-id="${longest.workId}"]').click()`)
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false})
  await pause(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await screenshot('video-library-1120.png')
  await evaluate(`document.querySelector('.video-library-reading').scrollTop=document.querySelector('.video-library-reading').scrollHeight`)
  await pause(250);await screenshot('video-library-1120-footer.png')
  await send('Emulation.clearDeviceMetricsOverride')
  await evaluate(`document.querySelector('.video-library-reading').scrollTop=0`)
  await pause(4000);await screenshot('video-library-wide.png')
  const stateAfter=await evaluate('window.signalDesk.getVideoInformationStatus()')
  assert.equal(stateAfter.runId,stateBefore.runId,'Opening and filtering must not start collection')
  const result={recordCount:library.records.length,fullDescriptionMatches:true,navigationRoundTrip:true,creatorFilter:true,search:true,
    responsiveWidth1120:true,collectionStarted:false,latestRunUnchanged:stateAfter.runId===stateBefore.runId}
  writeFileSync(join(output,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});socket.close()}
