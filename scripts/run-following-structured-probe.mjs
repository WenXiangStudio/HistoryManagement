import {readFileSync,writeFileSync,existsSync,statSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
const pages=await fetch('http://127.0.0.1:9227/json').then(response=>response.json())
const page=pages.find(item=>item.type==='page'&&item.title==='Signal Desk')
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
const started=Date.now()
socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'window.signalDesk.probeStructuredFollowing()',awaitPromise:true,returnByValue:true}}))
await new Promise((resolve,reject)=>socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id===1){if(result.error||result.result?.exceptionDetails)reject(new Error('Probe dispatch failed'));else resolve()}},{once:true}))
socket.close()
const source=join(process.env.LOCALAPPDATA,'SignalDeskFollowingReview','following-structured-probe','latest.json')
while(Date.now()-started<30000){
  if(existsSync(source)&&statSync(source).mtimeMs>=started){
    const result=JSON.parse(readFileSync(source,'utf8'))
    mkdirSync('local-data/following-structured-20261003',{recursive:true})
    writeFileSync('local-data/following-structured-20261003/probe.json',JSON.stringify(result,null,2))
    console.log(JSON.stringify({...result,creators:result.creators?.map(item=>({nickname:item.nickname,secUid:item.secUid}))},null,2))
    process.exit(0)
  }
  await new Promise(resolve=>setTimeout(resolve,100))
}
throw new Error('Probe did not return a report')
