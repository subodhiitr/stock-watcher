import type { PlanningCandidate } from '../construction/planning-context.ts';
import { type DomainResult } from '../errors/result.ts';
import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { InstrumentId, PortfolioId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import type { BlockingPrerequisiteCode } from '../shared/rebalancing-reasons.ts';
import { type SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import { type Weight } from '../shared/weight.ts';
import type { CostEstimate } from './cost-estimator.ts';
import type { TaxEstimate } from './tax-lot-selection.ts';
import type { ExecutableTargetPosition } from './whole-share-greedy-allocator.ts';
export type ProposedOrder = Readonly<{
    logicalOrderKey: IntegrityHash;
    instrumentId: InstrumentId;
    side: 'BUY' | 'SELL' | 'REDUCE';
    quantityShares: bigint;
    estimatedPrice: Money;
    estimatedNotional: Money;
    targetWeightBefore: Weight;
    targetWeightAfter: Weight;
    costEstimate: CostEstimate;
    taxEstimate?: TaxEstimate;
    reasonBundle: SafeReasonBundle;
    urgency: 'MANDATORY' | 'ROUTINE' | 'DRIFT';
}>;
export type SkippedOrder = Readonly<{
    logicalOrderKey: IntegrityHash;
    instrumentId: InstrumentId;
    candidateSide: 'BUY' | 'SELL' | 'REDUCE' | 'REPLACE';
    reasonBundle: SafeReasonBundle;
    foregoneTargetWeight?: Weight;
}>;
export type BlockedOrder = Readonly<{
    logicalOrderKey: IntegrityHash;
    instrumentId: InstrumentId;
    candidateSide: 'BUY' | 'SELL' | 'REDUCE' | 'REPLACE';
    blockingPrerequisite: BlockingPrerequisiteCode;
    reasonBundle: SafeReasonBundle;
}>;
export type ActionBuckets = Readonly<{
    proposed: readonly ProposedOrder[];
    skipped: readonly SkippedOrder[];
    blocked: readonly BlockedOrder[];
}>;
export type SkippedActionInput = Readonly<{
    instrumentId: InstrumentId;
    candidateSide: SkippedOrder['candidateSide'];
    reasonBundle: SafeReasonBundle;
    foregoneTargetWeight?: Weight;
}>;
export type BlockedActionInput = Readonly<{
    instrumentId: InstrumentId;
    candidateSide: BlockedOrder['candidateSide'];
    blockingPrerequisite: BlockingPrerequisiteCode;
    reasonBundle: SafeReasonBundle;
}>;
export declare function buildActionBuckets(input: Readonly<{
    portfolioId: PortfolioId;
    startingNav: Money;
    candidates: readonly PlanningCandidate[];
    executablePositions: readonly ExecutableTargetPosition[];
    costsByInstrument: ReadonlyMap<InstrumentId, CostEstimate>;
    taxesByInstrument: ReadonlyMap<InstrumentId, TaxEstimate>;
    skipped: readonly SkippedActionInput[];
    blocked: readonly BlockedActionInput[];
}>): DomainResult<ActionBuckets>;
