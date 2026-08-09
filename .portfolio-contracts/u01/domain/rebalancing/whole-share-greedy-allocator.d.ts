import { type ConstraintCheck } from '../construction/constraint-verifier.ts';
import type { ConstructionConstraintSet, PlanningCandidate, PlanningTiming } from '../construction/planning-context.ts';
import type { IdealTarget } from '../construction/ideal-target-constructor.ts';
import { type DomainResult } from '../errors/result.ts';
import type { InstrumentId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import { type Quantity } from '../shared/quantity.ts';
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts';
import { type Weight } from '../shared/weight.ts';
export type ExecutableTargetPosition = Readonly<{
    instrumentId: InstrumentId;
    targetWeight: Weight;
    targetQuantity: Quantity;
    targetValue: Money;
    deltaQuantityShares: bigint;
    deltaValue: Money;
    bindingConstraintIds: readonly RebalancingConstraintId[];
}>;
export type ExecutableTarget = Readonly<{
    allocationMethod: 'GREEDY' | 'OPTIMIZER_VERIFIED_FALLBACK' | 'OPTIMIZER_PRIMARY';
    totalEquityWeight: Weight;
    cashWeight: Weight;
    residualCash: Money;
    positions: readonly ExecutableTargetPosition[];
    constraintChecks: readonly ConstraintCheck[];
    noTrade: boolean;
}>;
export declare function allocateWholeSharesGreedy(input: Readonly<{
    idealTarget: IdealTarget;
    candidates: readonly PlanningCandidate[];
    startingNav: Money;
    constraints: ConstructionConstraintSet;
    timing: PlanningTiming;
    fixedTargetQuantityByInstrument?: ReadonlyMap<InstrumentId, Quantity>;
}>): DomainResult<ExecutableTarget>;
