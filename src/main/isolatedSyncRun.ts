import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { AppDatabase } from './database'
import { VerifiedFollowingDirectory, type VerifiedAuthor } from './verifiedFollowingDirectory'
import { applyFollowingSchemaV6Draft } from '../../poc/r8/following-schema-v6-draft.mjs'
import { homepagePilotReportSchema } from '../shared/homepagePilotReport'

/** One temporary v6 run. No reference to the production database is accepted. */
export class IsolatedSyncRun {
  readonly database: AppDatabase
  readonly directory: VerifiedFollowingDirectory
  private readonly ownerId: number
  readonly worksJobId: number
  private accepted = false

  constructor(path: string, private readonly runId: string, ownerSecUid: string,
    private readonly author: Omit<VerifiedAuthor, 'followingVerifiedAt'>) {
    if (path !== ':memory:') {
      const checked = relative(resolve(tmpdir()), resolve(path))
      if (!checked || checked.startsWith('..') || isAbsolute(checked) || existsSync(path)) {
        throw new Error('隔离同步只允许创建系统临时目录中的新数据库')
      }
    }
    this.database = new AppDatabase(path)
    applyFollowingSchemaV6Draft(this.database.db)
    this.directory = new VerifiedFollowingDirectory(this.database.db)
    this.ownerId = Number(this.database.db.prepare("SELECT id FROM owner_accounts WHERE local_label='我的抖音'").get()!.id)
    const at = new Date().toISOString()
    this.directory.bindOwner(this.ownerId, ownerSecUid, at)
    this.directory.upsertFollowing(this.ownerId, { ...author, isFollowing: true }, at)
    if (author.followingState === 'stale') this.directory.finishRefresh(this.ownerId, runId, [], { complete: false })
    const worksTask = this.directory.planCreatorWorksSync(this.ownerId, 1)[0]
    this.worksJobId = this.enqueue(worksTask.kind, ownerSecUid, author.uid, author.secUid, 10)
    this.database.updateJob(this.worksJobId, 'running', { message: '等待单作者单作品隔离报告' })
    this.database.db.exec(`CREATE TABLE isolated_pilot_sources (
      work_id INTEGER PRIMARY KEY REFERENCES works(id),run_id TEXT NOT NULL,
      owner_sec_uid TEXT NOT NULL,creator_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,
      proof_json TEXT NOT NULL
    ) STRICT`)
  }

  private enqueue(kind: 'creator.works.sync', ownerSecUid: string, uid: string, secUid: string, priority: number): number {
    const fingerprint = 'scope-v1:' + createHash('sha256').update(JSON.stringify({
      runId: this.runId, ownerSecUid, uid, secUid, kind, route: 'passive-homepage/v1', workLimit: 1
    })).digest('hex')
    return this.database.enqueueCollectionJob('collection.creator_works', {
      ownerSecUid, creatorUid: uid, creatorSecUid: secUid, runId: this.runId,
      worksPerCreator: 1, comments: 'on-demand', collectionOnly: true
    }, { adapterName: 'douyin.homepage-passive',
      adapterVersion: '0.2.0-r8-passive', scopeFingerprint: fingerprint }, priority).jobId
  }

  acceptReport(input: unknown): void {
    if (this.accepted) return
    const report = homepagePilotReportSchema.parse(input)
    if (report.runId !== this.runId || report.result.creator.uid !== this.author.uid
      || report.result.creator.secUid !== this.author.secUid) throw new Error('隔离报告不属于本次作者任务')
    const result = report.result
    if (result.status === 'verified' && result.verifiedWork) {
      const work = result.verifiedWork
      const candidate = result.candidates.find((item) => item.workId === work.workId)!
      const job = this.database.db.prepare('SELECT scope_fingerprint FROM jobs WHERE id=?').get(this.worksJobId) as { scope_fingerprint: string }
      const metrics = work.statistics
      this.database.ingestEnvelope({
        contract: 'browser-collection-envelope/v1', commandId: this.runId, platform: 'douyin',
        collectedAt: report.finishedAt, sourceUrl: result.creator.profileUrl,
        completeness: 'partial', hasMore: true, reason: '单作品范围已完成，作者作品列表未全量采集',
        items: [{ entityType: 'work', workId: work.workId, creatorId: work.authorId,
          workType: work.workType, sourceUrl: candidate.url, title: work.title,
          description: work.description, discoveredAt: report.finishedAt, publishedAt: work.publishedAt,
          metrics: { likeCount: metrics.likeCount, commentCount: metrics.commentCount,
            collectCount: metrics.collectCount, shareCount: metrics.shareCount,
            visibility: { like: metrics.likeCount === null ? 'unknown' : 'visible',
              comment: metrics.commentCount === null ? 'unknown' : 'visible',
              collect: metrics.collectCount === null ? 'unknown' : 'visible',
              share: metrics.shareCount === null ? 'unknown' : 'visible' } } }]
      }, { scopeType: 'work', scopeId: this.author.uid, scopeFingerprint: job.scope_fingerprint, jobId: this.worksJobId }, () => {
        const workDbId = Number(this.database.db.prepare('SELECT id FROM works WHERE platform_work_id=?').get(work.workId)!.id)
        this.database.db.prepare(`INSERT INTO isolated_pilot_sources(work_id,run_id,owner_sec_uid,
        creator_uid,creator_sec_uid,proof_json) VALUES(?,?,?,?,?,?)`).run(workDbId, this.runId,
        String(this.database.db.prepare('SELECT platform_sec_uid FROM owner_accounts WHERE id=?').get(this.ownerId)!.platform_sec_uid),
        this.author.uid, this.author.secUid, JSON.stringify({ workProof: result.workProof, detailProof: result.detailProof }))
        this.database.db.prepare(`INSERT INTO verified_collection_checkpoints(owner_account_id,target_kind,
        native_id,sec_uid,adapter_version,status,updated_at) VALUES(?,'creator-works',?,?,'0.2.0-r8-passive','scope-limited',?)`).run(
        this.ownerId, this.author.uid, this.author.secUid, report.finishedAt)
        this.database.updateJob(this.worksJobId, 'completed', { progress: 1,
        message: '已验证并保存 1 个作品；评论未请求', checkpoint: { completeness: 'scope-limited', workId: work.workId } })
      })
    } else {
      this.database.updateJob(this.worksJobId, 'blocked_user_action', {
        message: result.status === 'candidate-only' ? '仅有候选，未保存为作品' : '单作品采集被阻断',
        error: result.reason, checkpoint: { completeness: result.status, candidateCount: result.candidates.length }
      })
    }
    this.accepted = true
  }

  jobs(): Array<{ kind: string; state: string; message: string }> {
    return this.database.getJobs().map((job) => ({ kind: String(job.kind), state: String(job.state), message: String(job.status_message) }))
  }

  close(): void { this.database.close() }
}
