import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  AdjustmentProposalId,
  EvidenceId,
  ExecutionRunId,
  OrderId,
  ReconciliationRunId,
  ResidualWorkId,
} from '../shared/identifiers.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { Instant } from '../shared/time.ts'
import type { ReconciliationDifference } from './reconciliation.ts'
import type { AccountingDelta } from './fill-accounting.ts'

export type ResidualWorkReason =
  | 'PARTIAL_FILL'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PRICE_STALE'
  | 'CASH_REDUCED'
  | 'RECOVERY_REQUIRED'

export type ResidualWork = Readonly<{
  residualWorkId: ResidualWorkId
  executionRunId: ExecutionRunId
  orderId: OrderId
  remainingQuantity: Quantity
  reason: ResidualWorkReason
  requiresReplan: true
  createdAt: Instant
}>

export type AdjustmentProposalState =
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLIED'

export type AdjustmentProposal = Readonly<{
  adjustmentProposalId: AdjustmentProposalId
  reconciliationRunId: ReconciliationRunId
  differences: readonly IntegrityHash[]
  proposedAccountingDelta: AccountingDelta
  authorizationEvidenceId?: EvidenceId
  state: AdjustmentProposalState
  contentHash: IntegrityHash
  stateVersion: number
}>

const RESIDUAL_WORK_REASONS = new Set<ResidualWorkReason>([
  'PARTIAL_FILL',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'PRICE_STALE',
  'CASH_REDUCED',
  'RECOVERY_REQUIRED',
])

export function createResidualWork(
  residualWorkId: ResidualWorkId,
  executionRunId: ExecutionRunId,
  orderId: OrderId,
  remainingQuantity: Quantity,
  reason: ResidualWorkReason,
  createdAt: Instant,
): DomainResult<ResidualWork> {
  if (!RESIDUAL_WORK_REASONS.has(reason)) {
    return failure(domainFailure('RESIDUAL_WORK_NOT_RECORDED', {
      field: 'reason',
      retryability: 'NEVER',
    }))
  }
  if (remainingQuantity.shares <= 0n) {
    return failure(domainFailure('RESIDUAL_WORK_NOT_RECORDED', {
      field: 'remainingQuantity',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    residualWorkId,
    executionRunId,
    orderId,
    remainingQuantity,
    reason,
    requiresReplan: true as const,
    createdAt,
  }))
}

export function createAdjustmentProposal(
  adjustmentProposalId: AdjustmentProposalId,
  reconciliationRunId: ReconciliationRunId,
  differences: readonly IntegrityHash[],
  proposedAccountingDelta: AccountingDelta,
  contentHash: IntegrityHash,
): DomainResult<AdjustmentProposal> {
  if (differences.length === 0) {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'differences',
      retryability: 'NEVER',
    }))
  }
  const diffSet = new Set(differences)
  if (diffSet.size !== differences.length) {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'differences',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    adjustmentProposalId,
    reconciliationRunId,
    differences: Object.freeze([...differences]),
    proposedAccountingDelta,
    state: 'PROPOSED' as AdjustmentProposalState,
    contentHash,
    stateVersion: 1,
  }))
}

// PROPOSED → APPROVED
export function approveAdjustment(
  proposal: AdjustmentProposal,
  authorizationEvidenceId: EvidenceId,
  nextVersion: number,
): DomainResult<AdjustmentProposal> {
  if (proposal.state !== 'PROPOSED') {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...proposal,
    state: 'APPROVED' as AdjustmentProposalState,
    authorizationEvidenceId,
    stateVersion: nextVersion,
  }))
}

// PROPOSED → REJECTED
export function rejectAdjustment(
  proposal: AdjustmentProposal,
  nextVersion: number,
): DomainResult<AdjustmentProposal> {
  if (proposal.state !== 'PROPOSED') {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...proposal,
    state: 'REJECTED' as AdjustmentProposalState,
    stateVersion: nextVersion,
  }))
}

// APPROVED → APPLIED (authorized accounting adjustment applied)
export function applyAdjustment(
  proposal: AdjustmentProposal,
  nextVersion: number,
): DomainResult<AdjustmentProposal> {
  if (proposal.state !== 'APPROVED') {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!proposal.authorizationEvidenceId) {
    return failure(domainFailure('EXTERNAL_CHANGE_REQUIRES_REVIEW', {
      field: 'authorizationEvidenceId',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...proposal,
    state: 'APPLIED' as AdjustmentProposalState,
    stateVersion: nextVersion,
  }))
}
