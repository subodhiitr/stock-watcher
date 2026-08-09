import { domainFailure, type DomainFailureCode } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  ApprovalId,
  ExecutionPolicySnapshotId,
  ExecutionRunId,
  PortfolioId,
  RebalanceRunId,
  ReconciliationRunId,
} from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import {
  type ExecutionMode,
  type ExecutionRunState,
} from './contracts.ts'

export type ExecutionRunSnapshot = Readonly<{
  executionRunId: ExecutionRunId
  portfolioId: PortfolioId
  approvalId: ApprovalId
  rebalanceRunId: RebalanceRunId
  planHash: IntegrityHash
  mode: ExecutionMode
  state: ExecutionRunState
  preExecutionReconciliationId: ReconciliationRunId
  phaseReconciliationIds: readonly ReconciliationRunId[]
  policySnapshotId: ExecutionPolicySnapshotId
  portfolioStateVersion: PortfolioStateVersion
  createdAt: Instant
  updatedAt: Instant
  stateVersion: number
  failureCode?: DomainFailureCode
}>

const TERMINAL_RUN_STATES = new Set<ExecutionRunState>([
  'BLOCKED',
  'COMPLETED',
  'COMPLETED_WITH_RESIDUAL',
  'CANCELLED',
])

const VALID_TRANSITIONS: ReadonlyArray<readonly [ExecutionRunState, ExecutionRunState]> =
  Object.freeze([
    // Normal progression
    ['CREATED', 'VALIDATING'],
    ['VALIDATING', 'READY'],
    ['VALIDATING', 'BLOCKED'],
    ['VALIDATING', 'COMPLETED'],
    ['READY', 'SELLING'],
    ['READY', 'BUYING'],
    ['SELLING', 'RECONCILING_SELLS'],
    ['RECONCILING_SELLS', 'BUYING'],
    ['RECONCILING_SELLS', 'COMPLETED'],
    ['RECONCILING_SELLS', 'COMPLETED_WITH_RESIDUAL'],
    ['RECONCILING_SELLS', 'RECOVERY_REQUIRED'],
    ['BUYING', 'RECONCILING_BUYS'],
    ['RECONCILING_BUYS', 'COMPLETED'],
    ['RECONCILING_BUYS', 'COMPLETED_WITH_RESIDUAL'],
    // Cancellation from any active non-terminal state
    ['VALIDATING', 'CANCELLING'],
    ['READY', 'CANCELLING'],
    ['SELLING', 'CANCELLING'],
    ['RECONCILING_SELLS', 'CANCELLING'],
    ['BUYING', 'CANCELLING'],
    ['RECONCILING_BUYS', 'CANCELLING'],
    ['RECOVERY_REQUIRED', 'CANCELLING'],
    // Cancellation terminal states
    ['CANCELLING', 'CANCELLED'],
    ['CANCELLING', 'COMPLETED_WITH_RESIDUAL'],
    ['CANCELLING', 'RECOVERY_REQUIRED'],
    // Recovery from any active non-terminal state
    ['VALIDATING', 'RECOVERY_REQUIRED'],
    ['READY', 'RECOVERY_REQUIRED'],
    ['SELLING', 'RECOVERY_REQUIRED'],
    ['BUYING', 'RECOVERY_REQUIRED'],
    ['RECONCILING_BUYS', 'RECOVERY_REQUIRED'],
    // From RECOVERY_REQUIRED: resume to proven non-placement state or terminal
    ['RECOVERY_REQUIRED', 'RECONCILING_SELLS'],
    ['RECOVERY_REQUIRED', 'RECONCILING_BUYS'],
    ['RECOVERY_REQUIRED', 'COMPLETED'],
    ['RECOVERY_REQUIRED', 'COMPLETED_WITH_RESIDUAL'],
    ['RECOVERY_REQUIRED', 'CANCELLED'],
  ])

function isValidRunTransition(
  from: ExecutionRunState,
  to: ExecutionRunState,
): boolean {
  for (const [f, t] of VALID_TRANSITIONS) {
    if (f === from && t === to) return true
  }
  return false
}

export function isTerminalRunState(state: ExecutionRunState): boolean {
  return TERMINAL_RUN_STATES.has(state)
}

export function runStateAllowsNewPlacement(state: ExecutionRunState): boolean {
  return state === 'READY' || state === 'SELLING' || state === 'BUYING'
}

export function transitionRunState(
  snapshot: ExecutionRunSnapshot,
  targetState: ExecutionRunState,
  updatedAt: Instant,
  nextVersion: number,
  reconciliationRunId?: ReconciliationRunId,
  failureCode?: DomainFailureCode,
): DomainResult<ExecutionRunSnapshot> {
  if (isTerminalRunState(snapshot.state)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!isValidRunTransition(snapshot.state, targetState)) {
    return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  const phaseReconciliationIds = reconciliationRunId
    ? Object.freeze([...snapshot.phaseReconciliationIds, reconciliationRunId])
    : snapshot.phaseReconciliationIds
  const next: ExecutionRunSnapshot = Object.freeze({
    executionRunId: snapshot.executionRunId,
    portfolioId: snapshot.portfolioId,
    approvalId: snapshot.approvalId,
    rebalanceRunId: snapshot.rebalanceRunId,
    planHash: snapshot.planHash,
    mode: snapshot.mode,
    state: targetState,
    preExecutionReconciliationId: snapshot.preExecutionReconciliationId,
    phaseReconciliationIds,
    policySnapshotId: snapshot.policySnapshotId,
    portfolioStateVersion: snapshot.portfolioStateVersion,
    createdAt: snapshot.createdAt,
    updatedAt,
    stateVersion: nextVersion,
    ...(failureCode !== undefined ? { failureCode } : {}),
  })
  return success(next)
}

export function advanceRunPortfolioStateVersion(
  snapshot: ExecutionRunSnapshot,
  portfolioStateVersion: PortfolioStateVersion,
  updatedAt: Instant,
  nextVersion: number,
): DomainResult<ExecutionRunSnapshot> {
  if (
    isTerminalRunState(snapshot.state)
    || portfolioStateVersion !== snapshot.portfolioStateVersion + 1
    || nextVersion !== snapshot.stateVersion + 1
  ) {
    return failure(domainFailure('PORTFOLIO_VERSION_CONFLICT', {
      field: 'portfolioStateVersion',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(Object.freeze({
    ...snapshot,
    portfolioStateVersion,
    updatedAt,
    stateVersion: nextVersion,
  }))
}

// Reject if run is already terminal — prevents duplicate run creation
export function requiresActiveRun(snapshot: ExecutionRunSnapshot): DomainResult<void> {
  if (isTerminalRunState(snapshot.state)) {
    return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}
