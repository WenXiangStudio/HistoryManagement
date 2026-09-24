import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATABASE_MIGRATIONS } from '../src/main/schema'

type SqlValue = string | number | bigint | null | Uint8Array
type SqlRow = Record<string, SqlValue>

type TableSnapshot = {
  columns: string[]
  rowCount: number
  contentSha256: string
}

type DatabaseSnapshot = {
  capturedAt: string
  databasePath: string
  userVersion: number
  targetVersion: number
  quickCheck: string[]
  foreignKeyViolations: SqlRow[]
  tables: Record<string, TableSnapshot>
}

type PreflightReport = {
  contract: 'signal-desk-production-migration-audit/v1'
  phase: 'preflight'
  safeToMigrate: boolean
  migrationRequired: boolean
  snapshot: DatabaseSnapshot
}

const [, , mode, rawDatabasePath, rawReportPath, rawPreflightPath] = process.argv

if (!['preflight', 'migrate', 'postflight'].includes(mode) || !rawDatabasePath || !rawReportPath) {
  throw new Error(
    'Usage: vite-node scripts/production-db-migration-audit.ts <preflight|migrate|postflight> <database> <report> [preflight-report]'
  )
}

const databasePath = resolve(rawDatabasePath)
const reportPath = resolve(rawReportPath)
const targetVersion = DATABASE_MIGRATIONS.length

function applyPendingMigrations(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (let index = current; index < DATABASE_MIGRATIONS.length; index += 1) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(DATABASE_MIGRATIONS[index])
      db.exec(`PRAGMA user_version = ${index + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}


function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function canonicalValue(value: SqlValue): [string, string?] {
  if (value === null) return ['null']
  if (typeof value === 'string') return ['text', value]
  if (typeof value === 'bigint') return ['integer', value.toString()]
  if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('base64')]
  if (Number.isNaN(value)) return ['real', 'NaN']
  if (value === Number.POSITIVE_INFINITY) return ['real', '+Infinity']
  if (value === Number.NEGATIVE_INFINITY) return ['real', '-Infinity']
  if (Object.is(value, -0)) return ['real', '-0']
  return ['real', value.toString()]
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(
    ({ name }) => name
  )
}

function digestTable(db: DatabaseSync, table: string, columns: string[]): TableSnapshot {
  if (columns.length === 0) return { columns, rowCount: 0, contentSha256: createHash('sha256').digest('hex') }
  const projection = columns.map(quoteIdentifier).join(', ')
  const statement = db.prepare(`SELECT ${projection} FROM ${quoteIdentifier(table)}`)
  statement.setReadBigInts(true)
  const rows = statement.all() as SqlRow[]
  const canonicalRows = rows
    .map((row) => JSON.stringify(columns.map((column) => canonicalValue(row[column]))))
    .sort()
  const hash = createHash('sha256')
  for (const row of canonicalRows) hash.update(row).update('\n')
  return { columns, rowCount: rows.length, contentSha256: hash.digest('hex') }
}

function captureSnapshot(db: DatabaseSync, expectedTables?: Record<string, TableSnapshot>): DatabaseSnapshot {
  const quickCheck = (db.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>).map(
    (row) => row.quick_check
  )
  const foreignKeyStatement = db.prepare('PRAGMA foreign_key_check')
  foreignKeyStatement.setReadBigInts(true)
  const foreignKeyViolations = foreignKeyStatement.all() as SqlRow[]
  const discoveredTables = (db
    .prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>).map(({ name }) => name)
  const tableNames = expectedTables ? Object.keys(expectedTables).sort() : discoveredTables
  const discoveredSet = new Set(discoveredTables)
  const tables: Record<string, TableSnapshot> = {}

  for (const table of tableNames) {
    if (!discoveredSet.has(table)) throw new Error(`Expected table is missing after migration: ${table}`)
    const columns = expectedTables?.[table]?.columns ?? tableColumns(db, table)
    const currentColumns = new Set(tableColumns(db, table))
    const missingColumns = columns.filter((column) => !currentColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(`Table ${table} lost columns: ${missingColumns.join(', ')}`)
    }
    tables[table] = digestTable(db, table, columns)
  }

  return {
    capturedAt: new Date().toISOString(),
    databasePath,
    userVersion: Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version),
    targetVersion,
    quickCheck,
    foreignKeyViolations,
    tables
  }
}

function assertHealthy(snapshot: DatabaseSnapshot): void {
  if (snapshot.quickCheck.length !== 1 || snapshot.quickCheck[0] !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${JSON.stringify(snapshot.quickCheck)}`)
  }
  if (snapshot.foreignKeyViolations.length > 0) {
    throw new Error(`SQLite foreign_key_check failed with ${snapshot.foreignKeyViolations.length} violation(s)`)
  }
}

