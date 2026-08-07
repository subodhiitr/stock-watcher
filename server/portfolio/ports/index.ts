import type {
  AnyDomainFailure,
  DomainResult,
} from '../domain/errors/result.ts'
import type { PortfolioDomainEvent } from '../domain/events/domain-events.ts'
import type {
  ActorId,
  AllocationId,
  CausationId,
  CommandId,
  CorrelationId,
  EventId,
  EvidenceId,
  HoldingId,
  HoldingLotId,
  IdempotencyKey,
  InstrumentId,
  OrderId,
  PortfolioId,
  RebalanceRunId,
  StrategyAssignmentId,
  StrategyId,
  StrategySleeveId,
  StrategyVersionId,
} from '../domain/shared/identifiers.ts'
import type { PortfolioStateVersion } from '../domain/shared/state-version.ts'
import type { Instant, LocalDate } from '../domain/shared/time.ts'
import type { Portfolio } from '../domain/portfolio/portfolio.ts'
import type { StrategyEligibilityEvidence } from '../domain/portfolio/evidence.ts'

export type CommittedDomainResult<T> = Readonly<{
  value: T
  postCommitEvents: readonly PortfolioDomainEvent[]
}>

export interface PortfolioRepository {
  insert(portfolio: Portfolio): DomainResult<void, AnyDomainFailure>
  getById(portfolioId: PortfolioId): DomainResult<Portfolio | undefined, AnyDomainFailure>
  save(
    portfolio: Portfolio,
    expectedStateVersion: PortfolioStateVersion,
  ): DomainResult<void, AnyDomainFailure>
  activeNameExists(normalizedNameKey: string): DomainResult<boolean, AnyDomainFailure>
}

export interface PortfolioTransaction {
  portfolios: PortfolioRepository
  appendDomainEvents(
    events: readonly PortfolioDomainEvent[],
  ): DomainResult<void, AnyDomainFailure>
}

export interface PortfolioUnitOfWork {
  execute<T>(
    work: (transaction: PortfolioTransaction) => DomainResult<T, AnyDomainFailure>,
  ): DomainResult<CommittedDomainResult<T>, AnyDomainFailure>
}

export interface ClockPort {
  now(): Instant
  today(): LocalDate
}

export interface IdentifierFactory {
  portfolioId(): PortfolioId
  holdingId(): HoldingId
  holdingLotId(): HoldingLotId
  instrumentId(): InstrumentId
  strategyId(): StrategyId
  strategyVersionId(): StrategyVersionId
  strategyAssignmentId(): StrategyAssignmentId
  strategySleeveId(): StrategySleeveId
  allocationId(): AllocationId
  rebalanceRunId(): RebalanceRunId
  orderId(): OrderId
  actorId(): ActorId
  commandId(): CommandId
  eventId(): EventId
  correlationId(): CorrelationId
  causationId(): CausationId
  idempotencyKey(): IdempotencyKey
  evidenceId(): EvidenceId
}

export interface StrategyEvidencePort {
  resolveEligibility(
    portfolioId: PortfolioId,
    strategyVersionId: StrategyVersionId,
    effectiveAt: Instant,
  ): Promise<DomainResult<StrategyEligibilityEvidence>>
}

export type CommittedEventHandler<Event extends PortfolioDomainEvent> = (
  event: Event,
) => Promise<DomainResult<void>>

export interface InternalEventBus {
  publish(events: readonly PortfolioDomainEvent[]): Promise<DomainResult<void>>
  subscribe<Event extends PortfolioDomainEvent>(
    eventType: Event['type'],
    handler: CommittedEventHandler<Event>,
  ): () => void
}
