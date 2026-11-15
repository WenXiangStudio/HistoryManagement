// Controls only the explicit daily APP review port. Never sends a model request.
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const action=process.argv[2]||'inspect',out=resolve('local-data/siliconflow-third-slot-20261012')
if(!['prepare','inspect','close'].includes(action))throw Error('Invalid action')
mkdirSync(out,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(r=>r.json())
const page=pages.find(p=>p.type==='page'&&p.title==='Signal Desk'&&p.url.startsWith('file:')&&p.url.includes('release-following-background-final/win-unpacked/resources/app.asar/'))
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Explicit daily APP unavailable')
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
let serial=0;const pending=new Map(),errors=[]
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)})
function send(method,params={}){return new Promise((r,j)=>{const id=++serial,t=setTimeout(()=>{pending.delete(id);j(Error('APP timeout: '+method))},30000)
  pending.set(id,m=>{clearTimeout(t);m.error||m.result?.exceptionDetails?j(Error('APP operation failed: '+method)):r(m.result)});ws.send(JSON.stringify({id,method,params}))})}
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  await send('Runtime.enable')
  const busy=await evaluate(`Promise.all([window.signalDesk.getFollowingSyncStatus(),window.signalDesk.getVideoLibrary(),window.signalDesk.getDoubaoSpeech()]).then(([s,v,d])=>[s.phase,s.activity?.phase,s.basic?.phase,s.videoInformation?.phase].includes('running')||v.contentBatches.some(b=>['running','queued'].includes(b.state))||['running','preparing'].includes(d.trial.state))`)
  if(busy)throw Error('APP busy')
  if(action==='close'){await send('Page.close');console.log('Idle review APP closed')}
  else{
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`);await pause(500)
    const before=await evaluate('window.signalDesk.getSiliconFlow()'),activeBefore=await evaluate('window.signalDesk.getSettings().then(s=>s.activeCloudProfileId)')
    if(before.slots.length!==3)throw Error('Three slot UI missing')
    if(action==='prepare'){
      if(before.slots[2].profileId||before.slots[2].model)throw Error('Third slot already saved; avoid replacing it')
      await evaluate(`(()=>{const b=[...document.querySelectorAll('[data-testid="siliconflow-settings"] button')].find(b=>b.textContent==='保存硅基流动配置');if(!b||b.disabled)throw Error('Save disabled');b.click()})()`)
      let v;const deadline=Date.now()+8000
      do{await pause(150);v=await evaluate('window.signalDesk.getSiliconFlow()');if(v.slots[2].profileId)break}while(Date.now()<deadline)
    }
    const after=await evaluate('window.signalDesk.getSiliconFlow()'),activeAfter=await evaluate('window.signalDesk.getSettings().then(s=>s.activeCloudProfileId)')
    if(!after.slots[2].profileId||after.slots[2].model||after.slots[2].visionEnabled||!after.slots[2].hasSecret||activeBefore!==activeAfter||JSON.stringify(before.slots.slice(0,2))!==JSON.stringify(after.slots.slice(0,2)))throw Error('Configuration retention check failed')
    const ui=await evaluate(`(()=>{const c=document.querySelector('[data-testid="siliconflow-settings"]');return {models:[1,2,3].map(i=>c.querySelector('[aria-label="硅基流动模型'+i+'"]').value),secretBlank:c.querySelector('[aria-label="硅基流动API Key"]').value==='',thirdButtonDisabled:[...c.querySelectorAll('button')].find(b=>b.textContent==='使用模型 3')?.disabled,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    if(ui.models[2]||!ui.secretBlank||!ui.thirdButtonDisabled||ui.overflow)throw Error('Third slot layout mismatch')
    await evaluate(`document.querySelector('[data-testid="siliconflow-settings"]').scrollIntoView({block:'start'})`);await pause(150)
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'settings.png'),Buffer.from(shot.data,'base64'))
    await evaluate(`document.querySelector('[aria-label="硅基流动模型3"]').closest('.siliconflow-model').scrollIntoView({block:'center'})`);await pause(150)
    const third=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'third-slot.png'),Buffer.from(third.data,'base64'))
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:900,deviceScaleFactor:1,mobile:false});await pause(150)
    const narrow=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth})')
    const small=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'third-slot-1120.png'),Buffer.from(small.data,'base64'))
    await send('Emulation.clearDeviceMetricsOverride')
    if(narrow.overflow||errors.length)throw Error('Layout or renderer error')
    const report={action,before,after,activeBefore,activeAfter,ui,narrow,rendererErrors:errors.length,modelRequests:0}
    writeFileSync(join(out,'app-entry.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({slots:after.slots,activeUnchanged:activeBefore===activeAfter,ui,narrow,rendererErrors:errors.length,modelRequests:0}))
  }
}finally{ws.close()}
