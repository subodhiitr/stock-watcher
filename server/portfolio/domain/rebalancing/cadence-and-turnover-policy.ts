import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { Money } from '../shared/money.ts'
import { createScaledRate, type ScaledRate } from '../shared/scaled-rate.ts'
import {
  U04_MAX_TURNOVER_WINDOWS,
  U04_RATE_SCALE,
} from '../shared/rebalancing-constants.ts'
import {
  buildSafeReasonBundle,
  type SafeReasonBundle,
} from '../shared/safe-observability-payload-builder.ts'
import type { Weight } from '../shared/weight.ts'
import type {
  CadencePolicySnapshot,
  PlanningTurnoverWindow,
} from '../construction/planning-context.ts'

export type TurnoverWindowBalance = Readonly<{
  windowKind: PlanningTurnoverWindow['windowKind']
  budgetLimit: ScaledRate
  consumedBeforePlan: ScaledRate
  consumedAfterPlan: ScaledRate
  remainingBeforePlan: ScaledRate
  remainingAfterPlan: ScaledRate
}>

export type TurnoverBudgetEvaluation = Readonly<{
  proposedConsumption: ScaledRate
  windows: readonly TurnoverWindowBalance[]
  accepted: boolean
  reasonBundle?: SafeReasonBundle
}>

function exactRate(numerator: bigint): ScaledRate {
  const result = createScaledRate(numerator, U04_RATE_SCALE)
  if (!result.ok) throw new TypeError('Invalid turnover rate')
  return result.value
}

export function isCadenceOpen(input: Readonly<{
  asOf: string
  reviewKind: 'CONSTITUENT' | 'DRIFT'
  cadence: CadencePolicySnapshot
  decisionSessionDate: string
  eligibleExecutionDate: string
}>): DomainResult<boolean> {
  if (
    input.eligibleExecutionDate <= input.decisionSessionDate
    || input.asOf < input.decisionSessionDate
  ) {
    return failure(domainFailure('ROUTINE_TIMING_VIOLATION', { field: 'session' }))
  }
  const nextDate = input.reviewKind === 'CONSTITUENT'
    ? input.cadence.nextRoutineDecisionDate
    : input.cadence.nextDriftReviewDate
  return success(input.asOf >= nextDate)
}

export function calculateDriftBand(input: Readonly<{
  targetWeight: Weight
  absoluteDriftBand: Weight
  relativeDriftBand: ScaledRate
}>): bigint {
  const relative = input.targetWeight.partsPerMillion
    * input.relativeDriftBand.numerator
    / input.relativeDriftBand.scale
  return relative > input.absoluteDriftBand.partsPerMillion
    ? relative
    : input.absoluteDriftBand.partsPerMillion
}

export function evaluateDiscretionaryHolding(input: Readonly<{
  currentWeight: Weight
  targetWeight: Weight
  absoluteDriftBand: Weight
  relativeDriftBand: ScaledRate
  daysHeld: number
  preferredMinimumHoldDays: number
  mandatory: boolean
  holdRankBufferActive?: boolean
  replacementScoreGapPpm?: bigint
  requiredReplacementGapPpm?: bigint
}>): DomainResult<Readonly<{ allowed: boolean; reasonBundle?: SafeReasonBundle }>> {
  if (input.mandatory) return success(Object.freeze({ allowed: true }))
  const drift = input.currentWeight.partsPerMillion > input.targetWeight.partsPerMillion
    ? input.currentWeight.partsPerMillion - input.targetWeight.partsPerMillion
    : input.targetWeight.partsPerMillion - input.currentWeight.partsPerMillion
  let primaryCode: 'INSIDE_DRIFT_BAND' | 'PREFERRED_HOLD_ACTIVE'
    | 'HOLD_RANK_BUFFER_ACTIVE' | 'REPLACEMENT_HURDLE_NOT_MET' | undefined
  if (drift <= calculateDriftBand(input)) {
    primaryCode = 'INSIDE_DRIFT_BAND'
  } else if (input.daysHeld < input.preferredMinimumHoldDays) {
    primaryCode = 'PREFERRED_HOLD_ACTIVE'
  } else if (input.holdRankBufferActive === true) {
    primaryCode = 'HOLD_RANK_BUFFER_ACTIVE'
  } else if (
    input.replacementScoreGapPpm !== undefined
    && input.requiredReplacementGapPpm !== undefined
    && input.replacementScoreGapPpm <= input.requiredReplacementGapPpm
  ) {
    primaryCode = 'REPLACEMENT_HURDLE_NOT_MET'
  }
  if (primaryCode === undefined) return success(Object.freeze({ allowed: true }))
  const reason = buildSafeReasonBundle({
    primaryCode,
    explanationKey: 'POLICY_SKIP',
    constraintIds: primaryCode === 'PREFERRED_HOLD_ACTIVE'
      ? ['PREFERRED_HOLD']
      : primaryCode === 'HOLD_RANK_BUFFER_ACTIVE'
        ? ['HOLD_RANK_BUFFER']
        : primaryCode === 'REPLACEMENT_HURDLE_NOT_MET'
          ? ['REPLACEMENT_HURDLE']
          : [],
  })
  return reason.ok
    ? success(Object.freeze({ allowed: false, reasonBundle: reason.value }))
    : reason
}

