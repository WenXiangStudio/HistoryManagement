import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  CREATOR_WORKS_PROOF_CONTRACT,
  DISCOVERY_CONTRACT,
  FOLLOWING_PROOF_CONTRACT,
  MAX_SELECTED_WORKS_PER_CREATOR,
  assertNoSensitiveShape,
  canonicalSampleUrl,
  compareChannels,
  normalizeCommentPage,
  safeObservedEndpoint,
  sanitizeDiagnosticText,
  selectFollowingSamples,
  sha256Canonical,
  validateCreatorWorksSnapshot,
  validateFollowingSnapshot,
  validateSampleUrls,
  validateTargetSampleCount
} from '../extension/core.js'
import { scanSensitive, summarize, validateDiscovery, validateManifest, validateReport } from '../controller.mjs'

const SEED = '0123456789abcdef'.repeat(4)

function sampleUrls(count = 20) {
  return Array.from({ length: count }, (_, index) => `https://www.douyin.com/video/mock-work-${String(index + 1).padStart(2, '0')}`)
}

function followingSnapshot(count = 12, overrides = {}) {
  return {
    contract: FOLLOWING_PROOF_CONTRACT,
    relationship: 'following',
    pageKind: 'owner-following-list',
    activeTab: 'following',
    routeOrigin: 'https://www.douyin.com',
    routePath: '/user/self',
    routeShowTab: 'follow',
    followingTabCount: 1,
    fansTabCount: 1,
    containerIdentity: 'data-e2e:user-fans-container',
    extractionScope: 'verified-following-list-container',
    entryPoint: { mode: 'unique-following-count', candidateCount: 1, triggered: true },
    scrollRootKind: 'element',
    exhausted: false,
    creators: Array.from({ length: count }, (_, index) => {
      const creatorId = `creator-${String(index + 1).padStart(2, '0')}`
      return {
        creatorId,
        profileUrl: `https://www.douyin.com/user/${creatorId}`,
        relationshipMarker: index % 2 ? '相互关注' : '已关注',
        sourceRegion: 'verified-following-dialog'
      }
    }),
    collectedAt: '2026-09-05T00:00:00.000Z',
    ...overrides
  }
}

function creatorWorks(creatorIndex, workCount = 4, overrides = {}) {
  const creatorId = `creator-${String(creatorIndex).padStart(2, '0')}`
  return {
    contract: CREATOR_WORKS_PROOF_CONTRACT,
    creatorId,
    profileUrl: `https://www.douyin.com/user/${creatorId}`,
    routeOrigin: 'https://www.douyin.com',
    routeCreatorId: creatorId,
    extractionScope: 'verified-creator-works-container',
    containerIdentity: 'data-e2e:user-post-list',
    works: Array.from({ length: workCount }, (_, index) => {
      const routeKind = creatorIndex === 2 && index === 0 ? 'note' : 'video'
      const workId = `work-${String(creatorIndex).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
      return {
        url: `https://www.douyin.com/${routeKind}/${workId}`,
        workId,
        workType: routeKind === 'note' ? 'image' : 'video',
        creatorId,
        sourceRegion: 'verified-creator-works-container'
      }
    }),
    exhausted: false,
    collectedAt: '2026-09-05T00:00:00.000Z',
    ...overrides
  }
}

function discoveryConfig(seed = SEED, targetSampleCount = 24) {
  return validateDiscovery({
    contract: DISCOVERY_CONTRACT,
    targetSampleCount,
    samplingSeed: seed,
    samplingSeedSha256: createHash('sha256').update(JSON.stringify(seed)).digest('hex'),
    limits: { maxCreators: 60, maxCandidateWorksPerCreator: 8, maxSelectedWorksPerCreator: 3 },
    startedAt: '2026-09-05T00:00:00.000Z'
  })
}

