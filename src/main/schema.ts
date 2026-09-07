import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_DOMAINS } from '../shared/contracts'

export const DATABASE_MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS owner_accounts (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    local_label TEXT NOT NULL,
    platform_public_id TEXT,
    created_at TEXT NOT NULL,
    last_sync_at TEXT,
    UNIQUE(platform, local_label)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS creators (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_creator_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar_url TEXT,
    signature TEXT NOT NULL DEFAULT '',
    profile_url TEXT NOT NULL,
    is_following INTEGER NOT NULL DEFAULT 1 CHECK (is_following IN (0,1)),
    is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0,1)),
    user_note TEXT NOT NULL DEFAULT '',
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    unfollowed_at TEXT,
    UNIQUE(platform, platform_creator_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_work_id TEXT NOT NULL,
    creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    work_type TEXT NOT NULL CHECK (work_type IN ('video','image')),
    source_url TEXT NOT NULL,
    cover_url TEXT,
    media_url TEXT,
    image_urls_json TEXT NOT NULL DEFAULT '[]',
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    collection_status TEXT NOT NULL DEFAULT 'partial',
    media_status TEXT NOT NULL DEFAULT 'pending',
    analysis_status TEXT NOT NULL DEFAULT 'pending',
    last_collected_at TEXT NOT NULL,
    UNIQUE(platform, platform_work_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    collected_at TEXT NOT NULL,
    like_count INTEGER,
    comment_count INTEGER,
    collect_count INTEGER,
    share_count INTEGER,
    visibility_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(work_id, collected_at)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    provider TEXT NOT NULL,
    confidence REAL,
    UNIQUE(work_id, start_ms, end_ms)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS ocr_blocks (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    frame_ref TEXT NOT NULL,
    time_ms INTEGER,
    text TEXT NOT NULL,
    confidence REAL,
    UNIQUE(work_id, frame_ref, text)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS evidence_frames (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    frame_ref TEXT NOT NULL,
    time_ms INTEGER,
    local_path TEXT NOT NULL,
    perceptual_hash TEXT,
    selected_for_cloud INTEGER NOT NULL DEFAULT 0 CHECK (selected_for_cloud IN (0,1)),
    UNIQUE(work_id, frame_ref)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_comment_id TEXT NOT NULL,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    public_author_id TEXT,
    public_author_name TEXT NOT NULL DEFAULT '',
    anonymous_author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    like_count INTEGER,
    published_at TEXT,
    collected_at TEXT NOT NULL,
    cloud_state TEXT NOT NULL DEFAULT 'pending',
    exclusion_reason TEXT,
    UNIQUE(platform, platform_comment_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('work','creator','comments')),
    subject_id INTEGER NOT NULL,
    summary TEXT NOT NULL,
    key_points_json TEXT NOT NULL,
    core_expression TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    model_id TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    UNIQUE(subject_type, subject_id, prompt_version)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS taxonomy_tags (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    parent_id TEXT REFERENCES taxonomy_tags(id),
    is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0,1))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS creator_tags (
    creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES taxonomy_tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('ai','human')),
    confidence REAL,
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0,1)),
    evidence_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (creator_id, tag_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS work_keywords (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    normalized_keyword TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('ai','human')),
    PRIMARY KEY (work_id, normalized_keyword)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS inbox_states (
    work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'unread' CHECK (state IN ('unread','read','later','saved')),
    feedback INTEGER NOT NULL DEFAULT 0 CHECK (feedback IN (-1,0,1)),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS interest_weights (
    token TEXT PRIMARY KEY,
    weight REAL NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    subject_type TEXT,
    subject_id INTEGER,
    payload_json TEXT NOT NULL DEFAULT '{}',
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TEXT,
    progress REAL NOT NULL DEFAULT 0,
    status_message TEXT NOT NULL DEFAULT '',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS collection_checkpoints (
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    cursor TEXT,
    has_more INTEGER NOT NULL DEFAULT 1 CHECK (has_more IN (0,1)),
    completeness TEXT NOT NULL DEFAULT 'partial',
    reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_type, scope_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS analysis_batches (
    id INTEGER PRIMARY KEY,
    batch_type TEXT NOT NULL CHECK (batch_type IN ('work_text','work_vision','comments')),
    state TEXT NOT NULL,
    subject_count INTEGER NOT NULL,
    estimated_input_tokens INTEGER NOT NULL,
    estimated_output_tokens INTEGER NOT NULL,
    image_count INTEGER NOT NULL,
    estimated_cost REAL,
    approved_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    manifest_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    subject_type TEXT,
    subject_id TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_works_creator_published ON works(creator_id, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_works_discovered ON works(discovered_at DESC);
  CREATE INDEX IF NOT EXISTS idx_metric_work_time ON metric_snapshots(work_id, collected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id, published_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_state_priority ON jobs(state, priority, created_at);
  CREATE INDEX IF NOT EXISTS idx_creator_tags_tag ON creator_tags(tag_id, creator_id);
  `,
  `SELECT 1;`,
  `
  ALTER TABLE creators ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1));
  ALTER TABLE works ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1));

  CREATE TABLE IF NOT EXISTS work_tags (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES taxonomy_tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('ai','human')),
    confidence REAL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (work_id, tag_id)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_work_tags_tag ON work_tags(tag_id, work_id);

  UPDATE creators SET is_demo=1 WHERE platform='douyin' AND platform_creator_id IN (
    'c-tech','c-finance','c-history','c-work','c-health','c-auto'
  );
  UPDATE works SET is_demo=1 WHERE creator_id IN (SELECT id FROM creators WHERE is_demo=1)
    AND platform_work_id GLOB 'c-*-w[1-4]';

  UPDATE metric_snapshots SET collect_count=NULL,
    visibility_json='{"like":"visible","comment":"visible","collect":"unknown","share":"unknown"}'
    WHERE work_id=(SELECT id FROM works WHERE platform='douyin' AND platform_work_id='c-tech-w2');
  UPDATE metric_snapshots SET comment_count=NULL,
    visibility_json='{"like":"visible","comment":"unknown","collect":"visible","share":"unknown"}'
    WHERE work_id=(SELECT id FROM works WHERE platform='douyin' AND platform_work_id='c-finance-w3');
  UPDATE metric_snapshots SET like_count=NULL,
    visibility_json='{"like":"unknown","comment":"visible","collect":"visible","share":"unknown"}'
    WHERE work_id=(SELECT id FROM works WHERE platform='douyin' AND platform_work_id='c-history-w4');
  `,
  `
  ALTER TABLE comments ADD COLUMN platform_comment_id_kind TEXT NOT NULL DEFAULT 'legacy-unknown'
    CHECK (platform_comment_id_kind IN ('page-attribute','synthetic-content-hash','legacy-unknown'));
  ALTER TABLE comments ADD COLUMN source_verified INTEGER NOT NULL DEFAULT 0
    CHECK (source_verified IN (0,1));
  ALTER TABLE comments ADD COLUMN source_proof_json TEXT NOT NULL DEFAULT '{}';
  `,
  `
  CREATE TABLE comments_r6 (
    id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_comment_id TEXT NOT NULL,
    platform_comment_id_kind TEXT NOT NULL DEFAULT 'legacy-unknown'
      CHECK (platform_comment_id_kind IN ('native-cid','page-attribute','synthetic-content-hash','legacy-unknown')),
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES comments_r6(id) ON DELETE CASCADE,
    root_comment_id INTEGER REFERENCES comments_r6(id) ON DELETE CASCADE,
    public_author_id TEXT,
    public_author_name TEXT NOT NULL DEFAULT '',
    anonymous_author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    like_count INTEGER,
    reply_count INTEGER,
    endpoint_kind TEXT CHECK (endpoint_kind IN ('comment-list','comment-reply-list')),
    published_at TEXT,
    collected_at TEXT NOT NULL,
    cloud_state TEXT NOT NULL DEFAULT 'pending',
    exclusion_reason TEXT,
    source_verified INTEGER NOT NULL DEFAULT 0 CHECK (source_verified IN (0,1)),
    source_proof_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(platform, platform_comment_id)
  ) STRICT;

  INSERT INTO comments_r6(
    id, platform, platform_comment_id, platform_comment_id_kind, work_id,
    parent_comment_id, root_comment_id, public_author_id, public_author_name,
    anonymous_author_id, body, normalized_hash, like_count, reply_count,
    endpoint_kind, published_at, collected_at, cloud_state, exclusion_reason,
    source_verified, source_proof_json
  )
  SELECT
    id, platform, platform_comment_id, platform_comment_id_kind, work_id,
    parent_comment_id, NULL, public_author_id, public_author_name,
    anonymous_author_id, body, normalized_hash, like_count, NULL,
    NULL, published_at, collected_at, cloud_state, exclusion_reason,
    source_verified, source_proof_json
  FROM comments;

  DROP TABLE comments;
  ALTER TABLE comments_r6 RENAME TO comments;
  CREATE INDEX idx_comments_work ON comments(work_id, published_at);

  ALTER TABLE jobs ADD COLUMN adapter_name TEXT;
  ALTER TABLE jobs ADD COLUMN adapter_version TEXT;
  ALTER TABLE jobs ADD COLUMN scope_fingerprint TEXT;
  CREATE UNIQUE INDEX idx_jobs_active_collection_scope
    ON jobs(kind, adapter_version, scope_fingerprint)
    WHERE scope_fingerprint IS NOT NULL
      AND state IN ('queued','running','paused','blocked_user_action','retryable_failed');

  CREATE TABLE collection_checkpoints_r6 (
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    scope_fingerprint TEXT NOT NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    cursor TEXT,
    has_more INTEGER NOT NULL DEFAULT 1 CHECK (has_more IN (0,1)),
    completeness TEXT NOT NULL DEFAULT 'partial',
    reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_type, scope_id, scope_fingerprint)
  ) STRICT, WITHOUT ROWID;

  INSERT INTO collection_checkpoints_r6(
    scope_type, scope_id, scope_fingerprint, job_id, cursor,
    has_more, completeness, reason, updated_at
  )
  SELECT
    scope_type, scope_id, 'legacy-unversioned', NULL, cursor,
    has_more, completeness, reason, updated_at
  FROM collection_checkpoints;

  DROP TABLE collection_checkpoints;
  ALTER TABLE collection_checkpoints_r6 RENAME TO collection_checkpoints;
  CREATE INDEX idx_collection_checkpoints_job ON collection_checkpoints(job_id);
  `
]

export function migrateDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
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

  // V0.1 development databases may predate browser-provided media URLs while
  // already having user_version=1. Keep this compatibility guard idempotent.
  const workColumns = new Set((db.prepare('PRAGMA table_info(works)').all() as Array<{ name: string }>).map((column) => column.name))
  if (!workColumns.has('media_url')) db.exec('ALTER TABLE works ADD COLUMN media_url TEXT')
  if (!workColumns.has('image_urls_json')) db.exec(`ALTER TABLE works ADD COLUMN image_urls_json TEXT NOT NULL DEFAULT '[]'`)

  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, content, tokenize='trigram')`)
  } catch {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, content, tokenize='unicode61')`)
  }

  const insertTag = db.prepare('INSERT OR IGNORE INTO taxonomy_tags(id, label, parent_id, is_system) VALUES (?, ?, NULL, 1)')
  for (const [id, label] of DEFAULT_DOMAINS) insertTag.run(id, label)

  const now = new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO owner_accounts(platform, local_label, created_at) VALUES ('douyin', '我的抖音', ?)`).run(now)
}
