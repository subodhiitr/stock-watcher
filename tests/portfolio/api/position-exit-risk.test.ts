import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assessPositionExitRisk } from '../../../server/portfolio/application/api/position-exit-risk.ts'
import type { ScoredResearchCandidate } from '../../../server/portfolio/application/api/research-candidate-selection.ts'
import { MEDIUM_HORIZON_PRESET } from '../../../server/portfolio/domain/strategy/strategy-presets.ts'

function candidate(overrides: Partial<ScoredResearchCandidate> = {}): ScoredResearchCandidate {
  return Object.freeze({
    symbol: 'TEST', name: 'Test', sector: 'Technology', price: 100, prevClose: 99,
    listingHistoryDays: 2_000, median20dTradedValueLakh: 5_000,
    marketTimestamp: '2026-08-08T10:00:00.000Z',
    metrics: Object.freeze({
      m3m1: 0.10, m6m1: 0.20, relativeStrength: 0.05, trend: 0.08,
      earningsMomentum: 0.10, liquidity: 8, volatilityAdjusted: 0.8,
      returnOnEquity: 0.18, returnOnAssets: 0.09, operatingMargin: 0.15,
      profitMargin: 0.10, debtCoverage: 3, cashFlowQuality: 0.7,
      revenueGrowth: 0.10, patGrowth: 0.12, epsGrowth: 0.11, resultImpact: 0.2,
      sectorRelativeStrength: 0.05, sectorBreadth: 0.60, catalystImpact: 0.10,
      volatility60d: 0.20, maxDrawdown: 0.12, downsideDeviation: 0.10,
      beta: 0.8, liquidityRisk: -8, leverageRisk: 0.4, eventRisk: 0.10,
    }),
    evidence: Object.freeze([]), catalystScanCoveragePct: 100,
    eligible: true, eligibilityReasons: Object.freeze([]), rank: 10, score: 80,
    compositeScore: 1, momentumScore: 1, qualityScore: 1, valuationScore: 1, earningsScore: 1,
    sectorScore: 1, catalystScore: 1, lowRiskScore: 1,
    researchModelVersion: 'SIX_FACTOR_RESEARCH_V2', dataCoveragePct: 100,
    currentlyHeld: true, selected: true, selectionReason: 'Retained within the strategy hold rank.',
    ...overrides,
  })
}

describe('position exit-risk assessment', () => {
  it('requires exit for a severe verified adverse catalyst', () => {
    const base = candidate()
    const result = assessPositionExitRisk({
      candidate:candidate({ metrics:Object.freeze({ ...base.metrics, catalystImpact:-0.85 }) }),
      config:MEDIUM_HORIZON_PRESET.config,
      currentWeightPct:5,
      unrealizedPnlPct:-2,
    })
    assert.equal(result.level, 'EXIT')
    assert.equal(result.mandatoryExit, true)
    assert.equal(result.score, 100)
    assert.ok(result.flags.some((flag) => flag.code === 'VERIFIED_ADVERSE_EVENT'))
  })

  it('recommends a partial reduction to protect a large weakening gain', () => {
    const base = candidate()
    const result = assessPositionExitRisk({
      candidate:candidate({ metrics:Object.freeze({ ...base.metrics, m3m1:-0.05, trend:0.01 }) }),
      config:MEDIUM_HORIZON_PRESET.config,
      currentWeightPct:5,
      unrealizedPnlPct:30,
    })
    assert.equal(result.level, 'REDUCE')
    assert.equal(result.mandatoryExit, false)
    assert.ok(result.flags.some((flag) => flag.code === 'PROFIT_PROTECTION'))
  })

  it('leaves a healthy fully covered holding clear', () => {
    const result = assessPositionExitRisk({
      candidate:candidate(), config:MEDIUM_HORIZON_PRESET.config,
      currentWeightPct:5, unrealizedPnlPct:8,
    })
    assert.equal(result.level, 'NONE')
    assert.equal(result.flags.length, 0)
  })

  it('treats Yahoo debt-to-equity as a percentage and requires a current breakdown for historical drawdown', () => {
    const base = candidate()
    const result = assessPositionExitRisk({
      candidate:candidate({ metrics:Object.freeze({
        ...base.metrics,
        leverageRisk:45,
        maxDrawdown:0.35,
        trend:0.12,
        m3m1:0.08,
      }) }),
      config:MEDIUM_HORIZON_PRESET.config,
      currentWeightPct:5,
      unrealizedPnlPct:4,
    })
    assert.equal(result.level, 'NONE')
    assert.ok(!result.flags.some((flag) => flag.code === 'LEVERAGE_RISK' || flag.code === 'DEEP_DRAWDOWN'))
  })
})
