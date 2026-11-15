import test from 'node:test'
import assert from 'node:assert/strict'
import {projectDiscoveryPage} from '../browser-connector/following-extension/video-discovery-core.js'
import {projectVideoInformation} from '../browser-connector/following-extension/video-information-core.js'
const scope={authorUid:'author-uid',authorSecUid:'author-sec',start:'2026-09-30T16:00:00.000Z',endExclusive:'2026-10-01T16:00:00.000Z'}
function row(id,time,pinned=0){return {aweme_id:id,author:{uid:scope.authorUid,sec_uid:scope.authorSecUid},create_time:Date.parse(time)/1000,is_top:pinned,
  desc:'内容',aweme_type:0,is_story:0,is_24_story:0,status:{private_status:0,is_delete:false,is_prohibited:false,allow_share:true},video:{duration:60000,play_addr:{url_list:['https://v.douyinvod.com/temporary-media']}}}}
test('date discovery includes Beijing midnight and excludes the next day while retaining pinned boundary evidence',()=>{
  const root={status_code:0,has_more:1,max_cursor:100,aweme_list:[row('7000000001','2020-01-01T00:00:00Z',1),row('7000000002',scope.start),row('7000000003',scope.endExclusive)]}
  const result=projectDiscoveryPage(root,scope)
  assert.deepEqual(result.works.map(w=>w.workId),['7000000002']);assert.equal(result.records.length,3)
  assert.equal(JSON.stringify(result).includes('temporary-media'),false)
})
test('media is projected only for the selected verified work in the explicit evidence mode',()=>{
  const work=row('7000000002',scope.start),target={workId:work.aweme_id,...scope,publishedAt:scope.start}
  const input={status_code:0,has_more:0,max_cursor:0,aweme_list:[work]}
  assert.equal(projectVideoInformation(input,target).media,undefined)
  assert.equal(projectVideoInformation(input,{...target,captureEvidence:true}).media.urls.length,1)
  work.author.uid='wrong';assert.throws(()=>projectVideoInformation(input,{...target,captureEvidence:true}),/AUTHOR_MISMATCH/)
})
test('a missing known historical video is distinguished from a denied list, without weakening the old metadata entry',()=>{
  const input={status_code:0,has_more:0,max_cursor:0,aweme_list:[]},target={...scope,workId:'7000000002',publishedAt:scope.start}
  assert.throws(()=>projectVideoInformation(input,target),/NOT_IN_FIRST_PAGE/)
  assert.equal(projectVideoInformation(input,{...target,captureEvidence:true}).targetMissing,true)
  assert.throws(()=>projectVideoInformation({...input,status_code:1},{...target,captureEvidence:true}),/REJECTED/)
})
