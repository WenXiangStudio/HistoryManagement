// Operates only the explicitly launched daily review APP on port 9227, never Chrome.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
const evidenceName=process.argv[3]||'doubao-flash-integration-20261012'
if(!/^doubao-flash-[a-z0-9-]{1,90}$/.test(evidenceName))throw Error('Invalid local evidence directory')
const out=resolve('local-data',evidenceName),action=process.argv[2]||'status'
if(!['status','start','start-corrected-key','close'].includes(action))throw Error('Unknown APP verification action')
mkdirSync(out,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(r=>r.json())
const page=pages.find(p=>p.type==='page'&&p.title==='Signal Desk'&&p.url.startsWith('file:')&&p.url.includes('release-following-background-final/win-unpacked/resources/app.asar/'))
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Explicit daily review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})})
let sequence=0;const pending=new Map(),errors=[]
socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)})
function send(method,params={}){return new Promise((r,j)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);j(Error('APP timeout: '+method))},30000)
  pending.set(id,m=>{clearTimeout(t);m.error||m.result?.exceptionDetails?j(Error('APP operation failed: '+method)):r(m.result)})
  socket.send(JSON.stringify({id,method,params}))})}
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  await send('Runtime.enable')
  const status=await evaluate(`window.signalDesk.getFollowingSyncStatus().then(s=>({phase:s.phase,basic:s.basic?.phase,activity:s.activity?.phase,video:s.videoInformation?.phase,online:s.connection?.online,readiness:s.readiness?.phase}))`)
  if(Object.values(status).includes('running'))throw Error('APP collection is busy')
  const library=await evaluate('window.signalDesk.getVideoLibrary().then(v=>({count:v.records.length,running:v.contentBatches.some(b=>b.state===\'running\')}))')
  if(library.running)throw Error('APP content is busy')
  if(action==='close'){
    const view=await evaluate('window.signalDesk.getDoubaoSpeech()')
    if(['preparing','running'].includes(view.trial.state))throw Error('Speech is busy')
    await send('Page.close');console.log('Idle review APP closed');
  }else{
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`);await pause(500)
    const initial=await evaluate('window.signalDesk.getDoubaoSpeech()')
    const ui=await evaluate(`(()=>{const c=document.querySelector('[data-testid="doubao-speech-settings"]');return {title:c?.querySelector('h3')?.textContent,resource:c?.querySelector('[aria-label="豆包资源ID"]')?.value,url:!!c?.querySelector('[aria-label="豆包测试音频链接"]'),overflow:document.documentElement.scrollWidth>innerWidth,keyInputBlank:c?.querySelector('[aria-label="豆包语音凭据"]')?.value===''}})()`)
    if(ui.resource!=='volc.bigasr.auc_turbo'||!ui.title.includes('极速版')||ui.url||ui.overflow||!ui.keyInputBlank)throw Error('Flash UI validation failed')
    console.log(JSON.stringify({action,status,videos:library.count,hasSecret:initial.settings.hasSecret,audioReady:initial.audioReady,state:initial.trial.state,ui}))
    if(action==='start'||action==='start-corrected-key'){
      if(!initial.settings.hasSecret||!initial.audioReady||existsSync(join(out,'real-request-started.json')))throw Error('Not a fresh authorized single trial; will not resubmit')
      if(action==='start-corrected-key'){
        // This is the user's explicitly requested retry after correcting the key, not automatic retry.
        if(evidenceName==='doubao-flash-integration-20261012'||initial.trial.state!=='failed'||initial.trial.httpStatus!==401
          ||initial.trial.statusCode!=='45000010'||initial.trial.requestId!=='b786f2d7-c0b5-4dac-87e5-de3e57200c1b')throw Error('Unexpected prior request; stop for review')
        const db=new DatabaseSync(join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','signal-desk.sqlite'),{readOnly:true})
        try{
          const get=key=>JSON.parse(db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key).value_json)
          const config=get('doubao-speech'),prior=get('doubao-speech-flash-trial')
          if(config.authMode!=='api-key'||!config.secretRef||config.secretRef===prior.secretRef)throw Error('Corrected key has not been saved; do not send')
          writeFileSync(join(out,'credential-check.json'),JSON.stringify({at:new Date().toISOString(),savedReferenceChanged:true,authMode:config.authMode,
            priorRequestId:prior.requestId,secretPrinted:false},null,2))
        }finally{db.close()}
      }else if(initial.trial.state!=='idle')throw Error('Initial trial is not idle')
      writeFileSync(join(out,'real-request-started.json'),JSON.stringify({at:new Date().toISOString(),workId:'7694535682575860393',entry:'APP settings button',
        priorRequestId:initial.trial.requestId??null,reason:action==='start-corrected-key'?'User corrected the previously entered old-version key':'Initial trial'},null,2))
      const clicked=await evaluate(`(()=>{const b=[...document.querySelectorAll('.doubao-test button')].find(b=>b.textContent==='仅转写这条视频');if(!b||b.disabled)throw Error('Flash start disabled');const at=Date.now();b.click();return at})()`)
      let latest,message='',deadline=Date.now()+330000
      do{
        await pause(200);latest=await evaluate('window.signalDesk.getDoubaoSpeech()')
        if(latest.trial.message!==message){message=latest.trial.message;console.log(JSON.stringify({state:latest.trial.state,message}))}
        if(latest.trial.requestId!==initial.trial.requestId&&!['idle','preparing','running'].includes(latest.trial.state))break
      }while(Date.now()<deadline)
      if(latest.trial.state==='completed'){
        const until=Date.now()+10000
        while(latest.trial.displayedTotalMs===undefined&&Date.now()<until){await pause(100);latest=await evaluate('window.signalDesk.getDoubaoSpeech()')}
      }
      const visible=await evaluate(`(()=>{const e=document.querySelector('[aria-label="豆包转写原文"]'),r=e?.getBoundingClientRect();return {text:e?.value??null,readOnly:e?.readOnly,withinViewport:!!r&&r.top<innerHeight&&r.bottom>0,message:document.querySelector('.doubao-test [role="status"]')?.innerText,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
      writeFileSync(join(out,'app-trial.json'),JSON.stringify({clicked,observedAt:Date.now(),trial:latest.trial,visible,errors},null,2))
      if(latest.trial.text)writeFileSync(join(out,'transcript-original.txt'),latest.trial.text,'utf8')
      const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-result.png'),Buffer.from(shot.data,'base64'))
      if(latest.trial.state==='completed'&&(visible.text!==latest.trial.text||!visible.readOnly||!visible.withinViewport||latest.trial.displayedTotalMs===undefined))throw Error('Result display not verified')
      if(errors.length)throw Error('Renderer errors recorded')
      console.log(JSON.stringify({trial:latest.trial,visibleOriginal:visible.text===latest.trial.text,withinViewport:visible.withinViewport,rendererErrors:errors.length}))
    }else{
      await evaluate(`document.querySelector('[data-testid="doubao-speech-settings"]').scrollIntoView({block:'start'})`)
      const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'app-settings.png'),Buffer.from(shot.data,'base64'))
      writeFileSync(join(out,'app-entry.json'),JSON.stringify({status,library,initial,ui},null,2))
    }
  }
}finally{socket.close()}
