import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudService } from './cloudService'
import type { CredentialStore } from './credentialStore'
import { AppDatabase } from './database'

let database: AppDatabase | null = null
let temporaryRoot = ''

afterEach(() => {
  database?.close()
  database = null
  vi.unstubAllGlobals()
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

describe('CloudService approval batches', () => {
  it('excludes real comments whose browser source was not verified', () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'signal-desk-cloud-unverified-comment-'))
    database = new AppDatabase(':memory:')
    const collectedAt = '2026-09-04T09:34:04.669Z'
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1', commandId: 'legacy-work', platform: 'douyin', collectedAt,
      sourceUrl: 'https://www.douyin.com/user/creator-1', completeness: 'complete', hasMore: false,
      items: [{ entityType: 'work', workId: 'work-1', creatorId: 'creator-1', workType: 'video', sourceUrl: 'https://www.douyin.com/video/work-1', title: '', description: '', discoveredAt: collectedAt }]
    })
    database.ingestEnvelope({
      contract: 'browser-collection-envelope/v1', commandId: 'legacy-comment', platform: 'douyin', collectedAt,
      sourceUrl: 'https://www.douyin.com/video/work-1', completeness: 'complete', hasMore: false,
      items: [{ entityType: 'comment', commentId: 'comment-legacy', workId: 'work-1', publicAuthorName: '公开用户', body: '32', likeCount: null }]
    })

    const service = new CloudService(database, { text: {} as CredentialStore, vision: {} as CredentialStore }, temporaryRoot)
    const estimate = service.estimateBatch(100)
    expect(estimate.workCount).toBe(1)
    expect(estimate.commentCount).toBe(0)
    expect(database.db.prepare('SELECT source_verified, platform_comment_id_kind FROM comments').get()).toMatchObject({ source_verified: 0, platform_comment_id_kind: 'legacy-unknown' })
  })

  it('freezes exact text, comment and evenly sampled visual evidence before approval', () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'signal-desk-cloud-'))
    database = new AppDatabase(':memory:')
    database.seedDemo()
    database.saveSettings({
      visionBaseUrl: 'https://vision.example.com/v1',
      visionModel: 'compatible-vision-model',
      textInputPricePerMillion: 1,
      textOutputPricePerMillion: 2,
      visionInputPricePerMillion: 3,
      visionOutputPricePerMillion: 4,
      imagePrice: 0.01
    })

    const work = database.db.prepare('SELECT id FROM works ORDER BY id LIMIT 1').get() as { id: number }
    const insert = database.db.prepare('INSERT INTO evidence_frames(work_id, frame_ref, time_ms, local_path, perceptual_hash) VALUES (?, ?, ?, ?, ?)')
    for (let index = 0; index < 20; index += 1) {
      const path = join(temporaryRoot, `frame-${index}.jpg`)
      writeFileSync(path, Buffer.from(`jpeg-${index}`))
      insert.run(work.id, `frame-${index}`, index * 2_000, path, `hash-${index}`)
    }

    const service = new CloudService(database, { text: {} as CredentialStore, vision: {} as CredentialStore }, temporaryRoot)
    const estimate = service.estimateBatch(100)
    expect(estimate.batchId).toBeGreaterThan(0)
    expect(estimate.visionWorkCount).toBe(1)
    expect(estimate.imageCount).toBe(16)
    expect(estimate.commentCount).toBe(120)
    expect(estimate.estimatedCost).not.toBeNull()

    const row = database.db.prepare('SELECT state, subject_count, image_count, manifest_json FROM analysis_batches WHERE id=?').get(estimate.batchId) as Record<string, unknown>
    const manifest = JSON.parse(String(row.manifest_json)) as { commentIds: number[]; visionWorks: Array<{ frames: unknown[] }> }
    expect(row.state).toBe('awaiting_approval')
    expect(Number(row.subject_count)).toBe(estimate.subjectCount)
    expect(Number(row.image_count)).toBe(16)
    expect(manifest.commentIds).toHaveLength(120)
    expect(manifest.visionWorks[0].frames).toHaveLength(16)
  })

  it.each(['chat-completions','responses'] as const)('routes %s text and vision requests to independent providers and credentials', async (protocol) => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'signal-desk-cloud-routing-'))
    database = new AppDatabase(':memory:')
    database.seedDemo()
    database.saveSettings({
      textBaseUrl: 'https://text.example.com/v1',
      textApiProtocol: protocol,
      textModel: 'text-model',
      visionBaseUrl: 'https://vision.example.com/openai/v1',
      visionModel: 'vision-model'
    })
    database.db.prepare(`UPDATE works SET analysis_status='pending' WHERE id=(SELECT id FROM works ORDER BY id LIMIT 1)`).run()
    const work = database.db.prepare('SELECT id FROM works ORDER BY id LIMIT 1').get() as { id: number }
    const bytes = Buffer.from('verified-jpeg')
    const path = join(temporaryRoot, 'verified-frame.jpg')
    writeFileSync(path, bytes)
    database.db.prepare('INSERT INTO evidence_frames(work_id, frame_ref, time_ms, local_path, perceptual_hash) VALUES (?, ?, ?, ?, ?)')
      .run(work.id, 'frame-1', 2_000, path, createHash('sha256').update(bytes).digest('hex'))

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const content=JSON.stringify({
        summary: '已完成分析',
        keyPoints: ['要点'],
        coreExpression: '核心表达',
        domains: [{ id: 'technology', confidence: 0.9 }],
        keywords: ['关键词'],
        confidence: 0.9
      })
      return String(input).endsWith('/responses')?new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:content}]}]}})+'\n\n'):
        new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}})
    })
    vi.stubGlobal('fetch', fetchMock)
    const textCredentials = { getApiKey: () => 'text-secret' } as CredentialStore
    const visionCredentials = { getApiKey: () => 'vision-secret' } as CredentialStore
    const service = new CloudService(database, { text: textCredentials, vision: visionCredentials }, temporaryRoot)

    const estimate = service.estimateBatch(1)
    expect(estimate.workCount).toBe(1)
    expect(estimate.visionWorkCount).toBe(1)
    const result = await service.runApprovedBatch(estimate.batchId)
    expect(result.failed).toBe(0)

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      authorization: (init?.headers as Record<string, string>).authorization,
      body: JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: unknown }> }
    }))
    const textRequests = requests.filter((request) => request.url === 'https://text.example.com/v1/'+(protocol==='responses'?'responses':'chat/completions'))
    const visionRequests = requests.filter((request) => request.url === 'https://vision.example.com/openai/v1/chat/completions')
    expect(textRequests.length).toBeGreaterThanOrEqual(2)
    expect(textRequests.every((request) => request.authorization === 'Bearer text-secret' && request.body.model === 'text-model')).toBe(true)
    expect(visionRequests).toHaveLength(1)
    expect(visionRequests[0].authorization).toBe('Bearer vision-secret')
    expect(visionRequests[0].body.model).toBe('vision-model')
    expect(Array.isArray(visionRequests[0].body.messages[0].content)).toBe(true)
  })
})
