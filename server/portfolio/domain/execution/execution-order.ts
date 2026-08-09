import { domainFailure, type DomainFailureCode } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  CancellationId,
  ExecutionRunId,
  FillId,
  IdempotencyKey,
  InstrumentId,
  OrderId,
  PortfolioId,
  ResidualWorkId,
  SubmissionAttemptId,
} from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { Instant } from '../shared/time.ts'
import {
  type BrokerOrderReference,
  type BrokerSide,
  type DeliveryProduct,
  type NormalizedFill,
  type OrderIntentPayload,
  type OrderState,
  type SubmissionAttempt,
  type SubmissionCertainty,
  U05_MAX_FILLS,
  U05_MAX_PLACEMENT_ATTEMPTS,
} from './contracts.ts'
import type { AccountingDelta } from './fill-accounting.ts'

export type CancellationOutcome = 'ACKNOWLEDGED' | 'REJECTED' | 'UNKNOWN'

export type CancellationAttemptRecord = Readonly<{
  cancellationId: CancellationId
  orderId: OrderId
  idempotencyKey: IdempotencyKey
  requestedBy: string
  reasonCode: string
  requestedAt: Instant
  deadlineAt: Instant
}>

export type CancellationOutcomeRecord = Readonly<{
  cancellationId: CancellationId
  outcome: CancellationOutcome
  completedAt: Instant
  brokerAsOf?: Instant
  failureCode?: DomainFailureCode
}>

export type ExecutionOrderSnapshot = Readonly<{
  orderId: OrderId
  executionRunId: ExecutionRunId
  portfolioId: PortfolioId
  instrumentId: InstrumentId
  side: BrokerSide
  product: DeliveryProduct
  logicalOrderKey: IntegrityHash
  idempotencyKey: IdempotencyKey
  sequence: number
  approvedQuantityCeiling: Quantity
  intent?: OrderIntentPayload
  intentHash?: IntegrityHash
  state: OrderState
  submissionAttempts: readonly SubmissionAttempt[]
  brokerReference?: BrokerOrderReference
  fills: readonly NormalizedFill[]
  filledQuantity: Quantity
  reservedCash?: Money
  reservedDeliveryQuantity?: Quantity
  cancellations: readonly CancellationAttemptRecord[]
  cancellationOutcomes: readonly CancellationOutcomeRecord[]
  residualWorkId?: ResidualWorkId
  failureCode?: DomainFailureCode
  stateVersion: number
}>

const TERMINAL_ORDER_STATES = new Set<OrderState>([
  'RESIDUAL',
  'FILLED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'UNKNOWN',
])

const SUBMITTED_ORDER_STATES = new Set<OrderState>([
  'SUBMISSION_IN_FLIGHT',
  'ACKNOWLEDGED',
  'OPEN',
  'PARTIALLY_FILLED',
  'CANCEL_PENDING',
])

export function isTerminalOrderState(state: OrderState): boolean {
  return TERMINAL_ORDER_STATES.has(state)
}

// UNKNOWN is terminal (blocks further placement) but can be resolved by reconciliation
export function isUnresolvableTerminalState(state: OrderState): boolean {
  return (
    state === 'FILLED'
    || state === 'CANCELLED'
    || state === 'EXPIRED'
    || state === 'REJECTED'
    || state === 'RESIDUAL'
  )
}

export function orderAllowsCancellation(state: OrderState): boolean {
  return (
    state === 'ACKNOWLEDGED'
    || state === 'OPEN'
    || state === 'PARTIALLY_FILLED'
  )
}

export function orderBlocksDependentBuys(state: OrderState): boolean {
  return state === 'UNKNOWN' || state === 'CANCEL_PENDING'
}

type ValidOrderTransition = readonly [OrderState, OrderState]

