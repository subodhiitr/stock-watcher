import { createHash } from 'node:crypto'

import type { StrategicRebalancePolicy } from '../../domain/strategy/strategy-config.ts'

export type StrategicBenchmarkObservation = Readonly<{
  sessionDate: string
  adjustedLevel: number
}>

export type StrategicBenchmarkHistory = Readonly<{
  source: 'YAHOO_RESEARCH'
  adjustment: 'ADJUSTED_CLOSE'
  retrievedAt: string
  riskBenchmark: string
  defensiveBenchmark: string
  risk: readonly StrategicBenchmarkObservation[]
  defensive: readonly StrategicBenchmarkObservation[]
  defensiveProxy?: Readonly<{
    symbol: string
    yahooSymbol: string
    purpose: 'PRE_INCEPTION_HISTORY_EXTENSION'
    primaryHistoryStartsOn: string | null
    extendedObservations: number
  }>
}>

export type StrategicTrendHorizon = Readonly<{
  months: 1 | 3 | 12
  riskReturn: number
  defensiveReturn: number
  relativeReturn: number
  pointInTimeBaseline: number
  relativeExcess: number
  negative: boolean
  baselineObservations: number
}>

export type StrategicRebalanceState =
  | 'NORMAL'
  | 'NEGATIVE_UNCONFIRMED'
  | 'NEGATIVE_CONFIRMED'
  | 'DATA_BLOCKED'
  | 'FORCED_REVIEW'

export type StrategicRebalanceSnapshot = Readonly<{
  policyVersion: 'STRATEGIC_REBALANCE_V1'
  state: StrategicRebalanceState
  headline: string
  approvalBlocked: boolean
  blockerCodes: readonly string[]
  decisionSessionDate: string
  riskBenchmark: string
  defensiveBenchmark: string
  horizons: readonly StrategicTrendHorizon[]
  primaryHorizonMonths: 1 | 3 | 12
  confirmationHorizonMonths?: 1 | 3 | 12
  permittedRebalanceFraction: number
  appliedBuyFraction: number
  delayStartedOn: string | null
  forcedReviewOn: string | null
  delayedBuyMinorUnits: string
  retainedCashMinorUnits: string
  dataHash: string
  calculatedAt: string
  source: 'YAHOO_RESEARCH'
  adjustment: 'ADJUSTED_CLOSE'
  defensiveProxy?: StrategicBenchmarkHistory['defensiveProxy']
}>

type PriorDelay = Readonly<{ state: StrategicRebalanceState; delayStartedOn: string | null }> | undefined

function daysBetween(left: string, right: string): number {
  return Math.floor((Date.parse(right) - Date.parse(left)) / 86_400_000)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function dataHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function alignedRows(history: StrategicBenchmarkHistory, cutoffDate: string): readonly Readonly<{
  sessionDate: string
  risk: number
  defensive: number
}>[] {
  const defensive = new Map(history.defensive.filter((item) => item.sessionDate <= cutoffDate).map((item) => [item.sessionDate, item.adjustedLevel]))
  return Object.freeze(history.risk
    .filter((item) => item.sessionDate <= cutoffDate)
    .map((item) => Object.freeze({ sessionDate: item.sessionDate, risk: item.adjustedLevel, defensive: defensive.get(item.sessionDate) ?? Number.NaN }))
    .filter((item) => Number.isFinite(item.risk) && item.risk > 0 && Number.isFinite(item.defensive) && item.defensive > 0)
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate)))
}

