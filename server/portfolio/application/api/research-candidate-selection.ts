import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts'
import { SIX_FACTOR_RESEARCH_MODEL } from './research-model.ts'
import type { StrategicBenchmarkHistory } from '../rebalancing/relative-trend-signal.ts'

export type ResearchCandidateMetrics = Readonly<{
  m3m1?: number | null
  m6m1?: number | null
  relativeStrength?: number | null
  trend?: number | null
  earningsMomentum?: number | null
  liquidity?: number | null
  volatilityAdjusted?: number | null
  returnOnEquity?: number | null
  returnOnAssets?: number | null
  earningsStability?: number | null
  debtCoverage?: number | null
  cashFlowQuality?: number | null
  trailingPE?: number | null
  forwardPE?: number | null
  priceToBook?: number | null
  sectorRelativeValuation?: number | null
  promoterPledge?: number | null
  operatingMargin?: number | null
  profitMargin?: number | null
  revenueGrowth?: number | null
  patGrowth?: number | null
  epsGrowth?: number | null
  resultImpact?: number | null
  sectorRelativeStrength?: number | null
  sectorBreadth?: number | null
  catalystImpact?: number | null
  volatility60d?: number | null
  maxDrawdown?: number | null
  downsideDeviation?: number | null
  beta?: number | null
  liquidityRisk?: number | null
  leverageRisk?: number | null
  eventRisk?: number | null
}>

export type ResearchCandidate = Readonly<{
  symbol: string
  name?: string
  sector?: string | null
  price: number
  prevClose?: number
  listingHistoryDays: number
  median20dTradedValueLakh: number
  marketTimestamp: string
  metrics: ResearchCandidateMetrics
  evidence?: readonly string[]
  catalystScanCoveragePct?: number
}>

export type ResearchUniverseSnapshot = Readonly<{
  source: 'YAHOO_RESEARCH'
  indexUniverse: string
  benchmark: string
  asOf: string
  constituentCount: number
  analyzedCount: number
  researchModelVersion?: string
  catalystScanCoveragePct?: number
  strategicBenchmarkHistory?: StrategicBenchmarkHistory
  candidates: readonly ResearchCandidate[]
  warnings: readonly string[]
}>

export type ResearchMarketAnalysisProvider = (request: Readonly<{
  indexUniverse: string
  benchmark: string
  includeSymbols: readonly string[]
  targetHoldings: number
  strategicBenchmarks?: Readonly<{ riskBenchmark: string; defensiveBenchmark: string }>
}>) => Promise<ResearchUniverseSnapshot>

export type ScoredResearchCandidate = ResearchCandidate & Readonly<{
  eligible: boolean
  eligibilityReasons: readonly string[]
  rank: number | null
  score: number | null
  compositeScore: number | null
  momentumScore: number | null
  qualityScore: number | null
  valuationScore: number | null
  earningsScore: number | null
  sectorScore: number | null
  catalystScore: number | null
  lowRiskScore: number | null
  researchModelVersion: string
  dataCoveragePct: number
  currentlyHeld: boolean
  selected: boolean
  selectionReason: string
}>

type MetricKey = keyof ResearchCandidateMetrics

const FACTOR_COMPONENTS = SIX_FACTOR_RESEARCH_MODEL.componentWeights
const FACTOR_WEIGHTS = SIX_FACTOR_RESEARCH_MODEL.factorWeights
const MOMENTUM_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.momentum) as MetricKey[])
const QUALITY_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.quality) as MetricKey[])
const EARNINGS_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.earnings) as MetricKey[])
const SECTOR_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.sector) as MetricKey[])
const CATALYST_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.catalyst) as MetricKey[])
const RISK_KEYS = Object.freeze(Object.keys(FACTOR_COMPONENTS.lowRisk) as MetricKey[])
const ALL_KEYS = Object.freeze([...MOMENTUM_KEYS, ...QUALITY_KEYS, ...EARNINGS_KEYS, ...SECTOR_KEYS, ...CATALYST_KEYS, ...RISK_KEYS])

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: number | null | undefined): value is number {
  return finite(value) && value > 0
}

function isFinancialSector(sector: string | null | undefined): boolean {
  return /bank|financ|insurance|capital markets|asset management|credit service/iu.test(sector ?? '')
}

function valuationBasis(candidate: ResearchCandidate): Readonly<{ multiple: number; label: string }> | null {
  if (isFinancialSector(candidate.sector) && positive(candidate.metrics.priceToBook)) {
    return Object.freeze({ multiple: candidate.metrics.priceToBook, label: 'P/B' })
  }
  if (positive(candidate.metrics.forwardPE)) {
    return Object.freeze({ multiple: candidate.metrics.forwardPE, label: 'forward P/E' })
  }
  if (positive(candidate.metrics.trailingPE)) {
    return Object.freeze({ multiple: candidate.metrics.trailingPE, label: 'trailing P/E' })
  }
  return null
}

