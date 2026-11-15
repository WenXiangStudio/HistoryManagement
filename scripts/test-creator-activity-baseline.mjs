import test from 'node:test'
import assert from 'node:assert/strict'
import {readCreatorActivityPage} from '../browser-connector/following-extension/creator-activity-runner.js'
import {waitForCreatorRefresh} from '../browser-connector/following-extension/creator-activity-pacing.js'
const now=Date.parse('2026-10-14T04:00:00.000Z'),sizes=[28,28,28,28,28,27,27,27,27,27,27]

test('count-based collection crosses 180 days and stops only at sixty valid ordinary works or list end',async()=>{
 const requests=[],scope={uid:'uid',secUid:'sec',ownerSecUid:'owner',weekStart:'2026-10-11T16:00:00.000Z',weekEndExclusive:'2026-10-18T16:00:00.000Z',baselinePolicy:{version:2,limit:60}}
 const result=await readCreatorActivityPage(scope,{readPage:async cursor=>{
  requests.push(cursor)
  const rows=Array.from({length:20},(_,i)=>({aweme_id:String(710000000+cursor+i),author:{uid:'uid',sec_uid:'sec'},create_time:Math.floor((now-(400+cursor+i)*86400000)/1000),is_top:0,
   status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0}))
  return {activeRequest:true,root:{has_more:1,max_cursor:cursor+20,aweme_list:rows},sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()}}
 }})
 assert.deepEqual(requests,[0,20,40]);assert.equal(result.capture.errorCode,null);assert.equal(result.capture.pages.length,3)
})
test('trial bypasses weekly/unchanged stop, deduplicates public recent ordinary works and retains whole pages',async()=>{
 const requests=[],scope={uid:'uid',secUid:'sec',ownerSecUid:'owner',weekStart:'2026-10-11T16:00:00.000Z',weekEndExclusive:'2026-10-18T16:00:00.000Z',
  baseline:{workCount:100},frontendCount:{count:100},baselinePolicy:{limit:60,windowDays:180,windowStart:new Date(now-180*86400000).toISOString()}}
 const result=await readCreatorActivityPage(scope,{readPage:async cursor=>{
  requests.push(cursor);const rows=Array.from({length:20},(_,i)=>({aweme_id:String(700000000+cursor+i),author:{uid:'uid',sec_uid:'sec'},create_time:Math.floor((now-(cursor+i)*86400000)/1000),is_top:0,
   status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0}))
  return {activeRequest:true,root:{has_more:1,max_cursor:cursor+20,aweme_list:rows},sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()}}
 }})
 assert.deepEqual(requests,[0,20,40]);assert.equal(result.capture.errorCode,null);assert.equal(result.capture.pages.length,3)
})
test('eleven balanced batches wait 3–5 minutes at their ten boundaries and 5–10 seconds elsewhere',async()=>{
 const pacing={batchSize:28,batchSizes:sizes,startIndex:0,authorDelayMinMs:5000,authorDelayMaxMs:10000,batchDelayMinMs:180000,batchDelayMaxMs:300000}
 let batches=0,authors=0
 for(let i=1;i<302;i++){let time=0,wait
  await waitForCreatorRefresh(i,302,pacing,{now:()=>time,random:()=>0,active:async()=>{},delay:async ms=>{time+=ms},progress:async value=>{if(value)wait=value}})
  assert.equal(wait.totalBatches,11)
  if(wait.kind==='batch'){batches++;assert.equal(time,180000)}else {authors++;assert.equal(time,5000)}
 }
 assert.equal(batches,10);assert.equal(authors,291)
 // Resuming in batch six preserves the original boundary between authors 167 and 168.
 let time=0,wait
 await waitForCreatorRefresh(1,135,{...pacing,startIndex:166},{now:()=>time,random:()=>0,active:async()=>{},delay:async ms=>{time+=ms},progress:async value=>{if(value)wait=value}})
 assert.equal(wait.kind,'batch');assert.equal(wait.batchNumber,7)
})