function horizonSignal(
  rows: ReturnType<typeof alignedRows>,
  months: 1 | 3 | 12,
  policy: StrategicRebalancePolicy,
): StrategicTrendHorizon | undefined {
  const horizonSessions = months * 21
  const latestIndex = rows.length - 1
  const start = rows[latestIndex - horizonSessions]
  const latest = rows[latestIndex]
  if (start === undefined || latest === undefined) return undefined
  const riskReturn = latest.risk / start.risk - 1
  const defensiveReturn = latest.defensive / start.defensive - 1
  const relativeReturn = riskReturn - defensiveReturn
  const baseline: number[] = []
  const earliest = Math.max(horizonSessions, latestIndex - policy.baselineLookbackMonths * 21)
  for (let endIndex = latestIndex - 21; endIndex >= earliest; endIndex -= 21) {
    const baselineStart = rows[endIndex - horizonSessions]
    const baselineEnd = rows[endIndex]
    if (baselineStart === undefined || baselineEnd === undefined) continue
    baseline.push((baselineEnd.risk / baselineStart.risk - 1) - (baselineEnd.defensive / baselineStart.defensive - 1))
  }
  if (baseline.length < policy.minimumBaselineObservations) return undefined
  const pointInTimeBaseline = baseline.reduce((total, value) => total + value, 0) / baseline.length
  const relativeExcess = relativeReturn - pointInTimeBaseline
  return Object.freeze({
    months, riskReturn, defensiveReturn, relativeReturn, pointInTimeBaseline,
    relativeExcess, negative: relativeExcess < 0, baselineObservations: baseline.length,
  })
}