const VALID_ORDER_TRANSITIONS: ReadonlyArray<ValidOrderTransition> = Object.freeze([
  ['PLANNED', 'INTENT_RECORDED'],
  ['PLANNED', 'RESIDUAL'],
  ['INTENT_RECORDED', 'SUBMISSION_IN_FLIGHT'],
  ['SUBMISSION_IN_FLIGHT', 'ACKNOWLEDGED'],
  ['SUBMISSION_IN_FLIGHT', 'REJECTED'],
  ['SUBMISSION_IN_FLIGHT', 'INTENT_RECORDED'], // DEFINITELY_NOT_SENT retry
  ['SUBMISSION_IN_FLIGHT', 'UNKNOWN'],
  ['ACKNOWLEDGED', 'OPEN'],
  ['ACKNOWLEDGED', 'PARTIALLY_FILLED'],
  ['ACKNOWLEDGED', 'FILLED'],
  ['ACKNOWLEDGED', 'CANCEL_PENDING'],
  ['ACKNOWLEDGED', 'REJECTED'],
  ['ACKNOWLEDGED', 'EXPIRED'],
  ['ACKNOWLEDGED', 'UNKNOWN'],
  ['OPEN', 'PARTIALLY_FILLED'],
  ['OPEN', 'FILLED'],
  ['OPEN', 'CANCEL_PENDING'],
  ['OPEN', 'REJECTED'],
  ['OPEN', 'EXPIRED'],
  ['OPEN', 'UNKNOWN'],
  ['PARTIALLY_FILLED', 'FILLED'],
  ['PARTIALLY_FILLED', 'CANCEL_PENDING'],
  ['PARTIALLY_FILLED', 'REJECTED'],
  ['PARTIALLY_FILLED', 'EXPIRED'],
  ['PARTIALLY_FILLED', 'UNKNOWN'],
  ['CANCEL_PENDING', 'CANCEL_PENDING'], // race fill keeps CANCEL_PENDING
  ['CANCEL_PENDING', 'FILLED'],
  ['CANCEL_PENDING', 'CANCELLED'],
  ['CANCEL_PENDING', 'REJECTED'],
  ['CANCEL_PENDING', 'EXPIRED'],
  ['CANCEL_PENDING', 'UNKNOWN'],
  // UNKNOWN can be resolved to a concrete state by reconciliation
  ['UNKNOWN', 'ACKNOWLEDGED'],
  ['UNKNOWN', 'OPEN'],
  ['UNKNOWN', 'PARTIALLY_FILLED'],
  ['UNKNOWN', 'FILLED'],
  ['UNKNOWN', 'CANCELLED'],
  ['UNKNOWN', 'REJECTED'],
  ['UNKNOWN', 'EXPIRED'],
])

function isValidOrderTransition(from: OrderState, to: OrderState): boolean {
  for (const [f, t] of VALID_ORDER_TRANSITIONS) {
    if (f === from && t === to) return true
  }
  return false
}

function guardOrderTransition(
  snapshot: ExecutionOrderSnapshot,
  targetState: OrderState,
): DomainResult<void> {
  if (isUnresolvableTerminalState(snapshot.state)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!isValidOrderTransition(snapshot.state, targetState)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}

// PLANNED → INTENT_RECORDED (intent finalized and persisted)
export function recordIntent(
  snapshot: ExecutionOrderSnapshot,
  intent: OrderIntentPayload,
  intentHash: IntegrityHash,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (snapshot.state !== 'PLANNED' && snapshot.state !== 'INTENT_RECORDED') {
    return failure(domainFailure('ORDER_INTENT_IMMUTABLE', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (snapshot.state === 'INTENT_RECORDED') {
    if (snapshot.intentHash !== intentHash) {
      return failure(domainFailure('ORDER_IDEMPOTENCY_CONFLICT', {
        field: 'intentHash',
        retryability: 'NEVER',
      }))
    }
    return success(snapshot)
  }
  if (
    intent.portfolioId !== snapshot.portfolioId
    || intent.executionRunId !== snapshot.executionRunId
    || intent.orderId !== snapshot.orderId
    || intent.logicalOrderKey !== snapshot.logicalOrderKey
    || intent.instrumentId !== snapshot.instrumentId
    || intent.side !== snapshot.side
    || intent.product !== 'CNC'
    || intent.orderType !== 'LIMIT'
    || intent.validity !== 'DAY'
    || intent.sequence !== snapshot.sequence
    || intent.quantity.shares <= 0n
    || intent.quantity.shares > snapshot.approvedQuantityCeiling.shares
    || intent.limitPrice.minorUnits <= 0n
  ) {
    return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
      field: 'intent',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    intent,
    intentHash,
    state: 'INTENT_RECORDED' as OrderState,
    stateVersion: nextVersion,
  }))
}

// PLANNED → RESIDUAL (safe buy quantity is zero after affordability)
export function markOrderResidual(
  snapshot: ExecutionOrderSnapshot,
  residualWorkId: ResidualWorkId,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (snapshot.state !== 'PLANNED') {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'RESIDUAL' as OrderState,
    residualWorkId,
    stateVersion: nextVersion,
  }))
}

