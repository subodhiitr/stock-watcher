import { createHash } from 'node:crypto'
import {
  MAX_BENCHMARK_SYMBOL_LENGTH,
  MAX_VERSION_STRING_LENGTH,
  WEIGHT_SCALE_PPM,
  WEIGHT_SUM_TOLERANCE_PPM,
} from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

declare const configHashBrand: unique symbol
export type StrategyConfigHash = string & { readonly [configHashBrand]: 'StrategyConfigHash' }

export type StrategyHorizon = 'SHORT' | 'MEDIUM' | 'LONG'
export type RoutineFrequency = 'DAILY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY'
export type DefaultOrderType = 'MARKET' | 'LIMIT'
export type StrategyMode = 'PAPER' | 'OBSERVE' | 'LIVE'

export type UniversePolicy = Readonly<{
  indexUniverse: string
  minListingHistoryDays: number
  minPricePaise: number
  minMedian20dTradedValueLakh: number
}>

export type EligibilityPolicy = Readonly<{
  entryRank: number
  holdRank: number
  forcedReviewRank: number
  minStockWeightPct: number
  maxStockWeightPct: number
  noTradeBandPctPoints: number
  noTradeBandFractionOfTarget: number
}>

export type MomentumWeights = Readonly<{
  m3m1: number; m6m1: number; relativeStrength: number; trend: number
  earningsMomentum: number; liquidity: number; volatilityAdjusted: number
}>

export type QualityWeights = Readonly<{
  returnOnEquity: number; returnOnAssets: number; earningsStability: number
  debtCoverage: number; cashFlowQuality: number; promoterPledge: number
}>

export type RiskWeights = Readonly<{
  volatility60d: number; maxDrawdown: number; downsideDeviation: number
  beta: number; liquidityRisk: number
}>

export type FactorPolicy = Readonly<{
  momentumWeight: number
  qualityWeight: number
  lowRiskWeight: number
  momentumWeights: MomentumWeights
  qualityWeights: QualityWeights
  riskWeights: RiskWeights
  bfsiQualityWeights?: Readonly<{
    npaRatio: number; capitalAdequacy: number; netInterestMargin: number
    returnOnAssets: number; lcrRatio: number; promoterPledge: number
  }>
  sectorNeutral: boolean
}>

export type ConstructionPolicy = Readonly<{
  targetHoldings: number
  maxHoldings: number
  replacementScoreGapPct: number
  cashBufferPct: number
}>

export type RegimePolicy = Readonly<{
  confirmationPeriodsWeakening: number
  confirmationPeriodsStrengthening: number
  crisisDrawdownPct: number
  highVolatilityThreshold: number
}>

export type RebalancePolicy = Readonly<{
  routineFrequency: RoutineFrequency
  driftReviewFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  preferredMinHoldDays: number
  maxDailyTurnoverPct: number
  periodTurnoverBudget: Readonly<{
    rollingDays: number
    limitPct: number
    calendarMonthLimitPct?: number
    quarterLimitPct?: number
    yearLimitPct?: number
  }>
}>

export type StrategicRebalancePolicy = Readonly<{
  enabled: true
  mode: 'OBSERVE' | 'PAPER'
  riskBenchmark: string
  defensiveBenchmark: string
  primaryHorizonMonths: 1 | 3 | 12
  confirmationHorizonMonths?: 1 | 3 | 12
  baselineLookbackMonths: number
  minimumBaselineObservations: number
  permittedRebalanceFraction: number
  negativeTrendBuyFraction: number
  maximumDelayCalendarDays: number
  staleAfterHours: number
}>

export type ExecutionPolicy = Readonly<{
  product: 'CNC'
  defaultOrderType: DefaultOrderType
  startTime: string
  endTime: string
  timezone: 'Asia/Kolkata'
}>

export type RiskPolicy = Readonly<{
  drawdownWarningPct: number
  drawdownRiskReductionPct: number
  drawdownKillSwitchPct: number
}>

