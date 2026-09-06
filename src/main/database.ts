import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  AnalysisResult,
  AppSettings,
  BrowserCollectionEnvelope,
  CreatorListItem,
  DashboardSummary,
  DemoDataSummary,
  InboxItem,
  JobState
} from '../shared/contracts'
import { analysisResultSchema, browserCollectionEnvelopeSchema } from '../shared/contracts'
import { calculateInboxScore, performanceLabel, type MetricSample } from '../shared/ranking'
import { migrateDatabase } from './schema'

type SqlValue = string | number | bigint | null | Uint8Array
type WorkMetricSample = MetricSample & { workId: number }
type DemoDataContext = {
  summary: DemoDataSummary
  creatorIds: number[]
  workIds: number[]
  commentIds: number[]
  creatorPublicIds: Set<string>
  workPublicIds: Set<string>
  jobIds: number[]
  batchIds: number[]
}

const DEFAULT_SETTINGS: AppSettings = {
  textBaseUrl: '',
  textModel: '',
  visionBaseUrl: '',
  visionModel: '',
  contextWindow: 128000,
  textInputPricePerMillion: null,
  textOutputPricePerMillion: null,
  visionInputPricePerMillion: null,
  visionOutputPricePerMillion: null,
  imagePrice: null,
  asrModel: 'small',
  cacheLimitGb: 20,
  retentionHours: 72,
  interests: [],
  hasTextApiKey: false,
  hasVisionApiKey: false
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

function commentHash(body: string): string {
  return createHash('sha256').update(body.normalize('NFKC').trim().replace(/\s+/g, ' ')).digest('hex')
}

function anonymousAuthorId(authorId: string | null | undefined, authorName: string): string {
  return `匿名-${createHash('sha256').update(authorId || authorName || 'unknown').digest('hex').slice(0, 10)}`
}

export class AppDatabase {
  readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    migrateDatabase(this.db)
    this.ensureDerivedData()
  }

  close(): void {
    this.db.close()
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  ingestEnvelope(
    input: unknown,
    checkpointScope?: { scopeType: string; scopeId: string }
  ): { creators: number; works: number; comments: number } {
    const envelope = browserCollectionEnvelopeSchema.parse(input)
    return this.transaction(() => {
      const counts = { creators: 0, works: 0, comments: 0 }
      for (const item of envelope.items) {
        if (item.entityType === 'creator') {
          this.upsertCreator(envelope, item)
          counts.creators += 1
        } else if (item.entityType === 'work') {
          this.upsertWork(envelope, item)
          counts.works += 1
        } else {
          this.upsertComment(envelope, item)
          counts.comments += 1
        }
      }
      const firstItem = envelope.items[0]
      const scopeType = checkpointScope?.scopeType ?? firstItem?.entityType
      const checkpointId = checkpointScope?.scopeId ?? (firstItem?.entityType === 'creator'
        ? 'following'
        : firstItem?.entityType === 'work'
          ? String(firstItem.creatorId)
          : firstItem?.entityType === 'comment'
            ? String(firstItem.workId)
            : '')
      if (!scopeType || !checkpointId) throw new Error('空采集结果必须提供经过任务校验的检查点范围')
      this.db.prepare(`
        INSERT INTO collection_checkpoints(scope_type, scope_id, cursor, has_more, completeness, reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_type, scope_id) DO UPDATE SET
          cursor=excluded.cursor, has_more=excluded.has_more, completeness=excluded.completeness,
          reason=excluded.reason, updated_at=excluded.updated_at
      `).run(scopeType, checkpointId, envelope.cursor ?? null, envelope.hasMore ? 1 : 0, envelope.completeness, envelope.reason ?? null, envelope.collectedAt)
      this.db.prepare('UPDATE owner_accounts SET last_sync_at = ? WHERE platform = ?').run(envelope.collectedAt, envelope.platform)
      this.db.prepare(`UPDATE jobs SET state='completed', progress=1, status_message='采集完成', completed_at=?, updated_at=? WHERE json_extract(payload_json, '$.commandId')=? AND state IN ('running','blocked_user_action')`).run(nowIso(), nowIso(), envelope.commandId)
      return counts
    })
  }

  private upsertCreator(envelope: BrowserCollectionEnvelope, item: Extract<BrowserCollectionEnvelope['items'][number], { entityType: 'creator' }>): number {
    const existing = this.db.prepare('SELECT id FROM creators WHERE platform=? AND platform_creator_id=?').get(envelope.platform, item.creatorId) as { id: number } | undefined
    this.db.prepare(`
      INSERT INTO creators(platform, platform_creator_id, nickname, avatar_url, signature, profile_url, is_following, discovered_at, updated_at, unfollowed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_creator_id) DO UPDATE SET
        nickname=excluded.nickname, avatar_url=COALESCE(excluded.avatar_url, creators.avatar_url),
        signature=excluded.signature, profile_url=excluded.profile_url, is_following=excluded.is_following,
        updated_at=excluded.updated_at, unfollowed_at=CASE WHEN excluded.is_following=0 THEN excluded.updated_at ELSE NULL END
    `).run(envelope.platform, item.creatorId, item.nickname, item.avatarUrl ?? null, item.signature, item.profileUrl, item.isFollowing ? 1 : 0, envelope.collectedAt, envelope.collectedAt, item.isFollowing ? null : envelope.collectedAt)
    const row = existing ?? this.db.prepare('SELECT id FROM creators WHERE platform=? AND platform_creator_id=?').get(envelope.platform, item.creatorId) as { id: number }
    this.indexCreator(row.id)
    return row.id
  }

  private ensureCreator(platform: string, platformCreatorId: string, sourceUrl: string, collectedAt: string): number {
    const row = this.db.prepare('SELECT id FROM creators WHERE platform=? AND platform_creator_id=?').get(platform, platformCreatorId) as { id: number } | undefined
    if (row) return row.id
    this.db.prepare(`INSERT INTO creators(platform, platform_creator_id, nickname, profile_url, discovered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(platform, platformCreatorId, `博主 ${platformCreatorId.slice(-6)}`, sourceUrl, collectedAt, collectedAt)
    return Number(this.db.prepare('SELECT last_insert_rowid() AS id').get()!.id)
  }

  private upsertWork(envelope: BrowserCollectionEnvelope, item: Extract<BrowserCollectionEnvelope['items'][number], { entityType: 'work' }>): number {
    const creatorId = this.ensureCreator(envelope.platform, item.creatorId, envelope.sourceUrl, envelope.collectedAt)
    this.db.prepare(`
      INSERT INTO works(platform, platform_work_id, creator_id, work_type, source_url, cover_url, media_url, image_urls_json, title, description, published_at, discovered_at, collection_status, last_collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_work_id) DO UPDATE SET
        creator_id=excluded.creator_id, source_url=excluded.source_url, cover_url=COALESCE(excluded.cover_url, works.cover_url),
        media_url=COALESCE(excluded.media_url, works.media_url), image_urls_json=CASE WHEN excluded.image_urls_json='[]' THEN works.image_urls_json ELSE excluded.image_urls_json END,
        title=excluded.title, description=excluded.description, published_at=COALESCE(excluded.published_at, works.published_at),
        collection_status=excluded.collection_status, last_collected_at=excluded.last_collected_at
    `).run(envelope.platform, item.workId, creatorId, item.workType, item.sourceUrl, item.coverUrl ?? null, item.mediaUrl ?? null, JSON.stringify(item.imageUrls ?? []), item.title, item.description, item.publishedAt ?? null, item.discoveredAt, envelope.completeness, envelope.collectedAt)
    const workId = Number((this.db.prepare('SELECT id FROM works WHERE platform=? AND platform_work_id=?').get(envelope.platform, item.workId) as { id: number }).id)
    this.db.prepare(`INSERT OR IGNORE INTO inbox_states(work_id, state, feedback, updated_at) VALUES (?, 'unread', 0, ?)`).run(workId, envelope.collectedAt)
    if (item.metrics) {
      this.db.prepare(`
        INSERT OR IGNORE INTO metric_snapshots(work_id, collected_at, like_count, comment_count, collect_count, share_count, visibility_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(workId, envelope.collectedAt, item.metrics.likeCount, item.metrics.commentCount, item.metrics.collectCount, item.metrics.shareCount, JSON.stringify(item.metrics.visibility))
    }
    this.indexWork(workId)
    return workId
  }

  private upsertComment(envelope: BrowserCollectionEnvelope, item: Extract<BrowserCollectionEnvelope['items'][number], { entityType: 'comment' }>): number | null {
    const work = this.db.prepare('SELECT id FROM works WHERE platform=? AND platform_work_id=?').get(envelope.platform, item.workId) as { id: number } | undefined
    if (!work) return null
    let parentId: number | null = null
    if (item.parentCommentId) {
      const parent = this.db.prepare('SELECT id FROM comments WHERE platform=? AND platform_comment_id=?').get(envelope.platform, item.parentCommentId) as { id: number } | undefined
      parentId = parent?.id ?? null
    }
    const hash = commentHash(item.body)
    const exclusion = item.body.trim() ? null : 'blank'
    const sourceProof = envelope.sourceProof?.contract === 'douyin-comment-source-proof/v1' ? envelope.sourceProof : null
    this.db.prepare(`
      INSERT INTO comments(platform, platform_comment_id, platform_comment_id_kind, work_id, parent_comment_id, public_author_id, public_author_name, anonymous_author_id, body, normalized_hash, like_count, published_at, collected_at, cloud_state, exclusion_reason, source_verified, source_proof_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_comment_id) DO UPDATE SET
        parent_comment_id=COALESCE(excluded.parent_comment_id, comments.parent_comment_id), body=excluded.body,
        platform_comment_id_kind=excluded.platform_comment_id_kind,
        public_author_id=excluded.public_author_id, public_author_name=excluded.public_author_name,
        anonymous_author_id=excluded.anonymous_author_id, normalized_hash=excluded.normalized_hash,
        like_count=excluded.like_count, published_at=COALESCE(excluded.published_at, comments.published_at),
        collected_at=excluded.collected_at, source_verified=excluded.source_verified,
        source_proof_json=excluded.source_proof_json
    `).run(envelope.platform, item.commentId, item.commentIdKind, work.id, parentId, item.publicAuthorId ?? null, item.publicAuthorName, anonymousAuthorId(item.publicAuthorId, item.publicAuthorName), item.body, hash, item.likeCount, item.publishedAt ?? null, envelope.collectedAt, exclusion ? 'excluded' : 'pending', exclusion, sourceProof ? 1 : 0, JSON.stringify(sourceProof ?? {}))
    const comment = this.db.prepare('SELECT id FROM comments WHERE platform=? AND platform_comment_id=?').get(envelope.platform, item.commentId) as { id: number }
    this.indexComment(comment.id)
    return comment.id
  }

  saveAnalysis(input: unknown): AnalysisResult {
    const analysis = analysisResultSchema.parse(input)
    const subjectId = this.resolveSubjectId(analysis.subjectType, analysis.subjectId)
    if (subjectId === null) throw new Error(`Unknown ${analysis.subjectType}: ${analysis.subjectId}`)
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO analyses(subject_type, subject_id, summary, key_points_json, core_expression, evidence_json, confidence, model_id, prompt_version, generated_at, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(subject_type, subject_id, prompt_version) DO UPDATE SET
          summary=excluded.summary, key_points_json=excluded.key_points_json, core_expression=excluded.core_expression,
          evidence_json=excluded.evidence_json, confidence=excluded.confidence, model_id=excluded.model_id,
          generated_at=excluded.generated_at, raw_json=excluded.raw_json
      `).run(analysis.subjectType, subjectId, analysis.summary, JSON.stringify(analysis.keyPoints), analysis.coreExpression, JSON.stringify(analysis.evidence), analysis.confidence, analysis.modelId, analysis.promptVersion, analysis.generatedAt, JSON.stringify(analysis))
      if (analysis.subjectType === 'work' && analysis.promptVersion === 'work-analysis/v1') {
        this.db.prepare(`UPDATE works SET analysis_status='completed' WHERE id=?`).run(subjectId)
        const deleteAi = this.db.prepare(`DELETE FROM work_keywords WHERE work_id=? AND source='ai'`)
        deleteAi.run(subjectId)
        const keywordInsert = this.db.prepare(`INSERT OR IGNORE INTO work_keywords(work_id, keyword, normalized_keyword, source) VALUES (?, ?, ?, 'ai')`)
        for (const keyword of analysis.keywords) keywordInsert.run(subjectId, keyword.trim(), normalizeKeyword(keyword))
        this.db.prepare(`DELETE FROM work_tags WHERE work_id=? AND source='ai'`).run(subjectId)
        const tagInsert = this.db.prepare(`INSERT OR IGNORE INTO work_tags(work_id, tag_id, source, confidence, evidence_json) VALUES (?, ?, 'ai', ?, ?)`)
        for (const domain of analysis.domains) tagInsert.run(subjectId, domain.id, domain.confidence, JSON.stringify(analysis.evidence))
        this.indexWork(subjectId)
      }
      if (analysis.subjectType === 'creator') {
        const insertTag = this.db.prepare(`INSERT INTO creator_tags(creator_id, tag_id, source, confidence, is_locked, evidence_json) VALUES (?, ?, 'ai', ?, 0, ?) ON CONFLICT(creator_id, tag_id) DO UPDATE SET confidence=CASE WHEN creator_tags.is_locked=0 THEN excluded.confidence ELSE creator_tags.confidence END, evidence_json=CASE WHEN creator_tags.is_locked=0 THEN excluded.evidence_json ELSE creator_tags.evidence_json END`)
        for (const domain of analysis.domains) insertTag.run(subjectId, domain.id, domain.confidence, JSON.stringify(analysis.evidence))
        this.indexCreator(subjectId)
      }
    })
    return analysis
  }

  saveMediaEvidence(workId: number, result: Record<string, unknown>): void {
    this.transaction(() => {
      const transcript = Array.isArray(result.transcript) ? result.transcript as Array<Record<string, unknown>> : []
      const ocr = Array.isArray(result.ocr) ? result.ocr as Array<Record<string, unknown>> : []
      const frames = Array.isArray(result.frames) ? result.frames as Array<Record<string, unknown>> : []
      const insertSegment = this.db.prepare(`INSERT OR REPLACE INTO transcript_segments(work_id, start_ms, end_ms, text, provider, confidence) VALUES (?, ?, ?, ?, ?, ?)`)
      for (const segment of transcript) insertSegment.run(workId, Number(segment.startMs), Number(segment.endMs), String(segment.text), String(segment.provider), segment.confidence === null || segment.confidence === undefined ? null : Number(segment.confidence))
      const insertOcr = this.db.prepare(`INSERT OR IGNORE INTO ocr_blocks(work_id, frame_ref, time_ms, text, confidence) VALUES (?, ?, ?, ?, ?)`)
      for (const block of ocr) {
        if (!String(block.text || '').trim()) continue
        insertOcr.run(workId, String(block.frameRef), block.timeMs === null || block.timeMs === undefined ? null : Number(block.timeMs), String(block.text), block.confidence === null || block.confidence === undefined ? null : Number(block.confidence))
      }
      const insertFrame = this.db.prepare(`INSERT OR REPLACE INTO evidence_frames(work_id, frame_ref, time_ms, local_path, perceptual_hash, selected_for_cloud) VALUES (?, ?, ?, ?, ?, 0)`)
      for (const frame of frames) insertFrame.run(workId, String(frame.frameRef), frame.timeMs === null || frame.timeMs === undefined ? null : Number(frame.timeMs), String(frame.path), String(frame.sha256 || ''))
      const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : []
      const status = transcript.length || ocr.length ? 'completed' : warnings.length ? 'partial' : 'completed'
      this.db.prepare('UPDATE works SET media_status=? WHERE id=?').run(status, workId)
      this.db.prepare(`INSERT INTO audit_events(event_type, subject_type, subject_id, detail_json, created_at) VALUES ('media.processed','work',?,?,?)`).run(String(workId), JSON.stringify({ transcriptSegments: transcript.length, ocrBlocks: ocr.length, frames: frames.length, warnings, mediaDeleted: result.mediaDeleted }), nowIso())
      this.indexWork(workId)
    })
  }

  private resolveSubjectId(subjectType: AnalysisResult['subjectType'], publicId: string): number | null {
    const query = subjectType === 'work'
      ? 'SELECT id FROM works WHERE platform_work_id=?'
      : subjectType === 'creator'
        ? 'SELECT id FROM creators WHERE platform_creator_id=?'
        : 'SELECT id FROM works WHERE platform_work_id=?'
    const row = this.db.prepare(query).get(publicId) as { id: number } | undefined
    return row?.id ?? null
  }

  getSummary(connectorOnline = false): DashboardSummary {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM creators WHERE is_following=1) AS following_count,
        (SELECT COUNT(*) FROM works) AS work_count,
        (SELECT COUNT(*) FROM inbox_states WHERE state='unread') AS unread_count,
        (SELECT COUNT(*) FROM comments) AS comment_count,
        (SELECT COUNT(*) FROM works WHERE analysis_status='completed') AS analyzed_count,
        (SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running','pending_cloud','blocked_user_action','retryable_failed')) AS queued_jobs,
        (SELECT MAX(last_sync_at) FROM owner_accounts) AS last_sync_at
    `).get() as Record<string, number | string | null>
    return {
      followingCount: Number(row.following_count),
      workCount: Number(row.work_count),
      unreadCount: Number(row.unread_count),
      commentCount: Number(row.comment_count),
      analyzedCount: Number(row.analyzed_count),
      queuedJobs: Number(row.queued_jobs),
      connectorOnline,
      lastSyncAt: row.last_sync_at as string | null
    }
  }

  getInbox(options: { search?: string; state?: string; limit?: number } = {}): InboxItem[] {
    const conditions: string[] = []
    const params: SqlValue[] = []
    if (options.state && options.state !== 'all') {
      conditions.push('i.state=?')
      params.push(options.state)
    }
    if (options.search?.trim()) {
      const search = options.search.normalize('NFKC').trim()
      conditions.push(`w.id IN (
        SELECT CAST(entity_id AS INTEGER) FROM search_index WHERE entity_type='work' AND search_index MATCH ?
        UNION
        SELECT CAST(entity_id AS INTEGER) FROM search_index WHERE entity_type='work' AND content LIKE ? ESCAPE '\\'
      )`)
      params.push(`"${search.replaceAll('"', '""')}"`, `%${escapeLike(search)}%`)
    }
    params.push(Math.min(500, Math.max(1, options.limit ?? 100)))
    const rows = this.db.prepare(`
      SELECT w.id, w.platform_work_id, w.creator_id, w.is_demo, c.nickname AS creator_name, c.avatar_url AS creator_avatar,
             c.is_starred, w.work_type, w.source_url, w.cover_url, w.title, w.description, w.published_at,
             w.discovered_at, w.analysis_status, i.state AS read_state,
             a.summary, a.core_expression,
             (SELECT like_count FROM metric_snapshots m WHERE m.work_id=w.id ORDER BY collected_at DESC LIMIT 1) AS like_count,
             (SELECT comment_count FROM metric_snapshots m WHERE m.work_id=w.id ORDER BY collected_at DESC LIMIT 1) AS comment_count,
             (SELECT collect_count FROM metric_snapshots m WHERE m.work_id=w.id ORDER BY collected_at DESC LIMIT 1) AS collect_count,
             COALESCE((SELECT json_group_array(keyword) FROM work_keywords k WHERE k.work_id=w.id), '[]') AS keywords,
             COALESCE((SELECT json_group_array(t.label) FROM work_tags wt JOIN taxonomy_tags t ON t.id=wt.tag_id WHERE wt.work_id=w.id), '[]') AS domains,
             COALESCE((SELECT json_group_array(t.label) FROM creator_tags ct JOIN taxonomy_tags t ON t.id=ct.tag_id WHERE ct.creator_id=c.id), '[]') AS creator_domains
      FROM works w
      JOIN creators c ON c.id=w.creator_id
      JOIN inbox_states i ON i.work_id=w.id
      LEFT JOIN analyses a ON a.subject_type='work' AND a.subject_id=w.id AND a.prompt_version='work-analysis/v1'
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY w.discovered_at DESC
      LIMIT ?
    `).all(...params) as Array<Record<string, unknown>>
    const interests = new Set(this.getSettings().interests.map(normalizeKeyword))
    const performanceCache = new Map<number, WorkMetricSample[]>()
    const mapped = rows.map((row) => {
      const keywords = JSON.parse(String(row.keywords)) as string[]
      const domains = JSON.parse(String(row.domains)) as string[]
      const creatorDomains = JSON.parse(String(row.creator_domains)) as string[]
      const creatorId = Number(row.creator_id)
      let creatorSamples = performanceCache.get(creatorId)
      if (!creatorSamples) {
        creatorSamples = this.creatorMetricSamples(creatorId)
        performanceCache.set(creatorId, creatorSamples)
      }
      const matches = [...keywords, ...domains].filter((value) => interests.has(normalizeKeyword(value))).length
      const keywordAffinity = interests.size ? Math.min(1, matches / Math.max(1, interests.size)) : 0
      const item: InboxItem = {
        id: Number(row.id),
        platformWorkId: String(row.platform_work_id),
        creatorId,
        creatorName: String(row.creator_name),
        creatorAvatar: row.creator_avatar as string | null,
        workType: row.work_type as 'video' | 'image',
        sourceUrl: String(row.source_url),
        coverUrl: row.cover_url as string | null,
        title: String(row.title),
        description: String(row.description),
        publishedAt: row.published_at as string | null,
        discoveredAt: String(row.discovered_at),
        summary: row.summary as string | null,
        coreExpression: row.core_expression as string | null,
        keywords,
        domains,
        creatorDomains,
        isDemo: Boolean(row.is_demo),
        likeCount: row.like_count === null ? null : Number(row.like_count),
        commentCount: row.comment_count === null ? null : Number(row.comment_count),
        collectCount: row.collect_count === null ? null : Number(row.collect_count),
        readState: row.read_state as InboxItem['readState'],
        analysisStatus: String(row.analysis_status),
        performance: this.workPerformance(Number(row.id), creatorId, creatorSamples),
        interestScore: 0
      }
      item.interestScore = calculateInboxScore({ readState: item.readState, publishedAt: item.publishedAt, discoveredAt: item.discoveredAt, isCreatorStarred: Boolean(row.is_starred), keywordAffinity })
      return item
    })
    return mapped.sort((a, b) => b.interestScore - a.interestScore || Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt))
  }

  getCreators(search = ''): CreatorListItem[] {
    const params: SqlValue[] = []
    const normalizedSearch = search.normalize('NFKC').trim()
    const where = normalizedSearch ? `WHERE c.id IN (
      SELECT CAST(entity_id AS INTEGER) FROM search_index WHERE entity_type='creator' AND search_index MATCH ?
      UNION
      SELECT CAST(entity_id AS INTEGER) FROM search_index WHERE entity_type='creator' AND content LIKE ? ESCAPE '\\'
    )` : ''
    if (normalizedSearch) params.push(`"${normalizedSearch.replaceAll('"', '""')}"`, `%${escapeLike(normalizedSearch)}%`)
    const rows = this.db.prepare(`
      SELECT c.*,
        COUNT(DISTINCT w.id) AS work_count,
        SUM(CASE WHEN w.analysis_status='completed' THEN 1 ELSE 0 END) AS analyzed_count,
        MAX(w.published_at) AS last_published_at,
        COALESCE((SELECT json_group_array(t.label) FROM creator_tags ct JOIN taxonomy_tags t ON t.id=ct.tag_id WHERE ct.creator_id=c.id), '[]') AS domains
      FROM creators c LEFT JOIN works w ON w.creator_id=c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.is_starred DESC, COALESCE(MAX(w.published_at), c.updated_at) DESC
    `).all(...params) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: Number(row.id), platformCreatorId: String(row.platform_creator_id), nickname: String(row.nickname),
      avatarUrl: row.avatar_url as string | null, signature: String(row.signature), profileUrl: String(row.profile_url),
      isFollowing: Boolean(row.is_following), isStarred: Boolean(row.is_starred), note: String(row.user_note),
      domains: JSON.parse(String(row.domains)), workCount: Number(row.work_count), analyzedCount: Number(row.analyzed_count || 0),
      lastPublishedAt: row.last_published_at as string | null
    }))
  }

  getWorkDetail(workId: number): Record<string, unknown> | null {
    const work = this.db.prepare(`SELECT w.*, c.nickname AS creator_name, c.profile_url, i.state AS inbox_state, i.feedback,
      a.summary, a.key_points_json, a.core_expression, a.evidence_json, a.confidence, a.model_id, a.generated_at
      FROM works w JOIN creators c ON c.id=w.creator_id JOIN inbox_states i ON i.work_id=w.id
      LEFT JOIN analyses a ON a.subject_type='work' AND a.subject_id=w.id AND a.prompt_version='work-analysis/v1' WHERE w.id=?`).get(workId) as Record<string, unknown> | undefined
    if (!work) return null
    return {
      ...work,
      performance: this.workPerformance(workId, Number(work.creator_id)),
      keyPoints: work.key_points_json ? JSON.parse(String(work.key_points_json)) : [],
      evidence: work.evidence_json ? JSON.parse(String(work.evidence_json)) : [],
      keywords: (this.db.prepare('SELECT keyword, source FROM work_keywords WHERE work_id=? ORDER BY source DESC, keyword').all(workId) as Array<Record<string, unknown>>),
      metrics: this.db.prepare('SELECT * FROM metric_snapshots WHERE work_id=? ORDER BY collected_at DESC').all(workId),
      workDomains: (this.db.prepare('SELECT t.label FROM work_tags wt JOIN taxonomy_tags t ON t.id=wt.tag_id WHERE wt.work_id=? ORDER BY wt.confidence DESC, t.label').all(workId) as Array<{ label: string }>).map((row) => row.label),
      creatorDomains: (this.db.prepare('SELECT t.label FROM creator_tags ct JOIN taxonomy_tags t ON t.id=ct.tag_id WHERE ct.creator_id=? ORDER BY ct.confidence DESC, t.label').all(Number(work.creator_id)) as Array<{ label: string }>).map((row) => row.label),
      transcript: this.db.prepare('SELECT start_ms, end_ms, text, provider, confidence FROM transcript_segments WHERE work_id=? ORDER BY start_ms').all(workId),
      ocr: this.db.prepare('SELECT frame_ref, time_ms, text, confidence FROM ocr_blocks WHERE work_id=? ORDER BY COALESCE(time_ms,0)').all(workId),
      comments: this.db.prepare('SELECT id, platform_comment_id, platform_comment_id_kind, parent_comment_id, public_author_id, public_author_name, anonymous_author_id, body, like_count, published_at, collected_at, cloud_state, source_verified, source_proof_json FROM comments WHERE work_id=? ORDER BY COALESCE(like_count,0) DESC, published_at LIMIT 500').all(workId),
      evidenceFrames: this.db.prepare('SELECT frame_ref, time_ms, selected_for_cloud FROM evidence_frames WHERE work_id=? ORDER BY COALESCE(time_ms,0)').all(workId),
      visualAnalysis: (() => {
        const row = this.db.prepare(`SELECT summary, key_points_json, core_expression, evidence_json, confidence, model_id, generated_at FROM analyses WHERE subject_type='work' AND subject_id=? AND prompt_version='work-vision/v1'`).get(workId) as Record<string, unknown> | undefined
        return row ? { ...row, keyPoints: JSON.parse(String(row.key_points_json)), evidence: JSON.parse(String(row.evidence_json)) } : null
      })()
    }
  }

  private creatorMetricSamples(creatorId: number): WorkMetricSample[] {
    const rows = this.db.prepare(`
      SELECT m.work_id, m.like_count, m.comment_count, m.collect_count
      FROM metric_snapshots m JOIN works w ON w.id=m.work_id
      WHERE w.creator_id=? AND m.id=(SELECT m2.id FROM metric_snapshots m2 WHERE m2.work_id=m.work_id ORDER BY m2.collected_at DESC LIMIT 1)
    `).all(creatorId) as Array<{ work_id: number; like_count: number | null; comment_count: number | null; collect_count: number | null }>
    return rows.map((row) => ({ workId: row.work_id, likeCount: row.like_count, commentCount: row.comment_count, collectCount: row.collect_count }))
  }

  private workPerformance(workId: number, creatorId: number, samples = this.creatorMetricSamples(creatorId)): ReturnType<typeof performanceLabel> {
    const target = samples.find((row) => row.workId === workId)
    if (!target) return 'insufficient'
    return performanceLabel(samples, target)
  }

  updateInboxState(workId: number, state: InboxItem['readState'], feedback = 0): void {
    this.db.prepare(`INSERT INTO inbox_states(work_id, state, feedback, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET state=excluded.state, feedback=excluded.feedback, updated_at=excluded.updated_at`).run(workId, state, feedback, nowIso())
    if (feedback !== 0) {
      const tokens = this.db.prepare('SELECT normalized_keyword AS token FROM work_keywords WHERE work_id=?').all(workId) as Array<{ token: string }>
      const update = this.db.prepare(`INSERT INTO interest_weights(token, weight, source, updated_at) VALUES (?, ?, 'feedback', ?) ON CONFLICT(token) DO UPDATE SET weight=MAX(-3, MIN(3, interest_weights.weight + excluded.weight)), updated_at=excluded.updated_at`)
      for (const { token } of tokens) update.run(token, feedback * 0.25, nowIso())
    }
  }

  updateCreator(creatorId: number, input: { isStarred?: boolean; note?: string }): void {
    if (input.isStarred !== undefined) this.db.prepare('UPDATE creators SET is_starred=?, updated_at=? WHERE id=?').run(input.isStarred ? 1 : 0, nowIso(), creatorId)
    if (input.note !== undefined) this.db.prepare('UPDATE creators SET user_note=?, updated_at=? WHERE id=?').run(input.note, nowIso(), creatorId)
    this.indexCreator(creatorId)
  }

  getJobs(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM jobs ORDER BY CASE state WHEN \'running\' THEN 0 WHEN \'blocked_user_action\' THEN 1 WHEN \'queued\' THEN 2 ELSE 3 END, priority, created_at DESC LIMIT 500').all().map((row) => ({ ...row, payload: JSON.parse(String(row.payload_json)), checkpoint: JSON.parse(String(row.checkpoint_json)) }))
  }

  enqueueJob(kind: string, payload: Record<string, unknown>, priority = 100, subjectType: string | null = null, subjectId: number | null = null): number {
    const now = nowIso()
    this.db.prepare(`INSERT INTO jobs(kind, state, priority, subject_type, subject_id, payload_json, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?, ?, ?, ?)`).run(kind, priority, subjectType, subjectId, JSON.stringify(payload), now, now)
    return Number(this.db.prepare('SELECT last_insert_rowid() AS id').get()!.id)
  }

  updateJob(jobId: number, state: JobState, fields: { progress?: number; message?: string; error?: string | null; checkpoint?: unknown } = {}): void {
    const completed = state === 'completed' ? nowIso() : null
    this.db.prepare(`UPDATE jobs SET state=?, progress=COALESCE(?, progress), status_message=COALESCE(?, status_message), error_message=?, checkpoint_json=COALESCE(?, checkpoint_json), updated_at=?, completed_at=COALESCE(?, completed_at) WHERE id=?`).run(state, fields.progress ?? null, fields.message ?? null, fields.error ?? null, fields.checkpoint === undefined ? null : JSON.stringify(fields.checkpoint), nowIso(), completed, jobId)
  }

  cancelActiveJobs(): void {
    this.db.prepare(`UPDATE jobs SET state='paused', status_message='用户已暂停', updated_at=? WHERE state IN ('queued','running','retryable_failed')`).run(nowIso())
  }

  resumePausedJobs(): void {
    this.db.prepare(`UPDATE jobs SET state='queued', status_message='等待恢复或重新尝试', error_message=NULL, updated_at=? WHERE state IN ('paused','blocked_user_action','retryable_failed')`).run(nowIso())
  }

  nextQueuedJob(): Record<string, unknown> | null {
    return (this.db.prepare(`SELECT * FROM jobs WHERE state='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY priority, created_at LIMIT 1`).get(nowIso()) as Record<string, unknown> | undefined) ?? null
  }

  getSettings(): AppSettings {
    const row = this.db.prepare(`SELECT value_json FROM app_settings WHERE key='settings'`).get() as { value_json: string } | undefined
    const parsed: unknown = row ? JSON.parse(row.value_json) : {}
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    const legacyBaseUrl = typeof stored.cloudBaseUrl === 'string' ? stored.cloudBaseUrl : ''
    const legacyInputPrice = typeof stored.inputPricePerMillion === 'number' ? stored.inputPricePerMillion : null
    const legacyOutputPrice = typeof stored.outputPricePerMillion === 'number' ? stored.outputPricePerMillion : null
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      textBaseUrl: typeof stored.textBaseUrl === 'string' ? stored.textBaseUrl : legacyBaseUrl,
      visionBaseUrl: typeof stored.visionBaseUrl === 'string' ? stored.visionBaseUrl : '',
      textInputPricePerMillion: typeof stored.textInputPricePerMillion === 'number' ? stored.textInputPricePerMillion : legacyInputPrice,
      textOutputPricePerMillion: typeof stored.textOutputPricePerMillion === 'number' ? stored.textOutputPricePerMillion : legacyOutputPrice,
      visionInputPricePerMillion: typeof stored.visionInputPricePerMillion === 'number' ? stored.visionInputPricePerMillion : null,
      visionOutputPricePerMillion: typeof stored.visionOutputPricePerMillion === 'number' ? stored.visionOutputPricePerMillion : null,
      hasTextApiKey: false,
      hasVisionApiKey: false
    }
  }

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const baseUrl = (input: unknown, fallback: string, label: string): string => {
      if (typeof input !== 'string') return fallback
      const value = input.trim().slice(0, 2000)
      if (value) {
        let protocol = ''
        try {
          protocol = new URL(value).protocol
        } catch {
          throw new Error(`${label} Base URL 不是有效地址`)
        }
        if (protocol !== 'https:' && protocol !== 'http:') throw new Error(`${label} Base URL 只支持 HTTP 或 HTTPS`)
      }
      return value
    }
    const optionalPrice = (input: unknown, fallback: number | null): number | null => {
      if (input === null) return null
      if (typeof input !== 'number') return fallback
      if (!Number.isFinite(input) || input < 0) throw new Error('模型单价必须是非负数')
      return input
    }
    const clampInteger = (input: unknown, fallback: number, minimum: number, maximum: number): number => {
      if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
      return Math.min(maximum, Math.max(minimum, Math.trunc(input)))
    }
    const value: AppSettings = {
      textBaseUrl: baseUrl(settings.textBaseUrl, current.textBaseUrl, '文本服务'),
      textModel: typeof settings.textModel === 'string' ? settings.textModel.trim().slice(0, 200) : current.textModel,
      visionBaseUrl: baseUrl(settings.visionBaseUrl, current.visionBaseUrl, '视觉服务'),
      visionModel: typeof settings.visionModel === 'string' ? settings.visionModel.trim().slice(0, 200) : current.visionModel,
      contextWindow: clampInteger(settings.contextWindow, current.contextWindow, 8_000, 2_000_000),
      textInputPricePerMillion: optionalPrice(settings.textInputPricePerMillion, current.textInputPricePerMillion),
      textOutputPricePerMillion: optionalPrice(settings.textOutputPricePerMillion, current.textOutputPricePerMillion),
      visionInputPricePerMillion: optionalPrice(settings.visionInputPricePerMillion, current.visionInputPricePerMillion),
      visionOutputPricePerMillion: optionalPrice(settings.visionOutputPricePerMillion, current.visionOutputPricePerMillion),
      imagePrice: optionalPrice(settings.imagePrice, current.imagePrice),
      asrModel: settings.asrModel === 'medium' ? 'medium' : settings.asrModel === 'small' ? 'small' : current.asrModel,
      cacheLimitGb: clampInteger(settings.cacheLimitGb, current.cacheLimitGb, 1, 500),
      retentionHours: clampInteger(settings.retentionHours, current.retentionHours, 1, 720),
      interests: Array.isArray(settings.interests)
        ? [...new Set(settings.interests.filter((value): value is string => typeof value === 'string').map((value) => value.trim().slice(0, 80)).filter(Boolean))].slice(0, 100)
        : current.interests,
      hasTextApiKey: false,
      hasVisionApiKey: false
    }
    this.db.prepare(`INSERT INTO app_settings(key, value_json, updated_at) VALUES ('settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`).run(JSON.stringify(value), nowIso())
    return value
  }

  getDemoDataSummary(): DemoDataSummary {
    return this.demoDataContext().summary
  }

  clearDemoData(): DemoDataSummary {
    const context = this.demoDataContext()
    const { summary, creatorIds, workIds, commentIds, creatorPublicIds, workPublicIds, jobIds, batchIds } = context
    if (!summary.creatorCount && !summary.workCount) return summary
    if (summary.blockingOperationCount) throw new Error('演示资料仍有关联任务或云端批次正在执行，请等待执行结束后再清理')

    return this.transaction(() => {
      if (batchIds.length) {
        this.db.prepare(`DELETE FROM audit_events WHERE subject_type='batch' AND subject_id IN (${placeholders(batchIds)})`).run(...batchIds.map(String))
        this.db.prepare(`DELETE FROM analysis_batches WHERE id IN (${placeholders(batchIds)})`).run(...batchIds)
      }
      if (jobIds.length) this.db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders(jobIds)})`).run(...jobIds)

      const checkpointIds = [...creatorPublicIds, ...workPublicIds]
      if (checkpointIds.length) this.db.prepare(`DELETE FROM collection_checkpoints WHERE scope_id IN (${placeholders(checkpointIds)})`).run(...checkpointIds)

      if (commentIds.length) this.db.prepare(`DELETE FROM search_index WHERE entity_type='comment' AND entity_id IN (${placeholders(commentIds)})`).run(...commentIds.map(String))
      if (workIds.length) {
        const workIdStrings = workIds.map(String)
        this.db.prepare(`DELETE FROM audit_events WHERE subject_type IN ('work','work_vision','comments') AND subject_id IN (${placeholders(workIds)})`).run(...workIdStrings)
        this.db.prepare(`DELETE FROM analyses WHERE subject_type IN ('work','comments') AND subject_id IN (${placeholders(workIds)})`).run(...workIds)
        this.db.prepare(`DELETE FROM search_index WHERE entity_type='work' AND entity_id IN (${placeholders(workIds)})`).run(...workIdStrings)
        this.db.prepare(`DELETE FROM works WHERE id IN (${placeholders(workIds)}) AND (is_demo=1 OR creator_id IN (SELECT id FROM creators WHERE is_demo=1))`).run(...workIds)
      }
      if (creatorIds.length) {
        const creatorIdStrings = creatorIds.map(String)
        this.db.prepare(`DELETE FROM audit_events WHERE subject_type='creator' AND subject_id IN (${placeholders(creatorIds)})`).run(...creatorIdStrings)
        this.db.prepare(`DELETE FROM analyses WHERE subject_type='creator' AND subject_id IN (${placeholders(creatorIds)})`).run(...creatorIds)
        this.db.prepare(`DELETE FROM search_index WHERE entity_type='creator' AND entity_id IN (${placeholders(creatorIds)})`).run(...creatorIdStrings)
        this.db.prepare(`DELETE FROM creators WHERE id IN (${placeholders(creatorIds)}) AND is_demo=1`).run(...creatorIds)
      }

      const remaining = this.db.prepare('SELECT (SELECT COUNT(*) FROM creators WHERE is_demo=1) + (SELECT COUNT(*) FROM works WHERE is_demo=1) AS count').get() as { count: number }
      if (Number(remaining.count)) throw new Error('演示资料未能完整清理，操作已经回滚')
      const realContent = this.db.prepare('SELECT (SELECT COUNT(*) FROM creators) + (SELECT COUNT(*) FROM works) AS count').get() as { count: number }
      if (!Number(realContent.count)) {
        this.db.prepare(`UPDATE owner_accounts SET last_sync_at=NULL WHERE platform='douyin'`).run()
        this.db.prepare(`DELETE FROM collection_checkpoints WHERE scope_id='following'`).run()
      }
      this.db.prepare(`INSERT INTO audit_events(event_type, subject_type, subject_id, detail_json, created_at) VALUES ('demo.cleared','library',NULL,?,?)`)
        .run(JSON.stringify(summary), nowIso())
      return summary
    })
  }

  seedDemo(): void {
    const existing = Number((this.db.prepare('SELECT COUNT(*) AS count FROM works').get() as { count: number }).count)
    if (existing > 0) return
    const collectedAt = nowIso()
    const creators = [
      ['c-tech', '量子茶馆', '拆解 AI、芯片与消费电子，不贩卖焦虑', 'technology'],
      ['c-finance', '慢钱研究所', '普通人的金融常识与资产配置', 'finance'],
      ['c-history', '地图里的往事', '用地图讲清历史与地缘', 'humanities'],
      ['c-work', '职场显微镜', '真实职场案例和沟通方法', 'business'],
      ['c-health', '靠谱营养师周周', '循证营养，不神化单一食物', 'health'],
      ['c-auto', '电车观察室', '新能源车长期体验与技术解读', 'automotive']
    ] as const
    const items = creators.map(([creatorId, nickname, signature]) => ({ entityType: 'creator' as const, creatorId, nickname, signature, profileUrl: `https://www.douyin.com/user/${creatorId}`, avatarUrl: null, isFollowing: true }))
    this.ingestEnvelope({ contract: 'browser-collection-envelope/v1', commandId: 'demo-creators', platform: 'douyin', collectedAt, sourceUrl: 'https://www.douyin.com/user/self?showTab=follow', completeness: 'complete', hasMore: false, items })
    creators.forEach(([creatorId, nickname, , domain], creatorIndex) => {
      const workItems = Array.from({ length: 4 }, (_, index) => {
        const published = new Date(Date.now() - (creatorIndex * 8 + index * 22 + 1) * 3_600_000).toISOString()
        const titles: Record<string, string[]> = {
          technology: ['手机端 AI 真正有用的三个场景', '为什么芯片制程数字不等于性能', '大模型价格战之后会发生什么', '一张图看懂端侧推理'],
          finance: ['利率下降时普通人该看什么', '别把高收益当成低风险', '家庭现金流的四个账户', '指数基金常见误区'],
          humanities: ['一条河如何改变三座城市', '地图上的古代交通线', '边界为什么画在这里', '从地形看一场战争'],
          business: ['领导说再想想究竟是什么意思', '汇报不等于念工作日志', '同事越界时如何回应', '转岗前先回答这三个问题'],
          health: ['蛋白质不是越多越好', '看懂配料表的顺序', '熬夜后补觉有用吗', '保健品证据等级怎么分'],
          automotive: ['冬季续航应该怎么测', '800V 平台带来了什么', '辅助驾驶不是自动驾驶', '三年电车电池衰减实测']
        }
        return {
          entityType: 'work' as const,
          workId: `${creatorId}-w${index + 1}`,
          creatorId,
          workType: index === 3 ? 'image' as const : 'video' as const,
          sourceUrl: `https://www.douyin.com/video/${creatorId}-w${index + 1}`,
          coverUrl: `https://picsum.photos/seed/${creatorId}-${index}/720/960`,
          title: titles[domain][index],
          description: `${nickname}：${titles[domain][index]}。从事实、误区和可执行建议三个层次展开。`,
          publishedAt: published,
          discoveredAt: collectedAt,
          metrics: {
            likeCount: creatorIndex === 2 && index === 3 ? null : (creatorIndex + 2) * (index + 3) * 137,
            commentCount: creatorIndex === 1 && index === 2 ? null : (creatorIndex + 1) * (index + 2) * 19,
            collectCount: creatorIndex === 0 && index === 1 ? null : (creatorIndex + 3) * (index + 1) * 41,
            shareCount: null,
            visibility: {
              like: creatorIndex === 2 && index === 3 ? 'unknown' as const : 'visible' as const,
              comment: creatorIndex === 1 && index === 2 ? 'unknown' as const : 'visible' as const,
              collect: creatorIndex === 0 && index === 1 ? 'unknown' as const : 'visible' as const,
              share: 'unknown' as const
            }
          }
        }
      })
      this.ingestEnvelope({ contract: 'browser-collection-envelope/v1', commandId: `demo-${creatorId}`, platform: 'douyin', collectedAt, sourceUrl: `https://www.douyin.com/user/${creatorId}`, completeness: 'complete', hasMore: false, items: workItems })
      const creatorDbId = (this.db.prepare('SELECT id FROM creators WHERE platform_creator_id=?').get(creatorId) as { id: number }).id
      this.db.prepare('UPDATE creators SET is_demo=1 WHERE id=?').run(creatorDbId)
      this.db.prepare(`UPDATE works SET is_demo=1 WHERE creator_id=? AND platform_work_id GLOB 'c-*-w[1-4]'`).run(creatorDbId)
      this.db.prepare(`INSERT INTO creator_tags(creator_id, tag_id, source, confidence, is_locked, evidence_json) VALUES (?, ?, 'ai', 0.92, 0, '[]')`).run(creatorDbId, domain)
      workItems.forEach((work, index) => {
        this.saveAnalysis({
          contract: 'analysis-result/v1', subjectType: 'work', subjectId: work.workId,
          summary: `${work.title}：作者先指出常见误解，再用两个可核验的例子解释原因，最后给出普通用户可以立即采用的判断方法。`,
          keyPoints: ['先区分表面现象与真实原因', '用具体例子降低理解门槛', '给出可操作的判断清单'],
          coreExpression: '面对复杂信息，应先建立可验证的判断框架，而不是追逐单一结论。',
          domains: [{ id: domain, confidence: 0.92 }], keywords: [work.title.split('的')[0], creators[creatorIndex][3], '方法论'],
          evidence: [{ kind: 'page', ref: work.sourceUrl, quote: work.description }], confidence: 0.82,
          modelId: 'demo-local', promptVersion: 'work-analysis/v1', generatedAt: collectedAt
        })
        const commentItems = Array.from({ length: 5 }, (_, commentIndex) => ({
          entityType: 'comment' as const, commentId: `${work.workId}-cm${commentIndex}`, workId: work.workId,
          parentCommentId: null, publicAuthorId: `viewer-${commentIndex}`, publicAuthorName: `观众${commentIndex + 1}`,
          body: ['这个解释终于把概念讲清楚了', '能不能再做一期具体案例？', '这里的数据来源是什么？', '我之前确实理解反了', '已收藏，准备按清单试一下'][commentIndex],
          likeCount: 25 - commentIndex * 3, publishedAt: work.publishedAt
        }))
        this.ingestEnvelope({ contract: 'browser-collection-envelope/v1', commandId: `demo-comments-${work.workId}`, platform: 'douyin', collectedAt, sourceUrl: work.sourceUrl, completeness: 'complete', hasMore: false, items: commentItems })
      })
      this.indexCreator(creatorDbId)
    })
  }

  private demoDataContext(): DemoDataContext {
    const creators = this.db.prepare('SELECT id, platform_creator_id, is_starred, user_note FROM creators WHERE is_demo=1 ORDER BY id').all() as Array<{ id: number; platform_creator_id: string; is_starred: number; user_note: string }>
    const creatorIds = creators.map((row) => Number(row.id))
    const works = this.db.prepare('SELECT id, platform_work_id FROM works WHERE is_demo=1 OR creator_id IN (SELECT id FROM creators WHERE is_demo=1) ORDER BY id').all() as Array<{ id: number; platform_work_id: string }>
    const workIds = works.map((row) => Number(row.id))
    const comments = workIds.length
      ? this.db.prepare(`SELECT id FROM comments WHERE work_id IN (${placeholders(workIds)}) ORDER BY id`).all(...workIds) as Array<{ id: number }>
      : []
    const commentIds = comments.map((row) => Number(row.id))
    const creatorPublicIds = new Set(creators.map((row) => row.platform_creator_id))
    const workPublicIds = new Set(works.map((row) => row.platform_work_id))
    const workSet = new Set(workIds)
    const creatorSet = new Set(creatorIds)
    const commentSet = new Set(commentIds)

    const jobs = this.db.prepare('SELECT id, state, subject_type, subject_id, payload_json FROM jobs').all() as Array<{ id: number; state: string; subject_type: string | null; subject_id: number | null; payload_json: string }>
    const relatedJobs = jobs.filter((job) => {
      if (job.subject_type === 'work' && job.subject_id !== null && workSet.has(Number(job.subject_id))) return true
      if (job.subject_type === 'creator' && job.subject_id !== null && creatorSet.has(Number(job.subject_id))) return true
      try {
        const payload = JSON.parse(job.payload_json) as { workId?: unknown; creatorId?: unknown }
        return (typeof payload.workId === 'string' && workPublicIds.has(payload.workId))
          || (typeof payload.creatorId === 'string' && creatorPublicIds.has(payload.creatorId))
      } catch {
        return false
      }
    })

    const batches = this.db.prepare('SELECT id, state, manifest_json FROM analysis_batches').all() as Array<{ id: number; state: string; manifest_json: string }>
    const relatedBatches = batches.filter((batch) => {
      try {
        const manifest = JSON.parse(batch.manifest_json) as { workIds?: unknown[]; commentIds?: unknown[]; visionWorks?: Array<{ workId?: unknown }> }
        return (manifest.workIds || []).some((id) => workSet.has(Number(id)))
          || (manifest.commentIds || []).some((id) => commentSet.has(Number(id)))
          || (manifest.visionWorks || []).some((work) => workSet.has(Number(work.workId)))
      } catch {
        return false
      }
    })

    const scalar = (sql: string, values: SqlValue[] = []): number => Number((this.db.prepare(sql).get(...values) as { count: number }).count)
    const workWhere = workIds.length ? `work_id IN (${placeholders(workIds)})` : '0'
    const analysisConditions: string[] = []
    const analysisValues: SqlValue[] = []
    if (workIds.length) {
      analysisConditions.push(`subject_type IN ('work','comments') AND subject_id IN (${placeholders(workIds)})`)
      analysisValues.push(...workIds)
    }
    if (creatorIds.length) {
      analysisConditions.push(`subject_type='creator' AND subject_id IN (${placeholders(creatorIds)})`)
      analysisValues.push(...creatorIds)
    }
    const analysisCount = analysisConditions.length
      ? scalar(`SELECT COUNT(*) AS count FROM analyses WHERE ${analysisConditions.map((condition) => `(${condition})`).join(' OR ')}`, analysisValues)
      : 0
    const summary: DemoDataSummary = {
      creatorCount: creatorIds.length,
      workCount: workIds.length,
      commentCount: commentIds.length,
      analysisCount,
      evidenceFrameCount: scalar(`SELECT COUNT(*) AS count FROM evidence_frames WHERE ${workWhere}`, workIds),
      savedCount: scalar(`SELECT COUNT(*) AS count FROM inbox_states WHERE ${workWhere} AND state='saved'`, workIds),
      laterCount: scalar(`SELECT COUNT(*) AS count FROM inbox_states WHERE ${workWhere} AND state='later'`, workIds),
      starredCreatorCount: creators.filter((row) => Boolean(row.is_starred)).length,
      notedCreatorCount: creators.filter((row) => row.user_note.trim().length > 0).length,
      relatedJobCount: relatedJobs.length,
      relatedBatchCount: relatedBatches.length,
      blockingOperationCount: relatedJobs.filter((job) => ['running', 'blocked_user_action'].includes(job.state)).length
        + relatedBatches.filter((batch) => batch.state === 'running').length
    }
    return {
      summary,
      creatorIds,
      workIds,
      commentIds,
      creatorPublicIds,
      workPublicIds,
      jobIds: relatedJobs.map((job) => Number(job.id)),
      batchIds: relatedBatches.map((batch) => Number(batch.id))
    }
  }

  private indexCreator(creatorId: number): void {
    const row = this.db.prepare(`SELECT c.nickname, c.signature, c.user_note, COALESCE((SELECT group_concat(t.label, ' ') FROM creator_tags ct JOIN taxonomy_tags t ON t.id=ct.tag_id WHERE ct.creator_id=c.id), '') AS tags FROM creators c WHERE c.id=?`).get(creatorId) as Record<string, unknown> | undefined
    if (!row) return
    this.replaceSearch('creator', creatorId, `${row.nickname} ${row.signature} ${row.user_note} ${row.tags}`)
  }

  private indexWork(workId: number): void {
    const row = this.db.prepare(`SELECT w.title, w.description, c.nickname AS creator,
      COALESCE(a.summary,'') AS summary, COALESCE(a.core_expression,'') AS core,
      COALESCE((SELECT group_concat(keyword, ' ') FROM work_keywords WHERE work_id=w.id),'') AS keywords,
      COALESCE((SELECT group_concat(t.label, ' ') FROM work_tags wt JOIN taxonomy_tags t ON t.id=wt.tag_id WHERE wt.work_id=w.id),'') AS work_domains,
      COALESCE((SELECT group_concat(t.label, ' ') FROM creator_tags ct JOIN taxonomy_tags t ON t.id=ct.tag_id WHERE ct.creator_id=c.id),'') AS creator_domains,
      COALESCE((SELECT group_concat(text, ' ') FROM transcript_segments WHERE work_id=w.id),'') AS transcript,
      COALESCE((SELECT group_concat(text, ' ') FROM ocr_blocks WHERE work_id=w.id),'') AS ocr
      FROM works w JOIN creators c ON c.id=w.creator_id
      LEFT JOIN analyses a ON a.subject_type='work' AND a.subject_id=w.id AND a.prompt_version='work-analysis/v1'
      WHERE w.id=?`).get(workId) as Record<string, unknown> | undefined
    if (!row) return
    this.replaceSearch('work', workId, Object.values(row).join(' '))
  }

  private indexComment(commentId: number): void {
    const row = this.db.prepare('SELECT body FROM comments WHERE id=?').get(commentId) as { body: string } | undefined
    if (row) this.replaceSearch('comment', commentId, row.body)
  }

  private replaceSearch(type: string, id: number, content: string): void {
    this.db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run(type, String(id))
    this.db.prepare('INSERT INTO search_index(entity_type, entity_id, content) VALUES (?, ?, ?)').run(type, String(id), content)
  }

  private ensureDerivedData(): void {
    const marker = this.db.prepare(`SELECT value_json FROM app_settings WHERE key='derived-data-version'`).get() as { value_json: string } | undefined
    if (marker?.value_json === '2') return
    this.transaction(() => {
      const validTags = new Set((this.db.prepare('SELECT id FROM taxonomy_tags').all() as Array<{ id: string }>).map((row) => row.id))
      const insertWorkTag = this.db.prepare(`INSERT OR IGNORE INTO work_tags(work_id, tag_id, source, confidence, evidence_json) VALUES (?, ?, 'ai', ?, ?)`)
      const analyses = this.db.prepare(`SELECT subject_id, raw_json, evidence_json FROM analyses WHERE subject_type='work' AND prompt_version='work-analysis/v1'`).all() as Array<{ subject_id: number; raw_json: string; evidence_json: string }>
      for (const row of analyses) {
        try {
          const raw = JSON.parse(row.raw_json) as { domains?: Array<{ id?: unknown; confidence?: unknown }> }
          for (const domain of raw.domains || []) {
            const tagId = typeof domain.id === 'string' ? domain.id : ''
            if (!validTags.has(tagId)) continue
            const confidence = typeof domain.confidence === 'number' ? domain.confidence : null
            insertWorkTag.run(row.subject_id, tagId, confidence, row.evidence_json)
          }
        } catch {
          // Historical raw analysis can be malformed; keep the rest of the local library usable.
        }
      }

      this.db.exec('DELETE FROM search_index')
      for (const { id } of this.db.prepare('SELECT id FROM creators').all() as Array<{ id: number }>) this.indexCreator(id)
      for (const { id } of this.db.prepare('SELECT id FROM works').all() as Array<{ id: number }>) this.indexWork(id)
      for (const { id } of this.db.prepare('SELECT id FROM comments').all() as Array<{ id: number }>) this.indexComment(id)
      this.db.prepare(`INSERT INTO app_settings(key, value_json, updated_at) VALUES ('derived-data-version','2',?) ON CONFLICT(key) DO UPDATE SET value_json='2', updated_at=excluded.updated_at`).run(nowIso())
    })
  }
}
