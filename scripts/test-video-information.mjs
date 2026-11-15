import test from 'node:test'
import assert from 'node:assert/strict'
import {projectVideoInformation} from '../browser-connector/following-extension/video-information-core.js'
import {runVideoInformation} from '../browser-connector/following-extension/video-information-runner.js'
import vm from 'node:vm'

const scope={workId:'7000000000000000001',authorUid:'123456',authorSecUid:'author-sec',publishedAt:'2026-09-01T00:00:00.000Z'}
function fixture(){return {status_code:0,has_more:1,max_cursor:5,aweme_list:[{aweme_id:scope.workId,author:{uid:scope.authorUid,sec_uid:scope.authorSecUid},
  desc:'标题第一行\n完整描述 #话题',create_time:Date.parse(scope.publishedAt)/1000,aweme_type:0,is_story:0,is_24_story:0,
  status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},video:{duration:31000,play_addr:'not-retained'},
  statistics:{digg_count:12345,comment_count:0,collect_count:23,share_count:5}}]}}
test('exact native fields preserve zero, null, full description and omit other data',()=>{
  const raw=fixture();raw.aweme_list.push({aweme_id:'7000000000000000002',desc:'other work'});raw.cookie='not-retained'
  const value=projectVideoInformation(raw,scope).aweme_list
  assert.equal(value.length,1);assert.equal(value[0].statistics.likeCount,12345);assert.equal(value[0].statistics.commentCount,0)
  assert.equal(value[0].title,'标题第一行');assert.equal(value[0].description,raw.aweme_list[0].desc)
  delete raw.aweme_list[0].statistics.collect_count
  assert.equal(projectVideoInformation(raw,scope).aweme_list[0].statistics.collectCount,null)
  assert.equal(JSON.stringify(value).includes('not-retained'),false)
})
test('author uid and secUid, publication date and work ID must agree with saved evidence',()=>{
  for(const update of [row=>row.author.uid='wrong',row=>row.author.sec_uid='wrong',row=>row.aweme_id='7000000000000000003',row=>row.create_time++]){
    const raw=fixture();update(raw.aweme_list[0]);assert.throws(()=>projectVideoInformation(raw,scope))
  }
  const raw=fixture();raw.aweme_list.push(structuredClone(raw.aweme_list[0]));assert.throws(()=>projectVideoInformation(raw,scope),/DUPLICATE/)
})
test('display abbreviations, negatives and unsafe numeric counts are rejected',()=>{
  for(const value of ['1.2万',-1,Number.MAX_SAFE_INTEGER+1,1.2]){const raw=fixture();raw.aweme_list[0].statistics.digg_count=value;assert.throws(()=>projectVideoInformation(raw,scope),/COUNT_INVALID/)}
})
test('private, missing visibility and image works never become verified video records',()=>{
  for(const update of [row=>row.status.private_status=1,row=>delete row.is_story,row=>row.status.is_delete=true,row=>row.aweme_type=68]){
    const raw=fixture();update(raw.aweme_list[0]);assert.throws(()=>projectVideoInformation(raw,scope))
  }
})
test('rejected and malformed responses cannot masquerade as an empty successful result',()=>{
  for(const raw of [{}, {...fixture(),status_code:1},{...fixture(),aweme_list:[]},{...fixture(),has_more:'true'}])assert.throws(()=>projectVideoInformation(raw,scope))
})

