import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { selectResearchCandidates, type ResearchCandidate } from '../../../server/portfolio/application/api/research-candidate-selection.ts'
import { SIX_FACTOR_RESEARCH_MODEL } from '../../../server/portfolio/application/api/research-model.ts'
import { MEDIUM_HORIZON_PRESET } from '../../../server/portfolio/domain/strategy/strategy-presets.ts'

function candidate(symbol: string, strength: number, overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return Object.freeze({
    symbol,
    name: symbol,
    sector: 'Technology',
    price: 1_000,
    prevClose: 990,
    listingHistoryDays: 2_000,
    median20dTradedValueLakh: 5_000,
    marketTimestamp: '2026-08-08T10:00:00.000Z',
    metrics: Object.freeze({
      m3m1: strength,
      m6m1: strength,
      relativeStrength: strength,
      trend: strength,
      earningsMomentum: strength,
      liquidity: strength,
      volatilityAdjusted: strength,
      returnOnEquity: strength,
      returnOnAssets: strength,
      operatingMargin: strength,
      profitMargin: strength,
      debtCoverage: strength,
      cashFlowQuality: strength,
      revenueGrowth: strength,
      patGrowth: strength,
      epsGrowth: strength,
      resultImpact: strength,
      sectorRelativeStrength: strength,
      sectorBreadth: strength,
      catalystImpact: strength,
      volatility60d: 1 - strength,
      maxDrawdown: 1 - strength,
      downsideDeviation: 1 - strength,
      beta: 1 - strength,
      liquidityRisk: 1 - strength,
      leverageRisk: 1 - strength,
      eventRisk: 1 - strength,
    }),
    ...overrides,
  })
}

describe('research candidate selection', () => {
  it('uses the immutable recommended six-factor weights', () => {
    assert.equal(SIX_FACTOR_RESEARCH_MODEL.version, 'SIX_FACTOR_RESEARCH_V2')
    assert.deepEqual(SIX_FACTOR_RESEARCH_MODEL.factorWeights, {
      momentum: 0.35,
      quality: 0.20,
      earnings: 0.15,
      sector: 0.10,
      catalyst: 0.10,
      lowRisk: 0.10,
    })
  })

  it('ranks market opportunities and selects new constituents', () => {
    const result = selectResearchCandidates({
      candidates: Object.freeze([
        candidate('CURRENT', 0.2),
        candidate('LEADER', 0.9),
        candidate('SECOND', 0.7),
      ]),
      config: MEDIUM_HORIZON_PRESET.config,
      currentSymbols: new Set(['CURRENT']),
    })
    const leader = result.find((item) => item.symbol === 'LEADER')
    assert.equal(leader?.rank, 1)
    assert.equal(leader?.selected, true)
    assert.equal(leader?.currentlyHeld, false)
    assert.equal(leader?.researchModelVersion, 'SIX_FACTOR_RESEARCH_V2')
    assert.ok((leader?.earningsScore ?? 0) > 0)
    assert.ok((leader?.sectorScore ?? 0) > 0)
    assert.ok((leader?.catalystScore ?? 0) > 0)
    assert.match(leader?.selectionReason ?? '', /new opportunity/u)
  })

  it('excludes illiquid and insufficient-history securities', () => {
    const result = selectResearchCandidates({
      candidates: Object.freeze([
        candidate('ELIGIBLE', 0.8),
        candidate('ILLIQUID', 0.9, { median20dTradedValueLakh: 1 }),
        candidate('NEWLISTING', 1, { listingHistoryDays: 20 }),
      ]),
      config: MEDIUM_HORIZON_PRESET.config,
      currentSymbols: new Set(),
    })
    assert.equal(result.find((item) => item.symbol === 'ILLIQUID')?.eligible, false)
    assert.deepEqual(result.find((item) => item.symbol === 'ILLIQUID')?.eligibilityReasons, ['TRADED_VALUE'])
    assert.equal(result.find((item) => item.symbol === 'NEWLISTING')?.eligible, false)
    assert.deepEqual(result.find((item) => item.symbol === 'NEWLISTING')?.eligibilityReasons, ['LISTING_HISTORY'])
  })

  it('reports partial factor coverage without inventing missing fundamentals', () => {
    const result = selectResearchCandidates({
      candidates: Object.freeze([candidate('PARTIAL', 0.7, {
        metrics: Object.freeze({ m3m1: 0.5, m6m1: 0.6, trend: 0.4 }),
      })]),
      config: MEDIUM_HORIZON_PRESET.config,
      currentSymbols: new Set(),
    })
    const partial = result[0]
    assert.ok(partial)
    assert.ok(partial.dataCoveragePct > 0)
    assert.ok(partial.dataCoveragePct < 100)
    assert.equal(partial.catalystScore, 0)
  })

  it('rewards cheaper positive P/E within the same sector', () => {
    const sharedMetrics = candidate('BASE', 0.5).metrics
    const result = selectResearchCandidates({
      candidates: Object.freeze([
        candidate('CHEAP', 0.5, { metrics: Object.freeze({ ...sharedMetrics, forwardPE: 12 }) }),
        candidate('MID', 0.5, { metrics: Object.freeze({ ...sharedMetrics, forwardPE: 20 }) }),
        candidate('EXPENSIVE', 0.5, { metrics: Object.freeze({ ...sharedMetrics, forwardPE: 35 }) }),
      ]),
      config: MEDIUM_HORIZON_PRESET.config,
      currentSymbols: new Set(),
    })
    const cheap = result.find((item) => item.symbol === 'CHEAP')
    const expensive = result.find((item) => item.symbol === 'EXPENSIVE')
    assert.ok((cheap?.valuationScore ?? 0) > (expensive?.valuationScore ?? 0))
    assert.ok((cheap?.qualityScore ?? 0) > (expensive?.qualityScore ?? 0))
    assert.ok((cheap?.rank ?? 99) < (expensive?.rank ?? 99))
    assert.match(cheap?.evidence?.at(-1) ?? '', /forward P\/E 12\.0 is at the 0th percentile of 3 analyzed Technology peers/u)
  })

  it('uses sector-relative P/B for financial companies', () => {
    const sharedMetrics = candidate('BASE', 0.5).metrics
    const result = selectResearchCandidates({
      candidates: Object.freeze([
        candidate('BANKA', 0.5, { sector: 'Financial Services', metrics: Object.freeze({ ...sharedMetrics, forwardPE: 30, priceToBook: 1.2 }) }),
        candidate('BANKB', 0.5, { sector: 'Financial Services', metrics: Object.freeze({ ...sharedMetrics, forwardPE: 10, priceToBook: 3.5 }) }),
      ]),
      config: MEDIUM_HORIZON_PRESET.config,
      currentSymbols: new Set(),
    })
    const bank = result.find((item) => item.symbol === 'BANKA')
    assert.ok((bank?.valuationScore ?? 0) > 0)
    assert.match(bank?.evidence?.at(-1) ?? '', /P\/B 1\.2 is at the 0th percentile/u)
  })
})
