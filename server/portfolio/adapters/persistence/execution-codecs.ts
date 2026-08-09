import type { ApprovalDecisionSnapshot } from '../../domain/execution/approval.ts'
import type { NormalizedFill } from '../../domain/execution/contracts.ts'
import type {
  CancellationAttemptRecord,
  CancellationOutcomeRecord,
  ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import type { KillSwitchSnapshot } from '../../domain/execution/kill-switch.ts'
import type {
  ReconciliationRunSnapshot,
  ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'
import type {
  AdjustmentProposal,
  ResidualWork,
} from '../../domain/execution/residual-and-adjustment.ts'
import { failure, success } from '../../domain/errors/result.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import { canonicalJson } from './codecs.ts'

const EXECUTION_PERSISTENCE_SCHEMA_VERSION = 1
const CANONICAL_INTEGER = /^-?(0|[1-9]\d*)$/
const CANONICAL_NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/

type PersistedExecutionKind =
  | 'APPROVAL'
  | 'EXECUTION_RUN'
  | 'EXECUTION_ORDER'
  | 'RECONCILIATION_RUN'
  | 'RECONCILIATION_SNAPSHOT'
  | 'KILL_SWITCH'
  | 'FILL'
  | 'CANCELLATION_REQUEST'
  | 'CANCELLATION_OUTCOME'
  | 'RESIDUAL_WORK'
  | 'ADJUSTMENT_PROPOSAL'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasString(record: UnknownRecord, key: string): boolean {
  return typeof record[key] === 'string' && record[key].length > 0
}

function hasPositiveInteger(record: UnknownRecord, key: string): boolean {
  return Number.isSafeInteger(record[key]) && Number(record[key]) >= 1
}

function reviveExactValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(reviveExactValues))
  }
  if (!isRecord(value)) return value

  const revived: UnknownRecord = {}
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string'
      && (
        key === 'holdingDelta'
        || key === 'deliveryDelta'
        || key === 'absoluteMinorUnitDifference'
        || key === 'numerator'
      )
      && CANONICAL_INTEGER.test(item)
    ) {
      revived[key] = BigInt(item)
    } else if (
      typeof item === 'string'
      && (
        key === 'minorUnits'
        || key === 'shares'
        || key === 'partsPerMillion'
        || key === 'scale'
      )
      && CANONICAL_NON_NEGATIVE_INTEGER.test(item)
    ) {
      revived[key] = BigInt(item)
    } else {
      revived[key] = reviveExactValues(item)
    }
  }
  return Object.freeze(revived)
}

function encodePayload<T>(kind: PersistedExecutionKind, payload: T): string {
  return canonicalJson({
    kind,
    payload,
    schemaVersion: EXECUTION_PERSISTENCE_SCHEMA_VERSION,
  })
}

function decodePayload<T>(
  serialized: unknown,
  kind: PersistedExecutionKind,
  validate: (value: unknown) => value is T,
): PersistenceResult<T> {
  if (typeof serialized !== 'string') {
    return failure(persistenceFailure('INVALID_PERSISTED_VALUE'))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return failure(persistenceFailure('INVALID_PERSISTED_VALUE'))
  }
  if (
    !isRecord(parsed)
    || parsed.schemaVersion !== EXECUTION_PERSISTENCE_SCHEMA_VERSION
    || parsed.kind !== kind
    || !('payload' in parsed)
    || canonicalJson(parsed) !== serialized
  ) {
    return failure(persistenceFailure('INVALID_PERSISTED_VALUE'))
  }
  const revived = reviveExactValues(parsed.payload)
  if (!validate(revived)) {
    return failure(persistenceFailure('INVALID_PERSISTED_VALUE'))
  }
  return success(revived)
}

function isApproval(value: unknown): value is ApprovalDecisionSnapshot {
  return isRecord(value)
    && hasString(value, 'approvalId')
    && hasString(value, 'portfolioId')
    && hasString(value, 'rebalanceRunId')
    && hasString(value, 'state')
    && hasString(value, 'decisionKind')
    && hasString(value, 'idempotencyKey')
    && hasString(value, 'decisionHash')
    && hasString(value, 'decidedAt')
    && hasPositiveInteger(value, 'stateVersion')
}

