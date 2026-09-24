import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runHomepagePilot } from '../../../browser-connector/extension/r8-homepage-pilot-core.js'

const creator = { uid: 'uid-1', secUid: 'sec-1' }
const profileUrl = 'https://www.douyin.com/user/sec-1'
const workUrl = 'https://www.douyin.com/video/1234567890123'
const route = (kind, params, projection) => ({ endpointKind: kind,
  routeId: kind === 'creator-work-list' ? 'DY-WORKS-NETWORK' : 'DY-DETAIL-NETWORK',
  requestParameters: params, projection, schemaFingerprint: 'a'.repeat(64),
  responseProjectionSha256: 'b'.repeat(64), observedAt: '2026-09-24T00:00:00.000Z' })
const list = route('creator-work-list', [{ name: 'sec_user_id', value: 'sec-1' }],
  { items: [{ workId: '1234567890123', authorId: 'uid-1', authorSecId: 'sec-1' }] })
const detail = route('work-detail', [{ name: 'aweme_id', value: '1234567890123' }],
  { item: { workId: '1234567890123', authorId: 'uid-1', authorSecId: 'sec-1',
    workType: 'video', title: '作品', description: '内容', statistics: {} } })
function driver({ profile = { pageUrl: profileUrl, cards: [{ url: workUrl }] },
  work = { pageUrl: workUrl }, profileObservations = [list], workObservations = [list, detail] } = {}) {
  const navigations = []
  const pages = [profile, work]
  const snapshots = [{ observations: profileObservations }, { observations: workObservations }]
  return { navigations, navigate: async (url) => { navigations.push(url) },
    inspectPage: async () => pages.shift(), snapshot: async () => snapshots.shift(),
    wait: async () => {} }
}

test('passive pilot verifies one work from page-visible card, list author and natural detail response', async () => {
  const harness = driver()
  const result = await runHomepagePilot({ creator, ...harness })
  assert.equal(result.status, 'verified')
  assert.deepEqual(harness.navigations, [profileUrl, workUrl])
  assert.equal(result.navigationCount, 2)
  assert.equal(result.activeApiRequests, 0)
  assert.equal(result.verifiedWork.workId, '1234567890123')
  assert.equal(result.comments, 'not-requested')
  assert.equal(result.replies, 'not-requested')
})

test('one preflight homepage navigation is included in the total bound', async () => {
  const harness = driver()
  const result = await runHomepagePilot({ creator, ...harness, initialNavigationCount: 1 })
  assert.equal(result.status, 'verified')
  assert.equal(result.navigationCount, 3)
  assert.equal(result.activeApiRequests, 0)
})

test('security prompt stops before opening a work page', async () => {
  const harness = driver({ profile: { pageUrl: profileUrl, securityPrompt: true, cards: [{ url: workUrl }] } })
  const result = await runHomepagePilot({ creator, ...harness })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'PAGE_SECURITY_OR_LOGIN_PROMPT')
  assert.deepEqual(harness.navigations, [profileUrl])
})

test('visible card alone and wrong author remain candidates', async () => {
  for (const profileObservations of [[], [route('creator-work-list',
    [{ name: 'sec_user_id', value: 'sec-1' }],
    { items: [{ workId: '1234567890123', authorId: 'someone-else', authorSecId: 'sec-1' }] })]]) {
    const harness = driver({ profileObservations })
    const result = await runHomepagePilot({ creator, ...harness })
    assert.equal(result.status, 'candidate-only')
    assert.equal(result.reason, 'NO_MATCHING_STRUCTURED_AUTHOR_PROOF')
    assert.equal(result.verifiedWork, null)
    assert.deepEqual(harness.navigations, [profileUrl])
  }
})

test('wrong detail author prevents verified work without further requests', async () => {
  const badDetail = route('work-detail', [{ name: 'aweme_id', value: '1234567890123' }],
    { item: { workId: '1234567890123', authorId: 'someone-else', authorSecId: 'sec-1' } })
  const harness = driver({ workObservations: [list, badDetail] })
  const result = await runHomepagePilot({ creator, ...harness })
  assert.equal(result.status, 'candidate-only')
  assert.equal(result.reason, 'NO_MATCHING_STRUCTURED_DETAIL_PROOF')
  assert.equal(result.activeApiRequests, 0)
})
