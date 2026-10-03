import {describe,it,expect} from 'vitest'
import {acceptStructuredFollowingCapture,verifyStructuredSource} from './structuredFollowingAcceptance'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {createHash} from 'node:crypto'
const rows=Array.from({length:11},(_,index)=>({uid:`uid-${index}`,secUid:`sec-${index}`,nickname:`博主${index}`,avatarUrl:`https://example.com/${index}.jpg`,signature:'简介',profileUrl:`https://www.douyin.com/user/sec-${index}`}))
const scope={runId:'new',limit:10 as const,ownerNickname:'当前账号',ownerSecUid:'owner',excludeSecUids:['sec-0']}
const capture=()=>({ok:true,contract:'signaldesk-structured-following-capture/v1',prepared:false,sourceUrl:'https://www.douyin.com/user/self',
  owner:{uid:'owner-uid',secUid:'owner',nickname:'当前账号'},requestedCount:10,creators:rows.slice(1),
  pages:[{position:1,requestOwnerSecUid:'owner',responseOwnerUid:'owner-uid',requestMaxTime:0,requestOffset:0,responseMinTime:100,responseOffset:0,hasMore:true,creators:rows}],
  selfStatusCode:0,followingStatusCode:0,activeApiRequests:2,workResponseBodiesRead:0,domQueries:0,uiClicks:0,collectedAt:'2026-10-03T08:00:00.000Z',hasMore:true,seenCount:11,acquisitionMs:120})
describe('structured following ownership and legacy retention',()=>{
  it('accepts only new author rows tied to the verified native owner and response',()=>{
    expect(acceptStructuredFollowingCapture(capture(),scope).report.creators).toEqual(rows.slice(1))
    const bad=capture();bad.pages[0].creators[1]={...bad.pages[0].creators[1],avatarUrl:'https://example.com/wrong.jpg'}
    expect(()=>acceptStructuredFollowingCapture(bad,scope)).toThrow('接口来源')
    expect(()=>verifyStructuredSource(capture(),{ownerNickname:'当前账号',ownerSecUid:'other'})).toThrow('账号')
  })
  it('keeps historical creator IDs, stars and notes visible when adding native-identity batches',()=>{
    const store=new FollowingDirectoryStore(':memory:')
    try{
      const creators=[{...rows[0],uid:null}]
      store.accept({contract:'signaldesk-visible-following/v1',runId:'old',collectedAt:'2026-10-01T00:00:00.000Z',ownerSecUid:null,ownerNickname:'当前账号',
        sourceUrl:'https://www.douyin.com/user/self',sourceKind:'visible-following-list',activeFollowingTab:true,listStartedAtTop:true,hasMore:true,visibleItemCount:1,
        creators,projectionSha256:createHash('sha256').update(JSON.stringify(creators)).digest('hex'),activeApiRequests:0,workResponseBodiesRead:0})
      const prior=store.list()[0];store.update(prior.id,{isStarred:true,note:'保留批注'})
      store.accept(acceptStructuredFollowingCapture(capture(),scope).report)
      expect(store.list()).toHaveLength(11)
      expect(store.list()[0]).toMatchObject({id:prior.id,isStarred:true,note:'保留批注',nickname:prior.nickname})
      expect(store.latest()?.ownerSecUid).toBe('owner')
    }finally{store.close()}
  })
  it('switches between same-name accounts without mixing shared creators or local annotations',()=>{
    const store=new FollowingDirectoryStore(':memory:')
    try{
      store.recordAccount({secUid:'owner',uid:'owner-uid',nickname:'当前账号'},{label:'个人',chromeProfile:'Default'})
      store.accept(acceptStructuredFollowingCapture(capture(),scope).report)
      store.selectAccount('owner')
      const personal=store.list()[0];store.update(personal.id,{isStarred:true,note:'个人批注'})
      store.recordAccount({secUid:'owner-b',uid:'owner-b-uid',nickname:'当前账号'},{label:'工作',chromeProfile:'Profile 1'})
      store.selectAccount('owner-b');expect(store.list()).toEqual([]);expect(store.latest()).toBeNull()
      const second=capture();second.owner={secUid:'owner-b',uid:'owner-b-uid',nickname:'当前账号'}
      second.pages[0].requestOwnerSecUid='owner-b';second.pages[0].responseOwnerUid='owner-b-uid'
      store.accept(acceptStructuredFollowingCapture(second,{...scope,ownerSecUid:'owner-b',runId:'second'}).report)
      const work=store.list()[0];expect(work.id).not.toBe(personal.id);expect(work.note).toBe('');expect(work.isStarred).toBe(false)
      store.update(work.id,{note:'工作批注'})
      store.selectAccount('owner');expect(store.list()[0]).toMatchObject({id:personal.id,note:'个人批注',isStarred:true})
      store.selectAccount('owner-b');expect(store.list()[0]).toMatchObject({id:work.id,note:'工作批注',isStarred:false})
      expect(store.accounts().map(account=>[account.label,account.creatorCount])).toEqual([['个人',10],['工作',10]])
    }finally{store.close()}
  })
})
