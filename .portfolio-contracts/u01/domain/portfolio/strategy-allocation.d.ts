import { type DomainResult } from '../errors/result.ts';
import { type AllocationId, type PortfolioId, type StrategyAssignmentId, type StrategySleeveId, type StrategyVersionId } from '../shared/identifiers.ts';
import { type Instant } from '../shared/time.ts';
import type { Weight } from '../shared/weight.ts';
import { type StrategyEligibilityEvidence } from './evidence.ts';
export type SingleStrategyAllocation = Readonly<{
    kind: 'SINGLE';
    assignmentId: StrategyAssignmentId;
    strategyVersionId: StrategyVersionId;
    weight: Weight;
    effectiveAt: Instant;
    evidenceReference: StrategyEligibilityEvidence;
}>;
export type SleeveAssignment = Readonly<{
    sleeveId: StrategySleeveId;
    assignmentId: StrategyAssignmentId;
    strategyVersionId: StrategyVersionId;
    weight: Weight;
    effectiveAt: Instant;
    evidenceReference: StrategyEligibilityEvidence;
}>;
export type MultiSleeveAllocation = Readonly<{
    kind: 'SLEEVES';
    allocationId: AllocationId;
    sleeves: readonly SleeveAssignment[];
    effectiveAt: Instant;
}>;
export type StrategyAllocationPolicy = SingleStrategyAllocation | MultiSleeveAllocation;
export declare function createSingleStrategyAllocation(portfolioId: PortfolioId, input: Omit<SingleStrategyAllocation, 'kind'>): DomainResult<SingleStrategyAllocation>;
export declare function createMultiSleeveAllocation(portfolioId: PortfolioId, input: Omit<MultiSleeveAllocation, 'kind' | 'sleeves'> & {
    sleeves: readonly SleeveAssignment[];
}): DomainResult<MultiSleeveAllocation>;
export declare function allocationPolicyIdentity(policy: StrategyAllocationPolicy): string;
export declare function allocationPoliciesEqual(left: StrategyAllocationPolicy, right: StrategyAllocationPolicy): boolean;
export declare function validateStrategyAllocationPolicy(portfolioId: PortfolioId, policy: StrategyAllocationPolicy): DomainResult<StrategyAllocationPolicy>;
