import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_MIGRATIONS } from './schema'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createPreR6ProductionFixture(databasePath: string): void {
  const db = new DatabaseSync(databasePath)
  try {
    DATABASE_MIGRATIONS.slice(0, -1).forEach((migration, index) => {
      db.exec('BEGIN IMMEDIATE')
      db.exec(migration)
      db.exec(`PRAGMA user_version = ${index + 1}`)
      db.exec('COMMIT')
    })
    const observedAt = '2026-09-07T12:00:00.000Z'
    db.prepare(`
      INSERT INTO creators(
        id, platform, platform_creator_id, nickname, profile_url,
        discovered_at, updated_at, is_demo, user_note, is_starred
      ) VALUES (1, 'douyin', 'production-fixture-creator', '正式库夹具',
        'https://www.douyin.com/user/production-fixture-creator', ?, ?, 0, '保留批注', 1)
    `).run(observedAt, observedAt)
    db.prepare(`
      INSERT INTO works(
        id, platform, platform_work_id, creator_id, work_type, source_url,
        discovered_at, last_collected_at, is_demo
      ) VALUES (1, 'douyin', 'production-fixture-work', 1, 'video',
        'https://www.douyin.com/video/production-fixture-work', ?, ?, 0)
    `).run(observedAt, observedAt)
    db.prepare(`
      INSERT INTO comments(
        id, platform, platform_comment_id, platform_comment_id_kind, work_id,
        public_author_name, anonymous_author_id, body, normalized_hash,
        collected_at, source_verified, source_proof_json
      ) VALUES (1, 'douyin', 'legacy-comment', 'page-attribute', 1,
        '评论者', '匿名-fixture', '必须无损保留', 'fixture-hash', ?, 1, '{"contract":"legacy"}')
    `).run(observedAt)
    db.prepare(`
      INSERT INTO jobs(
        id, kind, state, payload_json, checkpoint_json, status_message, created_at, updated_at
      ) VALUES (7, 'collection.work_comments', 'blocked_user_action',
        '{"historicalId":7}', '{"cursor":"40"}', '必须原样保留', ?, ?)
    `).run(observedAt, observedAt)
    db.prepare(`
      INSERT INTO collection_checkpoints(
        scope_type, scope_id, cursor, has_more, completeness, reason, updated_at
      ) VALUES ('work', 'production-fixture-work', '40', 1, 'partial', '必须原样保留', ?)
    `).run(observedAt)
  } finally {
    db.close()
  }
}

