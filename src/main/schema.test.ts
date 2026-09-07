import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_MIGRATIONS, migrateDatabase } from './schema'

let database: DatabaseSync | null = null

afterEach(() => {
  database?.close()
  database = null
})

function createPreR6Database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const preR6Migrations = DATABASE_MIGRATIONS.slice(0, -1)
  for (let index = 0; index < preR6Migrations.length; index += 1) {
    db.exec('BEGIN IMMEDIATE')
    db.exec(preR6Migrations[index])
    db.exec('PRAGMA user_version = ' + (index + 1))
    db.exec('COMMIT')
  }
  return db
}

describe('R6 database migration', () => {
  it('preserves legacy comments, checkpoints, and all eight historical job states', () => {
    database = createPreR6Database()
    const db = database
    const observedAt = '2026-09-06T06:00:00.000Z'

    db.prepare(`
      INSERT INTO creators(
        id, platform, platform_creator_id, nickname, profile_url,
        discovered_at, updated_at, is_demo
      ) VALUES (1, 'douyin', 'legacy-creator', '旧博主', 'https://www.douyin.com/user/legacy-creator', ?, ?, 0)
    `).run(observedAt, observedAt)
    db.prepare(`
      INSERT INTO works(
        id, platform, platform_work_id, creator_id, work_type, source_url,
        discovered_at, last_collected_at, is_demo
      ) VALUES (1, 'douyin', 'legacy-work', 1, 'video', 'https://www.douyin.com/video/legacy-work', ?, ?, 0)
    `).run(observedAt, observedAt)
    db.prepare(`
      INSERT INTO comments(
        id, platform, platform_comment_id, platform_comment_id_kind, work_id,
        public_author_name, anonymous_author_id, body, normalized_hash,
        collected_at, source_verified, source_proof_json
      ) VALUES (1, 'douyin', 'legacy-root', 'page-attribute', 1,
        '旧评论者', '匿名-old', '旧评论', 'legacy-hash', ?, 1, '{"contract":"legacy"}')
    `).run(observedAt)
    db.prepare(`
      INSERT INTO comments(
        id, platform, platform_comment_id, platform_comment_id_kind, work_id,
        parent_comment_id, public_author_name, anonymous_author_id, body,
        normalized_hash, collected_at, source_verified, source_proof_json
      ) VALUES (2, 'douyin', 'legacy-reply', 'synthetic-content-hash', 1,
        1, '旧回复者', '匿名-reply', '旧回复', 'legacy-reply-hash', ?, 0, '{}')
    `).run(observedAt)

    const historicalIds = [7, 8, 10, 11, 12, 13, 14, 16]
    const states = ['blocked_user_action', 'paused', 'retryable_failed', 'completed', 'queued', 'running', 'permanent_failed', 'pending_cloud']
    for (let index = 0; index < historicalIds.length; index += 1) {
      db.prepare(`
        INSERT INTO jobs(
          id, kind, state, priority, payload_json, checkpoint_json,
          status_message, created_at, updated_at
        ) VALUES (?, 'collection.work_comments', ?, 100, ?, '{}', ?, ?, ?)
      `).run(
        historicalIds[index],
        states[index],
        JSON.stringify({ historicalId: historicalIds[index] }),
        'historical-state-' + historicalIds[index],
        observedAt,
        observedAt
      )
    }
    db.prepare(`
      INSERT INTO collection_checkpoints(
        scope_type, scope_id, cursor, has_more, completeness, reason, updated_at
      ) VALUES ('work', 'legacy-work', '40', 1, 'partial', 'legacy checkpoint', ?)
    `).run(observedAt)

    const jobsBefore = db.prepare(`
      SELECT id, state, payload_json, checkpoint_json, status_message
      FROM jobs ORDER BY id
    `).all()

    migrateDatabase(db)

    expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DATABASE_MIGRATIONS.length)
    expect(db.prepare(`
      SELECT id, platform_comment_id, platform_comment_id_kind, parent_comment_id,
        root_comment_id, reply_count, endpoint_kind, source_verified, source_proof_json
      FROM comments ORDER BY id
    `).all()).toEqual([
      {
        id: 1, platform_comment_id: 'legacy-root', platform_comment_id_kind: 'page-attribute',
        parent_comment_id: null, root_comment_id: null, reply_count: null,
        endpoint_kind: null, source_verified: 1, source_proof_json: '{"contract":"legacy"}'
      },
      {
        id: 2, platform_comment_id: 'legacy-reply', platform_comment_id_kind: 'synthetic-content-hash',
        parent_comment_id: 1, root_comment_id: null, reply_count: null,
        endpoint_kind: null, source_verified: 0, source_proof_json: '{}'
      }
    ])
    expect(db.prepare(`
      SELECT id, state, payload_json, checkpoint_json, status_message
      FROM jobs ORDER BY id
    `).all()).toEqual(jobsBefore)
    expect(db.prepare(`
      SELECT scope_type, scope_id, scope_fingerprint, job_id, cursor,
        has_more, completeness, reason, updated_at
      FROM collection_checkpoints
    `).get()).toEqual({
      scope_type: 'work',
      scope_id: 'legacy-work',
      scope_fingerprint: 'legacy-unversioned',
      job_id: null,
      cursor: '40',
      has_more: 1,
      completeness: 'partial',
      reason: 'legacy checkpoint',
      updated_at: observedAt
    })
    expect(db.prepare('SELECT adapter_name, adapter_version, scope_fingerprint FROM jobs WHERE id=7').get()).toEqual({
      adapter_name: null,
      adapter_version: null,
      scope_fingerprint: null
    })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('accepts native cid after migration while legacy ID kinds remain readable', () => {
    database = createPreR6Database()
    migrateDatabase(database)

    const observedAt = '2026-09-06T06:00:00.000Z'
    database.prepare(`
      INSERT INTO creators(
        id, platform, platform_creator_id, nickname, profile_url,
        discovered_at, updated_at, is_demo
      ) VALUES (1, 'douyin', 'r6-creator', 'R6 博主', 'https://www.douyin.com/user/r6-creator', ?, ?, 0)
    `).run(observedAt, observedAt)
    database.prepare(`
      INSERT INTO works(
        id, platform, platform_work_id, creator_id, work_type, source_url,
        discovered_at, last_collected_at, is_demo
      ) VALUES (1, 'douyin', 'r6-work', 1, 'video', 'https://www.douyin.com/video/r6-work', ?, ?, 0)
    `).run(observedAt, observedAt)

    const kinds = ['native-cid', 'page-attribute', 'synthetic-content-hash', 'legacy-unknown']
    const insert = database.prepare(`
      INSERT INTO comments(
        platform, platform_comment_id, platform_comment_id_kind, work_id,
        public_author_name, anonymous_author_id, body, normalized_hash,
        collected_at, source_verified, source_proof_json
      ) VALUES ('douyin', ?, ?, 1, '合成作者', 'anonymous', '合成正文', 'hash', ?, 0, '{}')
    `)
    kinds.forEach((kind, index) => insert.run('comment-' + index, kind, observedAt))
    expect(database.prepare('SELECT platform_comment_id_kind FROM comments ORDER BY id').all()).toEqual(
      kinds.map((platform_comment_id_kind) => ({ platform_comment_id_kind }))
    )

    expect(() => database!.prepare(`
      INSERT INTO comments(
        platform, platform_comment_id, platform_comment_id_kind, work_id,
        public_author_name, anonymous_author_id, body, normalized_hash,
        collected_at, source_verified, source_proof_json
      ) VALUES ('douyin', 'invalid', 'invented-kind', 1, '', 'anonymous', 'x', 'x', ?, 0, '{}')
    `).run(observedAt)).toThrow(/CHECK constraint failed/)
  })
})
