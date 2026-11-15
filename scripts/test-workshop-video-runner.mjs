import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {projectWorkshopDetail,readWorkshopPage,runWorkshopVideo} from '../browser-connector/following-extension/workshop-video-runner.js'

const workId='7684211392850186216',mediaUrl='https://v26-web.douyinvod.com/signed/video.mp4',url=`https://www.douyin.com/video/${workId}`
const config={action:'workshop-video',runId:'workshop-test',url,expectedWorkId:workId,origin:'http://127.0.0.1:43210',token:'test'}
const detail=(id=workId)=>({status_code:0,aweme_detail:{aweme_id:id,desc:'测试作品',author:{nickname:'作者'},video:{play_addr:{url_list:[mediaUrl]}}}})
function harness({native=true,raw=detail(),page={},activeResult,finalUrl=url}={}){
  let event=null,detach=null,attached=false
  const commands=[],reports=[],removed=[],navigations=[],requests=[]
  const chrome={
    tabs:{create:async input=>{assert.deepEqual(input,{url:'about:blank',active:false});return {id:101}},get:async()=>({id:101,url:finalUrl}),remove:async id=>removed.push(id)},
    debugger:{
      attach:async target=>{assert.equal(target.tabId,101);attached=true},detach:async()=>{},
      onDetach:{addListener:fn=>{detach=fn},removeListener:fn=>{if(detach===fn)detach=null}},
      onEvent:{addListener:fn=>{event=fn},removeListener:fn=>{if(event===fn)event=null}},
      sendCommand:async(target,method,params)=>{
        assert.equal(target.tabId,101);commands.push({method,params})
        if(method==='Page.navigate'){
          assert.equal(attached,true);navigations.push(params.url)
          if(native){event(target,'Network.responseReceived',{requestId:'detail-1',response:{url:`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${workId}`,status:200}});event(target,'Network.loadingFinished',{requestId:'detail-1',encodedDataLength:1000})}
        }
        if(method==='Network.getResponseBody')return {body:JSON.stringify(raw),base64Encoded:false}
        if(method==='Runtime.evaluate'){
          if(params.expression.includes('fetchWorkshopDetail'))return {result:{value:{media:activeResult??projectWorkshopDetail(raw,workId)}}}
          return {result:{value:{ready:true,...page}}}
        }
        return {}
      }
    }
  }
  const fetchApi=async(endpoint,init)=>{
    requests.push({endpoint,init});assert.equal(init.headers.authorization,'Bearer test')
    if(endpoint.endsWith('/workshop-video-state'))return {ok:true,json:async()=>({runId:config.runId,phase:'running'})}
    if(endpoint.endsWith('/workshop-video-report')){reports.push(JSON.parse(init.body));return {ok:true,json:async()=>({ok:true})}}
    throw Error('Unexpected APP request')
  }
  return {options:{chromeApi:chrome,fetchApi,nativeWaitMs:5,pause:()=>new Promise(resolve=>setTimeout(resolve,2))},commands,reports,removed,navigations,requests}
}
test('projects only the exact public work and trusted video media',()=>{
  assert.deepEqual(projectWorkshopDetail(detail(),workId),{workId,mediaUrl,title:'测试作品',authorName:'作者'})
  assert.throws(()=>projectWorkshopDetail(detail('7684211392850186217'),workId),/ID_MISMATCH/)
  const privateWork=detail();privateWork.aweme_detail.status={private_status:1}
  assert.throws(()=>projectWorkshopDetail(privateWork,workId),/UNAVAILABLE/)
  const malicious=detail();malicious.aweme_detail.video.play_addr.url_list=['https://evil.example/video.mp4']
  assert.equal(projectWorkshopDetail(malicious,workId),null)
})
test('downloads one native video without owner, following or active detail requests and closes only its own tab',async()=>{
  const run=harness(),report=await runWorkshopVideo(config,run.options)
  assert.deepEqual(report,{runId:config.runId,media:{workId,mediaUrl,title:'测试作品',authorName:'作者',pageUrl:url}})
  assert.deepEqual(run.navigations,[url]);assert.deepEqual(run.removed,[101]);assert.equal(run.reports.length,1)
  assert.equal(run.commands.some(entry=>entry.params?.expression?.includes('fetchWorkshopDetail')),false)
  assert.equal(run.commands.some(entry=>entry.params?.expression?.includes('cookie')),false)
})
test('does not retry a mismatched native work with an active request',async()=>{
  const run=harness({raw:detail('7684211392850186217')}),report=await runWorkshopVideo(config,run.options)
  assert.equal(report.errorCode,'WORKSHOP_VIDEO_ID_MISMATCH');assert.deepEqual(run.removed,[101])
  assert.equal(run.commands.some(entry=>entry.params?.expression?.includes('fetchWorkshopDetail')),false)
})
test('permits one ordinary same-origin detail GET only when native detail is absent',async()=>{
  const run=harness({native:false}),report=await runWorkshopVideo(config,run.options)
  assert.equal(report.media.workId,workId)
  const active=run.commands.filter(entry=>entry.params?.expression?.includes('fetchWorkshopDetail'))
  assert.equal(active.length,1);assert.match(active[0].params.expression,/credentials:'include'/)
  assert.match(active[0].params.expression,/redirect:'error'/)
})
test('stops on a captcha and reports a final page identity mismatch',async()=>{
  const blocked=harness({native:false,page:{errorCode:'WORKSHOP_CAPTCHA_REQUIRED'}})
  assert.equal((await runWorkshopVideo(config,blocked.options)).errorCode,'WORKSHOP_CAPTCHA_REQUIRED')
  assert.equal(blocked.commands.some(entry=>entry.params?.expression?.includes('fetchWorkshopDetail')),false)
  const changed=harness({finalUrl:'https://www.douyin.com/video/7684211392850186217'})
  assert.equal((await runWorkshopVideo(config,changed.options)).errorCode,'WORKSHOP_VIDEO_ID_MISMATCH')
})
test('DOM evidence needs a video container explicitly bearing the requested work ID',()=>{
  let selector
  const context={location:{origin:'https://www.douyin.com',pathname:`/video/${workId}`,href:url},document:{readyState:'complete',body:{innerText:'视频作品'},querySelector:value=>{selector=value;return null}}}
  assert.deepEqual({...vm.runInNewContext(`(${readWorkshopPage.toString()})('${workId}')`,context)},{ready:true})
  assert.match(selector,new RegExp(`data-aweme-id="${workId}"`))
  context.document.querySelector=value=>value.includes('data-aweme-id')?{querySelector:()=>({currentSrc:mediaUrl})}:null
  const page=vm.runInNewContext(`(${readWorkshopPage.toString()})('${workId}')`,context)
  assert.equal(page.media.workId,workId);assert.equal(page.media.mediaUrl,mediaUrl)
})