export type TaxPolicy = Readonly<{
  ltcgRatePct: number
  stcgRatePct: number
  sttBuyPct: number
  sttSellPct: number
  gstPct: number
}>

export type AutomationPolicy = Readonly<{
  allowedMode: StrategyMode
}>

export type StrategyConfig = Readonly<{
  benchmark: string
  horizon: StrategyHorizon
  universe: UniversePolicy
  eligibility: EligibilityPolicy
  factor: FactorPolicy
  construction: ConstructionPolicy
  regime: RegimePolicy
  rebalance: RebalancePolicy
  strategicRebalance?: StrategicRebalancePolicy
  execution: ExecutionPolicy
  risk: RiskPolicy
  tax: TaxPolicy
  automation: AutomationPolicy
}>

const PROHIBITED_JSON_KEYS = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
  'toJSON', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
])

const EXECUTABLE_PATTERN = /function\s*\(|=>\s*\{|eval\s*\(|new\s+Function/u

function checkWeightSum(weights: Record<string, number>, field: string): DomainResult<void> {
  const total = Math.round(Object.values(weights).reduce((s, v) => s + v * WEIGHT_SCALE_PPM, 0))
  const diff = Math.abs(total - WEIGHT_SCALE_PPM)
  if (diff > WEIGHT_SUM_TOLERANCE_PPM) {
    return failure(domainFailure('INVALID_FACTOR_WEIGHT_SUM', { field, context: { total, tolerance: WEIGHT_SUM_TOLERANCE_PPM } }))
  }
  return success(undefined)
}

function horizonFromFrequency(freq: RoutineFrequency): DomainResult<StrategyHorizon> {
  if (freq === 'BIWEEKLY') return success('SHORT')
  if (freq === 'MONTHLY') return success('MEDIUM')
  if (freq === 'QUARTERLY') return success('LONG')
  return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'routineFrequency' }))
}

function parseJsonSafe(raw: unknown): DomainResult<Record<string, unknown>> {
  let jsonStr: string
  if (typeof raw === 'string') {
    jsonStr = raw
  } else if (typeof raw === 'object' && raw !== null) {
    jsonStr = JSON.stringify(raw)
  } else {
    return failure(domainFailure('UNSAFE_JSON_CONFIG', { field: 'config' }))
  }
  if (EXECUTABLE_PATTERN.test(jsonStr)) {
    return failure(domainFailure('UNSAFE_JSON_CONFIG', { field: 'config' }))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return failure(domainFailure('UNSAFE_JSON_CONFIG', { field: 'config' }))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failure(domainFailure('UNSAFE_JSON_CONFIG', { field: 'config' }))
  }
  const obj = parsed as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (PROHIBITED_JSON_KEYS.has(key)) {
      return failure(domainFailure('UNSAFE_JSON_CONFIG', { field: key }))
    }
  }
  return success(obj)
}

function validateExecution(exec: unknown): DomainResult<ExecutionPolicy> {
  if (typeof exec !== 'object' || exec === null) {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'execution' }))
  }
  const e = exec as Record<string, unknown>
  if (e['product'] !== 'CNC') {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'product' }))
  }
  if (typeof e['startTime'] !== 'string' || typeof e['endTime'] !== 'string') {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'startTime' }))
  }
  if (e['timezone'] !== 'Asia/Kolkata') {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'timezone' }))
  }
  const start = e['startTime'] as string
  const end = e['endTime'] as string
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
  if (
    !timePattern.test(start)
    || !timePattern.test(end)
    || start < '09:15'
    || end > '15:30'
    || start >= end
  ) {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'startTime' }))
  }
  const validOrders: DefaultOrderType[] = ['MARKET', 'LIMIT']
  if (!validOrders.includes(e['defaultOrderType'] as DefaultOrderType)) {
    return failure(domainFailure('INVALID_EXECUTION_POLICY', { field: 'defaultOrderType' }))
  }
  return success(Object.freeze({
    product: 'CNC' as const,
    defaultOrderType: e['defaultOrderType'] as DefaultOrderType,
    startTime: start,
    endTime: end,
    timezone: 'Asia/Kolkata' as const,
  }))
}

