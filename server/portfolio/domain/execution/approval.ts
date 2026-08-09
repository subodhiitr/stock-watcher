import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  ActorId,
  ApprovalId,
  EvidenceId,
  IdempotencyKey,
  PortfolioId,
  RebalanceRunId,
  ExecutionRunId,
} from '../shared/identifiers.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import type { Instant } from '../shared/time.ts'
import {
  type ApprovalBinding,
  type ApprovalState,
} from './contracts.ts'

export type DecisionKind = 'APPROVE_BASKET' | 'APPROVE_SUBSET' | 'REJECT'

export type ApprovalDecisionSnapshot = Readonly<{
  approvalId: ApprovalId
  portfolioId: PortfolioId
  rebalanceRunId: RebalanceRunId
  state: ApprovalState
  decisionKind: DecisionKind
  binding?: ApprovalBinding
  reasonCode?: string
  decidedBy: ActorId
  authorizationEvidenceId: EvidenceId
  mfaEvidenceId?: EvidenceId
  idempotencyKey: IdempotencyKey
  decisionHash: IntegrityHash
  decidedAt: Instant
  stateVersion: number
  consumedByExecutionRunId?: ExecutionRunId
}>

const TERMINAL_APPROVAL_STATES = new Set<ApprovalState>([
  'REJECTED',
  'INVALIDATED',
  'EXPIRED',
  'CONSUMED',
])

const ACTIVE_APPROVAL_STATES = new Set<ApprovalState>([
  'APPROVED',
  'PARTIALLY_APPROVED',
])

export function isTerminalApprovalState(state: ApprovalState): boolean {
  return TERMINAL_APPROVAL_STATES.has(state)
}

export function isActiveApprovalState(state: ApprovalState): boolean {
  return ACTIVE_APPROVAL_STATES.has(state)
}

export function isApprovalConsumable(snapshot: ApprovalDecisionSnapshot): boolean {
  return isActiveApprovalState(snapshot.state)
}

export function isApprovalExpired(
  snapshot: ApprovalDecisionSnapshot,
  nowInstant: Instant,
): boolean {
  if (!isActiveApprovalState(snapshot.state)) return false
  if (!snapshot.binding) return false
  return nowInstant >= snapshot.binding.expiresAt
}

function validateBasketBinding(binding: ApprovalBinding): DomainResult<void> {
  const keyCount = binding.approvedLogicalOrderKeys.length
  const boundCount = binding.priceBoundsByOrder.length
  if (keyCount !== boundCount) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'priceBoundsByOrder',
      retryability: 'NEVER',
    }))
  }
  const keySet = new Set(binding.approvedLogicalOrderKeys)
  if (keySet.size !== keyCount) {
    return failure(domainFailure('APPROVAL_SCOPE_INVALID', {
      field: 'approvedLogicalOrderKeys',
      retryability: 'NEVER',
    }))
  }
  const boundKeys = binding.priceBoundsByOrder.map((bound) => bound.logicalOrderKey)
  if (
    new Set(boundKeys).size !== boundKeys.length
    || !sameCanonicalKeys(binding.approvedLogicalOrderKeys, boundKeys)
  ) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'priceBoundsByOrder',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}

function sameCanonicalKeys(
  left: readonly IntegrityHash[],
  right: readonly IntegrityHash[],
): boolean {
  if (left.length !== right.length) return false
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function validateSubsetBinding(
  binding: ApprovalBinding,
  allProposedKeys: readonly IntegrityHash[],
  mandatoryKeys: readonly IntegrityHash[],
): DomainResult<void> {
  if (binding.approvedLogicalOrderKeys.length === 0) {
    return failure(domainFailure('APPROVAL_SCOPE_INVALID', {
      field: 'approvedLogicalOrderKeys',
      retryability: 'NEVER',
    }))
  }
  const approvedSet = new Set(binding.approvedLogicalOrderKeys)
  for (const mandatoryKey of mandatoryKeys) {
    if (!approvedSet.has(mandatoryKey)) {
      return failure(domainFailure('MANDATORY_ORDER_NOT_APPROVED', {
        field: 'approvedLogicalOrderKeys',
        retryability: 'NEVER',
      }))
    }
  }
  const proposedSet = new Set(allProposedKeys)
  for (const key of binding.approvedLogicalOrderKeys) {
    if (!proposedSet.has(key)) {
      return failure(domainFailure('APPROVAL_MUTATION_FORBIDDEN', {
        field: 'approvedLogicalOrderKeys',
        retryability: 'NEVER',
      }))
    }
  }
  const keySet = new Set(binding.approvedLogicalOrderKeys)
  if (keySet.size !== binding.approvedLogicalOrderKeys.length) {
    return failure(domainFailure('APPROVAL_SCOPE_INVALID', {
      field: 'approvedLogicalOrderKeys',
      retryability: 'NEVER',
    }))
  }
  const boundCount = binding.priceBoundsByOrder.length
  if (boundCount !== binding.approvedLogicalOrderKeys.length) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'priceBoundsByOrder',
      retryability: 'NEVER',
    }))
  }
  const boundKeys = binding.priceBoundsByOrder.map((bound) => bound.logicalOrderKey)
  if (
    new Set(boundKeys).size !== boundKeys.length
    || !sameCanonicalKeys(binding.approvedLogicalOrderKeys, boundKeys)
  ) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'priceBoundsByOrder',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}

