import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

import { failure, success } from '../../../domain/errors/result.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../failures.ts'
import { INITIAL_SCHEMA_MIGRATION } from './001-initial-schema.ts'
import { EXECUTION_SCHEMA_MIGRATION } from './002-execution-schema.ts'
import type { MigrationDefinition } from './types.ts'

export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  INITIAL_SCHEMA_MIGRATION,
  EXECUTION_SCHEMA_MIGRATION,
])

const LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  reverse_checksum TEXT,
  applied_at TEXT NOT NULL,
  application_version TEXT NOT NULL
) STRICT;
`

export function migrationRegistryChecksum(): string {
  return createHash('sha256')
    .update(MIGRATIONS.map((item) => `${item.id}:${item.checksum}`).join('|'))
    .digest('hex')
}

export function migrateDatabase(
  database: Database.Database,
  appliedAt: string,
  applicationVersion: string,
): PersistenceResult<number> {
  database.exec(LEDGER_SQL)
  const applied = database.prepare(
    'SELECT id, name, checksum FROM schema_migrations ORDER BY id',
  ).all() as readonly { id: number; name: string; checksum: string }[]

  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index]
    const definition = MIGRATIONS[index]
    if (
      row === undefined
      || definition === undefined
      || row.id !== definition.id
      || row.name !== definition.name
      || row.checksum !== definition.checksum
    ) {
      return failure(persistenceFailure('MIGRATION_HISTORY_DIVERGED'))
    }
  }

  const userVersion = database.pragma('user_version', { simple: true }) as number
  const current = applied.at(-1)?.id ?? 0
  if (userVersion !== current) {
    return failure(persistenceFailure('SCHEMA_VERSION_MISMATCH'))
  }

  for (const migration of MIGRATIONS.slice(applied.length)) {
    try {
      database.exec('BEGIN IMMEDIATE')
      database.exec(migration.upSql)
      migration.assertForward(database)
      database.prepare(`
        INSERT INTO schema_migrations (
          id, name, checksum, reverse_checksum, applied_at, application_version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        migration.id,
        migration.name,
        migration.checksum,
        migration.reverseChecksum ?? null,
        appliedAt,
        applicationVersion,
      )
      database.pragma(`user_version = ${migration.id}`)
      database.exec('COMMIT')
    } catch {
      if (database.inTransaction) database.exec('ROLLBACK')
      return failure(persistenceFailure('MIGRATION_FAILED'))
    }
  }

  return success(MIGRATIONS.at(-1)?.id ?? 0)
}

export function reverseLatestMigration(
  database: Database.Database,
  maintenanceMode: boolean,
  verifiedBackup: boolean,
): PersistenceResult<number> {
  if (!maintenanceMode || !verifiedBackup) {
    return failure(persistenceFailure('MIGRATION_BACKUP_REQUIRED'))
  }
  const current = database.pragma('user_version', { simple: true }) as number
  if (current === 0) return success(0)
  const migration = MIGRATIONS.find((item) => item.id === current)
  if (migration?.downSql === undefined) {
    return failure(persistenceFailure('MIGRATION_IRREVERSIBLE'))
  }
  try {
    database.exec('BEGIN IMMEDIATE')
    database.exec(migration.downSql)
    database.prepare('DELETE FROM schema_migrations WHERE id = ?').run(current)
    database.pragma(`user_version = ${current - 1}`)
    database.exec('COMMIT')
    return success(current - 1)
  } catch {
    if (database.inTransaction) database.exec('ROLLBACK')
    return failure(persistenceFailure('MIGRATION_FAILED'))
  }
}
