import { DOMAIN_EVENT_SCHEMA_VERSION } from '../shared/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parsePortfolioId,
} from '../shared/identifiers.ts'
import { parseMoney, serializeMoney } from '../shared/money.ts'
import { createPortfolioStateVersion } from '../shared/state-version.ts'
import { parseInstant } from '../shared/time.ts'
import { isOperatingMode } from '../portfolio/evidence.ts'
import {
  freezeDomainEvent,
  type DomainEventEnvelope,
  type PortfolioDomainEvent,
} from './domain-events.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidEvent(field: string): DomainResult<never> {
  return failure(domainFailure('INVALID_DOMAIN_EVENT', {
    field,
    retryability: 'NEVER',
  }))
}

function parseEnvelope(value: UnknownRecord): DomainResult<DomainEventEnvelope> {
  const eventId = parseEventId(value.eventId)
  const portfolioId = parsePortfolioId(value.portfolioId)
  const stateVersion = createPortfolioStateVersion(value.stateVersion)
  const occurredAt = parseInstant(value.occurredAt)
  const actorId = parseActorId(value.actorId)
  const commandId = parseCommandId(value.commandId)
  const correlationId = parseCorrelationId(value.correlationId)
  const causationId = parseCausationId(value.causationId)
  if (
    !eventId.ok
    || !portfolioId.ok
    || !stateVersion.ok
    || !occurredAt.ok
    || !actorId.ok
    || !commandId.ok
    || !correlationId.ok
    || !causationId.ok
    || value.schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION
  ) {
    return invalidEvent('envelope')
  }
  return success(Object.freeze({
    eventId: eventId.value,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    portfolioId: portfolioId.value,
    stateVersion: stateVersion.value,
    occurredAt: occurredAt.value,
    actorId: actorId.value,
    commandId: commandId.value,
    correlationId: correlationId.value,
    causationId: causationId.value,
  }))
}

export function serializeDomainEvent(event: PortfolioDomainEvent): string {
  const payload =
    event.type === 'PortfolioCreated'
      ? { ...event.payload, startingCash: serializeMoney(event.payload.startingCash) }
      : event.payload
  return JSON.stringify({ ...event, payload })
}

export function parseDomainEvent(serialized: string): DomainResult<PortfolioDomainEvent> {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return invalidEvent('serializedEvent')
  }
  if (!isRecord(value) || !isRecord(value.payload)) {
    return invalidEvent('event')
  }
  const envelope = parseEnvelope(value)
  if (!envelope.ok) {
    return envelope
  }
  const payload = value.payload

  if (value.type === 'PortfolioCreated') {
    const startingCash = parseMoney(payload.startingCash)
    if (
      typeof payload.displayName !== 'string'
      || payload.baseCurrency !== 'INR'
      || payload.status !== 'ACTIVE'
      || !isOperatingMode(payload.mode)
      || typeof payload.allocationPolicyId !== 'string'
      || !startingCash.ok
    ) {
      return invalidEvent('payload')
    }
    return success(freezeDomainEvent({
      ...envelope.value,
      type: value.type,
      payload: {
        displayName: payload.displayName,
        baseCurrency: payload.baseCurrency,
        startingCash: startingCash.value,
        status: payload.status,
        mode: payload.mode,
        allocationPolicyId: payload.allocationPolicyId,
      },
    }))
  }

  if (value.type === 'PortfolioArchived') {
    const effectiveAt = parseInstant(payload.effectiveAt)
    if (payload.priorStatus !== 'ACTIVE' || payload.status !== 'ARCHIVED' || !effectiveAt.ok) {
      return invalidEvent('payload')
    }
    return success(freezeDomainEvent({
      ...envelope.value,
      type: value.type,
      payload: {
        priorStatus: payload.priorStatus,
        status: payload.status,
        effectiveAt: effectiveAt.value,
      },
    }))
  }

  if (value.type === 'PortfolioModeChanged') {
    if (
      !isOperatingMode(payload.priorMode)
      || !isOperatingMode(payload.mode)
      || !Array.isArray(payload.evidenceIds)
    ) {
      return invalidEvent('payload')
    }
    const evidenceIds = []
    for (const item of payload.evidenceIds) {
      const evidenceId = parseEvidenceId(item)
      if (!evidenceId.ok) {
        return invalidEvent('evidenceIds')
      }
      evidenceIds.push(evidenceId.value)
    }
    return success(freezeDomainEvent({
      ...envelope.value,
      type: value.type,
      payload: {
        priorMode: payload.priorMode,
        mode: payload.mode,
        evidenceIds,
      },
    }))
  }

  if (value.type === 'StrategyAllocationChanged') {
    const effectiveAt = parseInstant(payload.effectiveAt)
    if (
      typeof payload.priorAllocationPolicyId !== 'string'
      || typeof payload.allocationPolicyId !== 'string'
      || !effectiveAt.ok
    ) {
      return invalidEvent('payload')
    }
    return success(freezeDomainEvent({
      ...envelope.value,
      type: value.type,
      payload: {
        priorAllocationPolicyId: payload.priorAllocationPolicyId,
        allocationPolicyId: payload.allocationPolicyId,
        effectiveAt: effectiveAt.value,
      },
    }))
  }

  return invalidEvent('type')
}
