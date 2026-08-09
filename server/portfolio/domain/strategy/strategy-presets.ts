import { DomainInvariantError } from '../errors/invariant-error.ts'
import { createStrategyConfig, type StrategyConfig, type StrategyConfigHash } from './strategy-config.ts'

export type PresetDescriptor = Readonly<{
  strategyId: string
  version: string
  config: StrategyConfig
  hash: StrategyConfigHash
}>

function buildPreset(strategyId: string, version: string, raw: unknown): PresetDescriptor {
  const result = createStrategyConfig(raw)
  if (!result.ok) {
    throw new DomainInvariantError()
  }
  return Object.freeze({ strategyId, version, config: result.value.config, hash: result.value.hash })
}

const SHORT_HORIZON_RAW = {
  benchmark: 'NIFTY50',
  routineFrequency: 'BIWEEKLY',
  universe: {
    indexUniverse: 'NIFTY500',
    minListingHistoryDays: 252,
    minPricePaise: 1000,
    minMedian20dTradedValueLakh: 100,
  },
  eligibility: {
    entryRank: 40, holdRank: 55, forcedReviewRank: 70,
    minStockWeightPct: 1.0, maxStockWeightPct: 10.0,
    noTradeBandPctPoints: 0.75, noTradeBandFractionOfTarget: 0.20,
  },
  factor: {
    momentumWeight: 0.65, qualityWeight: 0.20, lowRiskWeight: 0.15,
    momentumWeights: { m3m1: 0.20, m6m1: 0.20, relativeStrength: 0.15, trend: 0.15, earningsMomentum: 0.15, liquidity: 0.10, volatilityAdjusted: 0.05 },
    qualityWeights: { returnOnEquity: 0.25, returnOnAssets: 0.20, earningsStability: 0.20, debtCoverage: 0.15, cashFlowQuality: 0.10, promoterPledge: 0.10 },
    riskWeights: { volatility60d: 0.30, maxDrawdown: 0.25, downsideDeviation: 0.20, beta: 0.15, liquidityRisk: 0.10 },
    sectorNeutral: false,
  },
  construction: { targetHoldings: 20, maxHoldings: 25, replacementScoreGapPct: 15, cashBufferPct: 3.0 },
  regime: { confirmationPeriodsWeakening: 2, confirmationPeriodsStrengthening: 5, crisisDrawdownPct: 15.0, highVolatilityThreshold: 25.0 },
  rebalance: {
    routineFrequency: 'BIWEEKLY', driftReviewFrequency: 'WEEKLY', preferredMinHoldDays: 20,
    maxDailyTurnoverPct: 10.0,
    periodTurnoverBudget: { rollingDays: 30, limitPct: 40.0 },
  },
  execution: { product: 'CNC', defaultOrderType: 'MARKET', startTime: '09:45', endTime: '11:30', timezone: 'Asia/Kolkata' },
  risk: { drawdownWarningPct: 10.0, drawdownRiskReductionPct: 15.0, drawdownKillSwitchPct: 20.0 },
  tax: { ltcgRatePct: 10.0, stcgRatePct: 15.0, sttBuyPct: 0.1, sttSellPct: 0.1, gstPct: 18.0 },
  automation: { allowedMode: 'PAPER' },
}

const MEDIUM_HORIZON_RAW = {
  benchmark: 'NIFTY500',
  routineFrequency: 'MONTHLY',
  universe: {
    indexUniverse: 'NIFTY500',
    minListingHistoryDays: 252,
    minPricePaise: 1000,
    minMedian20dTradedValueLakh: 100,
  },
  eligibility: {
    entryRank: 50, holdRank: 65, forcedReviewRank: 80,
    minStockWeightPct: 1.0, maxStockWeightPct: 10.0,
    noTradeBandPctPoints: 0.50, noTradeBandFractionOfTarget: 0.20,
  },
  factor: {
    momentumWeight: 0.55, qualityWeight: 0.30, lowRiskWeight: 0.15,
    momentumWeights: { m3m1: 0.15, m6m1: 0.20, relativeStrength: 0.15, trend: 0.15, earningsMomentum: 0.20, liquidity: 0.10, volatilityAdjusted: 0.05 },
    qualityWeights: { returnOnEquity: 0.25, returnOnAssets: 0.20, earningsStability: 0.20, debtCoverage: 0.15, cashFlowQuality: 0.10, promoterPledge: 0.10 },
    riskWeights: { volatility60d: 0.30, maxDrawdown: 0.25, downsideDeviation: 0.20, beta: 0.15, liquidityRisk: 0.10 },
    sectorNeutral: false,
  },
  construction: { targetHoldings: 25, maxHoldings: 30, replacementScoreGapPct: 10, cashBufferPct: 2.0 },
  regime: { confirmationPeriodsWeakening: 2, confirmationPeriodsStrengthening: 5, crisisDrawdownPct: 15.0, highVolatilityThreshold: 25.0 },
  rebalance: {
    routineFrequency: 'MONTHLY', driftReviewFrequency: 'MONTHLY', preferredMinHoldDays: 60,
    maxDailyTurnoverPct: 10.0,
    periodTurnoverBudget: { rollingDays: 30, limitPct: 25.0, calendarMonthLimitPct: 25.0 },
  },
  execution: { product: 'CNC', defaultOrderType: 'MARKET', startTime: '09:45', endTime: '11:30', timezone: 'Asia/Kolkata' },
  risk: { drawdownWarningPct: 10.0, drawdownRiskReductionPct: 15.0, drawdownKillSwitchPct: 20.0 },
  tax: { ltcgRatePct: 10.0, stcgRatePct: 15.0, sttBuyPct: 0.1, sttSellPct: 0.1, gstPct: 18.0 },
  automation: { allowedMode: 'PAPER' },
}

