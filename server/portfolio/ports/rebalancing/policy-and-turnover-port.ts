import type { DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type {
  CostScheduleVersionId,
  PortfolioId,
  TaxRuleVersionId,
  TurnoverSnapshotId,
} from '../../domain/shared/identifiers.ts'
import type { LocalDate } from '../../domain/shared/time.ts'

export type PolicyChargeCode =
  | 'BROKERAGE'
  | 'STT'
  | 'EXCHANGE'
  | 'GST'
  | 'SEBI'
  | 'STAMP_DUTY'
  | 'DP'
  | 'BROKER_FEE'

export type EffectiveChargeRule = Readonly<{
  chargeCode: PolicyChargeCode
  appliesToSide: 'BUY' | 'SELL' | 'BOTH'
  ratePpm: bigint
  fixedMinorUnits: bigint
}>

export type EffectiveCostSchedule = Readonly<{
  scheduleVersionId: CostScheduleVersionId
  effectiveFrom: LocalDate
  chargeRules: readonly EffectiveChargeRule[]
  spreadRatePpm: bigint
  slippageRatePpm: bigint
  impactRatePpm: bigint
  integrityHash: IntegrityHash
}>

export type EffectiveTaxRuleSet = Readonly<{
  taxRuleVersionId: TaxRuleVersionId
  effectiveFrom: LocalDate
  holdingPeriodThresholdDays: number
  shortTermRatePpm: bigint
  longTermRatePpm: bigint
  lotSelectionPolicy: 'FIFO' | 'HIFO' | 'SPECIFIC'
  integrityHash: IntegrityHash
}>

export type TurnoverWindowKind =
  | 'ROLLING_30_DAY'
  | 'CALENDAR_MONTH'
  | 'CALENDAR_QUARTER'
  | 'CALENDAR_YEAR'

export type TurnoverWindowSnapshot = Readonly<{
  windowKind: TurnoverWindowKind
  budgetLimitPpm: bigint
  consumedBeforePlanPpm: bigint
}>

export type EffectiveTurnoverSnapshot = Readonly<{
  turnoverSnapshotId: TurnoverSnapshotId
  portfolioId: PortfolioId
  asOf: LocalDate
  windows: readonly TurnoverWindowSnapshot[]
  integrityHash: IntegrityHash
}>

export type PolicyAndTurnoverResolution = Readonly<{
  costSchedule: EffectiveCostSchedule
  taxRuleSet: EffectiveTaxRuleSet
  turnover: EffectiveTurnoverSnapshot
}>

export interface PolicyAndTurnoverPort {
  resolveForDate(input: Readonly<{
    portfolioId: PortfolioId
    asOf: LocalDate
    timeoutMs: number
  }>): Promise<DomainResult<PolicyAndTurnoverResolution>>
}
