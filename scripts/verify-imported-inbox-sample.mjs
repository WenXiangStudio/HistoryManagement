// Verify the imported result in the daily APP. Only navigation and inbox read-state updates.
import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('local-data/video-workflow-20261013'),workId='7682043534987300106'
const expected=JSON.parse(readFileSync(join(root,'qa-body-and-research.json'),'utf8'))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<60;i++){
  try{page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}
  await pause(100)
}
assert.ok(page,'Daily APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0
await new Promise(r=>socket.addEventListener('open',r,{once:true}))
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id)pending.get(m.id)?.(m)
  if(m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params)})
const send=(method,params={})=>new Promise((resolveCall,reject)=>{const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(Error('APP verification timeout'))},10000)
  pending.set(requestId,m=>{clearTimeout(timer);pending.delete(requestId);m.error||m.result?.exceptionDetails?reject(Error(JSON.stringify(m.error??m.result.exceptionDetails))):resolveCall(m.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
try{
  await send('Runtime.enable');await pause(500)
  const before=await evaluate('window.signalDesk.getVideoLibrary()'),work=before.records.find(w=>w.workId===workId)
  assert.ok(work);assert.equal(work.content.interest,'interested')
  const initialInboxState=work.content.inboxState??'unread'
  assert.deepEqual(work.content.body,expected.body);assert.deepEqual(work.content.research,expected.research)
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('今日收件箱')).click()")
  if(initialInboxState!=='unread')await evaluate("[...document.querySelectorAll('.segmented button')].find(b=>b.textContent==='全部').click()")
  await pause(700)
  assert.ok(await evaluate("[...document.querySelectorAll('.material-inbox-card')].some(c=>c.textContent.includes('PS+AI精准控图'))"))
  await evaluate("document.querySelector('.material-inbox-heading').scrollIntoView({block:'start'})");await pause(200)
  let screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  writeFileSync(join(root,'formal-inbox-sample.png'),Buffer.from(screenshot.data,'base64'))
  await evaluate("[...document.querySelectorAll('.material-inbox-card')].find(c=>c.textContent.includes('PS+AI精准控图')).querySelector('.detail-button').click()")
  await pause(400)
  const shown=await evaluate("({title:document.querySelector('.material-drawer h2').textContent,body:document.querySelector('[data-testid=material-body]').textContent,report:document.querySelector('.material-report-section').textContent,timestamps:document.querySelectorAll('[data-testid=material-body] time').length,overflow:document.documentElement.scrollWidth>innerWidth})")
  assert.equal(shown.title,work.title);assert.equal(shown.body,expected.body.text);assert.equal(shown.timestamps,0);assert.equal(shown.overflow,false)
  for(const text of [expected.research.overview,expected.research.analysis,'主要观点与原文依据','可能涉及的领域','模型推测'])assert.ok(shown.report.includes(text),text)
  screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  writeFileSync(join(root,'formal-inbox-detail.png'),Buffer.from(screenshot.data,'base64'))
  await evaluate("document.querySelector('[aria-label=关闭视频详情]').click()")
  await evaluate(`window.signalDesk.setMaterialInboxState(${JSON.stringify(before.ownerSecUid)},'${workId}',${JSON.stringify(initialInboxState)})`)
  await pause(500)
  const after=await evaluate('window.signalDesk.getVideoLibrary()')
  assert.deepEqual(after.contentBatches,before.contentBatches,'No new model processing batches')
  assert.equal(after.records.find(w=>w.workId===workId).content.inboxState,initialInboxState)
  assert.equal(errors.length,0)
  const result={at:new Date().toISOString(),workId,title:shown.title,dailyApp:true,visibleInUnreadInbox:true,fullBodyMatches:true,
    reportMatches:true,reportQuotesValidated:true,noTimestamps:true,horizontalOverflow:false,renderErrors:0,newProcessingBatches:0,newModelCalls:0}
  writeFileSync(join(root,'formal-inbox-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{socket.close()}
