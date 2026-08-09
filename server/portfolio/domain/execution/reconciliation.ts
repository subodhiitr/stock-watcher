import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  BrokerAccountBindingId,
  InstrumentId,
  OrderId,
  PortfolioId,
  ReconciliationRunId,
  ReconciliationSnapshotId,
  ResidualWorkId,
} from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { Instant, LocalDate } from '../shared/time.ts'
import {
  type BrokerOrderSnapshot,
  type BrokerOrderStatus,
  type NormalizedFill,
  type ReconciliationReason,
  type ReconciliationState,
  U05_MAX_RECONCILIATION_SKEW_MS,
} from './contracts.ts'

export type DifferenceKind =
  | 'EXTERNAL_CHANGE'
  | 'LOCAL_MISSING_FILL'
  | 'BROKER_MISSING_ORDER'
  | 'VALUE_MISMATCH'
  | 'UNKNOWN_ORDER'
  | 'MAPPING_BLOCKED'
  | 'CASH_ROUNDING'

export type DifferenceSeverity = 'INFO' | 'BLOCKING' | 'CRITICAL'

export type DifferenceResolution =
  | 'NONE'
  | 'APPLY_KNOWN_FILL'
  | 'REQUIRES_ADJUSTMENT_APPROVAL'

export type ReconciliationDifference = Readonly<{
  differenceId: IntegrityHash
  kind: DifferenceKind
  severity: DifferenceSeverity
  instrumentId?: InstrumentId
  orderId?: OrderId
  expected: string
  actual: string
  resolution: DifferenceResolution
  absoluteMinorUnitDifference?: bigint
  roundingEvidenceHash?: IntegrityHash
}>

export type ReconciledHolding = Readonly<{
  instrumentId: InstrumentId
  totalQuantity: Quantity
  availableDeliveryQuantity: Quantity
  reservedQuantity: Quantity
  averageCost?: Money
  mappingHash: IntegrityHash
}>

export type ReconciliationSnapshotRecord = Readonly<{
  snapshotId: ReconciliationSnapshotId
  source: 'LOCAL' | 'PAPER' | 'ZERODHA' | 'SHAREKHAN'
  portfolioId: PortfolioId
  accountBindingId?: BrokerAccountBindingId
  cash: Money
  holdings: readonly ReconciledHolding[]
  openOrders: readonly BrokerOrderSnapshot[]
  fills: readonly NormalizedFill[]
  endpointTimes: Readonly<Record<string, Instant>>
  cursor?: string
  capturedAt: Instant
  contentHash: IntegrityHash
}>

export type ReconciliationRunSnapshot = Readonly<{
  reconciliationRunId: ReconciliationRunId
  portfolioId: PortfolioId
  reason: ReconciliationReason
  state: ReconciliationState
  localSnapshotId: ReconciliationSnapshotId
  externalSnapshotId?: ReconciliationSnapshotId
  differences: readonly ReconciliationDifference[]
  startedAt: Instant
  completedAt?: Instant
  priorRunId?: ReconciliationRunId
  snapshotHash: IntegrityHash
  stateVersion: number
}>

const TERMINAL_RECONCILIATION_STATES = new Set<ReconciliationState>([
  'MATCHED',
  'MATCHED_WITH_ROUNDING',
  'MISMATCH',
  'UNKNOWN',
  'BLOCKED',
])

const VALID_RECONCILIATION_TRANSITIONS: ReadonlyArray<
  readonly [ReconciliationState, ReconciliationState]
> = Object.freeze([
  ['REQUESTED', 'COLLECTING'],
  ['COLLECTING', 'COMPARING'],
  ['COMPARING', 'MATCHED'],
  ['COMPARING', 'MATCHED_WITH_ROUNDING'],
  ['COMPARING', 'MISMATCH'],
  ['COMPARING', 'UNKNOWN'],
  ['COMPARING', 'BLOCKED'],
  // COLLECTING can go to BLOCKED if snapshot collection fails
  ['COLLECTING', 'BLOCKED'],
  // REQUESTED can go to BLOCKED if pre-condition fails
  ['REQUESTED', 'BLOCKED'],
])

function isValidReconciliationTransition(
  from: ReconciliationState,
  to: ReconciliationState,
): boolean {
  for (const [f, t] of VALID_RECONCILIATION_TRANSITIONS) {
    if (f === from && t === to) return true
  }
  return false
}

export function isTerminalReconciliationState(state: ReconciliationState): boolean {
  return TERMINAL_RECONCILIATION_STATES.has(state)
}

export function isReconciliationMatched(state: ReconciliationState): boolean {
  return state === 'MATCHED' || state === 'MATCHED_WITH_ROUNDING'
}

