import test from 'node:test'
import assert from 'node:assert/strict'
import {readCreatorActivityPage} from '../browser-connector/following-extension/creator-activity-runner.js'
const scope={runId:'run',secUid:'sec',uid:'uid',ownerSecUid:'owner',weekStart:'2026-10-04T16:00:00.000Z',weekEndExclusive:'2026-10-11T16:00:00.000Z',optimized:true,
 frontendCount:{count:680},comparisonBaseline:{snapshotId:1,workCount:638,knownWorkIds:['700000001','700000000'],anchor:{workId:'700000001',publishedAt:'2026-10-01T00:00:00.000Z'}}}
const row=(n,date,pinned=0)=>({aweme_id:String(700000000+n),author:{uid:'uid',sec_uid:'sec'},create_time:Date.parse(date)/1000,is_top:pinned,status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0})
const additions=Array.from({length:42},(_,i)=>row(43-i,new Date(Date.parse('2026-10-09T03:06:00Z')-i*4*3600000).toISOString()))
const records=[...additions,row(1,'2026-10-01T00:00:00.000Z'),row(0,'2026-09-29T00:00:00.000Z')]
async function collect(repair,failAt=null){
 const cursors=[]
 const result=await readCreatorActivityPage({...scope,repair},{readPage:async cursor=>{
  cursors.push(cursor)
  if(cursor===failAt)return {errorCode:'DEBUGGER_NOT_ATTACHED',activeRequest:false}
  return {root:{status_code:0,aweme_list:records.slice(cursor,cursor+18),has_more:1,max_cursor:cursor+18},
   sourceProof:{kind:cursor?'active-get':'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest:cursor>0}
 }})
 return {result,cursors}
}
test('large count growth stops ordinary collection after one page for separate review',async()=>{
 const {result,cursors}=await collect(false)
 assert.deepEqual(cursors,[0]);assert.equal(result.capture.pages[0].records.length,18);assert.equal(result.capture.errorCode,null)
})
test('explicit repair reads across the calendar week boundary until the previous ordinary work and all 42 additions are recovered',async()=>{
 const {result,cursors}=await collect(true)
 assert.deepEqual(cursors,[0,18,36]);assert.equal(result.capture.pages.flatMap(p=>p.records).length,44);assert.equal(result.capture.errorCode,null)
})
test('disconnect during repair stops at that cursor and preserves partial source pages without a retry',async()=>{
 const {result,cursors}=await collect(true,18)
 assert.deepEqual(cursors,[0,18]);assert.equal(result.capture.errorCode,'DEBUGGER_NOT_ATTACHED');assert.equal(result.capture.pages.length,1)
})
