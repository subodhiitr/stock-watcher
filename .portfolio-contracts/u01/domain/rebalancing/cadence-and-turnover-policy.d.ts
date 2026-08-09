import { type DomainResult } from '../errors/result.ts';
import type { Money } from '../shared/money.ts';
import { type ScaledRate } from '../shared/scaled-rate.ts';
import { type SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import type { Weight } from '../shared/weight.ts';
import type { CadencePolicySnapshot, PlanningTurnoverWindow } from '../construction/planning-context.ts';
export type TurnoverWindowBalance = Readonly<{
    windowKind: PlanningTurnoverWindow['windowKind'];
    budgetLimit: ScaledRate;
    consumedBeforePlan: ScaledRate;
    consumedAfterPlan: ScaledRate;
    remainingBeforePlan: ScaledRate;
    remainingAfterPlan: ScaledRate;
}>;
export type TurnoverBudgetEvaluation = Readonly<{
    proposedConsumption: ScaledRate;
    windows: readonly TurnoverWindowBalance[];
    accepted: boolean;
    reasonBundle?: SafeReasonBundle;
}>;
export declare function isCadenceOpen(input: Readonly<{
    asOf: string;
    reviewKind: 'CONSTITUENT' | 'DRIFT';
    cadence: CadencePolicySnapshot;
    decisionSessionDate: string;
    eligibleExecutionDate: string;
}>): DomainResult<boolean>;
export declare function calculateDriftBand(input: Readonly<{
    targetWeight: Weight;
    absoluteDriftBand: Weight;
    relativeDriftBand: ScaledRate;
}>): bigint;
export declare function evaluateDiscretionaryHolding(input: Readonly<{
    currentWeight: Weight;
    targetWeight: Weight;
    absoluteDriftBand: Weight;
    relativeDriftBand: ScaledRate;
    daysHeld: number;
    preferredMinimumHoldDays: number;
    mandatory: boolean;
    holdRankBufferActive?: boolean;
    replacementScoreGapPpm?: bigint;
    requiredReplacementGapPpm?: bigint;
}>): DomainResult<Readonly<{
    allowed: boolean;
    reasonBundle?: SafeReasonBundle;
}>>;
export declare function calculateTurnoverConsumption(input: Readonly<{
    totalBuyNotional: Money;
    totalSellNotional: Money;
    startingNav: Money;
}>): DomainResult<ScaledRate>;
export declare function evaluateTurnoverWindows(input: Readonly<{
    proposedConsumption: ScaledRate;
    windows: readonly PlanningTurnoverWindow[];
}>): DomainResult<TurnoverBudgetEvaluation>;
