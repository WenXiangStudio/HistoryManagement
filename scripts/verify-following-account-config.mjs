import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const output='local-data/following-account-config-20261003'
mkdirSync(output,{recursive:true})
const pages=await fetch('http://127.0.0.1:9227/json').then(response=>response.json())
const page=pages.find(item=>item.type==='page'&&item.title==='Signal Desk')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
let id=0
const pending=new Map()
socket.addEventListener('message',event=>{const item=JSON.parse(event.data);if(pending.has(item.id)){pending.get(item.id)(item);pending.delete(item.id)}})
const send=(method,params)=>new Promise((resolve,reject)=>{
  const requestId=++id,timeout=setTimeout(()=>reject(new Error('Inspection timeout')),10000)
  pending.set(requestId,result=>{clearTimeout(timeout);result.error?reject(new Error(JSON.stringify(result.error))):resolve(result.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))
})
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
  return JSON.parse(result.result.value)
}
try{
  const result=await evaluate(`(async()=>{
    const waitReady=async()=>{
      const deadline=Date.now()+12000
      while(Date.now()<deadline){const state=await window.signalDesk.getFollowingSyncStatus();if(state.readiness.phase==='ready')return state;await new Promise(resolve=>setTimeout(resolve,100))}
      throw new Error('Account preparation did not become ready')
    }
    await waitReady()
    const before=await window.signalDesk.listCreators(),initial=await window.signalDesk.getFollowingConfiguration()
    const account=initial.accounts.find(owner=>owner.secUid===initial.activeOwnerSecUid)
    const changed=await window.signalDesk.saveFollowingConfiguration({chromeProfile:initial.chromeProfile,label:account.label+' · 配置验证'})
    const savedLabel=changed.accounts.find(owner=>owner.secUid===initial.activeOwnerSecUid).label
    await window.signalDesk.bindFollowingAccount({label:account.label,profileUrl:'https://www.douyin.com/user/'+account.secUid})
    const prepared=await waitReady()
    const bound=await window.signalDesk.getFollowingConfiguration(),after=await window.signalDesk.listCreators()
    const navigation=[...document.querySelectorAll('nav button')]
    navigation.find(button=>button.textContent.includes('设置')).click()
    await new Promise(resolve=>setTimeout(resolve,300))
    return JSON.stringify({initial,changed,bound,prepared,savedLabel,before,after,
      ui:{panel:!!document.querySelector('[data-testid="following-account-settings"]'),
        text:document.querySelector('[data-testid="following-account-settings"]')?.innerText,
        profile:document.querySelector('select[aria-label="关注同步 Chrome 用户配置"]')?.value,
        account:document.querySelector('select[aria-label="当前关注资料账号"]')?.value,
        canSync:!document.querySelector('[data-testid="start-following-sync"]').disabled}})
  })()`)
  assert.equal(result.before.length,160);assert.deepEqual(result.after,result.before)
  assert.equal(result.bound.activeOwnerSecUid,result.initial.activeOwnerSecUid)
  assert.equal(result.bound.accounts.find(account=>account.secUid===result.bound.activeOwnerSecUid).label,result.initial.accounts.find(account=>account.secUid===result.initial.activeOwnerSecUid).label)
  assert.ok(result.savedLabel.includes('配置验证'));assert.equal(result.ui.panel,true);assert.equal(result.ui.canSync,true)
  assert.equal(result.ui.profile,result.bound.chromeProfile);assert.equal(result.ui.account,result.bound.activeOwnerSecUid)
  writeFileSync(join(output,'configuration-validation.json'),JSON.stringify(result,null,2))
  const screenshot=await send('Page.captureScreenshot',{format:'png'})
  const evidence='docs/evidence/following-account-config-20261003';mkdirSync(evidence,{recursive:true})
  writeFileSync(join(evidence,'app-settings.png'),Buffer.from(screenshot.data,'base64'))
  console.log(JSON.stringify({selectedProfile:result.bound.chromeProfile,account:result.bound.accounts[0],editableLabelVerified:true,
    nativeIdentityBindingVerified:true,retainedCreators:result.after.length,priorRowsUnchanged:true,settingsRendered:true,syncEnabled:true},null,2))
}finally{socket.close()}
