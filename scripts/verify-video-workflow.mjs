// Isolated desktop QA with existing media; optional single real cloud route via --cloud.
import {spawn} from 'node:child_process'
import {backup,DatabaseSync} from 'node:sqlite'
import {copyFileSync,cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import assert from 'node:assert/strict'
const out=resolve('local-data/video-workflow-20261013'),production=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview'),qa=join(out,'qa-'+Date.now())
mkdirSync(qa,{recursive:true})
for(const name of ['signal-desk.sqlite','following-directory.sqlite']){
  const source=new DatabaseSync(join(production,name),{readOnly:true});await backup(source,join(qa,name));source.close()
}
copyFileSync(join(production,'following-settings.json'),join(qa,'following-settings.json'))
copyFileSync(join(production,'Local State'),join(qa,'Local State'))
cpSync(join(production,'credentials'),join(qa,'credentials'),{recursive:true})
mkdirSync(join(qa,'video-content'),{recursive:true});copyFileSync(join(production,'video-content/runtime.json'),join(qa,'video-content/runtime.json'))
const db=new DatabaseSync(join(qa,'following-directory.sqlite'))
const workId='7682043534987300106',owner=JSON.parse(readFileSync(join(qa,'following-settings.json'),'utf8')).activeOwnerSecUid
const old=JSON.parse(db.prepare("SELECT result_json FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage='media' AND state='completed' ORDER BY id DESC LIMIT 1").get(owner,workId).result_json)
const mediaDir=join(qa,'qa-media');mkdirSync(mediaDir)
copyFileSync(old.mediaPath,join(mediaDir,'source.mp4'));copyFileSync(join(old.directory,'proof.json'),join(mediaDir,'proof.json'))
db.prepare("UPDATE video_content_stages SET result_json=? WHERE owner_sec_uid=? AND work_id=? AND stage='media'").run(JSON.stringify({...old,directory:mediaDir,mediaPath:join(mediaDir,'source.mp4')}),owner,workId)
// Force only this copied sample through the new classifier; production classifications are preserved.
db.prepare("DELETE FROM video_content_stages WHERE owner_sec_uid=? AND work_id=? AND stage='classification'").run(owner,workId)
db.close()
const port=await new Promise(resolvePort=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolvePort(p))})})
const executable=resolve('release-video-workflow-026/win-unpacked/Signal Desk.exe')
const child=spawn(executable,[`--user-data-dir=${qa}`,`--remote-debugging-port=${port}`,'--disable-gpu'],{windowsHide:true,stdio:'ignore',env:{...process.env,SIGNAL_DESK_SMOKE_TEST:'1'}})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<100;i++){try{page=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}await pause(100)}
if(!page)throw Error('QA app did not start')
const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let requestId=0
await new Promise(resolveOpen=>socket.addEventListener('open',resolveOpen,{once:true}))
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id)pending.get(message.id)?.(message)
  if(message.method==='Runtime.exceptionThrown'||message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params)})
const send=(method,params={})=>new Promise((resolveCall,reject)=>{const id=++requestId,timer=setTimeout(()=>reject(Error('QA request timeout')),300000)
  pending.set(id,message=>{clearTimeout(timer);pending.delete(id);message.error||message.result?.exceptionDetails?reject(Error(JSON.stringify(message.error??message.result.exceptionDetails))):resolveCall(message.result)})
  socket.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(out,name),Buffer.from(r.data,'base64'))}
const report={qa,workId,cloudRequested:process.argv.includes('--cloud'),screenshots:[],errors}
try{
  await send('Runtime.enable');await send('Page.enable');await pause(1000)
  await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()")
  await pause(700)
  assert.ok(await evaluate("!!document.querySelector('[data-work-id]')"))
  const batch=await evaluate(`window.signalDesk.classifyVideoWorks({ownerSecUid:${JSON.stringify(owner)},workIds:['${workId}'],clickedAt:Date.now()})`)
  let saved
  for(let i=0;i<180;i++){
    const library=await evaluate('window.signalDesk.getVideoLibrary()'),current=library.contentBatches.find(b=>b.id===batch.id)
    if(!['running','queued'].includes(current.state)){saved=library.records.find(w=>w.workId===workId);report.classificationBatch=current;break}
    await pause(500)
  }
  assert.equal(report.classificationBatch?.state,'completed',JSON.stringify(report.classificationBatch))
  assert.equal(saved.content.classification.code,'speech');assert.equal(saved.content.classification.frames.length,8)
  assert.equal(saved.content.classification.asrInvoked,false);assert.equal(saved.content.classification.cloudInvoked,false)
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${workId}');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await pause(250)
  await evaluate(`document.querySelector('[data-work-id="${workId}"]').click()`);await pause(1000)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  await shot('video-information-wide.png');report.screenshots.push('video-information-wide.png')
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(400)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  assert.ok(await evaluate("document.querySelector('.video-library-reading').clientHeight>150"))
  await shot('video-information-1120.png');report.screenshots.push('video-information-1120.png')
  await send('Emulation.clearDeviceMetricsOverride')
  if(report.cloudRequested){
    await evaluate(`window.signalDesk.setVideoInterest(${JSON.stringify(owner)},'${workId}','interested')`)
    for(let i=0;i<400;i++){
      const library=await evaluate('window.signalDesk.getVideoLibrary()'),work=library.records.find(w=>w.workId===workId)
      if(work.content?.research){saved=work;report.processingBatch=library.contentBatches.find(b=>b.provider==='workflow'&&b.workIds.includes(workId));break}
      if(work.content?.stages.body?.state==='failed'||work.content?.stages.research?.state==='failed')throw Error(JSON.stringify(work.content.stages))
      await pause(500)
    }
    assert.equal(saved.content.body?.source,'doubao-flash');assert.equal(saved.content.research?.modelVersion,'zai-org/GLM-5.3-Flash')
    writeFileSync(join(out,'qa-body-and-research.json'),JSON.stringify({body:saved.content.body,research:saved.content.research},null,2))
    await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent?.startsWith('今日收件箱')).click()");await pause(600)
    assert.ok(await evaluate("document.querySelector('.material-inbox-card')?.textContent.includes('PS+AI精准控图')"))
    await evaluate("document.querySelector('.material-inbox-card .detail-button').click()");await pause(600)
    assert.equal(await evaluate("document.querySelector('[data-testid=material-body]').textContent"),saved.content.body.text)
    assert.equal(await evaluate("document.querySelector('[data-testid=material-body] time')!==null"),false)
    await shot('inbox-detail-wide.png');report.screenshots.push('inbox-detail-wide.png')
    await evaluate("document.querySelector('.material-drawer .drawer-scroll').scrollTop=500");await pause(200);await shot('inbox-research-wide.png');report.screenshots.push('inbox-research-wide.png')
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await pause(300)
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
    await shot('inbox-detail-1120.png');report.screenshots.push('inbox-detail-1120.png')
    const library=await evaluate('window.signalDesk.getVideoLibrary()');report.processingBatch=library.contentBatches.find(b=>b.provider==='workflow'&&b.workIds.includes(workId))
  }
  assert.equal(errors.length,0,JSON.stringify(errors))
  report.finishedAt=new Date().toISOString();writeFileSync(join(out,'desktop-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{
  await evaluate('window.close()').catch(()=>{});socket.close();await pause(1000);if(child.exitCode===null)child.kill()
}
