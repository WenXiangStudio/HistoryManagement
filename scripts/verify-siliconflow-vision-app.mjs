// Operates only explicit daily APP review endpoint; image recognition is performed by APP product code.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const out=resolve('local-data/siliconflow-vision-20261012'),workId='7694535682575860393',action=process.argv[2]||'show'
if(!['activate','process','show','close'].includes(action))throw Error('Invalid review action')
mkdirSync(out,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(r=>r.json())
const page=pages.find(p=>p.type==='page'&&p.title==='Signal Desk'&&p.url.startsWith('file:')&&p.url.includes('release-following-background-final/win-unpacked/resources/app.asar/'))
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Explicit APP not available')
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
let serial=0,unexpectedDialog=false;const pending=new Map(),errors=[]
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)
  if(m.method==='Page.javascriptDialogOpening'){
    const expected=action==='process'&&m.params.type==='confirm'&&m.params.message.startsWith('使用硅基流动 Qwen/Qwen3.5-4B 读取这条视频最多12张抽样画面')
    if(!expected)unexpectedDialog=true
    void send('Page.handleJavaScriptDialog',{accept:expected})
  }})
function send(method,params={}){return new Promise((r,j)=>{const id=++serial,t=setTimeout(()=>{pending.delete(id);j(Error('APP timeout: '+method))},30000)
  pending.set(id,m=>{clearTimeout(t);m.error||m.result?.exceptionDetails?j(Error('APP operation failed: '+method)):r(m.result)});ws.send(JSON.stringify({id,method,params}))})}
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function show(){
  await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()`);await pause(350)
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${workId}');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(250)
  await evaluate(`document.querySelector('[data-work-id="${workId}"]').click()`);await pause(250)
}
try{
  await send('Runtime.enable');await send('Page.enable')
  const status=await evaluate(`window.signalDesk.getFollowingSyncStatus().then(s=>({phase:s.phase,basic:s.basic?.phase,activity:s.activity?.phase,video:s.videoInformation?.phase,online:s.connection?.online,readiness:s.readiness?.phase}))`)
  let library=await evaluate('window.signalDesk.getVideoLibrary()')
  if(Object.values(status).includes('running')||library.contentBatches.some(b=>b.state==='running'))throw Error('APP busy')
  if(action==='close'){await send('Page.close');console.log('Idle review APP closed')}
  else if(action==='activate'){
    const probes=JSON.parse(readFileSync(join(out,'connection-report.json'),'utf8'))
    if(probes.length!==2||!probes.every(r=>r.ok))throw Error('Both model probes must pass')
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`);await pause(500)
    const slots=await evaluate('window.signalDesk.getSiliconFlow()'),slot=slots.slots.find(s=>s.model==='Qwen/Qwen3.5-4B')
    if(!slot?.visionEnabled||!slot.hasSecret)throw Error('Saved cloud Qwen vision configuration unavailable')
    const initial=await evaluate('window.signalDesk.getSettings().then(s=>({id:s.activeCloudProfileId,model:s.textModel}))')
    if(initial.id!==slot.profileId){await evaluate(`[...document.querySelectorAll('[data-testid="siliconflow-settings"] button')].find(b=>b.textContent==='使用模型 ${slot.slot}').click()`);await pause(500)}
    const active=await evaluate('window.signalDesk.getSettings().then(s=>({id:s.activeCloudProfileId,textModel:s.textModel,visionModel:s.visionModel,visionBaseUrl:s.visionBaseUrl}))')
    if(active.id!==slot.profileId||active.visionModel!=='Qwen/Qwen3.5-4B'||active.visionBaseUrl!=='https://api.siliconflow.cn/v1')throw Error('Active cloud vision profile incorrect')
    writeFileSync(join(out,'active-profile.json'),JSON.stringify({before:initial,after:active},null,2));console.log(JSON.stringify({action,active}));await show()
  }else{
    await show()
    if(action==='process'){
      const marker=join(out,'visual-started.json');if(existsSync(marker))throw Error('Video request already started; do not resubmit')
      const beforeIds=library.contentBatches.map(b=>b.id)
      await evaluate(`(()=>{const selected=[...document.querySelectorAll('.video-selectable-row input')].filter(e=>e.checked);for(const e of selected)e.click()})()`);await pause(100)
      await evaluate(`document.querySelector('[data-work-id="${workId}"]').closest('.video-selectable-row').querySelector('input').click()`);await pause(100)
      writeFileSync(marker,JSON.stringify({at:new Date().toISOString(),workId,cloudModel:'Qwen/Qwen3.5-4B',entry:'APP only-cloud-frames button'}))
      await evaluate(`[...document.querySelectorAll('.video-content-controls button')].find(b=>b.textContent==='仅云端识别画面').click()`)
      let batch,last='',deadline=Date.now()+15*60*1000,lastStatus=Date.now()
      do{
        await pause(750);if(unexpectedDialog)throw Error('Unexpected APP confirmation')
        library=await evaluate('window.signalDesk.getVideoLibrary()');batch=library.contentBatches.find(b=>!beforeIds.includes(b.id)&&b.provider==='cloud-frames')
        if(batch&&(batch.message!==last||Date.now()-lastStatus>20000)){last=batch.message;lastStatus=Date.now();console.log(JSON.stringify({state:batch.state,message:last,elapsedSeconds:Math.round((Date.now()-Date.parse(batch.attemptStartedAt))/1000)}))}
        if(batch&&!['running','queued'].includes(batch.state))break
      }while(Date.now()<deadline)
      if(!batch)throw Error('No cloud frame batch created')
      const until=Date.now()+12000
      while(batch.state==='completed'&&batch.displayedTotalMs===undefined&&Date.now()<until){await pause(200);library=await evaluate('window.signalDesk.getVideoLibrary()');batch=library.contentBatches.find(b=>b.id===batch.id)}
      writeFileSync(join(out,'app-batch.json'),JSON.stringify(batch,null,2))
      if(batch.state!=='completed')throw Error('Cloud frame processing not completed; inspect saved result, do not resubmit')
    }
    library=await evaluate('window.signalDesk.getVideoLibrary()')
    const detail=await evaluate(`window.signalDesk.getVideoContentDetail(${JSON.stringify(library.ownerSecUid)},'${workId}')`)
    const visual=detail.stages.find(s=>s.stage==='visual')?.result
    if(visual?.mode!=='cloud-frames-only'||visual.modelVersion!=='Qwen/Qwen3.5-4B')throw Error('Expected cloud result not saved')
    await pause(700)
    const ui=await evaluate(`(()=>{const c=document.querySelector('[data-testid="cloud-frame-reading"]');return {cards:c?.querySelectorAll('.cloud-frame-card').length,images:[...c?.querySelectorAll('.cloud-frame-image img')||[]].filter(i=>i.complete&&i.naturalWidth>0).length,texts:[...c?.querySelectorAll('.cloud-frame-text')||[]].map(p=>p.textContent),source:c?.querySelector('.cloud-frame-heading')?.innerText,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    if(ui.cards!==visual.frames.length||ui.images!==visual.frames.length||ui.overflow||ui.texts.some((t,i)=>t!==(visual.readings[i].text||'本帧未识别到清晰文字')))throw Error('APP visual output does not match saved result')
    await evaluate(`document.querySelector('[data-testid="cloud-frame-reading"]').scrollIntoView({block:'start'})`);await pause(200)
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-result.png'),Buffer.from(shot.data,'base64'))
    await evaluate(`document.querySelector('[data-frame-id="sf-frame-2"]').scrollIntoView({block:'start'})`);await pause(150)
    const detailShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-frame-2.png'),Buffer.from(detailShot.data,'base64'))
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:900,deviceScaleFactor:1,mobile:false});await pause(250)
    const narrow=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,cardOverflow:[...document.querySelectorAll(".cloud-frame-card")].some(e=>e.scrollWidth>e.clientWidth)})')
    const narrowShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-frame-1120.png'),Buffer.from(narrowShot.data,'base64'))
    await send('Emulation.clearDeviceMetricsOverride')
    if(narrow.overflow||narrow.cardOverflow)throw Error('Narrow frame layout overflow')
    const batch=library.contentBatches.find(b=>b.provider==='cloud-frames'&&b.workIds.includes(workId))
    writeFileSync(join(out,'app-result.json'),JSON.stringify({batch,visual,ui,rendererErrors:errors.length},null,2))
    if(errors.length)throw Error('Renderer errors observed')
    console.log(JSON.stringify({action,model:visual.modelVersion,frames:visual.frames.length,readings:visual.readings.length,usage:visual.usage,timing:visual.timing,displayedTotalMs:batch?.displayedTotalMs,
      ui:{cards:ui.cards,images:ui.images,source:ui.source,overflow:ui.overflow},rendererErrors:errors.length}))
  }
}finally{ws.close()}
