import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import {readCreatorActivityPage,readCreatorProfileCount,readCreatorPageReadiness,runCreatorActivityRefresh,fetchCreatorActivityPage} from '../browser-connector/following-extension/creator-activity-runner.js'
import {projectCreatorActivityResponse} from '../browser-connector/following-extension/creator-activity-network.js'
const scope={runId:'run',secUid:'sec',uid:'uid',ownerSecUid:'owner',weekStart:'2026-09-27T16:00:00.000Z',weekEndExclusive:'2026-10-04T16:00:00.000Z'}
const row=(id,time,pinned=0)=>({aweme_id:id,author:{uid:'uid',sec_uid:'sec'},create_time:Math.floor(Date.parse(time)/1000),is_top:pinned,status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0})
async function read(pages,{uid='uid',count=224}={}){
 const requests=[]
 const result=await readCreatorActivityPage({...scope,uid,frontendCount:{count,text:String(count),profileUrl:'https://www.douyin.com/user/sec',secUid:'sec',checkedAt:new Date().toISOString(),selector:'#semiTabpost [data-e2e="user-tab-count"]'}},
   {nativeRequests:()=>0,readPage:async cursor=>{
     requests.push(cursor)
     try{return {root:projectCreatorActivityResponse(pages.shift()),sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:cursor,httpStatus:200,observedAt:new Date().toISOString()},activeRequest:true}}
     catch(error){return {errorCode:error.message,activeRequest:true}}
   }})
 return {result,requests}
}
test('takes total from the frontend and stops weekly reads at the week boundary',async()=>{
 const {result,requests}=await read([{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000001','2026-07-01T00:00:00Z',1),row('700000002','2026-10-03T04:00:00Z'),row('700000003','2026-09-20T00:00:00Z')]},
   {status_code:0,has_more:0,max_cursor:200,aweme_list:[row('700000004','2026-09-10T00:00:00Z')]}])
 assert.equal(result.ok,true);assert.equal(result.capture.profile.workCount,null);assert.equal(result.capture.frontendCount.count,224);assert.equal(result.capture.pages[0].records.length,3)
 assert.equal(result.capture.contract,'signaldesk-creator-activity/v7');assert.equal(result.capture.pages.length,1)
 assert.deepEqual(requests,[0]);assert.equal(result.capture.activeApiRequests,1);assert.equal(result.capture.reusedNativePages,0)
})
test('wrong author and unproven cursor cannot produce a complete weekly result',async()=>{
 const wrong=await read([],{uid:null});assert.equal(wrong.result.ok,false);assert.equal(wrong.requests.length,0)
 const stalled=await read([{status_code:0,has_more:1,max_cursor:0,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]}])
 assert.equal(stalled.result.capture.errorCode,'ACTIVITY_PAGINATION_STALLED');assert.equal(stalled.result.capture.pages.length,0)
})
test('foreign-author posts in the same response are excluded from target activity with explicit proof',async()=>{
 const foreign=row('800000001','2026-10-03T08:00:00Z');foreign.author={uid:'foreign-uid',sec_uid:'foreign-sec'}
 const {result}=await read([{status_code:0,has_more:0,max_cursor:100,aweme_list:[foreign,row('700000002','2026-10-03T04:00:00Z'),row('700000003','2026-09-20T00:00:00Z')]}])
 assert.equal(result.capture.pages[0].records.length,3);assert.equal(result.capture.pages[0].records[0].authorUid,'foreign-uid');assert.equal(result.capture.errorCode,null)
})
test('first page entirely inside the week fetches another page and retains partial data on failure',async()=>{
 const {result}=await read([{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]},{status_code:8}])
 assert.equal(result.capture.pages.length,1);assert.equal(result.capture.errorCode,'ACTIVITY_RESPONSE_REJECTED');assert.equal(result.capture.frontendCount.count,224)
})
test('accepts public empty end despite a positive reported count and excludes known non-public statuses',async()=>{
 const empty=await read([{status_code:0,has_more:0,max_cursor:0,aweme_list:[]}],{count:2})
 assert.equal(empty.result.capture.errorCode,null);assert.equal(empty.result.capture.pages[0].records.length,0)
 const privateWork=row('700000003','2026-10-03T04:00:00Z');privateWork.status.private_status=1;delete privateWork.create_time
 const deleted=row('700000004','2026-10-03T04:00:00Z');deleted.status.is_delete=true
 const prohibited=row('700000005','2026-10-03T04:00:00Z');prohibited.status.is_prohibited=true
 const result=await read([{status_code:0,has_more:0,max_cursor:0,aweme_list:[privateWork,deleted,prohibited,row('700000002','2026-10-03T04:00:00Z')]}])
 assert.equal(result.result.capture.pages[0].records.length,4)
 assert.equal(result.result.capture.pages[0].records[0].visibility.privateStatus,1)
 const unknown=row('700000006','2026-10-03T04:00:00Z');delete unknown.status
 assert.equal((await read([{status_code:0,has_more:0,max_cursor:0,aweme_list:[unknown]}])).result.capture.pages[0].records[0].visibility.privateStatus,null)
})
test('limits weekly scope to ten pages and detects repeated or cyclic pages',async()=>{
 const pages=Array.from({length:11},(_,index)=>({status_code:0,has_more:index<10?1:0,max_cursor:(index+1)*100,
   aweme_list:[row(String(700000001+index),'2026-10-03T00:00:00Z',1)]}))
 const complete=await read(pages);assert.equal(complete.result.capture.pages.length,10);assert.equal(complete.result.capture.errorCode,'ACTIVITY_PAGE_LIMIT')
 const repeated=await read([{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000002','2026-10-03T00:00:00Z')]},
   {status_code:0,has_more:1,max_cursor:200,aweme_list:[row('700000002','2026-10-03T00:00:00Z')]}])
 assert.equal(repeated.result.capture.errorCode,'ACTIVITY_REPEATED_PAGE');assert.equal(repeated.result.capture.pages.length,1)
 const cycle=await read([{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000002','2026-10-03T00:00:00Z')]},
   {status_code:0,has_more:1,max_cursor:0,aweme_list:[row('700000003','2026-09-20T00:00:00Z')]}])
 assert.equal(cycle.result.capture.errorCode,'ACTIVITY_PAGINATION_STALLED')
})
function mockBrowser(calls,onBody=()=>{},rootOverride=null,{native=true}={}){
 const listeners=new Set(),url='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=sec&max_cursor=0'
 return {tabs:{query:async()=>[{id:1}],get:async()=>({status:'complete',url:'https://www.douyin.com/user/sec'}),create:async()=>({id:2}),remove:async()=>calls.push('remove')},
   debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},attach:async()=>calls.push('attach'),detach:async()=>calls.push('detach'),
   sendCommand:async(target,method,args)=>{
     if(method==='Network.getResponseBody'){onBody();return {body:JSON.stringify(rootOverride||{status_code:0,has_more:0,max_cursor:0,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]})}}
     if(method==='Page.navigate'){
       for(const listener of listeners){listener(target,'Page.frameNavigated',{frame:{id:'frame',loaderId:'loader',url:'https://www.douyin.com/user/sec'}});if(native){listener(target,'Network.requestWillBeSent',{requestId:'native',loaderId:'loader',frameId:'frame',documentURL:'https://www.douyin.com/user/sec',type:'XHR',request:{url,method:'GET'}});listener(target,'Network.responseReceived',{requestId:'native',response:{url,status:200}});listener(target,'Network.loadingFinished',{requestId:'native',encodedDataLength:500})}}
       return {loaderId:'loader',frameId:'frame'}
     }
     if(method==='Runtime.evaluate'&&args.expression.includes('fetchCreatorActivityPage')){
       const value=await vm.runInNewContext(args.expression,{location:{origin:'https://www.douyin.com',pathname:'/user/sec'},URLSearchParams,AbortController,setTimeout,clearTimeout,Date,
         fetch:async()=>{onBody();return {status:200,text:async()=>JSON.stringify(rootOverride||{status_code:0,has_more:0,max_cursor:0,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]})}}})
       return {result:{value}}
     }
     if(method==='Page.captureScreenshot'){calls.push('screenshot');return {data:'/9j/AA=='}}
     if(method==='Runtime.evaluate'&&args.expression.includes('readActivityPageState'))return {exceptionDetails:{}}
     if(method==='Runtime.evaluate'&&args.expression.includes('readCreatorPageReadiness'))return {result:{value:{ready:true}}}
     return {result:{value:args?.expression?.includes('readCreatorProfileCount')?{count:18}:{ok:true,owner:{uid:'owner-uid',secUid:'owner'},observedAt:new Date().toISOString()}}}
   }}}
}
test('continuous runner checks login owner and fetches its first page even without a native list',async()=>{
 const posts=[],calls=[]
 const chromeApi=mockBrowser(calls,()=>{},null,{native:false})
 const fetchApi=async(input,options)=>{const path=new URL(input).pathname;if(options.method==='POST'){posts.push({path,body:JSON.parse(options.body)});return {ok:true,json:async()=>({phase:'completed'})}}return {ok:true,json:async()=>({phase:'running',runId:'run'})}}
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope}]},{chromeApi,fetchApi})
 assert.equal(posts.filter(p=>p.path==='/activity-report').length,1);assert.equal(posts.at(-1).body.finished,true);assert.deepEqual(calls,['attach','detach','remove'])
 assert.equal(posts.find(p=>p.path==='/activity-report').body.capture.activeApiRequests,1)
 assert.equal(posts.find(p=>p.path==='/activity-report').body.capture.reusedNativePages,0)
 assert.equal(posts.find(p=>p.path==='/activity-report').body.capture.nativeListRequests,0)
})

