import { type DomainResult } from '../errors/result.ts';
import type { InstrumentId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts';
import { type Weight } from '../shared/weight.ts';
export type ImplementationShortfall = Readonly<{
    weightGap: Weight;
    cashGap: Weight;
    notionalGap: Money;
    dragGap: Money;
    bindingConstraintIds: readonly RebalancingConstraintId[];
}>;
type TargetPosition = Readonly<{
    instrumentId: InstrumentId;
    targetWeight: Weight;
    targetValue: Money;
    bindingConstraintIds?: readonly RebalancingConstraintId[];
}>;
export declare function calculateImplementationShortfall(input: Readonly<{
    idealPositions: readonly TargetPosition[];
    executablePositions: readonly TargetPosition[];
    idealCashWeight: Weight;
    executableCashWeight: Weight;
    estimatedCost: Money;
    estimatedTax: Money;
}>): DomainResult<ImplementationShortfall>;
export {};
