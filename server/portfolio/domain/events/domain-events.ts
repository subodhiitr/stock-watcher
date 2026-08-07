import { DOMAIN_EVENT_SCHEMA_VERSION, type InrCurrency } from '../shared/constants.ts'
import type {
  ActorId,
  CausationId,
  CommandId,
  CorrelationId,
  EventId,
  EvidenceId,
  PortfolioId,
} from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import type { Instant } from '../shared/time.ts'
import type { OperatingMode } from '../portfolio/evidence.ts'
import type { PortfolioStatus } from '../portfolio/integrity.ts'

export type DomainEventEnvelope = Readonly<{
  eventId: EventId
  schemaVersion: typeof DOMAIN_EVENT_SCHEMA_VERSION
  portfolioId: PortfolioId
  stateVersion: PortfolioStateVersion
  occurredAt: Instant
  actorId: ActorId
  commandId: CommandId
  correlationId: CorrelationId
  causationId: CausationId
}>

export type PortfolioCreated = DomainEventEnvelope & Readonly<{
  type: 'PortfolioCreated'
  payload: Readonly<{
    displayName: string
    baseCurrency: InrCurrency
    startingCash: Money
    status: 'ACTIVE'
    mode: OperatingMode
    allocationPolicyId: string
  }>
}>

export type PortfolioArchived = DomainEventEnvelope & Readonly<{
  type: 'PortfolioArchived'
  payload: Readonly<{
    priorStatus: 'ACTIVE'
    status: 'ARCHIVED'
    effectiveAt: Instant
  }>
}>

export type PortfolioModeChanged = DomainEventEnvelope & Readonly<{
  type: 'PortfolioModeChanged'
  payload: Readonly<{
    priorMode: OperatingMode
    mode: OperatingMode
    evidenceIds: readonly EvidenceId[]
  }>
}>

export type StrategyAllocationChanged = DomainEventEnvelope & Readonly<{
  type: 'StrategyAllocationChanged'
  payload: Readonly<{
    priorAllocationPolicyId: string
    allocationPolicyId: string
    effectiveAt: Instant
  }>
}>

export type PortfolioDomainEvent =
  | PortfolioCreated
  | PortfolioArchived
  | PortfolioModeChanged
  | StrategyAllocationChanged

export type PortfolioDomainEventType = PortfolioDomainEvent['type']

export function freezeDomainEvent<T extends PortfolioDomainEvent>(event: T): T {
  const payload =
    event.type === 'PortfolioModeChanged'
      ? Object.freeze({
          ...event.payload,
          evidenceIds: Object.freeze([...event.payload.evidenceIds]),
        })
      : Object.freeze({ ...event.payload })
  return Object.freeze({ ...event, payload }) as T
}

export function hasValidEventAggregateBinding(
  event: PortfolioDomainEvent,
  portfolioId: PortfolioId,
  stateVersion: PortfolioStateVersion,
): boolean {
  return (
    event.portfolioId === portfolioId
    && event.stateVersion === stateVersion
    && event.schemaVersion === DOMAIN_EVENT_SCHEMA_VERSION
  )
}

export function isPortfolioStatus(value: unknown): value is PortfolioStatus {
  return value === 'ACTIVE' || value === 'ARCHIVED'
}
