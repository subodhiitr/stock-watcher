import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts'
import type { ScoredResearchCandidate } from './research-candidate-selection.ts'

export type PositionExitRiskLevel = 'NONE' | 'WATCH' | 'REDUCE' | 'EXIT'

export type PositionExitRiskFlag = Readonly<{
  code: string
  level: Exclude<PositionExitRiskLevel, 'NONE'>
  reason: string
  mandatory: boolean
}>

export type PositionExitRiskAssessment = Readonly<{
  level: PositionExitRiskLevel
  score: number
  mandatoryExit: boolean
  flags: readonly PositionExitRiskFlag[]
  summary: string
}>

const LEVEL_SCORE: Readonly<Record<PositionExitRiskLevel, number>> = Object.freeze({ NONE: 0, WATCH: 40, REDUCE: 70, EXIT: 95 })

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function atLeast(values: readonly (number | null | undefined)[], predicate: (value: number) => boolean, count: number): boolean {
  return values.filter((value) => finite(value) && predicate(value)).length >= count
}

export function assessPositionExitRisk(input: Readonly<{
  candidate: ScoredResearchCandidate
  config: StrategyConfig
  currentWeightPct: number
  unrealizedPnlPct: number | null
}>): PositionExitRiskAssessment {
  const { candidate, config } = input
  const metrics = candidate.metrics
  const flags: PositionExitRiskFlag[] = []
  const add = (code: string, level: PositionExitRiskFlag['level'], reason: string, mandatory = false): void => {
    flags.push(Object.freeze({ code, level, reason, mandatory }))
  }

  if (!candidate.selected) add('STRATEGY_DESELECTED', 'EXIT', candidate.selectionReason)
  if (candidate.rank !== null && candidate.rank >= config.eligibility.forcedReviewRank) {
    add('FORCED_REVIEW_RANK', 'EXIT', `Strategy rank ${candidate.rank} breached forced-review rank ${config.eligibility.forcedReviewRank}.`)
  }
  if (finite(metrics.catalystImpact) && metrics.catalystImpact <= -0.70) {
    add('VERIFIED_ADVERSE_EVENT', 'EXIT', 'Verified exchange disclosure indicates a severe adverse event.', true)
  }
  if (finite(metrics.resultImpact) && metrics.resultImpact <= -0.70) {
    add('SEVERE_RESULT_DETERIORATION', 'EXIT', 'Latest verified result has severe negative impact.', true)
  }
  if (finite(metrics.maxDrawdown) && metrics.maxDrawdown >= 0.50 && finite(metrics.trend) && metrics.trend <= -0.20) {
    add('TECHNICAL_CAPITULATION', 'EXIT', 'Drawdown exceeds 50% while price remains more than 20% below its long trend.', true)
  }
  if (input.unrealizedPnlPct !== null && input.unrealizedPnlPct <= -config.risk.drawdownKillSwitchPct
    && finite(metrics.trend) && metrics.trend < 0 && finite(metrics.m3m1) && metrics.m3m1 < 0) {
    add('LOSS_LIMIT_WITH_BREAKDOWN', 'EXIT', `Position loss breached ${config.risk.drawdownKillSwitchPct}% with confirmed negative trend and momentum.`, true)
  }

  const earningsGrowth = [metrics.revenueGrowth, metrics.patGrowth, metrics.epsGrowth]
  if (atLeast(earningsGrowth, (value) => value <= -0.20, 2)) {
    add('EARNINGS_BREAKDOWN', 'EXIT', 'At least two reported growth measures declined 20% or more.')
  } else if (atLeast(earningsGrowth, (value) => value < 0, 2) || (finite(metrics.resultImpact) && metrics.resultImpact <= -0.35)) {
    add('EARNINGS_DETERIORATION', 'REDUCE', 'Reported earnings trend has materially weakened.')
  }
  if (finite(metrics.catalystImpact) && metrics.catalystImpact <= -0.35) add('ADVERSE_CATALYST', 'REDUCE', 'Verified catalyst impact is materially negative.')
  if (finite(metrics.eventRisk) && metrics.eventRisk >= 0.65) add('HIGH_EVENT_RISK', 'REDUCE', 'Event-risk score is elevated.')
  if (finite(metrics.maxDrawdown) && metrics.maxDrawdown >= Math.max(0.25, config.regime.crisisDrawdownPct / 100)
    && finite(metrics.trend) && metrics.trend < 0
    && finite(metrics.m3m1) && metrics.m3m1 < 0) {
    add('DEEP_DRAWDOWN', 'REDUCE', `One-year drawdown is ${(metrics.maxDrawdown * 100).toFixed(1)}%.`)
  }
  if (finite(metrics.volatility60d) && metrics.volatility60d >= Math.max(0.45, config.regime.highVolatilityThreshold / 100)
    && finite(metrics.beta) && metrics.beta >= 1.30) {
    add('VOLATILITY_BETA_RISK', 'REDUCE', 'Annualized volatility and market beta are both elevated.')
  }
  if ((finite(metrics.leverageRisk) && metrics.leverageRisk >= 250) || (finite(metrics.debtCoverage) && metrics.debtCoverage < 0.5)) {
    add('LEVERAGE_RISK', 'REDUCE', 'Leverage or debt coverage has crossed the defensive threshold.')
  }
  if (input.currentWeightPct > config.eligibility.maxStockWeightPct * 1.20) {
    add('CONCENTRATION_RISK', 'REDUCE', `Position weight ${input.currentWeightPct.toFixed(1)}% materially exceeds the ${config.eligibility.maxStockWeightPct.toFixed(1)}% cap.`)
  }
  if (input.unrealizedPnlPct !== null && input.unrealizedPnlPct <= -config.risk.drawdownRiskReductionPct
    && finite(metrics.trend) && metrics.trend < 0) {
    add('LOSS_REDUCTION_LEVEL', 'REDUCE', `Position loss breached the ${config.risk.drawdownRiskReductionPct}% reduction threshold with a negative trend.`)
  }
  if (input.unrealizedPnlPct !== null && input.unrealizedPnlPct >= 25
    && finite(metrics.m3m1) && metrics.m3m1 < 0 && finite(metrics.trend) && metrics.trend < 0.05) {
    add('PROFIT_PROTECTION', 'REDUCE', 'Large unrealized gain is losing medium-term momentum.')
  }

  if (input.unrealizedPnlPct !== null && input.unrealizedPnlPct <= -config.risk.drawdownWarningPct) {
    add('LOSS_WARNING', 'WATCH', `Position loss breached the ${config.risk.drawdownWarningPct}% warning threshold.`)
  }
  if (finite(metrics.trend) && metrics.trend < 0 && finite(metrics.m3m1) && metrics.m3m1 < 0 && finite(metrics.m6m1) && metrics.m6m1 < 0) {
    add('MOMENTUM_BREAKDOWN', 'WATCH', 'Long trend, 3M-1M momentum, and 6M-1M momentum are all negative.')
  }
  if ((finite(metrics.returnOnEquity) && metrics.returnOnEquity <= 0) || (finite(metrics.operatingMargin) && metrics.operatingMargin <= 0)) {
    add('FUNDAMENTAL_QUALITY_WARNING', 'WATCH', 'ROE or operating margin is non-positive.')
  }
  if ((finite(metrics.catalystImpact) && metrics.catalystImpact <= -0.15)
    || (finite(metrics.resultImpact) && metrics.resultImpact <= -0.15)
    || (finite(metrics.eventRisk) && metrics.eventRisk >= 0.40)) {
    add('EVENT_REVIEW', 'WATCH', 'Catalyst, result, or scheduled-event risk requires review.')
  }
  if (candidate.dataCoveragePct < 70 || (candidate.catalystScanCoveragePct ?? 0) < 100) {
    add('DATA_COVERAGE_REVIEW', 'WATCH', `Research coverage is ${candidate.dataCoveragePct.toFixed(1)}% and catalyst scan coverage is ${(candidate.catalystScanCoveragePct ?? 0).toFixed(1)}%.`)
  }

  const level = flags.reduce<PositionExitRiskLevel>((highest, flag) => LEVEL_SCORE[flag.level] > LEVEL_SCORE[highest] ? flag.level : highest, 'NONE')
  const mandatoryExit = flags.some((flag) => flag.level === 'EXIT' && flag.mandatory)
  const score = mandatoryExit ? 100 : Math.min(99, LEVEL_SCORE[level] + Math.max(0, flags.length - 1) * 2)
  const summary = flags.length === 0 ? 'No active exit-risk criterion.' : flags.slice(0, 3).map((flag) => flag.reason).join(' ')
  return Object.freeze({ level, score, mandatoryExit, flags:Object.freeze(flags), summary })
}