// INTENT_RECORDED → SUBMISSION_IN_FLIGHT
export function startSubmission(
  snapshot: ExecutionOrderSnapshot,
  attempt: SubmissionAttempt,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  const guard = guardOrderTransition(snapshot, 'SUBMISSION_IN_FLIGHT')
  if (!guard.ok) return guard
  if (snapshot.state !== 'INTENT_RECORDED') {
    return failure(domainFailure('ORDER_INTENT_NOT_PERSISTED', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (attempt.attemptNumber < 1 || attempt.attemptNumber > U05_MAX_PLACEMENT_ATTEMPTS) {
    return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
      field: 'attemptNumber',
      retryability: 'NEVER',
    }))
  }
  const prevAttempts = snapshot.submissionAttempts
  if (prevAttempts.length > 0) {
    const lastAttempt = prevAttempts[prevAttempts.length - 1]!
    if (attempt.attemptNumber !== lastAttempt.attemptNumber + 1) {
      return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
        field: 'attemptNumber',
        retryability: 'NEVER',
      }))
    }
  } else if (attempt.attemptNumber !== 1) {
    return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
      field: 'attemptNumber',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'SUBMISSION_IN_FLIGHT' as OrderState,
    submissionAttempts: Object.freeze([...prevAttempts, attempt]),
    stateVersion: nextVersion,
  }))
}

// SUBMISSION_IN_FLIGHT → ACKNOWLEDGED
export function recordAcknowledged(
  snapshot: ExecutionOrderSnapshot,
  brokerReference: BrokerOrderReference,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  const guard = guardOrderTransition(snapshot, 'ACKNOWLEDGED')
  if (!guard.ok) return guard
  return success(Object.freeze({
    ...snapshot,
    state: 'ACKNOWLEDGED' as OrderState,
    brokerReference,
    stateVersion: nextVersion,
  }))
}

// SUBMISSION_IN_FLIGHT → INTENT_RECORDED (DEFINITELY_NOT_SENT — retry eligible)
export function recordDefinitelyNotSent(
  snapshot: ExecutionOrderSnapshot,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (snapshot.state !== 'SUBMISSION_IN_FLIGHT') {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'INTENT_RECORDED' as OrderState,
    stateVersion: nextVersion,
  }))
}

export function recordRetryExhausted(
  snapshot: ExecutionOrderSnapshot,
  residualWorkId: ResidualWorkId,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (
    snapshot.state !== 'SUBMISSION_IN_FLIGHT'
    || snapshot.submissionAttempts.length !== U05_MAX_PLACEMENT_ATTEMPTS
  ) {
    return failure(domainFailure('ORDER_RETRY_NOT_SAFE', {
      field: 'submissionAttempts',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'RESIDUAL' as OrderState,
    residualWorkId,
    failureCode: 'ORDER_RETRY_NOT_SAFE' as DomainFailureCode,
    stateVersion: nextVersion,
  }))
}

// → UNKNOWN (ambiguous outcome or process crash)
export function recordUnknown(
  snapshot: ExecutionOrderSnapshot,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (!SUBMITTED_ORDER_STATES.has(snapshot.state)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'UNKNOWN' as OrderState,
    stateVersion: nextVersion,
  }))
}

// SUBMISSION_IN_FLIGHT/submitted states → REJECTED (explicit broker rejection)
export function recordRejected(
  snapshot: ExecutionOrderSnapshot,
  failureCode: DomainFailureCode,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  const guard = guardOrderTransition(snapshot, 'REJECTED')
  if (!guard.ok) return guard
  return success(Object.freeze({
    ...snapshot,
    state: 'REJECTED' as OrderState,
    stateVersion: nextVersion,
    failureCode,
  }))
}

