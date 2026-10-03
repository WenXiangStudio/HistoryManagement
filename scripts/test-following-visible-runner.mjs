import test from 'node:test'
import assert from 'node:assert/strict'
import {runVisibleFollowingSync} from '../browser-connector/following-extension/visible-runner.js'
function environment({cancel=false,error=null,ready=true,firstError=null,preparing=false}={}){
  const posts=[],navigations=[],messages=[]
  let polls=0,result,captures=0
  const updatedListeners=new Set()
  const chromeApi={tabs:{query:async()=>[{id:1,active:true,url:'https://www.douyin.com/user/self'}],
    get:async()=>({id:1,status:'complete',discarded:false}),
    onUpdated:{addListener:listener=>updatedListeners.add(listener),removeListener:listener=>updatedListeners.delete(listener)},
    reload:async()=>{navigations.push('reload');for(const listener of updatedListeners)listener(1,{status:'complete'})},
    create:async options=>{navigations.push(options);return{id:2}},update:async options=>{navigations.push(options)},
    sendMessage:async(id,message)=>{messages.push(message);if(message.type==='signaldesk.following.ping')return{ok:ready,version:ready?'0.4.3':'0.3.0'}
      if(message.type==='signaldesk.following.track-readiness')return{ok:true}
      if(message.type==='signaldesk.following.feedback')return{ok:true}
      captures++;const captureError=error||(captures===1?firstError:null)
      return captureError?{ok:false,error:captureError}:preparing?{ok:true,prepared:true,ownerNickname:'当前账号',sourceUrl:'https://www.douyin.com/user/self',activeFollowingTab:true,uniqueFollowingList:true}:{ok:true,creators:Array.from({length:20},(_,index)=>({secUid:`new-${index}`}))}}},
    runtime:{getManifest:()=>({version:'0.4.3'})},scripting:{executeScript:async()=>{navigations.push('inject');ready=true}},
    action:{setBadgeText:async()=>{}},storage:{local:{set:async value=>{result=value}}}}
  const fetchApi=async(url,options)=>{
    assert.ok(url.startsWith('http://127.0.0.1:1234/'))
    if(options?.method==='POST'){const body=JSON.parse(options.body);posts.push({path:new URL(url).pathname,body})
      return{ok:true,json:async()=>({phase:new URL(url).pathname==='/readiness'?body.phase:'completed',count:20,message:'已保存',timing:{savedTotalMs:20}})}}
    polls++;return{ok:true,json:async()=>({runId:'run',phase:cancel&&polls>1?'cancelled':'running',readiness:{preparationId:'prepare',phase:'checking'}})}
  }
  return{chromeApi,fetchApi,delay:async()=>{},posts,navigations,messages,result:()=>result}
}
const config={origin:'http://127.0.0.1:1234',token:'test-token',runId:'run',limit:20,ownerNickname:'当前账号',excludeSecUids:['old'],readyTabIds:[1]}
test('reuses the self page and executes one continuous capture-to-save chain',async()=>{
  const env=environment();const result=await runVisibleFollowingSync(config,env)
  assert.equal(result.phase,'completed');assert.equal(env.navigations.length,0)
  assert.equal(env.posts.filter(item=>item.path==='/report').length,1)
  assert.deepEqual(env.messages.find(item=>item.type==='signaldesk.following.collect-visible').config,
    {limit:20,ownerNickname:'当前账号',excludeSecUids:['old'],dialogTimeoutMs:2000})
  assert.equal(env.result().lastFollowingResult.status,'saved')
})
test('updates a stale content script without refreshing or focusing the page',async()=>{
  const env=environment({ready:false});await runVisibleFollowingSync(config,env)
  assert.deepEqual(env.navigations,['inject'])
})
test('cancellation and bad acquisition never submit a report',async()=>{
  for(const options of [{cancel:true},{error:'CAPTCHA_OR_SECURITY_CHALLENGE'}]){
    const env=environment(options);const result=await runVisibleFollowingSync(config,env)
    assert.equal(result.phase,'blocked');assert.equal(env.posts.filter(item=>item.path==='/report').length,0)
  }
})
test('a restored tab is refreshed once on the first sync of the browser session',async()=>{
  const env=environment();const result=await runVisibleFollowingSync({...config,readyTabIds:[]},env)
  assert.equal(result.phase,'completed')
  assert.deepEqual(env.navigations,['reload'])
  assert.equal(env.posts.find(item=>item.path==='/report').body.browserExecution.coldPageRefreshed,true)
})
test('a dialog readiness failure recovers once in the same run and saves only the successful capture',async()=>{
  const env=environment({firstError:'FOLLOWING_DIALOG_NOT_READY'})
  const result=await runVisibleFollowingSync(config,env)
  assert.equal(result.phase,'completed');assert.deepEqual(env.navigations,['reload'])
  const reports=env.posts.filter(item=>item.path==='/report')
  assert.equal(reports.length,1);assert.equal(reports[0].body.runId,'run')
  assert.equal(reports[0].body.browserExecution.recoveryAttempts[0].error,'FOLLOWING_DIALOG_NOT_READY')
  assert.equal(env.posts.some(item=>item.body.phase==='blocked'),false)
})
test('startup preparation restores and verifies the real page without a collection report',async()=>{
  const env=environment({preparing:true})
  const result=await runVisibleFollowingSync({...config,action:'prepare',preparationId:'prepare',readyTabIds:[]},env)
  assert.equal(result.phase,'ready');assert.deepEqual(env.navigations,['reload'])
  assert.equal(env.posts.filter(item=>item.path==='/report').length,0)
  const ready=env.posts.find(item=>item.path==='/readiness'&&item.body.phase==='ready')
  assert.equal(ready.body.proof.prepared,true);assert.equal(ready.body.preparationId,'prepare')
  assert.equal(env.messages.find(item=>item.type==='signaldesk.following.collect-visible').config.prepareOnly,true)
})