function guardPendingTransition(
  snapshot: ApprovalDecisionSnapshot,
): DomainResult<void> {
  if (snapshot.state === 'PENDING') return success(undefined)
  if (isTerminalApprovalState(snapshot.state)) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return failure(domainFailure('APPROVAL_IDEMPOTENCY_CONFLICT', {
    field: 'state',
    retryability: 'NEVER',
  }))
}

// PENDING → APPROVED
export function approveBasket(
  snapshot: ApprovalDecisionSnapshot,
  binding: ApprovalBinding,
  allProposedKeys: readonly IntegrityHash[],
  decisionHash: IntegrityHash,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  const guard = guardPendingTransition(snapshot)
  if (!guard.ok) return guard
  const validation = validateBasketBinding(binding)
  if (!validation.ok) return validation
  if (!sameCanonicalKeys(binding.approvedLogicalOrderKeys, allProposedKeys)) {
    return failure(domainFailure('APPROVAL_SCOPE_INVALID', {
      field: 'approvedLogicalOrderKeys',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'APPROVED' as ApprovalState,
    decisionKind: 'APPROVE_BASKET' as DecisionKind,
    binding,
    decisionHash,
    stateVersion: nextVersion,
  }))
}

// PENDING → PARTIALLY_APPROVED
export function approveSubset(
  snapshot: ApprovalDecisionSnapshot,
  binding: ApprovalBinding,
  allProposedKeys: readonly IntegrityHash[],
  mandatoryKeys: readonly IntegrityHash[],
  decisionHash: IntegrityHash,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  const guard = guardPendingTransition(snapshot)
  if (!guard.ok) return guard
  const validation = validateSubsetBinding(binding, allProposedKeys, mandatoryKeys)
  if (!validation.ok) return validation
  return success(Object.freeze({
    ...snapshot,
    state: 'PARTIALLY_APPROVED' as ApprovalState,
    decisionKind: 'APPROVE_SUBSET' as DecisionKind,
    binding,
    decisionHash,
    stateVersion: nextVersion,
  }))
}

// PENDING → REJECTED
export function rejectApproval(
  snapshot: ApprovalDecisionSnapshot,
  reasonCode: string,
  decisionHash: IntegrityHash,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  const guard = guardPendingTransition(snapshot)
  if (!guard.ok) return guard
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'reasonCode',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'REJECTED' as ApprovalState,
    decisionKind: 'REJECT' as DecisionKind,
    reasonCode,
    decisionHash,
    stateVersion: nextVersion,
  }))
}

// APPROVED | PARTIALLY_APPROVED → INVALIDATED (material bound-state change)
export function invalidateApproval(
  snapshot: ApprovalDecisionSnapshot,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  if (!isActiveApprovalState(snapshot.state)) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'INVALIDATED' as ApprovalState,
    stateVersion: nextVersion,
  }))
}

// APPROVED | PARTIALLY_APPROVED → EXPIRED (elapsed time)
export function expireApproval(
  snapshot: ApprovalDecisionSnapshot,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  if (!isActiveApprovalState(snapshot.state)) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'EXPIRED' as ApprovalState,
    stateVersion: nextVersion,
  }))
}

// APPROVED | PARTIALLY_APPROVED → CONSUMED (execution run created)
export function consumeApproval(
  snapshot: ApprovalDecisionSnapshot,
  executionRunId: ExecutionRunId,
  nextVersion: number,
): DomainResult<ApprovalDecisionSnapshot> {
  if (snapshot.state === 'CONSUMED') {
    if (snapshot.consumedByExecutionRunId === executionRunId) return success(snapshot)
    return failure(domainFailure('APPROVAL_ALREADY_CONSUMED', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!isActiveApprovalState(snapshot.state)) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    state: 'CONSUMED' as ApprovalState,
    consumedByExecutionRunId: executionRunId,
    stateVersion: nextVersion,
  }))
}

// Verify plan state is APPROVAL_READY before approval
export function requiresApprovalReadyPlan(planState: string): DomainResult<void> {
  if (planState !== 'APPROVAL_READY') {
    return failure(domainFailure('PLAN_NOT_APPROVAL_READY', {
      field: 'planState',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// Verify binding fields are consistent for revalidation
export function verifyApprovalBinding(
  snapshot: ApprovalDecisionSnapshot,
  currentPlanHash: IntegrityHash,
  currentPortfolioVersion: PortfolioStateVersion,
  nowInstant?: Instant,
  executionRunId?: ExecutionRunId,
): DomainResult<void> {
  const statePermitsUse = isActiveApprovalState(snapshot.state)
    || (
      snapshot.state === 'CONSUMED'
      && executionRunId !== undefined
      && snapshot.consumedByExecutionRunId === executionRunId
    )
  if (!statePermitsUse) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'state',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const binding = snapshot.binding
  if (!binding) {
    return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
      field: 'binding',
      retryability: 'NEVER',
    }))
  }
  if (binding.planHash !== currentPlanHash) {
    return failure(domainFailure('PLAN_HASH_BINDING_FAILED', {
      field: 'planHash',
      retryability: 'NEVER',
    }))
  }
  if (binding.portfolioStateVersion !== currentPortfolioVersion) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'portfolioStateVersion',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (nowInstant !== undefined && nowInstant >= binding.expiresAt) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'expiresAt',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}