function isExecutionRun(value: unknown): value is ExecutionRunSnapshot {
  return isRecord(value)
    && hasString(value, 'executionRunId')
    && hasString(value, 'portfolioId')
    && hasString(value, 'approvalId')
    && hasString(value, 'state')
    && hasString(value, 'mode')
    && hasString(value, 'updatedAt')
    && hasPositiveInteger(value, 'portfolioStateVersion')
    && hasPositiveInteger(value, 'stateVersion')
    && Array.isArray(value.phaseReconciliationIds)
}

function isExecutionOrder(value: unknown): value is ExecutionOrderSnapshot {
  return isRecord(value)
    && hasString(value, 'orderId')
    && hasString(value, 'executionRunId')
    && hasString(value, 'portfolioId')
    && hasString(value, 'instrumentId')
    && hasString(value, 'side')
    && hasString(value, 'state')
    && hasString(value, 'logicalOrderKey')
    && hasString(value, 'idempotencyKey')
    && hasPositiveInteger(value, 'sequence')
    && hasPositiveInteger(value, 'stateVersion')
    && isRecord(value.approvedQuantityCeiling)
    && typeof value.approvedQuantityCeiling.shares === 'bigint'
    && isRecord(value.filledQuantity)
    && typeof value.filledQuantity.shares === 'bigint'
    && Array.isArray(value.submissionAttempts)
    && Array.isArray(value.fills)
    && Array.isArray(value.cancellations)
    && Array.isArray(value.cancellationOutcomes)
}

function isReconciliationRun(value: unknown): value is ReconciliationRunSnapshot {
  return isRecord(value)
    && hasString(value, 'reconciliationRunId')
    && hasString(value, 'portfolioId')
    && hasString(value, 'reason')
    && hasString(value, 'state')
    && hasString(value, 'localSnapshotId')
    && hasString(value, 'startedAt')
    && hasString(value, 'snapshotHash')
    && hasPositiveInteger(value, 'stateVersion')
    && Array.isArray(value.differences)
}

function isReconciliationSnapshot(
  value: unknown,
): value is ReconciliationSnapshotRecord {
  return isRecord(value)
    && hasString(value, 'snapshotId')
    && hasString(value, 'source')
    && hasString(value, 'portfolioId')
    && hasString(value, 'capturedAt')
    && hasString(value, 'contentHash')
    && isRecord(value.cash)
    && typeof value.cash.minorUnits === 'bigint'
    && Array.isArray(value.holdings)
    && Array.isArray(value.openOrders)
    && Array.isArray(value.fills)
    && isRecord(value.endpointTimes)
}

function isKillSwitch(value: unknown): value is KillSwitchSnapshot {
  return isRecord(value)
    && hasString(value, 'killSwitchId')
    && hasString(value, 'state')
    && hasPositiveInteger(value, 'stateVersion')
    && isRecord(value.scope)
    && hasString(value.scope, 'kind')
    && Array.isArray(value.history)
}

function isFill(value: unknown): value is NormalizedFill {
  return isRecord(value)
    && hasString(value, 'fillId')
    && hasString(value, 'portfolioId')
    && hasString(value, 'orderId')
    && hasString(value, 'executionRunId')
    && hasString(value, 'instrumentId')
    && hasString(value, 'side')
    && hasString(value, 'product')
    && hasString(value, 'tradeTime')
    && hasString(value, 'contentHash')
    && isRecord(value.quantity)
    && typeof value.quantity.shares === 'bigint'
    && isRecord(value.price)
    && typeof value.price.minorUnits === 'bigint'
    && isRecord(value.charges)
    && typeof value.charges.minorUnits === 'bigint'
}

function isCancellationRequest(
  value: unknown,
): value is CancellationAttemptRecord {
  return isRecord(value)
    && hasString(value, 'cancellationId')
    && hasString(value, 'orderId')
    && hasString(value, 'idempotencyKey')
    && hasString(value, 'requestedBy')
    && hasString(value, 'reasonCode')
    && hasString(value, 'requestedAt')
    && hasString(value, 'deadlineAt')
}

function isCancellationOutcome(
  value: unknown,
): value is CancellationOutcomeRecord {
  return isRecord(value)
    && hasString(value, 'cancellationId')
    && hasString(value, 'outcome')
    && hasString(value, 'completedAt')
}