function browserFixture(mode='native'){
  const listeners=new Set(),detached=new Set(),requests=[],reports=[],methods=[]
  const config={...scope,action:'video-information',runId:'test',ownerSecUid:'owner-sec',ownerUid:'owner-uid',origin:'http://127.0.0.1:1234',token:'test-only'}
  let rootURL='about:blank',closed=false
  const emit=(method,params)=>{for(const listener of listeners)listener({tabId:1},method,params)}
  const body=fixture(),url=`https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=${scope.authorSecUid}&max_cursor=0`
  const response=(id,status=200)=>{
    emit('Network.requestWillBeSent',{requestId:id,request:{url,method:'GET'},loaderId:'loader',frameId:'frame',documentURL:rootURL,type:'Fetch'})
    emit('Network.responseReceived',{requestId:id,response:{url,status}})
    emit('Network.loadingFinished',{requestId:id,encodedDataLength:300})
  }
  const pageContext={location:{origin:'https://www.douyin.com',pathname:'/user/'+scope.authorSecUid},AbortController,URLSearchParams,setTimeout,clearTimeout,
    fetch:async path=>{requests.push(path);response('controlled');return {status:200,redirected:false,text:async()=>JSON.stringify(body)}}}
  const chrome={tabs:{create:async()=>({id:1}),get:async()=>({id:1,url:rootURL}),remove:async()=>{closed=true}},
    debugger:{attach:async()=>{},detach:async()=>{},onEvent:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
      onDetach:{addListener:f=>detached.add(f),removeListener:f=>detached.delete(f)},sendCommand:async(_target,method,params)=>{
        methods.push(method)
        if(method==='Page.navigate'){
          rootURL=params.url;emit('Page.frameNavigated',{frame:{id:'frame',loaderId:'loader',url:rootURL}})
          if(mode!=='missing')response('native',mode==='denied'?403:200)
          return {frameId:'frame',loaderId:'loader'}
        }
        if(method==='Network.getResponseBody')return {body:JSON.stringify(body)}
        if(method==='Runtime.evaluate'){
          const expression=params.expression
          if(expression.startsWith('(function readCreatorPageReadiness'))return {result:{value:{ready:true}}}
          if(expression.startsWith('(function readCreatorActivityGuard'))return {result:{value:null}}
          if(expression.startsWith('(async function readCreatorActivityOwner'))return {result:{value:{ok:true,owner:{uid:config.ownerUid,secUid:config.ownerSecUid},observedAt:new Date().toISOString()}}}
          if(expression.startsWith('(async function fetchCreatorActivityPage'))return {result:{value:await vm.runInNewContext(expression,pageContext)}}
          throw Error('UNEXPECTED_PAGE_CALL')
        }
        return {}
      }}}
  const fetchApi=async(path,options)=>({ok:true,json:async()=>{
    if(path.endsWith('/video-information-state'))return {runId:config.runId,phase:mode==='cancelled'?'cancelled':'running'}
    const report=JSON.parse(options.body);reports.push(report);return {phase:'completed'}
  }})
  return {config,chrome,fetchApi,requests,reports,methods,listeners,get closed(){return closed}}
}
test('single video runner reuses native response, cleans up and never issues a work GET',async()=>{
  const f=browserFixture();await runVideoInformation(f.config,{chromeApi:f.chrome,fetchApi:f.fetchApi,nativeWaitOptions:{arrivalWaitMs:0,waitMs:50}})
  assert.ok(f.reports[0].capture,JSON.stringify(f.reports));assert.equal(f.reports[0].capture.sourceProof.kind,'native-network')
  assert.equal(f.reports[0].capture.audit.activeWorkGets,0);assert.equal(f.requests.length,0);assert.equal(f.closed,true);assert.equal(f.listeners.size,0)
})
test('only a completely absent native request permits one controlled GET; observed denial never retries',async()=>{
  const f=browserFixture('missing');await runVideoInformation(f.config,{chromeApi:f.chrome,fetchApi:f.fetchApi,nativeWaitOptions:{arrivalWaitMs:0,waitMs:0}})
  assert.ok(f.reports[0].capture,JSON.stringify(f.reports));assert.equal(f.requests.length,1)
  assert.equal(f.reports[0].capture.sourceProof.kind,'active-get');assert.equal(f.reports[0].capture.audit.activeWorkGets,1)
  const denied=browserFixture('denied');await runVideoInformation(denied.config,{chromeApi:denied.chrome,fetchApi:denied.fetchApi})
  assert.equal(denied.requests.length,0);assert.equal(denied.reports[0].errorCode,'ACTIVITY_HTTP_403');assert.equal(denied.closed,false)
})
test('cancelled command never navigates or requests platform data',async()=>{
  const f=browserFixture('cancelled');await runVideoInformation(f.config,{chromeApi:f.chrome,fetchApi:f.fetchApi})
  assert.equal(f.methods.includes('Page.navigate'),false);assert.equal(f.requests.length,0);assert.equal(f.reports[0].errorCode,'VIDEO_CANCELLED')
})
