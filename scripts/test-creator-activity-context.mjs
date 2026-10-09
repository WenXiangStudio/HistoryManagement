import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {findCreatorActivityContext,readCreatorActivityOwner,meterCreatorActivityRequests} from '../browser-connector/following-extension/creator-activity-context.js'
import {runCreatorActivityRefresh} from '../browser-connector/following-extension/creator-activity-runner.js'

test('reuses a complete Douyin tab without navigation even when the self tab is loading or discarded',async()=>{
  for(const discarded of [false,true]){
    const tabs=[{id:1,url:'https://www.douyin.com/user/self',status:'loading',discarded},{id:2,url:'https://www.douyin.com/video/700000001',status:'complete'}]
    const chrome={tabs:{query:async query=>{assert.equal(query.url,'https://www.douyin.com/*');return tabs},get:async id=>tabs.find(row=>row.id===id)}}
    assert.equal((await findCreatorActivityContext(chrome,async()=>{})).id,2)
  }
})
test('waits for an existing loading page with no reload, and cancellation prevents preparation',async()=>{
  let reads=0
  const chrome={tabs:{query:async()=>[{id:1}],get:async()=>({id:1,url:'https://www.douyin.com/user/self',status:++reads<3?'loading':'complete'})}}
  assert.equal((await findCreatorActivityContext(chrome,async()=>{},{pause:async()=>{}})).id,1)
  await assert.rejects(findCreatorActivityContext(chrome,async()=>{throw Error('CANCELLED')}),/CANCELLED/)
  const stuck={tabs:{query:async()=>[{id:1}],get:async()=>({id:1,url:'https://www.douyin.com/',status:'loading'})}}
  await assert.rejects(findCreatorActivityContext(stuck,async()=>{},{waitMs:0}),/ACCOUNT_CONTEXT_TIMEOUT/)
})
test('owner verification makes one same-origin GET and distinguishes login, owner mismatch, throttling and unreadable JSON',async()=>{
  for(const [response,expected] of [
    [{status:200,json:async()=>({status_code:0,user:{uid:'owner-uid',sec_uid:'owner'}})},{ok:true,owner:{uid:'owner-uid',secUid:'owner'}}],
    [{status:200,json:async()=>({status_code:0,user:{uid:'other-uid',sec_uid:'other'}})},{ok:false,code:'OWNER_IDENTITY_MISMATCH'}],
    [{status:200,json:async()=>({status_code:0,user:null})},{ok:false,code:'LOGIN_REQUIRED'}],
    [{status:429},{ok:false,code:'ACTIVITY_HTTP_429'}],
    [{status:200,json:async()=>{throw Error('html')}},{ok:false,code:'ACTIVITY_JSON_UNAVAILABLE'}]
  ]){
    let gets=0
    const run=vm.runInNewContext(`(${readCreatorActivityOwner.toString()})`,{location:{origin:'https://www.douyin.com'},AbortController,setTimeout,clearTimeout,
      fetch:async(url,options)=>{gets++;assert.ok(url.startsWith('/aweme/v1/web/user/profile/self/'));assert.equal(options.method,'GET');assert.equal(options.credentials,'include');return response}})
    const result=await run({runId:'run',ownerSecUid:'owner'});delete result.observedAt
    assert.equal(JSON.stringify(result),JSON.stringify(expected));assert.equal(gets,1)
  }
})
function browser({existing=true,ownerOk=true,onSelf=()=>{},nativeFailure=false,nativeOwner=false,nativeOwnerStatus=200,nativeDuringCount=false,ownerRequest={},changedDuringCount=false}={}){
  const listeners=new Set(),calls=[],gets=[],posts=[]
  let author='sec',nativeUrl
  const emit=(tab,method,params)=>{for(const fn of listeners)fn({tabId:tab},method,params)}
  const emitOwner=tab=>{
    const ownerUrl='https://www.douyin.com/aweme/v1/web/user/profile/self/?secret=discarded'
    emit(tab,'Network.requestWillBeSent',{requestId:'owner-'+author,loaderId:'loader',frameId:'frame',documentURL:'https://www.douyin.com/user/'+author,type:'XHR',request:{url:ownerUrl,method:'GET'},...ownerRequest})
    emit(tab,'Network.responseReceived',{requestId:'owner-'+author,response:{url:ownerUrl,status:nativeOwnerStatus}})
    emit(tab,'Network.loadingFinished',{requestId:'owner-'+author,encodedDataLength:100})
    onSelf()
  }
  const root=()=>({status_code:0,has_more:0,max_cursor:0,aweme_list:[{aweme_id:author==='sec'?'700000001':'700000002',author:{uid:'uid-'+author,sec_uid:author},
    create_time:Math.floor(Date.parse('2026-09-20T00:00:00Z')/1000),is_top:0,status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0}]})
  const chrome={tabs:{query:async()=>existing?[{id:1}]:[],get:async id=>({id,status:'complete',url:id===1?'https://www.douyin.com/video/700000003':'https://www.douyin.com/user/'+author}),
    create:async values=>{assert.equal(values.url,'about:blank');calls.push('create-blank');return {id:2}},remove:async id=>calls.push('remove-'+id)},
    debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},attach:async target=>calls.push('attach-'+target.tabId),detach:async target=>calls.push('detach-'+target.tabId),
      sendCommand:async(target,method,args)=>{
        if(method==='Page.navigate'){
          const url=new URL(args.url);author=url.pathname.split('/').at(-1);calls.push('navigate-'+author)
          assert.notEqual(author,'self')
          emit(target.tabId,'Page.frameNavigated',{frame:{id:'frame',loaderId:'loader',url:'https://www.douyin.com/user/'+author}})
          nativeUrl='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id='+author+'&max_cursor=0'
          emit(target.tabId,'Network.requestWillBeSent',{requestId:'native-'+author,loaderId:'loader',frameId:'frame',documentURL:'https://www.douyin.com/user/'+author,type:'XHR',request:{url:nativeUrl,method:'GET'}})
          emit(target.tabId,'Network.responseReceived',{requestId:'native-'+author,response:{url:nativeUrl,status:nativeFailure?403:200}})
          emit(target.tabId,'Network.loadingFinished',{requestId:'native-'+author,encodedDataLength:500})
          if(nativeOwner)emitOwner(target.tabId)
          return {loaderId:'loader',frameId:'frame'}
        }
        if(method==='Network.getResponseBody')return {body:JSON.stringify(args.requestId.startsWith('owner-')
          ?{status_code:0,user:{uid:ownerOk?'owner-uid':'other-uid',sec_uid:ownerOk?'owner':'other'},cookie:'do-not-save',signature:'do-not-save'}:root())}
        if(method==='Runtime.evaluate'){
          if(args.expression.includes('readCreatorPageReadiness'))return {result:{value:{ready:true}}}
          if(args.expression.includes('readCreatorActivityOwner')){
            gets.push('self');emit(target.tabId,'Network.requestWillBeSent',{requestId:'self',request:{method:'GET',url:'https://www.douyin.com/aweme/v1/web/user/profile/self/?secret=never-retained'}})
            onSelf();return {result:{value:ownerOk?{ok:true,owner:{uid:'owner-uid',secUid:'owner'},observedAt:new Date().toISOString()}:{ok:false,code:'OWNER_IDENTITY_MISMATCH'}}}
          }
          if(args.expression.includes('readCreatorProfileCount')){
            calls.push('count-'+author)
            if(changedDuringCount)emit(target.tabId,'Page.frameNavigated',{frame:{id:'frame',loaderId:'current',url:'https://www.douyin.com/user/'+author}})
            if(nativeDuringCount)emitOwner(target.tabId)
            return {result:{value:{count:18}}}
          }
          if(args.expression.includes('fetchCreatorActivityPage'))return {result:{value:{root:root(),activeRequest:true,
            sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:author,requestCursor:0,httpStatus:200,observedAt:new Date().toISOString()},
            diagnostic:{cursor:0,stage:'complete',httpStatus:200,json:'valid',errorCode:null}}}}
          if(args.expression.includes('readCreatorActivityGuard'))return {result:{value:null}}
          throw Error('Unexpected page request')
        }
        return {}
      }}}
  let cancelled=false
  const fetchApi=async(input,options)=>{
    if(options.method==='POST'){
      const body=JSON.parse(options.body);posts.push({path:new URL(input).pathname,body})
      return {ok:true,json:async()=>({phase:body.blocked?'blocked':'completed'})}
    }
    return {ok:true,json:async()=>({phase:cancelled?'cancelled':'running',runId:'run'})}
  }
  return {chrome,calls,gets,posts,fetchApi,cancel:()=>{cancelled=true},listeners}
}
const config={runId:'run',ownerSecUid:'owner',ownerUid:'owner-uid',origin:'http://127.0.0.1:1234',token:'synthetic',weekStart:'2026-09-27T16:00:00.000Z',weekEndExclusive:'2026-10-04T16:00:00.000Z',
  targets:[{id:-1,uid:'uid-sec',secUid:'sec',nickname:'one'},{id:-2,uid:'uid-next',secUid:'next',nickname:'two'}]}