export function calculateStrategicRebalanceSnapshot(input: Readonly<{
  policy: StrategicRebalancePolicy
  history?: StrategicBenchmarkHistory
  now: string
  priorDelay?: PriorDelay
}>): StrategicRebalanceSnapshot {
  const { policy, history, now } = input
  const blockers: string[] = []
  if (history === undefined) blockers.push('STRATEGIC_BENCHMARK_HISTORY_MISSING')
  if (history !== undefined && history.riskBenchmark !== policy.riskBenchmark) blockers.push('STRATEGIC_RISK_BENCHMARK_MISMATCH')
  if (history !== undefined && history.defensiveBenchmark !== policy.defensiveBenchmark) blockers.push('STRATEGIC_DEFENSIVE_BENCHMARK_MISMATCH')
  const retrievedAgeHours = history === undefined ? Number.POSITIVE_INFINITY : (Date.parse(now) - Date.parse(history.retrievedAt)) / 3_600_000
  if (!Number.isFinite(retrievedAgeHours) || retrievedAgeHours < -1 || retrievedAgeHours > policy.staleAfterHours) blockers.push('STRATEGIC_BENCHMARK_DATA_STALE')
  const cutoffDate = now.slice(0, 10)
  const rows = history === undefined ? Object.freeze([]) : alignedRows(history, cutoffDate)
  const riskLatest = history?.risk.filter((item) => item.sessionDate <= cutoffDate).at(-1)?.sessionDate
  const defensiveLatest = history?.defensive.filter((item) => item.sessionDate <= cutoffDate).at(-1)?.sessionDate
  if (riskLatest === undefined || defensiveLatest === undefined || riskLatest !== defensiveLatest) blockers.push('STRATEGIC_BENCHMARK_SESSION_MISMATCH')
  const requestedHorizons = [...new Set([policy.primaryHorizonMonths, policy.confirmationHorizonMonths].filter((value): value is 1 | 3 | 12 => value !== undefined))]
  const horizons = requestedHorizons.map((months) => horizonSignal(rows, months, policy)).filter((value): value is StrategicTrendHorizon => value !== undefined)
  if (horizons.length !== requestedHorizons.length) blockers.push('STRATEGIC_BASELINE_INCOMPLETE')
  const hashInput = Object.freeze({ policy, history })
  const hash = dataHash(hashInput)
  const decisionSessionDate = riskLatest ?? now.slice(0, 10)
  if (blockers.length > 0) {
    return Object.freeze({
      policyVersion: 'STRATEGIC_REBALANCE_V1', state: 'DATA_BLOCKED',
      headline: 'Strategic timing is blocked because complete point-in-time benchmark history is unavailable.',
      approvalBlocked: true, blockerCodes: Object.freeze([...new Set(blockers)]), decisionSessionDate,
      riskBenchmark: policy.riskBenchmark, defensiveBenchmark: policy.defensiveBenchmark,
      horizons: Object.freeze(horizons), primaryHorizonMonths: policy.primaryHorizonMonths,
      ...(policy.confirmationHorizonMonths === undefined ? {} : { confirmationHorizonMonths: policy.confirmationHorizonMonths }),
      permittedRebalanceFraction: policy.permittedRebalanceFraction, appliedBuyFraction: policy.permittedRebalanceFraction,
      delayStartedOn: null, forcedReviewOn: null, delayedBuyMinorUnits: '0', retainedCashMinorUnits: '0',
      dataHash: hash, calculatedAt: now, source: 'YAHOO_RESEARCH', adjustment: 'ADJUSTED_CLOSE',
      ...(history?.defensiveProxy === undefined ? {} : { defensiveProxy:history.defensiveProxy }),
    })
  }
  const primary = horizons.find((item) => item.months === policy.primaryHorizonMonths) as StrategicTrendHorizon
  const confirmation = policy.confirmationHorizonMonths === undefined
    ? undefined : horizons.find((item) => item.months === policy.confirmationHorizonMonths)
  let state: StrategicRebalanceState = primary.negative
    ? confirmation === undefined || confirmation.negative ? 'NEGATIVE_CONFIRMED' : 'NEGATIVE_UNCONFIRMED'
    : 'NORMAL'
  const continuingDelay = state === 'NEGATIVE_CONFIRMED' && input.priorDelay?.delayStartedOn
    ? input.priorDelay.delayStartedOn : state === 'NEGATIVE_CONFIRMED' ? decisionSessionDate : null
  const forcedReviewOn = continuingDelay === null ? null : addDays(continuingDelay, policy.maximumDelayCalendarDays)
  if (state === 'NEGATIVE_CONFIRMED' && continuingDelay !== null && daysBetween(continuingDelay, decisionSessionDate) >= policy.maximumDelayCalendarDays) {
    state = 'FORCED_REVIEW'
  }
  const approvalBlocked = policy.mode === 'OBSERVE' || state === 'NEGATIVE_UNCONFIRMED' || state === 'FORCED_REVIEW'
  const appliedBuyFraction = state === 'NEGATIVE_CONFIRMED' || state === 'FORCED_REVIEW'
    ? policy.negativeTrendBuyFraction : policy.permittedRebalanceFraction
  const headline = state === 'NEGATIVE_CONFIRMED'
    ? `Routine equity buys delayed by confirmed negative ${policy.primaryHorizonMonths}-month relative trend.`
    : state === 'NEGATIVE_UNCONFIRMED'
      ? 'Primary negative relative trend is not confirmed; plan is observe-only.'
      : state === 'FORCED_REVIEW'
        ? 'Maximum strategic delay reached; explicit forced review is required.'
        : `Relative trend permits a ${Math.round(policy.permittedRebalanceFraction * 100)}% move toward target.`
  return Object.freeze({
    policyVersion: 'STRATEGIC_REBALANCE_V1', state, headline, approvalBlocked,
    blockerCodes: Object.freeze(approvalBlocked ? [policy.mode === 'OBSERVE' ? 'STRATEGIC_OBSERVE_ONLY' : state === 'FORCED_REVIEW' ? 'STRATEGIC_MAX_DELAY_FORCED_REVIEW' : 'STRATEGIC_NEGATIVE_TREND_UNCONFIRMED'] : []),
    decisionSessionDate, riskBenchmark: policy.riskBenchmark, defensiveBenchmark: policy.defensiveBenchmark,
    horizons: Object.freeze(horizons), primaryHorizonMonths: policy.primaryHorizonMonths,
    ...(policy.confirmationHorizonMonths === undefined ? {} : { confirmationHorizonMonths: policy.confirmationHorizonMonths }),
    permittedRebalanceFraction: policy.permittedRebalanceFraction, appliedBuyFraction,
    delayStartedOn: continuingDelay, forcedReviewOn, delayedBuyMinorUnits: '0', retainedCashMinorUnits: '0',
    dataHash: hash, calculatedAt: now, source: 'YAHOO_RESEARCH', adjustment: 'ADJUSTED_CLOSE',
    ...(history?.defensiveProxy === undefined ? {} : { defensiveProxy:history.defensiveProxy }),
  })
}

export function withStrategicCashImpact(
  snapshot: StrategicRebalanceSnapshot,
  delayedBuyMinorUnits: bigint,
): StrategicRebalanceSnapshot {
  return Object.freeze({
    ...snapshot,
    delayedBuyMinorUnits: delayedBuyMinorUnits.toString(),
    retainedCashMinorUnits: delayedBuyMinorUnits.toString(),
  })
}
