import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const factory = runInNewContext(readFileSync(new URL('../browser-connector/following-extension/following-timing.js',import.meta.url),'utf8') + '\ncreateFollowingBatchTimer', { structuredClone })
function timerFixture(count) {
  let current = 0
  let wall = '2026-10-01T00:00:00.000Z'
  const timer = factory(count,{now:()=>current,wallNow:()=>wall})
  return {timer,advance:ms=>{current+=ms},setWall:value=>{wall=value}}
}
test('20 authors include discovery overhead in the total and batch average',()=>{
  const fixture=timerFixture(20)
  fixture.advance(400)
  for(let index=0;index<20;index++){
    fixture.timer.beginCreator(`sec-${index}`,`博主${index}`)
    fixture.advance(30+index)
    fixture.timer.finishCreator()
  }
  fixture.advance(10)
  const timing=fixture.timer.finish()
  assert.equal(timing.successfulCount,20)
  assert.equal(timing.totalMs,1200)
  assert.equal(timing.averageMsPerCreator,60)
  assert.equal(timing.authorProcessingMs,790)
  assert.equal(timing.sharedOverheadMs,410)
  assert.equal(timing.records[0].elapsedMs,30)
  assert.equal(timing.records[19].elapsedMs,49)
})
test('wall clock changes do not alter measured elapsed time',()=>{
  const fixture=timerFixture(1)
  fixture.advance(50)
  fixture.timer.beginCreator('sec-a','博主A')
  fixture.setWall('2026-09-01T00:00:00.000Z')
  fixture.advance(25)
  fixture.timer.finishCreator()
  assert.equal(fixture.timer.finish().totalMs,75)
})
test('failure records the interrupted author and uses successful count for average',()=>{
  const fixture=timerFixture(2)
  fixture.timer.beginCreator('sec-a','博主A');fixture.advance(20);fixture.timer.finishCreator()
  fixture.timer.beginCreator('sec-b','博主B');fixture.advance(30)
  const timing=fixture.timer.finish('failed')
  assert.equal(timing.successfulCount,1)
  assert.equal(timing.totalMs,50)
  assert.equal(timing.averageMsPerCreator,50)
  assert.equal(timing.records[1].success,false)
  assert.equal(timing.records[1].elapsedMs,30)
})
test('duplicate authors and incomplete success cannot inflate throughput',()=>{
  const fixture=timerFixture(2)
  fixture.timer.beginCreator('sec-a','博主A');fixture.advance(5);fixture.timer.finishCreator()
  assert.throws(()=>fixture.timer.beginCreator('sec-a','重名'),/Duplicate/)
  assert.throws(()=>fixture.timer.finish(),/requested scope/)
  const timing=fixture.timer.finish('failed')
  assert.equal(timing.successfulCount,1)
})
test('empty failure has no average and final results cannot be mutated',()=>{
  const fixture=timerFixture(1)
  fixture.advance(10)
  const failed=fixture.timer.finish('failed')
  assert.equal(failed.averageMsPerCreator,null)
  failed.totalMs=999
  assert.equal(fixture.timer.finish('failed').totalMs,10)
  assert.throws(()=>fixture.timer.beginCreator('sec-a','博主A'),/session/)
})
