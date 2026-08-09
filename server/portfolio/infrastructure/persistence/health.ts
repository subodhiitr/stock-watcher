import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'

import { failure, success } from '../../domain/errors/result.ts'
import { verifyEventChains } from '../../adapters/persistence/event-ledger.ts'
import { verifyExecutionEventChains } from '../../adapters/persistence/execution-event-ledger.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from './failures.ts'
import { MIGRATIONS, migrationRegistryChecksum } from './migrations/index.ts'

export type PortfolioDatabaseHealth = Readonly<{
  schemaVersion: number
  migrationRegistryChecksum: string
  databaseIntegrity: 'ok'
  foreignKeysEnabled: true
  trustedSchemaDisabled: true
  attachedDatabaseCount: 1
  verifiedEventStreams: number
  operationsAuditValid: true
}>

export function inspectPortfolioDatabaseHealth(
  database: Database.Database,
): PersistenceResult<PortfolioDatabaseHealth> {
  try {
    const quickCheck = database.pragma('quick_check', { simple: true })
    const foreignKeys = database.pragma('foreign_keys', { simple: true })
    const trustedSchema = database.pragma('trusted_schema', { simple: true })
    const schemaVersion = database.pragma('user_version', { simple: true }) as number
    const databases = database.pragma('database_list') as readonly {
      seq: number
      name: string
      file: string
    }[]
    const attachedDatabaseCount = databases.filter((item) => item.name !== 'temp').length
    const chain = verifyEventChains(database)
    const executionChain = verifyExecutionEventChains(database)
    const auditRows = database.prepare(`
      SELECT previous_hash, event_hash, actor_id, portfolio_id, run_id, event_type,
             reason_code, explanation, input_version_hash, created_at, redacted_payload
      FROM portfolio_audit_events ORDER BY rowid
    `).all() as readonly Record<string, unknown>[]
    let previousHash = '0'.repeat(64)
    let operationsAuditValid = true
    for (const row of auditRows) {
      const eventHash = createHash('sha256').update(JSON.stringify({
        actorId: row.actor_id,
        portfolioId: row.portfolio_id,
        runId: row.run_id,
        eventType: row.event_type,
        reasonCode: row.reason_code,
        explanation: row.explanation,
        inputVersionHash: row.input_version_hash,
        previousHash,
        createdAt: row.created_at,
        redactedPayload: JSON.parse(String(row.redacted_payload)) as unknown,
      })).digest('hex')
      if (row.previous_hash !== previousHash || row.event_hash !== eventHash) {
        operationsAuditValid = false
        break
      }
      previousHash = String(row.event_hash)
    }
    if (
      quickCheck !== 'ok'
      || foreignKeys !== 1
      || trustedSchema !== 0
      || schemaVersion !== (MIGRATIONS.at(-1)?.id ?? 0)
      || attachedDatabaseCount !== 1
      || !chain.ok
      || !executionChain.ok
      || !operationsAuditValid
    ) {
      return failure(persistenceFailure(
        !chain.ok
          ? chain.error.code
          : !executionChain.ok
            ? executionChain.error.code
            : !operationsAuditValid
              ? 'DATABASE_INTEGRITY_FAILED'
            : 'DATABASE_INTEGRITY_FAILED',
      ))
    }
    return success(Object.freeze({
      schemaVersion,
      migrationRegistryChecksum: migrationRegistryChecksum(),
      databaseIntegrity: 'ok',
      foreignKeysEnabled: true,
      trustedSchemaDisabled: true,
      attachedDatabaseCount: 1,
      verifiedEventStreams:
        Object.keys(chain.value).length + Object.keys(executionChain.value).length,
      operationsAuditValid: true,
    }))
  } catch {
    return failure(persistenceFailure('DATABASE_INTEGRITY_FAILED'))
  }
}