function manifestFixture(targetSampleCount = 24, seed = SEED) {
  const discovery = discoveryConfig(seed, targetSampleCount)
  const followingProof = validateFollowingSnapshot(followingSnapshot())
  const creatorWorksProofs = Array.from({ length: 12 }, (_, index) => validateCreatorWorksSnapshot(creatorWorks(index + 1)))
  const samples = selectFollowingSamples(followingProof, creatorWorksProofs, targetSampleCount, seed)
  const value = {
    contract: 'signaldesk-phase-b-run/v1',
    discoveryId: 'phase-b-test',
    sampleCount: samples.length,
    samples,
    sampling: {
      targetSampleCount,
      samplingSeed: seed,
      samplingSeedSha256: discovery.samplingSeedSha256,
      policy: 'seeded-random-creator-round-robin/v1',
      maxSelectedWorksPerCreator: 3,
      workTypeCoverageWhenAvailable: true
    },
    followingProof,
    creatorWorksProofs,
    excludedCreators: [],
    candidateCount: creatorWorksProofs.reduce((sum, snapshot) => sum + snapshot.works.length, 0),
    limits: { maxApiPages: 2, pageSize: 20 },
    startedAt: '2026-09-05T00:00:00.000Z'
  }
  return { discovery, manifest: validateManifest(value, discovery) }
}

function rawPage(overrides = {}) {
  return {
    status_code: 0,
    comments: [{ cid: 'mock-comment-1', text: '合成评论内容', create_time: 1788537600, digg_count: 3, ip_label: '测试地区', reply_comment_total: 1, user: { uid: 'mock-user-1', nickname: '测试用户' } }],
    cursor: 20,
    has_more: 1,
    total: 42,
    ...overrides
  }
}

async function normalizedPage(sourceKind = 'page-context-fetch') {
  const page = normalizeCommentPage(rawPage(), { workId: 'work-01-01', cursorIn: '0', sourceKind, collectedAt: '2026-09-05T00:00:00.000Z' })
  page.responseBodySha256 = await sha256Canonical({ returnedIds: page.returnedIds, comments: page.comments })
  if (sourceKind === 'page-context-fetch') page.signatureProvider = 'page-frontierSign'
  return page
}

async function report(manifest, runId = 'phase-b-test') {
  const first = manifest.samples[0]
  const networkPage = await normalizedPage('network-response')
  const apiPage = await normalizedPage('page-context-fetch')
  networkPage.workId = first.workId
  apiPage.workId = first.workId
  const domShadow = { status: 'success', commentCount: 1, visibleNodeCount: 1, comments: [{ commentId: 'mock-comment-1', publicAuthorName: '测试用户', body: '合成评论内容' }] }
  return {
    contract: 'signaldesk-phase-b-sample-report/v1', runId, sampleIndex: 1, sourceUrl: first.url, workId: first.workId, workType: first.workType,
    startedAt: '2026-09-05T00:00:00.000Z', endedAt: '2026-09-05T00:00:10.000Z',
    eligibility: { eligible: true, reason: 'public-accessible-no-challenge' },
    network: { status: 'success', pages: [networkPage] }, pageContextApi: { status: 'success', pages: [apiPage] }, domShadow,
    endpointProbe: { network: [], performance: [] },
    comparison: compareChannels([networkPage], [apiPage], domShadow), issues: []
  }
}

test('accepts only 20 to 30 canonical unique public work URLs', () => {
  const samples = validateSampleUrls(sampleUrls(20))
  assert.equal(samples.length, 20)
  assert.deepEqual(samples[0], { index: 1, url: 'https://www.douyin.com/video/mock-work-01', workId: 'mock-work-01', workType: 'video' })
  assert.throws(() => validateSampleUrls(sampleUrls(19)), /20～30/)
  assert.throws(() => validateSampleUrls(sampleUrls(31)), /20～30/)
  assert.throws(() => canonicalSampleUrl('https://www.douyin.com/video/work-1?share_token=secret'), /无查询参数/)
  assert.throws(() => canonicalSampleUrl('https://evil.example/video/work-1'), /公开作品 URL/)
  assert.equal(validateTargetSampleCount(24), 24)
  assert.throws(() => validateTargetSampleCount(19), /20～30/)
})

test('normalizes native cid pages and distinguishes verified empty from not-yet-ready', () => {
  const page = normalizeCommentPage(rawPage(), { workId: 'mock-work-01', cursorIn: '0', sourceKind: 'page-context-fetch', collectedAt: '2026-09-05T00:00:00.000Z' })
  assert.equal(page.comments[0].commentId, 'mock-comment-1')
  assert.equal(page.completion, 'partial')
  const empty = normalizeCommentPage(rawPage({ comments: [], cursor: null, has_more: 0, total: 0 }), { workId: 'mock-work-01', cursorIn: '0', sourceKind: 'page-context-fetch', collectedAt: '2026-09-05T00:00:00.000Z' })
  assert.equal(empty.completion, 'verified-empty')
  assert.throws(() => normalizeCommentPage(rawPage({ comments: [], has_more: 1, total: 10 }), { workId: 'mock-work-01', cursorIn: '0', sourceKind: 'page-context-fetch', collectedAt: '2026-09-05T00:00:00.000Z' }), /空页但 has_more=true/)
})

