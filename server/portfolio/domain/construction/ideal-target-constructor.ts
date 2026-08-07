import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { InstrumentId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { U04_RATE_SCALE, U04_WEIGHT_SCALE } from '../shared/rebalancing-constants.ts'
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts'
import type { SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts'
import { createWeight, type Weight } from '../shared/weight.ts'
import type {
  CandidateProjection,
  ProjectedCandidate,
} from './candidate-projection.ts'
import type {
  ConstructionConstraintSet,
  PlanningCandidate,
} from './planning-context.ts'

export type IdealTargetPosition = Readonly<{
  instrumentId: InstrumentId
  rank: number
  compositeScorePpm: bigint
  inverseVolatilityWeight: Weight
  targetWeight: Weight
  targetValue: Money
  bindingConstraintIds: readonly RebalancingConstraintId[]
}>

export type IdealCandidateExclusion = Readonly<{
  instrumentId: InstrumentId
  reasonBundle: SafeReasonBundle
  excludedAtStage: 'ELIGIBILITY_GATE' | 'IDEAL_TARGET'
}>

export type IdealTarget = Readonly<{
  totalEquityWeight: Weight
  cashWeight: Weight
  positions: readonly IdealTargetPosition[]
  excludedCandidates: readonly IdealCandidateExclusion[]
}>

function rawIntent(candidate: PlanningCandidate): bigint {
  if (
    candidate.convictionMultiplier.numerator <= 0n
    || candidate.realizedVolatility.numerator <= 0n
  ) return 0n
  return candidate.convictionMultiplier.numerator
    * candidate.realizedVolatility.scale
    * U04_RATE_SCALE
    / (candidate.convictionMultiplier.scale * candidate.realizedVolatility.numerator)
}

function ranked(left: ProjectedCandidate, right: ProjectedCandidate): number {
  return left.candidate.rank - right.candidate.rank
    || (left.candidate.instrumentId < right.candidate.instrumentId ? -1 : 1)
}

function minimum(left: bigint, ...rest: readonly bigint[]): bigint {
  return rest.reduce((value, item) => item < value ? item : value, left)
}

export function constructIdealTarget(input: Readonly<{
  projection: CandidateProjection
  startingNav: Money
  constraints: ConstructionConstraintSet
}>): DomainResult<IdealTarget> {
  if (input.startingNav.minorUnits < 0n) {
    return failure(domainFailure('IDEAL_TARGET_ARITHMETIC_FAILURE', { field: 'startingNav' }))
  }
  const rankedCandidates = [
    ...input.projection.holdEligibleIncumbents,
    ...input.projection.newEntrants,
  ].sort(ranked)
  const selected = rankedCandidates.slice(0, input.constraints.targetHoldings)
  const scores = selected.map(({ candidate }) => rawIntent(candidate))
  if (scores.some((score) => score <= 0n)) {
    return failure(domainFailure('INVALID_VOLATILITY_INPUT', { field: 'realizedVolatility' }))
  }
  const rawTotal = scores.reduce((total, value) => total + value, 0n)
  const equityBudget = minimum(
    input.constraints.regimeExposureCap.partsPerMillion,
    U04_WEIGHT_SCALE - input.constraints.cashBufferFloor.partsPerMillion,
  )
  const sectorUsed = new Map<string, bigint>()
  const groupUsed = new Map<string, bigint>()
  let smallCapUsed = 0n
  const positions: IdealTargetPosition[] = []

  for (let index = 0; index < selected.length; index += 1) {
    const projectedCandidate = selected[index]
    const score = scores[index]
    if (projectedCandidate === undefined || score === undefined) continue
    const candidate = projectedCandidate.candidate
    const unconstrained = rawTotal === 0n ? 0n : score * equityBudget / rawTotal
    const liquidityLimit = input.startingNav.minorUnits === 0n
      ? 0n
      : candidate.liquidityCapacity.minorUnits * U04_WEIGHT_SCALE
        / input.startingNav.minorUnits
    const sectorRemaining = candidate.sectorId === undefined
      ? (candidate.currentHolding === undefined ? 0n : unconstrained)
      : input.constraints.maxSectorWeight.partsPerMillion
        - (sectorUsed.get(candidate.sectorId) ?? 0n)
    const groupRemaining = candidate.groupId === undefined
      ? (candidate.currentHolding === undefined ? 0n : unconstrained)
      : input.constraints.maxGroupWeight.partsPerMillion
        - (groupUsed.get(candidate.groupId) ?? 0n)
    const smallCapRemaining = candidate.marketCapBucket === 'SMALL_CAP'
      ? input.constraints.maxSmallCapWeight.partsPerMillion - smallCapUsed
      : unconstrained
    const targetPpm = minimum(
      unconstrained,
      input.constraints.maxStockWeight.partsPerMillion,
      liquidityLimit,
      sectorRemaining < 0n ? 0n : sectorRemaining,
      groupRemaining < 0n ? 0n : groupRemaining,
      smallCapRemaining < 0n ? 0n : smallCapRemaining,
    )
    if (targetPpm === 0n) continue
    const targetWeight = createWeight(targetPpm)
    const inverseVolatilityWeight = createWeight(unconstrained)
    const targetValue = createMoney(
      input.startingNav.minorUnits * targetPpm / U04_WEIGHT_SCALE,
    )
    if (!targetWeight.ok || !inverseVolatilityWeight.ok || !targetValue.ok) {
      return failure(domainFailure('IDEAL_TARGET_ARITHMETIC_FAILURE', { field: 'target' }))
    }
    const bindingConstraintIds: RebalancingConstraintId[] = []
    if (targetPpm < unconstrained) {
      if (targetPpm === input.constraints.maxStockWeight.partsPerMillion) {
        bindingConstraintIds.push('SINGLE_NAME_CAP')
      } else if (targetPpm === liquidityLimit) {
        bindingConstraintIds.push('LIQUIDITY_CAP')
      } else if (candidate.marketCapBucket === 'SMALL_CAP' && targetPpm === smallCapRemaining) {
        bindingConstraintIds.push('SMALL_CAP_CAP')
      } else if (targetPpm === groupRemaining) {
        bindingConstraintIds.push('GROUP_CAP')
      } else {
        bindingConstraintIds.push('SECTOR_CAP')
      }
    }
    if (candidate.sectorId !== undefined) {
      sectorUsed.set(candidate.sectorId, (sectorUsed.get(candidate.sectorId) ?? 0n) + targetPpm)
    }
    if (candidate.groupId !== undefined) {
      groupUsed.set(candidate.groupId, (groupUsed.get(candidate.groupId) ?? 0n) + targetPpm)
    }
    if (candidate.marketCapBucket === 'SMALL_CAP') smallCapUsed += targetPpm
    positions.push(Object.freeze({
      instrumentId: candidate.instrumentId,
      rank: candidate.rank,
      compositeScorePpm: candidate.compositeScorePpm,
      inverseVolatilityWeight: inverseVolatilityWeight.value,
      targetWeight: targetWeight.value,
      targetValue: targetValue.value,
      bindingConstraintIds: Object.freeze(bindingConstraintIds),
    }))
  }

  positions.sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
  const totalPpm = positions.reduce(
    (total, position) => total + position.targetWeight.partsPerMillion,
    0n,
  )
  const totalEquityWeight = createWeight(totalPpm)
  const cashWeight = createWeight(U04_WEIGHT_SCALE - totalPpm)
  if (!totalEquityWeight.ok || !cashWeight.ok) {
    return failure(domainFailure('IDEAL_TARGET_ARITHMETIC_FAILURE', { field: 'weights' }))
  }
  const exclusions = [
    ...input.projection.mandatoryExits,
    ...input.projection.excludedCandidates,
    ...input.projection.blockedCandidates,
    ...rankedCandidates.slice(input.constraints.targetHoldings),
  ].map((entry) => Object.freeze({
    instrumentId: entry.candidate.instrumentId,
    reasonBundle: entry.reasonBundle,
    excludedAtStage: entry.candidate.eligibilityStatus === 'INELIGIBLE'
      ? 'ELIGIBILITY_GATE' as const
      : 'IDEAL_TARGET' as const,
  })).sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)

  return success(Object.freeze({
    totalEquityWeight: totalEquityWeight.value,
    cashWeight: cashWeight.value,
    positions: Object.freeze(positions),
    excludedCandidates: Object.freeze(exclusions),
  }))
}
