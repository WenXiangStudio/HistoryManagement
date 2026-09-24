import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { browserCollectionEnvelopeSchema } from '../shared/contracts'
import { STRUCTURED_SYNC_AVAILABLE } from '../shared/featureFlags'
import { validateEnvelopeForJob } from './taskRunner'
// @ts-expect-error Browser extension modules intentionally remain plain JavaScript.
import { buildV2BusinessEnvelope } from '../../browser-connector/extension/production-envelope-bridge.js'
// @ts-expect-error Browser extension modules intentionally remain plain JavaScript.
import { projectStructuredResponse, projectionSha256, schemaFingerprint } from '../../browser-connector/extension/network-observer.js'

const fixture = JSON.parse(readFileSync(
  new URL('../../browser-connector/extension/fixtures/network-observer.synthetic.json', import.meta.url),
  'utf8'
)) as { responses: Array<Record<string, unknown>> }

const safeParameters: Record<string, Set<string>> = {
  'following-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'sec_user_id']),
  'creator-work-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'sec_user_id']),
  'work-detail': new Set(['aid', 'aweme_id', 'channel', 'device_platform', 'item_id']),
  'comment-list': new Set(['aid', 'aweme_id', 'channel', 'count', 'cursor', 'device_platform']),
  'comment-reply-list': new Set(['aid', 'aweme_id', 'channel', 'comment_id', 'count', 'cursor', 'device_platform', 'item_id'])
}

function response(endpointKind: string): Record<string, unknown> {
  const found = fixture.responses.find((item) => item.endpointKind === endpointKind)
  if (!found) throw new Error(`missing ${endpointKind} fixture`)
  return structuredClone(found)
}

async function observation(entry: Record<string, unknown>, urlOverride?: string): Promise<Record<string, unknown>> {
  const endpointKind = String(entry.endpointKind)
  const url = new URL(urlOverride ?? String(entry.url))
  const projection = await projectStructuredResponse(endpointKind, entry.body, webcrypto)
  const allowed = safeParameters[endpointKind]
  const requestParameters = [...url.searchParams.entries()]
    .filter(([name]) => allowed.has(name))
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    contract: 'network-observation/v1', routeId: entry.routeId, endpointKind,
    requestParameters, schemaFingerprint: await schemaFingerprint(entry.body, webcrypto),
    responseProjectionSha256: await projectionSha256(projection, webcrypto), projection,
    observedAt: '2026-09-07T12:00:00.000Z'
  }
}

function command(action: string, payload: Record<string, unknown>) {
  return { contract: 'browser-command/v1', commandId: `${action}-offline`, action, payload, createdAt: '2026-09-07T12:00:00.000Z' }
}

function legacy(commandId: string, sourceUrl: string) {
  return { contract: 'browser-collection-envelope/v1', commandId, sourceUrl }
}

function snapshot(observations: Array<Record<string, unknown>>, issues: Array<Record<string, unknown>> = []) {
  return { observations, issues }
}