function validateUniverse(universe: unknown): DomainResult<UniversePolicy> {
  if (typeof universe !== 'object' || universe === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'universe' }))
  }
  const value = universe as Record<string, unknown>
  const indexUniverse = value['indexUniverse']
  const minListingHistoryDays = value['minListingHistoryDays']
  const minPricePaise = value['minPricePaise']
  const minMedian20dTradedValueLakh = value['minMedian20dTradedValueLakh']
  if (
    typeof indexUniverse !== 'string'
    || indexUniverse.trim().length === 0
    || !Number.isSafeInteger(minListingHistoryDays)
    || (minListingHistoryDays as number) <= 0
    || !Number.isSafeInteger(minPricePaise)
    || (minPricePaise as number) <= 0
    || typeof minMedian20dTradedValueLakh !== 'number'
    || !Number.isFinite(minMedian20dTradedValueLakh)
    || minMedian20dTradedValueLakh <= 0
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'universe' }))
  }
  return success(Object.freeze({
    indexUniverse: indexUniverse.trim(),
    minListingHistoryDays: minListingHistoryDays as number,
    minPricePaise: minPricePaise as number,
    minMedian20dTradedValueLakh,
  }))
}

function validateRegime(regime: unknown): DomainResult<RegimePolicy> {
  if (typeof regime !== 'object' || regime === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'regime' }))
  }
  const value = regime as Record<string, unknown>
  const weakening = value['confirmationPeriodsWeakening']
  const strengthening = value['confirmationPeriodsStrengthening']
  const crisisDrawdownPct = value['crisisDrawdownPct']
  const highVolatilityThreshold = value['highVolatilityThreshold']
  if (
    !Number.isSafeInteger(weakening)
    || (weakening as number) <= 0
    || !Number.isSafeInteger(strengthening)
    || (strengthening as number) <= 0
    || typeof crisisDrawdownPct !== 'number'
    || !Number.isFinite(crisisDrawdownPct)
    || crisisDrawdownPct <= 0
    || crisisDrawdownPct > 100
    || typeof highVolatilityThreshold !== 'number'
    || !Number.isFinite(highVolatilityThreshold)
    || highVolatilityThreshold <= 0
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'regime' }))
  }
  return success(Object.freeze({
    confirmationPeriodsWeakening: weakening as number,
    confirmationPeriodsStrengthening: strengthening as number,
    crisisDrawdownPct,
    highVolatilityThreshold,
  }))
}