test('compares Network, API and DOM shadow without manufacturing IDs', async () => {
  const networkPage = await normalizedPage('network-response')
  const apiPage = await normalizedPage('page-context-fetch')
  const comparison = compareChannels([networkPage], [apiPage], { status: 'success', commentCount: 1, comments: [{ commentId: null }] })
  assert.equal(comparison.networkApiIdOverlap, 1)
  assert.equal(comparison.apiDomNativeIdOverlap, 0)
  assert.equal(comparison.apiVerifiedEmpty, false)
})

test('redacts diagnostics and rejects sensitive discovery/report shapes', () => {
  const value = sanitizeDiagnosticText('failed https://www.douyin.com/path?aweme_id=w1&X-Bogus=signed&msToken=token Authorization: Bearer abc.def')
  assert.doesNotMatch(value, /signed|token|abc\.def/)
  assert.match(value, /aweme_id=w1/)
  assert.throws(() => assertNoSensitiveShape({ cookie: 'sid=secret' }), /禁止敏感字段/)
  assert.throws(() => scanSensitive({ nested: { authorization: 'Bearer value' } }), /禁止字段/)
  assert.doesNotThrow(() => scanSensitive({ sessionUsed: true, signatureProvider: 'page-frontierSign', samplingSeed: SEED }))
  assert.deepEqual(safeObservedEndpoint('https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=secret', { kind: 'Fetch', status: 200 }), {
    host: 'www.douyin.com', path: '/aweme/v1/web/comment/list/', kind: 'Fetch', status: 200
  })
  assert.equal(safeObservedEndpoint('https://evil.example/comment/list?token=secret', { kind: 'Fetch', status: 200 }), null)
})

test('accepts only the real following dialog and explicit relationship markers', () => {
  const valid = validateFollowingSnapshot(followingSnapshot())
  assert.equal(valid.creators.length, 12)
  assert.equal(valid.creatorIds.length, 12)
  assert.throws(() => validateFollowingSnapshot(followingSnapshot(12, { activeTab: 'fans' })), /不是本人“关注”列表/)
  assert.throws(() => validateFollowingSnapshot(followingSnapshot(12, { containerIdentity: 'data-e2e:recommend-list' })), /不唯一/)
  const missingMarker = followingSnapshot()
  missingMarker.creators[0].relationshipMarker = '关注'
  assert.throws(() => validateFollowingSnapshot(missingMarker), /缺少“已关注\/相互关注”/)
  const recommendation = followingSnapshot()
  recommendation.creators[0].sourceRegion = 'recommendation'
  assert.throws(() => validateFollowingSnapshot(recommendation), /粉丝、推荐、侧栏/)
})

test('requires a unique semantic following-count entry or a pre-verified open dialog', () => {
  assert.doesNotThrow(() => validateFollowingSnapshot(followingSnapshot()))
  assert.doesNotThrow(() => validateFollowingSnapshot(followingSnapshot(12, { entryPoint: { mode: 'preopened-verified-dialog', candidateCount: 0, triggered: false } })))
  assert.throws(() => validateFollowingSnapshot(followingSnapshot(12, { entryPoint: { mode: 'unique-following-count', candidateCount: 2, triggered: true } })), /入口未经唯一性验证/)
})

test('binds public works to one verified creator main-content route and rejects noise', () => {
  const valid = validateCreatorWorksSnapshot(creatorWorks(1))
  assert.equal(valid.works.length, 4)
  const wrongCreator = creatorWorks(1)
  wrongCreator.works[0].creatorId = 'creator-02'
  assert.throws(() => validateCreatorWorksSnapshot(wrongCreator), /不绑定/)
  const recommendation = creatorWorks(1)
  recommendation.works[0].sourceRegion = 'recommendation'
  assert.throws(() => validateCreatorWorksSnapshot(recommendation), /不绑定/)
  assert.throws(() => validateCreatorWorksSnapshot({ ...creatorWorks(1), routeCreatorId: 'creator-02' }), /路由不一致/)
})

