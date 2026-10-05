// Read-only product UI validation, with expand/collapse interaction; never starts collection.
import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const output=resolve(process.argv[2]||'local-data/creator-card-layout-20261004')
mkdirSync(output,{recursive:true})
const page=(await fetch('http://127.0.0.1:9227/json').then(r=>r.json())).find(p=>p.type==='page'&&p.title==='Signal Desk')
if(!page)throw new Error('Review APP unavailable')
const socket=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let id=0;const pending=new Map()
socket.addEventListener('message',event=>{const result=JSON.parse(event.data);pending.get(result.id)?.(result);pending.delete(result.id)})
const send=(method,params)=>new Promise((resolve,reject)=>{const requestId=++id,timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('APP verification timed out'))},10000);pending.set(requestId,result=>{clearTimeout(timeout);result.error||result.result?.exceptionDetails?reject(new Error(JSON.stringify(result.error||result.result.exceptionDetails))):resolve(result.result)});socket.send(JSON.stringify({id:requestId,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
const screenshot=async name=>{const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,name),Buffer.from(result.data,'base64'))}
try{
  await evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('博主资料库')).click()`)
  await evaluate('document.fonts.ready.then(()=>true)');await frames()
  const source=JSON.parse(await evaluate('window.signalDesk.listCreators().then(rows=>JSON.stringify(rows))'))
  const checkCollapsed=async()=>JSON.parse(await evaluate(`(()=>{
    const cards=[...document.querySelectorAll('.creator-card')];let overlapping=0,overThreeLines=0,badLinks=0
    for(const card of cards){const bio=card.querySelector('.creator-biography'),text=bio.querySelector('p'),link=card.querySelector('.creator-profile-link'),style=getComputedStyle(text)
      if(bio.getBoundingClientRect().bottom>link.getBoundingClientRect().top+.5)overlapping++
      if(text.getBoundingClientRect().height>parseFloat(style.lineHeight)*3+1)overThreeLines++
      if(link.getAttribute('href')!==link.title||link.querySelector('span').textContent!==link.title)badLinks++
    }
    const workspace=document.querySelector('.workspace')
    return JSON.stringify({cardCount:cards.length,overlapping,overThreeLines,badLinks,expandable:document.querySelectorAll('.creator-biography-toggle').length,noHorizontalOverflow:workspace.scrollWidth<=workspace.clientWidth})
  })()`))
  const normal=await checkCollapsed()
  const inspect=async(name,file)=>{
    const key=JSON.stringify(name)
    const found=await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('h3').textContent.includes(${key}));if(!card)return false;card.scrollIntoView({block:'center'});return true})()`)
    if(!found)throw new Error('Missing saved author '+name)
    await frames();await screenshot(file)
    return JSON.parse(await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('h3').textContent.includes(${key}));return JSON.stringify({name:card.querySelector('h3').textContent,summary:card.querySelector('.creator-weekly-activity').textContent,weeklyCount:card.querySelector('[data-testid="creator-weekly-count"]').textContent,expandable:!!card.querySelector('.creator-biography-toggle'),previewHeight:card.querySelector('.creator-biography p').getBoundingClientRect().height})})()`))
  }
  const examples=[]
  examples.push(await inspect('爱学习的乔同学','weekly-counts.png'))
  examples.push(await inspect('圈圈包子','biography-collapsed.png'))
  const longName='圈圈包子'
  await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('h3').textContent.includes(${JSON.stringify(longName)}));card.querySelector('.creator-biography-toggle').click()})()`);await frames()
  const expanded=JSON.parse(await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('h3').textContent.includes(${JSON.stringify(longName)})),bubble=card.querySelector('.creator-biography'),link=card.querySelector('.creator-profile-link'),style=getComputedStyle(bubble),text=bubble.querySelector('p');return JSON.stringify({name:card.querySelector('h3').textContent,expanded:card.querySelector('.creator-biography-toggle').getAttribute('aria-expanded')==='true',background:style.backgroundColor,opacity:style.opacity,inNormalFlow:style.position==='relative',noLinkOverlap:bubble.getBoundingClientRect().bottom<=link.getBoundingClientRect().top,fullText:text.textContent,bubbleHeight:bubble.getBoundingClientRect().height})})()`))
  const full=source.find(c=>c.nickname===expanded.name)?.signature
  if(expanded.fullText!==full||!expanded.expanded||expanded.background!=='rgb(255, 255, 255)'||expanded.opacity!=='1'||!expanded.inNormalFlow||!expanded.noLinkOverlap)throw new Error('Opaque biography expansion failed')
  await screenshot('biography-expanded.png')
  await evaluate(`(()=>{const card=[...document.querySelectorAll('.creator-card')].find(c=>c.querySelector('h3').textContent.includes(${JSON.stringify(longName)}));card.querySelector('.creator-biography-toggle').click()})()`);await frames()
  examples.push(await inspect('林文冠AI','biography-other-card.png'))
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:720,deviceScaleFactor:1,mobile:false});await frames()
  const compact=await checkCollapsed();await screenshot('compact-layout.png');await send('Emulation.clearDeviceMetricsOverride',{});await frames()
  const linksAndCounts=JSON.parse(await evaluate(`(async()=>{const rows=await window.signalDesk.listCreators(),cards=[...document.querySelectorAll('.creator-card')];return JSON.stringify({creators:rows.length,countsKnown:rows.filter(c=>c.activity?.weeklyUpdateCount!==null).length,
    allCountsMatch:cards.every(card=>{const url=card.querySelector('.creator-profile-link').getAttribute('href'),row=rows.find(r=>r.profileUrl===url);return card.querySelector('[data-testid="creator-weekly-count"]').textContent===String(row.activity.weeklyUpdateCount)}),
    allPeriodLabels:cards.every(c=>c.querySelector('.creator-weekly-activity>small').textContent==='本周记录周期：09.28～10.04'),
    allAnalyzedPlaceholders:cards.every(c=>c.querySelector('[data-testid="creator-analyzed-count"]').textContent==='—')})})()`))
  if([normal,compact].some(v=>v.cardCount!==source.length||v.overlapping||v.overThreeLines||v.badLinks||!v.noHorizontalOverflow)||!linksAndCounts.allCountsMatch||!linksAndCounts.allPeriodLabels)throw new Error('Card format verification failed')
  const result={recordedAt:new Date().toISOString(),normal,compact,expanded:{...expanded,fullText:undefined,fullTextMatchesSaved:true},linksAndCounts,examples,newCollectionStarted:false}
  writeFileSync(join(output,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{socket.close()}
