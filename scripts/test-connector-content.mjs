import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'https://www.douyin.com/user/self?showTab=follow',
  runScripts: 'outside-only'
})
let windowScrollCount = 0
dom.window.scrollTo = () => { windowScrollCount += 1 }
dom.window.scrollBy = () => { windowScrollCount += 1 }
dom.window.setTimeout = (callback) => {
  queueMicrotask(callback)
  return 1
}

let listener = null
dom.window.chrome = {
  runtime: {
    onMessage: {
      addListener(callback) {
        listener = callback
      }
    }
  }
}

const source = readFileSync(resolve('browser-connector/extension/content.js'), 'utf8')
dom.window.eval(source)
assert.equal(typeof listener, 'function', 'content script did not register its message listener')

function invoke(command) {
  return new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error(`collector timed out: ${command.action}`)), 2_000)
    listener({ type: 'signaldesk.collect', command }, null, (result) => {
      clearTimeout(timeout)
      resolveResult(result)
    })
  })
}

async function collect(command) {
  const result = await invoke(command)
  assert.equal(result?.ok, true, result?.error || `collector failed: ${command.action}`)
  return result.envelope
}

function member(id, nickname = `博主${id}`) {
  return `<div role="listitem"><a href="https://www.douyin.com/user/${id}"><img alt="${nickname}"></a><a href="https://www.douyin.com/user/${id}">${nickname}</a></div>`
}

function followingFixture(ids, { active = true, empty = false, ended = false } = {}) {
  return `
    <nav><a href="https://www.douyin.com/user/navigation-noise">导航账号</a></nav>
    <div role="tablist"><button id="following-tab" role="tab" aria-selected="${active}" aria-controls="following-panel">关注</button></div>
    <section id="following-panel" role="tabpanel" aria-labelledby="following-tab">
      <div id="verified-following-list" role="list" aria-label="关注账号列表">
        ${ids.map((id) => member(id)).join('')}
        <section aria-label="推荐账号"><div role="list" aria-label="推荐账号列表">${member('nested-recommendation', '内嵌推荐')}</div></section>
        ${empty ? '<div role="status" data-e2e="following-list-empty">暂无关注</div>' : ''}
        ${ended ? '<div role="status" data-e2e="following-list-end">没有更多了</div>' : ''}
      </div>
    </section>
    <aside><a href="https://www.douyin.com/user/sidebar-noise">侧栏推荐</a></aside>
  `
}

function relationshipDialogMember(id, nickname = `弹窗博主${id}`, relationship = '已关注') {
  return `
    <div class="relation-row">
      <div><a href="//www.douyin.com/user/${id}" target="_blank" rel="noopener noreferrer"><span data-e2e="live-avatar" role="listitem"><img alt="${nickname}头像"></span></a></div>
      <div class="profile-copy"><span>${nickname}</span><span>公开简介</span></div>
      <button type="button">${relationship}</button>
    </div>
  `
}

function relationshipDialogFixture(ids, { active = 'following', relationship = '已关注' } = {}) {
  return `
    <main><a href="https://www.douyin.com/user/background-noise">背景作品作者</a></main>
    <div class="relation-dialog">
      <div class="semi-tabs semi-tabs-top">
        <div role="tablist" aria-orientation="horizontal">
          <div role="tab" id="semiTab0" aria-controls="semiTabPanel0" aria-selected="${active === 'following'}" class="${active === 'following' ? 'semi-tabs-tab-active' : ''}">关注（273）</div>
          <div role="tab" id="semiTab1" aria-controls="semiTabPanel1" aria-selected="${active === 'fans'}" class="${active === 'fans' ? 'semi-tabs-tab-active' : ''}">粉丝（105）</div>
        </div>
      </div>
      <div id="semiTabPanel0"></div>
      <div data-e2e="user-fans-container" style="overflow-y: auto">
        ${ids.map((id) => relationshipDialogMember(id, `真实关注${id}`, relationship)).join('')}
      </div>
    </div>
  `
}

function commentItem(index, body = `公开评论${index}`, { withId = true, author = `观众${index}` } = {}) {
  return `
    <div data-e2e="comment-item" ${withId ? `data-comment-id="comment-${index}"` : ''}>
      <div class="comment-item-avatar"><a href="https://www.douyin.com/user/viewer-${index}"><img alt="${author}"></a></div>
      <div class="comment-copy">
        <div class="comment-item-info-wrap"><a href="https://www.douyin.com/user/viewer-${index}">${author}</a></div>
        <div class="comment-body"><span>${body}</span></div>
        <div class="comment-actions">1月前 · 广东　回复　分享</div>
      </div>
    </div>
  `
}

function commentListFixture(items) {
  return `
    <div data-e2e="comment-input"><div role="textbox">留下你的精彩评论吧</div><button data-e2e="comment-button">32</button></div>
    <div data-e2e="comment-list" class="random-token comment-mainContent">
      <div>${items.join('')}</div>
    </div>
  `
}