function validateRebalance(
  rebalance: unknown,
  routineFrequency: RoutineFrequency,
): DomainResult<RebalancePolicy> {
  if (typeof rebalance !== 'object' || rebalance === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'rebalance' }))
  }
  const value = rebalance as Record<string, unknown>
  const driftReviewFrequency = value['driftReviewFrequency']
  const preferredMinHoldDays = value['preferredMinHoldDays']
  const maxDailyTurnoverPct = value['maxDailyTurnoverPct']
  const budget = value['periodTurnoverBudget']
  if (
    value['routineFrequency'] !== routineFrequency
    || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(driftReviewFrequency))
    || !Number.isSafeInteger(preferredMinHoldDays)
    || (preferredMinHoldDays as number) < 0
    || typeof maxDailyTurnoverPct !== 'number'
    || !Number.isFinite(maxDailyTurnoverPct)
    || maxDailyTurnoverPct <= 0
    || maxDailyTurnoverPct > 100
    || typeof budget !== 'object'
    || budget === null
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'rebalance' }))
  }
  const turnover = budget as Record<string, unknown>
  const rollingDays = turnover['rollingDays']
  const limitPct = turnover['limitPct']
  if (
    !Number.isSafeInteger(rollingDays)
    || (rollingDays as number) <= 0
    || typeof limitPct !== 'number'
    || !Number.isFinite(limitPct)
    || limitPct <= 0
    || limitPct > 100
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', {
      field: 'periodTurnoverBudget',
    }))
  }
  for (const field of ['calendarMonthLimitPct', 'quarterLimitPct', 'yearLimitPct']) {
    const optional = turnover[field]
    if (
      optional !== undefined
      && (
        typeof optional !== 'number'
        || !Number.isFinite(optional)
        || optional <= 0
        || optional > 100
      )
    ) {
      return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field }))
    }
  }
  return success(Object.freeze({
    routineFrequency,
    driftReviewFrequency: driftReviewFrequency as RebalancePolicy['driftReviewFrequency'],
    preferredMinHoldDays: preferredMinHoldDays as number,
    maxDailyTurnoverPct,
    periodTurnoverBudget: Object.freeze({
      rollingDays: rollingDays as number,
      limitPct,
      ...(typeof turnover['calendarMonthLimitPct'] === 'number'
        ? { calendarMonthLimitPct: turnover['calendarMonthLimitPct'] }
        : {}),
      ...(typeof turnover['quarterLimitPct'] === 'number'
        ? { quarterLimitPct: turnover['quarterLimitPct'] }
        : {}),
      ...(typeof turnover['yearLimitPct'] === 'number'
        ? { yearLimitPct: turnover['yearLimitPct'] }
        : {}),
    }),
  }))
}

function validateAutomation(automation: unknown): DomainResult<AutomationPolicy> {
  if (typeof automation !== 'object' || automation === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'automation' }))
  }
  const allowedMode = (automation as Record<string, unknown>)['allowedMode']
  if (!['PAPER', 'OBSERVE', 'LIVE'].includes(String(allowedMode))) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'allowedMode' }))
  }
  return success(Object.freeze({ allowedMode: allowedMode as StrategyMode }))
}

function validateStrategicRebalance(value: unknown): DomainResult<StrategicRebalancePolicy | undefined> {
  if (value === undefined) return success(undefined)
  if (typeof value !== 'object' || value === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'strategicRebalance' }))
  }
  const policy = value as Record<string, unknown>
  if (policy['enabled'] !== true || !['OBSERVE', 'PAPER'].includes(String(policy['mode']))) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'strategicRebalance.mode' }))
  }
  const primary = policy['primaryHorizonMonths']
  const confirmation = policy['confirmationHorizonMonths']
  const allowedHorizons = [1, 3, 12]
  const riskBenchmark = policy['riskBenchmark']
  const defensiveBenchmark = policy['defensiveBenchmark']
  const baselineLookbackMonths = policy['baselineLookbackMonths']
  const minimumBaselineObservations = policy['minimumBaselineObservations']
  const permittedRebalanceFraction = policy['permittedRebalanceFraction']
  const negativeTrendBuyFraction = policy['negativeTrendBuyFraction']
  const maximumDelayCalendarDays = policy['maximumDelayCalendarDays']
  const staleAfterHours = policy['staleAfterHours']
  if (
    typeof riskBenchmark !== 'string' || riskBenchmark.trim() === ''
    || typeof defensiveBenchmark !== 'string' || defensiveBenchmark.trim() === ''
    || riskBenchmark.trim().toUpperCase() === defensiveBenchmark.trim().toUpperCase()
    || !allowedHorizons.includes(primary as number)
    || (confirmation !== undefined && (!allowedHorizons.includes(confirmation as number) || confirmation === primary))
    || !Number.isSafeInteger(baselineLookbackMonths) || (baselineLookbackMonths as number) <= (primary as number)
    || !Number.isSafeInteger(minimumBaselineObservations) || (minimumBaselineObservations as number) <= 0
    || typeof permittedRebalanceFraction !== 'number' || permittedRebalanceFraction < 0 || permittedRebalanceFraction > 1
    || typeof negativeTrendBuyFraction !== 'number' || negativeTrendBuyFraction < 0 || negativeTrendBuyFraction > permittedRebalanceFraction
    || !Number.isSafeInteger(maximumDelayCalendarDays) || (maximumDelayCalendarDays as number) <= 0
    || typeof staleAfterHours !== 'number' || !Number.isFinite(staleAfterHours) || staleAfterHours <= 0
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'strategicRebalance' }))
  }
  return success(Object.freeze({
    enabled: true as const,
    mode: policy['mode'] as 'OBSERVE' | 'PAPER',
    riskBenchmark: riskBenchmark.trim(),
    defensiveBenchmark: defensiveBenchmark.trim(),
    primaryHorizonMonths: primary as 1 | 3 | 12,
    ...(confirmation === undefined ? {} : { confirmationHorizonMonths: confirmation as 1 | 3 | 12 }),
    baselineLookbackMonths: baselineLookbackMonths as number,
    minimumBaselineObservations: minimumBaselineObservations as number,
    permittedRebalanceFraction,
    negativeTrendBuyFraction,
    maximumDelayCalendarDays: maximumDelayCalendarDays as number,
    staleAfterHours,
  }))
}

