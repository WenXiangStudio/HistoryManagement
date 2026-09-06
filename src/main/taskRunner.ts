import type { BrowserCollectionEnvelope, BrowserEventReceipt, SampleSyncOptions } from '../shared/contracts'
import { douyinCreatorWorksStructuredProofSchema, douyinFollowingStructuredProofSchema } from '../shared/platformAdapter'
import { acceptStructuredWorkCandidate, assertWorkAuthorProofForPersistence, assertWorkDetailVerificationForPersistence } from '../shared/structuredAcquisition'
import type { AppDatabase } from './database'
import { BridgeServer, type BrowserCommand } from './bridgeServer'
import type { WorkerClient } from './workerClient'

export class TaskRunner {
  private timer: NodeJS.Timeout | null = null
  private dispatching = false

  constructor(
    private readonly database: AppDatabase,
    private readonly bridge: BridgeServer,
    private readonly worker: WorkerClient,
    private readonly cacheRoot: string
  ) {
    this.bridge.setEnvelopeHandler((envelope: BrowserCollectionEnvelope) => this.onEnvelope(envelope))
    this.bridge.on('status', (status: Record<string, unknown>) => this.onBrowserStatus(status))
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 1_000)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  startSampleSync(input: SampleSyncOptions): { jobId: number; scope: SampleSyncOptions } {
    const scope = validateSampleSyncOptions(input)
    const active = this.database.db.prepare(`SELECT id FROM jobs WHERE kind LIKE 'collection.%' AND state IN ('queued','running','blocked_user_action','paused','retryable_failed') LIMIT 1`).get() as { id: number } | undefined
    if (active) throw new Error('已有采集任务尚未结束，请先在任务中心等待完成，或处理后恢复现有任务')
    if (!this.bridge.isOnline()) throw new Error('浏览器只读连接器尚未在线，请先恢复连接')
    const jobId = this.database.enqueueJob('collection.following', {
      commandId: `sync-following-${Date.now()}`,
      ...scope,
      collectionOnly: true
    }, 10, 'account', 1)
    return { jobId, scope }
  }

