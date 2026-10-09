import test from 'node:test'
import assert from 'node:assert/strict'
import {randomDelay,waitForCreatorRefresh,finishInterruptedWait} from '../browser-connector/following-extension/creator-activity-pacing.js'
const pacing={batchSize:33,authorDelayMinMs:3000,authorDelayMaxMs:8000,batchDelayMinMs:180000,batchDelayMaxMs:300000}
test('randomized waits have hard bounds and use batch pauses only between batches',async()=>{
  assert.equal(randomDelay(3000,8000,()=>0),3000)
  assert.equal(randomDelay(3000,8000,()=>0.999999),8000)
  for(const index of [0,1,32,33,66,294]){
    let now=0,checks=0;const progress=[],steps=[]
    await waitForCreatorRefresh(index,295,pacing,{now:()=>now,random:()=>0,active:async()=>{checks++},progress:async value=>progress.push(value),delay:async ms=>{steps.push(ms);now+=ms}})
    if(index===0){assert.equal(progress.length,0);continue}
    const batch=index%33===0
    assert.equal(progress[0].kind,batch?'batch':'author');assert.equal(now,batch?180000:3000)
    assert.equal(progress[0].totalBatches,9);assert.equal(progress[0].batchNumber,Math.floor(index/33)+1)
    assert.equal(progress.at(-1),null);assert.ok(steps.every(ms=>ms<=1000));assert.ok(checks>1)
  }
})
test('cancellation interrupts a five-minute pause before another author starts',async()=>{
  let now=0;const progress=[]
  await assert.rejects(waitForCreatorRefresh(33,295,pacing,{now:()=>now,random:()=>0.999999,active:async()=>{if(now>=2000)throw Error('ACTIVITY_SESSION_ENDED')},progress:async value=>progress.push(value),delay:async ms=>{now+=ms}}),/ACTIVITY_SESSION_ENDED/)
  assert.equal(now,2000);assert.equal(progress.length,1)
})
test('resume finishes the outstanding pause before any browser navigation',async()=>{
  let now=0;const progress=[]
  await finishInterruptedWait(new Date(120000).toISOString(),262,pacing,{now:()=>now,active:async()=>{},progress:async value=>progress.push(value),delay:async ms=>{assert.ok(ms<=1000);now+=ms}})
  assert.equal(now,120000);assert.equal(progress[0].kind,'resume');assert.equal(progress.at(-1),null)
})
