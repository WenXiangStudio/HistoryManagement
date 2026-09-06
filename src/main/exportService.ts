import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from './database'

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function writeCsv(path: string, headers: string[], rows: unknown[][]): void {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  writeFileSync(path, `\uFEFF${body}`, 'utf8')
}

export class ExportService {
  constructor(private readonly database: AppDatabase) {}

  exportAll(destination: string, anonymize = true): { files: string[]; exportedAt: string } {
    mkdirSync(destination, { recursive: true })
    const exportedAt = new Date().toISOString()
    const creators = this.database.getCreators()
    const works = this.database.db.prepare(`SELECT w.*, c.nickname AS creator_name FROM works w JOIN creators c ON c.id=w.creator_id ORDER BY w.published_at DESC`).all() as Array<Record<string, unknown>>
    const metrics = this.database.db.prepare(`SELECT m.*, w.platform_work_id FROM metric_snapshots m JOIN works w ON w.id=m.work_id ORDER BY m.collected_at`).all() as Array<Record<string, unknown>>
    const comments = this.database.db.prepare(`SELECT c.*, w.platform_work_id FROM comments c JOIN works w ON w.id=c.work_id ORDER BY c.work_id, c.published_at`).all() as Array<Record<string, unknown>>

    const creatorPath = join(destination, 'creators.csv')
    writeCsv(creatorPath, ['平台博主ID', '昵称', '简介', '主页', '仍在关注', '标星', '领域', '批注', '作品数'], creators.map((row) => [row.platformCreatorId, row.nickname, row.signature, row.profileUrl, row.isFollowing, row.isStarred, row.domains, row.note, row.workCount]))
    const workPath = join(destination, 'works.csv')
    writeCsv(workPath, ['平台作品ID', '博主', '类型', '标题', '简介', '发布时间', '来源', '采集状态', '分析状态'], works.map((row) => [row.platform_work_id, row.creator_name, row.work_type, row.title, row.description, row.published_at, row.source_url, row.collection_status, row.analysis_status]))
    const metricPath = join(destination, 'metric_snapshots.csv')
    writeCsv(metricPath, ['平台作品ID', '采集时间', '点赞', '评论', '收藏', '分享', '可见性'], metrics.map((row) => [row.platform_work_id, row.collected_at, row.like_count, row.comment_count, row.collect_count, row.share_count, row.visibility_json]))
    const commentPath = join(destination, 'comments.csv')
    writeCsv(commentPath, ['平台作品ID', '评论ID', 'ID来源', '作者', '正文', '点赞', '发布时间', '采集时间', '来源已验证', '云端状态'], comments.map((row) => [row.platform_work_id, row.platform_comment_id, row.platform_comment_id_kind, anonymize ? row.anonymous_author_id : row.public_author_name, row.body, row.like_count, row.published_at, row.collected_at, row.source_verified, row.cloud_state]))

    const reportPath = join(destination, 'library-report.md')
    const report = [
      '# Signal Desk 资料库报告',
      '',
      `- 导出时间：${exportedAt}`,
      `- 博主数量：${creators.length}`,
      `- 作品数量：${works.length}`,
      `- 评论数量：${comments.length}`,
      `- 评论作者：${anonymize ? '已匿名化' : '保留公开昵称'}`,
      '',
      '## 博主概览',
      '',
      ...creators.map((creator) => `- **${creator.nickname}** · ${creator.domains.join(' / ') || '待分类'} · ${creator.workCount} 个作品${creator.note ? ` · 批注：${creator.note}` : ''}`),
      '',
      '> 本报告仅包含公开页面可见信息及本地派生分析，不代表创作者后台真实曝光、播放或转化数据。'
    ].join('\n')
    writeFileSync(reportPath, report, 'utf8')
    const files = [creatorPath, workPath, metricPath, commentPath, reportPath]
    writeFileSync(join(destination, 'export-manifest.json'), JSON.stringify({ contract: 'export-manifest/v1', exportedAt, anonymized: anonymize, files: files.map((path) => path.split(/[\\/]/).pop()) }, null, 2), 'utf8')
    return { files, exportedAt }
  }
}
