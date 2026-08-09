import type { InterimAuthorization, NormalizedPlanningContext, PlanningIntent } from '../../domain/construction/planning-context.ts';
import { type DomainResult } from '../../domain/errors/result.ts';
import type { PortfolioId, RebalanceRunId } from '../../domain/shared/identifiers.ts';
import type { Instant, LocalDate } from '../../domain/shared/time.ts';
import type { CostSchedule } from '../../domain/rebalancing/cost-estimator.ts';
import type { TaxRuleSet } from '../../domain/rebalancing/tax-lot-selection.ts';
import type { PlanHistoryFact, PlanHistoryPort } from '../../ports/rebalancing/plan-history-port.ts';
import type { PlanningSnapshotPort } from '../../ports/rebalancing/planning-snapshot-port.ts';
import type { PolicyAndTurnoverPort } from '../../ports/rebalancing/policy-and-turnover-port.ts';
export type PlanningConstraintPolicyInput = Readonly<{
    maxSectorWeightPpm: bigint;
    maxGroupWeightPpm: bigint;
    maxSmallCapWeightPpm: bigint;
    maxLiquidityParticipationPpm: bigint;
    minimumOrderMinorUnits: bigint;
    nextRoutineDecisionDate: LocalDate;
    nextDriftReviewDate: LocalDate;
}>;
export type PlanningAssemblyRequest = Readonly<{
    portfolioId: PortfolioId;
    rebalanceRunId: RebalanceRunId;
    planningIntent: PlanningIntent;
    asOf: LocalDate;
    createdAt: Instant;
    dependencyTimeoutMs: number;
    constraintPolicy: PlanningConstraintPolicyInput;
    interimAuthorization?: InterimAuthorization;
}>;
export type AssembledPlanningSnapshot = Readonly<{
    context: NormalizedPlanningContext;
    costSchedule: CostSchedule;
    taxRules: TaxRuleSet;
    equivalentPriorPlan?: PlanHistoryFact;
    currentApprovalReadyPlan?: PlanHistoryFact;
}>;
export declare class PlanningSnapshotAssembler {
    #private;
    constructor(input: Readonly<{
        snapshotPort: PlanningSnapshotPort;
        policyPort: PolicyAndTurnoverPort;
        historyPort: PlanHistoryPort;
    }>);
    assemble(request: PlanningAssemblyRequest): Promise<DomainResult<AssembledPlanningSnapshot>>;
}