test('cancellation after an in-flight page read prevents report submission and still detaches',async()=>{
 const posts=[],calls=[];let cancelled=false
 const chromeApi=mockBrowser(calls,()=>{cancelled=true})
 const fetchApi=async(input,options)=>{const path=new URL(input).pathname;if(options.method==='POST'){posts.push(path);return {ok:true,json:async()=>({phase:'cancelled'})}}return {ok:true,json:async()=>({phase:cancelled?'cancelled':'running',runId:'run'})}}
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope}]},{chromeApi,fetchApi})
 assert.equal(posts.includes('/activity-report'),false);assert.deepEqual(calls,['attach','detach','remove'])
})

test('runner explicitly requests first and later cursors once with image-post parameters',async()=>{
 const posts=[],calls=[],methods=[],gets=[]
 const chromeApi=mockBrowser(calls,()=>{},{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]})
 const send=chromeApi.debugger.sendCommand
 chromeApi.debugger.sendCommand=async(target,method,args)=>{
   methods.push(method)
   if(method==='Runtime.evaluate'&&args.expression.includes('fetchCreatorActivityPage')){
     assert.ok(methods.includes('Network.enable'))
     const value=await vm.runInNewContext(args.expression,{location:{origin:'https://www.douyin.com',pathname:'/user/sec'},URLSearchParams,AbortController,setTimeout,clearTimeout,Date,fetch:async(url,options)=>{
       const parsed=new URL(url,'https://www.douyin.com');gets.push(parsed.searchParams.get('max_cursor'))
       assert.equal(options.method,'GET');assert.equal(options.credentials,'include');assert.equal(parsed.searchParams.get('publish_video_strategy_type'),'2')
       return {status:200,text:async()=>JSON.stringify(parsed.searchParams.get('max_cursor')==='0'
         ?{status_code:0,has_more:1,max_cursor:100,aweme_list:[row('700000002','2026-10-03T04:00:00Z')]}
         :{status_code:0,has_more:0,max_cursor:200,aweme_list:[row('700000003','2026-09-20T00:00:00Z')]})}
     }})
     return {result:{value}}
   }
   return send(target,method,args)
 }
 const fetchApi=async(input,options)=>{if(options.method==='POST'){posts.push({path:new URL(input).pathname,body:JSON.parse(options.body)});return {ok:true,json:async()=>({phase:'completed'})}}return {ok:true,json:async()=>({phase:'running',runId:'run'})}}
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope}]},{chromeApi,fetchApi})
 const capture=posts.find(p=>p.path==='/activity-report').body.capture
 assert.deepEqual(gets,['0','100']);assert.equal(capture.activeApiRequests,2);assert.equal(capture.reusedNativePages,0);assert.equal(capture.pages.length,2)
 assert.equal(capture.pages[1].sourceProof.kind,'active-get')
})

