import { type DomainResult } from '../errors/result.ts';
import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { PortfolioId, RebalanceRunId, StrategyVersionId, DataVersionId, CostScheduleVersionId, TaxRuleVersionId, TurnoverSnapshotId } from './identifiers.ts';
import { type ExplanationKey, type PlannerReasonCode, type RebalancingConstraintId } from './rebalancing-reasons.ts';
export type SafeReasonBundle = Readonly<{
    primaryCode: PlannerReasonCode;
    secondaryCodes: readonly PlannerReasonCode[];
    explanationKey: ExplanationKey;
    humanExplanation: string;
    constraintIds: readonly RebalancingConstraintId[];
}>;
export type PlanningPhase = 'GATE' | 'IDEAL_TARGET' | 'EXECUTABLE_ALLOCATION' | 'COST_TAX' | 'CONSTRAINT_VERIFICATION' | 'OPTIMIZER' | 'ASSEMBLY';
export type PlanningPhaseDuration = Readonly<{
    phase: PlanningPhase;
    durationMs: number;
}>;
export type SafePlanObservabilityPayload = Readonly<{
    portfolioId: PortfolioId;
    rebalanceRunId: RebalanceRunId;
    planInputHash: IntegrityHash;
    planHash: IntegrityHash;
    strategyVersionId: StrategyVersionId;
    dataVersionId: DataVersionId;
    costScheduleVersionId: CostScheduleVersionId;
    taxRuleVersionId: TaxRuleVersionId;
    turnoverSnapshotId: TurnoverSnapshotId;
    phaseDurations: readonly PlanningPhaseDuration[];
    actionCounts: Readonly<{
        proposed: number;
        skipped: number;
        blocked: number;
    }>;
}>;
export declare function buildSafeReasonBundle(input: Readonly<{
    primaryCode: PlannerReasonCode;
    secondaryCodes?: readonly PlannerReasonCode[];
    explanationKey: ExplanationKey;
    constraintIds?: readonly RebalancingConstraintId[];
}>): DomainResult<SafeReasonBundle>;
export declare function buildSafePlanObservabilityPayload(input: SafePlanObservabilityPayload): DomainResult<SafePlanObservabilityPayload>;