// ACKNOWLEDGED → OPEN (broker confirms pending/open)
export function transitionToOpen(
  snapshot: ExecutionOrderSnapshot,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  const guard = guardOrderTransition(snapshot, 'OPEN')
  if (!guard.ok) return guard
  return success(Object.freeze({
    ...snapshot,
    state: 'OPEN' as OrderState,
    stateVersion: nextVersion,
  }))
}

// Apply incremental fill — validates monotone progress and quantity ceiling
export function applyFillProgress(
  snapshot: ExecutionOrderSnapshot,
  fill: NormalizedFill,
  newFilledQuantity: Quantity,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (
    !SUBMITTED_ORDER_STATES.has(snapshot.state)
    && snapshot.state !== 'CANCEL_PENDING'
  ) {
    return failure(domainFailure('ORDER_FILL_PROGRESS_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }

  if (newFilledQuantity.shares < snapshot.filledQuantity.shares) {
    return failure(domainFailure('ORDER_FILL_PROGRESS_INVALID', {
      field: 'filledQuantity',
      retryability: 'NEVER',
    }))
  }

  if (newFilledQuantity.shares > snapshot.approvedQuantityCeiling.shares) {
    return failure(domainFailure('ORDER_FILL_PROGRESS_INVALID', {
      field: 'filledQuantity',
      retryability: 'NEVER',
    }))
  }

  if (snapshot.fills.length >= U05_MAX_FILLS) {
    return failure(domainFailure('ORDER_FILL_PROGRESS_INVALID', {
      field: 'fills',
      retryability: 'NEVER',
    }))
  }
  if (snapshot.intent === undefined) {
    return failure(domainFailure('ORDER_INTENT_NOT_PERSISTED', {
      field: 'intent',
      retryability: 'NEVER',
    }))
  }
  if (newFilledQuantity.shares > snapshot.intent.quantity.shares) {
    return failure(domainFailure('ORDER_FILL_PROGRESS_INVALID', {
      field: 'filledQuantity',
      retryability: 'NEVER',
    }))
  }
  const isComplete = newFilledQuantity.shares === snapshot.intent.quantity.shares
  const nextState: OrderState = isComplete
    ? 'FILLED'
    : snapshot.state === 'CANCEL_PENDING' ? 'CANCEL_PENDING' : 'PARTIALLY_FILLED'
  return success(Object.freeze({
    ...snapshot,
    state: nextState,
    fills: Object.freeze([...snapshot.fills, fill]),
    filledQuantity: newFilledQuantity,
    stateVersion: nextVersion,
  }))
}

export function applyFillReservationRelease(
  snapshot: ExecutionOrderSnapshot,
  delta: AccountingDelta,
): DomainResult<ExecutionOrderSnapshot> {
  if (delta.reservationSide !== snapshot.side) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'reservation',
      retryability: 'NEVER',
    }))
  }
  if (delta.reservationSide === 'BUY') {
    if (snapshot.reservedCash === undefined || !('minorUnits' in delta.reservationReleaseAmount)) {
      return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
        field: 'reservedCash',
        retryability: 'NEVER',
      }))
    }
    const remaining = snapshot.state === 'FILLED'
      ? 0n
      : snapshot.reservedCash.minorUnits - delta.reservationReleaseAmount.minorUnits
    if (remaining < 0n) {
      return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
        field: 'reservedCash',
        retryability: 'NEVER',
      }))
    }
    return success(Object.freeze({
      ...snapshot,
      reservedCash: Object.freeze({
        currency: snapshot.reservedCash.currency,
        minorUnits: remaining,
      }) as Money,
    }))
  }
  if (
    snapshot.reservedDeliveryQuantity === undefined
    || !('shares' in delta.reservationReleaseAmount)
  ) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'reservedDeliveryQuantity',
      retryability: 'NEVER',
    }))
  }
  const remaining = snapshot.state === 'FILLED'
    ? 0n
    : snapshot.reservedDeliveryQuantity.shares - delta.reservationReleaseAmount.shares
  if (remaining < 0n) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'reservedDeliveryQuantity',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    reservedDeliveryQuantity: Object.freeze({ shares: remaining }) as Quantity,
  }))
}

