import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { DataVersionId, InstrumentId, StrategyVersionId } from '../shared/identifiers.ts'
import type { DataProvider } from '../market-data/data-provenance.ts'
import { PRODUCTION_QUALITY_SOURCES } from '../market-data/data-provenance.ts'

export type EligibilityRuleId =
  | 'LISTING_HISTORY'
  | 'PRICE_AVAILABILITY'
  | 'MIN_PRICE'
  | 'TRADED_VALUE'
  | 'CORPORATE_ACTION_STATUS'
  | 'TRADING_STATUS'
  | 'SURVEILLANCE_STATUS'
  | 'PRICE_ADJUSTMENT_VALIDITY'
  | 'FUNDAMENTAL_FRESHNESS'
  | 'BROKER_MAPPING'
  | 'DATA_ANOMALY'
  | 'FUNDAMENTAL_HEALTH'

export type EligibilityRuleResult = Readonly<{
  ruleId: EligibilityRuleId
  passed: boolean
  actual?: number
  threshold?: number
  reasonCode: string
}>

export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'HOLD_ELIGIBLE'
  | 'FORCED_REVIEW'

export type EligibilityResult = Readonly<{
  instrumentId: InstrumentId
  strategyVersionId: StrategyVersionId
  dataVersionId: DataVersionId
  asOf: string
  status: EligibilityStatus
  ruleResults: readonly EligibilityRuleResult[]
  isBfsi: boolean
  hardRiskFlag: boolean
  fundamentalHealthExclude: boolean
  evaluatedAt: string
}>

export function createEligibilityResult(params: {
  instrumentId: InstrumentId
  strategyVersionId: StrategyVersionId
  dataVersionId: DataVersionId
  asOf: string
  ruleResults: readonly EligibilityRuleResult[]
  isBfsi: boolean
  evaluatedAt: string
}): DomainResult<EligibilityResult> {
  const { instrumentId, strategyVersionId, dataVersionId, asOf, ruleResults, isBfsi, evaluatedAt } = params

  const hardRiskFlag = ruleResults.some(r =>
    (r.ruleId === 'SURVEILLANCE_STATUS' || r.ruleId === 'TRADING_STATUS') && !r.passed
    && r.reasonCode === 'HARD_RISK_FLAG',
  )
  const fundamentalHealthExclude = ruleResults.some(
    r => r.ruleId === 'FUNDAMENTAL_HEALTH' && !r.passed && r.reasonCode === 'FUNDAMENTAL_HEALTH_EXCLUDE',
  )

  // Determine status
  const mandatoryFailures = ruleResults.filter(r => !r.passed)
  let status: EligibilityStatus
  if (hardRiskFlag) {
    status = 'INELIGIBLE'
  } else if (mandatoryFailures.length === 0) {
    status = 'ELIGIBLE'
  } else if (mandatoryFailures.every(r => r.reasonCode === 'HOLD_ELIGIBLE')) {
    status = 'HOLD_ELIGIBLE'
  } else if (mandatoryFailures.every(r => r.reasonCode === 'FORCED_REVIEW')) {
    status = 'FORCED_REVIEW'
  } else {
    status = 'INELIGIBLE'
  }

  return success(Object.freeze({
    instrumentId,
    strategyVersionId,
    dataVersionId,
    asOf,
    status,
    ruleResults: Object.freeze(ruleResults),
    isBfsi,
    hardRiskFlag,
    fundamentalHealthExclude,
    evaluatedAt,
  }))
}

export type RiskFlagSource = Extract<DataProvider, 'LICENSED_EOD' | 'BROKER_API' | 'EXCHANGE_FILING'>

export type RiskFlag = Readonly<{
  flagType: 'HARD_RISK_FLAG' | 'FUNDAMENTAL_HEALTH_EXCLUDE'
  source: RiskFlagSource
  reason: string
}>

export function createRiskFlag(
  flagType: 'HARD_RISK_FLAG' | 'FUNDAMENTAL_HEALTH_EXCLUDE',
  source: DataProvider,
  reason: string,
): DomainResult<RiskFlag> {
  if (!(PRODUCTION_QUALITY_SOURCES as readonly string[]).includes(source)) {
    return failure(domainFailure('AI_EVIDENCE_FORBIDDEN', { field: 'source' }))
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'reason' }))
  }
  return success(Object.freeze({ flagType, source: source as RiskFlagSource, reason }))
}
