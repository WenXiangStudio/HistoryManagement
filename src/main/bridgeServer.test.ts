import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserCollectionEnvelope } from '../shared/contracts'
import { BridgeServer } from './bridgeServer'

let bridge: BridgeServer | null = null
let directory: string | null = null

afterEach(async () => {
  await bridge?.stop()
  bridge = null
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

function validFollowingEnvelope(): BrowserCollectionEnvelope {
  return {
    contract: 'browser-collection-envelope/v1',
    commandId: 'following-command',
    platform: 'douyin',
    collectedAt: '2026-09-02T08:00:00.000Z',
    sourceUrl: 'https://www.douyin.com/user/self?showTab=follow',
    completeness: 'partial',
    hasMore: true,
    sourceProof: {
      contract: 'douyin-following-source-proof/v1',
      relationship: 'following',
      pageKind: 'owner-following-list',
      activeTab: 'following',
      extractionScope: 'verified-following-list-container',
      scrollRootKind: 'not-needed',
      containerIdentity: 'role:list|aria-label:关注账号列表',
      scrollRootIdentity: 'not-needed',
      creatorIds: ['creator-1']
    },
    items: [{
      entityType: 'creator', creatorId: 'creator-1', nickname: '真实关注博主',
      profileUrl: 'https://www.douyin.com/user/creator-1', signature: '', isFollowing: true
    }]
  }
}

async function startBridge() {
  directory = mkdtempSync(join(tmpdir(), 'signal-desk-bridge-test-'))
  bridge = new BridgeServer(directory)
  await bridge.start()
  return JSON.parse(readFileSync(join(directory, 'bridge.json'), 'utf8')) as { url: string; secret: string }
}

async function postEvent(discovery: { url: string; secret: string }, body: unknown) {
  const response = await fetch(`${discovery.url}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signaldesk-secret': discovery.secret },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('BridgeServer browser event receipts', () => {
  it('returns a transport-success rejection receipt for an invalid envelope and emits a blocked status', async () => {
    const discovery = await startBridge()
    let blocked: Record<string, unknown> | null = null
    bridge!.on('status', (status) => { blocked = status as Record<string, unknown> })
    const invalid = validFollowingEnvelope() as unknown as Record<string, unknown>
    invalid.items = [{ entityType: 'creator', creatorId: 'creator-1', nickname: '缺少关注字段', profileUrl: 'https://www.douyin.com/user/creator-1' }]

    const result = await postEvent(discovery, invalid)
    expect(result.status).toBe(202)
    expect(result.body).toMatchObject({
      contract: 'browser-event-receipt/v1', accepted: false, commandId: 'following-command', code: 'invalid-envelope'
    })
    expect(blocked).toMatchObject({ type: 'blocked', commandId: 'following-command' })
  })

  it('forwards the registered semantic consumer receipt and only emits accepted envelopes', async () => {
    const discovery = await startBridge()
    let acceptedEvents = 0
    bridge!.on('envelope', () => { acceptedEvents += 1 })
    bridge!.setEnvelopeHandler((envelope) => ({
      contract: 'browser-event-receipt/v1', accepted: envelope.commandId === 'following-command', commandId: envelope.commandId
    }))

    const result = await postEvent(discovery, validFollowingEnvelope())
    expect(result).toMatchObject({
      status: 202,
      body: { contract: 'browser-event-receipt/v1', accepted: true, commandId: 'following-command' }
    })
    expect(acceptedEvents).toBe(1)
  })
})
