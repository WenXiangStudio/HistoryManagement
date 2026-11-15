// Packaged APP verification with synthetic settings and a loopback provider.
// The owned Electron main process redirects cloud requests to the fixture through its inspector.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer as httpServer} from 'node:http'
import {createServer} from 'node:net'
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'

if(!process.argv[2])throw Error('Pass the candidate Signal Desk.exe path')
const executable=resolve(process.argv[2])
assert.ok(existsSync(executable))
const outputRoot=resolve('local-data/cloud-connection-tests-20261016/ui')
mkdirSync(outputRoot,{recursive:true})
const output=mkdtempSync(join(outputRoot,'run-')),userData=join(output,'synthetic-user-data')
mkdirSync(userData)
const pause=ms=>new Promise(r=>setTimeout(r,ms)),requests=[],errors=[]
const report={executable,userData,syntheticOnly:true,realProviderRequests:0,checks:{},screenshots:[]}
let child,renderer,main
const fixture=httpServer(async(req,res)=>{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw Error('Unexpected large fixture request')}
  const body=JSON.parse(raw||'{}'),speech=req.url.includes('/recognize/flash')
  const image=JSON.stringify(body).includes('data:image/png;base64,')
  requests.push({path:req.url,model:body.model??body.request?.model_name,speech,image,authorized:!!(req.headers.authorization||req.headers['x-api-key']),audioBytes:speech?Buffer.from(body.audio.data,'base64').length:0})
  await pause(220)
  if(speech){res.writeHead(200,{'content-type':'application/json','x-api-status-code':'20000003','x-api-message':'Silent audio','x-tt-logid':'qa-speech'});res.end(JSON.stringify({audio_info:{duration:1000},result:{text:''}}));return}
  if(body.model==='qa/invalid-key'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic rejected API Key'}}));return}
  res.writeHead(200,{'content-type':'application/json','x-request-id':'qa-request'})
  res.end(JSON.stringify(req.url.endsWith('/responses')?{id:'qa-response',status:'completed',model:body.model,output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'OK'}]}]}:{model:body.model,choices:[{message:{role:'assistant',content:image?'白色':'OK'},finish_reason:'stop'}]}))
})
await new Promise(r=>fixture.listen(0,'127.0.0.1',r))
const fixtureOrigin=`http://127.0.0.1:${fixture.address().port}`
async function port(){return new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})})}
async function connect(debugPort,pageType){
  for(let i=0;i<150;i++){
    try{
      const pages=await fetch(`http://127.0.0.1:${debugPort}/json`,{signal:AbortSignal.timeout(600)}).then(r=>r.json())
      const page=pages.find(p=>p.type===pageType)
      if(page){
        const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let id=0
        ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)})
        await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
        return {ws,send:(method,params={})=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);j(Error('Inspector timeout '+method))},20000);pending.set(n,m=>{clearTimeout(t);m.error||m.result?.exceptionDetails?j(Error(JSON.stringify(m.error??m.result.exceptionDetails))):r(m.result)});ws.send(JSON.stringify({id:n,method,params}))})}
      }
    }catch{}
    if(child.exitCode!==null)throw Error('Candidate exited before inspector was ready')
    await pause(80)
  }
  throw Error('Inspector unavailable '+pageType)
}
async function evaluate(expression,channel=renderer){return (await channel.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value}
async function waitFor(expression,label){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(50)}throw Error('UI timeout '+label)}
async function click(selector){
  const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Button missing or disabled');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await renderer.send('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})})
}
async function probe(label,success=true){
  const selector=`[aria-label="${label}"]`,before=requests.length
  await click(selector)
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent==='测试中…'`,'loading '+label)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`),true)
  // Repeated synthetic click while loading must not issue a second request.
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.closest('.cloud-connection-test').querySelector('.cloud-connection-result')?.classList.contains('${success?'success':'failure'}')`,'result '+label)
  assert.equal(requests.length,before+1,'Connectivity test retried or duplicated a request')
  const text=await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('.cloud-connection-test').textContent`)
  assert.match(text,success?/连接成功/:/连接失败/)
  return text
}
async function screenshot(name,selector,width=1480){
  await renderer.send('Emulation.setDeviceMetricsOverride',{width,height:920,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);await pause(120)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  const shot=await renderer.send('Page.captureScreenshot',{format:'png'}),path=join(output,name)
  writeFileSync(path,Buffer.from(shot.data,'base64'));report.screenshots.push(path)
}
try{
  const renderPort=await port(),mainPort=await port()
  child=spawn(executable,[`--user-data-dir=${userData}`,`--remote-debugging-port=${renderPort}`,`--inspect=${mainPort}`,'--disable-gpu'],{env:{...process.env,SIGNAL_DESK_SMOKE_TEST:'1'},stdio:'ignore',windowsHide:true})
  main=await connect(mainPort,'node')
  await evaluate(`(()=>{const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(String(input));if(['api.siliconflow.cn','openspeech.bytedance.com'].includes(u.hostname))return original(${JSON.stringify(fixtureOrigin)}+'/proxy'+u.pathname,init);if(u.hostname==='127.0.0.1')return original(input,init);throw Error('External request forbidden in isolated verification')}})()`,main)
  renderer=await connect(renderPort,'page');await renderer.send('Runtime.enable')
  await waitFor('!!window.signalDesk&&!!document.querySelector("nav")','APP readiness')
  await evaluate(`(async()=>{
    const s=await window.signalDesk.getSettings();await window.signalDesk.saveSettings({expectedCloudProfileId:s.activeCloudProfileId,textBaseUrl:${JSON.stringify(fixtureOrigin+'/v1')},textApiProtocol:'responses',textModel:'qa/generic-text',textApiKey:'synthetic-generic-key',visionBaseUrl:${JSON.stringify(fixtureOrigin+'/v1')},visionModel:'qa/generic-vision',visionApiKey:'synthetic-vision-key'});
    const v=await window.signalDesk.getSiliconFlow();await window.signalDesk.saveSiliconFlow({expectedRevision:v.revision,secret:'synthetic-sf-key',models:[{slot:1,model:'qa/silicon-text',visionEnabled:false},{slot:2,model:'qa/silicon-vision',visionEnabled:true},{slot:3,model:'qa/invalid-key',visionEnabled:false}]});
    await window.signalDesk.saveDoubaoSpeech({authMode:'api-key',appId:'',secret:'synthetic-speech-key'});
    [...document.querySelectorAll('nav button')].find(b=>b.textContent==='设置').click();
  })()`)
  await waitFor('!!document.querySelector("[aria-label=测试文本服务连通性]")&&!document.querySelector("[aria-label=测试文本服务连通性]").disabled','saved settings')
  const before=await evaluate('Promise.all([window.signalDesk.getSettings(),window.signalDesk.getSiliconFlow(),window.signalDesk.getDoubaoSpeech()])')
  assert.equal(requests.length,0,'Saving configurations must not automatically test')
  report.results={}
  for(const [key,label,success]of [['siliconText','测试硅基流动模型1连通性',true],['siliconVision','测试硅基流动模型2连通性',true],['siliconError','测试硅基流动模型3连通性',false]])report.results[key]=await probe(label,success)
  assert.ok(requests.find(r=>r.model==='qa/silicon-text'&&!r.image))
  assert.ok(requests.find(r=>r.model==='qa/silicon-vision'&&r.image))
  report.checks.individualSiliconFlowTargets=true
  report.checks.realAuthenticationFailureShown=report.results.siliconError.includes('401')
  await screenshot('siliconflow-tests-wide.png','[data-testid="siliconflow-settings"]')
  await screenshot('siliconflow-tests-1120.png','[data-testid="siliconflow-settings"]',1120)
  await renderer.send('Emulation.clearDeviceMetricsOverride')
  report.results.genericText=await probe('测试文本服务连通性')
  report.results.genericVision=await probe('测试视觉服务连通性')
  assert.ok(requests.find(r=>r.model==='qa/generic-text'&&r.path.endsWith('/responses')))
  assert.ok(requests.find(r=>r.model==='qa/generic-vision'&&r.image&&r.path.endsWith('/chat/completions')))
  report.checks.genericSelectedProtocolsAndImages=true
  await screenshot('generic-tests-wide.png','[data-testid="cloud-profile-controls"]')
  report.results.speech=await probe('测试豆包语音连通性')
  assert.ok(requests.find(r=>r.speech&&r.audioBytes>32000))
  assert.match(report.results.speech,/静音/)
  report.checks.speechSyntheticSilenceWithBusinessCode=true
  await screenshot('speech-test-wide.png','[data-testid="doubao-speech-settings"]')
  const after=await evaluate('Promise.all([window.signalDesk.getSettings(),window.signalDesk.getSiliconFlow(),window.signalDesk.getDoubaoSpeech()])')
  assert.deepEqual(after,before,'Connectivity tests changed settings or speech trial')
  report.checks.noConfigurationActivationOrTrialWrites=true
  const requestCount=requests.length
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="硅基流动模型1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'qa/unsaved');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor('document.querySelector("[aria-label=测试硅基流动模型1连通性]").disabled','draft test disabled')
  assert.equal(await evaluate('document.querySelector("[aria-label=测试硅基流动模型1连通性]").closest(".cloud-connection-test").querySelector(".success")'),null)
  assert.equal(requests.length,requestCount)
  report.checks.unsavedConfigurationInvalidatesResult=true
  assert.equal(errors.length,0)
  report.checks.rendererNoErrors=true
  report.requests=requests;report.success=true
}catch(error){report.success=false;report.failure=String(error.stack??error);throw error}
finally{
  if(renderer){await evaluate('window.close()').catch(()=>{});renderer.ws.close()}
  main?.ws.close()
  if(child){for(let i=0;i<40&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill()}
  fixture.close()
  report.finishedAt=new Date().toISOString();writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,report:join(output,'report.json'),checks:report.checks},null,2))
}
