import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import vm from 'node:vm'
import {runCreatorActivityRefresh,readCreatorActivityGuard} from '../browser-connector/following-extension/creator-activity-runner.js'
const now=Date.now(),offset=8*3600000,local=new Date(now+offset),days=(local.getUTCDay()+6)%7
const start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-days)-offset
const week={weekStart:new Date(start).toISOString(),weekEndExclusive:new Date(start+7*86400000).toISOString()}
const published=new Date(now-60000).toISOString()
const pacing={batchSize:33,authorDelayMinMs:3000,authorDelayMaxMs:8000,batchDelayMinMs:180000,batchDelayMaxMs:300000}
const record=(id='700000001',time=published)=>({aweme_id:id,author:{uid:'uid',sec_uid:'sec'},create_time:Math.floor(Date.parse(time)/1000),is_top:0,
  status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0})
function fixture({native=true,count=628,root={status_code:0,has_more:0,max_cursor:0,aweme_list:[record()]},status=200,challenge=false,two=false}={}){
  const listeners=new Set(),posts=[],calls=[];let gets=0,bodies=0,cancelled=false,clock=Date.now(),guardCalls=0
  const emit=(target,method,value)=>{for(const fn of listeners)fn(target,method,value)}
  const chromeApi={storage:{local:{set:async()=>{}}},tabs:{create:async()=>({id:2}),get:async()=>({status:'complete',url:'https://www.douyin.com/user/sec'}),remove:async()=>calls.push('remove')},
    debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},attach:async()=>{},detach:async()=>calls.push('detach'),sendCommand:async(target,method,args)=>{
      if(method==='Page.navigate'){
        calls.push('navigate');emit(target,'Page.frameNavigated',{frame:{id:'frame',loaderId:'loader',url:'https://www.douyin.com/user/sec'}})
        if(native){const url='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=sec&max_cursor=0'
          emit(target,'Network.requestWillBeSent',{requestId:'native',type:'XHR',request:{method:'GET',url}})
          emit(target,'Network.responseReceived',{requestId:'native',response:{url,status}});emit(target,'Network.loadingFinished',{requestId:'native',encodedDataLength:500})}
        return {frameId:'frame',loaderId:'loader'}
      }
      if(method==='Network.getResponseBody'){bodies++;return {body:JSON.stringify(root)}}
      if(method==='Page.captureScreenshot')return {data:'/9j/AA=='}
      if(method==='Runtime.evaluate'){
        if(args.expression.includes('readCreatorPageReadiness'))return {result:{value:{ready:true}}}
        if(args.expression.includes('readCreatorProfileCount'))return {result:{value:{count,text:String(count),secUid:'sec',profileUrl:'https://www.douyin.com/user/sec',checkedAt:new Date().toISOString(),selector:'#semiTabpost [data-e2e="user-tab-count"]'}}}
        if(args.expression.includes('readCreatorActivityOwner'))return {result:{value:{ok:true,owner:{uid:'owner-uid',secUid:'owner'},observedAt:new Date().toISOString()}}}
        if(args.expression.includes('fetchCreatorActivityPage')){gets++;return {result:{value:{root:{status_code:0,has_more:0,max_cursor:0,aweme_list:[record('700000002')]},activeRequest:true,
          sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',secUid:'sec',requestCursor:100,method:'GET',httpStatus:200,observedAt:new Date().toISOString()}}}}}
        if(args.expression.includes('readCreatorActivityGuard')){guardCalls++;return {result:{value:challenge?'CAPTCHA_OR_SECURITY_CHALLENGE':null}}}
        return {result:{value:null}}
      }
      return {}
    }}}
  const fetchApi=async(input,options)=>{
    if(options.method==='POST'){const body=JSON.parse(options.body);posts.push({path:new URL(input).pathname,body});return {ok:true,json:async()=>({})}}
    return {ok:true,json:async()=>({runId:'run',phase:cancelled?'cancelled':'running'})}
  }
  const target={id:-1,secUid:'sec',uid:'uid',nickname:'测试',baseline:{snapshotId:1,workCount:628,latest:{workId:'700000001',publishedAt:new Date(Math.floor(Date.parse(published)/1000)*1000).toISOString()}}}
  const config={runId:'run',ownerSecUid:'owner',ownerUid:'owner-uid',origin:'http://127.0.0.1:1234',token:'local',...week,pacing,targets:two?[target,{...target,id:-2}]:[target]}
  return {config,chromeApi,fetchApi,posts,calls,listeners,gets:()=>gets,bodies:()=>bodies,guardCalls:()=>guardCalls,cancel:()=>{cancelled=true},
    nativeWaitOptions:{now:()=>clock,delay:async ms=>{clock+=ms}},waitOptions:{now:()=>clock,random:()=>0,delay:async ms=>{clock+=ms}}}
}
test('same count and same newest native work skips all extra list requests',async()=>{
  const f=fixture();await runCreatorActivityRefresh(f.config,f)
  const report=f.posts.find(p=>p.path==='/activity-report').body.capture
  assert.equal(report.contract,'signaldesk-activity-unchanged/v1');assert.equal(report.reason,'latest-unchanged')
  assert.equal(report.firstPage.records.length,1);assert.equal(f.gets(),0);assert.equal(f.bodies(),1)
  assert.equal(f.posts.at(-1).body.finished,true);assert.equal(f.listeners.size,0)
})
test('same count without a usable native list skips instead of issuing a first-page request',async()=>{
  const f=fixture({native:false});await runCreatorActivityRefresh(f.config,f)
  const report=f.posts.find(p=>p.path==='/activity-report').body.capture
  assert.equal(report.reason,'count-unchanged');assert.equal(report.firstPage,undefined);assert.equal(f.gets(),0);assert.equal(f.bodies(),0)
})
test('a changed latest work continues weekly verification, reuses the first page, and only requests the needed next page',async()=>{
  const f=fixture({root:{status_code:0,has_more:1,max_cursor:100,aweme_list:[record('700000009')]}})
  await runCreatorActivityRefresh(f.config,f)
  const report=f.posts.find(p=>p.path==='/activity-report').body.capture
  assert.equal(report.contract,'signaldesk-creator-activity/v9');assert.equal(report.pages.length,2)
  assert.equal(report.reusedNativePages,1);assert.equal(report.activeApiRequests,1);assert.equal(f.gets(),1)
})
test('count changes and missing baselines cannot enter the unchanged branch',async()=>{
  for(const missing of [false,true]){
    const f=fixture({count:missing?628:629});if(missing)delete f.config.targets[0].baseline
    await runCreatorActivityRefresh(f.config,f)
    const report=f.posts.find(p=>p.path==='/activity-report').body.capture
    assert.equal(report.contract,'signaldesk-creator-activity/v9');assert.equal(report.frontendCount.count,missing?628:629)
    assert.equal(report.activeApiRequests,0);assert.equal(report.reusedNativePages,1)
  }
})
test('a security challenge or native HTTP denial stops before the shortcut and the second author, retaining the page',async()=>{
  for(const options of [{challenge:true},{status:429}]){
    const f=fixture({...options,two:true});await runCreatorActivityRefresh(f.config,f)
    assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,0);assert.equal(f.gets(),0)
    assert.equal(f.calls.filter(v=>v==='navigate').length,1);assert.equal(f.calls.includes('remove'),false)
    assert.equal(f.posts.at(-1).body.blocked,true)
    assert.equal(f.posts.at(-1).body.errorCode,options.challenge?'CAPTCHA_OR_SECURITY_CHALLENGE':'ACTIVITY_HTTP_429')
  }
})
test('cancelling during the author interval prevents the next navigation',async()=>{
  const f=fixture({native:false,two:true}),delay=f.waitOptions.delay
  f.waitOptions.delay=async ms=>{await delay(ms);f.cancel()}
  await runCreatorActivityRefresh(f.config,f)
  assert.equal(f.calls.filter(v=>v==='navigate').length,1);assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,1)
  assert.ok(f.posts.some(p=>p.body.wait?.kind==='author'));assert.equal(f.posts.some(p=>p.body.finished),false)
})
test('visible verification overlays are detected without treating a normal biography as a challenge',()=>{
  for(const [html,expected] of [
    ['<div id="semiTabpost"></div><p>验证码相关的技术分享</p>',null],
    ['<div id="semiTabpost"></div><div role="dialog">请完成安全验证</div>','CAPTCHA_OR_SECURITY_CHALLENGE'],
    ['<p>访问过于频繁，请完成验证</p>','CAPTCHA_OR_SECURITY_CHALLENGE']]){
    const dom=new JSDOM(html);for(const node of dom.window.document.querySelectorAll('*'))node.getClientRects=()=>[{}]
    Object.defineProperty(dom.window.document.body,'innerText',{value:dom.window.document.body.textContent})
    const guard=vm.runInNewContext(`(${readCreatorActivityGuard.toString()})`,{document:dom.window.document,getComputedStyle:()=>({visibility:'visible'})})
    assert.equal(guard(),expected);dom.window.close()
  }
})

