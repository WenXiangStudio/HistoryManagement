// Owned packaged APP, isolated user data, unique synthetic E-drive media, loopback-only cloud fixtures.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {createServer as httpServer} from 'node:http'
import {createServer} from 'node:net'
import {appendFileSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'

const executable=resolve(process.argv[2]||'release-workshop-deep-052/win-unpacked/Signal Desk.exe')
assert.ok(existsSync(executable),'Pass the packaged candidate Signal Desk.exe path')
const model='Qwen/Qwen3.5-122B-A10B',resourceId='volc.bigasr.auc_turbo'
const outputRoot=resolve('local-data/workshop-deep-20261016/ui');mkdirSync(outputRoot,{recursive:true})
const output=mkdtempSync(join(outputRoot,'run-')),userData=join(output,'synthetic-user-data')
const jobId=randomUUID(),mediaDirectory=join('E:\\VideoDownload','video-workshop',jobId),mediaPath=join(mediaDirectory,'source.mp4')
const syntheticSource=resolve('E:\\VideoDownload\\workshop-process-qa-20261016\\runtime-run-4srqyq\\synthetic-4s.mp4')
const runtimePath=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','video-content','runtime.json')
assert.ok(existsSync(syntheticSource),'Known synthetic four-second source missing')
assert.ok(existsSync(runtimePath),'Installed local runtime configuration missing')
mkdirSync(mediaDirectory,{recursive:true});copyFileSync(syntheticSource,mediaPath)
// A unique harmless MP4 trailer prevents the global source-hash audio cache from crossing QA runs.
appendFileSync(mediaPath,Buffer.from('\nworkshop-isolated-qa-'+randomUUID()+'\n'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceSha256=hash(readFileSync(mediaPath))
const classification={code:'speech',ruleVersion:'existence-detection-triage-v1',sourceSha256,strength:'合成本地分类结果，仅用于独立界面验证',
  basis:{speechPercent:50,speechBinCoverage:0.5,retainedTextFrames:0,sampledFrames:8},frames:[],timing:{totalMs:10},asrInvoked:false,textRecognitionInvoked:false,cloudInvoked:false}
const seededJob={id:jobId,url:'https://www.douyin.com/video/7000000000000000001',workId:'7000000000000000001',title:'合成四秒视频 · 深度处理验证',authorName:'独立合成样本',phase:'completed',message:'下载与本地分类已完成（独立合成样本）',
  createdAt:new Date().toISOString(),clickedAt:Date.now()-1000,finishedAt:new Date().toISOString(),elapsedMs:1000,stageElapsedMs:{download:500,classify:500},
  mediaPath,byteLength:statSync(mediaPath).size,sha256:sourceSha256,durationMs:4000,classification}
mkdirSync(join(userData,'video-workshop'),{recursive:true});writeFileSync(join(userData,'video-workshop','jobs.json'),JSON.stringify([seededJob],null,2))
mkdirSync(join(userData,'video-content'),{recursive:true});copyFileSync(runtimePath,join(userData,'video-content','runtime.json'))
const runtimeHashBefore=hash(readFileSync(runtimePath))
const pause=ms=>new Promise(r=>setTimeout(r,ms)),requests=[],errors=[],fixtureErrors=[],phaseHistory=[]
const report={executable,userData,mediaPath,sourceSha256,syntheticOnly:true,realProviderRequests:0,checks:{},screenshots:[]}
let child,renderer,main,requestSequence=0
const fixture=httpServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>30*1024*1024)throw Error('Fixture body too large')}
    const body=JSON.parse(raw||'{}'),sequence=++requestSequence,speech=req.url==='/proxy/api/v3/auc/bigmodel/recognize/flash'
    if(speech){
      assert.equal(req.headers['x-api-resource-id'],resourceId);assert.equal(body.request.show_utterances,true)
      assert.ok(Buffer.from(body.audio.data,'base64').length>1000)
      requests.push({sequence,stage:'speech',path:req.url,resourceId:req.headers['x-api-resource-id'],requestId:req.headers['x-api-request-id'],audioBytes:Buffer.from(body.audio.data,'base64').length,authorized:!!req.headers['x-api-key']})
      await pause(350)
      res.writeHead(200,{'content-type':'application/json','x-api-status-code':'20000000','x-tt-logid':'qa-workshop-speech'})
      res.end(JSON.stringify({audio_info:{duration:4000},result:{text:'合成语音测试',utterances:[{start_time:500,end_time:1500,text:'合成语音测试'}]}}));return
    }
    assert.equal(req.url,'/proxy/v1/chat/completions');assert.equal(body.model,model);assert.equal(body.stream,false)
    const content=body.messages?.[0]?.content;let result,stage,detail={}
    if(Array.isArray(content)){
      stage='vision';const frameIds=content.filter(part=>part.type==='text'&&part.text.startsWith('frameId=')).map(part=>part.text.slice('frameId='.length)),images=content.filter(part=>part.type==='image_url')
      assert.ok(frameIds.length);assert.equal(images.length,frameIds.length)
      for(const image of images){assert.match(image.image_url.url,/^data:image\/jpeg;base64,/);assert.equal(Buffer.from(image.image_url.url.split(',')[1],'base64').subarray(0,3).toString('hex'),'ffd8ff')}
      detail={frameIds,imageCount:images.length,imagePayloadsValid:true}
      result={frames:frameIds.map(frameId=>({frameId,text:'合成画面文字',description:'合成四秒视频中的测试画面',uncertainties:[]}))}
    }else{
      assert.equal(typeof content,'string')
      const marker='输入材料：',position=content.lastIndexOf(marker);assert.ok(position>=0,'Unexpected report request shape')
      const material=JSON.parse(content.slice(position+marker.length));assert.equal(material.source,sourceSha256);assert.equal(material.durationMs,4000)
      stage='report';detail={windows:material.windows}
      result={overview:'合成视频展示测试画面，并有一段合成语音。本报告用于验证图文时间对应。',sections:material.windows.map(window=>({id:window.id,title:'合成图文时间对齐',summary:'本段包含合成语音与对应画面。',analysis:'语音“合成语音测试”发生在 0.500 至 1.500 秒，所列画面保留自己的原始视频时间。'})),limitations:[]}
    }
    requests.push({sequence,stage,path:req.url,model:body.model,authorized:!!req.headers.authorization,...detail})
    await pause(350)
    res.writeHead(200,{'content-type':'application/json','x-request-id':'qa-workshop-'+sequence})
    res.end(JSON.stringify({id:'qa-workshop-'+stage+'-'+sequence,model:body.model,choices:[{message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}}))
  }catch(error){fixtureErrors.push(String(error.stack??error));res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Synthetic fixture failed'}))}
})
await new Promise(r=>fixture.listen(0,'127.0.0.1',r))
const fixtureOrigin=`http://127.0.0.1:${fixture.address().port}`
async function unusedPort(){return new Promise((r,j)=>{const server=createServer();server.once('error',j);server.listen(0,'127.0.0.1',()=>{const selected=server.address().port;server.close(()=>r(selected))})})}
async function connect(port,type){
  for(let attempt=0;attempt<150;attempt++){
    if(child.exitCode!==null)throw Error('Owned candidate exited before inspector readiness')
    try{
      const targets=await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(600)}).then(r=>r.json()),target=targets.find(t=>t.type===type)
      if(target){
        const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0
        ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id)}if(message.method==='Runtime.exceptionThrown'||message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params)})
        await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})})
        return {ws,send:(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);j(Error('Inspector timeout '+method))},20000);pending.set(n,m=>{clearTimeout(timer);m.error||m.result?.exceptionDetails?j(Error(JSON.stringify(m.error??m.result.exceptionDetails))):r(m.result)});ws.send(JSON.stringify({id:n,method,params}))})}
      }
    }catch{}
    await pause(80)
  }
  throw Error('Inspector unavailable '+type)
}
async function evaluate(expression,channel=renderer){return (await channel.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value}
async function waitFor(expression,label,timeout=30000){
  const deadline=Date.now()+timeout
  while(Date.now()<deadline){if(await evaluate(expression))return;await pause(60)}
  throw Error('UI timeout '+label)
}
async function click(selector){
  const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Button missing or disabled');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await renderer.send('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})})
}
async function navigate(completed=false){
  await waitFor('!!window.signalDesk&&!!document.querySelector("nav")','APP readiness')
  await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='视频工坊').click()`)
  await waitFor(completed?'!!document.querySelector("[data-testid=workshop-deep-report]")':'!!document.querySelector("[data-testid=video-workshop-new]")&&!document.querySelector(".video-workshop-deep-button")?.disabled','saved sample ready')
}
async function launch(){
  const rendererPort=await unusedPort(),mainPort=await unusedPort()
  child=spawn(executable,[`--user-data-dir=${userData}`,`--remote-debugging-port=${rendererPort}`,`--inspect=${mainPort}`,'--disable-gpu'],{env:{...process.env,SIGNAL_DESK_SMOKE_TEST:'1'},stdio:'ignore',windowsHide:true})
  main=await connect(mainPort,'node')
  await evaluate(`(()=>{const original=globalThis.fetch;globalThis.__workshopQaForbidden=[];globalThis.__workshopQaRequests=[];globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(['api.siliconflow.cn','openspeech.bytedance.com'].includes(u.hostname)){globalThis.__workshopQaRequests.push({host:u.hostname,path:u.pathname});return original(${JSON.stringify(fixtureOrigin)}+'/proxy'+u.pathname,init)}if(u.hostname==='127.0.0.1')return original(input,init);globalThis.__workshopQaForbidden.push({host:u.hostname,path:u.pathname});throw Error('External request forbidden in isolated verification')}})()`,main)
  renderer=await connect(rendererPort,'page');await renderer.send('Runtime.enable');await renderer.send('Network.enable');await renderer.send('Network.setBlockedURLs',{urls:['http://*','https://*']})
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1480,height:1000,deviceScaleFactor:1,mobile:false})
}
async function shutdown(){
  if(renderer){await evaluate('window.close()').catch(()=>{});renderer.ws.close();renderer=null}
  main?.ws.close();main=null
  if(child){for(let attempt=0;attempt<40&&child.exitCode===null;attempt++)await pause(100);if(child.exitCode===null)child.kill();child=null}
}
async function screenshot(name,width,selector){
  await renderer.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);await pause(150)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Horizontal overflow '+width)
  const shot=await renderer.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),path=join(output,name)
  writeFileSync(path,Buffer.from(shot.data,'base64'));report.screenshots.push(path)
}
async function currentJob(){return await evaluate(`window.signalDesk.getVideoWorkshop().then(v=>v.jobs.find(j=>j.id===${JSON.stringify(jobId)}))`)}
function assertFirstStageUnchanged(job){const {deep,...first}=job;assert.deepEqual(first,seededJob,'Deep processing altered the completed download/classification stage')}
const time=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`
try{
  await launch();await waitFor('!!window.signalDesk','preload readiness')
  await evaluate(`(async()=>{const config=await window.signalDesk.getSiliconFlow();await window.signalDesk.saveSiliconFlow({expectedRevision:config.revision,secret:'synthetic-workshop-sf-key',models:[{slot:1,model:${JSON.stringify(model)},visionEnabled:true}]});await window.signalDesk.saveDoubaoSpeech({authMode:'api-key',appId:'',secret:'synthetic-workshop-speech-key'})})()`)
  await navigate();await pause(250)
  assert.equal(requests.length,0,'Configuration or opening workshop made an automatic cloud request')
  assertFirstStageUnchanged(await currentJob());report.checks.noCloudCallsBeforeClick=true
  await screenshot('before-deep-1480.png',1480,'[data-testid=video-workshop-new]')
  await click('.video-workshop-deep-button')
  const deadline=Date.now()+90000;let completed
  while(Date.now()<deadline){
    const job=await currentJob(),phase=job.deep?.phase
    if(phase&&phaseHistory.at(-1)?.phase!==phase)phaseHistory.push({phase,observedAt:new Date().toISOString()})
    if(phase==='failed'||phase==='cancelled')throw Error('Deep processing stopped: '+job.deep.message)
    if(phase==='completed'){completed=job;break}await pause(60)
  }
  assert.ok(completed,'Deep processing completion timed out')
  await waitFor('document.querySelectorAll("[data-testid=workshop-deep-report] img").length>0&&[...document.querySelectorAll("[data-testid=workshop-deep-report] img")].every(i=>i.complete&&i.naturalWidth>0)','all source images loaded')
  await waitFor(`window.signalDesk.getVideoWorkshop().then(v=>v.jobs.find(j=>j.id===${JSON.stringify(jobId)}).deep.displayedTotalMs!==undefined)`,'click-to-available timing acknowledged')
  completed=await currentJob();assertFirstStageUnchanged(completed)
  const result=completed.deep.result;assert.equal(result.sourceSha256,sourceSha256);assert.equal(result.durationMs,4000);assert.equal(result.model,model)
  assert.deepEqual(result.speech.segments,[{id:'speech-1',startMs:500,endMs:1500,text:'合成语音测试'}]);assert.equal(result.speech.resourceId,resourceId)
  assert.ok(result.speech.audioPath.startsWith('E:\\AudioDownload\\video-workshop\\'+sourceSha256+'\\'))
  assert.equal(hash(readFileSync(result.speech.audioPath)),result.speech.audioSha256)
  assert.equal(requests.filter(r=>r.stage==='speech').length,1);assert.ok(requests.some(r=>r.stage==='vision'));assert.ok(requests.some(r=>r.stage==='report'))
  assert.ok(requests.filter(r=>r.stage!=='speech').every(r=>r.model===model&&r.path==='/proxy/v1/chat/completions'&&r.authorized))
  const submittedFrameIds=requests.filter(r=>r.stage==='vision').flatMap(r=>r.frameIds)
  assert.deepEqual(submittedFrameIds,result.frames.map(f=>f.id));assert.deepEqual(result.readings.map(r=>r.frameId),result.frames.map(f=>f.id))
  for(const frame of result.frames){assert.ok(frame.timeMs>=0&&frame.timeMs<4000);assert.ok(frame.path.startsWith(mediaDirectory+'\\'));assert.equal(hash(readFileSync(frame.path)),frame.sha256)}
  assert.deepEqual(result.report.sections.map(s=>({id:s.id,startMs:s.startMs,endMs:s.endMs,speechIds:s.speechIds,frameIds:s.frameIds})),[{id:'section-1',startMs:0,endMs:4000,speechIds:['speech-1'],frameIds:result.frames.map(f=>f.id)}])
  for(const window of requests.filter(r=>r.stage==='report').flatMap(r=>r.windows)){
    assert.deepEqual(window.speech.map(s=>s.id),window.speechIds);assert.deepEqual(window.frames.map(f=>f.frameId),window.frameIds)
    assert.ok(window.frames.every(f=>f.timeMs>=window.startMs&&f.timeMs<window.endMs))
  }
  const visible=await evaluate('document.querySelector("[data-testid=workshop-deep-report]").textContent')
  assert.ok(visible.includes('00:00.500 – 00:01.500'));assert.ok(visible.includes('合成语音测试'))
  for(const frame of result.frames)assert.ok(visible.includes('画面 '+time(frame.timeMs)),'Visible frame lost its actual source timestamp')
  assert.ok(completed.deep.displayedTotalMs>=completed.deep.elapsedMs)
  assert.ok(await evaluate('document.querySelector(".video-workshop-deep").textContent.includes("点击深度处理到图文报告与截图可用")'))
  assert.deepEqual(await evaluate('globalThis.__workshopQaForbidden',main),[]);assert.deepEqual(fixtureErrors,[])
  report.checks.realWorkerAndAudioWithSyntheticCloud=true;report.checks.originalSourceAndFirstStagePreserved=true;report.checks.exactSpeechAndFrameReferences=true;report.checks.correctCloudResourcesAndImagePayloads=true;report.checks.reportAndAllImagesAvailableTiming=true
  for(const width of [1480,1120]){await screenshot(`workshop-deep-overview-${width}.png`,width,'.video-workshop-deep');await screenshot(`workshop-deep-report-${width}.png`,width,'[data-testid=workshop-deep-report]')}
  const requestCount=requests.length,storedResult=structuredClone(result),storedTiming=completed.deep.displayedTotalMs
  await shutdown();await launch();await navigate(true)
  await waitFor('document.querySelectorAll("[data-testid=workshop-deep-report] img").length>0&&[...document.querySelectorAll("[data-testid=workshop-deep-report] img")].every(i=>i.complete&&i.naturalWidth>0)','restored report images')
  const restored=await currentJob();assertFirstStageUnchanged(restored);assert.deepEqual(restored.deep.result,storedResult);assert.equal(restored.deep.displayedTotalMs,storedTiming)
  assert.equal(await evaluate('document.querySelector(".video-workshop-deep-button").disabled'),true,'Completed deep processing button should prevent duplicate work')
  await evaluate(`document.querySelector('.video-workshop-deep-button').click()`)
  const idempotent=await evaluate(`window.signalDesk.deepProcessWorkshopVideo({jobId:${JSON.stringify(jobId)},clickedAt:Date.now()})`)
  assert.deepEqual(idempotent.jobs.find(j=>j.id===jobId).deep.result,storedResult)
  await pause(350)
  assert.equal(requests.length,requestCount,'Restart or completed-job click repeated cloud work');assert.deepEqual(await evaluate('globalThis.__workshopQaRequests',main),[])
  assert.deepEqual(await evaluate('globalThis.__workshopQaForbidden',main),[]);assert.equal(errors.length,0);assert.equal(hash(readFileSync(runtimePath)),runtimeHashBefore)
  report.checks.restartRetainsReportImagesAndOriginalTiming=true;report.checks.completedClickDoesNotRepeatCloudOrDownload=true;report.checks.rendererNoErrorsAndRuntimeConfigUnchanged=true
  report.phaseHistory=phaseHistory;report.requests=requests;report.completedJob=completed;report.success=true
}catch(error){report.success=false;report.failure=String(error.stack??error);report.requests=requests;report.phaseHistory=phaseHistory;report.errors=errors;report.fixtureErrors=fixtureErrors;throw error}
finally{
  await shutdown();await new Promise(r=>fixture.close(r));report.finishedAt=new Date().toISOString()
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,report:join(output,'report.json'),checks:report.checks},null,2))
}
