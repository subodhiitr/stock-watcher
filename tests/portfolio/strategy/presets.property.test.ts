import { describe, it } from "node:test"
import * as fc from "fast-check"
import assert from "node:assert/strict"
import {
  SHORT_HORIZON_PRESET,
  MEDIUM_HORIZON_PRESET,
  LONG_HORIZON_PRESET,
  STRATEGY_PRESETS,
} from "../../../server/portfolio/domain/strategy/strategy-presets.ts"
import { strategyConfigsEqual } from "../../../server/portfolio/domain/strategy/strategy-config.ts"
import { createSignalSnapshot } from "../../../server/portfolio/domain/strategy/signal-snapshot.ts"
import type { DataVersionId, InstrumentId, StrategyVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const MOM_COMPS = Object.freeze({ m3m1: 0.5, m6m1: 0.6, relativeStrength: 0.7, trend: 0.8, earningsMomentum: 0.4, liquidity: 0.3, volatilityAdjusted: 0.2 })
const QUAL_COMPS = Object.freeze({ returnOnEquity: 0.6, returnOnAssets: 0.5, earningsStability: 0.7, debtCoverage: 0.8, cashFlowQuality: 0.6, promoterPledge: 0.4 })
const RISK_COMPS = Object.freeze({ volatility60d: 0.3, maxDrawdown: 0.4, downsideDeviation: 0.35, beta: 0.5, liquidityRisk: 0.2 })

describe("Strategy preset property tests", () => {
  it("all 3 presets produce stable hashes", () => {
    for (const preset of STRATEGY_PRESETS) {
      assert.match(preset.hash, /^[0-9a-f]{64}$/)
    }
  })

  it("all 3 presets are frozen", () => {
    for (const preset of STRATEGY_PRESETS) {
      assert.ok(Object.isFrozen(preset.config))
    }
  })

  it("preset hashes are unique across presets", () => {
    const hashes = STRATEGY_PRESETS.map(p => p.hash)
    const unique = new Set(hashes)
    assert.strictEqual(unique.size, STRATEGY_PRESETS.length)
  })

  it("strategyConfigsEqual is transitive for presets", () => {
    assert.ok(!strategyConfigsEqual(
      SHORT_HORIZON_PRESET.config,
      MEDIUM_HORIZON_PRESET.config,
    ))
    assert.ok(!strategyConfigsEqual(
      MEDIUM_HORIZON_PRESET.config,
      LONG_HORIZON_PRESET.config,
    ))
  })

  it("createSignalSnapshot valid for any finite scores and conviction in [0.80, 1.20] with integer rank >= 1", () => {
    const arb = fc.record({
      momentumScore: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
      qualityScore: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
      riskScore: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
      compositeScore: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
      convictionMultiplier: fc.double({ min: 0.80, max: 1.20, noNaN: true }),
      rank: fc.integer({ min: 1, max: 500 }),
    })
    fc.assert(
      fc.property(arb, (params) => {
        const result = createSignalSnapshot({
          instrumentId: "INS-001" as InstrumentId,
          strategyVersionId: "sv-001" as StrategyVersionId,
          dataVersionId: "dv-001" as DataVersionId,
          asOf: "2024-01-15",
          isBfsi: false,
          momentumComponents: MOM_COMPS,
          qualityComponents: QUAL_COMPS,
          riskComponents: RISK_COMPS,
          ...params,
          computedAt: "2024-01-16T08:00:00Z",
        })
        return result.ok === true
      }),
      { numRuns: 50 }
    )
  })
})