test('reads only the native works-tab count; ignores likes, injected panels and other counters',async()=>{
 const dom=new JSDOM('<div id="semiTabpost"><h2><span>作品</span><span data-e2e="user-tab-count">18</span></h2></div><div id="semiTablike"><span data-e2e="user-tab-count">999</span></div><aside>作品 222</aside>',{url:'https://www.douyin.com/user/sec'})
 let now=0
 const element=dom.window.document.querySelector('#semiTabpost [data-e2e="user-tab-count"]');element.getClientRects=()=>[{}]
 Object.defineProperty(dom.window.document,'readyState',{value:'interactive',configurable:true})
 class Clock extends Date {static now(){return now}}
 const fn=vm.runInNewContext(`(${readCreatorProfileCount.toString()})`,{document:dom.window.document,location:dom.window.location,getComputedStyle:()=>({visibility:'visible'}),Date:Clock,setTimeout:fn=>{now+=100;fn()}})
 assert.equal((await fn({secUid:'sec'})).count,18);assert.ok(now>=500,'interactive counts must still stabilize for 500ms')
 element.textContent='0';assert.equal((await fn({secUid:'sec'})).count,0)
 element.textContent='3,248';assert.equal((await fn({secUid:'sec'})).count,3248)
 assert.equal((await fn({secUid:'wrong'})).errorCode,'PROFILE_PAGE_MISMATCH')
 element.remove();assert.equal((await fn({secUid:'sec'})).count,null)
 dom.window.close()
})

