// Review-only migration. Deliberately absent from DATABASE_MIGRATIONS.
// The caller must use an isolated copy of a schema-v5 database.
export const FOLLOWING_SCHEMA_V6_DRAFT = `
ALTER TABLE owner_accounts ADD COLUMN platform_sec_uid TEXT;
ALTER TABLE owner_accounts ADD COLUMN identity_verified_at TEXT;
ALTER TABLE owner_accounts ADD COLUMN identity_source TEXT;
CREATE UNIQUE INDEX idx_owner_verified_sec_uid
  ON owner_accounts(platform, platform_sec_uid) WHERE platform_sec_uid IS NOT NULL;

ALTER TABLE creators ADD COLUMN sec_uid TEXT;
ALTER TABLE creators ADD COLUMN identity_verified_at TEXT;
ALTER TABLE creators ADD COLUMN identity_source TEXT;
CREATE UNIQUE INDEX idx_creator_verified_sec_uid
  ON creators(platform, sec_uid) WHERE sec_uid IS NOT NULL;

CREATE TABLE creator_owner_relationships (
  owner_account_id INTEGER NOT NULL REFERENCES owner_accounts(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  following_state TEXT NOT NULL
    CHECK(following_state IN ('active','stale','unfollowed','identity_conflict')),
  first_discovered_at TEXT NOT NULL,
  following_verified_at TEXT NOT NULL,
  last_complete_refresh_id TEXT,
  PRIMARY KEY(owner_account_id, creator_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_creator_owner_syncable
  ON creator_owner_relationships(owner_account_id, following_state, creator_id);

CREATE TABLE verified_collection_checkpoints (
  owner_account_id INTEGER NOT NULL REFERENCES owner_accounts(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL
    CHECK(target_kind IN ('creator-works','work-detail','work-comments','work-replies')),
  native_id TEXT NOT NULL,
  sec_uid TEXT,
  adapter_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','scope-limited','partial','blocked')),
  cursor_field TEXT,
  cursor_value_category TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_account_id,target_kind,native_id,adapter_version)
) STRICT, WITHOUT ROWID;
`

export function applyFollowingSchemaV6Draft(db) {
  const version = Number(db.prepare('PRAGMA user_version').get().user_version)
  if (version !== 5) throw new Error('draft v6 requires an isolated schema-v5 database')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(FOLLOWING_SCHEMA_V6_DRAFT)
    db.exec('PRAGMA user_version=6')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('draft v6 foreign key check failed')
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
