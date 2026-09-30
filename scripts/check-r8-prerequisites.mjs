import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async (path) => await readFile(new URL(path, root), 'utf8')

const [featureFlags, background, bridge, observer, packageSource] = await Promise.all([
  read('src/shared/featureFlags.ts'),
  read('browser-connector/extension/background.js'),
  read('browser-connector/extension/production-envelope-bridge.js'),
  read('browser-connector/extension/network-observer.js'),
  read('package.json')
])

const failures = []
const requireText = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message)
}

requireText(featureFlags, /export const STRUCTURED_SYNC_AVAILABLE = false\b/,
  'production structured sync capability must remain false')
requireText(background, /snapshot\s*=\s*await observer\.stop\(\)/,
  'background must retain the stopped Observer snapshot')
if (/return\s+result\.envelope\b/.test(background)) {
  failures.push('background still returns a DOM v1 envelope directly')
}
for (const contract of [
  'douyin-following-structured-proof/v3',
  'douyin-creator-works-structured-proof/v2',
  'douyin-work-detail-structured-proof/v2',
  'douyin-comment-list-structured-proof/v2',
  'douyin-comment-reply-structured-proof/v2'
]) {
  requireText(bridge, new RegExp(contract.replace('/', '\\/')), `bridge is missing ${contract}`)
}
for (const field of ['publicAuthorName', 'replyCount', 'publishedAt']) {
  requireText(observer, new RegExp(`\\b${field}\\b`), `Observer comment projection is missing ${field}`)
}
requireText(bridge, /projection hash mismatch/,
  'bridge must verify every Observer projection hash before assembly')

// Five isolated T1 runs exposed faults that the earlier static gate missed.
// Keep R8 closed until namespace-aware identity and bounded passive collection
// replace the current production bridge.
if (/followedCreatorId:\s*creatorId,\s*profileRouteCreatorId:\s*creatorId,\s*requestTargetCreatorId:\s*creatorId/.test(bridge)) {
  failures.push('works proof still equates public uid with route/request sec_uid')
}
if (/await observeWorkDetails\(tab\.id, legacyEnvelope\)/.test(background)) {
  failures.push('works detail still navigates once per DOM candidate')
}
if (!/runHomepagePilot\(/.test(background)) {
  failures.push('production connector has not wired the bounded passive homepage collector')
}
if (!/creatorSecUid/.test(background)) {
  failures.push('production command path has no independently bound author sec_uid')
}
if (/if \(value\.issues\.length\) reject\(/.test(bridge)) {
  failures.push('bridge still rejects a target result for unrelated observer issues')
}

const packageJson = JSON.parse(packageSource)
const prerequisite = packageJson.scripts?.['check:r8-prerequisites']
if (typeof prerequisite !== 'string'
  || !prerequisite.includes('productionEnvelopeBridge.test.ts')
  || !prerequisite.includes('scripts/check-r8-prerequisites.mjs')) {
  failures.push('check:r8-prerequisites must run the cross-layer bridge test and static prerequisite audit')
}
if (typeof packageJson.scripts?.check !== 'string'
  || !packageJson.scripts.check.startsWith('npm run check:r8-prerequisites &&')) {
  failures.push('npm run check must make check:r8-prerequisites its first hard prerequisite')
}

if (failures.length) {
  console.error('R8 real-validation prerequisites are CLOSED:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log('R8 offline prerequisite gate PASS: Observer→v2 bridge is cross-layer tested; production sync remains disabled')
}
