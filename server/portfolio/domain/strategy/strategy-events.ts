import type { ActorId, BacktestRunId, CorrelationId, DataVersionId, EventId, StrategyVersionEventId, StrategyVersionId } from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'

export type StrategyEventEnvelope = Readonly<{
  eventId: StrategyVersionEventId
  schemaVersion: 1
  strategyVersionId: StrategyVersionId
  actorId: ActorId
  occurredAt: Instant
  correlationId: CorrelationId
}>

export type StrategyVersionCreated = StrategyEventEnvelope & Readonly<{
  type: 'StrategyVersionCreated'
  payload: Readonly<{
    strategyId: string
    versionLabel: string
    configHash: string
    createdBy: ActorId
    isPreset: boolean
  }>
}>

export type StrategyVersionSubmittedForActivation = StrategyEventEnvelope & Readonly<{
  type: 'StrategyVersionSubmittedForActivation'
  payload: Readonly<{
    evidenceRefs: readonly string[]
    submittedBy: ActorId
  }>
}>

export type StrategyVersionActivated = StrategyEventEnvelope & Readonly<{
  type: 'StrategyVersionActivated'
  payload: Readonly<{
    configHash: string
    evidenceRefs: readonly string[]
    approvedBy: ActorId
    activatedAt: Instant
  }>
}>

export type StrategyVersionSuperseded = StrategyEventEnvelope & Readonly<{
  type: 'StrategyVersionSuperseded'
  payload: Readonly<{
    supersededByVersionId: StrategyVersionId
    supersededAt: Instant
  }>
}>

export type StrategyVersionWithdrawn = StrategyEventEnvelope & Readonly<{
  type: 'StrategyVersionWithdrawn'
  payload: Readonly<{
    withdrawalReason: string
    withdrawnBy: ActorId
  }>
}>

export type AiAdvisoryAuditEvent = StrategyEventEnvelope & Readonly<{
  type: 'AiAdvisoryAuditEvent'
  payload: Readonly<{
    requestId: EventId
    permittedOperation: string
    producedAt: Instant
    modelIdHash: string
    outputHash: string
  }>
}>

export type ProviderErrorEvent = StrategyEventEnvelope & Readonly<{
  type: 'ProviderErrorEvent'
  payload: Readonly<{
    providerIdentity: string
    correlationId: CorrelationId
    attemptCount: number
    errorCode: string
    circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  }>
}>

export type StrategyDomainEvent =
  | StrategyVersionCreated
  | StrategyVersionSubmittedForActivation
  | StrategyVersionActivated
  | StrategyVersionSuperseded
  | StrategyVersionWithdrawn
  | AiAdvisoryAuditEvent
  | ProviderErrorEvent

export type StrategyDomainEventType = StrategyDomainEvent['type']

export function freezeStrategyEvent<T extends StrategyDomainEvent>(event: T): T {
  return Object.freeze({ ...event, payload: Object.freeze(event.payload) }) as T
}