function addSectorRelativeValuation(candidates: readonly ResearchCandidate[]): readonly ResearchCandidate[] {
  const peers = new Map<string, number[]>()
  for (const candidate of candidates) {
    const basis = valuationBasis(candidate)
    if (basis === null || !candidate.sector) continue
    const key = `${candidate.sector.trim().toUpperCase()}|${basis.label}`
    peers.set(key, [...(peers.get(key) ?? []), basis.multiple])
  }
  return Object.freeze(candidates.map((candidate) => {
    const basis = valuationBasis(candidate)
    const key = basis === null || !candidate.sector ? null : `${candidate.sector.trim().toUpperCase()}|${basis.label}`
    const values = key === null ? [] : [...(peers.get(key) ?? [])].sort((left, right) => left - right)
    if (basis === null || values.length < 2) return candidate
    const lower = values.filter((value) => value < basis.multiple).length
    const equal = values.filter((value) => value === basis.multiple).length
    const percentile = (lower + Math.max(0, equal - 1) / 2) / (values.length - 1)
    const cheapness = 1 - percentile
    const valuationEvidence = `${basis.label} ${basis.multiple.toFixed(1)} is at the ${Math.round(percentile * 100)}th percentile of ${values.length} analyzed ${candidate.sector} peers; lower is cheaper.`
    return Object.freeze({
      ...candidate,
      metrics: Object.freeze({ ...candidate.metrics, sectorRelativeValuation: cheapness }),
      evidence: Object.freeze([...(candidate.evidence ?? []), valuationEvidence]),
    })
  }))
}

function zScores(candidates: readonly ResearchCandidate[], key: MetricKey): ReadonlyMap<string, number> {
  const observed = candidates
    .map((candidate) => candidate.metrics[key])
    .filter(finite)
  if (observed.length < 2) return new Map(candidates.map((candidate) => [candidate.symbol, 0]))
  const mean = observed.reduce((total, value) => total + value, 0) / observed.length
  const variance = observed.reduce((total, value) => total + ((value - mean) ** 2), 0) / observed.length
  const standardDeviation = Math.sqrt(variance)
  return new Map(candidates.map((candidate) => {
    const value = candidate.metrics[key]
    const score = finite(value) && standardDeviation > 0
      ? Math.max(-3, Math.min(3, (value - mean) / standardDeviation))
      : 0
    return [candidate.symbol, score]
  }))
}

function weightedScore(
  symbol: string,
  keys: readonly MetricKey[],
  weights: Readonly<Record<string, number>>,
  zByKey: ReadonlyMap<MetricKey, ReadonlyMap<string, number>>,
): number {
  return keys.reduce((total, key) => total + (weights[key] ?? 0) * (zByKey.get(key)?.get(symbol) ?? 0), 0)
}

function coverage(candidate: ResearchCandidate): number {
  const groups = [
    [MOMENTUM_KEYS, FACTOR_COMPONENTS.momentum, FACTOR_WEIGHTS.momentum],
    [QUALITY_KEYS, FACTOR_COMPONENTS.quality, FACTOR_WEIGHTS.quality],
    [EARNINGS_KEYS, FACTOR_COMPONENTS.earnings, FACTOR_WEIGHTS.earnings],
    [SECTOR_KEYS, FACTOR_COMPONENTS.sector, FACTOR_WEIGHTS.sector],
    [CATALYST_KEYS, FACTOR_COMPONENTS.catalyst, FACTOR_WEIGHTS.catalyst],
    [RISK_KEYS, FACTOR_COMPONENTS.lowRisk, FACTOR_WEIGHTS.lowRisk],
  ] as const
  let available = 0
  let total = 0
  for (const [keys, weights, groupWeight] of groups) {
    const componentWeights = weights as Readonly<Record<string, number>>
    for (const key of keys) {
      const componentWeight = groupWeight * (componentWeights[key] ?? 0)
      total += componentWeight
      if (finite(candidate.metrics[key])) available += componentWeight
    }
  }
  return total <= 0 ? 0 : Math.round((available / total) * 1000) / 10
}

function eligibilityReasons(candidate: ResearchCandidate, config: StrategyConfig): readonly string[] {
  const reasons: string[] = []
  if (!Number.isFinite(candidate.price) || candidate.price * 100 < config.universe.minPricePaise) reasons.push('MIN_PRICE')
  if (candidate.listingHistoryDays < config.universe.minListingHistoryDays) reasons.push('LISTING_HISTORY')
  if (candidate.median20dTradedValueLakh < config.universe.minMedian20dTradedValueLakh) reasons.push('TRADED_VALUE')
  if (!finite(candidate.metrics.m3m1) || !finite(candidate.metrics.m6m1)) reasons.push('MOMENTUM_HISTORY')
  return Object.freeze(reasons)
}