dom.window.document.body.innerHTML = followingFixture(['creator-1', 'creator-2', 'creator-3', 'creator-4'])
const following = await collect({ commandId: 'following', action: 'collect_following', payload: { creatorLimit: 3 } })
assert.equal(JSON.stringify(following.items.map((item) => item.creatorId)), JSON.stringify(['creator-1', 'creator-2', 'creator-3']))
assert.equal(following.completeness, 'partial')
assert.equal(following.hasMore, true)
assert.match(following.reason, /最多采集 3 位博主/)
assert.equal(JSON.stringify(following.sourceProof.creatorIds), JSON.stringify(['creator-1', 'creator-2', 'creator-3']))
assert.equal(following.sourceProof.contract, 'douyin-following-source-proof/v1')
assert.equal(following.sourceProof.extractionScope, 'verified-following-list-container')
assert.equal(following.sourceProof.scrollRootKind, 'not-needed')
assert.equal(windowScrollCount, 0)

dom.window.document.body.innerHTML = relationshipDialogFixture(['modal-creator-1', 'modal-creator-2'])
const relationshipDialog = await collect({ commandId: 'relationship-dialog', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(JSON.stringify(relationshipDialog.items.map((item) => item.creatorId)), JSON.stringify(['modal-creator-1']))
assert.equal(relationshipDialog.items[0].nickname, '真实关注modal-creator-1')
assert.equal(relationshipDialog.items[0].isFollowing, true)
assert.equal(relationshipDialog.sourceProof.containerIdentity, 'data-e2e:user-fans-container')
assert.equal(relationshipDialog.sourceProof.scrollRootKind, 'not-needed')
assert.equal(relationshipDialog.completeness, 'partial')

dom.window.document.body.innerHTML = relationshipDialogFixture(['fan-1'], { active: 'fans' })
const fansTab = await invoke({ commandId: 'fans-dialog', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(fansTab.ok, false)
assert.match(fansTab.error, /无法唯一验证已激活/)

dom.window.document.body.innerHTML = relationshipDialogFixture(['unproven-1'], { relationship: '关注' })
const unprovenRelationship = await invoke({ commandId: 'unproven-relationship', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(unprovenRelationship.ok, false)
assert.match(unprovenRelationship.error, /缺少明确的“已关注”关系标记/)

dom.window.document.body.innerHTML = `${relationshipDialogFixture(['dialog-1'])}${relationshipDialogFixture(['dialog-2'])}`
const duplicateDialog = await invoke({ commandId: 'duplicate-dialog', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(duplicateDialog.ok, false)
assert.match(duplicateDialog.error, /无法唯一验证已激活/)

dom.window.document.body.innerHTML = `
  <button role="tab" aria-selected="true" aria-controls="missing-panel">关注</button>
  <aside>${member('only-page-noise', '页面杂项账号')}</aside>
`
const missingSurface = await invoke({ commandId: 'missing-surface', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(missingSurface.ok, false)
assert.match(missingSurface.error, /无法唯一验证关注列表根容器/)

dom.window.document.body.innerHTML = followingFixture(['creator-1'], { active: false })
const inactiveTab = await invoke({ commandId: 'inactive-tab', action: 'collect_following', payload: { creatorLimit: 1 } })
assert.equal(inactiveTab.ok, false)
assert.match(inactiveTab.error, /无法唯一验证已激活/)

dom.window.document.body.innerHTML = followingFixture([])
const scrollingList = dom.window.document.getElementById('verified-following-list')
scrollingList.querySelector('section[aria-label="推荐账号"]').insertAdjacentHTML('beforebegin', member('creator-1'))
scrollingList.style.overflowY = 'auto'
Object.defineProperty(scrollingList, 'scrollHeight', { configurable: true, get: () => 1_000 })
Object.defineProperty(scrollingList, 'clientHeight', { configurable: true, get: () => 100 })
let elementScrollCount = 0
scrollingList.scrollTo = () => {
  elementScrollCount += 1
  if (elementScrollCount === 1) {
    const recommendation = scrollingList.querySelector('section[aria-label="推荐账号"]')
    for (const child of [...scrollingList.children]) {
      if (child !== recommendation) child.remove()
    }
    recommendation.insertAdjacentHTML('beforebegin', `${member('creator-2')}${member('creator-3')}`)
  }
}
const scrolledFollowing = await collect({ commandId: 'internal-scroll', action: 'collect_following', payload: { creatorLimit: 3 } })
assert.equal(JSON.stringify(scrolledFollowing.items.map((item) => item.creatorId)), JSON.stringify(['creator-1', 'creator-2', 'creator-3']))
assert.equal(scrolledFollowing.sourceProof.scrollRootKind, 'element')
assert.equal(elementScrollCount, 1)
assert.equal(windowScrollCount, 0)

dom.window.document.body.innerHTML = followingFixture([], { empty: true })
const emptyFollowing = await collect({ commandId: 'empty-following', action: 'collect_following', payload: { creatorLimit: 3 } })
assert.equal(JSON.stringify(emptyFollowing.items), '[]')
assert.equal(emptyFollowing.completeness, 'complete')
assert.equal(emptyFollowing.hasMore, false)
assert.equal(emptyFollowing.sourceProof.emptyStateEvidence, 'verified-empty-state')

const unknownAction = await invoke({ commandId: 'unknown', action: 'collect_everything', payload: {} })
assert.equal(unknownAction.ok, false)
assert.match(unknownAction.error, /不支持的浏览器采集动作/)

dom.reconfigure({ url: 'https://www.douyin.com/user/creator-1' })
dom.window.document.body.innerHTML = Array.from({ length: 4 }, (_, index) => `<article><a href="https://www.douyin.com/video/work-${index + 1}"><img alt="作品${index + 1}"></a></article>`).join('')
const works = await collect({ commandId: 'works', action: 'collect_creator_works', payload: { creatorId: 'creator-1', worksPerCreator: 2 } })
assert.equal(works.items.length, 2)
assert.equal(works.items[0].metrics.likeCount, null)
assert.equal(works.items[0].metrics.visibility.like, 'unknown')
assert.match(works.reason, /最多采集 2 个作品/)

dom.reconfigure({ url: 'https://www.douyin.com/video/work-1' })
dom.window.document.title = '真实作品 - 抖音'
dom.window.document.body.innerHTML = commentListFixture(Array.from({ length: 4 }, (_, index) => commentItem(index + 1)))
const comments = await collect({ commandId: 'comments', action: 'collect_work_comments', payload: { creatorId: 'creator-1', workId: 'work-1', commentsPerWork: 2 } })
assert.equal(comments.items.filter((item) => item.entityType === 'comment').length, 2)
assert.equal(comments.items[0].entityType, 'work')
assert.equal(JSON.stringify(comments.items[0].metrics.visibility), JSON.stringify({ like: 'unknown', comment: 'unknown', collect: 'unknown', share: 'unknown' }))
assert.equal(comments.sourceProof.contract, 'douyin-comment-source-proof/v1')
assert.equal(comments.sourceProof.containerIdentity, 'data-e2e:comment-list')
assert.equal(comments.sourceProof.itemIdentity, 'data-e2e:comment-item')
assert.equal(JSON.stringify(comments.sourceProof.commentIds), JSON.stringify(['comment-1', 'comment-2']))
assert.equal(comments.items[1].publicAuthorName, '观众1')
assert.equal(comments.items[1].body, '公开评论1')
assert.equal(comments.items[1].commentIdKind, 'page-attribute')
assert.match(comments.reason, /最多采集 2 条评论/)

dom.window.document.body.innerHTML = commentListFixture([
  commentItem('numeric', '32'),
  commentItem('synthetic', '哪个agent', { withId: false, author: 'FanFan' })
])
const strictComments = await collect({ commandId: 'strict-comments', action: 'collect_work_comments', payload: { creatorId: 'creator-1', workId: 'work-1', commentsPerWork: 1 } })
const strictItem = strictComments.items.find((item) => item.entityType === 'comment')
assert.equal(strictItem.body, '哪个agent')
assert.equal(strictItem.publicAuthorName, 'FanFan')
assert.equal(strictItem.commentIdKind, 'synthetic-content-hash')
assert.match(strictItem.commentId, /^comment-[0-9a-f]+$/)
assert.equal(JSON.stringify(strictComments.sourceProof.commentIds), JSON.stringify([strictItem.commentId]))

dom.window.document.body.innerHTML = '<div data-e2e="comment-button">32</div>'
const missingCommentList = await invoke({ commandId: 'missing-comment-list', action: 'collect_work_comments', payload: { creatorId: 'creator-1', workId: 'work-1', commentsPerWork: 1 } })
assert.equal(missingCommentList.ok, false)
assert.match(missingCommentList.error, /无法唯一验证作品评论列表容器/)

dom.window.document.body.innerHTML = `${commentListFixture([commentItem(1)])}${commentListFixture([commentItem(2)])}`
const duplicateCommentList = await invoke({ commandId: 'duplicate-comment-list', action: 'collect_work_comments', payload: { creatorId: 'creator-1', workId: 'work-1', commentsPerWork: 1 } })
assert.equal(duplicateCommentList.ok, false)
assert.match(duplicateCommentList.error, /找到 2 个/)

dom.window.close()
console.log('Browser connector verified following and comment provenance, fail-closed behavior, bounded collection and nullable metrics OK')
