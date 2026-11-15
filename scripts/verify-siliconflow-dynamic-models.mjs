// Isolated packaged-APP UI verification. Uses synthetic configuration only;
// never reads the daily user directory or invokes a model-processing API.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'

if(!process.argv[2])throw Error('Usage: node scripts/verify-siliconflow-dynamic-models.mjs "<candidate>/win-unpacked/Signal Desk.exe"')
const executable=resolve(process.argv[2])
assert.ok(existsSync(executable),'Candidate executable does not exist')
const outputRoot=resolve('local-data/siliconflow-dynamic-20261016/ui')
mkdirSync(outputRoot,{recursive:true})
const output=mkdtempSync(join(outputRoot,'run-'))
const userData=join(output,'synthetic-user-data')
mkdirSync(userData)
const card='[data-testid="siliconflow-settings"]'
const syntheticKey='sk-synthetic-ui-verification-only'
const delay=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms))
const report={startedAt:new Date().toISOString(),executable,userData,syntheticDataOnly:true,
  dailyDataRead:false,modelProcessingActionsInvoked:0,screenshots:[],checks:{},rendererErrors:[],externalRendererRequests:[]}
let child=null,socket=null,serial=0
const pending=new Map()

async function availablePort(){
  return new Promise((resolvePort,reject)=>{
    const server=createServer()
    server.once('error',reject)
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolvePort(port))})
  })
}
function send(method,params={}){
  return new Promise((resolveCall,reject)=>{
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`))},15_000)
    pending.set(id,message=>{
      clearTimeout(timer)
      if(message.error||message.result?.exceptionDetails)reject(Error(`${method}: ${JSON.stringify(message.error??message.result.exceptionDetails)}`))
      else resolveCall(message.result)
    })
    socket.send(JSON.stringify({id,method,params}))
  })
}
async function evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  return result.result.value
}
async function waitFor(expression,label=expression){
  for(let attempt=0;attempt<160;attempt++){
    if(await evaluate(expression))return
    if(child?.exitCode!==null)throw Error('Owned candidate exited while waiting for '+label)
    await delay(50)
  }
  const message=await evaluate(`document.querySelector(${JSON.stringify(card)})?.innerText??''`)
  throw Error(`UI timeout: ${label}\n${message}`)
}
async function start(){
  const port=await availablePort()
  child=spawn(executable,[`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--disable-gpu'],{
    env:{...process.env,SIGNAL_DESK_SMOKE_TEST:'1'},stdio:'ignore',windowsHide:true
  })
  let spawnError=null
  child.once('error',error=>{spawnError=error})
  let page
  for(let attempt=0;attempt<160;attempt++){
    if(spawnError)throw spawnError
    if(child.exitCode!==null)throw Error(`Owned candidate exited at startup (${child.exitCode})`)
    try{
      const pages=await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(1000)}).then(response=>response.json())
      page=pages.find(entry=>entry.type==='page'&&entry.url.startsWith('file:')&&entry.url.includes('/app.asar/'))
      if(page)break
    }catch{}
    await delay(100)
  }
  assert.ok(page,'Owned candidate renderer did not become available')
  const websocketUrl=new URL(page.webSocketDebuggerUrl)
  assert.equal(websocketUrl.hostname,'127.0.0.1')
  assert.equal(Number(websocketUrl.port),port)
  socket=new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data)
    if(message.id){pending.get(message.id)?.(message);pending.delete(message.id)}
    if(message.method==='Runtime.exceptionThrown')report.rendererErrors.push(message.params.exceptionDetails)
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')report.rendererErrors.push(message.params)
    if(message.method==='Network.requestWillBeSent'){
      const url=new URL(message.params.request.url)
      if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){
        report.externalRendererRequests.push({origin:url.origin,pathname:url.pathname})
      }
    }
  })
  await new Promise((resolveOpen,reject)=>{socket.addEventListener('open',resolveOpen,{once:true});socket.addEventListener('error',reject,{once:true})})
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable')
  await waitFor('!!window.signalDesk&&!!document.querySelector("nav")','APP bridge and navigation')
}
async function stop(){
  // This target came only from this script's random port and spawned child.
  if(socket){await evaluate('window.close()').catch(()=>{});socket.close();socket=null}
  if(child){
    for(let attempt=0;attempt<50&&child.exitCode===null;attempt++)await delay(100)
    if(child.exitCode===null)child.kill()
    child=null
  }
}
async function clickExpression(expression){
  const point=await evaluate(`(()=>{const element=${expression};if(!element)throw Error('Missing click target');
    if(element.disabled)throw Error('Disabled click target');element.scrollIntoView({block:'center',inline:'nearest'});
    const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for(const type of ['mouseMoved','mousePressed','mouseReleased']){
    await send('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})})
  }
}
const clickSelector=selector=>clickExpression(`document.querySelector(${JSON.stringify(selector)})`)
const clickButton=text=>clickExpression(`[...document.querySelectorAll(${JSON.stringify(card+' button')})].find(button=>button.textContent.trim()===${JSON.stringify(text)})`)
async function setInput(label,value){
  await evaluate(`(()=>{const element=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');
    if(!element)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`)
}
async function settingsPage(){
  await clickExpression(`[...document.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='设置'||button.querySelector('span')?.textContent==='设置')`)
  await waitFor(`!!document.querySelector(${JSON.stringify(card)})&&!document.querySelector(${JSON.stringify(card+' fieldset')}).disabled`,'SiliconFlow settings loaded')
}
const view=()=>evaluate('window.signalDesk.getSiliconFlow()')
const settings=()=>evaluate('window.signalDesk.getSettings()')
const stableSlot=slot=>({slot:slot.slot,profileId:slot.profileId,profileName:slot.profileName,model:slot.model,visionEnabled:slot.visionEnabled,hasSecret:slot.hasSecret})
const identity=slots=>slots.map(stableSlot)
const modelSelector=slot=>`${card} [aria-label="硅基流动模型${slot}"]`
async function savedSlotNumbers(numbers){
  await waitFor(`window.signalDesk.getSiliconFlow().then(view=>JSON.stringify(view.slots.map(slot=>slot.slot))===${JSON.stringify(JSON.stringify(numbers))})`,'saved model slots '+numbers.join(','))
  await waitFor(`document.querySelector(${JSON.stringify(card+' [role="status"]')})?.textContent.includes('配置已保存')`,'configuration save confirmation')
}
async function saveSlots(numbers){await clickButton('保存硅基流动配置');await savedSlotNumbers(numbers)}
async function screenshot(name,width=1480,height=920){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'start'})`)
  await delay(120)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`Horizontal overflow at ${width}px`)
  const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const path=join(output,name)
  writeFileSync(path,Buffer.from(result.data,'base64'))
  report.screenshots.push({path,width,height})
}

try{
  await start();await settingsPage()
  const initialView=await view(),initialSettings=await settings()
  assert.equal(initialView.slots.length,0,'Fresh isolated profile should not create fixed model slots')
  assert.equal(initialView.hasSecret,false)
  report.checks.freshEmptyState=true

  for(let slot=1;slot<=5;slot++){
    await clickButton('新增模型')
    await waitFor(`!!document.querySelector(${JSON.stringify(modelSelector(slot))})`,'new model '+slot)
    await setInput(`硅基流动模型${slot}`,`qa-only/model-${slot}`)
    if(slot===2||slot===4)await clickSelector(`${card} [aria-label="硅基流动模型${slot}图片输入"]`)
  }
  await setInput('硅基流动API Key',syntheticKey)
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(card+' .siliconflow-model')}).length`),5)
  await saveSlots([1,2,3,4,5])
  const five=await view()
  assert.equal(five.hasSecret,true)
  assert.ok(five.slots.every(slot=>slot.profileId&&slot.hasSecret))
  assert.deepEqual(five.slots.map(slot=>slot.model),[1,2,3,4,5].map(slot=>`qa-only/model-${slot}`))
  assert.deepEqual(five.slots.map(slot=>slot.visionEnabled),[false,true,false,true,false])
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(card+' [aria-label="硅基流动API Key"]')}).value`),'')
  report.checks.addAndSaveFiveModels=true
  report.savedFive=identity(five.slots)
  await clickButton('使用模型 4')
  const fourth=five.slots.find(slot=>slot.slot===4)
  await waitFor(`window.signalDesk.getSettings().then(settings=>settings.activeCloudProfileId===${JSON.stringify(fourth.profileId)})`,'activate model 4')
  await waitFor(`document.querySelector(${JSON.stringify(modelSelector(4))}).closest('.siliconflow-model').textContent.includes('正在使用')`,'active model 4 marker')
  const activeFourth=await settings()
  assert.equal(activeFourth.textModel,fourth.model);assert.equal(activeFourth.visionModel,fourth.model)
  report.checks.activateFourthModel=true
  await screenshot('five-models-wide.png')
  await screenshot('five-models-1120.png',1120,900)
  await send('Emulation.clearDeviceMetricsOverride')

  await clickSelector(`${card} [aria-label="删除硅基流动模型2"]`)
  await waitFor(`!document.querySelector(${JSON.stringify(modelSelector(2))})`,'middle row removed from draft')
  assert.deepEqual(identity((await view()).slots),identity(five.slots),'Draft deletion must not write immediately')
  await saveSlots([1,3,4,5])
  const withoutMiddle=await view()
  assert.deepEqual(identity(withoutMiddle.slots),identity(five.slots.filter(slot=>slot.slot!==2)),'Retained model identity/key/vision metadata changed')
  assert.equal((await settings()).activeCloudProfileId,fourth.profileId)
  assert.ok(!(await settings()).cloudProfiles.some(profile=>profile.id===five.slots.find(slot=>slot.slot===2).profileId))
  report.checks.deleteMiddlePreservesRemainingIdentities=true

  await clickSelector(`${card} [aria-label="删除硅基流动模型3"]`)
  await waitFor(`!document.querySelector(${JSON.stringify(modelSelector(3))})`,'undo draft row removal')
  await clickButton('撤销删除')
  await waitFor(`document.querySelector(${JSON.stringify(modelSelector(3))})?.value==='qa-only/model-3'`,'undo restored model 3')
  assert.deepEqual(identity((await view()).slots),identity(withoutMiddle.slots))
  await saveSlots([1,3,4,5])
  assert.deepEqual(identity((await view()).slots),identity(withoutMiddle.slots))
  report.checks.undoDraftDeletion=true

  await clickSelector(`${card} [aria-label="删除硅基流动模型4"]`)
  await waitFor(`document.querySelector(${JSON.stringify(card+' .siliconflow-removals')})?.textContent.includes('包含当前云端方案')`,'active deletion warning')
  await saveSlots([1,3,5])
  const withoutActive=await view(),fallback=await settings()
  assert.deepEqual(identity(withoutActive.slots),identity(five.slots.filter(slot=>[1,3,5].includes(slot.slot))))
  const fallbackSlot=withoutActive.slots.find(slot=>slot.profileId===fallback.activeCloudProfileId)
  assert.ok(fallbackSlot,'Deleting active model should select a retained configured model')
  assert.equal(fallback.textModel,fallbackSlot.model)
  assert.equal(fallback.visionModel,fallbackSlot.visionEnabled?fallbackSlot.model:'')
  assert.notEqual(fallback.activeCloudProfileId,fourth.profileId)
  report.checks.deleteActiveSelectsConsistentFallback=true
  report.activeDeletionFallback={slot:fallbackSlot.slot,profileId:fallbackSlot.profileId}

  for(const slot of withoutActive.slots)await clickSelector(`${card} [aria-label="删除硅基流动模型${slot.slot}"]`)
  await waitFor(`document.querySelectorAll(${JSON.stringify(card+' .siliconflow-model')}).length===0`,'empty draft')
  await saveSlots([])
  const emptied=await view(),emptySettings=await settings()
  assert.equal(emptied.hasSecret,true,'Removing all models must retain shared credential')
  assert.equal(emptySettings.activeCloudProfileId,initialSettings.activeCloudProfileId)
  assert.equal(emptySettings.textModel,initialSettings.textModel)
  assert.deepEqual(emptySettings.cloudProfiles,initialSettings.cloudProfiles)
  report.checks.removeAllRetainsSharedKeyAndOriginalProfile=true
  await screenshot('empty-model-list-wide.png')
  await screenshot('empty-model-list-1120.png',1120,900)
  await send('Emulation.clearDeviceMetricsOverride')

  await clickButton('新增模型')
  await waitFor(`!!document.querySelector(${JSON.stringify(modelSelector(1))})`,'re-added model')
  await setInput('硅基流动模型1','qa-only/model-readded')
  await clickSelector(`${card} [aria-label="硅基流动模型1图片输入"]`)
  await saveSlots([1])
  const readded=await view()
  assert.equal(readded.hasSecret,true);assert.equal(readded.slots[0].hasSecret,true)
  assert.equal(readded.slots[0].visionEnabled,true)
  assert.equal(readded.slots[0].model,'qa-only/model-readded')
  assert.notEqual(readded.slots[0].profileId,five.slots[0].profileId)
  report.checks.readdInheritsSharedKey=true
  await clickButton('使用模型 1')
  await waitFor(`window.signalDesk.getSettings().then(settings=>settings.activeCloudProfileId===${JSON.stringify(readded.slots[0].profileId)})`,'activate re-added model')
  const finalSettings=await settings()
  assert.equal(finalSettings.textModel,'qa-only/model-readded');assert.equal(finalSettings.visionModel,'qa-only/model-readded')
  await send('Page.reload',{ignoreCache:true})
  await waitFor('!!document.querySelector("nav")','reloaded navigation')
  await settingsPage()
  assert.deepEqual(identity((await view()).slots),identity(readded.slots))
  report.checks.pageReloadPersistence=true
  await stop();await start();await settingsPage()
  const restarted=await view(),restartedSettings=await settings()
  assert.deepEqual(identity(restarted.slots),identity(readded.slots))
  assert.equal(restarted.hasSecret,true)
  assert.equal(restartedSettings.activeCloudProfileId,readded.slots[0].profileId)
  assert.equal(restartedSettings.textModel,'qa-only/model-readded');assert.equal(restartedSettings.visionModel,'qa-only/model-readded')
  report.checks.appRestartPersistence=true
  report.finalModels=identity(restarted.slots)
  await screenshot('readded-after-restart-wide.png')
  await screenshot('readded-after-restart-1120.png',1120,900)
  assert.equal(report.rendererErrors.length,0,'Renderer errors occurred')
  assert.equal(report.externalRendererRequests.length,0,'Unexpected external renderer request')
  report.success=true
}catch(error){
  report.success=false;report.failure=error instanceof Error?error.stack:String(error)
  throw error
}finally{
  await stop()
  report.finishedAt=new Date().toISOString()
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,report:join(output,'report.json'),checks:report.checks,screenshots:report.screenshots},null,2))
}
