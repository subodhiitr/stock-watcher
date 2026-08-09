import {
  verifyConstructionConstraints,
  type ConstraintCheck,
  type VerifiablePosition,
} from '../construction/constraint-verifier.ts'
import type {
  ConstructionConstraintSet,
  PlanningCandidate,
  PlanningTiming,
} from '../construction/planning-context.ts'
import type { IdealTarget } from '../construction/ideal-target-constructor.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { InstrumentId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'
import { U04_WEIGHT_SCALE } from '../shared/rebalancing-constants.ts'
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts'
import { createWeight, type Weight } from '../shared/weight.ts'

export type ExecutableTargetPosition = Readonly<{
  instrumentId: InstrumentId
  targetWeight: Weight
  targetQuantity: Quantity
  targetValue: Money
  deltaQuantityShares: bigint
  deltaValue: Money
  bindingConstraintIds: readonly RebalancingConstraintId[]
}>

export type ExecutableTarget = Readonly<{
  allocationMethod: 'GREEDY' | 'OPTIMIZER_VERIFIED_FALLBACK' | 'OPTIMIZER_PRIMARY'
  totalEquityWeight: Weight
  cashWeight: Weight
  residualCash: Money
  positions: readonly ExecutableTargetPosition[]
  constraintChecks: readonly ConstraintCheck[]
  noTrade: boolean
}>

type MutablePosition = {
  candidate: PlanningCandidate
  idealValueMinorUnits: bigint
  targetQuantityShares: bigint
  bindingConstraintIds: RebalancingConstraintId[]
  fixedByPolicy: boolean
}

function asVerifiable(
  position: MutablePosition,
  startingNav: Money,
): VerifiablePosition {
  const targetValueMinorUnits =
    position.targetQuantityShares * position.candidate.price.minorUnits
  const weightPpm = startingNav.minorUnits === 0n
    ? 0n
    : targetValueMinorUnits * U04_WEIGHT_SCALE / startingNav.minorUnits
  const quantity = createQuantity(position.targetQuantityShares)
  const value = createMoney(targetValueMinorUnits)
  const weight = createWeight(weightPpm)
  if (!quantity.ok || !value.ok || !weight.ok) {
    throw new TypeError('Invalid executable position')
  }
  const currentQuantity = position.candidate.currentHolding?.totalQuantity
    ?? Object.freeze({ shares: 0n })
  const liquidityCapacity = position.candidate.currentHolding === undefined
    ? position.candidate.liquidityCapacity
    : Object.freeze({
      currency: 'INR',
      minorUnits: position.candidate.liquidityCapacity.minorUnits > targetValueMinorUnits
        ? position.candidate.liquidityCapacity.minorUnits
        : targetValueMinorUnits,
    })
  return {
    instrumentId: position.candidate.instrumentId,
    decisionPrice: position.candidate.price,
    targetQuantity: quantity.value,
    targetValue: value.value,
    targetWeight: weight.value,
    currentQuantity,
    availableDeliveryQuantity: position.candidate.availableDeliveryQuantity,
    liquidityCapacity,
    ...(position.candidate.sectorId === undefined
      ? {} : { sectorId: position.candidate.sectorId }),
    ...(position.candidate.groupId === undefined
      ? {} : { groupId: position.candidate.groupId }),
    ...(position.candidate.marketCapBucket === undefined
      ? {} : { marketCapBucket: position.candidate.marketCapBucket }),
  }
}

function turnoverPpm(
  positions: readonly MutablePosition[],
  startingNav: Money,
): bigint {
  if (startingNav.minorUnits <= 0n) return 0n
  let buys = 0n
  let sells = 0n
  for (const position of positions) {
    const current = position.candidate.currentHolding?.totalQuantity.shares ?? 0n
    const delta = position.targetQuantityShares - current
    const notional = (delta < 0n ? -delta : delta) * position.candidate.price.minorUnits
    if (delta >= 0n) buys += notional
    else sells += notional
  }
  return (buys > sells ? buys : sells) * U04_WEIGHT_SCALE / startingNav.minorUnits
}