describe('production database backup and migration audit', () => {
  it('fails closed for the installed Native Host process name outside isolated fixtures', () => {
    const script = readFileSync(resolve('scripts/backup-and-migrate-production.ps1'), 'utf8')
    expect(script).toContain("'SignalDesk.NativeHost'")
  })

  it('backs up the complete data directory, migrates only the database, and verifies preserved rows', () => {
    const fakeAppData = mkdtempSync(join(tmpdir(), 'signal-desk-production-migration-'))
    temporaryDirectories.push(fakeAppData)
    const productionRoot = join(fakeAppData, 'Signal Desk')
    const databasePath = join(productionRoot, 'signal-desk.sqlite')
    const shmPath = join(productionRoot, 'signal-desk.sqlite-shm')
    const markerPath = join(productionRoot, 'Cache', 'keep-me.txt')
    // mkdirSync is imported above for ESM compatibility.
    mkdirSync(resolve(markerPath, '..'), { recursive: true })
    writeFileSync(markerPath, 'full-directory-backup-marker\n', 'utf8')
    createPreR6ProductionFixture(databasePath)
    writeFileSync(shmPath, Buffer.alloc(32_768, 0x11))

    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/backup-and-migrate-production.ps1'),
        '-IsolatedTestAppData',
        fakeAppData,
        '-IsolatedTestMutateShmAfterPreflight'
      ],
      {
        cwd: resolve('.'),
        env: { ...process.env, APPDATA: fakeAppData },
        encoding: 'utf8'
      }
    )
    expect(JSON.parse(output).result).toBe('PASS')

    const auditParent = join(fakeAppData, 'Signal Desk Backups')
    const auditDirectories = readdirSync(auditParent)
    expect(auditDirectories).toHaveLength(1)
    const auditRoot = join(auditParent, auditDirectories[0])
    expect(readFileSync(join(auditRoot, 'data', 'Cache', 'keep-me.txt'), 'utf8')).toBe(
      'full-directory-backup-marker\n'
    )

    expect(readFileSync(join(auditRoot, 'data', 'signal-desk.sqlite-shm'))[0]).toBe(0x11)
    expect(readFileSync(shmPath)[0]).toBe(0xee)
    const preflight = JSON.parse(readFileSync(join(auditRoot, '01-preflight.json'), 'utf8'))
    const migration = JSON.parse(readFileSync(join(auditRoot, '02-migration.json'), 'utf8'))
    const raceCheck = JSON.parse(readFileSync(join(auditRoot, '01b-pre-migration-race-check.json'), 'utf8'))
    const postflight = JSON.parse(readFileSync(join(auditRoot, '03-postflight.json'), 'utf8'))
    expect(preflight.snapshot.userVersion).toBe(DATABASE_MIGRATIONS.length - 1)
    expect(migration.migrationApplied).toBe(true)
    expect(raceCheck).toMatchObject({
      verified: true,
      volatileExceptions: [{ path: 'signal-desk.sqlite-shm' }]
    })
    expect(raceCheck.baselineFullManifestSha256).not.toBe(raceCheck.preMigrationFullManifestSha256)
    expect(raceCheck.baselineComparisonSha256).toBe(raceCheck.preMigrationComparisonSha256)

    expect(postflight.verified).toBe(true)
    expect(postflight.snapshot.userVersion).toBe(DATABASE_MIGRATIONS.length)

    const db = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(db.prepare('SELECT user_note, is_starred FROM creators WHERE id=1').get()).toEqual({
        user_note: '保留批注',
        is_starred: 1
      })
      expect(db.prepare('SELECT body, platform_comment_id_kind, root_comment_id FROM comments WHERE id=1').get()).toEqual({
        body: '必须无损保留',
        platform_comment_id_kind: 'page-attribute',
        root_comment_id: null
      })
      expect(db.prepare('SELECT state, payload_json, checkpoint_json, status_message FROM jobs WHERE id=7').get()).toEqual({
        state: 'blocked_user_action',
        payload_json: '{"historicalId":7}',
        checkpoint_json: '{"cursor":"40"}',
        status_message: '必须原样保留'
      })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      db.close()
    }
    const idempotentOutput = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/backup-and-migrate-production.ps1'),
        '-IsolatedTestAppData',
        fakeAppData
      ],
      {
        cwd: resolve('.'),
        env: { ...process.env, APPDATA: fakeAppData },
        encoding: 'utf8'
      }
    )
    expect(JSON.parse(idempotentOutput).result).toBe('PASS')

    const auditDirectoriesAfterIdempotentRun = readdirSync(auditParent)
    expect(auditDirectoriesAfterIdempotentRun).toHaveLength(2)
    const idempotentAuditName = auditDirectoriesAfterIdempotentRun.find(
      (name) => name !== auditDirectories[0]
    )
    expect(idempotentAuditName).toBeDefined()
    const idempotentAuditRoot = join(auditParent, idempotentAuditName!)
    const idempotentPreflight = JSON.parse(readFileSync(join(idempotentAuditRoot, '01-preflight.json'), 'utf8'))
    const idempotentMigration = JSON.parse(readFileSync(join(idempotentAuditRoot, '02-migration.json'), 'utf8'))
    expect(idempotentPreflight.snapshot.userVersion).toBe(DATABASE_MIGRATIONS.length)
    expect(idempotentMigration.migrationApplied).toBe(false)
  }, 30_000)
})
