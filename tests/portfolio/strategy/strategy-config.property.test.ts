import { describe, it } from "node:test"
import * as fc from "fast-check"
import assert from "node:assert/strict"
import { createStrategyConfig, strategyConfigsEqual } from "../../../server/portfolio/domain/strategy/strategy-config.ts"
import { SHORT_HORIZON_PRESET, MEDIUM_HORIZON_PRESET, LONG_HORIZON_PRESET } from "../../../server/portfolio/domain/strategy/strategy-presets.ts"

const VALID_RAW = {
  benchmark: "NIFTY50",
  routineFrequency: "MONTHLY",
  universe: { indexUniverse: "NIFTY500", minListingHistoryDays: 252, minPricePaise: 1000, minMedian20dTradedValueLakh: 100 },
  eligibility: { entryRank: 50, holdRank: 65, forcedReviewRank: 80, minStockWeightPct: 1.0, maxStockWeightPct: 10.0, noTradeBandPctPoints: 0.50, noTradeBandFractionOfTarget: 0.20 },
  factor: {
    momentumWeight: 0.55, qualityWeight: 0.30, lowRiskWeight: 0.15,
    momentumWeights: { m3m1: 0.15, m6m1: 0.20, relativeStrength: 0.15, trend: 0.15, earningsMomentum: 0.20, liquidity: 0.10, volatilityAdjusted: 0.05 },
    qualityWeights: { returnOnEquity: 0.25, returnOnAssets: 0.20, earningsStability: 0.20, debtCoverage: 0.15, cashFlowQuality: 0.10, promoterPledge: 0.10 },
    riskWeights: { volatility60d: 0.30, maxDrawdown: 0.25, downsideDeviation: 0.20, beta: 0.15, liquidityRisk: 0.10 },
    sectorNeutral: false,
  },
  construction: { targetHoldings: 25, maxHoldings: 30, replacementScoreGapPct: 10, cashBufferPct: 2.0 },
  regime: { confirmationPeriodsWeakening: 2, confirmationPeriodsStrengthening: 5, crisisDrawdownPct: 15.0, highVolatilityThreshold: 25.0 },
  rebalance: { routineFrequency: "MONTHLY", driftReviewFrequency: "MONTHLY", preferredMinHoldDays: 60, maxDailyTurnoverPct: 10.0, periodTurnoverBudget: { rollingDays: 30, limitPct: 25.0 } },
  execution: { product: "CNC", defaultOrderType: "MARKET", startTime: "09:45", endTime: "11:30", timezone: "Asia/Kolkata" },
  risk: { drawdownWarningPct: 10.0, drawdownRiskReductionPct: 15.0, drawdownKillSwitchPct: 20.0 },
  tax: { ltcgRatePct: 10.0, stcgRatePct: 15.0, sttBuyPct: 0.1, sttSellPct: 0.1, gstPct: 18.0 },
  automation: { allowedMode: "PAPER" },
}

describe("Strategy config property tests", () => {
  it("same raw input always produces same configHash (SR-014)", () => {
    const r1 = createStrategyConfig(VALID_RAW)
    const r2 = createStrategyConfig(VALID_RAW)
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    assert.strictEqual(r1.value.hash, r2.value.hash)
  })

  it("strategyConfigsEqual is reflexive", () => {
    const r = createStrategyConfig(VALID_RAW)
    assert.ok(r.ok)
    if (r.ok) assert.ok(strategyConfigsEqual(r.value.config, r.value.config))
  })

  it("strategyConfigsEqual is symmetric", () => {
    const r1 = createStrategyConfig(VALID_RAW)
    const r2 = createStrategyConfig(VALID_RAW)
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    if (r1.ok && r2.ok) {
      assert.strictEqual(strategyConfigsEqual(r1.value.config, r2.value.config), strategyConfigsEqual(r2.value.config, r1.value.config))
    }
  })

  it("all three presets have deterministic hashes", () => {
    const presets = [SHORT_HORIZON_PRESET, MEDIUM_HORIZON_PRESET, LONG_HORIZON_PRESET]
    // Each preset hash should be stable
    for (const preset of presets) {
      assert.match(preset.hash, /^[0-9a-f]{64}$/)
    }
    // Hashes should differ between presets
    assert.notStrictEqual(SHORT_HORIZON_PRESET.hash, MEDIUM_HORIZON_PRESET.hash)
    assert.notStrictEqual(MEDIUM_HORIZON_PRESET.hash, LONG_HORIZON_PRESET.hash)
  })

  it("rejects any config without required fields", () => {
    fc.assert(
      fc.property(fc.constantFrom(
        "benchmark",
        "routineFrequency",
        "universe",
        "eligibility",
        "factor",
        "construction",
        "regime",
        "rebalance",
        "execution",
        "risk",
        "tax",
        "automation",
      ), (missing) => {
        const raw = { ...VALID_RAW }
        delete (raw as Record<string, unknown>)[missing]
        const result = createStrategyConfig(raw)
        assert.ok(!result.ok, `Expected failure when ${missing} is missing`)
        return true
      }),
      { numRuns: 100 }
    )
  })
})
