import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))
import { IsolatedPilotService } from './isolatedPilot'
import { VerifiedCreatorCatalog } from '../../poc/r8/verified-catalog.mjs'

let service: IsolatedPilotService | null = null
let root: string | null = null
afterEach(async () => {
  await service?.stop()
  service = null
  if (root) {
    const checked = relative(resolve(tmpdir()), resolve(root))
    if (!checked || checked.startsWith('..') || isAbsolute(checked)) throw new Error('unsafe test cleanup path')
    await rm(root, { recursive: true, force: true })
    root = null
  }
})

it('desktop isolated entry selects one verified author and keeps the formal database untouched', async () => {
  root = await mkdtemp(join(tmpdir(), 'signal-desk-isolated-service-test-'))
  const r8Root = join(root, 'signal-desk-r8')
  await mkdir(r8Root)
  const catalog = new VerifiedCreatorCatalog(join(r8Root, 'verified-catalog.sqlite'))
  const at = '2026-09-29T00:00:00.000Z'
  catalog.bindOwner('owner-sec', at)
  catalog.upsertFollowing('owner-sec', { uid: 'uid-a', secUid: 'sec-a', nickname: '甲', isFollowing: true }, at)
  catalog.upsertFollowing('owner-sec', { uid: 'uid-b', secUid: 'sec-b', nickname: '乙', isFollowing: true }, at)
  catalog.close()
  service = new IsolatedPilotService({ tempRoot: r8Root, resourceRoot: process.cwd(), runtimeExecutable: process.execPath })

  expect(service.catalog().creators.map((creator) => creator.uid)).toEqual(['uid-a', 'uid-b'])
  await expect(service.prepare('unknown')).rejects.toThrow(/已验证目录/)
  const prepared = await service.prepare('uid-a')
  expect(prepared).toMatchObject({ phase: 'prepared', creatorName: '甲' })
  const source = await readFile(join(prepared.extensionDirectory!, 'session-config.js'), 'utf8')
  const config = JSON.parse(source.match(/Object\.freeze\((.*)\)/)![1]) as {
    controllerOrigin: string; token: string
  }
  const headers = { 'content-type': 'application/json', 'x-signaldesk-r8-token': config.token,
    'x-signaldesk-r8-client': 'signaldesk-homepage-pilot-extension' }
  const listing = await (await fetch(`${config.controllerOrigin}/v1/catalog`, { headers })).json() as {
    creators: Array<{ uid: string }>
  }
  expect(listing.creators.map((creator) => creator.uid)).toEqual(['uid-a'])
  const report = { contract: 'signaldesk-homepage-pilot-report/v1', runId: prepared.runId,
    startedAt: at, finishedAt: at, result: { contract: 'signaldesk-homepage-pilot/v1',
      creator: { uid: 'uid-a', secUid: 'sec-a', profileUrl: 'https://www.douyin.com/user/sec-a' },
      status: 'blocked', stage: 'profile', navigationCount: 1, activeApiRequests: 0,
      candidates: [], verifiedWork: null, workProof: null, detailProof: null,
      comments: 'not-requested', replies: 'not-requested', reason: 'PAGE_SECURITY_OR_LOGIN_PROMPT' },
    observerIssueCodes: [], safety: { formalDatabaseTouched: false, activeApiRequests: 0,
      mediaProcessingStarted: false, externalProvidersCalled: false } }
  const forged = structuredClone(report)
  forged.result.creator.uid = 'uid-b'
  expect((await fetch(`${config.controllerOrigin}/v1/report`, {
    method: 'POST', headers, body: JSON.stringify(forged)
  })).status).toBe(400)
  expect((await fetch(`${config.controllerOrigin}/v1/report`, {
    method: 'POST', headers, body: JSON.stringify(report)
  })).status).toBe(201)
  expect(await service.status()).toMatchObject({ phase: 'finished', result: {
    status: 'blocked', reason: 'PAGE_SECURITY_OR_LOGIN_PROMPT', activeApiRequests: 0
  } })
  await expect(stat(join(root, 'signal-desk.sqlite'))).rejects.toThrow()
  const db = new DatabaseSync(join(r8Root, 'verified-catalog.sqlite'), { readOnly: true })
  try { expect(Number(db.prepare('SELECT COUNT(*) AS n FROM creators').get()!.n)).toBe(2) }
  finally { db.close() }
})

it('cancels a prepared run and permits another run in the same extension directory', async () => {
  root = await mkdtemp(join(tmpdir(), 'signal-desk-isolated-cancel-test-'))
  const r8Root = join(root, 'signal-desk-r8')
  await mkdir(r8Root)
  const catalog = new VerifiedCreatorCatalog(join(r8Root, 'verified-catalog.sqlite'))
  catalog.bindOwner('owner-sec', '2026-09-29T00:00:00.000Z')
  catalog.upsertFollowing('owner-sec', { uid: 'uid-a', secUid: 'sec-a', nickname: '甲', isFollowing: true }, '2026-09-29T00:00:00.000Z')
  catalog.close()
  service = new IsolatedPilotService({ tempRoot: r8Root, resourceRoot: process.cwd(), runtimeExecutable: process.execPath })
  const first = await service.prepare('uid-a')
  await expect(service.prepare('uid-a')).rejects.toThrow(/已有一轮/)
  expect(await service.cancel()).toMatchObject({ phase: 'cancelled' })
  const second = await service.prepare('uid-a')
  expect(second.extensionDirectory).toBe(first.extensionDirectory)
  expect(second.runId).not.toBe(first.runId)
})
