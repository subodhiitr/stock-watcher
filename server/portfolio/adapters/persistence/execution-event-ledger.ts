import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  parseExecutionDomainEvent,
  serializeExecutionDomainEvent,
} from '../../domain/events/execution-event-codecs.ts'
import {
  EXECUTION_EVENT_SCHEMA_VERSION,
  freezeExecutionDomainEvent,
  type ExecutionDomainEvent,
  type ExecutionEventAggregateKind,
  type ExecutionEventFactKind,
  type ExecutionEventScope,
} from '../../domain/events/execution-events.ts'
import type { ExecutionEvidencePayload } from '../../domain/execution/evidence.ts'
import { failure, success } from '../../domain/errors/result.ts'
import {
  parseEventId,
  parsePortfolioId,
  type EventId,
} from '../../domain/shared/identifiers.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import { canonicalJson, sha256 } from './codecs.ts'
import type {
  ExecutionAggregateKind,
  ExecutionAggregateMutation,
  ExecutionFactInsertion,
  PortfolioMutation,
  TransactionMutation,
} from './unit-of-work.ts'

const GENESIS_HASH = '0'.repeat(64)

type EventHead = Readonly<{
  stream_sequence: number
  event_hash: string
}>

function evidencePortfolioId(evidence: ExecutionEvidencePayload): string | undefined {
  return 'portfolioId' in evidence ? evidence.portfolioId : undefined
}

function matchesPortfolioMutation(
  mutation: PortfolioMutation,
  evidence: ExecutionEvidencePayload,
): boolean {
  return evidence.kind === 'PORTFOLIO_ACCOUNTING_CHANGED'
    && evidence.portfolioId === mutation.portfolioId
    && evidence.portfolioStateVersion === mutation.stateVersion
}

function matchesAggregateMutation(
  mutation: ExecutionAggregateMutation,
  evidence: ExecutionEvidencePayload,
): boolean {
  switch (mutation.aggregateKind) {
    case 'APPROVAL':
      return evidence.kind === 'APPROVAL_DECIDED'
        && evidence.approvalId === mutation.aggregateId
    case 'EXECUTION_RUN':
      return (
        evidence.kind === 'EXECUTION_RUN_STATE_CHANGED'
        || evidence.kind === 'EXECUTION_RUN_PORTFOLIO_VERSION_ADVANCED'
      ) && evidence.executionRunId === mutation.aggregateId
    case 'EXECUTION_ORDER':
      return (
        evidence.kind === 'ORDER_INTENT_RECORDED'
        || evidence.kind === 'SUBMISSION_ATTEMPT_STARTED'
        || evidence.kind === 'SUBMISSION_OUTCOME_RECORDED'
        || evidence.kind === 'ORDER_STATE_CHANGED'
        || evidence.kind === 'RECOVERY_CLASSIFIED'
      ) && evidence.orderId === mutation.aggregateId
    case 'RECONCILIATION_RUN':
      return (
        evidence.kind === 'RECONCILIATION_COMPLETED'
        || evidence.kind === 'RECONCILIATION_STATE_CHANGED'
      ) && evidence.reconciliationRunId === mutation.aggregateId
    case 'KILL_SWITCH':
      return (
        evidence.kind === 'KILL_SWITCH_ACTIVATED'
        || evidence.kind === 'KILL_SWITCH_RESET'
      ) && evidence.killSwitchId === mutation.aggregateId
    case 'ADJUSTMENT_PROPOSAL':
      return evidence.kind === 'ADJUSTMENT_PROPOSAL_RECORDED'
        && evidence.adjustmentProposalId === mutation.aggregateId
  }
}

function matchesFactInsertion(
  mutation: ExecutionFactInsertion,
  evidence: ExecutionEvidencePayload,
): boolean {
  switch (mutation.factKind) {
    case 'RECONCILIATION_SNAPSHOT':
      return evidence.kind === 'RECONCILIATION_SNAPSHOT_RECORDED'
        && evidence.snapshotId === mutation.factId
    case 'FILL':
      return evidence.kind === 'FILL_RECORDED'
        && evidence.fillId === mutation.factId
    case 'CANCELLATION_REQUEST':
      return evidence.kind === 'CANCELLATION_REQUESTED'
        && evidence.cancellationId === mutation.factId
    case 'CANCELLATION_OUTCOME':
      return evidence.kind === 'CANCELLATION_OUTCOME_RECORDED'
        && evidence.cancellationId === mutation.factId
    case 'RESIDUAL_WORK':
      return evidence.kind === 'RESIDUAL_WORK_RECORDED'
        && evidence.residualWorkId === mutation.factId
  }
}

