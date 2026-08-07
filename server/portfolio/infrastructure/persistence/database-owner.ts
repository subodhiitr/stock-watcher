import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'

import { failure, success } from '../../domain/errors/result.ts'
import { SqlitePortfolioRepository } from '../../adapters/persistence/portfolio-repository.ts'
import { SqlitePortfolioUnitOfWork } from '../../adapters/persistence/unit-of-work.ts'
import { SqliteExecutionUnitOfWork } from '../../adapters/persistence/execution-unit-of-work.ts'
import type { PortfolioRepository, PortfolioUnitOfWork } from '../../ports/index.ts'
import type { ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts'
import { parseInstant } from '../../domain/shared/time.ts'
import type { PortfolioDatabaseConfiguration } from './configuration.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from './failures.ts'
import {
  inspectPortfolioDatabaseHealth,
  type PortfolioDatabaseHealth,
} from './health.ts'
import { migrateDatabase } from './migrations/index.ts'
import { pathsEqual, validateDatabasePath } from './path-policy.ts'
import { seedPortfolioDatabase } from './seeds.ts'

const APPLICATION_VERSION = '1.0.0'
const OPEN_DATABASE_PATHS = new Set<string>()
const BACKUP_TABLES = Object.freeze([
  'schema_migrations',
  'database_metadata',
  'seed_registry',
  'strategy_definitions',
  'strategy_versions',
  'portfolios',
  'portfolio_allocations',
  'strategy_assignments',
  'holdings',
  'holding_lots',
  'domain_events',
  'event_dispatch',
  'execution_approvals',
  'execution_runs',
  'execution_orders',
  'reconciliation_runs',
  'reconciliation_snapshots',
  'execution_kill_switches',
  'execution_fills',
  'execution_cancellation_requests',
  'execution_cancellation_outcomes',
  'execution_residual_work',
  'execution_adjustment_proposals',
  'execution_domain_events',
  'execution_event_dispatch',
] as const)

function databaseFingerprint(database: Database.Database): string {
  const hash = createHash('sha256')
  for (const table of BACKUP_TABLES) {
    hash.update(`${table}\n`)
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
      hash.update(JSON.stringify(row))
      hash.update('\n')
    }
  }
  return hash.digest('hex')
}

export type PortfolioBackupReceipt = Readonly<{
  destination: string
  schemaVersion: number
  verifiedEventStreams: number
}>

export interface PortfolioDatabaseOwner {
  readonly portfolios: PortfolioRepository
  readonly unitOfWork: PortfolioUnitOfWork
  readonly executionUnitOfWork: ExecutionUnitOfWork
  health(): PersistenceResult<PortfolioDatabaseHealth>
  backupTo(destination: string): Promise<PersistenceResult<PortfolioBackupReceipt>>
  close(): PersistenceResult<void>
}

class SqlitePortfolioDatabaseOwner implements PortfolioDatabaseOwner {
  readonly #database: Database.Database
  readonly #configuration: PortfolioDatabaseConfiguration
  readonly #canonicalPath: string
  readonly #releasePath: () => void
  #closed = false
  #backingUp = false

  public readonly portfolios: PortfolioRepository
  public readonly unitOfWork: PortfolioUnitOfWork
  public readonly executionUnitOfWork: ExecutionUnitOfWork

  constructor(
    database: Database.Database,
    configuration: PortfolioDatabaseConfiguration,
    canonicalPath: string,
    releasePath: () => void,
  ) {
    this.#database = database
    this.#configuration = configuration
    this.#canonicalPath = canonicalPath
    this.#releasePath = releasePath
    this.portfolios = new SqlitePortfolioRepository(
      database,
      false,
      () => !this.#closed && !this.#backingUp,
      configuration.now,
    )
    this.unitOfWork = new SqlitePortfolioUnitOfWork(
      database,
      configuration.now,
      () => !this.#closed && !this.#backingUp,
    )
    this.executionUnitOfWork = new SqliteExecutionUnitOfWork(
      database,
      configuration.now,
      () => !this.#closed && !this.#backingUp,
    )
  }