test('seeded selection is deterministic, crosses creators, caps share and covers available types', () => {
  const following = followingSnapshot()
  const works = Array.from({ length: 12 }, (_, index) => creatorWorks(index + 1))
  const first = selectFollowingSamples(following, works, 24, SEED)
  const second = selectFollowingSamples(following, works, 24, SEED)
  const third = selectFollowingSamples(following, works, 24, 'f'.repeat(64))
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, third)
  const perCreator = new Map()
  for (const sample of first) perCreator.set(sample.creatorId, (perCreator.get(sample.creatorId) || 0) + 1)
  assert.ok(Math.max(...perCreator.values()) <= MAX_SELECTED_WORKS_PER_CREATOR)
  assert.ok(perCreator.size >= 8)
  assert.deepEqual(new Set(first.map((sample) => sample.workType)), new Set(['video', 'image']))
})

test('virtual-list rounds accumulate unique followed creators before selection', () => {
  const all = followingSnapshot(12)
  const rounds = [all.creators.slice(0, 5), all.creators.slice(3, 9), all.creators.slice(8)]
  const accumulated = new Map()
  for (const round of rounds) for (const creator of round) accumulated.set(creator.creatorId, creator)
  const merged = validateFollowingSnapshot({ ...all, creators: [...accumulated.values()] })
  assert.equal(merged.creators.length, 12)
  const works = Array.from({ length: 12 }, (_, index) => creatorWorks(index + 1))
  assert.equal(selectFollowingSamples(merged, works, 20, SEED).length, 20)
})

test('fails closed when verified following works cannot supply the requested minimum', () => {
  const following = followingSnapshot(6)
  const works = Array.from({ length: 6 }, (_, index) => creatorWorks(index + 1, 3))
  assert.throws(() => selectFollowingSamples(following, works, 20, SEED), /INSUFFICIENT_ELIGIBLE_SAMPLES/)
})

test('controller verifies frozen seed, following proof, creator binding and exact selected order', async () => {
  const { discovery, manifest } = manifestFixture()
  const sampleReport = await report(manifest)
  assert.equal(validateReport(sampleReport, manifest, 'phase-b-test').workId, manifest.samples[0].workId)
  assert.throws(() => validateReport({ ...sampleReport, sourceUrl: 'https://www.douyin.com/video/other' }, manifest, 'phase-b-test'), /固化清单/)
  const reordered = [...manifest.samples].reverse().map((sample, index) => ({ ...sample, index: index + 1 }))
  assert.throws(() => validateManifest({ ...manifest, samples: reordered }, discovery), /确定性选出/)
  assert.throws(() => validateManifest({ ...manifest, candidateCount: manifest.candidateCount + 1 }, discovery), /候选作品计数/)
  assert.throws(() => validateManifest({ ...manifest, limits: { maxApiPages: 20, pageSize: 100 } }, discovery), /硬上限/)
})

test('discovery artifacts contain no Cookie, request template, signature value or native messaging call', async () => {
  const { manifest } = manifestFixture()
  assert.doesNotThrow(() => scanSensitive(manifest))
  assert.equal('requestTemplate' in manifest, false)
  assert.equal('signatureValue' in manifest, false)
  const backgroundSource = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
  const manifestSource = await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')
  assert.doesNotMatch(backgroundSource, /connectNative|sendNativeMessage/)
  assert.doesNotMatch(manifestSource, /nativeMessaging/)
})

test('popup has no manual token/work-URL input and starts automatic following sampling', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /sampleUrls|sessionToken|每行一个/)
  assert.doesNotMatch(script, /sampleUrls|sessionToken\.value/)
  assert.match(html, /自动从本人真实关注关系中随机抽取/)
  assert.match(html, /无需粘贴 token/)
  const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
  assert.match(background, /signaldesk-phase-b-pair\/v1/)
  assert.match(background, /chrome\.runtime\.onInstalled\.addListener/)
  assert.match(background, /Input\.dispatchKeyEvent/)
  assert.match(background, /key: 'Enter'/)
  assert.doesNotMatch(background, /Input\.dispatchMouseEvent/)
  assert.match(script, /targetSampleCount/)
})

test('summary refuses benchmark claims and detects verified-empty conflicts', async () => {
  const { manifest } = manifestFixture()
  const sampleReport = await report(manifest)
  sampleReport.comparison.apiVerifiedEmpty = true
  sampleReport.comparison.networkCount = 1
  const summary = summarize([sampleReport], manifest, false)
  assert.equal(summary.erroneousVerifiedEmptyConflictCount, 1)
  assert.equal(summary.benchmarkClaimAllowed, false)
  assert.equal(summary.domShadow.error, 0)
})
