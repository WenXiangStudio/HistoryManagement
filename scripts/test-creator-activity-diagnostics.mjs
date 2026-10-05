import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import {observeActivityDiagnostics,readActivityPageState,traceActivityCommands,captureActivityFailure,classifyActivityCommandError,freezeActivityFailure} from '../browser-connector/following-extension/creator-activity-diagnostics.js'

test('Chrome ambiguous navigation error does not claim that an existing tab was closed',()=>{
 assert.equal(classifyActivityCommandError(Error('Inspected target navigated or closed')),'TARGET_NAVIGATED_OR_CLOSED')
 assert.equal(classifyActivityCommandError(Error('Target closed')),'TARGET_UNAVAILABLE')
})

test('frozen evidence survives recovery and a detached debugger has independent page/screenshot capture',async()=>{
 const calls=[],target={tabId:2},page={pathRelation:'target'},state={events:[],documents:[],dropped:0,scriptExceptions:0}
 let attached=false
 const chrome={tabs:{get:async()=>({url:'https://www.douyin.com/user/sec',status:'complete',discarded:false})},
   scripting:{executeScript:async()=>{calls.push('extension-page');return [{result:page}]}},
   debugger:{sendCommand:async(_target,method)=>{calls.push(method);if(!attached)throw Error('Not attached to this target');return {data:'/9j/AA=='}},
     getTargets:async()=>[{tabId:2,attached:false}],attach:async()=>{calls.push('diagnostic-attach');attached=true}}}
 const observer={snapshot:()=>structuredClone(state)},scope={id:-1,secUid:'sec'}
 const frozen=freezeActivityFailure(target,scope,observer,'ACTIVITY_PAGE_EXECUTION_FAILED','reading-list',[])
 state.scriptExceptions=3
 const saved=await captureActivityFailure(chrome,target,scope,observer,frozen.errorCode,'reading-list',[],null,frozen)
 assert.equal(saved.network.scriptExceptions,0);assert.equal(saved.capturedAt,frozen.capturedAt)
 assert.equal(saved.environment.pageSource,'extension-script');assert.equal(saved.environment.diagnosticReattached,true)
 assert.equal(saved.pageFailureReason,'DEBUGGER_NOT_ATTACHED');assert.equal(saved.screenshotFailureReason,'DEBUGGER_NOT_ATTACHED')
 assert.equal(saved.pageError,null);assert.equal(saved.screenshotError,null);assert.equal(saved.screenshot,'/9j/AA==')
 assert.equal(frozen.capturePhase,'frozen');assert.equal(frozen.screenshot,null)
 assert.equal(calls.filter(c=>c==='diagnostic-attach').length,1);assert.equal(calls.includes('Page.navigate'),false)
})

test('does not compete with another debugger or reattach to a different page',async()=>{
 for(const url of ['https://www.douyin.com/user/sec','https://www.douyin.com/user/other']){
   let attaches=0
   const chrome={tabs:{get:async()=>({url,status:'complete'})},debugger:{sendCommand:async()=>{throw Error('Not attached')},getTargets:async()=>[{tabId:2,attached:true}],attach:async()=>{attaches++}}}
   const result=await captureActivityFailure(chrome,{tabId:2},{id:-1,secUid:'sec'},null,'ERROR','reading-list',[])
   assert.equal(attaches,0);assert.equal(result.screenshot,null);assert.equal(result.screenshotFailureReason,'DEBUGGER_NOT_ATTACHED')
 }
})

test('command trace preserves detach and exact failure categories without raw errors or expressions',async()=>{
 const listeners=new Set(),target={tabId:2}
 const chrome={debugger:{onDetach:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendCommand:async(_target,method,params)=>{
   if(method==='Page.captureScreenshot')throw Error('Not attached to this target: secret')
   if(params.expression.includes('fetchCreatorActivityPage')){
     for(const listener of listeners)listener(target,'canceled_by_user')
     throw Error('Cannot find context with specified id: secret')
   }
   return {exceptionDetails:{exception:{className:'TypeError',description:'secret cookie'}}}
 }}}
 const trace=traceActivityCommands(chrome);trace.setTarget(2)
 await assert.rejects(trace.sendCommand(target,'Runtime.evaluate',{expression:'fetchCreatorActivityPage secret'}))
 const wrapped={debugger:{sendCommand:trace.sendCommand}}
 const failure=await captureActivityFailure(wrapped,target,{id:-1,secUid:'sec'},null,'ACTIVITY_PAGE_EXECUTION_FAILED','reading-list',[],trace)
 assert.equal(failure.pageFailureReason,'PAGE_SCRIPT_EXCEPTION');assert.equal(failure.screenshotFailureReason,'DEBUGGER_NOT_ATTACHED')
 assert.equal(failure.browser.commands[0].error,'EXECUTION_CONTEXT_UNAVAILABLE')
 assert.equal(failure.captureBrowser.commands[1].exceptionClass,'TypeError')
 assert.equal(failure.browser.connections[1].reason,'canceled_by_user')
 assert.equal(JSON.stringify(failure).includes('secret'),false)
 trace.stop();assert.equal(listeners.size,0)
})

