import type { InstrumentId } from '../shared/identifiers.ts';
import type { Money } from '../shared/money.ts';
import type { Quantity } from '../shared/quantity.ts';
import { type RebalancingConstraintId } from '../shared/rebalancing-reasons.ts';
import { type SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import type { Weight } from '../shared/weight.ts';
import type { ConstructionConstraintSet, MarketCapBucket, PlanningTiming } from './planning-context.ts';
export type VerifiablePosition = Readonly<{
    instrumentId: InstrumentId;
    decisionPrice: Money;
    targetQuantity: Quantity;
    targetValue: Money;
    targetWeight: Weight;
    currentQuantity: Quantity;
    availableDeliveryQuantity: Quantity;
    liquidityCapacity: Money;
    sectorId?: string;
    groupId?: string;
    marketCapBucket?: MarketCapBucket;
}>;
export type ConstraintCheck = Readonly<{
    constraintId: RebalancingConstraintId;
    passed: boolean;
    actual?: bigint;
    limit?: bigint;
    reasonBundle?: SafeReasonBundle;
}>;
export type ConstraintVerification = Readonly<{
    accepted: boolean;
    checks: readonly ConstraintCheck[];
    violatedConstraintIds: readonly RebalancingConstraintId[];
}>;
export declare function verifyConstructionConstraints(input: Readonly<{
    positions: readonly VerifiablePosition[];
    residualCash: Money;
    startingNav: Money;
    constraints: ConstructionConstraintSet;
    proposedTurnoverPpm: bigint;
    timing: PlanningTiming;
}>): ConstraintVerification;
