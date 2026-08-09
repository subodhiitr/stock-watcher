import type { StrategicRebalancePolicy } from '../../domain/strategy/strategy-config.ts'
import type { StrategicRebalanceSnapshot } from './relative-trend-signal.ts'

export type StrategicTimingClassification = 'MANDATORY_EXIT' | 'RISK_REDUCING' | 'RISK_INCREASING' | 'NO_CHANGE'

export type StrategicTradeTiming = Readonly<{
  preTimingTargetQuantity: bigint
  timedTargetQuantity: bigint
  classification: StrategicTimingClassification
  appliedFraction: number
  delayedQuantity: bigint
  reasonCode:
    | 'STRATEGIC_NEGATIVE_TREND_DELAY'
    | 'STRATEGIC_NEGATIVE_TREND_UNCONFIRMED'
    | 'STRATEGIC_HALF_REBALANCE'
    | 'STRATEGIC_MANDATORY_EXIT_OVERRIDE'
    | 'STRATEGIC_DATA_BLOCKED'
    | 'STRATEGIC_MAX_DELAY_FORCED_REVIEW'
    | 'STRATEGIC_NO_CHANGE'
}>

function scaledDelta(delta: bigint, fraction: number): bigint {
  return delta * BigInt(Math.round(fraction * 1_000_000)) / 1_000_000n
}

export function applyStrategicTradeTiming(input: Readonly<{
  currentQuantity: bigint
  preTimingTargetQuantity: bigint
  mandatoryExit: boolean
  policy: StrategicRebalancePolicy
  snapshot: StrategicRebalanceSnapshot
}>): StrategicTradeTiming {
  const delta = input.preTimingTargetQuantity - input.currentQuantity
  const classification: StrategicTimingClassification = input.mandatoryExit
    ? 'MANDATORY_EXIT' : delta > 0n ? 'RISK_INCREASING' : delta < 0n ? 'RISK_REDUCING' : 'NO_CHANGE'
  if (classification === 'MANDATORY_EXIT') {
    return Object.freeze({ preTimingTargetQuantity: input.preTimingTargetQuantity, timedTargetQuantity: input.preTimingTargetQuantity,
      classification, appliedFraction: 1, delayedQuantity: 0n, reasonCode: 'STRATEGIC_MANDATORY_EXIT_OVERRIDE' })
  }
  if (classification === 'NO_CHANGE') {
    return Object.freeze({ preTimingTargetQuantity: input.preTimingTargetQuantity, timedTargetQuantity: input.preTimingTargetQuantity,
      classification, appliedFraction: 0, delayedQuantity: 0n, reasonCode: 'STRATEGIC_NO_CHANGE' })
  }
  const appliedFraction = classification === 'RISK_INCREASING' ? input.snapshot.appliedBuyFraction : input.policy.permittedRebalanceFraction
  const timedTargetQuantity = input.currentQuantity + scaledDelta(delta, appliedFraction)
  const delayedQuantity = input.preTimingTargetQuantity > timedTargetQuantity ? input.preTimingTargetQuantity - timedTargetQuantity : 0n
  const reasonCode = input.snapshot.state === 'DATA_BLOCKED'
    ? 'STRATEGIC_DATA_BLOCKED'
    : input.snapshot.state === 'NEGATIVE_UNCONFIRMED'
      ? 'STRATEGIC_NEGATIVE_TREND_UNCONFIRMED'
      : input.snapshot.state === 'FORCED_REVIEW'
        ? 'STRATEGIC_MAX_DELAY_FORCED_REVIEW'
        : classification === 'RISK_INCREASING' && input.snapshot.state === 'NEGATIVE_CONFIRMED'
          ? 'STRATEGIC_NEGATIVE_TREND_DELAY'
          : 'STRATEGIC_HALF_REBALANCE'
  return Object.freeze({
    preTimingTargetQuantity: input.preTimingTargetQuantity, timedTargetQuantity,
    classification, appliedFraction, delayedQuantity, reasonCode,
  })
}
