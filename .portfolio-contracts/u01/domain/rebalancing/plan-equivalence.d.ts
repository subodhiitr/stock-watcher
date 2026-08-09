import type { ActionBuckets } from './action-buckets.ts';
import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { InstrumentId, PortfolioId } from '../shared/identifiers.ts';
export type PlanEquivalence = Readonly<{
    equivalent: boolean;
    sameInput: boolean;
    samePlan: boolean;
    sameLogicalOrders: boolean;
}>;
type ComparablePlan = Readonly<{
    planInputHash: IntegrityHash;
    planHash: IntegrityHash;
    actionBuckets: ActionBuckets;
}>;
type SupersedablePlan = Readonly<{
    state: 'DRAFT' | 'APPROVAL_READY' | 'SUPERSEDED' | 'INVALIDATED' | 'EXPIRED';
    planInputHash: IntegrityHash;
    planHash: IntegrityHash;
}>;
export declare function logicalOrderKey(input: Readonly<{
    portfolioId: PortfolioId;
    instrumentId: InstrumentId;
    side: string;
    semanticAction: unknown;
}>): IntegrityHash;
export declare function planLogicalOrderKeys(buckets: ActionBuckets): readonly IntegrityHash[];
export declare function comparePlanEquivalence(left: ComparablePlan, right: ComparablePlan): PlanEquivalence;
export declare function canSupersedePlan(prior: SupersedablePlan, next: Pick<SupersedablePlan, 'planInputHash' | 'planHash'>): boolean;
export declare function createSemanticPlanHash(input: Readonly<{
    portfolioId: PortfolioId;
    planInputHash: IntegrityHash;
    idealTarget: unknown;
    executableTarget: unknown;
    actionBuckets: ActionBuckets;
    implementationShortfall: unknown;
    turnoverBudget: unknown;
    timing: unknown;
    summary: unknown;
}>): IntegrityHash;
export {};
