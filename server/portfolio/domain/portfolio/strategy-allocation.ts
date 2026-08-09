import { MAX_STRATEGY_SLEEVES, WEIGHT_SCALE } from '../shared/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  compareIdentifiers,
  parseAllocationId,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategySleeveId,
  parseStrategyVersionId,
  type AllocationId,
  type PortfolioId,
  type StrategyAssignmentId,
  type StrategySleeveId,
  type StrategyVersionId,
} from '../shared/identifiers.ts'
import { compareInstants, type Instant } from '../shared/time.ts'
import type { Weight } from '../shared/weight.ts'
import {
  validateStrategyEvidence,
  type StrategyEligibilityEvidence,
} from './evidence.ts'

export type SingleStrategyAllocation = Readonly<{
  kind: 'SINGLE'
  assignmentId: StrategyAssignmentId
  strategyVersionId: StrategyVersionId
  weight: Weight
  effectiveAt: Instant
  evidenceReference: StrategyEligibilityEvidence
}>

export type SleeveAssignment = Readonly<{
  sleeveId: StrategySleeveId
  assignmentId: StrategyAssignmentId
  strategyVersionId: StrategyVersionId
  weight: Weight
  effectiveAt: Instant
  evidenceReference: StrategyEligibilityEvidence
}>

export type MultiSleeveAllocation = Readonly<{
  kind: 'SLEEVES'
  allocationId: AllocationId
  sleeves: readonly SleeveAssignment[]
  effectiveAt: Instant
}>

export type StrategyAllocationPolicy =
  | SingleStrategyAllocation
  | MultiSleeveAllocation

export function createSingleStrategyAllocation(
  portfolioId: PortfolioId,
  input: Omit<SingleStrategyAllocation, 'kind'>,
): DomainResult<SingleStrategyAllocation> {
  if (
    !parsePortfolioId(portfolioId).ok
    || !parseStrategyAssignmentId(input.assignmentId).ok
    || !parseStrategyVersionId(input.strategyVersionId).ok
  ) {
    return failure(domainFailure('INVALID_SINGLE_ASSIGNMENT', { field: 'identifier' }))
  }
  if (input.weight.partsPerMillion !== WEIGHT_SCALE) {
    return failure(domainFailure('INVALID_SINGLE_ASSIGNMENT', { field: 'weight' }))
  }
  const evidence = validateStrategyEvidence(
    input.evidenceReference,
    portfolioId,
    input.strategyVersionId,
    input.effectiveAt,
  )
  if (!evidence.ok) {
    return evidence
  }
  return success(Object.freeze({
    kind: 'SINGLE',
    ...input,
    evidenceReference: evidence.value,
  }))
}

