import { type DomainResult } from '../errors/result.ts';
import type { InstrumentId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts';
import type { SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import { type Weight } from '../shared/weight.ts';
import type { CandidateProjection } from './candidate-projection.ts';
import type { ConstructionConstraintSet } from './planning-context.ts';
export type IdealTargetPosition = Readonly<{
    instrumentId: InstrumentId;
    rank: number;
    compositeScorePpm: bigint;
    inverseVolatilityWeight: Weight;
    targetWeight: Weight;
    targetValue: Money;
    bindingConstraintIds: readonly RebalancingConstraintId[];
}>;
export type IdealCandidateExclusion = Readonly<{
    instrumentId: InstrumentId;
    reasonBundle: SafeReasonBundle;
    excludedAtStage: 'ELIGIBILITY_GATE' | 'IDEAL_TARGET';
}>;
export type IdealTarget = Readonly<{
    totalEquityWeight: Weight;
    cashWeight: Weight;
    positions: readonly IdealTargetPosition[];
    excludedCandidates: readonly IdealCandidateExclusion[];
}>;
export declare function constructIdealTarget(input: Readonly<{
    projection: CandidateProjection;
    startingNav: Money;
    constraints: ConstructionConstraintSet;
}>): DomainResult<IdealTarget>;
