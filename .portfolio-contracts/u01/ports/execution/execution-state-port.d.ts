import type { DomainResult } from '../../domain/errors/result.ts';
import type { PortfolioSnapshot } from '../../domain/portfolio/portfolio.ts';
import type { Holding } from '../../domain/portfolio/holding.ts';
import type { CorporateAction } from '../../domain/strategy/corporate-action.ts';
import type { RebalancePlan } from '../../domain/rebalancing/rebalance-plan.ts';
import type { ExecutionPolicySnapshot } from '../../domain/execution/contracts.ts';
import type { ApprovalDecisionSnapshot } from '../../domain/execution/approval.ts';
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import type { ReconciliationRunSnapshot } from '../../domain/execution/reconciliation.ts';
import type { KillSwitchSnapshot, KillSwitchScope } from '../../domain/execution/kill-switch.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { PortfolioId, InstrumentId, StrategyVersionId } from '../../domain/shared/identifiers.ts';
import type { Money } from '../../domain/shared/money.ts';
import type { Instant, LocalDate } from '../../domain/shared/time.ts';
import type { PortfolioStateVersion } from '../../domain/shared/state-version.ts';
/**
 * U01 accounting view for the execution layer.
 *
 * Extends PortfolioSnapshot with explicit reserved-cash and delivery-quantity
 * totals for pre-transaction affordability checks and gate evaluations.
 */
export type ExecutionPortfolioAccounting = Readonly<{
    snapshot: PortfolioSnapshot;
    /**
     * Sum of all reserved cash across open buy orders in this portfolio.
     * Derived from holdings and open orders; used by the cash-buffer gate.
     */
    totalReservedCash: Money;
    /**
     * Holdings indexed by instrumentId for O(1) gate and affordability lookups.
     * Values are the same Holding objects present in snapshot.holdings.
     */
    holdingsByInstrument: ReadonlyMap<InstrumentId, Holding>;
    /**
     * Monotone state version at the time this snapshot was read.  Used to
     * detect concurrent portfolio mutations before entering a transaction.
     */
    stateVersion: PortfolioStateVersion;
    /** Wall-clock time at which this accounting snapshot was assembled. */
    asOf: Instant;
}>;
/**
 * U03 policy evidence bound to a specific strategy version and effective date.
 *
 * Carries the content hash so the execution layer can verify that the policy
 * used during approval has not changed before placement.
 */
export type ExecutionPolicyLineage = Readonly<{
    policySnapshot: ExecutionPolicySnapshot;
    /** Canonical hash of the strategy-level policy configuration. */
    strategyConfigHash: IntegrityHash;
    effectiveAt: Instant;
}>;
/**
 * U03 corporate-action evidence relevant to the execution window.
 *
 * Any PENDING or PROCESSED action affecting a planned instrument causes the
 * approval gate to flag the affected order for mandatory review.
 */
export type ExecutionCorporateActionEvidence = Readonly<{
    /** Actions that overlap with the planned execution date. */
    pendingActions: readonly CorporateAction[];
    /** Actions processed since the plan was created; may require plan invalidation. */
    processedSincePlan: readonly CorporateAction[];
    /** Content hash of the complete action set, for idempotent re-checks. */
    contentHash: IntegrityHash;
    asOf: Instant;
}>;
/**
 * Current U04 rebalance plan state for a portfolio.
 *
 * Returns undefined when no APPROVAL_READY plan exists.
 */
export type CurrentPlanState = Readonly<{
    plan: RebalancePlan;
    /** Semantic hash verified against the plan body at load time. */
    verifiedPlanHash: IntegrityHash;
    loadedAt: Instant;
}>;
/**
 * Snapshot of current U05 aggregate state for a portfolio.
 *
 * All fields are optional because the aggregates may not yet exist for a
 * newly created or freshly reset portfolio.
 */
export type ExecutionAggregateLineage = Readonly<{
    /** Most recent approval decision for this portfolio, if any. */
    currentApproval?: ApprovalDecisionSnapshot;
    /** Active (non-terminal) execution run, if any. */
    activeRun?: ExecutionRunSnapshot;
    /** Latest reconciliation run (any terminal state), if any. */
    latestReconciliation?: ReconciliationRunSnapshot;
    /** Kill-switch affecting this portfolio (global or portfolio-scoped), if any. */
    killSwitch?: KillSwitchSnapshot;
    asOf: Instant;
}>;
export type PlanStateRequest = Readonly<{
    portfolioId: PortfolioId;
    timeoutMs: number;
}>;
export type PortfolioAccountingRequest = Readonly<{
    portfolioId: PortfolioId;
    timeoutMs: number;
}>;
export type PolicyLineageRequest = Readonly<{
    strategyVersionId: StrategyVersionId;
    effectiveAt: Instant;
    timeoutMs: number;
}>;
export type CorporateActionEvidenceRequest = Readonly<{
    portfolioId: PortfolioId;
    executionDate: LocalDate;
    timeoutMs: number;
}>;
export type AggregateLineageRequest = Readonly<{
    portfolioId: PortfolioId;
    killSwitchScope: KillSwitchScope;
    timeoutMs: number;
}>;
/**
 * Execution state port.
 *
 * Provides async reads of U01/U03/U04 context and current U05 aggregate lineage.
 * All methods complete within their supplied timeoutMs or return a timeout failure.
 * Results are point-in-time snapshots; callers must detect staleness via
 * stateVersion or asOf fields before committing dependent mutations.
 */
export interface ExecutionStatePort {
    /**
     * Load the current APPROVAL_READY U04 rebalance plan for the portfolio.
     * Returns undefined when no current plan exists.
     */
    loadCurrentPlan(request: PlanStateRequest): Promise<DomainResult<CurrentPlanState | undefined>>;
    /**
     * Load U01 portfolio accounting including holdings, cash, and reservations.
     */
    loadPortfolioAccounting(request: PortfolioAccountingRequest): Promise<DomainResult<ExecutionPortfolioAccounting>>;
    /**
     * Load U03 policy lineage (execution policy snapshot and strategy config hash)
     * for a specific strategy version and effective timestamp.
     */
    loadPolicyLineage(request: PolicyLineageRequest): Promise<DomainResult<ExecutionPolicyLineage>>;
    /**
     * Load U03 corporate-action evidence for the portfolio's execution date.
     */
    loadCorporateActionEvidence(request: CorporateActionEvidenceRequest): Promise<DomainResult<ExecutionCorporateActionEvidence>>;
    /**
     * Load current U05 aggregate lineage: approval, active run, latest
     * reconciliation, and kill-switch state.
     */
    loadAggregateLineage(request: AggregateLineageRequest): Promise<DomainResult<ExecutionAggregateLineage>>;
}
