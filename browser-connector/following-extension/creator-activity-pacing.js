export function randomDelay(minimum,maximum,random=Math.random){
  const value=random()
  if(!Number.isFinite(value)||value<0||value>=1)throw Error('ACTIVITY_PACING_INVALID')
  return minimum+Math.floor(value*(maximum-minimum+1))
}

// Waits are broken into short, cancellable steps; only the local APP is polled.
export async function waitForCreatorRefresh(index,total,pacing,{active,progress,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,random=Math.random}={}){
  if(!pacing||index===0)return
  const position=index+(pacing.startIndex||0),sizes=pacing.batchSizes
  let batchNumber=Math.floor(position/pacing.batchSize)+1,batch=position%pacing.batchSize===0
  if(sizes){let start=0;batchNumber=sizes.length;for(let i=0;i<sizes.length;i++){if(position<start+sizes[i]){batchNumber=i+1;batch=position===start;break}start+=sizes[i]}}
  const durationMs=randomDelay(batch?pacing.batchDelayMinMs:pacing.authorDelayMinMs,batch?pacing.batchDelayMaxMs:pacing.authorDelayMaxMs,random)
  const until=now()+durationMs
  const wait={kind:batch?'batch':'author',until:new Date(until).toISOString(),durationMs,
    batchNumber,totalBatches:sizes?.length??Math.ceil(total/pacing.batchSize)}
  await active();await progress(wait)
  while(now()<until){await active();await delay(Math.min(1000,until-now()))}
  await active();await progress(null)
}

export async function finishInterruptedWait(until,total,pacing,{active,progress,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}={}){
  if(!until||!pacing||Date.parse(until)<=now())return
  const deadline=Date.parse(until),durationMs=Math.max(0,deadline-now())
  if(!Number.isFinite(deadline)||durationMs>pacing.batchDelayMaxMs)throw Error('ACTIVITY_PACING_INVALID')
  await active();await progress({kind:'resume',until,durationMs,batchNumber:1,totalBatches:pacing.batchSizes?.length??Math.ceil(total/pacing.batchSize)})
  while(now()<deadline){await active();await delay(Math.min(1000,deadline-now()))}
  await active();await progress(null)
}
