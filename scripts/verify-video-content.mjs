// APP-only review harness. Never attaches to Chrome CDP or reads credentials.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const action=process.argv[2]||'status',creatorId=Number(process.argv[3]||'-1000000512')
const output=resolve('local-data/video-content-20261010');mkdirSync(output,{recursive:true})
if(!['status','evidence','catalog','discover','process','content-status','interest','screenshot','resume','cancel','peek','cancel-test','process-ui'].includes(action))throw Error('Unknown action')
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(x=>x.type==='page')
if(!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:9227/'))throw Error('Review APP unavailable')
const ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
let sequence=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m)})
const evaluate=expression=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('APP request timeout'))},15000)
  pending.set(id,m=>{clearTimeout(timer);pending.delete(id);m.error||m.result?.exceptionDetails?reject(Error('APP evaluation failed')):resolve(m.result.result.value)})
  ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))
})
try{
  const status=await evaluate('window.signalDesk.getFollowingSyncStatus()')
  console.log(JSON.stringify({phase:status.phase,connection:status.connection,readiness:status.readiness?.phase,activity:status.activity?.phase,basic:status.basic?.phase}))
  if(action==='cancel-test'||action==='process-ui'){
    const workId=process.argv[3];if(!/^\d{8,30}$/.test(workId))throw Error('Invalid work ID')
    const library=await evaluate('window.signalDesk.getVideoLibrary()'),owner=library.ownerSecUid
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()`)
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(workId)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await new Promise(r=>setTimeout(r,300))
    await evaluate(`(()=>{const box=document.querySelector('.video-work-checkbox');if(!box.checked)box.click()})()`)
    const started=performance.now()
    await evaluate(`[...document.querySelectorAll('.video-content-controls button')].find(b=>b.textContent.includes('本地提取选中')).click()`)
    let batch;const deadline=Date.now()+600000
    do{
      await new Promise(r=>setTimeout(r,300));const view=await evaluate('window.signalDesk.getVideoLibrary()');batch=view.contentBatches.find(b=>b.workIds.includes(workId)&&b.kind==='process')
      if(action==='cancel-test'&&batch?.currentStage==='transcript'&&batch.state==='running'){
        await evaluate(`window.signalDesk.cancelVideoTask(${JSON.stringify(owner)})`)
        await new Promise(r=>setTimeout(r,1500))
        const detail=await evaluate(`window.signalDesk.getVideoContentDetail(${JSON.stringify(owner)},${JSON.stringify(workId)})`)
        if(detail.summary||detail.stages.some(s=>s.state==='running'))throw Error('Cancelled work still running or generated summary')
        const report={batchId:batch.id,workId,cancelled:true,stages:detail.stages.map(s=>({stage:s.stage,state:s.state}))};writeFileSync(join(output,'cancellation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));break
      }
      if(action==='process-ui'&&batch&&batch.state!=='running'&&batch.displayedTotalMs!==undefined){
        const report={...batch,operatorClickToUsableMs:performance.now()-started};writeFileSync(join(output,'ui-processing.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));break
      }
      if(batch&&['failed','cancelled'].includes(batch.state))throw Error('Batch did not finish')
    }while(Date.now()<deadline)
    if(Date.now()>=deadline)throw Error('UI verification timed out')
  }else if(action==='peek'){
    const v=await evaluate('window.signalDesk.getVideoLibrary()');console.log(JSON.stringify({videos:v.records.length,runtime:v.runtime,latest:v.contentBatches?.[0]},null,2))
  }else if(action==='resume'||action==='cancel'){
    const v=await evaluate('window.signalDesk.getVideoLibrary()')
    const next=await evaluate(action==='cancel'?`window.signalDesk.cancelVideoTask(${JSON.stringify(v.ownerSecUid)})`:`window.signalDesk.resumeVideoTask(${JSON.stringify(v.ownerSecUid)},${JSON.stringify(process.argv[3])})`)
    console.log(JSON.stringify(next,null,2))
  }else if(action==='screenshot'){
    await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent==='视频信息').click()`)
    await new Promise(r=>setTimeout(r,500))
    if(process.argv[3]&&/^\d{8,30}$/.test(process.argv[3])){
      await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索视频"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(process.argv[3])});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await new Promise(r=>setTimeout(r,300))
      await evaluate(`document.querySelector('[data-work-id="${process.argv[3]}"]')?.click()`)
      await new Promise(r=>setTimeout(r,500))
      await evaluate(`document.querySelectorAll('.video-content-expanded').forEach(d=>d.open=true)`)
      await new Promise(r=>setTimeout(r,400))
    }
    const command=(method,params={})=>new Promise(resolve=>{const id=++sequence;pending.set(id,m=>resolve(m.result));ws.send(JSON.stringify({id,method,params}))})
    const compact=process.argv[4]==='compact',framesOnly=process.argv[4]==='frames'
    if(compact){await command('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,300))}
    if(framesOnly){await evaluate(`document.querySelector('.video-evidence-frames')?.scrollIntoView({block:'start'})`);await new Promise(r=>setTimeout(r,300))}
    const capture=await command('Page.captureScreenshot',{format:'png'})
    writeFileSync(join(output,compact?'video-content-ui-1120.png':framesOnly?'video-content-frames.png':'video-content-ui.png'),Buffer.from(capture.data,'base64'))
    console.log(await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,readingHeight:document.querySelector('.video-library-reading')?.clientHeight,text:document.querySelector('[data-testid="video-information-page"]')?.innerText})`));if(compact)await command('Emulation.clearDeviceMetricsOverride')
  }else if(['discover','process','content-status','interest'].includes(action)){
    const library=await evaluate('window.signalDesk.getVideoLibrary()'),owner=library.ownerSecUid
    let task
    if(action==='discover')task=await evaluate(`window.signalDesk.discoverVideoWorks(${JSON.stringify({ownerSecUid:owner,creatorIds:[creatorId],startDate:process.argv[4]||'2026-10-01',endDate:process.argv[5]||'2026-10-10'})})`)
    if(action==='process')task=await evaluate(`window.signalDesk.processVideoWorks(${JSON.stringify({ownerSecUid:owner,workIds:process.argv[3].split(','),provider:'local'})})`)
    if(action==='interest'){
      const work=library.records[0];await evaluate(`window.signalDesk.setVideoInterest(${JSON.stringify(owner)},${JSON.stringify(work.workId)},'interested')`)
      const detail=await evaluate(`window.signalDesk.getVideoContentDetail(${JSON.stringify(owner)},${JSON.stringify(work.workId)})`)
      if(detail.interest!=='interested')throw Error('Interest not saved')
      await evaluate(`window.signalDesk.setVideoInterest(${JSON.stringify(owner)},${JSON.stringify(work.workId)},${JSON.stringify(work.content?.interest||'unmarked')})`)
      console.log('Interest roundtrip restored')
    }
    if(action==='discover'){
      const deadline=Date.now()+100000
      do{await new Promise(r=>setTimeout(r,500));const v=await evaluate('window.signalDesk.getVideoLibrary()');task=v.contentBatches.find(b=>b.id===task.id);if(task.state!=='running')break}while(Date.now()<deadline)
      writeFileSync(join(output,task.id+'-discovery.json'),JSON.stringify(task,null,2))
      if(task.state!=='completed')process.exitCode=1
    }
    const result=await evaluate('window.signalDesk.getVideoLibrary()')
    console.log(JSON.stringify({task,runtime:result.runtime,batches:result.contentBatches,records:result.records.map(w=>({id:w.workId,publishedAt:w.publishedAt,title:w.title,content:w.content}))},null,2))
  }else if(action==='catalog'){
    const creators=await evaluate('window.signalDesk.listCreators().then(cs=>cs.filter(c=>!c.isDemo).map(c=>({id:c.id,name:c.nickname,anomaly:!!c.activity?.anomaly})))');writeFileSync(join(output,'catalog.json'),JSON.stringify(creators,null,2));console.log(JSON.stringify(creators.filter(c=>/新闻|央视|人民|新华|乐队|琴|音乐|硅谷|原点|半调|温义飞|小涛|编程/.test(c.name)),null,2))
  }else if(action==='status'){
    const result=await evaluate(`(async()=>{const v=await window.signalDesk.getVideoLibrary(),cs=await window.signalDesk.listCreators();return {state:v.state,creators:cs.filter(c=>!c.isDemo).length,records:v.records.map(w=>({workId:w.workId,durationMs:w.durationMs,creator:cs.find(c=>c.profileUrl.endsWith(w.authorSecUid))?.nickname,creatorId:cs.find(c=>c.profileUrl.endsWith(w.authorSecUid))?.id}))}})()`)
    console.log(JSON.stringify(result,null,2))
  }else{
    if(!status.connection?.online||status.readiness?.phase!=='ready'||[status.phase,status.activity?.phase,status.basic?.phase,status.videoInformation?.phase].includes('running'))throw Error('APP not idle and ready')
    if(!Number.isSafeInteger(creatorId)||creatorId>=0)throw Error('Invalid creator')
    const before=await evaluate('window.signalDesk.getVideoLibrary()'),started=performance.now()
    const run=await evaluate(`window.signalDesk.collectVideoEvidence(${creatorId})`)
    let state
    const deadline=Date.now()+610000
    do{await new Promise(r=>setTimeout(r,1000));state=await evaluate('window.signalDesk.getVideoInformationStatus()');if(state.phase!=='running')break}while(Date.now()<deadline)
    const after=await evaluate('window.signalDesk.getVideoLibrary()')
    const report={...state,operatorStartToEvidenceMs:performance.now()-started,originalRecordsUnchanged:JSON.stringify(before.records)===JSON.stringify(after.records)}
    writeFileSync(join(output,run.runId+'-evidence.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report,null,2))
    if(state.phase!=='completed'||!report.originalRecordsUnchanged)process.exitCode=1
  }
}finally{ws.close()}
