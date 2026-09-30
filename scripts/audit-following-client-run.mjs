import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync, backup } from 'node:sqlite'
import { join, resolve } from 'node:path'

const profile = resolve(process.argv[2] || join(process.env.LOCALAPPDATA, 'SignalDeskFollowingReview'))
const output = resolve(process.argv[3] || 'docs/evidence/following-client-20260930')
mkdirSync(output, { recursive: true })
const directory = new DatabaseSync(join(profile, 'following-directory.sqlite'), { readOnly: true })
const app = new DatabaseSync(join(profile, 'signal-desk.sqlite'), { readOnly: true })
try {
  const run = directory.prepare('SELECT * FROM directory_runs ORDER BY rowid DESC LIMIT 1').get()
  if (!run) throw new Error('No real following report has reached the local database')
  const reportPath = join(profile, 'following-runs', run.run_id, 'following-report.json')
  if (!existsSync(reportPath)) throw new Error('Original browser report is missing')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  if (run.report_json !== JSON.stringify(report)) throw new Error('Archived report differs from persisted report')
  const creators = directory.prepare(`SELECT uid,sec_uid AS secUid,nickname,avatar_url AS avatarUrl,
    signature,profile_url AS profileUrl FROM directory_creators WHERE owner_sec_uid=? AND last_run_id=? ORDER BY position`).all(run.owner_sec_uid,run.run_id)
  if (JSON.stringify(creators) !== JSON.stringify(report.creators)) throw new Error('Stored creator order or fields differ from the browser projection')
  if (creators.length !== 10 || report.creators.length !== 10) throw new Error('This run did not save the requested ten authors')
  if (createHash('sha256').update(JSON.stringify(report.creators)).digest('hex') !== report.projectionSha256) throw new Error('Projection hash mismatch')
  if (report.workResponseBodiesRead !== 0 || report.activeApiRequests !== 0) throw new Error('Following-only browser boundary was exceeded')
  const counts = Object.fromEntries(['works','metric_snapshots','comments','jobs','analyses'].map((table) => [table, app.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))
  const baselinePath = join(output, 'database-before.json')
  if (!existsSync(baselinePath)) throw new Error('Before snapshot is required to assess side effects')
  const baseline = JSON.parse(readFileSync(baselinePath,'utf8'))
  if (baseline.databasePath.replaceAll('\\','/') !== join(profile, 'signal-desk.sqlite').replaceAll('\\','/')) throw new Error('Baseline belongs to another database')
  if (JSON.stringify(counts) !== JSON.stringify(baseline.counts)) throw new Error('Work/comment/task tables changed during the directory run')
  const checks = {
    runId: report.runId, capturedAt: new Date().toISOString(), ownerSecUid: report.ownerSecUid,
    count: creators.length, avatarUrlCount: creators.filter((creator) => creator.avatarUrl).length,
    firstPage: report.firstPage, activeFollowingTab: report.activeFollowingTab,
    profileBindingsMatch: creators.every((creator) => creator.profileUrl === `https://www.douyin.com/user/${encodeURIComponent(creator.secUid)}`),
    storedOrderMatchesReport: true, boundaryCountsBefore: baseline.counts, boundaryCountsAfter: counts,
    directoryIntegrity: directory.prepare('PRAGMA integrity_check').get().integrity_check,
    appIntegrity: app.prepare('PRAGMA integrity_check').get().integrity_check,
    directoryForeignKeyViolations: directory.prepare('PRAGMA foreign_key_check').all().length,
    appForeignKeyViolations: app.prepare('PRAGMA foreign_key_check').all().length,
    projectionSha256: report.projectionSha256, activeApiRequests: report.activeApiRequests,
    workResponseBodiesRead: report.workResponseBodiesRead, scopeStatus: run.status
  }
  if (checks.directoryIntegrity !== 'ok' || checks.appIntegrity !== 'ok'
    || checks.directoryForeignKeyViolations || checks.appForeignKeyViolations || !checks.profileBindingsMatch) throw new Error('Database integrity or identity verification failed')
  writeFileSync(join(output, 'following-report.json'), JSON.stringify(report,null,2))
  writeFileSync(join(output, 'audit.json'), JSON.stringify(checks,null,2))
  await backup(directory, join(output, 'following-directory.sqlite'))
  const files = ['following-report.json','audit.json','following-directory.sqlite']
  writeFileSync(join(output,'checksums.json'), JSON.stringify(Object.fromEntries(files.map((file)=>[file,createHash('sha256').update(readFileSync(join(output,file))).digest('hex')])),null,2))
  console.log(JSON.stringify(checks,null,2))
} finally { directory.close(); app.close() }