test('interactive readiness requires the target profile and a visible native works count, with verification checked first',()=>{
 const dom=new JSDOM('<div id="semiTabpost"><h2><span>作品</span><span data-e2e="user-tab-count">29</span></h2></div>',{url:'https://www.douyin.com/user/sec?tab=post'})
 const element=dom.window.document.querySelector('[data-e2e="user-tab-count"]');element.getClientRects=()=>[{}]
 Object.defineProperty(dom.window.document,'readyState',{value:'interactive',configurable:true})
 const ready=vm.runInNewContext(`(${readCreatorPageReadiness.toString()})`,{document:dom.window.document,location:dom.window.location,getComputedStyle:()=>({visibility:'visible'})})
 assert.equal(ready({secUid:'sec'}).ready,true)
 assert.equal(ready({secUid:'other'}).ready,false)
 assert.equal(ready({secUid:'sec'},()=> 'CAPTCHA_OR_SECURITY_CHALLENGE').errorCode,'CAPTCHA_OR_SECURITY_CHALLENGE')
 assert.equal(ready({secUid:'sec'},()=> 'LOGIN_REQUIRED').errorCode,'LOGIN_REQUIRED')
 element.getClientRects=()=>[];assert.equal(ready({secUid:'sec'}).ready,false)
 element.getClientRects=()=>[{}];element.textContent='—';assert.equal(ready({secUid:'sec'}).ready,false)
 element.textContent='0';assert.equal(ready({secUid:'sec'}).ready,true)
 Object.defineProperty(dom.window.document,'readyState',{value:'loading',configurable:true});assert.equal(ready({secUid:'sec'}).ready,false)
 dom.window.close()
})

