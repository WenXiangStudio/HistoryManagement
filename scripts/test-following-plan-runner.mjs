import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFollowingPlanRequest,runFollowingPlan} from '../browser-connector/following-extension/following-plan-runner.js'
const owner={uid:'owner-uid',secUid:'owner',nickname:'本人'}
const row=index=>({uid:'uid-'+index,sec_uid:'sec-'+index,nickname:'博主'+index,signature:index===0?'':undefined,avatar_thumb:{url_list:['https://example.com/'+index+'.jpg']}})
function environment({cancelAfterPage=false,loginRequired=false,basic=false}={}){
  const platform=[],posts=[],tabs=[],commands=[];let pageSaved=0
  const config={action:basic?'basic':'list',runId:'run',ownerSecUid:'owner',origin:'http://127.0.0.1:1234',token:'local-token',cursor:0,offset:0,pageCount:0,
    targets:basic?[{uid:'uid-0',secUid:'sec-0',nickname:'博主0',avatarUrl:null,signature:null,profileUrl:'https://www.douyin.com/user/sec-0'}]:undefined}
  const context=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
    platform.push(url);assert.equal(options.method,'GET')
    let body
    if(url.startsWith('/aweme/v1/web/user/profile/self/'))body=loginRequired?{status_code:8}:{status_code:0,user:{uid:owner.uid,sec_uid:owner.secUid,nickname:owner.nickname}}
    else if(url.startsWith('/aweme/v1/web/user/profile/other/'))body={status_code:0,user:row(0)}
    else{assert.ok(url.startsWith('/aweme/v1/web/user/following/list/'));const cursor=new URL('https://www.douyin.com'+url).searchParams.get('max_time');body={status_code:0,myself_user_id:owner.uid,followings:[row(cursor==='0'?0:1)],has_more:cursor==='0'?1:0,min_time:100,offset:0}}
    return {status:200,text:async()=>JSON.stringify(body)}
  }})
  const chromeApi={tabs:{query:async()=>[{id:1}],create:async value=>{tabs.push(value);return {id:1}},get:async()=>({url:'https://www.douyin.com/user/self',status:'complete'})},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_target,method,params)=>{commands.push(method);return {result:{value:await vm.runInContext(params.expression,context)}}}}}
  const fetchApi=async(url,options)=>{
    assert.ok(url.startsWith(config.origin),'outside-page traffic stays on loopback')
    const path=new URL(url).pathname
    if(options.method==='POST'){const body=JSON.parse(options.body);posts.push({path,body});if(path==='/list-page')pageSaved++;return {ok:true,json:async()=>({phase:'running'})}}
    return {ok:true,json:async()=>({runId:'run',phase:cancelAfterPage&&pageSaved?'cancelled':'running'})}
  }
  return {config,chromeApi,fetchApi,platform,posts,tabs,commands}
}
test('full list follows server cursors and saves each page without opening creator pages or reading works',async()=>{
  const env=environment();await runFollowingPlan(env.config,env)
  assert.equal(env.platform.length,3);assert.equal(env.posts.filter(row=>row.path==='/list-page').length,2)
  const pages=env.posts.filter(row=>row.path==='/list-page').map(row=>row.body.page)
  assert.equal(pages[0].creators[0].signature,'');assert.equal(pages[1].creators[0].signature,null)
  assert.equal(pages[1].requestCursor,100);assert.equal(pages[1].position,2)
  assert.equal(env.tabs.length,0);assert.ok(env.platform.every(url=>!url.includes('aweme/post')))
})
test('cancelled collection makes no next-page request and no successful final report',async()=>{
  const env=environment({cancelAfterPage:true});await runFollowingPlan(env.config,env)
  assert.equal(env.platform.length,2);assert.equal(env.posts.filter(row=>row.path==='/list-page').length,1)
})
test('logged out owner stops before following or creator requests',async()=>{
  const env=environment({loginRequired:true});const result=await runFollowingPlan(env.config,env)
  assert.equal(result.code,'LOGIN_REQUIRED');assert.equal(env.platform.length,1);assert.equal(env.posts.at(-1).body.code,'LOGIN_REQUIRED')
})
test('basic completion uses saved creator identity with no following, work or page-navigation requests',async()=>{
  const env=environment({basic:true});await runFollowingPlan(env.config,env)
  assert.equal(env.platform.length,2);assert.ok(env.platform[1].includes('profile/other'))
  assert.equal(env.posts.find(row=>row.path==='/basic-report').body.capture.creator.signature,'')
  assert.equal(env.tabs.length,0);assert.equal(env.posts.at(-1).path,'/basic-progress')
})
test('wrong creator identity cannot produce a basic profile capture',async()=>{
  const prior=globalThis.fetch
  try{
    globalThis.fetch=async()=>({status:200,text:async()=>JSON.stringify({status_code:0,user:row(1)})})
    const result=await readFollowingPlanRequest({kind:'basic',creator:{uid:'uid-0',secUid:'sec-0'},ownerSecUid:'owner'})
    assert.equal(result.ok,false);assert.equal(result.code,'CREATOR_IDENTITY_MISMATCH')
  }finally{globalThis.fetch=prior}
})
