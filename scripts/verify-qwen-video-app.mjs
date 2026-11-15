// Controls only the explicitly launched review APP, never the browser CDP endpoint.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const out=resolve('local-data/qwen-video-app-20261011');mkdirSync(out,{recursive:true})
const action=process.argv[2]||'status',workId='7691353360976416034'
const pages=await fetch('http://127.0.0.1:9227/json').then(r=>r.json())
const page=pages.find(p=>p.type==='page'&&p.title==='Signal Desk'&&p.url.startsWith('file:'))
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Explicit review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let sequence=0,unexpectedDialog=false;const pending=new Map()
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('APP request timeout: '+method))},30000);pending.set(id,m=>{clearTimeout(timer);m.error||m.result?.exceptionDetails?reject(Error(JSON.stringify(m.error||m.result.exceptionDetails))):resolve(m.result)});socket.send(JSON.stringify({id,method,params}))})}
socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}
 if(m.method==='Page.javascriptDialogOpening'){
  const expected=m.params.type==='confirm'&&m.params.message.includes('qwen3.8-omni-flash 处理 1 条视频')
  if(!expected)unexpectedDialog=true
  void send('Page.handleJavaScriptDialog',{accept:expected})
 }})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function show(){
 await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()`);await pause(400)
 await evaluate(`(()=>{const e=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${workId}');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(400)
 await evaluate(`document.querySelector('[data-work-id="${workId}"]')?.click()`);await pause(300)
}
try{
 await send('Page.enable')
 const status=await evaluate('window.signalDesk.getFollowingSyncStatus()')
 console.log(JSON.stringify({action,connection:status.connection,readiness:status.readiness?.phase}))
 const saved=await evaluate('window.signalDesk.getSettings().then(s=>({model:s.textModel,protocol:s.textApiProtocol}))')
 if(saved.model!=='qwen3.8-omni-flash'||saved.protocol!=='responses')throw Error('Unexpected current cloud scheme')
 if(action==='close'){
  if(!page.url.includes('release-following-background-final/win-unpacked/resources/app.asar'))throw Error('Daily review path mismatch')
  await send('Page.close');console.log('Idle review APP page closed')
 }else if(action==='discover'){
  if(!status.connection?.online||status.readiness?.phase!=='ready')throw Error('Browser not ready')
  const library=await evaluate('window.signalDesk.getVideoLibrary()')
  if(library.records.some(w=>w.workId===workId)){console.log('Specified work already saved');}
  else{
   const authors=await evaluate(`window.signalDesk.listCreators().then(cs=>cs.filter(c=>!c.isDemo&&c.nativeUid==='3368506990017837').map(c=>({id:c.id,name:c.nickname})))`)
   if(authors.length!==1)throw Error('Author ownership ambiguous')
   const request={ownerSecUid:library.ownerSecUid,creatorIds:[authors[0].id],startDate:'2026-10-01',endDate:'2026-10-01'}
   const initial=await evaluate(`window.signalDesk.discoverVideoWorks(${JSON.stringify(request)})`)
   let latest;const deadline=Date.now()+180000
   do{await pause(800);latest=await evaluate('window.signalDesk.getVideoLibrary()');if(latest.contentBatches.find(b=>b.id===initial.id)?.state!=='running')break}while(Date.now()<deadline)
   const batch=latest.contentBatches.find(b=>b.id===initial.id),found=latest.records.find(w=>w.workId===workId)
   writeFileSync(join(out,'app-discovery.json'),JSON.stringify({batch,found,priorVideoCount:library.records.length,afterVideoCount:latest.records.length},null,2))
   console.log(JSON.stringify({state:batch?.state,found:!!found,videoCount:latest.records.length}))
   if(!found)throw Error('Specified work was not discovered')
  }
  await show()
 }else if(action==='process'||action==='resume'){
  await show()
  await evaluate(`(()=>{const row=document.querySelector('[data-work-id="${workId}"]').closest('.video-selectable-row');const checkbox=row.querySelector('input');if(!checkbox.checked)checkbox.click()})()`)
  const before=await evaluate('window.signalDesk.getVideoLibrary()'),oldIds=before.contentBatches.map(b=>b.id),started=performance.now()
  const resumedId=action==='resume'?before.contentBatches.find(b=>b.provider==='cloud-omni'&&b.workIds.includes(workId)&&b.state!=='completed')?.id:null
  if(action==='resume')await evaluate(`[...document.querySelectorAll('.video-library-status button')].find(b=>b.textContent==='继续未完成部分').click()`)
  else await evaluate(`[...document.querySelectorAll('.video-content-controls button')].find(b=>b.textContent==='单模型转写与摘要').click()`)
  let latest,message='',batch;const deadline=Date.now()+20*60*1000
  do{
   await pause(1000);if(unexpectedDialog)throw Error('Unexpected confirmation')
   latest=await evaluate('window.signalDesk.getVideoLibrary()')
   batch=latest.contentBatches.find(b=>(resumedId?b.id===resumedId:!oldIds.includes(b.id))&&b.provider==='cloud-omni'&&b.workIds.includes(workId))
   if(batch&&batch.message!==message){message=batch.message;console.log(JSON.stringify({state:batch.state,stage:batch.currentStage,message}))}
   if(batch&&!['running','queued'].includes(batch.state))break
  }while(Date.now()<deadline)
  if(!batch)throw Error('APP did not start the task')
  await pause(1500)
  const result=await evaluate(`window.signalDesk.getVideoContentDetail(${JSON.stringify(latest.ownerSecUid)},'${workId}')`)
  const finalView=await evaluate('window.signalDesk.getVideoLibrary()');batch=finalView.contentBatches.find(b=>b.id===batch.id)
  const display=await evaluate(`document.querySelector('[data-testid="video-library-detail"]')?.innerText`)
  writeFileSync(join(out,'app-processing.json'),JSON.stringify({batch,result,operatorClickToReportMs:Math.round(performance.now()-started),summaryInVisibleDetail:!!result.summary&&display.includes(result.summary.overview),display},null,2))
  console.log(JSON.stringify({state:batch.state,summary:!!result.summary,displayedTotalMs:batch.displayedTotalMs,segments:result.stages.find(s=>s.stage==='transcript')?.result?.segments?.length}))
  if(batch.state!=='completed'||!result.summary)process.exitCode=1
 }else if(action==='screenshot'){
  await show();await pause(700)
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-result.png'),Buffer.from(shot.data,'base64'))
  await evaluate(`(()=>{const d=[...document.querySelectorAll('.video-content-expanded')].find(d=>d.querySelector('summary').textContent==='查看口播转写全文');if(d){d.open=true;d.scrollIntoView({block:'start'})}})()`);await pause(300)
  const transcript=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-transcript.png'),Buffer.from(transcript.data,'base64'))
  console.log('APP result screenshots saved')
 }else console.log(await evaluate(`window.signalDesk.getVideoLibrary().then(v=>({videoCount:v.records.length,latest:v.contentBatches[0],specifiedWork:v.records.find(w=>w.workId==='${workId}')}))`))
}finally{socket.close()}