function matchesMutation(
  mutation: TransactionMutation,
  evidence: ExecutionEvidencePayload,
): boolean {
  const portfolioId = evidencePortfolioId(evidence)
  if (mutation.category !== 'EXECUTION_AGGREGATE' || mutation.portfolioId !== undefined) {
    if (portfolioId !== mutation.portfolioId) return false
  } else if (
    evidence.kind !== 'KILL_SWITCH_ACTIVATED'
    && evidence.kind !== 'KILL_SWITCH_RESET'
  ) {
    return false
  }

  switch (mutation.category) {
    case 'PORTFOLIO':
      return matchesPortfolioMutation(mutation, evidence)
    case 'EXECUTION_AGGREGATE':
      return matchesAggregateMutation(mutation, evidence)
    case 'EXECUTION_FACT':
      return matchesFactInsertion(mutation, evidence)
  }
}

function eventScope(mutation: TransactionMutation): ExecutionEventScope {
  if (mutation.category === 'EXECUTION_AGGREGATE' && mutation.portfolioId === undefined) {
    return Object.freeze({
      kind: 'GLOBAL',
      globalStreamId: 'GLOBAL_EXECUTION_CONTROL',
    })
  }
  const portfolioId = mutation.portfolioId
  if (portfolioId === undefined) throw new Error('MISSING_EVENT_PORTFOLIO')
  const parsed = parsePortfolioId(portfolioId)
  if (!parsed.ok) throw new Error('INVALID_EVENT_PORTFOLIO')
  return Object.freeze({ kind: 'PORTFOLIO', portfolioId: parsed.value })
}

function aggregateKind(mutation: PortfolioMutation | ExecutionAggregateMutation): ExecutionEventAggregateKind {
  return mutation.category === 'PORTFOLIO' ? 'PORTFOLIO' : mutation.aggregateKind
}

function aggregateId(mutation: PortfolioMutation | ExecutionAggregateMutation): string {
  return mutation.category === 'PORTFOLIO' ? mutation.portfolioId : mutation.aggregateId
}

function eventIdFor(
  mutation: TransactionMutation,
  evidence: ExecutionEvidencePayload,
): PersistenceResult<EventId> {
  const digest = createHash('sha256')
    .update(canonicalJson({ mutation, evidence }), 'utf8')
    .digest('hex')
  const parsed = parseEventId(`execution-event:${digest}`)
  return parsed.ok
    ? success(parsed.value)
    : failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
}

export function createExecutionDomainEvents(
  mutations: readonly TransactionMutation[],
  evidence: readonly ExecutionEvidencePayload[],
): PersistenceResult<readonly ExecutionDomainEvent[]> {
  if (mutations.length !== evidence.length) {
    return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
  }
  const unmatched = [...evidence]
  const events: ExecutionDomainEvent[] = []
  try {
    for (const mutation of mutations) {
      const index = unmatched.findIndex((item) => matchesMutation(mutation, item))
      if (index < 0) return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      const matched = unmatched[index]
      if (matched === undefined) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      unmatched.splice(index, 1)
      const eventId = eventIdFor(mutation, matched)
      if (!eventId.ok) return eventId
      const scope = eventScope(mutation)
      if (mutation.category === 'EXECUTION_FACT') {
        events.push(freezeExecutionDomainEvent({
          eventId: eventId.value,
          schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
          scope,
          occurredAt: matched.occurredAt,
          type: 'ExecutionFactInserted',
          payload: {
            factKind: mutation.factKind as ExecutionEventFactKind,
            factId: mutation.factId,
            evidence: matched,
          },
        }))
      } else {
        events.push(freezeExecutionDomainEvent({
          eventId: eventId.value,
          schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
          scope,
          occurredAt: matched.occurredAt,
          type: 'ExecutionAggregateMutationRecorded',
          payload: {
            operation: mutation.kind,
            aggregateKind: aggregateKind(mutation),
            aggregateId: aggregateId(mutation),
            aggregateStateVersion: mutation.stateVersion,
            evidence: matched,
          },
        }))
      }
    }
    return unmatched.length === 0
      ? success(Object.freeze(events))
      : failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
  } catch {
    return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
  }
}

function persistedAggregateMatches(
  database: Database.Database,
  event: ExecutionDomainEvent,
): boolean {
  if (event.type !== 'ExecutionAggregateMutationRecorded') return false
  const { aggregateKind, aggregateId, aggregateStateVersion } = event.payload
  const tableAndId: Readonly<Record<ExecutionEventAggregateKind, readonly [string, string]>> = {
    PORTFOLIO: ['portfolios', 'portfolio_id'],
    APPROVAL: ['execution_approvals', 'approval_id'],
    EXECUTION_RUN: ['execution_runs', 'execution_run_id'],
    EXECUTION_ORDER: ['execution_orders', 'order_id'],
    RECONCILIATION_RUN: ['reconciliation_runs', 'reconciliation_run_id'],
    KILL_SWITCH: ['execution_kill_switches', 'kill_switch_id'],
    ADJUSTMENT_PROPOSAL: ['execution_adjustment_proposals', 'adjustment_proposal_id'],
  }
  const [table, idColumn] = tableAndId[aggregateKind]
  const row = database.prepare(
    `SELECT state_version FROM ${table} WHERE ${idColumn} = ?`,
  ).get(aggregateId) as { state_version: number } | undefined
  return row?.state_version === aggregateStateVersion
}