function isResidualWork(value: unknown): value is ResidualWork {
  return isRecord(value)
    && hasString(value, 'residualWorkId')
    && hasString(value, 'executionRunId')
    && hasString(value, 'orderId')
    && hasString(value, 'reason')
    && value.requiresReplan === true
    && hasString(value, 'createdAt')
    && isRecord(value.remainingQuantity)
    && typeof value.remainingQuantity.shares === 'bigint'
}

function isAdjustmentProposal(value: unknown): value is AdjustmentProposal {
  return isRecord(value)
    && hasString(value, 'adjustmentProposalId')
    && hasString(value, 'reconciliationRunId')
    && hasString(value, 'state')
    && hasString(value, 'contentHash')
    && hasPositiveInteger(value, 'stateVersion')
    && Array.isArray(value.differences)
    && isRecord(value.proposedAccountingDelta)
}

export const encodeExecutionApproval = (value: ApprovalDecisionSnapshot): string =>
  encodePayload('APPROVAL', value)
export const decodeExecutionApproval = (value: unknown): PersistenceResult<ApprovalDecisionSnapshot> =>
  decodePayload(value, 'APPROVAL', isApproval)

export const encodeExecutionRun = (value: ExecutionRunSnapshot): string =>
  encodePayload('EXECUTION_RUN', value)
export const decodeExecutionRun = (value: unknown): PersistenceResult<ExecutionRunSnapshot> =>
  decodePayload(value, 'EXECUTION_RUN', isExecutionRun)

export const encodeExecutionOrder = (value: ExecutionOrderSnapshot): string =>
  encodePayload('EXECUTION_ORDER', value)
export const decodeExecutionOrder = (value: unknown): PersistenceResult<ExecutionOrderSnapshot> =>
  decodePayload(value, 'EXECUTION_ORDER', isExecutionOrder)

export const encodeReconciliationRun = (value: ReconciliationRunSnapshot): string =>
  encodePayload('RECONCILIATION_RUN', value)
export const decodeReconciliationRun = (value: unknown): PersistenceResult<ReconciliationRunSnapshot> =>
  decodePayload(value, 'RECONCILIATION_RUN', isReconciliationRun)

export const encodeReconciliationSnapshot = (value: ReconciliationSnapshotRecord): string =>
  encodePayload('RECONCILIATION_SNAPSHOT', value)
export const decodeReconciliationSnapshot = (
  value: unknown,
): PersistenceResult<ReconciliationSnapshotRecord> =>
  decodePayload(value, 'RECONCILIATION_SNAPSHOT', isReconciliationSnapshot)

export const encodeKillSwitch = (value: KillSwitchSnapshot): string =>
  encodePayload('KILL_SWITCH', value)
export const decodeKillSwitch = (value: unknown): PersistenceResult<KillSwitchSnapshot> =>
  decodePayload(value, 'KILL_SWITCH', isKillSwitch)

export const encodeExecutionFill = (value: NormalizedFill): string =>
  encodePayload('FILL', value)
export const decodeExecutionFill = (value: unknown): PersistenceResult<NormalizedFill> =>
  decodePayload(value, 'FILL', isFill)

export const encodeCancellationRequest = (value: CancellationAttemptRecord): string =>
  encodePayload('CANCELLATION_REQUEST', value)
export const decodeCancellationRequest = (
  value: unknown,
): PersistenceResult<CancellationAttemptRecord> =>
  decodePayload(value, 'CANCELLATION_REQUEST', isCancellationRequest)

export const encodeCancellationOutcome = (value: CancellationOutcomeRecord): string =>
  encodePayload('CANCELLATION_OUTCOME', value)
export const decodeCancellationOutcome = (
  value: unknown,
): PersistenceResult<CancellationOutcomeRecord> =>
  decodePayload(value, 'CANCELLATION_OUTCOME', isCancellationOutcome)

export const encodeResidualWork = (value: ResidualWork): string =>
  encodePayload('RESIDUAL_WORK', value)
export const decodeResidualWork = (value: unknown): PersistenceResult<ResidualWork> =>
  decodePayload(value, 'RESIDUAL_WORK', isResidualWork)

export const encodeAdjustmentProposal = (value: AdjustmentProposal): string =>
  encodePayload('ADJUSTMENT_PROPOSAL', value)
export const decodeAdjustmentProposal = (
  value: unknown,
): PersistenceResult<AdjustmentProposal> =>
  decodePayload(value, 'ADJUSTMENT_PROPOSAL', isAdjustmentProposal)
