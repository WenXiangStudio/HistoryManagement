// Operator validation only: launch the review APP after both APP and Chrome
// have been closed. Observe startup and button readiness; never collect authors.
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const output=resolve(process.argv[2]||'local-data/following-cold-start-20261003')
const executable=resolve(process.argv[3]||'release-following-background-final/win-unpacked/Signal Desk.exe')
const profile=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview')
mkdirSync(output,{recursive:true})
const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
  `ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='Signal Desk.exe'" | Select-Object ProcessId,Name)`],{encoding:'utf8',windowsHide:true}))
if(processes.length)throw new Error('Close APP and Chrome before this cold-start verification')
const started=performance.now()
const quote=value=>"'"+value.replaceAll("'","''")+"'"
const appPid=Number(execFileSync('powershell.exe',['-NoProfile','-Command',
  `Start-Process -FilePath ${quote(executable)} -ArgumentList @('--remote-debugging-port=9227',${quote(`--user-data-dir=${profile}`)}) -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id`],{encoding:'utf8',windowsHide:true}).trim())
let socket,page,launchToUiMs
const samples=[]
try{
  while(performance.now()-started<15000){
    try{page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')}catch{}
    if(page)break
    await new Promise(r=>setTimeout(r,100))
  }
  if(!page)throw new Error('APP did not open')
  socket=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0
  const pending=new Map()
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);pending.get(data.id)?.(data);pending.delete(data.id)})
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const requestId=++id,timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('APP evaluation timed out'))},5000)
    pending.set(requestId,data=>{clearTimeout(timeout);data.error||data.result.exceptionDetails?reject(new Error(JSON.stringify(data.error||data.result.exceptionDetails))):resolve(JSON.parse(data.result.result.value))})
    socket.send(JSON.stringify({id:requestId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))
  })
  while(performance.now()-started<40000){
    const sample=await evaluate(`(async()=>JSON.stringify({state:await window.signalDesk.getFollowingSyncStatus(),disabled:document.querySelector('[data-testid="start-following-sync"]')?.disabled}))()`)
    sample.launchElapsedMs=performance.now()-started;samples.push(sample)
    if(launchToUiMs===undefined&&typeof sample.disabled==='boolean')launchToUiMs=sample.launchElapsedMs
    if(sample.state.readiness?.phase==='ready'&&sample.state.connection?.online&&sample.disabled===false)break
    if(sample.state.readiness?.phase==='blocked')break
    await new Promise(r=>setTimeout(r,100))
  }
  const last=samples.at(-1)
  const creators=await evaluate('window.signalDesk.listCreators().then(rows=>JSON.stringify(rows))')
  const proof=JSON.parse(readFileSync(join(profile,'following-preparation','latest.json'),'utf8'))
  const ok=last.state.readiness?.phase==='ready'&&last.state.connection?.online&&last.disabled===false
  const result={ok,precondition:processes,appPid,launchToUiMs,launchToReadyAndEnabledMs:last.launchElapsedMs,
    sawDisabled:samples.some(s=>s.disabled===true),creatorCount:creators.length,runId:last.state.runId,
    preparationMatches:proof.preparationId===last.state.readiness?.preparationId,preparationServiceMs:proof.elapsedMs,
    structuredApiMs:proof.proof?.acquisitionMs,browserExecution:proof.browserExecution,samples}
  writeFileSync(join(output,'cold-start.json'),JSON.stringify(result,null,2))
  writeFileSync(join(output,'preparation.json'),JSON.stringify(proof,null,2))
  writeFileSync(join(output,'creators-after.json'),JSON.stringify(creators,null,2))
  console.log(JSON.stringify({...result,samples:undefined},null,2))
  if(!ok||!result.sawDisabled||!result.preparationMatches)throw new Error('Cold-start readiness failed')
}finally{socket?.close()}