test('every successful save closes its own page before author or batch waits, with no browser commands during waits',async()=>{
  for(const mode of ['count-unchanged','latest-unchanged','full-refresh','batch']){
    const f=fixture({native:mode!=='count-unchanged',two:true}),live=new Set(),attached=new Set()
    if(mode==='full-refresh')for(const target of f.config.targets)delete target.baseline
    if(mode==='batch')f.config.pacing={...pacing,batchSize:1}
    let nextId=1,waiting=false,reports=0,waits=0
    const originalSend=f.chromeApi.debugger.sendCommand,originalFetch=f.fetchApi
    f.chromeApi.tabs.create=async()=>{const id=++nextId;live.add(id);return {id}}
    f.chromeApi.tabs.remove=async id=>{assert.equal(attached.has(id),false);assert.equal(live.delete(id),true)}
    f.chromeApi.debugger.attach=async target=>{assert.equal(live.has(target.tabId),true);attached.add(target.tabId)}
    f.chromeApi.debugger.detach=async target=>attached.delete(target.tabId)
    f.chromeApi.debugger.sendCommand=async(target,...args)=>{
      assert.equal(waiting,false,'completed page must not be read while waiting')
      assert.equal(attached.has(target.tabId),true)
      return originalSend(target,...args)
    }
    f.fetchApi=async(input,options)=>{
      const body=options.method==='POST'?JSON.parse(options.body):null
      if(new URL(input).pathname==='/activity-report'){
        reports++;assert.equal(live.size,1);assert.equal(attached.size,1,'keep evidence until APP acknowledges save')
      }
      if(body?.wait){waiting=true;waits++;assert.equal(live.size,0);assert.equal(attached.size,0)}
      if(body?.wait===null)waiting=false
      return originalFetch(input,options)
    }
    const outcome=await runCreatorActivityRefresh(f.config,f)
    assert.notEqual(outcome.phase,'blocked');assert.equal(reports,2);assert.equal(waits,1)
    assert.equal(nextId,3);assert.equal(live.size,0);assert.equal(attached.size,0);assert.equal(f.listeners.size,0)
  }
})

