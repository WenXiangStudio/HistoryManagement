import test from 'node:test'
import assert from 'node:assert/strict'
import {observeCreatorActivityOwner,projectCreatorActivityOwner} from '../browser-connector/following-extension/creator-activity-owner-network.js'
const scope={runId:'run',ownerSecUid:'owner',ownerUid:'owner-uid',firstAuthorSecUid:'author'}
const owner={status_code:0,user:{uid:'owner-uid',sec_uid:'owner'}}
function fixture(body=JSON.stringify(owner),bodyError=false){
  const listeners=new Set(),calls=[],target={tabId:2}
  const chrome={debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendCommand:async(_target,method)=>{calls.push(method);if(bodyError)throw Error('body reclaimed');return {body}}}}
  const emit=(method,params,tabId=2,sessionId)=>{for(const fn of listeners)fn({tabId,...(sessionId?{sessionId}:{})},method,params)}
  const request=({id='one',path='/aweme/v1/web/user/profile/self/',method='GET',tabId=2,loaderId='loader',frameId='frame',documentURL='https://www.douyin.com/user/author',sessionId}={})=>{
    const url='https://www.douyin.com'+path+'?cookie=never-retained'
    emit('Network.requestWillBeSent',{requestId:id,loaderId,frameId,documentURL,type:'XHR',request:{url,method}},tabId,sessionId);return url
  }
  const finish=(id,url,status=200)=>{emit('Network.responseReceived',{requestId:id,response:{url,status}});emit('Network.loadingFinished',{requestId:id,encodedDataLength:100})}
  const observer=observeCreatorActivityOwner(chrome,target,scope)
  const commit=(loaderId='loader',frameId='frame')=>emit('Page.frameNavigated',{frame:{id:frameId,loaderId,url:'https://www.douyin.com/user/author'}})
  const bind=value=>{observer.bindNavigation(value);commit(value.loaderId,value.frameId)}
  return {chrome,target,calls,emit,request,finish,observer,listeners,bind,commit}
}
test('only the fresh GET from this tab and navigation produces whitelisted owner proof',async()=>{
  const f=fixture(JSON.stringify({...owner,cookie:'secret',authorization:'secret',user:{...owner.user,nickname:'not-required'}}))
  f.finish('old',f.request({id:'old'}))
  const started=f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'})
  f.request({id:'other-tab',tabId:3});f.request({id:'wrong-method',method:'POST'});f.request({id:'other-path',path:'/aweme/v1/web/user/profile/other/'})
  f.finish('one',f.request())
  const result=await f.observer.result()
  assert.deepEqual(result.proof,{contract:'signaldesk-activity-owner/v1',kind:'native-network',runId:'run',uid:'owner-uid',secUid:'owner',endpoint:'/aweme/v1/web/user/profile/self/',
    method:'GET',httpStatus:200,observedAt:result.proof.observedAt,navigationStartedAt:started,firstAuthorSecUid:'author',tabId:2})
  assert.equal(f.observer.observedRequests,1);assert.equal(JSON.stringify(result).includes('secret'),false)
  assert.deepEqual(f.calls,['Network.getResponseBody']);f.observer.stop();assert.equal(f.listeners.size,0)
})
test('no observed request yields fallback permission without delay; a late event cannot revive this observer',async()=>{
  const f=fixture();f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'});assert.equal(await f.observer.result({waitMs:0}),null)
  f.finish('late',f.request({id:'late'}));assert.equal(f.observer.observedRequests,0);assert.equal(f.calls.length,0)
  assert.equal(f.listeners.size,0)
})
test('HTTP rejection, non-JSON, missing identity and UID mismatch are errors, never fallback permission',async()=>{
  for(const [body,status,code] of [[JSON.stringify(owner),403,'ACTIVITY_HTTP_403'],[JSON.stringify(owner),429,'ACTIVITY_HTTP_429'],['<html>',200,'ACTIVITY_JSON_UNAVAILABLE'],
    [JSON.stringify({status_code:0,user:null}),200,'LOGIN_REQUIRED'],[JSON.stringify({status_code:0,user:{uid:'wrong',sec_uid:'owner'}}),200,'OWNER_IDENTITY_MISMATCH'],
    [JSON.stringify({status_code:0,user:{sec_uid:'owner'}}),200,'ACCOUNT_IDENTITY_UNAVAILABLE']]){
    const f=fixture(body);f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'});f.finish('one',f.request(),status)
    assert.equal((await f.observer.result()).errorCode,code);f.observer.stop();assert.equal(f.listeners.size,0)
  }
})
test('an observed pending or reclaimed body, failed load, redirect and wrong navigation cannot trigger active fallback',async()=>{
  const pending=fixture();pending.observer.beginNavigation();pending.bind({loaderId:'loader',frameId:'frame'});pending.request()
  assert.equal((await pending.observer.result({waitMs:0})).errorCode,'ACCOUNT_NATIVE_BODY_UNAVAILABLE');pending.observer.stop()
  const reclaimed=fixture(JSON.stringify(owner),true);reclaimed.observer.beginNavigation();reclaimed.bind({loaderId:'loader',frameId:'frame'});reclaimed.finish('one',reclaimed.request())
  assert.equal((await reclaimed.observer.result()).errorCode,'ACCOUNT_NATIVE_BODY_UNAVAILABLE');reclaimed.observer.stop()
  const failed=fixture();failed.observer.beginNavigation();failed.bind({loaderId:'loader',frameId:'frame'});failed.request();failed.emit('Network.loadingFailed',{requestId:'one'})
  assert.equal((await failed.observer.result()).errorCode,'ACCOUNT_NATIVE_LOAD_FAILED');failed.observer.stop()
  const redirect=fixture();redirect.observer.beginNavigation();redirect.bind({loaderId:'loader',frameId:'frame'});redirect.request();redirect.request()
  assert.equal((await redirect.observer.result()).errorCode,'ACCOUNT_NATIVE_REDIRECT');redirect.observer.stop()
  const stale=fixture();stale.observer.beginNavigation();stale.bind({loaderId:'new',frameId:'frame'});stale.finish('one',stale.request())
  assert.equal((await stale.observer.result()).errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH');stale.observer.stop()
})
test('cancellation interrupts body waiting and stop removes callbacks; incompatible duplicate identities cannot be accepted',async()=>{
  const f=fixture();f.observer.beginNavigation();f.request()
  await assert.rejects(f.observer.result({active:async()=>{throw Error('CANCELLED')}}),/CANCELLED/)
  f.observer.stop();assert.equal(f.listeners.size,0)
  assert.throws(()=>projectCreatorActivityOwner({data:{status_code:0,user:{uid:'owner-uid',sec_uid:'other'}}},scope),/OWNER_IDENTITY_MISMATCH/)
})
test('diagnostics distinguish missing and different loader/frame, even when HTTP, JSON and account IDs pass',async()=>{
  for(const [fields,loader,frame] of [
    [{loaderId:'other'},'different','match'],[{frameId:'other'},'match','different'],
    [{loaderId:''},'request-missing','match'],[{frameId:''},'match','request-missing']
  ]){
    const f=fixture();f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'})
    f.finish('one',f.request(fields));await Promise.resolve()
    assert.equal((await f.observer.result()).errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH')
    const diagnostics=f.observer.diagnostics(),request=diagnostics.requests[0]
    assert.equal(request.loader,loader);assert.equal(request.frame,frame);assert.equal(request.currentLoader,loader);assert.equal(request.currentFrame,frame)
    assert.equal(request.httpStatus,200);assert.equal(request.json,'valid');assert.equal(request.identity,'matched')
    assert.equal(diagnostics.errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH')
    assert.equal(JSON.stringify(diagnostics).includes('cookie'),false);f.observer.stop()
  }
})
test('a committed same-frame document transition can authorize the matching current loader without an extra owner GET',async()=>{
  const f=fixture();f.observer.beginNavigation();f.observer.bindNavigation({loaderId:'initial',frameId:'frame'})
  f.emit('Page.frameNavigated',{frame:{id:'frame',loaderId:'current',url:'https://www.douyin.com/user/author'}})
  f.finish('one',f.request({loaderId:'current',frameId:'frame'}))
  const result=await f.observer.result()
  assert.equal(result.proof.secUid,'owner');assert.equal(f.observer.diagnostics().currentDocument.loader,'different')
  assert.equal(f.observer.diagnostics().requests[0].currentLoader,'match');assert.equal(f.observer.diagnostics().requests[0].currentFrame,'match')
  f.observer.stop()
})
test('a stale loader remains rejected when a newer committed document is current',async()=>{
  const f=fixture();f.observer.beginNavigation();f.observer.bindNavigation({loaderId:'initial',frameId:'frame'})
  f.emit('Page.frameNavigated',{frame:{id:'frame',loaderId:'current',url:'https://www.douyin.com/user/author'}})
  f.finish('one',f.request({loaderId:'initial',frameId:'frame'}))
  assert.equal((await f.observer.result()).errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH')
  assert.equal(f.observer.diagnostics().requests[0].currentLoader,'different');f.observer.stop()
})
test('document transitions and child-session metadata are bounded, whitelisted, and never counted as self requests',async()=>{
  const f=fixture();f.observer.beginNavigation()
  for(let i=0;i<20;i++)f.emit('Network.requestWillBeSent',{type:'Document',loaderId:i?'new-loader':'loader',frameId:'frame',request:{url:'https://www.douyin.com/user/author?cookie=private'},redirectResponse:i>0?{headers:{cookie:'private'}}:undefined})
  f.observer.bindNavigation({loaderId:'loader',frameId:'frame'})
  const diagnostics=f.observer.diagnostics()
  assert.equal(diagnostics.documents.length,8);assert.equal(diagnostics.documents[0].loader,'match');assert.equal(diagnostics.documents[1].loader,'different')
  assert.equal(diagnostics.observedRequests,0);assert.equal(diagnostics.requests.length,0)
  assert.equal(JSON.stringify(diagnostics).includes('private'),false);assert.equal(JSON.stringify(diagnostics).includes('new-loader'),false)
  f.observer.stop()
})
test('a navigate result or a main document request cannot substitute for a committed page',async()=>{
  for(const native of [false,true]){
    const f=fixture();f.observer.beginNavigation();f.observer.bindNavigation({loaderId:'loader',frameId:'frame'})
    f.emit('Network.requestWillBeSent',{type:'Document',loaderId:'loader',frameId:'frame',request:{url:'https://www.douyin.com/user/author'}})
    if(native)f.finish('one',f.request())
    assert.equal((await f.observer.result()).errorCode,'ACCOUNT_NATIVE_DOCUMENT_UNCOMMITTED')
    assert.equal(f.observer.diagnostics().currentDocument.committed,false);f.observer.stop()
  }
})
test('a commit received before the navigate result remains authoritative',async()=>{
  const f=fixture();f.observer.beginNavigation();f.commit('current');f.observer.bindNavigation({loaderId:'initial',frameId:'frame'})
  f.finish('one',f.request({loaderId:'current'}));assert.ok((await f.observer.result()).proof)
  assert.equal(f.observer.diagnostics().currentDocument.loader,'different');f.observer.stop()
})
test('other authors, detached main frames, route changes, child frames and child sessions never authorize a new loader',async()=>{
  for(const change of ['other-author','other-frame','route','detach','child-frame','child-session']){
    const f=fixture();f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'})
    if(change==='route')f.emit('Page.navigatedWithinDocument',{frameId:'frame',url:'https://www.douyin.com/user/other'})
    else if(change==='detach')f.emit('Page.frameDetached',{frameId:'frame'})
    else f.emit('Page.frameNavigated',{frame:{id:change==='other-frame'?'other-frame':'frame',loaderId:'current',url:change==='other-author'?'https://www.douyin.com/user/other':'https://www.douyin.com/user/author',...(change==='child-frame'?{parentId:'parent'}:{})}},2,change==='child-session'?'child':undefined)
    f.finish('one',f.request({loaderId:'current',...(change==='child-session'?{sessionId:'child'}:{})}))
    assert.ok((await f.observer.result()).errorCode);f.observer.stop()
  }
})
test('a pending main document rejects fallback and reuse, including after the diagnostic arrays fill up',async()=>{
  for(const native of [false,true]){
    const f=fixture();f.observer.beginNavigation();f.bind({loaderId:'loader',frameId:'frame'})
    for(let i=0;i<10;i++)f.emit('Network.requestWillBeSent',{type:'Document',loaderId:'child-'+i,frameId:'child',request:{url:'https://www.example.com'}})
    f.emit('Network.requestWillBeSent',{type:'Document',loaderId:'pending',frameId:'frame',request:{url:'https://www.douyin.com/user/author'}})
    if(native)f.finish('one',f.request())
    assert.equal((await f.observer.result()).errorCode,'ACCOUNT_NATIVE_DOCUMENT_UNCOMMITTED');f.observer.stop()
  }
})
test('a page change while waiting for a body rechecks the source; a second successful response cannot hide a rejection',async()=>{
  const waiting=fixture();waiting.observer.beginNavigation();waiting.bind({loaderId:'loader',frameId:'frame'});waiting.request()
  const value=await waiting.observer.result({waitMs:1000,pause:async()=>waiting.commit('current')})
  assert.equal(value.errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH');waiting.observer.stop()
  const rejected=fixture();rejected.observer.beginNavigation();rejected.bind({loaderId:'loader',frameId:'frame'})
  rejected.finish('one',rejected.request(),403);rejected.finish('two',rejected.request({id:'two'}))
  assert.equal((await rejected.observer.result()).errorCode,'ACTIVITY_HTTP_403');rejected.observer.stop()
})
