import test from 'node:test'
import assert from 'node:assert/strict'
import {observeCreatorActivity,projectCreatorActivityResponse,classifyActivityVisibility} from '../browser-connector/following-extension/creator-activity-network.js'
const root={status_code:0,has_more:0,max_cursor:0,aweme_list:[]}
function fixture(body=JSON.stringify(root)){
  const listeners=new Set(),calls=[],target={tabId:2}
  const chrome={debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendCommand:async(_target,method)=>{calls.push(method);return {body}}}}
  const emit=(method,params,tabId=2)=>{for(const fn of listeners)fn({tabId},method,params)}
  const request=(id='one',sec='sec',cursor=0,tabId=2)=>{const url=`https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=${sec}&max_cursor=${cursor}`;emit('Network.requestWillBeSent',{requestId:id,request:{url,method:'GET'}},tabId);return url}
  const finish=(id,url,status=200)=>{emit('Network.responseReceived',{requestId:id,response:{url,status}});emit('Network.loadingFinished',{requestId:id,encodedDataLength:100})}
  return {chrome,calls,target,emit,request,finish,listeners}
}
test('attaches before navigation, reads only matching native JSON, and removes its listener',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec')
 f.finish('other',f.request('other','foreign'));f.request('wrong-tab','sec',0,3)
 f.finish('one',f.request())
 const page=await observer.page(0)
 assert.deepEqual(page.root,root);assert.equal(page.sourceProof.kind,'native-network');assert.equal(observer.nativeListRequests,1)
 assert.equal(await observer.page(100),null)
 await observer.stop();assert.equal(f.listeners.size,0);assert.deepEqual(f.calls,['Network.enable','Network.getResponseBody','Network.disable'])
})
test('rejected or non-JSON native responses are not retried as active GETs',async()=>{
 const f=fixture('<html>login</html>'),observer=await observeCreatorActivity(f.chrome,f.target,'sec')
 f.finish('one',f.request());assert.equal((await observer.page(0)).errorCode,'ACTIVITY_JSON_UNAVAILABLE');await observer.stop()
 const denied=fixture(),other=await observeCreatorActivity(denied.chrome,denied.target,'sec')
 denied.finish('one',denied.request(),403);assert.equal((await other.page(0)).errorCode,'ACTIVITY_HTTP_403');assert.equal(denied.calls.includes('Network.getResponseBody'),false);await other.stop()
})
test('missing or failed native first pages remain unavailable, and cancellation interrupts waiting',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec')
 assert.equal((await observer.page(0,{waitMs:0})).errorCode,'ACTIVITY_NATIVE_LIST_UNAVAILABLE')
 f.request();f.emit('Network.loadingFailed',{requestId:'one'})
 assert.equal((await observer.page(0)).errorCode,'ACTIVITY_NATIVE_LOAD_FAILED')
 await assert.rejects(observer.page(0,{active:async()=>{throw Error('cancelled')}}),/cancelled/);await observer.stop()
})
test('projection strips credentials, content, author profile and media URLs',()=>{
 const projected=projectCreatorActivityResponse({...root,cookie:'secret',aweme_list:[{aweme_id:'700000001',desc:'private text',video:{play_addr:'secret'},author:{uid:'u',sec_uid:'s',nickname:'name'},create_time:1,is_top:0,status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:68}]})
 assert.equal(JSON.stringify(projected).includes('secret'),false);assert.equal(projected.aweme_list[0].aweme_type,68)
})
test('web status rules exclude restricted, deleted, prohibited and temporary markers; unknown stays unknown',()=>{
 const observed={privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:68}
 assert.equal(classifyActivityVisibility(observed),'public')
 for(const status of [1,2,5,99])assert.equal(classifyActivityVisibility({...observed,privateStatus:status}),'restricted')
 assert.equal(classifyActivityVisibility({...observed,isDelete:true}),'deleted')
 assert.equal(classifyActivityVisibility({...observed,isProhibited:true}),'prohibited')
 assert.equal(classifyActivityVisibility({...observed,isStory:1}),'temporary-marker')
 assert.equal(classifyActivityVisibility({...observed,is24Story:1}),'temporary-marker')
 for(const change of [{privateStatus:null},{isStory:null},{is24Story:null},{allowShare:false}])assert.equal(classifyActivityVisibility({...observed,...change}),'unknown')
})