describe('production Network Observer v2 business-envelope bridge', () => {
  it('keeps the production synchronization capability gate closed', () => {
    expect(STRUCTURED_SYNC_AVAILABLE).toBe(false)
  })

  it('assembles a following v2 envelope accepted by shared and main gates', async () => {
    const input = response('following-list')
    const followingUrl = new URL(String(input.url))
    followingUrl.searchParams.set('sec_user_id', 'synthetic-owner-1')
    const browserCommand = command('collect_following', {
      adapterName: 'douyin.following', adapterVersion: '0.2.0-r4', cursor: '0'
    })
    const result = await buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/user/self?showTab=follow'),
      snapshot([await observation(input, followingUrl.toString())])
    )
    const envelope = browserCollectionEnvelopeSchema.parse(result)
    expect(envelope.sourceProof?.contract).toBe('douyin-following-structured-proof/v3')
    expect(envelope.items.map((item) => item.entityType)).toEqual(['creator'])
    expect(envelope.items[0]).toMatchObject({ profileUrl: 'https://www.douyin.com/user/synthetic-sec-creator-1' })
    expect(() => validateEnvelopeForJob(envelope, 'collection.following', browserCommand.payload)).not.toThrow()
    const mismatched = structuredClone(envelope)
    if (mismatched.sourceProof?.contract !== 'douyin-following-structured-proof/v3') throw new Error('expected v3 proof')
    mismatched.sourceProof.creatorIdentityBindings[0].secCreatorId = 'other-sec-id'
    expect(() => validateEnvelopeForJob(mismatched, 'collection.following', browserCommand.payload)).toThrow(/博主主页与 creatorId 不一致/)
  })

  it('requires independent work-detail observations and passes the full works persistence gate', async () => {
    const works = response('creator-work-list')
    const detail = response('work-detail')
    const browserCommand = command('collect_creator_works', {
      creatorId: 'synthetic-creator-1', adapterName: 'douyin.creator-works',
      adapterVersion: '0.2.0-r4', cursor: '0'
    })
    const worksObservation = await observation(works)
    await expect(buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/user/synthetic-creator-1'),
      snapshot([worksObservation])
    )).rejects.toThrow(/requires exactly one independent detail observation/)

    const result = await buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/user/synthetic-creator-1'),
      snapshot([worksObservation, await observation(detail)])
    )
    const envelope = browserCollectionEnvelopeSchema.parse(result)
    expect(envelope.sourceProof?.contract).toBe('douyin-creator-works-structured-proof/v2')
    expect(envelope.items[0]).toMatchObject({
      entityType: 'work', workId: 'synthetic-work-1', creatorId: 'synthetic-creator-1'
    })
    expect(() => validateEnvelopeForJob(envelope, 'collection.creator_works', browserCommand.payload)).not.toThrow()
  })

  it('assembles native-cid comments with a business projection hash accepted by the comment gate', async () => {
    const comments = response('comment-list')
    const browserCommand = command('collect_work_comments', {
      workId: 'synthetic-work-1', creatorId: 'synthetic-creator-1', commentsPerWork: 20,
      adapterName: 'douyin.comment-list', adapterVersion: '0.2.0-r5', cursor: '0'
    })
    const result = await buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/video/synthetic-work-1'),
      snapshot([await observation(comments)])
    )
    const envelope = browserCollectionEnvelopeSchema.parse(result)
    expect(envelope.sourceProof?.contract).toBe('douyin-comment-list-structured-proof/v2')
    expect(envelope.items[1]).toMatchObject({
      entityType: 'comment', commentId: 'synthetic-comment-1', commentIdKind: 'native-cid',
      publicAuthorName: '合成观众'
    })
    expect(() => validateEnvelopeForJob(envelope, 'collection.work_comments', browserCommand.payload)).not.toThrow()
  })

  it('quarantines unrelated observer issues while failing closed on target issues and projection tampering', async () => {
    const comments = response('comment-list')
    const browserCommand = command('collect_work_comments', {
      workId: 'synthetic-work-1', creatorId: 'synthetic-creator-1', commentsPerWork: 20,
      adapterName: 'douyin.comment-list', adapterVersion: '0.2.0-r5', cursor: '0'
    })
    const valid = await observation(comments)
    const unrelated = await buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/video/synthetic-work-1'),
      snapshot([valid], [{ code: 'RESPONSE_TOO_LARGE', routeId: null }])
    )
    expect(unrelated.sourceProof?.contract).toBe('douyin-comment-list-structured-proof/v2')
    await expect(buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/video/synthetic-work-1'),
      snapshot([valid], [{ code: 'SCHEMA_CHANGED', routeId: 'DY-COMMENT-NETWORK' }])
    )).rejects.toThrow(/target route issue/)

    const tampered = structuredClone(valid)
    ;(tampered.projection as { items: Array<{ body: string }> }).items[0].body = 'tampered'
    await expect(buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/video/synthetic-work-1'),
      snapshot([tampered])
    )).rejects.toThrow(/projection hash mismatch/)
  })

  it('keeps public uid and sec_uid identity mismatches fail-closed', async () => {
    const works = response('creator-work-list')
    const detail = response('work-detail')
    const browserCommand = command('collect_creator_works', {
      creatorId: 'synthetic-sec-creator-1', adapterName: 'douyin.creator-works',
      adapterVersion: '0.2.0-r4', cursor: '0'
    })
    await expect(buildV2BusinessEnvelope(
      browserCommand,
      legacy(browserCommand.commandId, 'https://www.douyin.com/user/synthetic-sec-creator-1'),
      snapshot([await observation(works), await observation(detail)])
    )).rejects.toThrow(/author|identity|creator/i)
  })
})