export function clearOrderReservation(
  snapshot: ExecutionOrderSnapshot,
): ExecutionOrderSnapshot {
  const {
    reservedCash: _reservedCash,
    reservedDeliveryQuantity: _reservedDeliveryQuantity,
    ...withoutReservation
  } = snapshot
  return Object.freeze(withoutReservation)
}

// ACKNOWLEDGED | OPEN | PARTIALLY_FILLED → CANCEL_PENDING
export function requestCancellation(
  snapshot: ExecutionOrderSnapshot,
  cancellation: CancellationAttemptRecord,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (!orderAllowsCancellation(snapshot.state)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (
    cancellation.orderId !== snapshot.orderId
    || snapshot.cancellations.some((item) =>
      item.cancellationId === cancellation.cancellationId
      || item.idempotencyKey === cancellation.idempotencyKey)
  ) {
    return failure(domainFailure('MUTATION_IDEMPOTENCY_REQUIRED', {
      field: 'cancellation',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'CANCEL_PENDING' as OrderState,
    cancellations: Object.freeze([...snapshot.cancellations, cancellation]),
    stateVersion: nextVersion,
  }))
}

// CANCEL_PENDING → CANCELLED (broker proves zero open quantity)
export function recordCancelled(
  snapshot: ExecutionOrderSnapshot,
  proof: Readonly<{
    reconciliationState: 'MATCHED' | 'MATCHED_WITH_ROUNDING'
    openQuantity: Quantity
  }>,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (snapshot.state !== 'CANCEL_PENDING' || proof.openQuantity.shares !== 0n) {
    return failure(domainFailure('CANCELLATION_NOT_RECONCILED', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }

  return success(Object.freeze({
    ...snapshot,
    state: 'CANCELLED' as OrderState,
    stateVersion: nextVersion,
  }))
}

export function recordCancellationOutcome(
  snapshot: ExecutionOrderSnapshot,
  outcome: CancellationOutcomeRecord,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (
    !snapshot.cancellations.some((item) => item.cancellationId === outcome.cancellationId)
    || snapshot.cancellationOutcomes.some((item) => item.cancellationId === outcome.cancellationId)
  ) {
    return failure(domainFailure('CANCELLATION_OUTCOME_UNKNOWN', {
      field: 'cancellationOutcome',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    cancellationOutcomes: Object.freeze([...snapshot.cancellationOutcomes, outcome]),
    stateVersion: nextVersion,
  }))
}

// → EXPIRED (broker proves expiry)
export function recordExpired(
  snapshot: ExecutionOrderSnapshot,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  const guard = guardOrderTransition(snapshot, 'EXPIRED')
  if (!guard.ok) return guard
  return success(Object.freeze({
    ...snapshot,
    state: 'EXPIRED' as OrderState,
    stateVersion: nextVersion,
  }))
}

// UNKNOWN → proven state (reconciliation proves the outcome)
export function resolveFromUnknown(
  snapshot: ExecutionOrderSnapshot,
  resolvedState: OrderState,
  nextVersion: number,
): DomainResult<ExecutionOrderSnapshot> {
  if (snapshot.state !== 'UNKNOWN') {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!isValidOrderTransition('UNKNOWN', resolvedState)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'resolvedState',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: resolvedState,
    stateVersion: nextVersion,
  }))
}

// Verify retry is safe (DEFINITELY_NOT_SENT, attempt count, gates must be re-checked externally)
export function requiresRetryEligible(
  snapshot: ExecutionOrderSnapshot,
  certainty: SubmissionCertainty,
): DomainResult<void> {
  if (certainty !== 'DEFINITELY_NOT_SENT') {
    return failure(domainFailure('ORDER_RETRY_NOT_SAFE', {
      field: 'certainty',
      retryability: 'NEVER',
    }))
  }
  if (snapshot.submissionAttempts.length >= U05_MAX_PLACEMENT_ATTEMPTS) {
    return failure(domainFailure('ORDER_RETRY_NOT_SAFE', {
      field: 'submissionAttempts',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}