test('a loading tab with a readable interactive profile proceeds without waiting for complete',async()=>{
 const posts=[],calls=[],chromeApi=mockBrowser(calls)
 chromeApi.tabs.get=async()=>({status:'loading',url:'https://www.douyin.com/user/sec?tab=post'})
 const fetchApi=async(input,options)=>{if(options.method==='POST'){posts.push({path:new URL(input).pathname,body:JSON.parse(options.body)});return {ok:true,json:async()=>({})}}return {ok:true,json:async()=>({phase:'running',runId:'run'})}}
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope}]},{chromeApi,fetchApi})
 assert.equal(posts.at(-1).body.finished,true);assert.equal(posts.filter(p=>p.path==='/activity-report').length,1)
})

for(const when of ['between-checks','pending-readiness','pending-count'])test(`unexpected detach ${when} reports the connection error before timeout and retains the failure page`,async()=>{
 const posts=[],calls=[],listeners=new Set(),chromeApi=mockBrowser(calls)
 chromeApi.debugger.onDetach={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}
 const disconnect=()=>{for(const fn of listeners)fn({tabId:2},'target_closed')}
 chromeApi.tabs.get=async()=>{if(when==='between-checks')disconnect();return {status:'loading',url:'https://www.douyin.com/user/sec'}}
 const send=chromeApi.debugger.sendCommand
 chromeApi.debugger.sendCommand=async(target,method,args)=>{
   if(method==='Runtime.evaluate'&&args.expression.includes(when==='pending-count'?'readCreatorProfileCount':'readCreatorPageReadiness')&&when!=='between-checks'){
     setImmediate(disconnect);return new Promise(()=>{})
   }
   return send(target,method,args)
 }
 const fetchApi=async(input,options)=>{if(options.method==='POST'){posts.push({path:new URL(input).pathname,body:JSON.parse(options.body)});return {ok:true,json:async()=>({})}}return {ok:true,json:async()=>({phase:'running',runId:'run'})}}
 const start=performance.now()
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope},{id:-2,...scope}]},{chromeApi,fetchApi})
 assert.ok(performance.now()-start<2000)
 assert.equal(posts.at(-1).body.errorCode,'DEBUGGER_NOT_ATTACHED')
 assert.equal(posts.filter(p=>p.path==='/activity-report').length,0)
 assert.equal(posts.find(p=>p.body.failureDiagnostic?.capturePhase==='complete').body.failureDiagnostic.retainedTabId,2)
 assert.equal(calls.includes('remove'),false);assert.equal(listeners.size,0)
})

