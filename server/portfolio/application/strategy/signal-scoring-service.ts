import { CONVICTION_MAX, CONVICTION_MIN, WINSORIZATION_SIGMA } from '../../domain/strategy/constants.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { StrategyVersionId, DataVersionId, InstrumentId } from '../../domain/shared/identifiers.ts'
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts'
import type { EligibilityResult } from '../../domain/strategy/eligibility-result.ts'
import { createSignalSnapshot, type SignalSnapshot, type MomentumComponents, type QualityComponents, type RiskComponents } from '../../domain/strategy/signal-snapshot.ts'
import type { MarketDataPort } from '../../ports/market-data/market-data-port.ts'
import type { FundamentalsPort } from '../../ports/market-data/fundamentals-port.ts'
import type { AiAdvisoryPort } from '../../ports/strategy/ai-advisory-port.ts'
import type { ClockPort } from '../../ports/index.ts'

function safeNumber(v: unknown, neutral = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return neutral
  return v
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function computeStd(values: number[], mean: number): number {
  if (values.length <= 1) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function winsorize(value: number, mean: number, std: number): number {
  if (std === 0) return 0
  const z = (value - mean) / std
  return Math.max(-WINSORIZATION_SIGMA, Math.min(WINSORIZATION_SIGMA, z))
}

function zScore(values: number[]): number[] {
  const mean = computeMean(values)
  const std = computeStd(values, mean)
  return values.map(v => winsorize(v, mean, std))
}

export class SignalScoringService {
  private readonly marketDataPort: MarketDataPort
  private readonly fundamentalsPort: FundamentalsPort
  private readonly aiAdvisoryPort: AiAdvisoryPort | undefined
  private readonly clock: ClockPort | undefined

  constructor(
    marketDataPort: MarketDataPort,
    fundamentalsPort: FundamentalsPort,
    aiAdvisoryPort?: AiAdvisoryPort,
    clock?: ClockPort,
  ) {
    this.marketDataPort = marketDataPort
    this.fundamentalsPort = fundamentalsPort
    this.aiAdvisoryPort = aiAdvisoryPort
    this.clock = clock
  }

  scoreUniverse(params: {
    eligibleInstruments: readonly EligibilityResult[]
    config: StrategyConfig
    dataVersionId: DataVersionId
    strategyVersionId: StrategyVersionId
    asOf: string
  }): DomainResult<readonly SignalSnapshot[]> {
    const { eligibleInstruments, config, dataVersionId, strategyVersionId, asOf } = params
    const eligible = eligibleInstruments.filter(e => e.status === 'ELIGIBLE' || e.status === 'HOLD_ELIGIBLE')
    if (eligible.length === 0) {
      return success(Object.freeze([]))
    }

    const computedAt = typeof this.clock !== 'undefined' ? this.clock.now() : asOf

    // Build raw factor vectors (neutral = 0 per SC-004)
    const momentumRaw: number[][] = eligible.map(() => [0, 0, 0, 0, 0, 0, 0])
    const qualityRaw: number[][] = eligible.map(() => [0, 0, 0, 0, 0, 0])
    const riskRaw: number[][] = eligible.map(() => [0, 0, 0, 0, 0])

    // Cross-sectional z-score per factor (SC-002, SC-003)
    const snapshots: SignalSnapshot[] = []
    const factorPolicy = config.factor

    for (let fi = 0; fi < 7; fi++) {
      const col = momentumRaw.map(r => r[fi] ?? 0)
      const zscores = zScore(col)
      for (let i = 0; i < eligible.length; i++) {
        const r = momentumRaw[i]
        if (r) r[fi] = zscores[i] ?? 0
      }
    }
    for (let fi = 0; fi < 6; fi++) {
      const col = qualityRaw.map(r => r[fi] ?? 0)
      const zscores = zScore(col)
      for (let i = 0; i < eligible.length; i++) {
        const r = qualityRaw[i]
        if (r) r[fi] = zscores[i] ?? 0
      }
    }
    for (let fi = 0; fi < 5; fi++) {
      const col = riskRaw.map(r => r[fi] ?? 0)
      const zscores = zScore(col)
      for (let i = 0; i < eligible.length; i++) {
        const r = riskRaw[i]
        if (r) r[fi] = zscores[i] ?? 0
      }
    }

    const mw = factorPolicy.momentumWeights
    const qw = factorPolicy.qualityWeights
    const rw = factorPolicy.riskWeights
    const compositeScores: number[] = []

    for (let i = 0; i < eligible.length; i++) {
      const mr = momentumRaw[i] ?? [0, 0, 0, 0, 0, 0, 0]
      const qr = qualityRaw[i] ?? [0, 0, 0, 0, 0, 0]
      const rr = riskRaw[i] ?? [0, 0, 0, 0, 0]

      const momentumScore =
        mw.m3m1 * (mr[0] ?? 0) + mw.m6m1 * (mr[1] ?? 0) + mw.relativeStrength * (mr[2] ?? 0) +
        mw.trend * (mr[3] ?? 0) + mw.earningsMomentum * (mr[4] ?? 0) +
        mw.liquidity * (mr[5] ?? 0) + mw.volatilityAdjusted * (mr[6] ?? 0)

      const qualityScore =
        qw.returnOnEquity * (qr[0] ?? 0) + qw.returnOnAssets * (qr[1] ?? 0) +
        qw.earningsStability * (qr[2] ?? 0) + qw.debtCoverage * (qr[3] ?? 0) +
        qw.cashFlowQuality * (qr[4] ?? 0) + qw.promoterPledge * (qr[5] ?? 0)

      // Low-risk score is inverted (SC-014)
      const rawRiskScore =
        rw.volatility60d * (rr[0] ?? 0) + rw.maxDrawdown * (rr[1] ?? 0) +
        rw.downsideDeviation * (rr[2] ?? 0) + rw.beta * (rr[3] ?? 0) +
        rw.liquidityRisk * (rr[4] ?? 0)
      const riskScore = -rawRiskScore

      const compositeScore =
        factorPolicy.momentumWeight * momentumScore +
        factorPolicy.qualityWeight * qualityScore +
        factorPolicy.lowRiskWeight * riskScore

      if (!Number.isFinite(compositeScore) || !Number.isFinite(momentumScore) || !Number.isFinite(qualityScore) || !Number.isFinite(riskScore)) {
        // Computation error per instrument; skip (others continue per SC-010)
        continue
      }

      compositeScores.push(compositeScore)
    }

    // Rank by composite score descending; ties broken by instrumentId descending (SC-011)
    const ranked = eligible
      .map((e, i) => ({ e, i, composite: compositeScores[i] ?? -Infinity }))
      .sort((a, b) => {
        if (b.composite !== a.composite) return b.composite - a.composite
        return b.e.instrumentId < a.e.instrumentId ? -1 : 1
      })
    const rankMap = new Map(ranked.map((item, rankIdx) => [item.e.instrumentId, rankIdx + 1]))

    // Conviction multiplier (SC-008)
    const n = eligible.length

    for (let i = 0; i < eligible.length; i++) {
      const elig = eligible[i]
      if (!elig) continue
      const mr = momentumRaw[i] ?? [0, 0, 0, 0, 0, 0, 0]
      const qr = qualityRaw[i] ?? [0, 0, 0, 0, 0, 0]
      const rr = riskRaw[i] ?? [0, 0, 0, 0, 0]
      const compositeScore = compositeScores[i] ?? 0

      if (!Number.isFinite(compositeScore)) continue

      const rank = rankMap.get(elig.instrumentId) ?? i + 1
      const percentile = n > 1 ? (n - rank) / (n - 1) : 0.5
      const convictionMultiplier = Math.max(CONVICTION_MIN, Math.min(CONVICTION_MAX, CONVICTION_MIN + (CONVICTION_MAX - CONVICTION_MIN) * percentile))

      const momentumScore =
        (mw.m3m1 * (mr[0] ?? 0)) + (mw.m6m1 * (mr[1] ?? 0)) + (mw.relativeStrength * (mr[2] ?? 0)) +
        (mw.trend * (mr[3] ?? 0)) + (mw.earningsMomentum * (mr[4] ?? 0)) +
        (mw.liquidity * (mr[5] ?? 0)) + (mw.volatilityAdjusted * (mr[6] ?? 0))
      const qualityScore =
        (qw.returnOnEquity * (qr[0] ?? 0)) + (qw.returnOnAssets * (qr[1] ?? 0)) +
        (qw.earningsStability * (qr[2] ?? 0)) + (qw.debtCoverage * (qr[3] ?? 0)) +
        (qw.cashFlowQuality * (qr[4] ?? 0)) + (qw.promoterPledge * (qr[5] ?? 0))
      const rawRiskScore =
        (rw.volatility60d * (rr[0] ?? 0)) + (rw.maxDrawdown * (rr[1] ?? 0)) +
        (rw.downsideDeviation * (rr[2] ?? 0)) + (rw.beta * (rr[3] ?? 0)) + (rw.liquidityRisk * (rr[4] ?? 0))
      const riskScore = -rawRiskScore

      const momentumComponents: MomentumComponents = Object.freeze({
        m3m1: mr[0] ?? 0, m6m1: mr[1] ?? 0, relativeStrength: mr[2] ?? 0,
        trend: mr[3] ?? 0, earningsMomentum: mr[4] ?? 0, liquidity: mr[5] ?? 0, volatilityAdjusted: mr[6] ?? 0,
      })
      const qualityComponents: QualityComponents = Object.freeze({
        returnOnEquity: qr[0] ?? 0, returnOnAssets: qr[1] ?? 0, earningsStability: qr[2] ?? 0,
        debtCoverage: qr[3] ?? 0, cashFlowQuality: qr[4] ?? 0, promoterPledge: qr[5] ?? 0,
      })
      const riskComponents: RiskComponents = Object.freeze({
        volatility60d: rr[0] ?? 0, maxDrawdown: rr[1] ?? 0, downsideDeviation: rr[2] ?? 0,
        beta: rr[3] ?? 0, liquidityRisk: rr[4] ?? 0,
      })

      const result = createSignalSnapshot({
        instrumentId: elig.instrumentId,
        strategyVersionId,
        dataVersionId,
        asOf,
        isBfsi: elig.isBfsi,
        momentumComponents,
        qualityComponents,
        riskComponents,
        momentumScore,
        qualityScore,
        riskScore,
        compositeScore,
        convictionMultiplier,
        rank,
        computedAt,
        missingComponentsNeutralized: true,
      })
      if (result.ok) snapshots.push(result.value)
    }

    return success(Object.freeze(snapshots))
  }
}