test('loss of the debugger during an explicit list read keeps the precise error, page and single failure evidence',async()=>{
  const f=fixture({root:{status_code:0,has_more:1,max_cursor:100,aweme_list:[record('700000009')]},two:true})
  const send=f.chromeApi.debugger.sendCommand
  f.chromeApi.debugger.sendCommand=async(target,method,args)=>{
    if(args?.expression?.includes('fetchCreatorActivityPage'))throw Error('Not attached to this target: private text')
    return send(target,method,args)
  }
  await runCreatorActivityRefresh(f.config,f)
  assert.equal(f.posts.at(-1).body.errorCode,'DEBUGGER_NOT_ATTACHED')
  const diagnostics=f.posts.filter(p=>p.body.failureDiagnostic).map(p=>p.body.failureDiagnostic)
  assert.equal(diagnostics.length,2);assert.equal(diagnostics[0].errorCode,'DEBUGGER_NOT_ATTACHED')
  assert.equal(diagnostics[0].stage,'reading-list');assert.equal(diagnostics[0].retainedTabId,2)
  assert.equal(diagnostics[0].capturedAt,diagnostics[1].capturedAt)
  assert.equal(f.calls.includes('remove'),false);assert.equal(f.calls.filter(v=>v==='navigate').length,1)
  assert.equal(JSON.stringify(f.posts).includes('private text'),false)
})

test('an APP rejection of an unchanged report stops without closing the failure page or starting the next author',async()=>{
  const f=fixture({native:false,two:true}),fetchApi=f.fetchApi
  f.fetchApi=async(input,options)=>{
    const response=await fetchApi(input,options)
    return new URL(input).pathname==='/activity-report'?{ok:true,json:async()=>({failed:1})}:response
  }
  await runCreatorActivityRefresh(f.config,f)
  assert.equal(f.posts.at(-1).body.errorCode,'ACTIVITY_VALIDATION_INCOMPLETE')
  assert.equal(f.calls.includes('remove'),false);assert.equal(f.calls.filter(v=>v==='navigate').length,1)
})