export function allocateWholeSharesGreedy(input: Readonly<{
  idealTarget: IdealTarget
  candidates: readonly PlanningCandidate[]
  startingNav: Money
  constraints: ConstructionConstraintSet
  timing: PlanningTiming
  fixedTargetQuantityByInstrument?: ReadonlyMap<InstrumentId, Quantity>
}>): DomainResult<ExecutableTarget> {
  if (input.startingNav.minorUnits < 0n) {
    return failure(domainFailure('NEGATIVE_EXECUTABLE_CASH', { field: 'startingNav' }))
  }
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.instrumentId, candidate] as const),
  )
  const idealById = new Map(
    input.idealTarget.positions.map((position) => [position.instrumentId, position] as const),
  )
  const ids = new Set<InstrumentId>([
    ...candidateById.keys(),
    ...idealById.keys(),
  ])
  const positions: MutablePosition[] = []
  for (const instrumentId of ids) {
    const candidate = candidateById.get(instrumentId)
    if (candidate === undefined) {
      return failure(domainFailure('CANDIDATE_LINEAGE_MISSING', { field: 'instrumentId' }))
    }
    const ideal = idealById.get(instrumentId)
    const idealValueMinorUnits = ideal?.targetValue.minorUnits ?? 0n
    const fixedTargetQuantity = input.fixedTargetQuantityByInstrument?.get(instrumentId)
    let targetQuantityShares = fixedTargetQuantity?.shares
      ?? idealValueMinorUnits / candidate.price.minorUnits
    const currentShares = candidate.currentHolding?.totalQuantity.shares ?? 0n
    const minimumDeliverableTarget =
      currentShares - candidate.availableDeliveryQuantity.shares
    if (targetQuantityShares < minimumDeliverableTarget) {
      targetQuantityShares = minimumDeliverableTarget
    }
    positions.push({
      candidate,
      idealValueMinorUnits,
      targetQuantityShares,
      bindingConstraintIds: [...(ideal?.bindingConstraintIds ?? [])],
      fixedByPolicy: fixedTargetQuantity !== undefined,
    })
  }
  positions.sort((left, right) =>
    left.candidate.instrumentId < right.candidate.instrumentId ? -1
      : left.candidate.instrumentId > right.candidate.instrumentId ? 1 : 0)

  let totalValue = positions.reduce(
    (total, position) =>
      total + position.targetQuantityShares * position.candidate.price.minorUnits,
    0n,
  )
  let residualCash = input.startingNav.minorUnits - totalValue
  if (residualCash < 0n) {
    return failure(domainFailure('NEGATIVE_EXECUTABLE_CASH', { field: 'residualCash' }))
  }

  const increments = positions
    .filter((position) =>
      !position.fixedByPolicy
      && position.targetQuantityShares * position.candidate.price.minorUnits
        < position.idealValueMinorUnits)
    .sort((left, right) => {
      const leftGap = left.idealValueMinorUnits
        - left.targetQuantityShares * left.candidate.price.minorUnits
      const rightGap = right.idealValueMinorUnits
        - right.targetQuantityShares * right.candidate.price.minorUnits
      if (leftGap !== rightGap) return leftGap > rightGap ? -1 : 1
      return left.candidate.rank - right.candidate.rank
        || (left.candidate.instrumentId < right.candidate.instrumentId ? -1 : 1)
    })
  for (const position of increments) {
    const price = position.candidate.price.minorUnits
    if (price > residualCash) continue
    position.targetQuantityShares += 1n
    const trialPositions = positions.map((item) => asVerifiable(item, input.startingNav))
    const trialResidualCash = createMoney(residualCash - price)
    if (!trialResidualCash.ok) {
      position.targetQuantityShares -= 1n
      continue
    }
    const verification = verifyConstructionConstraints({
      positions: trialPositions,
      residualCash: trialResidualCash.value,
      startingNav: input.startingNav,
      constraints: input.constraints,
      proposedTurnoverPpm: turnoverPpm(positions, input.startingNav),
      timing: input.timing,
    })
    if (verification.accepted) {
      residualCash -= price
      totalValue += price
    } else {
      position.targetQuantityShares -= 1n
      position.bindingConstraintIds.push(...verification.violatedConstraintIds)
    }
  }

  const verifiablePositions = positions.map((position) =>
    asVerifiable(position, input.startingNav))
  const residualCashValue = createMoney(residualCash)
  if (!residualCashValue.ok) {
    return failure(domainFailure('NEGATIVE_EXECUTABLE_CASH', { field: 'residualCash' }))
  }
  const verification = verifyConstructionConstraints({
    positions: verifiablePositions,
    residualCash: residualCashValue.value,
    startingNav: input.startingNav,
    constraints: input.constraints,
    proposedTurnoverPpm: turnoverPpm(positions, input.startingNav),
    timing: input.timing,
  })
  if (!verification.accepted) {
    return failure(domainFailure('EXECUTABLE_RECONCILIATION_FAILURE', {
      field: 'constraintChecks',
    }))
  }
  const executablePositions: ExecutableTargetPosition[] = verifiablePositions.map(
    (position, index) => {
      const mutable = positions[index]
      if (mutable === undefined) throw new TypeError('Missing executable position')
      const currentShares = mutable.candidate.currentHolding?.totalQuantity.shares ?? 0n
      const deltaQuantityShares = position.targetQuantity.shares - currentShares
      const deltaValue = createMoney(
        deltaQuantityShares * mutable.candidate.price.minorUnits,
      )
      if (!deltaValue.ok) throw new TypeError('Invalid executable delta')
      return Object.freeze({
        instrumentId: position.instrumentId,
        targetWeight: position.targetWeight,
        targetQuantity: position.targetQuantity,
        targetValue: position.targetValue,
        deltaQuantityShares,
        deltaValue: deltaValue.value,
        bindingConstraintIds: Object.freeze([...new Set(mutable.bindingConstraintIds)].sort()),
      })
    },
  )
  const totalWeight = createWeight(executablePositions.reduce(
    (total, position) => total + position.targetWeight.partsPerMillion,
    0n,
  ))
  const cashWeight = createWeight(
    input.startingNav.minorUnits === 0n
      ? U04_WEIGHT_SCALE
      : residualCash * U04_WEIGHT_SCALE / input.startingNav.minorUnits,
  )
  if (!totalWeight.ok || !cashWeight.ok) {
    return failure(domainFailure('EXECUTABLE_RECONCILIATION_FAILURE', { field: 'weights' }))
  }
  return success(Object.freeze({
    allocationMethod: 'GREEDY',
    totalEquityWeight: totalWeight.value,
    cashWeight: cashWeight.value,
    residualCash: residualCashValue.value,
    positions: Object.freeze(executablePositions),
    constraintChecks: verification.checks,
    noTrade: executablePositions.every((position) => position.deltaQuantityShares === 0n),
  }))
}