test('explicit fetch distinguishes timeout, HTTP, JSON, schema and page mismatch without retry',async()=>{
 const cases=[
   ['ACTIVITY_HTTP_403',async()=>({status:403}),false],
   ['ACTIVITY_HTTP_429',async()=>({status:429}),false],
   ['ACTIVITY_JSON_UNAVAILABLE',async()=>({status:200,text:async()=>'<html>secret</html>'}),false],
   ['ACTIVITY_RESPONSE_REJECTED',async()=>({status:200,text:async()=>'{"status_code":8}'}),false],
   ['ACTIVITY_REQUEST_FAILED',async()=>{throw Error('secret network address')},false],
   ['ACTIVITY_REQUEST_TIMEOUT',async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')))),true]
 ]
 for(const [expected,fetch,timed] of cases){
   let gets=0
   const run=vm.runInNewContext(`(${fetchCreatorActivityPage.toString()})`,{location:{origin:'https://www.douyin.com',pathname:'/user/sec'},URLSearchParams,AbortController,Date,
     setTimeout:timed?fn=>setTimeout(fn,5):setTimeout,clearTimeout,fetch:async(...args)=>{gets++;return fetch(...args)}})
   const result=await run({...scope,cursor:0},projectCreatorActivityResponse)
   assert.equal(result.errorCode,expected);assert.equal(result.diagnostic.errorCode,expected);assert.equal(gets,1)
   assert.equal(JSON.stringify(result).includes('secret'),false)
 }
 let gets=0
 const run=vm.runInNewContext(`(${fetchCreatorActivityPage.toString()})`,{location:{origin:'https://www.douyin.com',pathname:'/user/wrong'},URLSearchParams,AbortController,Date,setTimeout,clearTimeout,fetch:async()=>{gets++}})
 const result=await run({...scope,cursor:0},projectCreatorActivityResponse)
 assert.equal(result.errorCode,'ACTIVITY_PAGE_MISMATCH');assert.equal(result.activeRequest,false);assert.equal(gets,0)
})

test('first-page failure saves diagnostics before cleanup, preserves count and stops before the next author',async()=>{
 const posts=[],calls=[]
 const chromeApi=mockBrowser(calls,()=>{},{status_code:8},{native:false})
 const cached=[]
 chromeApi.storage={local:{set:async value=>{if(!value.signalDeskLatestFailure)return;cached.push(structuredClone(value.signalDeskLatestFailure));if(cached.length===1)assert.equal(calls.includes('screenshot'),false)}}}
 const fetchApi=async(input,options)=>{
   if(options.method==='POST'){
     const body=JSON.parse(options.body);posts.push({path:new URL(input).pathname,body})
     if(body.failureDiagnostic){if(body.failureDiagnostic.capturePhase==='complete')assert.ok(calls.includes('screenshot'));assert.equal(calls.includes('remove'),false);calls.push(body.failureDiagnostic.capturePhase+'-saved')}
     return {ok:true,json:async()=>({})}
   }
   return {ok:true,json:async()=>({phase:'running',runId:'run'})}
 }
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope},{id:-2,...scope}]},{chromeApi,fetchApi})
 const reports=posts.filter(row=>row.path==='/activity-report');assert.equal(reports.length,1)
 assert.equal(reports[0].body.capture.frontendCount.count,18);assert.equal(reports[0].body.capture.pages.length,0)
 assert.equal(reports[0].body.capture.activeApiRequests,1)
 const diagnostic=posts.find(row=>row.body.failureDiagnostic?.capturePhase==='complete').body.failureDiagnostic
 assert.equal(diagnostic.errorCode,'ACTIVITY_RESPONSE_REJECTED');assert.equal(diagnostic.attempts[0].stage,'projection')
 assert.equal(diagnostic.screenshot,'/9j/AA==');assert.equal(diagnostic.pageError,'UNAVAILABLE')
 assert.equal(posts.at(-1).body.blocked,true);assert.deepEqual(calls,['attach','frozen-saved','screenshot','complete-saved','detach'])
 assert.equal(diagnostic.retainedTabId,2)
 assert.deepEqual(cached.map(row=>row.diagnostic.capturePhase),['frozen','complete']);assert.equal(cached[0].runId,'run')
})

test('diagnostic storage failure does not discard an independently obtained count',async()=>{
 const posts=[],calls=[],chromeApi=mockBrowser(calls,()=>{},{status_code:8},{native:false})
 const fetchApi=async(input,options)=>{
   if(options.method==='POST'){
     const body=JSON.parse(options.body);posts.push({path:new URL(input).pathname,body})
     return {ok:!body.failureDiagnostic,json:async()=>body.failureDiagnostic?{error:'DISK_UNAVAILABLE'}:{}}
   }
   return {ok:true,json:async()=>({phase:'running',runId:'run'})}
 }
 await runCreatorActivityRefresh({...scope,origin:'http://127.0.0.1:1234',token:'test',targets:[{id:-1,...scope}]},{chromeApi,fetchApi})
 assert.equal(posts.find(row=>row.path==='/activity-report').body.capture.frontendCount.count,18)
 assert.equal(posts.at(-1).body.diagnosticSaveFailed,true);assert.equal(calls.at(-1),'detach');assert.equal(calls.includes('remove'),false)
})
