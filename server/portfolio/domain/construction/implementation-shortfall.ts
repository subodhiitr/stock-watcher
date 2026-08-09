import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { InstrumentId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { U04_WEIGHT_SCALE } from '../shared/rebalancing-constants.ts'
import type { RebalancingConstraintId } from '../shared/rebalancing-reasons.ts'
import { createWeight, type Weight } from '../shared/weight.ts'

export type ImplementationShortfall = Readonly<{
  weightGap: Weight
  cashGap: Weight
  notionalGap: Money
  dragGap: Money
  bindingConstraintIds: readonly RebalancingConstraintId[]
}>

type TargetPosition = Readonly<{
  instrumentId: InstrumentId
  targetWeight: Weight
  targetValue: Money
  bindingConstraintIds?: readonly RebalancingConstraintId[]
}>

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function calculateImplementationShortfall(input: Readonly<{
  idealPositions: readonly TargetPosition[]
  executablePositions: readonly TargetPosition[]
  idealCashWeight: Weight
  executableCashWeight: Weight
  estimatedCost: Money
  estimatedTax: Money
}>): DomainResult<ImplementationShortfall> {
  const executableById = new Map(
    input.executablePositions.map((position) => [position.instrumentId, position] as const),
  )
  let weightGapPpm = 0n
  let notionalGapMinorUnits = 0n
  const bindingConstraintIds = new Set<RebalancingConstraintId>()
  for (const ideal of input.idealPositions) {
    const executable = executableById.get(ideal.instrumentId)
    weightGapPpm += absolute(
      ideal.targetWeight.partsPerMillion
        - (executable?.targetWeight.partsPerMillion ?? 0n),
    )
    notionalGapMinorUnits += absolute(
      ideal.targetValue.minorUnits - (executable?.targetValue.minorUnits ?? 0n),
    )
    for (const id of executable?.bindingConstraintIds ?? []) bindingConstraintIds.add(id)
  }
  const weightGap = createWeight(
    weightGapPpm > U04_WEIGHT_SCALE ? U04_WEIGHT_SCALE : weightGapPpm,
  )
  const cashGap = createWeight(absolute(
    input.executableCashWeight.partsPerMillion - input.idealCashWeight.partsPerMillion,
  ))
  const notionalGap = createMoney(notionalGapMinorUnits)
  const dragGap = createMoney(
    input.estimatedCost.minorUnits + input.estimatedTax.minorUnits,
  )
  if (!weightGap.ok || !cashGap.ok || !notionalGap.ok || !dragGap.ok) {
    return failure(domainFailure('IMPLEMENTATION_SHORTFALL_MISSING', { field: 'shortfall' }))
  }
  return success(Object.freeze({
    weightGap: weightGap.value,
    cashGap: cashGap.value,
    notionalGap: notionalGap.value,
    dragGap: dragGap.value,
    bindingConstraintIds: Object.freeze([...bindingConstraintIds].sort()),
  }))
}
