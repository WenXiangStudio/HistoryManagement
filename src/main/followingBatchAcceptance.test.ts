import { describe,it,expect } from 'vitest'
import { acceptFollowingCapture } from './followingBatchAcceptance'
import { FollowingDirectoryStore } from './followingDirectoryStore'

function input(){
  const creators=Array.from({length:20},(_,index)=>({uid:null,secUid:`new-${index}`,nickname:`博主${index}`,
    profileUrl:`https://www.douyin.com/user/new-${index}`,avatarUrl:`https://example.com/${index}.jpg`,signature:'简介'}))
  return {ok:true,collectedAt:'2026-10-01T00:00:00.000Z',ownerNickname:'当前账号',sourceUrl:'https://www.douyin.com/user/self',
    activeFollowingTab:true,listStartedAtTop:true,hasMore:true,visibleItemCount:60,activeApiRequests:0,workResponseBodiesRead:0,
    requestedCount:20,creators,bindings:creators.map(item=>({...item,imageAlt:`${item.nickname}头像`,imageLoaded:true,
      anchorProfileUrl:item.profileUrl,avatarLinkUrl:item.profileUrl,nicknameAnchorProfileUrl:item.profileUrl,
      relationship:'已关注',bindingMethod:'image-and-signature-inside-exact-profile-card'})),
    timing:{status:'completed',totalMs:50,successfulCount:20,averageMsPerCreator:2.5}}
}
const scope={runId:'fast-run',limit:20 as const,ownerNickname:'当前账号',excludeSecUids:['saved-author']}
describe('continuous following batch acceptance',()=>{
  it('validates the entire captured batch, then persists it through the existing store',()=>{
    const accepted=acceptFollowingCapture(input(),scope),store=new FollowingDirectoryStore(':memory:')
    try{
      store.accept(accepted.report)
      expect(store.list()).toHaveLength(20)
      expect(store.list()[0]).toMatchObject({nickname:'博主0',profileUrl:'https://www.douyin.com/user/new-0'})
      expect(accepted.acquisitionMs).toBe(50)
    }finally{store.close()}
  })
  it('rejects duplicate saved identities, wrong account and partial completion',()=>{
    expect(()=>acceptFollowingCapture(input(),{...scope,excludeSecUids:['new-0']})).toThrow(/已保存/)
    expect(()=>acceptFollowingCapture(input(),{...scope,ownerNickname:'另一账号'})).toThrow(/账号/)
    const partial=input();partial.creators.pop()
    expect(()=>acceptFollowingCapture(partial,scope)).toThrow(/数量/)
  })
  it('rejects avatar/description/URL reassignment before constructing a report',()=>{
    for(const field of ['avatarUrl','signature','nicknameAnchorProfileUrl'] as const){
      const changed=input();changed.bindings[0][field]=field==='signature'?'错位简介':'https://example.com/another.jpg'
      expect(()=>acceptFollowingCapture(changed,scope)).toThrow(/归属/)
    }
    const notLoaded=input();notLoaded.bindings[0].imageLoaded=false
    expect(()=>acceptFollowingCapture(notLoaded,scope)).toThrow()
  })
  it('accepts a same-card live avatar but rejects unrelated image link origins',()=>{
    const live=input();live.bindings[0].anchorProfileUrl=null as unknown as string
    live.bindings[0].avatarLinkUrl='https://live.douyin.com/123'
    expect(acceptFollowingCapture(live,scope).report.creators).toHaveLength(20)
    live.bindings[0].avatarLinkUrl='https://example.com/unrelated'
    expect(()=>acceptFollowingCapture(live,scope)).toThrow(/来源/)
  })
})