function persistedFactMatches(
  database: Database.Database,
  event: ExecutionDomainEvent,
): boolean {
  if (event.type !== 'ExecutionFactInserted') return false
  const tableAndId: Readonly<Record<ExecutionEventFactKind, readonly [string, string]>> = {
    RECONCILIATION_SNAPSHOT: ['reconciliation_snapshots', 'snapshot_id'],
    FILL: ['execution_fills', 'fill_id'],
    CANCELLATION_REQUEST: ['execution_cancellation_requests', 'cancellation_id'],
    CANCELLATION_OUTCOME: ['execution_cancellation_outcomes', 'cancellation_id'],
    RESIDUAL_WORK: ['execution_residual_work', 'residual_work_id'],
  }
  const [table, idColumn] = tableAndId[event.payload.factKind]
  return database.prepare(
    `SELECT 1 AS present FROM ${table} WHERE ${idColumn} = ?`,
  ).get(event.payload.factId) !== undefined
}

export function appendExecutionDomainEvents(
  database: Database.Database,
  events: readonly ExecutionDomainEvent[],
  insertedAt: string,
): PersistenceResult<void> {
  try {
    const seen = new Set<string>()
    for (const event of events) {
      if (
        seen.has(event.eventId)
        || (
          event.type === 'ExecutionAggregateMutationRecorded'
            ? !persistedAggregateMatches(database, event)
            : !persistedFactMatches(database, event)
        )
      ) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      seen.add(event.eventId)
      const serialized = serializeExecutionDomainEvent(event)
      if (!serialized.ok || !parseExecutionDomainEvent(serialized.value).ok) {
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      const streamKey = event.scope.kind === 'GLOBAL'
        ? event.scope.globalStreamId
        : `portfolio:${event.scope.portfolioId}`
      const head = database.prepare(`
        SELECT stream_sequence, event_hash
        FROM execution_domain_events
        WHERE stream_key = ?
        ORDER BY stream_sequence DESC
        LIMIT 1
      `).get(streamKey) as EventHead | undefined
      const sequence = (head?.stream_sequence ?? 0) + 1
      const previousHash = head?.event_hash ?? GENESIS_HASH
      const eventHash = sha256(
        `${streamKey}|${sequence}|${previousHash}|${serialized.value}`,
      )
      const aggregate = event.type === 'ExecutionAggregateMutationRecorded'
        ? event.payload
        : undefined
      const fact = event.type === 'ExecutionFactInserted' ? event.payload : undefined
      database.prepare(`
        INSERT INTO execution_domain_events (
          event_id, stream_key, stream_sequence, previous_hash, event_hash,
          event_type, event_schema_version, scope_kind, portfolio_id,
          aggregate_state_version, mutation_kind, aggregate_id,
          fact_kind, fact_id, occurred_at, canonical_payload, inserted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        streamKey,
        sequence,
        previousHash,
        eventHash,
        event.type,
        event.schemaVersion,
        event.scope.kind,
        event.scope.kind === 'PORTFOLIO' ? event.scope.portfolioId : null,
        aggregate?.aggregateStateVersion ?? null,
        aggregate === undefined
          ? null
          : `${aggregate.aggregateKind}_${aggregate.operation}`,
        aggregate?.aggregateId ?? null,
        fact?.factKind ?? null,
        fact?.factId ?? null,
        event.occurredAt,
        serialized.value,
        insertedAt,
      )
      database.prepare(`
        INSERT INTO execution_event_dispatch (
          event_id, status, attempt_count, available_at
        ) VALUES (?, 'PENDING', 0, ?)
      `).run(event.eventId, insertedAt)
    }
    return success(undefined)
  } catch {
    return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
  }
}

export function verifyExecutionEventChains(
  database: Database.Database,
): PersistenceResult<Readonly<Record<string, string>>> {
  try {
    const rows = database.prepare(`
      SELECT stream_key, stream_sequence, previous_hash, event_hash, canonical_payload
      FROM execution_domain_events
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
      const sequence = (sequences.get(row.stream_key) ?? 0) + 1
      const previousHash = heads[row.stream_key] ?? GENESIS_HASH
      const expectedHash = sha256(
        `${row.stream_key}|${sequence}|${previousHash}|${row.canonical_payload}`,
      )
      if (
        row.stream_sequence !== sequence
        || row.previous_hash !== previousHash
        || row.event_hash !== expectedHash
      ) {
        return failure(persistenceFailure('AUDIT_CHAIN_BROKEN'))
      }
      sequences.set(row.stream_key, sequence)
      heads[row.stream_key] = row.event_hash
    }
    return success(Object.freeze(heads))
  } catch {
    return failure(persistenceFailure('AUDIT_CHAIN_BROKEN'))
  }
}
