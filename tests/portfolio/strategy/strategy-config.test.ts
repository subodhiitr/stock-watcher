import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createStrategyConfig, strategyConfigsEqual } from "../../../server/portfolio/domain/strategy/strategy-config.ts"
import { SHORT_HORIZON_PRESET } from "../../../server/portfolio/domain/strategy/strategy-presets.ts"

function makeValidRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  }
}

describe("createStrategyConfig", () => {
  it("creates a valid config from well-formed raw input", () => {
    const result = createStrategyConfig(makeValidRaw())
    assert.ok(result.ok, `Expected success: ${!result.ok ? JSON.stringify(result.error) : ""}`)
    const { config, hash } = result.value
    assert.strictEqual(config.universe.indexUniverse, "NIFTY500")
    assert.strictEqual(typeof hash, "string")
    assert.match(hash, /^[0-9a-f]{64}$/, "hash should be 64-char hex SHA-256")
    assert.ok(Object.isFrozen(config), "config must be frozen")
  })

  it("rejects null input", () => {
    const result = createStrategyConfig(null)
    assert.ok(!result.ok)
  })

  it("factor weight sum must be ~1.0 (SR-002)", () => {
    const raw = makeValidRaw()
    ;(raw.factor as Record<string, unknown>).momentumWeight = 0.60
    ;(raw.factor as Record<string, unknown>).qualityWeight = 0.30
    ;(raw.factor as Record<string, unknown>).lowRiskWeight = 0.20 // sum = 1.10
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("sub-factor weights must sum to ~1.0", () => {
    const raw = makeValidRaw()
    ;(raw.factor as Record<string, unknown>).momentumWeights = { m3m1: 0.50, m6m1: 0.50, relativeStrength: 0.50, trend: 0.50, earningsMomentum: 0.50, liquidity: 0.50, volatilityAdjusted: 0.50 }
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("rejects invalid rebalance frequency", () => {
    const raw = makeValidRaw()
    ;(raw as Record<string, unknown>).routineFrequency = "WEEKLY"
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("rejects invalid product in execution policy", () => {
    const raw = makeValidRaw()
    ;(raw.execution as Record<string, unknown>).product = "MIS"
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("rejects execution with startTime >= endTime", () => {
    const raw = makeValidRaw()
    ;(raw.execution as Record<string, unknown>).startTime = "15:30"
    ;(raw.execution as Record<string, unknown>).endTime = "09:00"
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("rejects drawdown thresholds out of order", () => {
    const raw = makeValidRaw()
    ;(raw.risk as Record<string, unknown>).drawdownWarningPct = 20.0
    ;(raw.risk as Record<string, unknown>).drawdownRiskReductionPct = 10.0
    ;(raw.risk as Record<string, unknown>).drawdownKillSwitchPct = 5.0
    const result = createStrategyConfig(raw)
    assert.ok(!result.ok)
  })

  it("configHash is deterministic SHA-256 (SR-014)", () => {
    const raw = makeValidRaw()
    const r1 = createStrategyConfig(raw)
    const r2 = createStrategyConfig(raw)
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    assert.strictEqual(r1.value.hash, r2.value.hash)
    assert.match(r1.value.hash, /^[0-9a-f]{64}$/)
  })

  it("strategyConfigsEqual returns true for identical configs (SR-014)", () => {
    const r1 = createStrategyConfig(makeValidRaw())
    const r2 = createStrategyConfig(makeValidRaw())
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    assert.ok(strategyConfigsEqual(r1.value.config, r2.value.config))
  })

  it("strategyConfigsEqual returns false for different configs", () => {
    const r1 = createStrategyConfig(makeValidRaw())
    const r2 = createStrategyConfig(makeValidRaw({ benchmark: "NIFTY50ANOTHER" }))
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    assert.ok(!strategyConfigsEqual(r1.value.config, r2.value.config))
  })

  it("SHORT_HORIZON_PRESET is valid and frozen (SR-015)", () => {
    assert.ok(Object.isFrozen(SHORT_HORIZON_PRESET.config))
    assert.ok(Object.isFrozen(SHORT_HORIZON_PRESET))
    assert.match(SHORT_HORIZON_PRESET.hash, /^[0-9a-f]{64}$/)
  })
})