function validateTax(tax: unknown): DomainResult<TaxPolicy> {
  if (typeof tax !== 'object' || tax === null) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'tax' }))
  }
  const t = tax as Record<string, unknown>
  for (const field of ['ltcgRatePct', 'stcgRatePct', 'sttBuyPct', 'sttSellPct', 'gstPct']) {
    const v = t[field]
    if (typeof v !== 'number' || v < 0 || v > 100) {
      return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field }))
    }
  }
  return success(Object.freeze({
    ltcgRatePct: t['ltcgRatePct'] as number,
    stcgRatePct: t['stcgRatePct'] as number,
    sttBuyPct: t['sttBuyPct'] as number,
    sttSellPct: t['sttSellPct'] as number,
    gstPct: t['gstPct'] as number,
  }))
}

function validateRisk(risk: unknown): DomainResult<RiskPolicy> {
  if (typeof risk !== 'object' || risk === null) {
    return failure(domainFailure('INVALID_DRAWDOWN_THRESHOLDS', { field: 'risk' }))
  }
  const r = risk as Record<string, unknown>
  const warn = r['drawdownWarningPct']
  const reduce = r['drawdownRiskReductionPct']
  const kill = r['drawdownKillSwitchPct']
  if (typeof warn !== 'number' || typeof reduce !== 'number' || typeof kill !== 'number') {
    return failure(domainFailure('INVALID_DRAWDOWN_THRESHOLDS', { field: 'drawdownWarningPct' }))
  }
  if (!(warn < reduce && reduce < kill)) {
    return failure(domainFailure('INVALID_DRAWDOWN_THRESHOLDS', { field: 'drawdownWarningPct' }))
  }
  return success(Object.freeze({ drawdownWarningPct: warn, drawdownRiskReductionPct: reduce, drawdownKillSwitchPct: kill }))
}

