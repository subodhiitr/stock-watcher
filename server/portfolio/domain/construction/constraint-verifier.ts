import type { InstrumentId } from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import {
  REBALANCING_CONSTRAINT_IDS,
  type RebalancingConstraintId,
} from '../shared/rebalancing-reasons.ts'
import { U04_WEIGHT_SCALE } from '../shared/rebalancing-constants.ts'
import {
  buildSafeReasonBundle,
  type SafeReasonBundle,
} from '../shared/safe-observability-payload-builder.ts'
import type { Weight } from '../shared/weight.ts'
import type {
  ConstructionConstraintSet,
  MarketCapBucket,
  PlanningTiming,
} from './planning-context.ts'

export type VerifiablePosition = Readonly<{
  instrumentId: InstrumentId
  decisionPrice: Money
  targetQuantity: Quantity
  targetValue: Money
  targetWeight: Weight
  currentQuantity: Quantity
  availableDeliveryQuantity: Quantity
  liquidityCapacity: Money
  sectorId?: string
  groupId?: string
  marketCapBucket?: MarketCapBucket
}>

export type ConstraintCheck = Readonly<{
  constraintId: RebalancingConstraintId
  passed: boolean
  actual?: bigint
  limit?: bigint
  reasonBundle?: SafeReasonBundle
}>

export type ConstraintVerification = Readonly<{
  accepted: boolean
  checks: readonly ConstraintCheck[]
  violatedConstraintIds: readonly RebalancingConstraintId[]
}>

function check(
  constraintId: RebalancingConstraintId,
  passed: boolean,
  actual?: bigint,
  limit?: bigint,
): ConstraintCheck {
  if (passed) {
    return Object.freeze({
      constraintId,
      passed,
      ...(actual === undefined ? {} : { actual }),
      ...(limit === undefined ? {} : { limit }),
    })
  }
  const reason = buildSafeReasonBundle({
    primaryCode: 'NO_TRADE_REQUIRED',
    explanationKey: 'PREREQUISITE_BLOCK',
    constraintIds: [constraintId],
  })
  if (!reason.ok) {
    throw new TypeError('Invalid constraint reason')
  }
  return Object.freeze({
    constraintId,
    passed,
    ...(actual === undefined ? {} : { actual }),
    ...(limit === undefined ? {} : { limit }),
    reasonBundle: reason.value,
  })
}

function aggregateWeight(
  positions: readonly VerifiablePosition[],
  key: 'sectorId' | 'groupId',
): bigint {
  const totals = new Map<string, bigint>()
  for (const position of positions) {
    const id = position[key]
    if (id !== undefined) {
      totals.set(id, (totals.get(id) ?? 0n) + position.targetWeight.partsPerMillion)
    }
  }
  return [...totals.values()].reduce((maximum, value) => value > maximum ? value : maximum, 0n)
}