export function transitionReconciliationState(
  snapshot: ReconciliationRunSnapshot,
  targetState: ReconciliationState,
  nextVersion: number,
  completedAt?: Instant,
  differences?: readonly ReconciliationDifference[],
  externalSnapshotId?: ReconciliationSnapshotId,
): DomainResult<ReconciliationRunSnapshot> {
  if (isTerminalReconciliationState(snapshot.state)) {
    return failure(domainFailure('RECONCILIATION_HISTORY_MUTATION', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!isValidReconciliationTransition(snapshot.state, targetState)) {
    return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: targetState,
    differences: differences !== undefined
      ? Object.freeze([...differences])
      : snapshot.differences,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(externalSnapshotId !== undefined ? { externalSnapshotId } : {}),
    stateVersion: nextVersion,
  }))
}

// Check whether reconciliation gate allows dependent execution
export function reconciliationAllowsDependentExecution(
  snapshot: ReconciliationRunSnapshot,
  now: Instant,
  maxAgeMs: number,
): DomainResult<void> {
  if (!isReconciliationMatched(snapshot.state)) {
    return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
      field: 'state',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!snapshot.completedAt) {
    return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
      field: 'completedAt',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const completedMs = Date.parse(snapshot.completedAt)
  const nowMs = Date.parse(now)
  if (nowMs - completedMs > maxAgeMs) {
    return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
      field: 'completedAt',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  // No unknown orders must remain
  for (const diff of snapshot.differences) {
    if (diff.kind === 'UNKNOWN_ORDER') {
      return failure(domainFailure('RECONCILIATION_BLOCKS_DEPENDENCY', {
        field: 'differences',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
  }
  return success(undefined)
}

// Verify snapshot coherence: endpoints must be within allowed skew
export function verifySnapshotCoherence(
  endpointTimes: Readonly<Record<string, Instant>>,
  coherentCursor?: string,
): DomainResult<void> {
  if (coherentCursor !== undefined && coherentCursor.length > 0 && coherentCursor.length <= 256) {
    return success(undefined)
  }
  const times = Object.values(endpointTimes).map(t => Date.parse(t))
  if (times.length === 0) return success(undefined)
  const min = Math.min(...times)
  const max = Math.max(...times)
  if (max - min > U05_MAX_RECONCILIATION_SKEW_MS) {
    return failure(domainFailure('BROKER_SNAPSHOT_INCOHERENT', {
      field: 'endpointTimes',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// Determine difference severity from kind (deterministic)
export function differenceSeverityFor(kind: DifferenceKind): DifferenceSeverity {
  switch (kind) {
    case 'CASH_ROUNDING': return 'INFO'
    case 'LOCAL_MISSING_FILL': return 'BLOCKING'
    case 'EXTERNAL_CHANGE': return 'CRITICAL'
    case 'VALUE_MISMATCH': return 'CRITICAL'
    case 'UNKNOWN_ORDER': return 'BLOCKING'
    case 'BROKER_MISSING_ORDER': return 'BLOCKING'
    case 'MAPPING_BLOCKED': return 'BLOCKING'
    default: {
      const _exhaustive: never = kind
      return 'CRITICAL'
    }
  }
}

// Determine resolution from kind (deterministic, conservative)
export function differenceResolutionFor(kind: DifferenceKind): DifferenceResolution {
  switch (kind) {
    case 'LOCAL_MISSING_FILL': return 'APPLY_KNOWN_FILL'
    case 'CASH_ROUNDING': return 'NONE'
    case 'EXTERNAL_CHANGE': return 'REQUIRES_ADJUSTMENT_APPROVAL'
    case 'VALUE_MISMATCH': return 'REQUIRES_ADJUSTMENT_APPROVAL'
    case 'UNKNOWN_ORDER': return 'NONE'
    case 'BROKER_MISSING_ORDER': return 'NONE'
    case 'MAPPING_BLOCKED': return 'NONE'
    default: {
      const _exhaustive: never = kind
      return 'NONE'
    }
  }
}

// Pure comparison result: determine overall reconciliation state from differences
export function deriveReconciliationResult(
  differences: readonly ReconciliationDifference[],
): ReconciliationState {
  if (differences.length === 0) return 'MATCHED'
  let hasUnknown = false
  let hasBlocking = false
  for (const diff of differences) {
    if (diff.kind === 'MAPPING_BLOCKED') return 'BLOCKED'
    if (diff.kind === 'UNKNOWN_ORDER') hasUnknown = true
    if (diff.severity === 'BLOCKING' || diff.severity === 'CRITICAL') hasBlocking = true
    if (diff.kind === 'CASH_ROUNDING') {
      // Only cash rounding — will be MATCHED_WITH_ROUNDING if sole difference
    }
  }
  if (hasUnknown) return 'UNKNOWN'
  if (hasBlocking) return 'MISMATCH'
  const allRounding = differences.every((difference) =>
    difference.kind === 'CASH_ROUNDING'
    && difference.absoluteMinorUnitDifference !== undefined
    && difference.absoluteMinorUnitDifference <= 1n
    && difference.roundingEvidenceHash !== undefined)
  if (allRounding) return 'MATCHED_WITH_ROUNDING'
  return 'MISMATCH'
}
