import type Database from 'better-sqlite3'

import { failure, success } from '../../domain/errors/result.ts'
import {
  parseDomainEvent,
  serializeDomainEvent,
} from '../../domain/events/codecs.ts'
import type { PortfolioDomainEvent } from '../../domain/events/domain-events.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import { canonicalJson, sha256 } from './codecs.ts'
import { SQL } from './statement-catalog.ts'

const GENESIS_HASH = '0'.repeat(64)

type EventHead = {
  stream_sequence: number
  event_hash: string
}

function eventMatchesPersistedState(
  database: Database.Database,
  event: PortfolioDomainEvent,
): boolean {
  const row = database.prepare(`
    SELECT
      p.display_name,
      p.status,
      p.operating_mode,
      p.cash_minor_units,
      a.policy_identity
    FROM portfolios p
    JOIN portfolio_allocations a
      ON a.portfolio_id = p.portfolio_id AND a.is_current = 1
    WHERE p.portfolio_id = ?
  `).get(event.portfolioId) as
    | {
        display_name: string
        status: string
        operating_mode: string
        cash_minor_units: string
        policy_identity: string
      }
    | undefined
  if (row === undefined) return false

  switch (event.type) {
    case 'PortfolioCreated':
      return row.display_name === event.payload.displayName
        && row.status === event.payload.status
        && row.operating_mode === event.payload.mode
        && row.cash_minor_units === event.payload.startingCash.minorUnits.toString()
        && row.policy_identity === event.payload.allocationPolicyId
    case 'PortfolioArchived':
      return row.status === event.payload.status
    case 'PortfolioModeChanged':
      return row.operating_mode === event.payload.mode
    case 'StrategyAllocationChanged':
      return row.policy_identity === event.payload.allocationPolicyId
  }
}

export function appendDomainEvents(
  database: Database.Database,
  events: readonly PortfolioDomainEvent[],
  insertedAt: string,
): PersistenceResult<void> {
  try {
    const seen = new Set<string>()
    for (const event of events) {
      if (seen.has(event.eventId)) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      seen.add(event.eventId)

      const state = database.prepare(SQL.selectPortfolioVersion).get(
        event.portfolioId,
      ) as { state_version: number } | undefined
      if (state?.state_version !== event.stateVersion) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      if (!eventMatchesPersistedState(database, event)) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }

      const streamKey = `portfolio:${event.portfolioId}`
      const head = database.prepare(`
        SELECT stream_sequence, event_hash
        FROM domain_events
        WHERE stream_key = ?
        ORDER BY stream_sequence DESC
        LIMIT 1
      `).get(streamKey) as EventHead | undefined
      const sequence = (head?.stream_sequence ?? 0) + 1
      const previousHash = head?.event_hash ?? GENESIS_HASH
      const serializedEvent = serializeDomainEvent(event)
      const validatedEvent = parseDomainEvent(serializedEvent)
      if (!validatedEvent.ok) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      const canonicalEvent = canonicalJson(JSON.parse(serializedEvent))
      const eventHash = sha256(
        `${streamKey}|${sequence}|${previousHash}|${canonicalEvent}`,
      )

      database.prepare(`
        INSERT INTO domain_events (
          event_id, stream_key, stream_sequence, previous_hash, event_hash,
          event_type, event_schema_version, portfolio_id, aggregate_state_version,
          occurred_at, actor_id, command_id, correlation_id, causation_id,
          canonical_payload, inserted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        streamKey,
        sequence,
        previousHash,
        eventHash,
        event.type,
        event.schemaVersion,
        event.portfolioId,
        event.stateVersion,
        event.occurredAt,
        event.actorId,
        event.commandId,
        event.correlationId,
        event.causationId,
        canonicalEvent,
        insertedAt,
      )
      database.prepare(`
        INSERT INTO event_dispatch (
          event_id, status, attempt_count, available_at
        ) VALUES (?, 'PENDING', 0, ?)
      `).run(event.eventId, insertedAt)
    }
    return success(undefined)
  } catch {
    return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
  }
}

export function verifyEventChains(
  database: Database.Database,
): PersistenceResult<Readonly<Record<string, string>>> {
  try {
    const rows = database.prepare(`
      SELECT stream_key, stream_sequence, previous_hash, event_hash, canonical_payload
      FROM domain_events
      ORDER BY stream_key, stream_sequence
    `).all() as readonly {
      stream_key: string
      stream_sequence: number
      previous_hash: string
      event_hash: string
      canonical_payload: string
    }[]

    const heads: Record<string, string> = {}
    const sequences = new Map<string, number>()
    for (const row of rows) {
      const expectedSequence = (sequences.get(row.stream_key) ?? 0) + 1
      const previousHash = heads[row.stream_key] ?? GENESIS_HASH
      const expectedHash = sha256(
        `${row.stream_key}|${expectedSequence}|${previousHash}|${row.canonical_payload}`,
      )
      if (
        row.stream_sequence !== expectedSequence
        || row.previous_hash !== previousHash
        || row.event_hash !== expectedHash
      ) {
        return failure(persistenceFailure('AUDIT_CHAIN_BROKEN'))
      }
      sequences.set(row.stream_key, expectedSequence)
      heads[row.stream_key] = row.event_hash
    }
    return success(Object.freeze(heads))
  } catch {
    return failure(persistenceFailure('AUDIT_CHAIN_BROKEN'))
  }
}
