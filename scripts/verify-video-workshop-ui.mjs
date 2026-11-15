// Isolated packaged UI verification. The new workshop is a preview in this release;
// this script exercises local link validation and never starts media or cloud work.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'

const executable=resolve(process.argv[2]||'release/win-unpacked/Signal Desk.exe')
assert.ok(existsSync(executable),'Pass an existing candidate Signal Desk.exe path')
const outputRoot=resolve('local-data/video-workshop-ui-20261016')
mkdirSync(outputRoot,{recursive:true})
const output=mkdtempSync(join(outputRoot,'run-')),userData=join(output,'synthetic-user-data')
mkdirSync(userData)
const pause=ms=>new Promise(resolveWait=>setTimeout(resolveWait,ms))
const errors=[],externalRequests=[]
const report={executable,userData,isolatedUserData:true,mediaOrCloudProcessingStarted:false,checks:{},screenshots:[]}
let child,renderer

async function unusedPort(){return new Promise((resolvePort,reject)=>{
  const server=createServer();server.once('error',reject)
  server.listen(0,'127.0.0.1',()=>{const selected=server.address().port;server.close(()=>resolvePort(selected))})
})}
async function connect(port){
  for(let attempt=0;attempt<150;attempt++){
    if(child.exitCode!==null)throw Error('Candidate exited before its renderer was ready')
    try{
      const pages=await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(600)}).then(response=>response.json())
      const page=pages.find(entry=>entry.type==='page')
      if(page){
        const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let id=0
        socket.addEventListener('message',event=>{
          const message=JSON.parse(event.data)
          if(message.id){pending.get(message.id)?.(message);pending.delete(message.id)}
          if(message.method==='Runtime.exceptionThrown'||message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params)
          if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url))externalRequests.push(message.params.request.url)
        })
        await new Promise((resolveOpen,reject)=>{socket.addEventListener('open',resolveOpen,{once:true});socket.addEventListener('error',reject,{once:true})})
        return {socket,send:(method,params={})=>new Promise((resolveCall,reject)=>{
          const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(Error('CDP timeout '+method))},20_000)
          pending.set(requestId,message=>{clearTimeout(timer);message.error||message.result?.exceptionDetails?reject(Error(JSON.stringify(message.error??message.result.exceptionDetails))):resolveCall(message.result)})
          socket.send(JSON.stringify({id:requestId,method,params}))
        })}
      }
    }catch{}
    await pause(100)
  }
  throw Error('Candidate renderer inspector is unavailable')
}
async function evaluate(expression){return (await renderer.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value}
async function waitFor(expression,label){
  for(let attempt=0;attempt<150;attempt++){if(await evaluate(expression))return;await pause(50)}
  throw Error('UI timeout '+label)
}
async function clickText(selector,text){
  await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent.trim()===${JSON.stringify(text)});if(!element||element.disabled)throw Error('Missing or disabled control: '+${JSON.stringify(text)});element.click()})()`)
}
async function setLink(value){
  await evaluate(`(()=>{const element=document.querySelector('[aria-label="抖音视频链接"]');if(!element)throw Error('Link input missing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}))})()`)
}
async function readStatus(){return await evaluate('document.querySelector("[data-testid=workshop-link-status]")?.textContent??""')}
async function screenshot(name,width,selector='[data-testid=video-workshop-new]'){
  await renderer.send('Emulation.setDeviceMetricsOverride',{width,height:920,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`)
  await pause(150)
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`Horizontal overflow at ${width}px`)
  const shot=await renderer.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),path=join(output,name)
  writeFileSync(path,Buffer.from(shot.data,'base64'));report.screenshots.push(path)
}
async function snapshot(){return await evaluate(`(async()=>({
  settings:await window.signalDesk.getSettings(),
  library:await window.signalDesk.getVideoLibrary(),
  creators:await window.signalDesk.listCreators()
}))()`)}

try{
  const port=await unusedPort()
  child=spawn(executable,[`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--disable-gpu'],{
    env:{...process.env,SIGNAL_DESK_SMOKE_TEST:'1'},stdio:'ignore',windowsHide:true
  })
  renderer=await connect(port)
  await renderer.send('Runtime.enable');await renderer.send('Network.enable')
  await renderer.send('Network.setBlockedURLs',{urls:['http://*','https://*']})
  await waitFor('!!window.signalDesk&&!!document.querySelector("nav")','APP readiness')
  const before=await snapshot()
  assert.equal(before.library.ownerSecUid,null,'Synthetic user unexpectedly has a bound account')
  await clickText('nav button','视频工坊')
  await waitFor('!!document.querySelector("[data-testid=video-workshop-new]")','new URL workflow')
  assert.equal(await evaluate('document.querySelector("[role=tab][aria-selected=true]")?.textContent'),'新建处理')
  report.checks.newWorkflowAvailableWithoutOwner=true
  const pageText=await evaluate('document.querySelector("[data-testid=information-workshop-page]").textContent')
  for(const expected of ['豆包极速版','volc.bigasr.auc_turbo','Qwen/Qwen3.5-122B-A10B','E:\\VideoDownload','E:\\AudioDownload'])assert.ok(pageText.includes(expected),'Missing task default '+expected)
  assert.match(await evaluate('document.getElementById("video-workshop-preview")?.textContent??""'),/预览|尚未接入/)
  report.checks.explicitPreviewAndTaskDefaults=true
  const processButtons=await evaluate(`[...document.querySelectorAll('[data-testid=video-workshop-new] button')].filter(button=>['处理','深度处理'].includes(button.textContent.trim())).map(button=>({label:button.textContent.trim(),disabled:button.disabled,description:button.getAttribute('aria-describedby')}))`)
  assert.equal(processButtons.length,2)
  for(const button of processButtons){assert.equal(button.disabled,true);assert.equal(button.description,'video-workshop-preview')}
  report.checks.unconnectedProcessingIsDisabled=true

  const canonical='https://www.douyin.com/video/7694535682575860393'
  await setLink('https://douyin.com/video/7694535682575860393/?share=qa#source')
  await waitFor(`document.querySelector('[data-testid=workshop-link-status]')?.textContent.includes(${JSON.stringify(canonical)})`,'full video link')
  report.fullLinkStatus=await readStatus()
  await screenshot('video-workshop-1480.png',1480)
  await screenshot('video-workshop-1120.png',1120)
  report.checks.fullVideoLinkNormalized=true

  await setLink('3.14 分享示例 https://v.douyin.com/QaOnly_01/ 复制此链接打开抖音。')
  await waitFor('document.querySelector("[data-testid=workshop-link-status]")?.textContent.includes("https://v.douyin.com/QaOnly_01/")','shared short link')
  report.shortLinkStatus=await readStatus();report.checks.shareTextShortLinkRecognizedLocally=true
  for(const [input,expected]of [
    ['https://example.com/video/1','仅支持抖音'],
    ['https://www.douyin.com.evil.example/video/123','仅支持抖音'],
    ['https://www.douyin.com/user/qa','作品链接'],
    ['https://v.douyin.com/One/ https://v.douyin.com/Two/','每次输入一条']
  ]){
    await setLink(input)
    await waitFor(`document.querySelector('[data-testid=workshop-link-status]')?.textContent.includes(${JSON.stringify(expected)})`,'invalid link '+input)
  }
  report.checks.invalidHostsNonVideosAndMultipleLinksRejected=true
  await evaluate('document.querySelector("[aria-label=清空视频链接]").click()')
  await waitFor('document.querySelector("[aria-label=抖音视频链接]").value===""','cleared link')
  report.checks.linkCanBeCleared=true
  assert.equal(await evaluate('!!document.querySelector("[data-testid=workshop-report-empty]")'),true)
  assert.equal(await evaluate('document.querySelector("[data-testid=workshop-report-empty]").querySelectorAll("img").length'),0)
  assert.match(await evaluate('document.querySelector("[data-testid=workshop-report-empty]").textContent'),/尚未|还没有|等待|完成|生成/)
  await evaluate(`[...document.querySelectorAll('[data-testid=video-workshop-new] button')].filter(button=>['处理','深度处理'].includes(button.textContent.trim())).forEach(button=>button.click())`)
  assert.equal(await evaluate('!!document.querySelector("[data-testid=workshop-report-empty]")'),true)
  report.checks.reportStaysEmptyWithoutRealProcessing=true

  await clickText('[role=tab]','历史资料')
  await waitFor('!!document.querySelector("[data-testid=saved-workshop-history]")','history entry')
  assert.equal(await evaluate('document.querySelector("[data-testid=workshop-total]")?.textContent'),'0条')
  assert.equal(await evaluate('document.querySelector("[role=tab][aria-selected=true]")?.textContent'),'历史资料')
  report.checks.previousRecordsHaveSeparateHistoryEntry=true
  await clickText('[role=tab]','新建处理')
  await waitFor('!!document.querySelector("[data-testid=video-workshop-new]")','return from history')
  const after=await snapshot()
  assert.deepEqual(after,before,'UI preview changed stored settings, records or creators')
  assert.deepEqual(externalRequests,[],'Local preview attempted an external renderer request')
  assert.deepEqual(errors,[],'Renderer emitted an error')
  report.checks.noStoredDataChangesOrRendererRequests=true
  report.success=true
}catch(error){report.success=false;report.failure=String(error.stack??error);process.exitCode=1}
finally{
  if(renderer){await evaluate('window.close()').catch(()=>{});renderer.socket.close()}
  if(child){for(let attempt=0;attempt<40&&child.exitCode===null;attempt++)await pause(100);if(child.exitCode===null)child.kill()}
  report.errors=errors;report.rendererExternalRequests=externalRequests;report.finishedAt=new Date().toISOString()
  const path=join(output,'report.json');writeFileSync(path,JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,report:path,checks:report.checks,failure:report.failure},null,2))
}