function validateFactorWeights(factor: Record<string, unknown>): DomainResult<FactorPolicy> {
  const topCheck = checkWeightSum({
    momentumWeight: (factor['momentumWeight'] as number) ?? 0,
    qualityWeight: (factor['qualityWeight'] as number) ?? 0,
    lowRiskWeight: (factor['lowRiskWeight'] as number) ?? 0,
  }, 'factor.topLevel')
  if (!topCheck.ok) return topCheck

  const mw = factor['momentumWeights'] as Record<string, number> | undefined
  if (!mw) return failure(domainFailure('INVALID_FACTOR_COMPONENT_WEIGHT_SUM', { field: 'momentumWeights' }))
  const mwCheck = checkWeightSum(mw, 'momentumWeights')
  if (!mwCheck.ok) return mwCheck

  const qw = factor['qualityWeights'] as Record<string, number> | undefined
  if (!qw) return failure(domainFailure('INVALID_FACTOR_COMPONENT_WEIGHT_SUM', { field: 'qualityWeights' }))
  const qwCheck = checkWeightSum(qw, 'qualityWeights')
  if (!qwCheck.ok) return qwCheck

  const rw = factor['riskWeights'] as Record<string, number> | undefined
  if (!rw) return failure(domainFailure('INVALID_FACTOR_COMPONENT_WEIGHT_SUM', { field: 'riskWeights' }))
  const rwCheck = checkWeightSum(rw, 'riskWeights')
  if (!rwCheck.ok) return rwCheck

  return success(Object.freeze({
    momentumWeight: factor['momentumWeight'] as number,
    qualityWeight: factor['qualityWeight'] as number,
    lowRiskWeight: factor['lowRiskWeight'] as number,
    momentumWeights: Object.freeze(mw) as MomentumWeights,
    qualityWeights: Object.freeze(qw) as QualityWeights,
    riskWeights: Object.freeze(rw) as RiskWeights,
    sectorNeutral: typeof factor['sectorNeutral'] === 'boolean' ? factor['sectorNeutral'] : false,
  }) as FactorPolicy)
}

