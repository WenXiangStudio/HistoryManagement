// Read-only UI verification. Renderer clock replay does not change Windows time or persisted data.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const output=resolve(process.argv[2]||'local-data/creator-zones-20261004')
mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);pending.get(message.id)?.(message);pending.delete(message.id)})
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const requestId=++id,timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('UI verification timed out'))},10000)
  pending.set(requestId,message=>{clearTimeout(timeout);message.error||message.result?.exceptionDetails?reject(new Error(JSON.stringify(message.error||message.result.exceptionDetails))):resolve(message.result)})
  socket.send(JSON.stringify({id:requestId,method,params}))
})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const shot=async name=>{const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,name),Buffer.from(result.data,'base64'))}
const dateKey=time=>new Date(time+8*3_600_000).toISOString().slice(0,10)
const expected=(rows,at)=>{
  const local=new Date(at+8*3_600_000),start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-((local.getUTCDay()+6)%7)*86_400_000-8*3_600_000
  const result={today:[],week:[],none:[]}
  for(const row of rows){
    const a=row.activity,published=Date.parse(a?.latestPublishedAt)
    let key='none'
    if(a&&Date.parse(a.weekStart)===start&&Date.parse(a.weekEndExclusive)===start+7*86_400_000&&Number.isFinite(published)&&published>=start&&published<start+7*86_400_000&&published<=at){
      if(dateKey(published)===dateKey(at))key='today'
      else if(a.weeklyUpdateCount>=1)key='week'
    }
    result[key].push(row.id)
  }
  return result
}
const inspect=async()=>evaluate(`(()=>{
  const result={at:Date.now(),zones:{},counts:{},headings:{}}
  for(const key of ['today','week','none']){
    const zone=document.querySelector('[data-testid="creator-zone-'+key+'"]')
    if(!zone)throw new Error('Missing section '+key)
    result.zones[key]=[...zone.querySelectorAll('.creator-card')].map(card=>Number(card.dataset.creatorId))
    result.counts[key]=zone.querySelector('[data-testid="creator-zone-'+key+'-count"]').textContent
    result.headings[key]=zone.querySelector('h2').textContent
  }
  const cards=[...document.querySelectorAll('.creator-card')],workspace=document.querySelector('.workspace')
  result.total=cards.length;result.unique=new Set(cards.map(card=>card.dataset.creatorId)).size
  result.noHorizontalOverflow=workspace.scrollWidth<=workspace.clientWidth
  result.noBiographyOverlap=cards.every(card=>card.querySelector('.creator-biography').getBoundingClientRect().bottom<=card.querySelector('.creator-profile-link').getBoundingClientRect().top+.5)
  result.analyzedPreserved=cards.every(card=>card.querySelector('[data-testid="creator-analyzed-count"]').textContent==='—')
  return result
})()`)
const verify=(view,rows)=>{
  assert.deepEqual(view.zones,expected(rows,view.at))
  assert.equal(view.total,rows.length);assert.equal(view.unique,rows.length)
  assert.ok(view.noHorizontalOverflow);assert.ok(view.noBiographyOverlap);assert.ok(view.analyzedPreserved)
  for(const key of ['today','week','none'])assert.equal(view.counts[key],`${view.zones[key].length} 位`)
}
const summarize=view=>({...view,zones:undefined,counts:Object.fromEntries(Object.entries(view.zones).map(([key,ids])=>[key,ids.length]))})
try{
  await evaluate(`[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('博主资料库')).click()`)
  await evaluate('document.fonts.ready.then(()=>true)');await frames()
  const source=await evaluate('window.signalDesk.listCreators()')
  const normal=await inspect();verify(normal,source)
  await evaluate("document.querySelector('.workspace').scrollTop=0");await frames();await shot('sections-current.png')
  for(const key of ['week','none']){
    await evaluate(`document.querySelector('[data-testid="creator-zone-${key}"]').scrollIntoView({block:'start'})`)
    await frames();await shot(`section-${key}.png`)
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false})
  await frames();const compact=await inspect();verify(compact,source)
  await evaluate("document.querySelector('.workspace').scrollTop=0");await frames();await shot('sections-compact.png')
  await send('Emulation.clearDeviceMetricsOverride');await frames()

  // Start shortly before midnight, then let the product's real boundary timer move the cards.
  const nextMidnight=Date.parse('2026-10-03T16:00:00.000Z')
  await evaluate(`(()=>{window.__creatorZoneRealNow=Date.now;window.__creatorZoneClockOffset=${nextMidnight}-1500-Date.now();Date.now=()=>window.__creatorZoneRealNow()+window.__creatorZoneClockOffset;window.dispatchEvent(new Event('focus'));return true})()`)
  await frames();const beforeMidnight=await inspect();verify(beforeMidnight,source)
  assert.ok(beforeMidnight.zones.today.length>0,'Saved fixture must have Oct 3 updates')
  await evaluate("document.querySelector('.workspace').scrollTop=0");await frames();await shot('sections-replay-oct3.png')
  await wait(1700);await frames();const afterMidnight=await inspect();verify(afterMidnight,source)
  assert.equal(afterMidnight.zones.today.length,0)
  assert.deepEqual(new Set(afterMidnight.zones.week),new Set([...beforeMidnight.zones.today,...beforeMidnight.zones.week]))

  // The next Monday must show all old-week records as pending, with public totals retained.
  await evaluate(`(()=>{window.__creatorZoneClockOffset=Date.parse('2026-10-04T16:00:00.000Z')-window.__creatorZoneRealNow();window.dispatchEvent(new Event('focus'));return true})()`)
  await frames();const nextWeek=await inspect();verify(nextWeek,source)
  assert.equal(nextWeek.zones.none.length,source.length)
  const rollover=await evaluate(`(()=>{const cards=[...document.querySelectorAll('.creator-card')];return {
    allPending:cards.every(card=>card.querySelector('[data-testid="creator-weekly-count"]').textContent==='本周更新待检查'),
    newPeriod:cards.every(card=>card.querySelector('.creator-weekly-activity>small').textContent==='本周记录周期：10.05～10.11'),
    publicTotals:cards.map(card=>({id:Number(card.dataset.creatorId),count:card.querySelector('[data-testid="creator-public-work-count"]').textContent}))
  }})()`)
  assert.ok(rollover.allPending);assert.ok(rollover.newPeriod)
  assert.ok(rollover.publicTotals.every(item=>String(source.find(row=>row.id===item.id).activity.workCount)===item.count))
  await evaluate("document.querySelector('.workspace').scrollTop=0");await frames();await shot('sections-replay-next-week.png')

  await evaluate("Date.now=window.__creatorZoneRealNow;delete window.__creatorZoneRealNow;delete window.__creatorZoneClockOffset;window.dispatchEvent(new Event('focus'))")
  await frames()
  // Searching changes only the shown groups; clearing it restores all saved cards.
  const searchName=source.find(row=>row.nickname.includes('爱学习的乔同学'))?.nickname||source[0].nickname
  await evaluate(`(()=>{const input=document.querySelector('.toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(searchName)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  let filtered=[]
  for(let attempts=0;attempts<20;attempts++){
    await wait(100);filtered=await evaluate(`window.signalDesk.listCreators(${JSON.stringify(searchName)})`)
    const state=await inspect()
    if(state.total===filtered.length){verify(state,filtered);break}
    if(attempts===19)throw new Error('Filtered cards did not settle')
  }
  await evaluate("(()=>{const input=document.querySelector('.toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  for(let attempts=0;attempts<20;attempts++){await wait(100);const state=await inspect();if(state.total===source.length){verify(state,source);break}if(attempts===19)throw new Error('Saved cards not restored after clearing search')}
  await evaluate("document.querySelector('.workspace').scrollTop=0");await frames()
  const result={recordedAt:new Date().toISOString(),normal:summarize(normal),compact:summarize(compact),
    midnight:{before:summarize(beforeMidnight),after:summarize(afterMidnight),automaticTimerPassed:true},
    rollover:{view:summarize(nextWeek),allPending:rollover.allPending,newPeriod:rollover.newPeriod,publicTotalsRetained:true},
    search:{matched:filtered.length,restored:source.length},newCollectionStarted:false,rendererClockRestored:true}
  writeFileSync(join(output,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{
  await evaluate("if(window.__creatorZoneRealNow){Date.now=window.__creatorZoneRealNow;delete window.__creatorZoneRealNow;delete window.__creatorZoneClockOffset;window.dispatchEvent(new Event('focus'))}").catch(()=>{})
  await send('Emulation.clearDeviceMetricsOverride').catch(()=>{})
  socket.close()
}
