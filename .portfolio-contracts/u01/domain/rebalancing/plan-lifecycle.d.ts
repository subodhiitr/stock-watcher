import { type DomainResult } from '../errors/result.ts';
import type { RebalanceRunId } from '../shared/identifiers.ts';
import type { Instant, LocalDate } from '../shared/time.ts';
import type { PlanLifecycleState, RebalancePlan } from './rebalance-plan.ts';
export type PlanLifecycleTransition = Readonly<{
    from: PlanLifecycleState;
    to: PlanLifecycleState;
    changedAt: Instant;
}>;
export type PlanLifecycle = Readonly<{
    rebalanceRunId: RebalanceRunId;
    state: PlanLifecycleState;
    history: readonly PlanLifecycleTransition[];
}>;
export declare function createDraftPlanLifecycle(rebalanceRunId: RebalanceRunId): PlanLifecycle;
export declare function transitionPlanLifecycle(lifecycle: PlanLifecycle, to: PlanLifecycleState, changedAt: Instant): DomainResult<PlanLifecycle>;
export declare function revalidatePlanLifecycle(input: Readonly<{
    plan: RebalancePlan;
    checkedAt: Instant;
    checkedOn: LocalDate;
    lineageCurrent: boolean;
    supersededByNonEquivalentPlan: boolean;
}>): DomainResult<RebalancePlan>;
