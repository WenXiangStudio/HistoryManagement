import test from 'node:test'
import assert from 'node:assert/strict'
import {runCreatorActivityRefresh} from '../browser-connector/following-extension/creator-activity-runner.js'
import {createCreatorActivityRecovery} from '../browser-connector/following-extension/creator-activity-recovery.js'

const policy={maxAttempts:2,delayMinMs:5000,delayMaxMs:10000}
const start=Date.now(),local=new Date(start+8*3600000),weekStart=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(local.getUTCDay()+6)%7)-8*3600000
const week={weekStart:new Date(weekStart).toISOString(),weekEndExclusive:new Date(weekStart+7*86400000).toISOString()}
const rows=cursor=>Array.from({length:20},(_,i)=>({aweme_id:String(760000001+cursor+i),author:{uid:'uid',sec_uid:'sec'},create_time:Math.floor((start-(cursor+i)*86400000)/1000),is_top:0,
 status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},is_story:0,is_24_story:0,aweme_type:0}))
const root=cursor=>({status_code:0,has_more:cursor<40?1:0,max_cursor:cursor+20,aweme_list:rows(cursor)})
function fixture(mode='list-detach'){
 let clock=Date.now(),attached=false,attachCount=0,reads=0,guardFailures=0,countReads=0,owners=0,cancelled=false
 const posts=[],calls=[],listeners=new Set(),detachListeners=new Set(),cache=new Map()
 const emit=(method,p)=>{for(const f of listeners)f({tabId:2},method,p)}
 const lose=()=>{attached=false;for(const f of detachListeners)f({tabId:2},mode==='manual-detach'?'canceled_by_user':'target_closed')}
 const chromeApi={storage:{local:{set:async()=>{}}},scripting:{executeScript:async()=>{calls.push('inspect');return [{result:mode==='captcha'?{errorCode:'CAPTCHA_OR_SECURITY_CHALLENGE'}:{ready:true,secUid:'sec'}}]}},
  tabs:{create:async()=>({id:2}),get:async()=>({url:mode==='page-changed'&&attachCount===1&&reads?'https://www.douyin.com/user/foreign':'https://www.douyin.com/user/sec',status:'complete',discarded:false}),remove:async()=>calls.push('remove')},
  debugger:{onEvent:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},onDetach:{addListener:f=>detachListeners.add(f),removeListener:f=>detachListeners.delete(f)},
   attach:async()=>{attached=true;attachCount++;calls.push('attach')},detach:async()=>{attached=false;calls.push('detach')},getTargets:async()=>[{tabId:2,attached}],
   sendCommand:async(_t,method,p={})=>{
    if(method==='Page.navigate'){
     calls.push('navigate');emit('Page.frameNavigated',{frame:{id:'frame',loaderId:'loader',url:'https://www.douyin.com/user/sec'}})
     const url='https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=sec&max_cursor=0'
     emit('Network.requestWillBeSent',{requestId:'native-'+calls.length,type:'XHR',request:{method:'GET',url}})
     emit('Network.responseReceived',{requestId:'native-'+calls.length,response:{url,status:200}})
     emit('Network.loadingFinished',{requestId:'native-'+calls.length,encodedDataLength:1000});return {frameId:'frame',loaderId:'loader'}
    }
    if(method==='Network.getResponseBody')return {body:JSON.stringify(root(0))}
    if(method==='Page.captureScreenshot')return {data:'/9j/AA=='}
    if(method!=='Runtime.evaluate')return {}
    const expression=p.expression
    if(expression.includes('readCreatorPageReadiness'))return {result:{value:{ready:true}}}
    if(expression.includes('readCreatorProfileCount')){
     countReads++
     if(mode==='count-navigation'&&countReads===2)throw Error('Inspected target navigated or closed')
     return {result:{value:{count:100,text:'100',secUid:'sec',profileUrl:'https://www.douyin.com/user/sec',checkedAt:new Date().toISOString(),selector:'#semiTabpost [data-e2e="user-tab-count"]'}}}
    }
    if(expression.includes('readCreatorActivityOwner')){owners++;return {result:{value:mode==='owner-changed'&&owners>1?{ok:false,code:'OWNER_IDENTITY_MISMATCH'}:{ok:true,owner:{uid:'owner-uid',secUid:'owner'},observedAt:new Date().toISOString()}}}}
    if(expression.includes('readCreatorActivityPendingResult')){
     const scope=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));return {result:{value:mode==='uncertain'?{phase:'missing'}:{phase:'settled',value:cache.get(scope.cursor)}}}
    }
    if(expression.includes('fetchCreatorActivityPage')){
     const scope=JSON.parse(expression.match(/\}\)\((\{[^\n]+?\}),\(/)[1]);reads++;calls.push('GET:'+scope.cursor)
     const value={root:root(scope.cursor),activeRequest:true,sourceProof:{kind:'active-get',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:scope.cursor,httpStatus:200,observedAt:new Date().toISOString()}}
     cache.set(scope.cursor,value)
     if(mode!=='count-navigation'&&reads===1){
      if(mode==='http-denial')emit('Network.responseReceived',{requestId:'denial',response:{status:429}})
      lose()
      await new Promise(resolve=>queueMicrotask(resolve))
     }
     return {result:{value}}
    }
    if(expression.includes('readCreatorActivityGuard'))return {result:{value:null}}
    return {result:{value:null}}
   }}}
 const fetchApi=async(url,options)=>{
  if(options.method==='POST'){const body=JSON.parse(options.body);posts.push({path:new URL(url).pathname,body});return {ok:true,json:async()=>({failed:0})}}
  return {ok:true,json:async()=>({runId:'run',phase:cancelled?'cancelled':'running'})}
 }
 const config={action:'activity',runId:'run',origin:'http://127.0.0.1:1234',token:'local',ownerSecUid:'owner',ownerUid:'owner-uid',...week,
  baselinePolicy:{version:2,limit:60},recoveryPolicy:policy,pacing:{batchSize:28,authorDelayMinMs:5000,authorDelayMaxMs:10000,batchDelayMinMs:180000,batchDelayMaxMs:300000},
  targets:[{id:-1,uid:'uid',secUid:'sec',nickname:'测试'},...(mode==='count-navigation'?[{id:-2,uid:'uid',secUid:'sec',nickname:'第二位'}]:[])]}
 return {config,chromeApi,fetchApi,posts,calls,listeners,detachListeners,stats:()=>({reads,attachCount,countReads,owners}),
  nativeWaitOptions:{waitMs:0,arrivalWaitMs:0},waitOptions:{now:()=>clock,random:()=>0,delay:async ms=>{clock+=ms}},
  recoveryOptions:{now:()=>clock,random:()=>0,delay:async ms=>{clock+=ms;if(mode==='cancel')cancelled=true}}}
}