const LONG_HORIZON_RAW = {
  benchmark: 'NIFTY500',
  routineFrequency: 'QUARTERLY',
  universe: {
    indexUniverse: 'NIFTY500',
    minListingHistoryDays: 504,
    minPricePaise: 1000,
    minMedian20dTradedValueLakh: 100,
  },
  eligibility: {
    entryRank: 40, holdRank: 60, forcedReviewRank: 75,
    minStockWeightPct: 1.0, maxStockWeightPct: 10.0,
    noTradeBandPctPoints: 1.00, noTradeBandFractionOfTarget: 0.25,
  },
  factor: {
    momentumWeight: 0.20, qualityWeight: 0.55, lowRiskWeight: 0.25,
    momentumWeights: { m3m1: 0.10, m6m1: 0.15, relativeStrength: 0.15, trend: 0.20, earningsMomentum: 0.20, liquidity: 0.10, volatilityAdjusted: 0.10 },
    qualityWeights: { returnOnEquity: 0.25, returnOnAssets: 0.20, earningsStability: 0.20, debtCoverage: 0.15, cashFlowQuality: 0.10, promoterPledge: 0.10 },
    riskWeights: { volatility60d: 0.30, maxDrawdown: 0.25, downsideDeviation: 0.20, beta: 0.15, liquidityRisk: 0.10 },
    sectorNeutral: false,
  },
  construction: { targetHoldings: 30, maxHoldings: 35, replacementScoreGapPct: 20, cashBufferPct: 3.0 },
  regime: { confirmationPeriodsWeakening: 2, confirmationPeriodsStrengthening: 5, crisisDrawdownPct: 15.0, highVolatilityThreshold: 25.0 },
  rebalance: {
    routineFrequency: 'QUARTERLY', driftReviewFrequency: 'MONTHLY', preferredMinHoldDays: 252,
    maxDailyTurnoverPct: 5.0,
    periodTurnoverBudget: { rollingDays: 90, limitPct: 15.0, quarterLimitPct: 15.0, yearLimitPct: 30.0 },
  },
  execution: { product: 'CNC', defaultOrderType: 'MARKET', startTime: '09:45', endTime: '11:30', timezone: 'Asia/Kolkata' },
  risk: { drawdownWarningPct: 10.0, drawdownRiskReductionPct: 15.0, drawdownKillSwitchPct: 20.0 },
  tax: { ltcgRatePct: 10.0, stcgRatePct: 15.0, sttBuyPct: 0.1, sttSellPct: 0.1, gstPct: 18.0 },
  automation: { allowedMode: 'PAPER' },
}

export const SHORT_HORIZON_PRESET: PresetDescriptor = buildPreset(
  'short-horizon-momentum-quality', '1.0.0', SHORT_HORIZON_RAW,
)

export const MEDIUM_HORIZON_PRESET: PresetDescriptor = buildPreset(
  'adaptive-momentum-quality', '1.0.0', MEDIUM_HORIZON_RAW,
)

export const STRATEGIC_MEDIUM_HORIZON_PRESET: PresetDescriptor = buildPreset(
  'adaptive-momentum-quality-strategic',
  '2.0.0',
  {
    ...MEDIUM_HORIZON_RAW,
    strategicRebalance: {
      enabled: true,
      mode: 'PAPER',
      riskBenchmark: 'NIFTY500TR',
      defensiveBenchmark: 'GILT5YBEES',
      primaryHorizonMonths: 12,
      confirmationHorizonMonths: 3,
      baselineLookbackMonths: 120,
      minimumBaselineObservations: 60,
      permittedRebalanceFraction: 0.5,
      negativeTrendBuyFraction: 0,
      maximumDelayCalendarDays: 93,
      staleAfterHours: 36,
    },
  },
)

export const LONG_HORIZON_PRESET: PresetDescriptor = buildPreset(
  'long-horizon-quality-compounders', '1.0.0', LONG_HORIZON_RAW,
)

export const STRATEGY_PRESETS: readonly PresetDescriptor[] = Object.freeze([
  SHORT_HORIZON_PRESET,
  MEDIUM_HORIZON_PRESET,
  STRATEGIC_MEDIUM_HORIZON_PRESET,
  LONG_HORIZON_PRESET,
])