test('missing values, pending command deadlines and bounded command history stay distinguishable',async()=>{
 const chrome={debugger:{sendCommand:async()=>({result:{type:'undefined'}})}}
 const trace=traceActivityCommands(chrome)
 for(let i=0;i<70;i++)await trace.sendCommand({tabId:1},'Runtime.evaluate',{expression:'fetchCreatorActivityPage'})
 assert.equal(trace.snapshot().commands.length,64);assert.equal(trace.snapshot().dropped,6)
 assert.equal(trace.snapshot().commands.at(-1).error,'COMMAND_RESULT_MISSING')
 for(const [message,code] of [['Promise was collected','PROMISE_COLLECTED'],['Target closed','TARGET_UNAVAILABLE'],['Screenshot surface unavailable','SCREENSHOT_FAILED'],['timeout','COMMAND_TIMEOUT'],['secret','COMMAND_FAILED']])assert.equal(classifyActivityCommandError(Error(message)),code)
 trace.stop()
})

test('diagnostics classify mismatches, request failures and document changes without storing sensitive text',async()=>{
 const listeners=new Set(),target={tabId:2}
 const chrome={debugger:{onEvent:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendCommand:async()=>({})}}
 const observed=await observeActivityDiagnostics(chrome,target,'sec')
 const emit=(method,params,source=target)=>{for(const listener of listeners)listener(source,method,params)}
 const request=(id,url,method='GET',source=target)=>emit('Network.requestWillBeSent',{requestId:id,request:{url,method,headers:{Cookie:'secret'}}},source)
 const base='https://www.douyin.com/aweme/v1/web/aweme/post/'
 request('foreign',base+'?sec_user_id=other&max_cursor=0&token=secret')
 request('cursor',base+'?sec_user_id=sec')
 request('method',base+'?sec_user_id=sec&max_cursor=0','POST')
 request('child',base+'?sec_user_id=sec&max_cursor=0','GET',{tabId:2,sessionId:'secret'})
 request('native',base+'?sec_user_id=sec&max_cursor=0')
 request('other-tab',base+'?sec_user_id=sec&max_cursor=0','GET',{tabId:3})
 observed.beginExplicit();request('explicit',base+'?sec_user_id=sec&max_cursor=0')
 emit('Network.responseReceived',{requestId:'explicit',response:{status:429,mimeType:'application/json',url:'secret'}})
 emit('Network.loadingFailed',{requestId:'explicit',errorText:'secret'})
 emit('Runtime.exceptionThrown',{exceptionDetails:{text:'secret'}})
 emit('Page.frameNavigated',{frame:{id:'secret',loaderId:'secret',url:'https://www.douyin.com/user/sec?secret'}})
 const value=observed.snapshot()
 assert.equal(observed.nativeListRequests,1);assert.equal(observed.denial,'ACTIVITY_HTTP_429')
 assert.deepEqual(value.events.map(event=>event.match),['author','cursor','method','child-session','target','target'])
 assert.equal(value.events.at(-1).phase,'explicit');assert.equal(value.events.at(-1).stage,'load-failed')
 assert.equal(value.scriptExceptions,1);assert.equal(value.documents[0].pathRelation,'target')
 assert.equal(JSON.stringify(value).includes('secret'),false)
 for(let i=0;i<80;i++)request(String(i),'https://www.douyin.com/aweme/other/?secret')
 assert.equal(observed.snapshot().events.length,48);assert.ok(observed.snapshot().dropped>0)
 observed.stop();assert.equal(listeners.size,0)
})

test('page diagnostics distinguish readable count from selected tab and visible content',()=>{
 const dom=new JSDOM('<div id="semiTabpost" aria-selected="false" aria-controls="works">作品 109</div><div id="works">加载失败</div>',{url:'https://www.douyin.com/user/sec'})
 dom.window.document.getElementById('semiTabpost').getClientRects=()=>[{}]
 const read=vm.runInNewContext(`(${readActivityPageState.toString()})`,{document:dom.window.document,location:dom.window.location,getComputedStyle:()=>({visibility:'visible'})})
 const page=read({secUid:'sec'})
 assert.equal(page.pathRelation,'target');assert.equal(page.worksTabVisible,true);assert.equal(page.worksTabSelected,false)
 assert.equal(page.panelPresent,true);assert.equal(page.panelVisible,false)
 dom.window.close()
})
