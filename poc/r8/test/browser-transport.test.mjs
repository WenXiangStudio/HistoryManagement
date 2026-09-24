import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildR8ReadUrl, createR8BrowserRequest, safeTemplateFromObservation } from '../../../browser-connector/extension/r8-browser-transport.js'

const following = {
  routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
  requestParameters: [
    { name: 'aid', value: '6383' }, { name: 'channel', value: 'channel_pc_web' },
    { name: 'device_platform', value: 'webapp' }, { name: 'count', value: '20' },
    { name: 'sec_user_id', value: 'owner-secretly-excluded' }, { name: 'cursor', value: '80' }
  ]
}

test('request templates retain only harmless platform parameters', () => {
  const safe = safeTemplateFromObservation(following)
  assert.deepEqual(safe, { aid: '6383', channel: 'channel_pc_web', device_platform: 'webapp', count: '20' })
  const url = new URL(buildR8ReadUrl({
    routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'GET',
    target: { secUserId: 'public-owner-sec' }, count: 20, cursor: '0'
  }, safe))
  assert.equal(url.searchParams.get('sec_user_id'), 'public-owner-sec')
  assert.equal(url.searchParams.get('cursor'), null)
  assert.equal(url.searchParams.get('offset'), null)
  assert.ok(!url.toString().includes('owner-secretly-excluded'))
})

test('next following page uses the observed response cursor field', () => {
  const url = new URL(buildR8ReadUrl({
    routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'GET',
    target: { secUserId: 'public-owner-sec' }, count: 20, cursor: '20', cursorField: 'offset'
  }, safeTemplateFromObservation(following)))
  assert.equal(url.searchParams.get('offset'), '20')
  assert.throws(() => buildR8ReadUrl({
    routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'POST',
    target: { secUserId: 'public-owner-sec' }, count: 20, cursor: '0'
  }, safeTemplateFromObservation(following)), /ROUTE_INVALID/)
})

test('following GET carries only observed numeric time context and explicit initial offset', () => {
  const observed = { ...following, requestParameters: [
    ...following.requestParameters,
    { name: 'offset', value: '0' }, { name: 'min_time', value: '1780000000' },
    { name: 'max_time', value: '1781000000' }
  ] }
  const template = safeTemplateFromObservation(observed)
  const input = { routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'GET',
    target: { secUserId: 'owner-sec' }, count: 20, cursor: '0' }
  const initial = new URL(buildR8ReadUrl(input, template))
  const next = new URL(buildR8ReadUrl({ ...input, cursor: '20', cursorField: 'offset' }, template))
  assert.equal(initial.searchParams.get('offset'), '0')
  assert.equal(next.searchParams.get('offset'), '20')
  assert.equal(next.searchParams.get('min_time'), '1780000000')
  assert.equal(next.searchParams.get('max_time'), '1781000000')
  assert.ok(!next.toString().includes('owner-secretly-excluded'))
})

test('browser transport runs only inside the active Douyin tab and returns a bounded JSON body', async () => {
  const calls = []
  const request = createR8BrowserRequest({
    tabId: 9, getTab: async () => ({ url: 'https://www.douyin.com/user/self' }),
    templates: { 'following-list': safeTemplateFromObservation(following) },
    debuggerApi: { sendCommand: async (...args) => {
      calls.push(args)
      return { result: { value: { status: 200, body: { status_code: 0, user_list: [] } } } }
    } }
  })
  const result = await request({ routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'GET',
    target: { secUserId: 'public-owner-sec' }, count: 20, cursor: '0' })
  assert.equal(result.body.status_code, 0)
  assert.equal(calls[0][1], 'Runtime.evaluate')
  assert.match(calls[0][2].expression, /credentials: 'include'/)
  assert.ok(!calls[0][2].expression.includes('owner-secretly-excluded'))
})

test('browser transport preserves a rate-limit status and bounded Retry-After without JSON', async () => {
  const request = createR8BrowserRequest({
    tabId: 9, getTab: async () => ({ url: 'https://www.douyin.com/user/self' }),
    templates: { 'following-list': safeTemplateFromObservation(following) },
    debuggerApi: { sendCommand: async () => ({ result: { value: { status: 429, retryAfterSeconds: 15 } } }) }
  })
  const result = await request({ routeId: 'DY-FOLLOW-NETWORK', endpointKind: 'following-list',
    path: '/aweme/v1/web/user/following/list/', method: 'GET',
    target: { secUserId: 'public-owner-sec' }, count: 20, cursor: '0' })
  assert.deepEqual(result, { status: 429, retryAfterSeconds: 15 })
})
