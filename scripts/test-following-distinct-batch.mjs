import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const timerSource=readFileSync(new URL('../browser-connector/following-extension/following-timing.js',import.meta.url),'utf8')
const collectorSource=readFileSync(new URL('../browser-connector/following-extension/following-batch.js',import.meta.url),'utf8')
async function collect({ mismatch=false,hydrateOwner=false,hydrateAvatar=false,restoredHiddenDialog=false,prepareOnly=false }={}) {
  const cards=Array.from({length:40},(_,index)=>{
    const secUid=`sec-${index}`
    const nickname=index===30?'🇨🇳挪威老王🇳🇴':`博主${index}`
    const nameMarkup=index===30?'<img alt="🇨🇳">挪威老王<img alt="🇳🇴">':nickname
    return `<article><a href="/user/${secUid}"><img src="https://example.com/avatar-${index}.jpg" alt="${mismatch&&index===30?'另一位博主头像':nickname+'头像'}"></a>
      <div><a href="/user/${secUid}">${nameMarkup}</a><div class="ceyzKypd">${index===30?'<img alt="🇨🇳">中挪情侣<img alt="🇳🇴">':'公开简介'}</div></div>
      <button>已关注</button></article>`
  }).join('')
  const dom=new JSDOM(`<img alt="当前账号头像"><div data-e2e="user-info-follow">关注292</div><div><div role="tab" aria-selected="true">关注 (292)</div>
    <div data-e2e="user-fans-container" style="overflow-y:auto">${cards}</div></div>`,
    {url:'https://www.douyin.com/user/self',runScripts:'outside-only'})
  const {window}=dom
  let elapsed=0
  window.structuredClone=structuredClone
  Object.defineProperty(window.performance,'now',{value:()=>elapsed})
  window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200})
  // jsdom has no layout hit testing; provide the following-control hit used
  // only by the legacy collector's failure diagnostic.
  window.document.elementFromPoint=()=>window.document.querySelector('[data-e2e="user-info-follow"]')
  window.HTMLElement.prototype.scrollIntoView=()=>{}
  const root=window.document.querySelector('[data-e2e="user-fans-container"]')
  Object.defineProperty(root,'scrollHeight',{value:5000})
  Object.defineProperty(root,'clientHeight',{value:300})
  for(const image of window.document.images){
    Object.defineProperty(image,'complete',{value:true})
    Object.defineProperty(image,'naturalWidth',{value:100})
  }
  if(restoredHiddenDialog){
    root.hidden=true
    let clicks=0
    window.document.querySelector('[data-e2e="user-info-follow"]').onclick=()=>{if(++clicks===2)root.hidden=false}
  }
  if(hydrateOwner){
    const owner=window.document.querySelector('img[alt="当前账号头像"]')
    owner.alt='';setTimeout(()=>{owner.alt='当前账号头像'},10)
  }
  if(hydrateAvatar){
    const avatar=window.document.querySelector('img[alt="博主20头像"]')
    avatar.alt='';setTimeout(()=>{avatar.alt='博主20头像'},10)
  }
  window.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG={batchNumber:3,limit:20,ownerNickname:'当前账号',
    prepareOnly,
    excludeSecUids:Array.from({length:20},(_,index)=>`sec-${index}`)}
  try {
    window.eval(timerSource+'\n'+collectorSource)
    return await window.collectVisibleFollowingBatch(window.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG)
  } finally {window.close()}
}
test('collects twenty new authors, keeps emoji names separate from avatar links and records timing',async()=>{
  const result=await collect()
  assert.equal(result.ok,true)
  assert.equal(result.creators.length,20)
  assert.equal(result.skippedSavedCount,20)
  assert.equal(result.visibleItemCount,40)
  assert.deepEqual(Array.from(result.creators,item=>item.secUid),Array.from({length:20},(_,index)=>`sec-${20+index}`))
  assert.equal(result.creators[10].nickname,'🇨🇳挪威老王🇳🇴')
  assert.equal(result.creators[10].signature,'🇨🇳中挪情侣🇳🇴')
  assert.equal(result.bindings[10].imageAlt,'🇨🇳挪威老王🇳🇴头像')
  assert.equal(result.timing.successfulCount,20)
  assert.equal(result.timing.totalMs,0)
  assert.equal(result.timing.averageMsPerCreator,0)
  assert.equal(result.timing.records.length,20)
})
test('a mismatched avatar blocks the batch before accepting author records',async()=>{
  const result=await collect({mismatch:true})
  assert.equal(result.ok,false)
  assert.match(result.error,/Avatar identity missing/)
  assert.equal(result.creators,undefined)
  assert.equal(result.timing.status,'failed')
  assert.equal(result.timing.successfulCount,0)
  assert.equal(result.timing.averageMsPerCreator,null)
})
test('waits for account and author hydration events without treating unloaded nodes as mismatches',async()=>{
  const result=await collect({hydrateOwner:true,hydrateAvatar:true})
  assert.equal(result.ok,true)
  assert.equal(result.creators.length,20)
  assert.equal(result.creators[0].secUid,'sec-20')
})
test('a hidden restored list does not suppress the retry of the following entry',async()=>{
  const result=await collect({restoredHiddenDialog:true})
  assert.equal(result.ok,true);assert.equal(result.creators.length,20)
  assert.equal(result.creators[0].secUid,'sec-20')
})
test('startup preparation proves the real source without reading author fields',async()=>{
  const result=await collect({prepareOnly:true,mismatch:true})
  assert.equal(result.ok,true);assert.equal(result.prepared,true)
  assert.equal(result.ownerNickname,'当前账号');assert.equal(result.uniqueFollowingList,true)
  assert.equal(result.creators,undefined);assert.equal(result.bindings,undefined)
})
