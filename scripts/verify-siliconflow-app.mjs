// Only operates the explicit daily APP review port. No model requests or secret entry.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const out=resolve('local-data/siliconflow-integration-20261012'),action=process.argv[2]||'inspect'
if(!['prepare','inspect','close'].includes(action))throw Error('Unknown action')
mkdirSync(out,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(r=>r.json())
const page=pages.find(p=>p.type==='page'&&p.title==='Signal Desk'&&p.url.startsWith('file:')&&p.url.includes('release-following-background-final/win-unpacked/resources/app.asar/'))
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Explicit daily APP unavailable')
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
let sequence=0;const pending=new Map(),errors=[]
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)})
function send(method,params={}){return new Promise((r,j)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);j(Error('APP timeout: '+method))},30000)
  pending.set(id,m=>{clearTimeout(t);m.error||m.result?.exceptionDetails?j(Error('APP command failed: '+method)):r(m.result)});ws.send(JSON.stringify({id,method,params}))})}
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  await send('Runtime.enable')
  const state=await evaluate('window.signalDesk.getFollowingSyncStatus().then(s=>({phase:s.phase,basic:s.basic?.phase,activity:s.activity?.phase,video:s.videoInformation?.phase,online:s.connection?.online,readiness:s.readiness?.phase}))')
  const busy=await evaluate(`Promise.all([window.signalDesk.getVideoLibrary(),window.signalDesk.getDoubaoSpeech()]).then(([v,d])=>v.contentBatches.some(b=>b.state==='running')||['running','preparing'].includes(d.trial.state))`)
  if(Object.values(state).includes('running')||busy)throw Error('APP busy')
  if(action==='close'){await send('Page.close');console.log('Idle daily review APP closed')}
  else{
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click()`);await pause(600)
    const initial=await evaluate('window.signalDesk.getSiliconFlow()')
    const before=await evaluate('window.signalDesk.getSettings().then(s=>({active:s.activeCloudProfileId,profiles:s.cloudProfiles,model:s.textModel}))')
    if(action==='prepare'){
      if(initial.slots.some(s=>s.model||s.hasSecret||s.profileId))throw Error('SiliconFlow slots already configured; do not overwrite')
      await evaluate(`(()=>{const b=[...document.querySelectorAll('[data-testid="siliconflow-settings"] button')].find(b=>b.textContent==='保存硅基流动配置');if(!b||b.disabled)throw Error('Save button unavailable');b.click()})()`)
      let latest;const deadline=Date.now()+10000
      do{await pause(200);latest=await evaluate('window.signalDesk.getSiliconFlow()');if(latest.slots.every(s=>s.profileId))break}while(Date.now()<deadline)
      if(!latest.slots.every(s=>s.profileId))throw Error('Placeholder save not completed')
    }
    const saved=await evaluate('window.signalDesk.getSiliconFlow()')
    const after=await evaluate('window.signalDesk.getSettings().then(s=>({active:s.activeCloudProfileId,profiles:s.cloudProfiles,model:s.textModel}))')
    const ui=await evaluate(`(()=>{const c=document.querySelector('[data-testid="siliconflow-settings"]');return {title:c?.querySelector('h3')?.textContent,endpoint:c?.querySelector('[aria-label="硅基流动服务地址"]')?.value,
      models:[1,2].map(i=>c?.querySelector('[aria-label="硅基流动模型'+i+'"]')?.value),secretBlank:c?.querySelector('[aria-label="硅基流动API Key"]')?.value==='',
      useButtonsDisabled:[...c.querySelectorAll('button')].filter(b=>b.textContent.startsWith('使用模型')).every(b=>b.disabled),overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    if(ui.endpoint!=='https://api.siliconflow.cn/v1'||ui.models.some(Boolean)||!ui.secretBlank||!ui.useButtonsDisabled||ui.overflow)throw Error('Placeholder UI mismatch')
    if(saved.slots.some(s=>!s.profileId||s.model||s.hasSecret)||before.active!==after.active||before.model!==after.model
      ||before.profiles.some(p=>!after.profiles.some(n=>n.id===p.id&&n.name===p.name)))throw Error('Profile retention failure')
    await evaluate(`document.querySelector('[data-testid="siliconflow-settings"]').scrollIntoView({block:'start'})`);await pause(200)
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'settings.png'),Buffer.from(shot.data,'base64'))
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:900,deviceScaleFactor:1,mobile:false});await pause(250)
    await evaluate(`document.querySelector('[data-testid="siliconflow-settings"]').scrollIntoView({block:'start'})`)
    const narrow=await evaluate('({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})')
    const small=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'settings-1120.png'),Buffer.from(small.data,'base64'))
    await send('Emulation.clearDeviceMetricsOverride')
    if(narrow.overflow||errors.length)throw Error('Layout or renderer error')
    const report={action,state,before,after,saved,ui,narrow,rendererErrors:errors.length,modelRequests:0}
    writeFileSync(join(out,'app-entry.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  }
}finally{ws.close()}