export function verifyConstructionConstraints(input: Readonly<{
  positions: readonly VerifiablePosition[]
  residualCash: Money
  startingNav: Money
  constraints: ConstructionConstraintSet
  proposedTurnoverPpm: bigint
  timing: PlanningTiming
}>): ConstraintVerification {
  const totalValue = input.positions.reduce(
    (total, position) => total + position.targetValue.minorUnits,
    0n,
  )
  const totalWeight = input.positions.reduce(
    (total, position) => total + position.targetWeight.partsPerMillion,
    0n,
  )
  const maximumStockWeight = input.positions.reduce(
    (maximum, position) =>
      position.targetWeight.partsPerMillion > maximum
        ? position.targetWeight.partsPerMillion
        : maximum,
    0n,
  )
  const maximumSectorWeight = aggregateWeight(input.positions, 'sectorId')
  const maximumGroupWeight = aggregateWeight(input.positions, 'groupId')
  const smallCapWeight = input.positions.reduce(
    (total, position) =>
      total + (position.marketCapBucket === 'SMALL_CAP'
        ? position.targetWeight.partsPerMillion
        : 0n),
    0n,
  )
  const deliveryExceeded = input.positions.some((position) => {
    const reduction = position.currentQuantity.shares - position.targetQuantity.shares
    return reduction > position.availableDeliveryQuantity.shares
  })
  const liquidityExceeded = input.positions.some((position) =>
    position.targetValue.minorUnits > position.liquidityCapacity.minorUnits)
  const shortPosition = input.positions.some((position) => position.targetQuantity.shares < 0n)
  const minimumOrderValueViolated = input.positions.some((position) => {
    const delta = position.targetQuantity.shares - position.currentQuantity.shares
    const absoluteDelta = delta < 0n ? -delta : delta
    return absoluteDelta > 0n
      && absoluteDelta * position.decisionPrice.minorUnits
        < input.constraints.minimumOrderValue.minorUnits
  })

  const checks: ConstraintCheck[] = [
    check('NO_NEGATIVE_CASH', input.residualCash.minorUnits >= 0n, input.residualCash.minorUnits, 0n),
    check('NO_SHORTING', !shortPosition),
    check(
      'NO_LEVERAGE',
      totalValue + input.residualCash.minorUnits <= input.startingNav.minorUnits,
      totalValue + input.residualCash.minorUnits,
      input.startingNav.minorUnits,
    ),
    check(
      'EXPOSURE_CAP',
      totalWeight <= input.constraints.regimeExposureCap.partsPerMillion,
      totalWeight,
      input.constraints.regimeExposureCap.partsPerMillion,
    ),
    check(
      'CASH_BUFFER',
      input.startingNav.minorUnits === 0n
        || input.residualCash.minorUnits * U04_WEIGHT_SCALE
          >= input.startingNav.minorUnits * input.constraints.cashBufferFloor.partsPerMillion,
      input.residualCash.minorUnits,
    ),
    check(
      'SINGLE_NAME_CAP',
      maximumStockWeight <= input.constraints.maxStockWeight.partsPerMillion,
      maximumStockWeight,
      input.constraints.maxStockWeight.partsPerMillion,
    ),
    check(
      'SECTOR_CAP',
      maximumSectorWeight <= input.constraints.maxSectorWeight.partsPerMillion,
      maximumSectorWeight,
      input.constraints.maxSectorWeight.partsPerMillion,
    ),
    check(
      'GROUP_CAP',
      maximumGroupWeight <= input.constraints.maxGroupWeight.partsPerMillion,
      maximumGroupWeight,
      input.constraints.maxGroupWeight.partsPerMillion,
    ),
    check(
      'SMALL_CAP_CAP',
      smallCapWeight <= input.constraints.maxSmallCapWeight.partsPerMillion,
      smallCapWeight,
      input.constraints.maxSmallCapWeight.partsPerMillion,
    ),
    check('LIQUIDITY_CAP', !liquidityExceeded),
    check(
      'MINIMUM_ORDER_VALUE',
      !minimumOrderValueViolated,
      undefined,
      input.constraints.minimumOrderValue.minorUnits,
    ),
    check(
      'TURNOVER_BUDGET',
      input.proposedTurnoverPpm <= input.constraints.turnoverBudgetCeiling.numerator
        * U04_WEIGHT_SCALE / input.constraints.turnoverBudgetCeiling.scale,
      input.proposedTurnoverPpm,
      input.constraints.turnoverBudgetCeiling.numerator * U04_WEIGHT_SCALE
        / input.constraints.turnoverBudgetCeiling.scale,
    ),
    check('AVAILABLE_DELIVERY', !deliveryExceeded),
    check(
      'NEXT_ELIGIBLE_SESSION',
      !input.timing.sameSessionExecutionAllowed
        && input.timing.eligibleExecutionDate > input.timing.decisionSessionDate,
    ),
  ]

  const violatedConstraintIds = Object.freeze(
    REBALANCING_CONSTRAINT_IDS.filter((id) =>
      checks.some((item) => item.constraintId === id && !item.passed)),
  )
  return Object.freeze({
    accepted: violatedConstraintIds.length === 0,
    checks: Object.freeze(checks),
    violatedConstraintIds,
  })
}