  private async tick(): Promise<void> {
    if (this.dispatching) return
    const job = this.database.nextQueuedJob()
    if (!job) return
    this.dispatching = true
    try {
      const kind = String(job.kind)
      const payload = JSON.parse(String(job.payload_json)) as Record<string, unknown>
      if (kind.startsWith('collection.')) {
        const command = this.toBrowserCommand(Number(job.id), kind, payload)
        if (!command) {
          this.database.updateJob(Number(job.id), 'permanent_failed', { error: `Unsupported job kind: ${kind}` })
          return
        }
        if (!this.bridge.isOnline()) {
          this.database.db.prepare(`UPDATE jobs SET state='blocked_user_action', status_message='等待 Chrome/Edge 连接器在线', updated_at=? WHERE id=? AND state='queued'`).run(
            new Date().toISOString(),
            Number(job.id)
          )
          return
        }

        const transition = this.database.db.prepare(`UPDATE jobs SET state='running', status_message='已发送到浏览器连接器', payload_json=?, updated_at=? WHERE id=? AND state='queued'`).run(
          JSON.stringify({ ...payload, commandId: command.commandId }),
          new Date().toISOString(),
          Number(job.id)
        )
        if (Number(transition.changes) !== 1) return

        // The task must be running before the command becomes visible to the
        // connector. Otherwise a fast poll can return a valid envelope while
        // the database still says queued/blocked and be rejected as stale.
        this.bridge.queueCommand(command)
      } else if (kind === 'media.process') {
        const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl : ''
        if (!mediaUrl) {
          this.database.updateJob(Number(job.id), 'blocked_user_action', { message: '作品已入库，但页面未提供可处理的媒体地址' })
          return
        }
        this.database.updateJob(Number(job.id), 'running', { progress: 0.05, message: '正在下载临时媒体并提取证据' })
        try {
          const result = await this.worker.processMedia({
            workId: String(payload.workId), mediaUrl, cacheRoot: this.cacheRoot,
            asrModel: this.database.getSettings().asrModel
          })
          if (job.subject_id !== null && job.subject_id !== undefined) {
            const workId = Number(job.subject_id)
            this.database.saveMediaEvidence(workId, result)
            const hasFrames = this.database.db.prepare('SELECT 1 FROM evidence_frames WHERE work_id=? LIMIT 1').get(workId)
            const visionJob = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='cloud.work_vision' AND subject_id=? AND state IN ('queued','pending_cloud','completed') LIMIT 1`).get(workId)
            if (hasFrames && !visionJob) this.database.enqueueJob('cloud.work_vision', { workId: payload.workId }, 180, 'work', workId)
          }
          this.database.updateJob(Number(job.id), 'completed', { progress: 1, message: '媒体证据已提取，原片已删除' })
        } catch (error) {
          this.database.updateJob(Number(job.id), 'retryable_failed', { error: error instanceof Error ? error.message : String(error), message: '媒体处理失败，可重试' })
        }
      } else if (kind.startsWith('cloud.')) {
        this.database.updateJob(Number(job.id), 'pending_cloud', { message: '等待费用确认' })
      } else {
        this.database.updateJob(Number(job.id), 'permanent_failed', { error: `No processor for ${kind}` })
      }
    } finally {
      this.dispatching = false
    }
  }

  private toBrowserCommand(jobId: number, kind: string, payload: Record<string, unknown>): BrowserCommand | null {
    const commandId = String(payload.commandId || `job-${jobId}`)
    const actions: Record<string, BrowserCommand['action']> = {
      'collection.following': 'collect_following',
      'collection.creator_works': 'collect_creator_works',
      'collection.work_comments': 'collect_work_comments'
    }
    const action = actions[kind]
    return action ? { contract: 'browser-command/v1', commandId, action, payload, createdAt: new Date().toISOString() } : null
  }

  private onEnvelope(envelope: BrowserCollectionEnvelope): BrowserEventReceipt {
    const sourceJob = this.database.db.prepare(`SELECT id, kind, state, payload_json FROM jobs WHERE kind LIKE 'collection.%' AND json_extract(payload_json, '$.commandId')=? ORDER BY id DESC LIMIT 1`).get(envelope.commandId) as { id: number; kind: string; state: string; payload_json: string } | undefined
    if (!sourceJob) return rejectedReceipt(envelope.commandId, 'unknown-command', '浏览器返回了未知或已经失效的采集命令，内容未入库')
    if (sourceJob.state !== 'running') {
      return rejectedReceipt(envelope.commandId, 'stale-command', '该采集任务当前不接受返回内容，迟到或重复结果未入库')
    }
    const payload = JSON.parse(sourceJob.payload_json) as Record<string, unknown>
    const scope = safeSampleSyncOptions(payload)
    const collectionOnly = payload.collectionOnly !== false
    try {
      validateEnvelopeForJob(envelope, sourceJob.kind, payload)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const message = `已拒绝未通过采集来源校验的结果：${detail}。请重新加载新版连接器，确认目标抖音页面和采集区域已正常显示后恢复任务`
      this.database.updateJob(sourceJob.id, 'blocked_user_action', { message, error: detail })
      return rejectedReceipt(envelope.commandId, 'invalid-collection-proof', message)
    }

    try {
      const scopedEnvelope = limitEnvelope(envelope, sourceJob.kind, scope, payload)
      const counts = this.database.ingestEnvelope(scopedEnvelope, checkpointScopeForJob(sourceJob.kind, payload))
      if (counts.creators > 0) {
        const creators = scopedEnvelope.items.filter((item) => item.entityType === 'creator')
        for (const item of creators) {
          const existing = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='collection.creator_works' AND json_extract(payload_json, '$.creatorId')=? AND state IN ('queued','running','blocked_user_action','completed') LIMIT 1`).get(item.creatorId)
          if (!existing) {
            this.database.enqueueJob('collection.creator_works', {
              creatorId: item.creatorId,
              profileUrl: item.profileUrl,
              commandId: `works-${item.creatorId}-${Date.now()}`,
              ...scope,
              collectionOnly
            }, 30)
          }
        }
      }
      if (counts.works > 0) {
        const works = scopedEnvelope.items.filter((item) => item.entityType === 'work')
        for (const item of works) {
          const row = this.database.db.prepare('SELECT id FROM works WHERE platform_work_id=?').get(item.workId) as { id: number } | undefined
          if (!row) continue
          const existing = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='collection.work_comments' AND subject_id=? AND state IN ('queued','running','blocked_user_action','completed') LIMIT 1`).get(row.id)
          if (!existing) {
            this.database.enqueueJob('collection.work_comments', {
              workId: item.workId,
              creatorId: item.creatorId,
              sourceUrl: item.sourceUrl,
              commandId: `comments-${item.workId}-${Date.now()}`,
              ...scope,
              collectionOnly
            }, 200, 'work', row.id)
          }
          if (!collectionOnly) {
            const mediaExists = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='media.process' AND subject_id=? AND state IN ('queued','running','completed') AND json_extract(payload_json, '$.mediaUrl') IS NOT NULL LIMIT 1`).get(row.id)
            if (item.workType === 'video' && item.mediaUrl && !mediaExists) this.database.enqueueJob('media.process', { workId: item.workId, mediaUrl: item.mediaUrl }, 100, 'work', row.id)
            const analysisExists = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='cloud.work_text' AND subject_id=? AND state IN ('queued','pending_cloud','completed') LIMIT 1`).get(row.id)
            if (!analysisExists) this.database.enqueueJob('cloud.work_text', { workId: item.workId }, 120, 'work', row.id)
            if (counts.comments > 0) {
              const commentsAnalysis = this.database.db.prepare(`SELECT id FROM jobs WHERE kind='cloud.comments' AND subject_id=? AND state IN ('queued','pending_cloud','completed') LIMIT 1`).get(row.id)
              if (!commentsAnalysis) this.database.enqueueJob('cloud.comments', { workId: item.workId }, 250, 'work', row.id)
            }
          }
        }
      }
      this.database.updateJob(sourceJob.id, 'completed', {
        progress: 1,
        message: `采集完成：${counts.creators} 位博主、${counts.works} 个作品、${counts.comments} 条评论`,
        checkpoint: scopedEnvelope.sourceProof ? { sourceProof: scopedEnvelope.sourceProof } : undefined
      })
      return {
        contract: 'browser-event-receipt/v1',
        accepted: true,
        commandId: envelope.commandId
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.database.updateJob(sourceJob.id, 'retryable_failed', { message: '采集结果写入失败，可重试', error: detail })
      return rejectedReceipt(envelope.commandId, 'ingest-failed', `采集结果写入失败：${detail}`)
    }
  }

  private onBrowserStatus(status: Record<string, unknown>): void {
    if (status.type === 'blocked' && status.commandId) {
      this.database.db.prepare(`UPDATE jobs SET state='blocked_user_action', status_message=?, updated_at=? WHERE json_extract(payload_json, '$.commandId')=? AND state IN ('queued','running','blocked_user_action')`).run(String(status.message || '浏览器需要用户操作'), new Date().toISOString(), String(status.commandId))
    }
  }
}

const SAMPLE_SYNC_DEFAULTS: SampleSyncOptions = { creatorLimit: 3, worksPerCreator: 5, commentsPerWork: 20 }
const SAMPLE_SYNC_MAXIMUMS: SampleSyncOptions = { creatorLimit: 5, worksPerCreator: 10, commentsPerWork: 30 }

function rangedInteger(value: unknown, fallback: number, maximum: number, label: string, strict: boolean): number {
  if (value === undefined && !strict) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    if (strict) throw new Error(`${label}必须是 1～${maximum} 的整数`)
    return fallback
  }
  return value
}

export function validateSampleSyncOptions(input: SampleSyncOptions): SampleSyncOptions {
  if (!input || typeof input !== 'object') throw new Error('请先确认小样本同步范围')
  return {
    creatorLimit: rangedInteger(input.creatorLimit, SAMPLE_SYNC_DEFAULTS.creatorLimit, SAMPLE_SYNC_MAXIMUMS.creatorLimit, '博主上限', true),
    worksPerCreator: rangedInteger(input.worksPerCreator, SAMPLE_SYNC_DEFAULTS.worksPerCreator, SAMPLE_SYNC_MAXIMUMS.worksPerCreator, '每位博主作品上限', true),
    commentsPerWork: rangedInteger(input.commentsPerWork, SAMPLE_SYNC_DEFAULTS.commentsPerWork, SAMPLE_SYNC_MAXIMUMS.commentsPerWork, '每个作品评论上限', true)
  }
}

function safeSampleSyncOptions(input: Record<string, unknown>): SampleSyncOptions {
  return {
    creatorLimit: rangedInteger(input.creatorLimit, SAMPLE_SYNC_DEFAULTS.creatorLimit, SAMPLE_SYNC_MAXIMUMS.creatorLimit, '博主上限', false),
    worksPerCreator: rangedInteger(input.worksPerCreator, SAMPLE_SYNC_DEFAULTS.worksPerCreator, SAMPLE_SYNC_MAXIMUMS.worksPerCreator, '每位博主作品上限', false),
    commentsPerWork: rangedInteger(input.commentsPerWork, SAMPLE_SYNC_DEFAULTS.commentsPerWork, SAMPLE_SYNC_MAXIMUMS.commentsPerWork, '每个作品评论上限', false)
  }
}

function limitEnvelope(envelope: BrowserCollectionEnvelope, kind: string, scope: SampleSyncOptions, payload: Record<string, unknown>): BrowserCollectionEnvelope {
  if (kind === 'collection.following') {
    const candidates = envelope.items.filter((item) => item.entityType === 'creator')
    const limited = candidates.length > scope.creatorLimit
    const items = candidates.slice(0, scope.creatorLimit)
    return {
      ...envelope,
      items,
      sourceProof: envelope.sourceProof?.contract === 'douyin-following-structured-proof/v2'
        ? envelope.sourceProof
        : undefined,
      ...(limited ? { completeness: 'partial' as const, hasMore: true, reason: `桌面端小样本硬上限：${scope.creatorLimit} 位博主` } : {})
    }
  }
  if (kind === 'collection.creator_works') {
    const creatorId = typeof payload.creatorId === 'string' ? payload.creatorId : ''
    const candidates = envelope.items.filter((item) => item.entityType === 'work' && item.creatorId === creatorId)
    const limited = candidates.length > scope.worksPerCreator
    return { ...envelope, items: candidates.slice(0, scope.worksPerCreator), ...(limited ? { completeness: 'partial' as const, hasMore: true, reason: `桌面端小样本硬上限：每位博主 ${scope.worksPerCreator} 个作品` } : {}) }
  }
  if (kind === 'collection.work_comments') {
    const workId = typeof payload.workId === 'string' ? payload.workId : ''
    const creatorId = typeof payload.creatorId === 'string' ? payload.creatorId : ''
    const work = envelope.items.find((item) => item.entityType === 'work' && item.workId === workId && item.creatorId === creatorId)
    const candidates = envelope.items.filter((item): item is Extract<BrowserCollectionEnvelope['items'][number], { entityType: 'comment' }> => item.entityType === 'comment' && item.workId === workId)
    const limited = candidates.length > scope.commentsPerWork
    const comments = candidates.slice(0, scope.commentsPerWork)
    return {
      ...envelope,
      items: work ? [work, ...comments] : comments,
      sourceProof: envelope.sourceProof?.contract === 'douyin-comment-source-proof/v1'
        ? { ...envelope.sourceProof, commentIds: comments.map((item) => item.commentId) }
        : undefined,
      ...(limited ? { completeness: 'partial' as const, hasMore: true, reason: `桌面端小样本硬上限：每个作品 ${scope.commentsPerWork} 条评论` } : {})
    }
  }
  throw new Error(`不支持的采集任务类型：${kind}`)
}

function rejectedReceipt(commandId: string | null, code: NonNullable<BrowserEventReceipt['code']>, error: string): BrowserEventReceipt {
  return { contract: 'browser-event-receipt/v1', accepted: false, commandId, code, error }
}

function requireDouyinUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label}不是有效 URL`)
  }
  if (url.origin !== 'https://www.douyin.com' || url.username || url.password) {
    throw new Error(`${label}不是受信任的抖音页面`)
  }
  return url
}

function normalizedPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function requireProfileUrl(value: string, creatorId: string): void {
  const url = requireDouyinUrl(value, '博主主页')
  const match = normalizedPath(url.pathname).match(/^\/user\/([^/]+)$/)
  if (!match || decodeURIComponent(match[1]) !== creatorId || creatorId === 'self') {
    throw new Error('博主主页与 creatorId 不一致')
  }
}

function expectedSyntheticCommentId(workId: string, authorIdentity: string, body: string): string {
  const value = `${workId}:${authorIdentity}:${body}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `comment-${(hash >>> 0).toString(16)}`
}

export function validateEnvelopeForJob(
  envelope: BrowserCollectionEnvelope,
  kind: string,
  payload: Record<string, unknown>
): void {
  if (envelope.completeness === 'blocked' || envelope.completeness === 'failed' || envelope.completeness === 'unavailable') {
    throw new Error(`采集结果状态为 ${envelope.completeness}`)
  }

  if (kind === 'collection.following') {
    const source = requireDouyinUrl(envelope.sourceUrl, '关注列表来源')
    if (normalizedPath(source.pathname) !== '/user/self' || source.searchParams.get('showTab') !== 'follow') {
      throw new Error('来源不是本人关注页')
    }
    const candidateProof = envelope.sourceProof
    if (candidateProof?.contract === 'douyin-following-source-proof/v1') {
      throw new Error('DOM_ONLY_SOURCE_REJECTED:旧 DOM 关注弹窗证明不能作为正式关注事实来源')
    }
    if (!candidateProof || candidateProof.contract !== 'douyin-following-structured-proof/v2') {
      throw new Error('DOM_ONLY_SOURCE_REJECTED:缺少结构化本人关注列表来源证明')
    }
    const proofResult = douyinFollowingStructuredProofSchema.safeParse(candidateProof)
    if (!proofResult.success) throw new Error(`结构化关注证明无效：${proofResult.error.issues[0]?.message ?? 'schema mismatch'}`)
    const proof = proofResult.data
    const expectedRoute = {
      'network-response': 'DY-FOLLOW-NETWORK',
      'embedded-json': 'DY-FOLLOW-EMBEDDED',
      'page-context-fetch': 'DY-FOLLOW-INPAGE'
    }[proof.sourceKind]
    if (proof.routeId !== expectedRoute || proof.endpointKind !== 'following-list' || proof.relationship !== 'following') {
      throw new Error('结构化关注证明的 route/source/endpoint 不一致')
    }
    if (proof.collectedAt !== envelope.collectedAt || proof.browserOrigin !== source.origin) {
      throw new Error('结构化关注证明与 envelope 的采集时间或来源 origin 不一致')
    }
    if (proof.hasMore !== envelope.hasMore || proof.cursorOut !== (envelope.cursor ?? null)) {
      throw new Error('结构化关注证明与 envelope 的分页状态不一致')
    }
    if (!envelope.items.every((item) => item.entityType === 'creator')) {
      throw new Error('关注列表结果混入了非博主实体')
    }
    const creators = envelope.items.filter((item) => item.entityType === 'creator')
    const creatorIds = creators.map((item) => item.creatorId)
    if (new Set(creatorIds).size !== creatorIds.length) throw new Error('关注列表结果包含重复博主')
    if (
      JSON.stringify(proof.creatorIds) !== JSON.stringify(creatorIds)
      || JSON.stringify(proof.returnedIds) !== JSON.stringify(creatorIds)
    ) {
      throw new Error('来源证明与博主清单不一致')
    }
    for (const creator of creators) {
      if (creator.isFollowing !== true) throw new Error('博主缺少明确的关注关系')
      requireProfileUrl(creator.profileUrl, creator.creatorId)
    }
    if (creators.length === 0) {
      if (proof.reportedTotal !== 0 || proof.hasMore || envelope.completeness !== 'complete') {
        throw new Error('空关注列表缺少 total=0、hasMore=false 的结构化闭合证明')
      }
    } else {
      if (proof.reportedTotal !== null && proof.reportedTotal < creators.length) {
        throw new Error('结构化关注证明的 reportedTotal 小于返回博主数')
      }
      if (proof.hasMore ? envelope.completeness !== 'partial' : envelope.completeness !== 'complete') {
        throw new Error('结构化关注证明与 envelope 的完成状态不一致')
      }
    }
    return
  }

  if (envelope.items.some((item) => item.entityType === 'creator')) {
    throw new Error('非关注列表任务不能返回博主实体')
  }
  if (kind === 'collection.creator_works') {
    const creatorId = typeof payload.creatorId === 'string' ? payload.creatorId : ''
    if (!creatorId) throw new Error('作品任务缺少 creatorId')
    const source = requireDouyinUrl(envelope.sourceUrl, '博主作品来源')
    if (normalizedPath(source.pathname) !== `/user/${creatorId}`) throw new Error('作品来源与目标博主不一致')
    const candidateProof = envelope.sourceProof
    if (!candidateProof || candidateProof.contract !== 'douyin-creator-works-structured-proof/v2') {
      throw new Error('DOM_ONLY_SOURCE_REJECTED:作品列表缺少结构化 page-level 来源证明')
    }
    const proofResult = douyinCreatorWorksStructuredProofSchema.safeParse(candidateProof)
    if (!proofResult.success) throw new Error(`结构化作品列表证明无效：${proofResult.error.issues[0]?.message ?? 'schema mismatch'}`)
    const proof = proofResult.data
    if (
      proof.followedCreatorId !== creatorId
      || proof.profileRouteCreatorId !== creatorId
      || proof.requestTargetCreatorId !== creatorId
    ) {
      throw new Error('AUTHOR_PROOF_MISMATCH:作品 page-level proof 的四 ID 链与目标博主不一致')
    }
    if (proof.collectedAt !== envelope.collectedAt || proof.browserOrigin !== source.origin) {
      throw new Error('结构化作品列表证明与 envelope 的采集时间或来源 origin 不一致')
    }
    if (proof.hasMore !== envelope.hasMore || proof.cursorOut !== (envelope.cursor ?? null)) {
      throw new Error('结构化作品列表证明与 envelope 的分页状态不一致')
    }
    if (!envelope.items.every((item) => item.entityType === 'work' && item.creatorId === creatorId)) {
      throw new Error('作品结果包含目标博主以外的数据')
    }
    const works = envelope.items.filter((item) => item.entityType === 'work')
    const workIds = works.map((item) => item.workId)
    if (new Set(workIds).size !== workIds.length) throw new Error('作品结果包含重复 aweme_id')
    if (
      JSON.stringify(proof.workIds) !== JSON.stringify(workIds)
      || JSON.stringify(proof.returnedIds) !== JSON.stringify(workIds)
      || JSON.stringify(proof.authorBindings) !== JSON.stringify(workIds.map((workId) => ({ workId, authorId: creatorId })))
    ) {
      throw new Error('结构化作品 page-level proof 与作品/作者清单不一致')
    }
    if (works.length === 0) {
      if (proof.reportedTotal !== 0 || proof.hasMore || envelope.completeness !== 'complete') {
        throw new Error('空作品列表缺少 total=0、hasMore=false 的结构化闭合证明')
      }
    } else {
      if (proof.reportedTotal !== null && proof.reportedTotal < works.length) {
        throw new Error('结构化作品证明的 reportedTotal 小于返回作品数')
      }
      if (proof.hasMore ? envelope.completeness !== 'partial' : envelope.completeness !== 'complete') {
        throw new Error('结构化作品证明与 envelope 的完成状态不一致')
      }
    }
    for (const item of envelope.items) {
      if (item.entityType !== 'work') continue
      if (!item.authorProof || !item.structuredObservation || !item.detailVerification) {
        throw new Error('DOM_ONLY_SOURCE_REJECTED:作品缺少独立列表 observation、作者证明或详情复核')
      }
      if (
        item.structuredObservation.routeId !== proof.routeId
        || item.structuredObservation.sourceKind !== proof.sourceKind
        || item.structuredObservation.endpointKind !== proof.endpointKind
        || item.structuredObservation.requestTargetCreatorId !== proof.requestTargetCreatorId
        || item.structuredObservation.authorId !== creatorId
        || item.structuredObservation.schemaFingerprint !== proof.schemaFingerprint
        || item.structuredObservation.responseProjectionSha256 !== proof.responseProjectionSha256
        || item.structuredObservation.observedAt !== proof.collectedAt
        || JSON.stringify(item.structuredObservation.routeTrace) !== JSON.stringify(proof.routeTrace)
      ) {
        throw new Error('AUTHOR_PROOF_MISMATCH:作品 observation 未与 page-level projection/hash/trace 精确绑定')
      }
      acceptStructuredWorkCandidate({
        workId: item.workId,
        creatorId: item.creatorId,
        sourceKind: item.authorProof.authorProofSource,
        authorProof: item.authorProof
      }, item.structuredObservation)
      assertWorkAuthorProofForPersistence(item.authorProof, { workId: item.workId, creatorId })
      const detailVerification = assertWorkDetailVerificationForPersistence(item.detailVerification, {
        workId: item.workId,
        creatorId,
        listObservation: item.structuredObservation
      })
      const expectedMetrics = detailVerification.detailStatistics
      const persistedMetricFields = ['likeCount', 'commentCount', 'collectCount', 'shareCount'] as const
      if (!item.metrics || persistedMetricFields.some((field) => item.metrics?.[field] !== expectedMetrics[field])) {
        throw new Error('作品 metrics 必须精确来自已验证的详情 statistics 白名单投影')
      }
    }
    return
  }
  if (kind === 'collection.work_comments') {
    const workId = typeof payload.workId === 'string' ? payload.workId : ''
    const creatorId = typeof payload.creatorId === 'string' ? payload.creatorId : ''
    const source = requireDouyinUrl(envelope.sourceUrl, '作品评论来源')
    const sourceMatch = normalizedPath(source.pathname).match(/^\/(?:video|note)\/([^/]+)$/)
    if (!sourceMatch || decodeURIComponent(sourceMatch[1]) !== workId) throw new Error('评论来源与目标作品不一致')
    const works = envelope.items.filter((item) => item.entityType === 'work')
    if (works.length !== 1 || works[0].workId !== workId || works[0].creatorId !== creatorId) {
      throw new Error('评论结果缺少唯一且匹配的作品实体')
    }
    if (!envelope.items.every((item) => item.entityType === 'work' || (item.entityType === 'comment' && item.workId === workId))) {
      throw new Error('评论结果包含目标作品以外的数据')
    }
    const comments = envelope.items.filter((item) => item.entityType === 'comment')
    if (comments.length === 0) throw new Error('评论结果没有可验证的真实评论')
    const proof = envelope.sourceProof
    if (!proof || proof.contract !== 'douyin-comment-source-proof/v1') throw new Error('缺少作品评论来源证明')
    if (proof.workId !== workId) throw new Error('评论来源证明与目标作品不一致')
    const commentIds = comments.map((item) => item.commentId)
    if (JSON.stringify(proof.commentIds) !== JSON.stringify(commentIds)) {
      throw new Error('评论来源证明与评论清单不一致')
    }
    for (const comment of comments) {
      const body = comment.body.normalize('NFKC').trim().replace(/\s+/g, ' ')
      const authorName = comment.publicAuthorName.normalize('NFKC').trim()
      if (!body || body.length > 5000 || /^[\d\s.,，。+万亿]+$/.test(body)) {
        throw new Error('评论正文缺失、超长或只有数字控件内容')
      }
      if (!authorName || authorName.length > 200 || authorName === '公开用户' || /^\d+$/.test(authorName)) {
        throw new Error('评论缺少明确的公开作者结构')
      }
      if (comment.commentIdKind === 'legacy-unknown') throw new Error('评论 ID 来源未经验证')
      if (comment.commentIdKind === 'page-attribute') {
        if (comment.commentId.length > 240 || /\s/.test(comment.commentId)) throw new Error('页面评论 ID 格式无效')
      } else {
        const expected = expectedSyntheticCommentId(workId, comment.publicAuthorId || comment.publicAuthorName, comment.body)
        if (comment.commentId !== expected) throw new Error('合成评论 ID 与作者和正文不一致')
      }
    }
    return
  }
  throw new Error(`不支持的采集任务类型：${kind}`)
}

function checkpointScopeForJob(kind: string, payload: Record<string, unknown>): { scopeType: string; scopeId: string } {
  if (kind === 'collection.following') return { scopeType: 'creator', scopeId: 'following' }
  if (kind === 'collection.creator_works') return { scopeType: 'work', scopeId: String(payload.creatorId || '') }
  if (kind === 'collection.work_comments') return { scopeType: 'work', scopeId: String(payload.workId || '') }
  throw new Error(`不支持的采集检查点类型：${kind}`)
}
