import { canonicalExecutionJson } from '../execution/canonical-codec.ts'
import {
  isKnownEvidenceKind,
  type ExecutionEvidencePayload,
} from '../execution/evidence.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { parseEventId, parsePortfolioId } from '../shared/identifiers.ts'
import { parseInstant } from '../shared/time.ts'
import {
  EXECUTION_EVENT_SCHEMA_VERSION,
  freezeExecutionDomainEvent,
  type ExecutionDomainEvent,
  type ExecutionEventAggregateKind,
  type ExecutionEventFactKind,
  type ExecutionEventScope,
} from './execution-events.ts'

type UnknownRecord = Record<string, unknown>

const AGGREGATE_KINDS = new Set<ExecutionEventAggregateKind>([
  'PORTFOLIO',
  'APPROVAL',
  'EXECUTION_RUN',
  'EXECUTION_ORDER',
  'RECONCILIATION_RUN',
  'KILL_SWITCH',
  'ADJUSTMENT_PROPOSAL',
])

const FACT_KINDS = new Set<ExecutionEventFactKind>([
  'RECONCILIATION_SNAPSHOT',
  'FILL',
  'CANCELLATION_REQUEST',
  'CANCELLATION_OUTCOME',
  'RESIDUAL_WORK',
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(field: string): DomainResult<never> {
  return failure(domainFailure('INVALID_DOMAIN_EVENT', {
    field,
    retryability: 'NEVER',
  }))
}

function parseScope(value: unknown): DomainResult<ExecutionEventScope> {
  if (!isRecord(value)) return invalid('scope')
  if (
    value.kind === 'GLOBAL'
    && value.globalStreamId === 'GLOBAL_EXECUTION_CONTROL'
    && Object.keys(value).length === 2
  ) {
    return success(Object.freeze({
      kind: value.kind,
      globalStreamId: value.globalStreamId,
    }))
  }
  if (value.kind === 'PORTFOLIO' && Object.keys(value).length === 2) {
    const portfolioId = parsePortfolioId(value.portfolioId)
    if (portfolioId.ok) {
      return success(Object.freeze({ kind: value.kind, portfolioId: portfolioId.value }))
    }
  }
  return invalid('scope')
}

function isEvidence(value: unknown): value is ExecutionEvidencePayload {
  return isRecord(value)
    && typeof value.kind === 'string'
    && isKnownEvidenceKind(value.kind)
    && typeof value.occurredAt === 'string'
    && parseInstant(value.occurredAt).ok
}

export function serializeExecutionDomainEvent(
  event: ExecutionDomainEvent,
): DomainResult<string> {
  return canonicalExecutionJson(event)
}

export function parseExecutionDomainEvent(
  serialized: string,
): DomainResult<ExecutionDomainEvent> {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return invalid('serializedEvent')
  }
  if (!isRecord(value) || !isRecord(value.payload)) return invalid('event')
  const canonical = canonicalExecutionJson(value)
  const eventId = parseEventId(value.eventId)
  const scope = parseScope(value.scope)
  const occurredAt = parseInstant(value.occurredAt)
  if (
    !canonical.ok
    || canonical.value !== serialized
    || !eventId.ok
    || !scope.ok
    || !occurredAt.ok
    || value.schemaVersion !== EXECUTION_EVENT_SCHEMA_VERSION
    || !isEvidence(value.payload.evidence)
  ) {
    return invalid('envelope')
  }

  if (
    value.type === 'ExecutionAggregateMutationRecorded'
    && (value.payload.operation === 'INSERT' || value.payload.operation === 'SAVE')
    && typeof value.payload.aggregateKind === 'string'
    && AGGREGATE_KINDS.has(value.payload.aggregateKind as ExecutionEventAggregateKind)
    && typeof value.payload.aggregateId === 'string'
    && value.payload.aggregateId.length > 0
    && Number.isSafeInteger(value.payload.aggregateStateVersion)
    && Number(value.payload.aggregateStateVersion) >= 1
  ) {
    return success(freezeExecutionDomainEvent({
      eventId: eventId.value,
      schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
      scope: scope.value,
      occurredAt: occurredAt.value,
      type: value.type,
      payload: {
        operation: value.payload.operation,
        aggregateKind: value.payload.aggregateKind as ExecutionEventAggregateKind,
        aggregateId: value.payload.aggregateId,
        aggregateStateVersion: Number(value.payload.aggregateStateVersion),
        evidence: value.payload.evidence,
      },
    }))
  }

  if (
    value.type === 'ExecutionFactInserted'
    && typeof value.payload.factKind === 'string'
    && FACT_KINDS.has(value.payload.factKind as ExecutionEventFactKind)
    && typeof value.payload.factId === 'string'
    && value.payload.factId.length > 0
  ) {
    return success(freezeExecutionDomainEvent({
      eventId: eventId.value,
      schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
      scope: scope.value,
      occurredAt: occurredAt.value,
      type: value.type,
      payload: {
        factKind: value.payload.factKind as ExecutionEventFactKind,
        factId: value.payload.factId,
        evidence: value.payload.evidence,
      },
    }))
  }

  return invalid('type')
}