export function createMultiSleeveAllocation(
  portfolioId: PortfolioId,
  input: Omit<MultiSleeveAllocation, 'kind' | 'sleeves'> & {
    sleeves: readonly SleeveAssignment[]
  },
): DomainResult<MultiSleeveAllocation> {
  if (!parsePortfolioId(portfolioId).ok || !parseAllocationId(input.allocationId).ok) {
    return failure(domainFailure('INVALID_ALLOCATION_POLICY', { field: 'identifier' }))
  }
  if (input.sleeves.length < 2) {
    return failure(domainFailure('INSUFFICIENT_SLEEVES', { field: 'sleeves' }))
  }
  if (input.sleeves.length > MAX_STRATEGY_SLEEVES) {
    return failure(domainFailure('CAPACITY_EXCEEDED', {
      field: 'sleeves',
      context: { maximum: MAX_STRATEGY_SLEEVES },
    }))
  }

  const sleeveIds = new Set<string>()
  const assignmentIds = new Set<string>()
  const strategyVersionIds = new Set<string>()
  let totalWeight = 0n
  const sleeves: SleeveAssignment[] = []

  for (const sleeve of input.sleeves) {
    if (
      !parseStrategySleeveId(sleeve.sleeveId).ok
      || !parseStrategyAssignmentId(sleeve.assignmentId).ok
      || !parseStrategyVersionId(sleeve.strategyVersionId).ok
    ) {
      return failure(domainFailure('INVALID_ALLOCATION_POLICY', { field: 'identifier' }))
    }
    if (sleeveIds.has(sleeve.sleeveId)) {
      return failure(domainFailure('DUPLICATE_SLEEVE_ID', { field: 'sleeves' }))
    }
    if (strategyVersionIds.has(sleeve.strategyVersionId)) {
      return failure(domainFailure('DUPLICATE_STRATEGY_SLEEVE', { field: 'sleeves' }))
    }
    if (assignmentIds.has(sleeve.assignmentId)) {
      return failure(domainFailure('INVALID_ALLOCATION_POLICY', { field: 'assignmentId' }))
    }
    if (sleeve.weight.partsPerMillion <= 0n) {
      return failure(domainFailure('INVALID_SLEEVE_WEIGHT_TOTAL', { field: 'weight' }))
    }
    if (compareInstants(sleeve.effectiveAt, input.effectiveAt) > 0) {
      return failure(domainFailure('INVALID_ALLOCATION_POLICY', { field: 'effectiveAt' }))
    }
    const evidence = validateStrategyEvidence(
      sleeve.evidenceReference,
      portfolioId,
      sleeve.strategyVersionId,
      sleeve.effectiveAt,
    )
    if (!evidence.ok) {
      return evidence
    }

    sleeveIds.add(sleeve.sleeveId)
    assignmentIds.add(sleeve.assignmentId)
    strategyVersionIds.add(sleeve.strategyVersionId)
    totalWeight += sleeve.weight.partsPerMillion
    sleeves.push(Object.freeze({ ...sleeve, evidenceReference: evidence.value }))
  }

  if (totalWeight !== WEIGHT_SCALE) {
    return failure(domainFailure('INVALID_SLEEVE_WEIGHT_TOTAL', {
      field: 'sleeves',
      context: { expected: WEIGHT_SCALE.toString(), actual: totalWeight.toString() },
    }))
  }

  sleeves.sort((left, right) => compareIdentifiers(left.sleeveId, right.sleeveId))
  return success(Object.freeze({
    kind: 'SLEEVES',
    allocationId: input.allocationId,
    sleeves: Object.freeze(sleeves),
    effectiveAt: input.effectiveAt,
  }))
}

export function allocationPolicyIdentity(policy: StrategyAllocationPolicy): string {
  return policy.kind === 'SINGLE' ? policy.assignmentId : policy.allocationId
}

export function allocationPoliciesEqual(
  left: StrategyAllocationPolicy,
  right: StrategyAllocationPolicy,
): boolean {
  if (left.kind !== right.kind || allocationPolicyIdentity(left) !== allocationPolicyIdentity(right)) {
    return false
  }

  if (left.kind === 'SINGLE' && right.kind === 'SINGLE') {
    return (
      left.strategyVersionId === right.strategyVersionId
      && left.weight.partsPerMillion === right.weight.partsPerMillion
      && left.effectiveAt === right.effectiveAt
      && left.evidenceReference.evidenceId === right.evidenceReference.evidenceId
    )
  }
  if (left.kind === 'SLEEVES' && right.kind === 'SLEEVES') {
    return left.effectiveAt === right.effectiveAt
      && left.sleeves.length === right.sleeves.length
      && left.sleeves.every((sleeve, index) => {
        const other = right.sleeves[index]
        return other !== undefined
          && sleeve.sleeveId === other.sleeveId
          && sleeve.assignmentId === other.assignmentId
          && sleeve.strategyVersionId === other.strategyVersionId
          && sleeve.weight.partsPerMillion === other.weight.partsPerMillion
          && sleeve.effectiveAt === other.effectiveAt
          && sleeve.evidenceReference.evidenceId === other.evidenceReference.evidenceId
      })
  }
  return false
}

export function validateStrategyAllocationPolicy(
  portfolioId: PortfolioId,
  policy: StrategyAllocationPolicy,
): DomainResult<StrategyAllocationPolicy> {
  if (policy.kind === 'SINGLE') {
    return createSingleStrategyAllocation(portfolioId, policy)
  }
  if (policy.kind === 'SLEEVES') {
    const validated = createMultiSleeveAllocation(portfolioId, policy)
    if (!validated.ok) {
      return validated
    }
    const isCanonical = policy.sleeves.every(
      (sleeve, index) => sleeve.sleeveId === validated.value.sleeves[index]?.sleeveId,
    )
    if (!isCanonical) {
      return failure(domainFailure('NON_CANONICAL_SLEEVE_ORDER', { field: 'sleeves' }))
    }
    return validated
  }
  return failure(domainFailure('INVALID_ALLOCATION_POLICY', { field: 'kind' }))
}