export function calculateTurnoverConsumption(input: Readonly<{
  totalBuyNotional: Money
  totalSellNotional: Money
  startingNav: Money
}>): DomainResult<ScaledRate> {
  if (
    input.startingNav.minorUnits <= 0n
    || input.totalBuyNotional.minorUnits < 0n
    || input.totalSellNotional.minorUnits < 0n
  ) {
    return failure(domainFailure('TURNOVER_FORMULA_INVALID', { field: 'notional' }))
  }
  const notional = input.totalBuyNotional.minorUnits > input.totalSellNotional.minorUnits
    ? input.totalBuyNotional.minorUnits
    : input.totalSellNotional.minorUnits
  return createScaledRate(
    notional * U04_RATE_SCALE / input.startingNav.minorUnits,
    U04_RATE_SCALE,
  )
}

export function evaluateTurnoverWindows(input: Readonly<{
  proposedConsumption: ScaledRate
  windows: readonly PlanningTurnoverWindow[]
}>): DomainResult<TurnoverBudgetEvaluation> {
  if (input.windows.length < 1 || input.windows.length > U04_MAX_TURNOVER_WINDOWS) {
    return failure(domainFailure('TURNOVER_WINDOW_UNSUPPORTED', { field: 'windows' }))
  }
  const proposedPpm = input.proposedConsumption.numerator * U04_RATE_SCALE
    / input.proposedConsumption.scale
  let accepted = true
  const balances: TurnoverWindowBalance[] = []
  for (const window of input.windows) {
    const limitPpm = window.budgetLimit.numerator * U04_RATE_SCALE
      / window.budgetLimit.scale
    const beforePpm = window.consumedBeforePlan.numerator * U04_RATE_SCALE
      / window.consumedBeforePlan.scale
    const afterPpm = beforePpm + proposedPpm
    if (afterPpm > limitPpm) accepted = false
    const remainingBefore = limitPpm > beforePpm ? limitPpm - beforePpm : 0n
    const remainingAfter = limitPpm > afterPpm ? limitPpm - afterPpm : 0n
    balances.push(Object.freeze({
      windowKind: window.windowKind,
      budgetLimit: exactRate(limitPpm),
      consumedBeforePlan: exactRate(beforePpm),
      consumedAfterPlan: exactRate(afterPpm),
      remainingBeforePlan: exactRate(remainingBefore),
      remainingAfterPlan: exactRate(remainingAfter),
    }))
  }
  const reason = accepted ? undefined : buildSafeReasonBundle({
    primaryCode: 'TURNOVER_BUDGET_EXCEEDED',
    explanationKey: 'POLICY_SKIP',
    constraintIds: ['TURNOVER_BUDGET'],
  })
  if (reason !== undefined && !reason.ok) return reason
  return success(Object.freeze({
    proposedConsumption: input.proposedConsumption,
    windows: Object.freeze(balances),
    accepted,
    ...(reason === undefined ? {} : { reasonBundle: reason.value }),
  }))
}
