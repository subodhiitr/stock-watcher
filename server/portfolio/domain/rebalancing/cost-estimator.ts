import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { CostScheduleVersionId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { U04_RATE_SCALE } from '../shared/rebalancing-constants.ts'
import type { LocalDate } from '../shared/time.ts'

export type CostChargeCode =
  | 'BROKERAGE'
  | 'STT'
  | 'EXCHANGE'
  | 'GST'
  | 'SEBI'
  | 'STAMP_DUTY'
  | 'DP'
  | 'BROKER_FEE'

export type CostChargeRule = Readonly<{
  chargeCode: CostChargeCode
  appliesToSide: 'BUY' | 'SELL' | 'BOTH'
  ratePpm: bigint
  fixedMinorUnits: bigint
}>

export type CostSchedule = Readonly<{
  scheduleVersionId: CostScheduleVersionId
  effectiveFrom: LocalDate
  chargeRules: readonly CostChargeRule[]
  spreadRatePpm: bigint
  slippageRatePpm: bigint
  impactRatePpm: bigint
}>

export type CostEstimate = Readonly<{
  scheduleVersionId: CostScheduleVersionId
  grossNotional: Money
  brokerage: Money
  stt: Money
  exchangeCharges: Money
  gst: Money
  sebiCharges: Money
  stampDuty: Money
  dpCharges: Money
  spreadCost: Money
  slippageCost: Money
  impactCost: Money
  brokerFees: Money
  statutoryCharges: Money
  totalCost: Money
}>

const REQUIRED_CHARGES = Object.freeze([
  'BROKERAGE',
  'STT',
  'EXCHANGE',
  'GST',
  'SEBI',
  'STAMP_DUTY',
  'DP',
  'BROKER_FEE',
] as const)

function amount(notional: bigint, rule: CostChargeRule): bigint {
  return notional * rule.ratePpm / U04_RATE_SCALE + rule.fixedMinorUnits
}

function money(minorUnits: bigint): Money {
  const result = createMoney(minorUnits)
  if (!result.ok) throw new TypeError('Invalid cost amount')
  return result.value
}

export function estimateOrderCost(input: Readonly<{
  schedule: CostSchedule
  asOf: LocalDate
  side: 'BUY' | 'SELL'
  grossNotional: Money
}>): DomainResult<CostEstimate> {
  if (input.schedule.effectiveFrom > input.asOf) {
    return failure(domainFailure('COST_SCHEDULE_NOT_EFFECTIVE', { field: 'effectiveFrom' }))
  }
  if (
    input.grossNotional.minorUnits < 0n
    || input.schedule.spreadRatePpm < 0n
    || input.schedule.slippageRatePpm < 0n
    || input.schedule.impactRatePpm < 0n
    || REQUIRED_CHARGES.some((code) =>
      !input.schedule.chargeRules.some((rule) => rule.chargeCode === code))
  ) {
    return failure(domainFailure('COST_INPUT_MISSING', { field: 'costSchedule' }))
  }
  const components = new Map<CostChargeCode, bigint>()
  for (const code of REQUIRED_CHARGES) {
    const applicable = input.schedule.chargeRules.filter((rule) =>
      rule.chargeCode === code
      && (rule.appliesToSide === 'BOTH' || rule.appliesToSide === input.side))
    if (applicable.some((rule) => rule.ratePpm < 0n || rule.fixedMinorUnits < 0n)) {
      return failure(domainFailure('COST_INPUT_MISSING', { field: code }))
    }
    components.set(code, applicable.reduce(
      (total, rule) => total + amount(input.grossNotional.minorUnits, rule),
      0n,
    ))
  }
  const spread = input.grossNotional.minorUnits * input.schedule.spreadRatePpm
    / U04_RATE_SCALE
  const slippage = input.grossNotional.minorUnits * input.schedule.slippageRatePpm
    / U04_RATE_SCALE
  const impact = input.grossNotional.minorUnits * input.schedule.impactRatePpm
    / U04_RATE_SCALE
  const brokerage = components.get('BROKERAGE') ?? 0n
  const stt = components.get('STT') ?? 0n
  const exchange = components.get('EXCHANGE') ?? 0n
  const gst = components.get('GST') ?? 0n
  const sebi = components.get('SEBI') ?? 0n
  const stamp = components.get('STAMP_DUTY') ?? 0n
  const dp = components.get('DP') ?? 0n
  const brokerFees = components.get('BROKER_FEE') ?? 0n
  const statutory = stt + exchange + gst + sebi + stamp + dp
  const total = brokerage + statutory + spread + slippage + impact + brokerFees
  return success(Object.freeze({
    scheduleVersionId: input.schedule.scheduleVersionId,
    grossNotional: input.grossNotional,
    brokerage: money(brokerage),
    stt: money(stt),
    exchangeCharges: money(exchange),
    gst: money(gst),
    sebiCharges: money(sebi),
    stampDuty: money(stamp),
    dpCharges: money(dp),
    spreadCost: money(spread),
    slippageCost: money(slippage),
    impactCost: money(impact),
    brokerFees: money(brokerFees),
    statutoryCharges: money(statutory),
    totalCost: money(total),
  }))
}