test('an interrupted local wait records its actual stage without retaining an already completed page',async()=>{
  for(const kind of ['author','batch']){
    const f=fixture({native:false,two:true})
    if(kind==='batch')f.config.pacing={...pacing,batchSize:1}
    f.waitOptions.delay=async()=>{throw Error('ACTIVITY_WEEK_CHANGED')}
    await runCreatorActivityRefresh(f.config,f)
    const frozen=f.posts.find(p=>p.body.failureDiagnostic).body.failureDiagnostic
    assert.equal(frozen.stage,kind==='batch'?'batch-rest':'author-wait');assert.equal(frozen.retainedTabId,null)
    assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,1);assert.equal(f.calls.filter(v=>v==='navigate').length,1)
    assert.equal(f.calls.includes('remove'),true)
  }
})

test('successful count-only checks retain absence, decision, save and expected-release observations for each author',async()=>{
 const f=fixture({native:false,two:true});await runCreatorActivityRefresh(f.config,f)
 const observations=f.posts.filter(p=>p.body.readObservation).map(p=>p.body.readObservation)
 assert.deepEqual(observations.map(o=>o.phase),['prepared','decision','released','prepared','decision','released'])
 for(const o of observations.filter(o=>o.phase==='released')){
   assert.equal(o.strategy,'count-only');assert.equal(o.countSame,true)
   assert.equal(o.native.availability.outcome,'ACTIVITY_NATIVE_LIST_UNAVAILABLE');assert.equal(o.native.availability.waitedMs,600)
   assert.deepEqual(o.milestones.map(m=>m.step),o.creatorId===-1?['listener-ready','navigation','page-ready','count-ready','native-decision','decision','save-ack','released']:['listener-ready','navigation','page-ready','count-ready','native-decision','decision','save-ack','released'])
   assert.ok(o.browser.connections.some(c=>c.event==='detach-requested'))
 }
 assert.equal(f.gets(),0);assert.equal(f.bodies(),0)
})

test('eager native body-cache rejection falls back only for an unchanged count and preserves the precise cause',async()=>{
 const f=fixture(),send=f.chromeApi.debugger.sendCommand
 f.chromeApi.debugger.sendCommand=async(target,method,args)=>{if(method==='Network.getResponseBody')throw Error('Request content was evicted from inspector cache: secret');return send(target,method,args)}
 await runCreatorActivityRefresh(f.config,f)
 const report=f.posts.find(p=>p.path==='/activity-report').body.capture
 assert.equal(report.reason,'count-unchanged');assert.equal(f.gets(),0)
 const diagnostic=f.posts.filter(p=>p.body.readObservation).at(-1).body.readObservation
 assert.equal(diagnostic.phase,'released');assert.equal(diagnostic.native.requests[0].bodyError,'BODY_EVICTED')
 assert.equal(diagnostic.native.availability.errorCode,'ACTIVITY_NATIVE_BODY_EVICTED')
 assert.equal(JSON.stringify(diagnostic).includes('secret'),false)
})

test('a late native security denial stops during the grace period without a count-only report',async()=>{
 const f=fixture({native:false,two:true}),listeners=f.listeners;let clock=0
 f.nativeWaitOptions={now:()=>clock,delay:async ms=>{clock+=ms;if(clock===200){
   const url='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=sec&max_cursor=0'
   for(const fn of [...listeners])fn({tabId:2},'Network.requestWillBeSent',{requestId:'late',request:{method:'GET',url}})
   for(const fn of [...listeners])fn({tabId:2},'Network.responseReceived',{requestId:'late',response:{url,status:429}})
 }}}
 await runCreatorActivityRefresh(f.config,f)
 assert.equal(f.posts.at(-1).body.errorCode,'ACTIVITY_HTTP_429');assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,0)
 assert.equal(f.calls.includes('remove'),false);assert.equal(f.gets(),0)
 assert.ok(f.posts.some(p=>p.body.readObservation?.phase==='failed'))
})

test('diagnostic write rejection stops before navigation instead of running an unobserved collection',async()=>{
 const f=fixture(),fetchApi=f.fetchApi
 f.fetchApi=async(input,options)=>{const response=await fetchApi(input,options);if(options.method==='POST'&&JSON.parse(options.body).readObservation)return {ok:false,json:async()=>({error:'DISK_REJECTED'})};return response}
 await runCreatorActivityRefresh(f.config,f)
 assert.equal(f.posts.at(-1).body.errorCode,'ACTIVITY_OBSERVATION_SAVE_FAILED');assert.equal(f.calls.filter(c=>c==='navigate').length,0)
 assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,0)
})