function assertSupportedVersion(version: number): void {
  if (version !== targetVersion - 1 && version !== targetVersion) {
    throw new Error(
      `Production database user_version=${version}; expected ${targetVersion - 1} for R6 migration or ${targetVersion} for idempotent verification`
    )
  }
}

function assertPreserved(before: DatabaseSnapshot, after: DatabaseSnapshot): void {
  const differences: string[] = []
  for (const [table, expected] of Object.entries(before.tables)) {
    const actual = after.tables[table]
    if (!actual) {
      differences.push(`${table}: missing`)
      continue
    }
    if (actual.rowCount !== expected.rowCount) {
      differences.push(`${table}: row count ${expected.rowCount} -> ${actual.rowCount}`)
    }
    if (actual.contentSha256 !== expected.contentSha256) {
      differences.push(`${table}: projected content SHA-256 changed`)
    }
  }
  if (differences.length > 0) throw new Error(`Migration changed preserved data: ${differences.join('; ')}`)
}

function writeReport(value: unknown): void {
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

if (mode === 'preflight') {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const snapshot = captureSnapshot(db)
    assertHealthy(snapshot)
    assertSupportedVersion(snapshot.userVersion)
    const report: PreflightReport = {
      contract: 'signal-desk-production-migration-audit/v1',
      phase: 'preflight',
      safeToMigrate: true,
      migrationRequired: snapshot.userVersion === targetVersion - 1,
      snapshot
    }
    writeReport(report)
  } finally {
    db.close()
  }
} else {
  if (!rawPreflightPath) throw new Error(`${mode} requires the preflight report path`)
  const preflight = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(resolve(rawPreflightPath), 'utf8'))) as PreflightReport
  if (preflight.contract !== 'signal-desk-production-migration-audit/v1' || preflight.phase !== 'preflight' || !preflight.safeToMigrate) {
    throw new Error('Invalid or unsafe preflight report')
  }
  if (resolve(preflight.snapshot.databasePath) !== databasePath) throw new Error('Preflight database path does not match')
  if (preflight.snapshot.targetVersion !== targetVersion) {
    throw new Error(
      `Migration target changed after preflight: ${preflight.snapshot.targetVersion} -> ${targetVersion}`
    )
  }
  assertSupportedVersion(preflight.snapshot.userVersion)
  if (preflight.migrationRequired !== (preflight.snapshot.userVersion === targetVersion - 1)) {
    throw new Error('Preflight migrationRequired flag is inconsistent with its database version')
  }

  if (mode === 'migrate') {
    const db = new DatabaseSync(databasePath, { readOnly: !preflight.migrationRequired })
    try {
      const immediatelyBefore = captureSnapshot(db, preflight.snapshot.tables)
      assertHealthy(immediatelyBefore)
      assertSupportedVersion(immediatelyBefore.userVersion)
      assertPreserved(preflight.snapshot, immediatelyBefore)
      if (immediatelyBefore.userVersion !== preflight.snapshot.userVersion) {
        throw new Error('Database user_version changed after preflight')
      }
      if (preflight.migrationRequired) applyPendingMigrations(db)
      const after = captureSnapshot(db, preflight.snapshot.tables)
      assertHealthy(after)
      if (after.userVersion !== targetVersion) {
        throw new Error(`Migration ended at user_version=${after.userVersion}; expected ${targetVersion}`)
      }
      assertPreserved(preflight.snapshot, after)
      writeReport({
        contract: 'signal-desk-production-migration-audit/v1',
        phase: 'migration',
        migrationApplied: preflight.migrationRequired,
        before: immediatelyBefore,
        after
      })
    } finally {
      db.close()
    }
  } else {
    const db = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const snapshot = captureSnapshot(db, preflight.snapshot.tables)
      assertHealthy(snapshot)
      if (snapshot.userVersion !== targetVersion) {
        throw new Error(`Postflight user_version=${snapshot.userVersion}; expected ${targetVersion}`)
      }
      assertPreserved(preflight.snapshot, snapshot)
      writeReport({
        contract: 'signal-desk-production-migration-audit/v1',
        phase: 'postflight',
        verified: true,
        snapshot
      })
    } finally {
      db.close()
    }
  }
}