test('missing native owner makes one fallback GET for two authors, with no account-page or duplicate author navigation',async()=>{
  const f=browser();await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.deepEqual(f.gets,['self']);assert.deepEqual(f.calls.filter(value=>value.startsWith('navigate')),['navigate-sec','navigate-next'])
  assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,2)
  const {ownerSourceDiagnostics,...counts}=f.posts.at(-1).body.requestAudit
  assert.equal(ownerSourceDiagnostics.observedRequests,0);assert.equal(ownerSourceDiagnostics.navigationBound,true)
  assert.deepEqual(counts,{contextSource:'first-author-page',ownerVerificationSource:'active-get',nativeOwnerRequestsObserved:0,accountPageNavigations:0,ownerVerificationGets:1,authorHomepageNavigations:2,
    networkRequestsObserved:3,platformApiGetsObserved:3,selfGetsObserved:1,listGetsObserved:2})
  assert.equal(f.listeners.size,0);assert.equal(f.calls.at(-1),'remove-2')
})
test('fresh native owner response verifies once for two authors and makes zero explicit owner GETs',async()=>{
  const f=browser({nativeOwner:true});await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.deepEqual(f.gets,[]);assert.deepEqual(f.calls.filter(value=>value.startsWith('navigate')),['navigate-sec','navigate-next'])
  assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,2)
  const proofs=f.posts.filter(row=>row.body.ownerVerification).map(row=>row.body.ownerVerification)
  assert.equal(proofs.length,1);assert.equal(proofs[0].kind,'native-network');assert.equal(proofs[0].secUid,'owner');assert.equal(proofs[0].uid,'owner-uid')
  assert.equal(JSON.stringify(proofs).includes('do-not-save'),false)
  assert.equal(f.posts.at(-1).body.requestAudit.ownerVerificationGets,0)
  assert.equal(f.posts.at(-1).body.requestAudit.nativeOwnerRequestsObserved,1)
  assert.equal(f.posts.at(-1).body.requestAudit.selfGetsObserved,2)
  assert.equal(f.listeners.size,0)
})
test('a native owner request arriving during required count reading is reused without a timer, fallback GET or second count read',async()=>{
  const f=browser({nativeDuringCount:true});await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.deepEqual(f.gets,[])
  assert.deepEqual(f.calls.filter(value=>value.startsWith('count-')),['count-sec','count-next'])
  assert.equal(f.posts.at(-1).body.requestAudit.ownerVerificationSource,'native-network')
  assert.equal(f.posts.filter(row=>row.body.ownerVerification).length,1)
})
test('native owner mismatch or HTTP rejection stops without a fallback owner GET or author result',async()=>{
  for(const options of [{nativeOwner:true,ownerOk:false},{nativeOwner:true,nativeOwnerStatus:403},{nativeOwner:true,nativeOwnerStatus:429}]){
    const f=browser(options);await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
    assert.deepEqual(f.gets,[]);assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,0)
    assert.equal(f.posts.at(-1).body.blocked,true);assert.equal(f.calls.at(-1),'detach-2');assert.equal(f.calls.includes('remove-2'),false);assert.equal(f.listeners.size,0)
  }
})
test('source mismatch persists its precise field relations and response stage, with no proof, result, retry or GET',async()=>{
  const f=browser({nativeOwner:true,ownerRequest:{frameId:'other-frame'}})
  await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  const blocked=f.posts.at(-1).body
  assert.equal(blocked.errorCode,'ACCOUNT_NATIVE_NAVIGATION_MISMATCH')
  const diagnostics=blocked.requestAudit.ownerSourceDiagnostics
  assert.equal(diagnostics.requests[0].loader,'match');assert.equal(diagnostics.requests[0].frame,'different')
  assert.equal(diagnostics.requests[0].identity,'matched');assert.equal(diagnostics.requests[0].httpStatus,200)
  assert.equal(f.posts.filter(row=>row.body.ownerVerification||row.path==='/activity-report').length,0)
  assert.deepEqual(f.gets,[]);assert.equal(f.listeners.size,0)
})
test('an owner request from a newly committed same-author main document verifies before both author writes without another GET',async()=>{
  const f=browser({changedDuringCount:true,nativeDuringCount:true,ownerRequest:{loaderId:'current'}})
  await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.deepEqual(f.gets,[]);assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,2)
  const accepted=f.posts.find(row=>row.body.ownerVerification)
  assert.equal(accepted.body.ownerVerification.kind,'native-network')
  assert.equal(accepted.body.requestAudit.ownerSourceDiagnostics.currentDocument.loader,'different')
  assert.equal(accepted.body.requestAudit.ownerSourceDiagnostics.requests[0].currentLoader,'match')
  assert.ok(f.posts.indexOf(accepted)<f.posts.findIndex(row=>row.path==='/activity-report'))
  assert.deepEqual(f.calls.filter(value=>value.startsWith('count-')),['count-sec','count-next']);assert.equal(f.listeners.size,0)
})
test('cold run uses the first author page for owner and count, with an explicit first list request',async()=>{
  const f=browser({existing:false});await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.deepEqual(f.gets,['self']);assert.deepEqual(f.calls.filter(value=>value.startsWith('navigate')),['navigate-sec','navigate-next'])
  assert.equal(f.posts.at(-1).body.requestAudit.contextSource,'first-author-page')
  assert.equal(f.posts.at(-1).body.requestAudit.accountPageNavigations,0)
  for(const row of f.posts.filter(row=>row.path==='/activity-report')){assert.equal(row.body.capture.activeApiRequests,1);assert.equal(row.body.capture.reusedNativePages,0)}
  assert.equal(f.listeners.size,0);assert.equal(f.calls.at(-1),'remove-2')
})
test('wrong owner never submits an author result and retains the failed page',async()=>{
  const f=browser({existing:false,ownerOk:false});await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,0)
  assert.equal(f.posts.at(-1).body.errorCode,'OWNER_IDENTITY_MISMATCH');assert.deepEqual(f.gets,['self'])
  assert.deepEqual(f.calls.filter(value=>value.startsWith('navigate')),['navigate-sec'])
  assert.equal(f.listeners.size,0);assert.equal(f.calls.at(-1),'detach-2');assert.equal(f.calls.includes('remove-2'),false)
})
test('cancelled owner check prevents author result submission; native failure never triggers a replacement first-page GET',async()=>{
  const f=browser({existing:false,onSelf:()=>f.cancel()})
  await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.equal(f.posts.filter(row=>row.path==='/activity-report').length,0);assert.equal(f.listeners.size,0)
  const denied=browser({existing:false,nativeFailure:true})
  await runCreatorActivityRefresh(config,{chromeApi:denied.chrome,fetchApi:denied.fetchApi})
  assert.deepEqual(denied.gets,[]);assert.equal(denied.posts.at(-1).body.errorCode,'ACTIVITY_HTTP_403')
  assert.deepEqual(denied.calls.filter(value=>value.startsWith('navigate')),['navigate-sec'])
  assert.equal(denied.listeners.size,0)
})
test('request meter retains only counts and ignores other tabs; removing it ends measurement',()=>{
  const callbacks=new Set(),counts={networkRequestsObserved:0,platformApiGetsObserved:0,selfGetsObserved:0,listGetsObserved:0}
  const chrome={debugger:{onEvent:{addListener:fn=>callbacks.add(fn),removeListener:fn=>callbacks.delete(fn)}}}
  const stop=meterCreatorActivityRequests(chrome,{tabId:2},counts),emit=(id,url,method='GET')=>{for(const fn of callbacks)fn({tabId:id},'Network.requestWillBeSent',{request:{url,method}})}
  emit(3,'https://www.douyin.com/aweme/v1/web/user/profile/self/')
  emit(2,'https://www.douyin.com/aweme/v1/web/user/profile/self/?cookie=secret')
  emit(2,'https://cdn.example/frame.jpg');emit(2,'https://www.douyin.com/aweme/telemetry/','POST')
  assert.deepEqual(counts,{networkRequestsObserved:3,platformApiGetsObserved:1,selfGetsObserved:1,listGetsObserved:0})
  assert.equal(JSON.stringify(counts).includes('secret'),false);stop();assert.equal(callbacks.size,0)
})
test('a native debugger error becomes a bounded error code so the backend can stop the run',async()=>{
  const f=browser()
  f.chrome.debugger.attach=async()=>{throw Error('Another debugger is already attached')}
  await runCreatorActivityRefresh(config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.equal(f.posts.at(-1).body.blocked,true);assert.equal(f.posts.at(-1).body.errorCode,'DEBUGGER_BUSY')
  assert.equal(f.gets.length,0)
})
