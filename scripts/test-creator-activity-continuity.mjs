import test from 'node:test'
import assert from 'node:assert/strict'
import {readCreatorActivityPage,compareActivityContinuity} from '../browser-connector/following-extension/creator-activity-runner.js'
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

test('an initial baseline repair stops once ordered weekly coverage is established without needing an old anchor or reading the entire history',async()=>{
 const cursors=[]
 const result=await readCreatorActivityPage({...scope,repair:true,needsBaseline:true,comparisonBaseline:undefined,frontendCount:{count:1000}},
  {readPage:async cursor=>{cursors.push(cursor);return {root:{status_code:0,aweme_list:[row(2,'2026-10-09T01:00:00.000Z'),row(1,'2026-10-01T00:00:00.000Z')],has_more:1,max_cursor:100},
   sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest:false}}})
 assert.deepEqual(cursors,[0]);assert.equal(result.capture.errorCode,null);assert.equal(result.capture.pages[0].hasMore,true)
})
test('explicit repair reads across the calendar week boundary until the previous ordinary work and all 42 additions are recovered',async()=>{
 const {result,cursors}=await collect(true)
 assert.deepEqual(cursors,[0,18,36]);assert.equal(result.capture.pages.flatMap(p=>p.records).length,44);assert.equal(result.capture.errorCode,null)
})
test('disconnect during repair stops at that cursor and preserves partial source pages without a retry',async()=>{
 const {result,cursors}=await collect(true,18)
 assert.deepEqual(cursors,[0,18]);assert.equal(result.capture.errorCode,'DEBUGGER_NOT_ATTACHED');assert.equal(result.capture.pages.length,1)
})
test('browser stopping counts publications by (M,X], independently of pinned placement and unseen old IDs',()=>{
 const baseline={snapshotId:1,workCount:6,knownWorkIds:['old-pinned','latest'],timeBaseline:'2026-10-05T08:00:00.000Z',latest:{workId:'latest',publishedAt:'2026-10-05T08:00:00.000Z'},anchor:{workId:'latest',publishedAt:'2026-10-05T08:00:00.000Z'}}
 const pub=(workId,publishedAt,pinned=false)=>({workId,publishedAt,pinned,authorUid:'uid',authorSecUid:'sec',visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0}})
 const pages=[{hasMore:true,records:[pub('unseen-old','2026-08-02T08:00:00.000Z',true),pub('new-12','2026-10-12T08:00:00.000Z'),pub('new-10','2026-10-10T08:00:00.000Z',true),pub('new-8','2026-10-08T08:00:00.000Z'),pub('latest',baseline.timeBaseline),pub('future','2026-10-16T08:00:00.000Z')]}]
 assert.deepEqual(compareActivityContinuity(pages,baseline,9,{uid:'uid',secUid:'sec'},'2026-10-13T08:00:00.000Z'),{increase:3,newPublicWorks:3,connected:true})
})
test('ordinary refresh continues past the calendar-week boundary to cover the last publication time M',async()=>{
 const previous='2026-09-15T00:00:00.000Z'
 const records=[row(9,'2026-10-12T01:00:00.000Z'),row(8,'2026-10-02T01:00:00.000Z'),row(7,'2026-09-24T01:00:00.000Z'),row(6,previous),row(5,'2026-09-01T01:00:00.000Z')]
 const cursors=[]
 const result=await readCreatorActivityPage({...scope,weekStart:'2026-10-11T16:00:00.000Z',weekEndExclusive:'2026-10-18T16:00:00.000Z',repair:false,
  frontendCount:{count:7},comparisonBaseline:{snapshotId:1,workCount:4,knownWorkIds:['700000006'],timeBaseline:previous,latest:{workId:'700000006',publishedAt:previous},anchor:{workId:'700000006',publishedAt:previous}}},
  {readPage:async cursor=>{cursors.push(cursor);return {root:{status_code:0,aweme_list:records.slice(cursor,cursor+2),has_more:cursor+2<records.length,max_cursor:cursor+2},
   sourceProof:{kind:cursor?'active-get':'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest:cursor>0}}})
 assert.equal(result.ok,true);assert.deepEqual(cursors,[0,2]);assert.equal(result.capture.errorCode,null)
})