  public health(): PersistenceResult<PortfolioDatabaseHealth> {
    if (this.#closed || this.#backingUp) {
      return failure(persistenceFailure('PERSISTENCE_NOT_OPEN'))
    }
    return inspectPortfolioDatabaseHealth(this.#database)
  }

  public async backupTo(destination: string): Promise<PersistenceResult<PortfolioBackupReceipt>> {
    if (this.#closed || this.#backingUp) {
      return failure(persistenceFailure('PERSISTENCE_NOT_OPEN'))
    }
    const validated = validateDatabasePath(
      destination,
      'PERSISTENT',
      [...this.#configuration.protectedLegacyPaths, this.#canonicalPath],
    )
    if (!validated.ok || pathsEqual(validated.value.canonicalPath, this.#canonicalPath)) {
      return failure(persistenceFailure('INVALID_BACKUP_DESTINATION'))
    }
    const attestation = this.#configuration.encryptionAttestation.attest(
      validated.value.canonicalPath,
      'BACKUP',
    )
    if (!attestation.ok) return attestation
    if (
      !parseInstant(attestation.value.attestedAt).ok
      || (
        this.#configuration.mode === 'PERSISTENT'
        && attestation.value.protection === 'TEMPORARY_TEST'
      )
    ) {
      return failure(persistenceFailure('INVALID_ENCRYPTION_ATTESTATION'))
    }
    if (fs.existsSync(validated.value.canonicalPath)) {
      return failure(persistenceFailure('INVALID_BACKUP_DESTINATION'))
    }

    let backupCreated = false
    let verificationStarted = false
    this.#backingUp = true
    try {
      fs.mkdirSync(path.dirname(validated.value.canonicalPath), { recursive: true })
      const sourceFingerprint = databaseFingerprint(this.#database)
      await this.#database.backup(validated.value.canonicalPath)
      backupCreated = true
      verificationStarted = true
      const verificationDatabase = new Database(validated.value.canonicalPath, {
        readonly: true,
        fileMustExist: true,
      })
      try {
        verificationDatabase.pragma('foreign_keys = ON')
        verificationDatabase.pragma('trusted_schema = OFF')
        const health = inspectPortfolioDatabaseHealth(verificationDatabase)
        if (!health.ok) {
          throw new Error('BACKUP_VERIFICATION_FAILED')
        }
        if (databaseFingerprint(verificationDatabase) !== sourceFingerprint) {
          throw new Error('BACKUP_VERIFICATION_FAILED')
        }
        return success(Object.freeze({
          destination: validated.value.canonicalPath,
          schemaVersion: health.value.schemaVersion,
          verifiedEventStreams: health.value.verifiedEventStreams,
        }))
      } finally {
        verificationDatabase.close()
      }
    } catch {
      if (backupCreated && fs.existsSync(validated.value.canonicalPath)) {
        try {
          fs.unlinkSync(validated.value.canonicalPath)
        } catch {
          return failure(persistenceFailure('UNSAFE_DATABASE_BACKUP'))
        }
      }
      return failure(persistenceFailure(
        verificationStarted
          ? 'BACKUP_VERIFICATION_FAILED'
          : 'UNSAFE_DATABASE_BACKUP',
      ))
    } finally {
      this.#backingUp = false
    }
  }

  public close(): PersistenceResult<void> {
    if (this.#closed) return success(undefined)
    if (this.#database.inTransaction || this.#backingUp) {
      return failure(persistenceFailure('DATABASE_CLOSING'))
    }
    try {
      this.#database.close()
      this.#closed = true
      this.#releasePath()
      return success(undefined)
    } catch {
      return failure(persistenceFailure('DATABASE_CLOSING'))
    }
  }
}

export function openPortfolioDatabase(
  configuration: PortfolioDatabaseConfiguration,
): PersistenceResult<PortfolioDatabaseOwner> {
  const validated = validateDatabasePath(
    configuration.databasePath,
    configuration.mode,
    configuration.protectedLegacyPaths,
  )
  if (!validated.ok) return validated
  if (
    !validated.value.inMemory
    && OPEN_DATABASE_PATHS.has(validated.value.canonicalPath)
  ) {
    return failure(persistenceFailure('PERSISTENCE_OWNER_REQUIRED'))
  }

  const attestation = configuration.encryptionAttestation.attest(
    validated.value.canonicalPath,
    'DATABASE',
  )
  if (!attestation.ok) return attestation
  if (
    !parseInstant(attestation.value.attestedAt).ok
    || (
      configuration.mode === 'PERSISTENT'
      && attestation.value.protection === 'TEMPORARY_TEST'
    )
    || (
      configuration.mode === 'TEMPORARY_TEST'
      && attestation.value.protection !== 'TEMPORARY_TEST'
    )
  ) {
    return failure(persistenceFailure('INVALID_ENCRYPTION_ATTESTATION'))
  }

  let database: Database.Database | undefined
  try {
    if (!validated.value.inMemory) {
      fs.mkdirSync(path.dirname(validated.value.canonicalPath), { recursive: true })
    }
    database = new Database(validated.value.sqlitePath)
    database.pragma('foreign_keys = ON')
    database.pragma('trusted_schema = OFF')
    database.pragma(`busy_timeout = ${configuration.busyTimeoutMs}`)
    database.pragma('synchronous = FULL')
    database.pragma(validated.value.inMemory ? 'journal_mode = MEMORY' : 'journal_mode = WAL')

    const foreignKeys = database.pragma('foreign_keys', { simple: true })
    const trustedSchema = database.pragma('trusted_schema', { simple: true })
    const synchronous = database.pragma('synchronous', { simple: true })
    const busyTimeout = database.pragma('busy_timeout', { simple: true })
    const journalMode = database.pragma('journal_mode', { simple: true })
    if (
      foreignKeys !== 1
      || trustedSchema !== 0
      || synchronous !== 2
      || busyTimeout !== configuration.busyTimeoutMs
      || journalMode !== (validated.value.inMemory ? 'memory' : 'wal')
    ) {
      database.close()
      return failure(persistenceFailure('INVALID_SQLITE_CONFIGURATION'))
    }

    const migrated = migrateDatabase(database, configuration.now(), APPLICATION_VERSION)
    if (!migrated.ok) {
      database.close()
      return migrated
    }
    database.prepare(`
      INSERT OR IGNORE INTO database_metadata (
        singleton_id, database_id, database_kind, created_at, minimum_reader_version
      ) VALUES (1, ?, 'PORTFOLIO_MANAGEMENT', ?, 1)
    `).run(`portfolio-database:${randomUUID()}`, configuration.now())

    const seeded = seedPortfolioDatabase(
      database,
      configuration.now(),
      configuration.defaultStartingCashMinorUnits,
    )
    if (!seeded.ok) {
      database.close()
      return seeded
    }
    const health = inspectPortfolioDatabaseHealth(database)
    if (!health.ok) {
      database.close()
      return health
    }
    if (!validated.value.inMemory) {
      OPEN_DATABASE_PATHS.add(validated.value.canonicalPath)
    }
    return success(new SqlitePortfolioDatabaseOwner(
      database,
      configuration,
      validated.value.canonicalPath,
      () => {
        if (!validated.value.inMemory) {
          OPEN_DATABASE_PATHS.delete(validated.value.canonicalPath)
        }
      },
    ))
  } catch {
    if (database?.open) database.close()
    return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
  }
}
