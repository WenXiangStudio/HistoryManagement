import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { test } from 'node:test'
import { VerifiedCreatorCatalog } from '../verified-catalog.mjs'

test('isolated catalog preserves legacy uncertainty and applies unfollow only after a complete snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'signal-desk-catalog-test-'))
  const at = '2026-09-24T00:00:00.000Z'
  const later = '2026-09-24T01:00:00.000Z'
  const catalog = new VerifiedCreatorCatalog(join(root, 'catalog.sqlite'))
  try {
    catalog.importLegacy([{ legacyKey: 'old-1', platformCreatorId: 'legacy-uid',
      profileUrl: 'https://www.douyin.com/user/unknown-route' }])
    assert.throws(() => catalog.syncableCreators('owner-a'), /OWNER_IDENTITY_CHANGED/)
    catalog.bindOwner('owner-a', at)
    catalog.upsertFollowing('owner-a', { uid: 'uid-a', secUid: 'sec-a', nickname: '甲', isFollowing: true }, at)
    catalog.upsertFollowing('owner-a', { uid: 'uid-b', secUid: 'sec-b', nickname: '乙', isFollowing: true }, at)
    assert.equal(catalog.syncableCreators('owner-a').length, 2)
    assert.equal(catalog.db.prepare('SELECT count(*) AS n FROM legacy_creators WHERE resolution=?').get('pending').n, 1)
    assert.throws(() => catalog.bindOwner('owner-b', later), /OWNER_IDENTITY_CHANGED/)
    catalog.finishRefresh('owner-a', 'refresh-partial', ['uid-a'], { complete: false, failed: true })
    assert.deepEqual(catalog.syncableCreators('owner-a').map((row) => row.followingState), ['stale','stale'])
    catalog.upsertFollowing('owner-a', { uid: 'uid-a', secUid: 'sec-a', nickname: '甲', isFollowing: true }, later)
    catalog.upsertFollowing('owner-a', { uid: 'uid-c', secUid: 'sec-c', nickname: '丙', isFollowing: true }, later)
    const finished = catalog.finishRefresh('owner-a', 'refresh-complete', ['uid-a','uid-c'], { complete: true, failed: false })
    assert.equal(finished.unfollowed, 1)
    assert.deepEqual(catalog.syncableCreators('owner-a').map((row) => row.uid), ['uid-a','uid-c'])
    assert.equal(catalog.db.prepare('SELECT following_state FROM creators WHERE uid=?').get('uid-b').following_state, 'unfollowed')
    assert.equal(catalog.db.prepare('SELECT profile_url FROM creators WHERE uid=?').get('uid-a').profile_url,
      'https://www.douyin.com/user/sec-a')
    assert.equal(catalog.db.prepare('SELECT first_discovered_at FROM creators WHERE uid=?').get('uid-a').first_discovered_at, at)
    const conflict = catalog.upsertFollowing('owner-a', { uid: 'uid-a', secUid: 'sec-changed', nickname: '甲', isFollowing: true }, later)
    assert.equal(conflict.status, 'identity_conflict')
    assert.equal(catalog.db.prepare('SELECT following_state FROM creators WHERE uid=?').get('uid-a').following_state, 'identity_conflict')
  } finally {
    catalog.close()
    const checked = relative(resolve(tmpdir()), resolve(root))
    if (!checked || checked.startsWith('..') || isAbsolute(checked)) throw new Error('test cleanup path invalid')
    await rm(root, { recursive: true, force: true })
  }
})
