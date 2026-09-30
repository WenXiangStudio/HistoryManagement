import test from 'node:test'
import assert from 'node:assert/strict'
import { followingFailureMessage, followingRequest, projectFollowingResponse } from '../browser-connector/following-extension/following-core.js'
import { runFollowingSync } from '../browser-connector/following-extension/following-runner.js'

test('only following endpoints and initial page owner IDs are accepted', () => {
  assert.equal(followingRequest('https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=owner'), null)
  assert.equal(followingRequest('https://www.douyin.com/aweme/v1/web/comment/list/'), null)
  assert.deepEqual(followingRequest('https://www.douyin.com/aweme/v1/web/user/following/list/?sec_user_id=owner&offset=0'), { ownerSecUid: 'owner' })
  assert.throws(() => followingRequest('https://www.douyin.com/aweme/v1/web/user/following/list/?sec_user_id=owner&offset=20'), /FIRST_PAGE/)
})

function eventEmitter() {
  const listeners = new Set()
  return { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args)), count: () => listeners.size }
}
function runtime({ detachReason, securityCode, cancel = false } = {}) {
  const posts = []; const commands = []; const feedbacks = []; const badges = []
  const onEvent = eventEmitter(); const onDetach = eventEmitter()
  const body = { has_more: 1, user_list: Array.from({ length: 20 }, (_, i) => ({ uid: `uid-${i}`, sec_uid: `sec-${i}`,
    nickname: `真实响应结构${i}`, avatar_thumb: { url_list: ['https://example.com/avatar.jpg'] } })) }
  let tabUrl = 'about:blank'; let lastResult = null; let detached = 0; let polls = 0
  const chromeApi = {
    debugger: { onEvent, onDetach, attach: async () => {}, detach: async () => { detached++ },
      sendCommand: async (_target, method, params) => {
        commands.push({ method, params })
        if (method === 'Network.getResponseBody') {
          assert.equal(params.requestId, 'following-request')
          return { body: JSON.stringify(body), base64Encoded: false }
        }
      } },
    tabs: {
      create: async () => ({ id: 42 }), get: async () => ({ id: 42, url: tabUrl, status: 'complete' }),
      update: async (_id, { url }) => { tabUrl = url; if (detachReason) onDetach.emit({ tabId: 42 }, detachReason) },
      sendMessage: async (_id, message) => {
        if (message.type === 'signaldesk.following.feedback') { feedbacks.push(message); return { ok: true } }
        if (message.type === 'signaldesk.following.verify') return { ok: true }
        if (securityCode) return { ok: false, code: securityCode }
        onEvent.emit({ tabId: 42 }, 'Network.requestWillBeSent', { requestId: 'unrelated-video', request: {
          method: 'GET', url: 'https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=owner' } })
        onEvent.emit({ tabId: 42 }, 'Network.loadingFinished', { requestId: 'unrelated-video' })
        onEvent.emit({ tabId: 42 }, 'Network.requestWillBeSent', { requestId: 'following-request', request: {
          method: 'GET', url: 'https://www.douyin.com/aweme/v1/web/user/following/list/?sec_user_id=owner&offset=0' } })
        onEvent.emit({ tabId: 42 }, 'Network.responseReceived', { requestId: 'following-request', response: { status: 200 } })
        onEvent.emit({ tabId: 42 }, 'Network.loadingFinished', { requestId: 'following-request' })
        return { ok: true }
      }
    },
    storage: { local: { set: async (value) => { lastResult = value.lastFollowingResult } } },
    action: { setBadgeText: async (value) => badges.push(value.text), setBadgeBackgroundColor: async () => {} }
  }
  const fetchApi = async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:12345/'), 'runner must never actively fetch a Douyin endpoint')
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); posts.push({ path: new URL(url).pathname, body })
      return { ok: true, json: async () => ({ phase: 'completed', count: 10, message: '已保存 10 位关注博主' }) }
    }
    polls++
    return { ok: true, json: async () => ({ runId: 'test-run', phase: cancel && polls > 1 ? 'cancelled' : 'running' }) }
  }
  return { chromeApi, fetchApi, delay: async () => {}, posts, commands, feedbacks, badges,
    result: () => lastResult, detached: () => detached, listeners: () => onEvent.count() + onDetach.count() }
}
const config = { origin: 'http://127.0.0.1:12345', token: 'a'.repeat(64), runId: 'test-run' }
test('runtime saves the first ten following profiles, reads no work response, and publishes visible completion', async () => {
  const env = runtime(); await runFollowingSync(config, env)
  const reports = env.posts.filter((entry) => entry.path === '/report')
  assert.equal(reports.length, 1); assert.equal(reports[0].body.creators.length, 10)
  assert.equal(env.commands.filter((entry) => entry.method === 'Network.getResponseBody').length, 1)
  assert.equal(env.feedbacks.at(-1).phase, 'completed'); assert.equal(env.badges.at(-1), '10')
  assert.equal(env.result().status, 'saved'); assert.equal(env.listeners(), 0); assert.equal(env.detached(), 1)
})
for (const reason of ['canceled_by_user', 'target_closed', 'unspecified']) {
  test(`runtime stops immediately after detach (${reason}), keeps reason, and creates no report`, async () => {
    const env = runtime({ detachReason: reason }); await runFollowingSync(config, env)
    assert.equal(env.posts.filter((entry) => entry.path === '/report').length, 0)
    assert.equal(env.commands.filter((entry) => entry.method === 'Network.getResponseBody').length, 0)
    assert.equal(env.result().diagnostic.code, 'BROWSER_DEBUGGER_DETACHED')
    assert.equal(env.result().diagnostic.detachReason, reason === 'unspecified' ? 'unknown' : reason)
    assert.equal(env.feedbacks.at(-1).phase, 'blocked'); assert.equal(env.badges.at(-1), '!')
    assert.equal(env.listeners(), 0)
  })
}
test('login and security blocks have specific feedback and read no body', async () => {
  for (const securityCode of ['LOGIN_REQUIRED', 'CAPTCHA_OR_SECURITY_CHALLENGE']) {
    const env = runtime({ securityCode }); await runFollowingSync(config, env)
    assert.equal(env.posts.filter((entry) => entry.path === '/report').length, 0)
    assert.equal(env.result().diagnostic.code, securityCode)
    assert.equal(env.commands.filter((entry) => entry.method === 'Network.getResponseBody').length, 0)
  }
  assert.ok(!followingFailureMessage('BROWSER_DEBUGGER_DETACHED').includes('登录'))
})
test('APP cancellation stops before navigating the Douyin homepage', async () => {
  const env = runtime({ cancel: true }); await runFollowingSync(config, env)
  assert.equal(env.posts.filter((entry) => entry.path === '/report').length, 0)
  assert.equal(env.result().diagnostic.code, 'APP_SESSION_ENDED')
  assert.equal(env.listeners(), 0)
})
test('the projection keeps the first ten basic identities and discards video/comment fields', () => {
  const user_list = Array.from({ length: 20 }, (_, index) => ({ uid: `uid-${index}`, sec_uid: `sec-${index}`,
    nickname: `博主${index}`, avatar_thumb: { url_list: ['https://example.com/avatar.jpg'] }, signature: '简介',
    aweme_list: [{ aweme_id: 'must-not-be-copied', statistics: { digg_count: 100 } }], comment_count: 99 }))
  const projected = projectFollowingResponse({ user_list, has_more: 1 })
  assert.equal(projected.creators.length, 10)
  assert.equal(projected.creators[9].uid, 'uid-9')
  assert.equal(projected.responseItemCount, 20)
  assert.ok(!/aweme|comment|digg|statistics/.test(JSON.stringify(projected)))
  assert.equal(projected.creators[0].avatarUrl, 'https://example.com/avatar.jpg')
})
