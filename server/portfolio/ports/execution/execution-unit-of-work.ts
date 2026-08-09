// Step 15: Execution persistence ports — interfaces/types only.
//
// All repositories are transaction-scoped and synchronous (DomainResult, no Promise).
// Aggregates use optimistic versioning.  Facts (fills, cancellations, residuals)
// are insert-only and idempotent by their primary identifier.
//
// This unit-of-work port is standalone and does not modify the U02
// PortfolioUnitOfWork or ports/index.ts; integration with U02 happens at Steps 32–33.

import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts'
import type {
  AdjustmentProposalId,
  ApprovalId,
  CancellationId,
  ExecutionRunId,
  BrokerOrderReferenceId,
  FillId,
  KillSwitchId,
  OrderId,
  PortfolioId,
  ReconciliationRunId,
  ReconciliationSnapshotId,
  ResidualWorkId,
} from '../../domain/shared/identifiers.ts'
import type { ApprovalDecisionSnapshot } from '../../domain/execution/approval.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import type {
  CancellationAttemptRecord,
  CancellationOutcomeRecord,
  ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type {
  ReconciliationRunSnapshot,
  ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'
import type { KillSwitchSnapshot, KillSwitchScope } from '../../domain/execution/kill-switch.ts'
import type {
  AdjustmentProposal,
  ResidualWork,
} from '../../domain/execution/residual-and-adjustment.ts'
import type { NormalizedFill } from '../../domain/execution/contracts.ts'
import type { ExecutionEvidencePayload } from '../../domain/execution/evidence.ts'
import type { PortfolioStateVersion } from '../../domain/shared/state-version.ts'
import type { Portfolio } from '../../domain/portfolio/portfolio.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type { Instant } from '../../domain/shared/time.ts'

export type KillSwitchResetEligibilityToken = Readonly<{
  killSwitchId: KillSwitchId
  killSwitchStateVersion: number
  checkedAt: Instant
  contentHash: IntegrityHash
  healthSnapshotHash: IntegrityHash
  reconciliationSnapshotIds: readonly ReconciliationSnapshotId[]
  affectedPortfolioVersions: readonly Readonly<{
    portfolioId: PortfolioId
    stateVersion: PortfolioStateVersion
  }>[]
}>

// ── Committed result ─────────────────────────────────────────────────────────

export type CommittedExecutionResult<T> = Readonly<{
  value: T
  /** Evidence payloads published after the synchronous commit succeeds. */
  postCommitEvidence: readonly ExecutionEvidencePayload[]
}>

// ── Approval repository ──────────────────────────────────────────────────────

export interface ExecutionApprovalRepository {
  insert(
    snapshot: ApprovalDecisionSnapshot,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    approvalId: ApprovalId,
  ): DomainResult<ApprovalDecisionSnapshot | undefined, AnyDomainFailure>

  findActiveByPortfolio(
    portfolioId: PortfolioId,
  ): DomainResult<ApprovalDecisionSnapshot | undefined, AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    snapshot: ApprovalDecisionSnapshot,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Execution-run repository ──────────────────────────────────────────────────

export interface ExecutionRunRepository {
  insert(
    snapshot: ExecutionRunSnapshot,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    executionRunId: ExecutionRunId,
  ): DomainResult<ExecutionRunSnapshot | undefined, AnyDomainFailure>

  findActiveByPortfolio(
    portfolioId: PortfolioId,
  ): DomainResult<ExecutionRunSnapshot | undefined, AnyDomainFailure>

  findByApprovalId(
    approvalId: ApprovalId,
  ): DomainResult<ExecutionRunSnapshot | undefined, AnyDomainFailure>

  listActive(): DomainResult<readonly ExecutionRunSnapshot[], AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    snapshot: ExecutionRunSnapshot,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Execution-order repository ───────────────────────────────────────────────

export interface ExecutionOrderRepository {
  insert(
    snapshot: ExecutionOrderSnapshot,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    orderId: OrderId,
  ): DomainResult<ExecutionOrderSnapshot | undefined, AnyDomainFailure>

  listByRun(
    executionRunId: ExecutionRunId,
  ): DomainResult<readonly ExecutionOrderSnapshot[], AnyDomainFailure>

  findByBrokerReference(
    portfolioId: PortfolioId,
    brokerOrderReferenceId: BrokerOrderReferenceId,
  ): DomainResult<ExecutionOrderSnapshot | undefined, AnyDomainFailure>

  listCancellableByScope(
    scope: KillSwitchScope,
  ): DomainResult<readonly ExecutionOrderSnapshot[], AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    snapshot: ExecutionOrderSnapshot,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Reconciliation-run repository ────────────────────────────────────────────

export interface ReconciliationRunRepository {
  insert(
    snapshot: ReconciliationRunSnapshot,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    reconciliationRunId: ReconciliationRunId,
  ): DomainResult<ReconciliationRunSnapshot | undefined, AnyDomainFailure>

  findLatestByPortfolio(
    portfolioId: PortfolioId,
  ): DomainResult<ReconciliationRunSnapshot | undefined, AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    snapshot: ReconciliationRunSnapshot,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Reconciliation-snapshot repository (insert-only) ─────────────────────────

export interface ReconciliationSnapshotRepository {
  /** Idempotent by snapshotId — re-inserting the same snapshot is a no-op. */
  insert(
    record: ReconciliationSnapshotRecord,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    snapshotId: ReconciliationSnapshotId,
  ): DomainResult<ReconciliationSnapshotRecord | undefined, AnyDomainFailure>
}

// ── Kill-switch repository ────────────────────────────────────────────────────

export interface KillSwitchRepository {
  insert(
    snapshot: KillSwitchSnapshot,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    killSwitchId: KillSwitchId,
  ): DomainResult<KillSwitchSnapshot | undefined, AnyDomainFailure>

  findByScope(
    scope: KillSwitchScope,
  ): DomainResult<KillSwitchSnapshot | undefined, AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    snapshot: KillSwitchSnapshot,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Fill repository (fact — insert-only) ──────────────────────────────────────

export interface FillFactRepository {
  /**
   * Insert a normalized fill.  Idempotent by fillId:
   * re-inserting the same fill with the same content hash is a no-op;
   * re-inserting with a different content hash returns FILL_IDEMPOTENCY_CONFLICT.
   */
  insert(
    fill: NormalizedFill,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    fillId: FillId,
  ): DomainResult<NormalizedFill | undefined, AnyDomainFailure>
}

// ── Cancellation repository (fact — insert-only) ──────────────────────────────

export interface CancellationFactRepository {
  /**
   * Insert a cancellation attempt record.  Idempotent by cancellationId.
   * Updating an existing cancellation record is not permitted.
   */
  insertRequest(
    record: CancellationAttemptRecord,
  ): DomainResult<void, AnyDomainFailure>

  getRequestById(
    cancellationId: CancellationId,
  ): DomainResult<CancellationAttemptRecord | undefined, AnyDomainFailure>

  findRequestByOrderAndIdempotencyKey(
    orderId: OrderId,
    idempotencyKey: CancellationAttemptRecord['idempotencyKey'],
  ): DomainResult<CancellationAttemptRecord | undefined, AnyDomainFailure>

  insertOutcome(
    record: CancellationOutcomeRecord,
  ): DomainResult<void, AnyDomainFailure>

  getOutcomeById(
    cancellationId: CancellationId,
  ): DomainResult<CancellationOutcomeRecord | undefined, AnyDomainFailure>
}

// ── Residual-work repository (fact — insert-only) ─────────────────────────────

export interface ResidualWorkRepository {
  /**
   * Insert a residual work fact.  Idempotent by residualWorkId.
   */
  insert(
    work: ResidualWork,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    residualWorkId: ResidualWorkId,
  ): DomainResult<ResidualWork | undefined, AnyDomainFailure>
}

// ── Adjustment-proposal repository ───────────────────────────────────────────

export interface AdjustmentProposalRepository {
  insert(
    proposal: AdjustmentProposal,
  ): DomainResult<void, AnyDomainFailure>

  getById(
    adjustmentProposalId: AdjustmentProposalId,
  ): DomainResult<AdjustmentProposal | undefined, AnyDomainFailure>

  /** Optimistic save — fails if stored state version differs from expected. */
  save(
    proposal: AdjustmentProposal,
    expectedStateVersion: number,
  ): DomainResult<void, AnyDomainFailure>
}

// ── Transaction ───────────────────────────────────────────────────────────────

/**
 * Synchronous execution transaction scope.
 *
 * All repository operations and evidence staging must be performed within the
 * synchronous callback passed to ExecutionUnitOfWork.execute.  No Promise-returning
 * or async work is permitted inside the callback.
 */
export interface ExecutionTransaction {
  readonly portfolioState: {
    assertCurrent(
      portfolioId: PortfolioId,
      expectedStateVersion: PortfolioStateVersion,
      expectedStatus: 'ACTIVE',
    ): DomainResult<void, AnyDomainFailure>
  }
  readonly portfolioAccounting: {
    getById(
      portfolioId: PortfolioId,
    ): DomainResult<Portfolio | undefined, AnyDomainFailure>
    save(
      portfolio: Portfolio,
      expectedStateVersion: PortfolioStateVersion,
    ): DomainResult<void, AnyDomainFailure>
  }
  readonly killSwitchResetEligibility: {
    assertCurrent(
      token: KillSwitchResetEligibilityToken,
    ): DomainResult<void, AnyDomainFailure>
  }
  readonly approvals: ExecutionApprovalRepository
  readonly runs: ExecutionRunRepository
  readonly orders: ExecutionOrderRepository
  readonly reconciliationRuns: ReconciliationRunRepository
  readonly reconciliationSnapshots: ReconciliationSnapshotRepository
  readonly killSwitches: KillSwitchRepository
  readonly fills: FillFactRepository
  readonly cancellations: CancellationFactRepository
  readonly residuals: ResidualWorkRepository
  readonly adjustmentProposals: AdjustmentProposalRepository

  /**
   * Stage evidence payloads to be published after the commit succeeds.
   * Staged evidence must correspond 1-to-1 with aggregate mutations or fact
   * insertions performed in this transaction.
   */
  stageEvidence(
    payloads: readonly ExecutionEvidencePayload[],
  ): DomainResult<void, AnyDomainFailure>
}

// ── Unit of work ──────────────────────────────────────────────────────────────

/**
 * Execution unit of work.
 *
 * Executes a synchronous callback inside a database transaction.  The callback
 * receives an ExecutionTransaction and must return a DomainResult synchronously.
 * On success the transaction is committed and staged evidence is returned for
 * post-commit publication.  On failure the transaction is rolled back and no
 * evidence is published.
 *
 * Broker calls, timer waits, and reconciliation collection must all happen
 * outside this boundary.
 */
export interface ExecutionUnitOfWork {
  execute<T>(
    work: (transaction: ExecutionTransaction) => DomainResult<T, AnyDomainFailure>,
  ): DomainResult<CommittedExecutionResult<T>, AnyDomainFailure>
}