test('detached in-flight GET recovers once, retrieves the same response and preserves first-page evidence without repeating GET',async()=>{
 const f=fixture();await runCreatorActivityRefresh(f.config,f)
 assert.equal(f.posts.at(-1).body.finished,true)
 assert.deepEqual(f.calls.filter(c=>c.startsWith('GET:')),['GET:20','GET:40'])
 const capture=f.posts.find(p=>p.path==='/activity-report').body.capture
 assert.equal(capture.pages.length,3);assert.equal(capture.activeApiRequests,2);assert.equal(capture.reusedNativePages,1)
 assert.equal(f.stats().attachCount,2);assert.equal(f.stats().owners,2)
 const recovery=f.posts.filter(p=>p.body.recovery).map(p=>p.body.recovery)
 assert.deepEqual(recovery.map(r=>r.phase),['waiting','reconnecting','recovered']);assert.equal(recovery[0].preservedPages,1)
 assert.equal(Date.parse(recovery[0].waitUntil)-Date.parse(recovery[0].startedAt),5000)
 assert.equal(f.posts.at(-1).body.requestAudit.recoveryOwnerGets,1);assert.equal(f.posts.at(-1).body.requestAudit.ownerVerificationGets,2)
 assert.equal(f.listeners.size,0);assert.equal(f.detachListeners.size,0)
})

test('navigation during count reading rechecks the same homepage without reopening or recollecting previous author',async()=>{
 const f=fixture('count-navigation');await runCreatorActivityRefresh(f.config,f)
 assert.equal(f.posts.at(-1).body.finished,true);assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,2)
 assert.equal(f.calls.filter(c=>c==='navigate').length,2);assert.equal(f.stats().countReads,3)
 assert.equal(f.posts.filter(p=>p.body.recovery?.phase==='recovered').length,1)
})

for(const [mode,code] of [['page-changed','ACTIVITY_RECOVERY_PAGE_CHANGED'],['captcha','CAPTCHA_OR_SECURITY_CHALLENGE'],['manual-detach','ACTIVITY_RECOVERY_USER_DETACHED'],
 ['owner-changed','OWNER_IDENTITY_MISMATCH'],['uncertain','ACTIVITY_RECOVERY_REQUEST_UNCERTAIN'],['cancel','ACTIVITY_SESSION_ENDED']]){
 test(mode+' stops without another list GET or author navigation',async()=>{
  const f=fixture(mode);await runCreatorActivityRefresh(f.config,f)
  assert.ok(f.posts.at(-1).body.blocked);assert.equal(f.posts.at(-1).body.errorCode,code)
  assert.deepEqual(f.calls.filter(c=>c.startsWith('GET:')),['GET:20']);assert.equal(f.calls.filter(c=>c==='navigate').length,1)
  assert.equal(f.posts.filter(p=>p.path==='/activity-report').length,0)
 })
}

test('repeated unstable connections exhaust exactly two attempts and waits never invoke browser work',async()=>{
 let clock=Date.now(),attempts=0,waitChecks=0;const events=[]
 const recovery=createCreatorActivityRecovery({policy,active:async()=>{waitChecks++},inspect:async()=>{},reconnect:async()=>{attempts++},verify:async()=>{},
  progress:async v=>events.push(v),identity:()=>({creatorId:-1,secUid:'sec'}),now:()=>clock,random:()=>0,delay:async ms=>{clock+=ms}})
 await assert.rejects(recovery.run(async()=>{throw Error('DEBUGGER_NOT_ATTACHED')}),/ACTIVITY_RECOVERY_EXHAUSTED/)
 assert.equal(attempts,2);assert.equal(events.filter(e=>e.phase==='recovered').length,2);assert.ok(waitChecks>=20)
})

test('HTTP rejection is never eligible for automatic recovery',async()=>{
 let calls=0
 const recovery=createCreatorActivityRecovery({policy,active:async()=>{},inspect:async()=>{calls++}})
 for(const code of ['ACTIVITY_HTTP_401','ACTIVITY_HTTP_403','ACTIVITY_HTTP_429','OWNER_IDENTITY_MISMATCH','LOGIN_REQUIRED','CAPTCHA_OR_SECURITY_CHALLENGE']){
  await assert.rejects(recovery.run(async()=>{throw Error(code)}),new RegExp(code))
 }
 assert.equal(calls,0);assert.equal(recovery.attempts,0)
})