function canonicalJson(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']'
  const sorted = Object.keys(obj as Record<string, unknown>).sort()
  const entries = sorted.map(k => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
  return '{' + entries.join(',') + '}'
}

export function computeConfigHash(config: StrategyConfig): StrategyConfigHash {
  const canonical = canonicalJson(config)
  return createHash('sha256').update(canonical, 'utf8').digest('hex') as StrategyConfigHash
}

export function createStrategyConfig(
  raw: unknown,
): DomainResult<{ config: StrategyConfig; hash: StrategyConfigHash }> {
  const parseResult = parseJsonSafe(raw)
  if (!parseResult.ok) return parseResult

  const obj = parseResult.value

  // Validate benchmark (SR-014)
  const benchmark = obj['benchmark']
  if (
    typeof benchmark !== 'string'
    || benchmark.trim().length === 0
    || benchmark.length > MAX_BENCHMARK_SYMBOL_LENGTH
  ) {
    return failure(domainFailure('INVALID_STRATEGY_BENCHMARK', { field: 'benchmark' }))
  }

  // Validate routineFrequency and derive horizon (SR-015)
  const validFrequencies: RoutineFrequency[] = ['DAILY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY']
  const freq = obj['routineFrequency']
  if (!validFrequencies.includes(freq as RoutineFrequency)) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'routineFrequency' }))
  }
  const horizonResult = horizonFromFrequency(freq as RoutineFrequency)
  if (!horizonResult.ok) return horizonResult

  const universeResult = validateUniverse(obj['universe'])
  if (!universeResult.ok) return universeResult

  // Validate execution (SR-012, SR-013)
  const execResult = validateExecution(obj['execution'])
  if (!execResult.ok) return execResult

  // Validate tax (SR-011)
  const taxResult = validateTax(obj['tax'])
  if (!taxResult.ok) return taxResult

  // Validate risk (SR-009)
  const riskResult = validateRisk(obj['risk'])
  if (!riskResult.ok) return riskResult

  const regimeResult = validateRegime(obj['regime'])
  if (!regimeResult.ok) return regimeResult

  const rebalanceResult = validateRebalance(
    obj['rebalance'],
    freq as RoutineFrequency,
  )
  if (!rebalanceResult.ok) return rebalanceResult

  const automationResult = validateAutomation(obj['automation'])
  if (!automationResult.ok) return automationResult
  const strategicRebalanceResult = validateStrategicRebalance(obj['strategicRebalance'])
  if (!strategicRebalanceResult.ok) return strategicRebalanceResult

  // Validate factor weights (SR-002, SR-003)
  const factorData = obj['factor']
  if (typeof factorData !== 'object' || factorData === null) {
    return failure(domainFailure('INVALID_FACTOR_WEIGHT_SUM', { field: 'factor' }))
  }
  const factorResult = validateFactorWeights(factorData as Record<string, unknown>)
  if (!factorResult.ok) return factorResult

  // Validate eligibility thresholds (SR-004, SR-005, SR-006, SR-007)
  const elig = obj['eligibility'] as Record<string, unknown> | undefined
  if (!elig || typeof elig !== 'object') {
    return failure(domainFailure('INVALID_ELIGIBILITY_THRESHOLD', { field: 'eligibility' }))
  }
  const entryRank = elig['entryRank'] as number
  const holdRank = elig['holdRank'] as number
  const forcedRank = elig['forcedReviewRank'] as number
  if (typeof entryRank !== 'number' || typeof holdRank !== 'number' || typeof forcedRank !== 'number') {
    return failure(domainFailure('INVALID_ELIGIBILITY_THRESHOLD', { field: 'entryRank' }))
  }
  if (!(entryRank < holdRank && holdRank < forcedRank)) {
    return failure(domainFailure('INVALID_ELIGIBILITY_THRESHOLD', { field: 'entryRank' }))
  }
  const minW = elig['minStockWeightPct'] as number
  const maxW = elig['maxStockWeightPct'] as number
  if (typeof minW !== 'number' || typeof maxW !== 'number' || minW >= maxW) {
    return failure(domainFailure('INVALID_ELIGIBILITY_THRESHOLD', { field: 'minStockWeightPct' }))
  }

  // Validate construction (SR-005, SR-008)
  const cons = obj['construction'] as Record<string, unknown> | undefined
  if (!cons || typeof cons !== 'object') {
    return failure(domainFailure('INVALID_CONSTRUCTION_POLICY', { field: 'construction' }))
  }
  const target = cons['targetHoldings'] as number
  const maxH = cons['maxHoldings'] as number
  if (typeof target !== 'number' || typeof maxH !== 'number' || maxH < target) {
    return failure(domainFailure('INVALID_CONSTRUCTION_POLICY', { field: 'maxHoldings' }))
  }
  const cashBuf = cons['cashBufferPct'] as number
  if (typeof cashBuf !== 'number' || cashBuf < 0.5 || cashBuf > 20) {
    return failure(domainFailure('INVALID_CONSTRUCTION_POLICY', { field: 'cashBufferPct' }))
  }

  const config: StrategyConfig = Object.freeze({
    benchmark: benchmark.trim(),
    horizon: horizonResult.value,
    universe: universeResult.value,
    eligibility: Object.freeze({
      entryRank,
      holdRank,
      forcedReviewRank: forcedRank,
      minStockWeightPct: minW,
      maxStockWeightPct: maxW,
      noTradeBandPctPoints: (elig['noTradeBandPctPoints'] as number) ?? 0.5,
      noTradeBandFractionOfTarget: (elig['noTradeBandFractionOfTarget'] as number) ?? 0.2,
    }),
    factor: factorResult.value,
    construction: Object.freeze({
      targetHoldings: target,
      maxHoldings: maxH,
      replacementScoreGapPct: (cons['replacementScoreGapPct'] as number) ?? 10,
      cashBufferPct: cashBuf,
    }),
    regime: regimeResult.value,
    rebalance: rebalanceResult.value,
    ...(strategicRebalanceResult.value === undefined ? {} : { strategicRebalance: strategicRebalanceResult.value }),
    execution: execResult.value,
    risk: riskResult.value,
    tax: taxResult.value,
    automation: automationResult.value,
  })

  const hash = computeConfigHash(config)
  return success({ config, hash })
}

export function strategyConfigsEqual(a: StrategyConfig, b: StrategyConfig): boolean {
  return computeConfigHash(a) === computeConfigHash(b)
}

export function parseVersionString(value: unknown): DomainResult<string> {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_VERSION_STRING_LENGTH
    || !/^\d+\.\d+\.\d+$/.test(value)
  ) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'versionString' }))
  }
  return success(value)
}
