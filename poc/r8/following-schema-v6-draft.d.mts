import type { DatabaseSync } from 'node:sqlite'

export const FOLLOWING_SCHEMA_V6_DRAFT: string
export function applyFollowingSchemaV6Draft(db: DatabaseSync): void
