import test from 'node:test'
import assert from 'node:assert/strict'
import {observeCreatorActivity,projectCreatorActivityResponse,classifyActivityVisibility,NATIVE_LIST_LIMITS} from '../browser-connector/following-extension/creator-activity-network.js'
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
 f.finish('one',f.request());assert.equal((await observer.page(0)).errorCode,'ACTIVITY_JSON_UNAVAILABLE')
 assert.equal(observer.snapshot().requests[0].failureStage,'json');assert.equal(observer.snapshot().requests[0].bodyError,null);await observer.stop()
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

test('a late first request is awaited within a bounded window and its body is preserved before the count decision',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec',{lazy:true});let clock=0
 const value=await observer.availablePage(0,{now:()=>clock,delay:async ms=>{clock+=ms;if(clock===300)f.finish('one',f.request())}})
 assert.ok(value.root);assert.equal(f.calls.filter(c=>c==='Network.getResponseBody').length,1)
 assert.equal(observer.snapshot().availability.outcome,'ready');assert.ok(observer.snapshot().availability.waitedMs>=300)
 assert.equal(observer.snapshot().requests[0].stage,'projected');await observer.stop()
})

test('the native first page body is read on arrival while later pages stay lazy',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec',{lazy:true})
 f.finish('one',f.request());f.finish('later',f.request('later','sec',100))
 await Promise.resolve();await Promise.resolve()
 assert.equal(f.calls.filter(c=>c==='Network.getResponseBody').length,1)
 assert.ok((await observer.availablePage(0)).root)
 assert.equal(f.calls.filter(c=>c==='Network.getResponseBody').length,1);await observer.stop()
})

test('no request and a pending request are different outcomes and cancellation checks run during native waiting',async()=>{
 for(const pending of [false,true]){
   const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec',{lazy:true});let clock=0,calls=0
   if(pending)f.request()
   const value=await observer.availablePage(0,{now:()=>clock,active:async()=>{calls++},delay:async ms=>{clock+=ms}})
   assert.equal(value.errorCode,pending?'ACTIVITY_NATIVE_PENDING':'ACTIVITY_NATIVE_LIST_UNAVAILABLE')
   assert.equal(clock,pending?1500:600);assert.ok(calls>1);assert.equal(f.calls.includes('Network.getResponseBody'),false)
   await observer.stop()
 }
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec');let reads=0
 await assert.rejects(observer.availablePage(0,{active:async()=>{if(++reads>1)throw Error('ACTIVITY_SESSION_ENDED')},delay:async()=>{}}),/ACTIVITY_SESSION_ENDED/)
 await observer.stop()
})

test('Chrome body-cache failures retain their exact category without request content, URLs or raw errors',async()=>{
 for(const [message,code] of [['Request content was evicted from inspector cache: secret','ACTIVITY_NATIVE_BODY_EVICTED'],['No resource with given identifier found: secret','ACTIVITY_NATIVE_BODY_NOT_RETAINED'],['Not attached to this target: secret','DEBUGGER_NOT_ATTACHED']]){
   const f=fixture(),send=f.chrome.debugger.sendCommand
   f.chrome.debugger.sendCommand=async(target,method,params)=>{if(method==='Network.getResponseBody')throw Error(message);return send(target,method,params)}
   const observer=await observeCreatorActivity(f.chrome,f.target,'sec',{lazy:true});f.finish('one',f.request())
   const result=await observer.availablePage(0);assert.equal(result.errorCode,code)
   const record=observer.snapshot().requests[0];assert.ok(record.bodyError);assert.equal(record.errorCode,code)
   assert.equal(JSON.stringify(observer.snapshot()).includes('secret'),false);assert.equal(JSON.stringify(observer.snapshot()).includes('https://'),false)
   assert.equal(f.calls.filter(c=>c==='Network.getResponseBody').length,0);await observer.stop()
 }
})

test('an access rejection discovered while waiting stops immediately, without another request or body read',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec');let clock=0
 const value=await observer.availablePage(0,{now:()=>clock,delay:async ms=>{clock+=ms;if(clock===200)f.finish('one',f.request(),429)}})
 assert.equal(value.errorCode,'ACTIVITY_HTTP_429');assert.equal(clock,200);assert.equal(f.calls.includes('Network.getResponseBody'),false)
 await observer.stop()
})

test('body capacity is measured in decoded UTF-8 bytes and request diagnostics remain bounded',async()=>{
 const body=JSON.stringify({...root,padding:'汉'.repeat(3*1024*1024)}),f=fixture(body),observer=await observeCreatorActivity(f.chrome,f.target,'sec')
 f.finish('one',f.request());assert.equal((await observer.availablePage(0)).errorCode,'ACTIVITY_BODY_TOO_LARGE')
 assert.ok(observer.snapshot().requests[0].decodedBytes>NATIVE_LIST_LIMITS.resourceBytes);assert.equal(observer.fatalError,null)
 for(let i=0;i<40;i++)f.request('more-'+i,'sec',i+1)
 assert.equal(observer.snapshot().requests.length,24);assert.equal(observer.fatalError,'ACTIVITY_NATIVE_REQUEST_LIMIT');assert.ok(observer.snapshot().dropped>0)
 await observer.stop()
})

test('ignored requests explain author, method, cursor and child-session mismatches without retaining identities',async()=>{
 const f=fixture(),observer=await observeCreatorActivity(f.chrome,f.target,'sec')
 f.request('other','secret');f.emit('Network.requestWillBeSent',{requestId:'method',request:{url:f.request('url-only','secret'),method:'POST'}})
 const base='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=sec'
 f.emit('Network.requestWillBeSent',{requestId:'cursor',request:{url:base,method:'GET'}})
 for(const fn of f.listeners)fn({tabId:2,sessionId:'secret'},'Network.requestWillBeSent',{requestId:'child',request:{url:base+'&max_cursor=0',method:'GET'}})
 assert.deepEqual(observer.snapshot().ignored,{author:2,method:1,cursor:1,childSession:1})
 assert.equal(JSON.stringify(observer.snapshot()).includes('secret'),false);await observer.stop()
})