export function selectResearchCandidates(input: Readonly<{
  candidates: readonly ResearchCandidate[]
  config: StrategyConfig
  currentSymbols: ReadonlySet<string>
}>): readonly ScoredResearchCandidate[] {
  const normalized = addSectorRelativeValuation(input.candidates.map((candidate) => Object.freeze({
    ...candidate,
    symbol: candidate.symbol.trim().toUpperCase(),
  })))
  const eligible = normalized.filter((candidate) => eligibilityReasons(candidate, input.config).length === 0)
  const zByKey = new Map<MetricKey, ReadonlyMap<string, number>>(ALL_KEYS.map((key) => [key, zScores(eligible, key)]))
  const scored = eligible.map((candidate) => {
    const momentumScore = weightedScore(candidate.symbol, MOMENTUM_KEYS, FACTOR_COMPONENTS.momentum, zByKey)
    const qualityScore = weightedScore(candidate.symbol, QUALITY_KEYS, FACTOR_COMPONENTS.quality, zByKey)
    const valuationScore = zByKey.get('sectorRelativeValuation')?.get(candidate.symbol) ?? 0
    const earningsScore = weightedScore(candidate.symbol, EARNINGS_KEYS, FACTOR_COMPONENTS.earnings, zByKey)
    const sectorScore = weightedScore(candidate.symbol, SECTOR_KEYS, FACTOR_COMPONENTS.sector, zByKey)
    const catalystScore = weightedScore(candidate.symbol, CATALYST_KEYS, FACTOR_COMPONENTS.catalyst, zByKey)
    const lowRiskScore = -weightedScore(candidate.symbol, RISK_KEYS, FACTOR_COMPONENTS.lowRisk, zByKey)
    const compositeScore = (
      FACTOR_WEIGHTS.momentum * momentumScore
      + FACTOR_WEIGHTS.quality * qualityScore
      + FACTOR_WEIGHTS.earnings * earningsScore
      + FACTOR_WEIGHTS.sector * sectorScore
      + FACTOR_WEIGHTS.catalyst * catalystScore
      + FACTOR_WEIGHTS.lowRisk * lowRiskScore
    )
    return { candidate, momentumScore, qualityScore, valuationScore, earningsScore, sectorScore, catalystScore, lowRiskScore, compositeScore }
  }).sort((left, right) => right.compositeScore - left.compositeScore || left.candidate.symbol.localeCompare(right.candidate.symbol))

  const ranked = scored.map((item, index) => Object.freeze({
    ...item,
    rank: index + 1,
    score: scored.length <= 1 ? 50 : Math.round(((scored.length - index - 1) / (scored.length - 1)) * 10_000) / 100,
  }))
  const bySymbol = new Map(ranked.map((item) => [item.candidate.symbol, item]))
  const held = ranked
    .filter((item) => input.currentSymbols.has(item.candidate.symbol) && item.rank <= input.config.eligibility.holdRank)
    .slice(0, input.config.construction.targetHoldings)
  const entrants = ranked.filter((item) => (
    !input.currentSymbols.has(item.candidate.symbol)
    && item.rank <= input.config.eligibility.entryRank
  ))
  const selected = new Map(held.map((item) => [item.candidate.symbol, item]))
  for (const entrant of entrants) {
    if (selected.size >= input.config.construction.targetHoldings) break
    selected.set(entrant.candidate.symbol, entrant)
  }
  for (const entrant of entrants) {
    if (selected.has(entrant.candidate.symbol) || selected.size === 0) continue
    const weakestHeld = [...selected.values()]
      .filter((item) => input.currentSymbols.has(item.candidate.symbol))
      .sort((left, right) => left.score - right.score)[0]
    if (weakestHeld === undefined) break
    if (entrant.score - weakestHeld.score < input.config.construction.replacementScoreGapPct) break
    selected.delete(weakestHeld.candidate.symbol)
    selected.set(entrant.candidate.symbol, entrant)
  }
  if (selected.size < input.config.construction.targetHoldings) {
    for (const item of ranked) {
      if (selected.size >= input.config.construction.targetHoldings) break
      selected.set(item.candidate.symbol, item)
    }
  }

  return Object.freeze(normalized.map((candidate) => {
    const item = bySymbol.get(candidate.symbol)
    const reasons = eligibilityReasons(candidate, input.config)
    const isSelected = selected.has(candidate.symbol)
    const currentlyHeld = input.currentSymbols.has(candidate.symbol)
    return Object.freeze({
      ...candidate,
      eligible: reasons.length === 0,
      eligibilityReasons: reasons,
      rank: item?.rank ?? null,
      score: item?.score ?? null,
      compositeScore: item?.compositeScore ?? null,
      momentumScore: item?.momentumScore ?? null,
      qualityScore: item?.qualityScore ?? null,
      valuationScore: item?.valuationScore ?? null,
      earningsScore: item?.earningsScore ?? null,
      sectorScore: item?.sectorScore ?? null,
      catalystScore: item?.catalystScore ?? null,
      lowRiskScore: item?.lowRiskScore ?? null,
      researchModelVersion: SIX_FACTOR_RESEARCH_MODEL.version,
      dataCoveragePct: coverage(candidate),
      currentlyHeld,
      selected: isSelected,
      selectionReason: !item
        ? `Excluded by ${reasons.join(', ') || 'research eligibility'}.`
        : isSelected
          ? currentlyHeld ? 'Retained within the strategy hold rank.' : 'Selected as a strategy-ranked new opportunity.'
          : currentlyHeld ? 'Current holding falls outside the strategy hold or replacement threshold.' : 'Eligible but below this rebalance selection cutoff.',
    })
  }))
}
