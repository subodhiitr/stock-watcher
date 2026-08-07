/**
 * U03 state/model test: verifies key behavioral properties of domain value objects.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createStrategyConfig, strategyConfigsEqual } from "../../../server/portfolio/domain/strategy/strategy-config.ts"
import { createRegimeState } from "../../../server/portfolio/domain/strategy/regime-state.ts"
import { createCorporateAction, applyCorporateActionTransition } from "../../../server/portfolio/domain/strategy/corporate-action.ts"
import { parseCorporateActionId } from "../../../server/portfolio/domain/shared/identifiers.ts"
import type { DataVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const NOW = "2024-01-01T10:00:00Z"
const DV_ID = "DV-MODEL-001" as DataVersionId

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

describe("U03 Model Tests", () => {
  describe("StrategyConfig immutability model", () => {
    it("strategyConfigsEqual is reflexive (SR-014)", () => {
      const r = createStrategyConfig(VALID_RAW)
      assert.ok(r.ok)
      if (r.ok) assert.ok(strategyConfigsEqual(r.value.config, r.value.config))
    })

    it("strategyConfigsEqual is symmetric (SR-014)", () => {
      const r1 = createStrategyConfig(VALID_RAW)
      const r2 = createStrategyConfig(VALID_RAW)
      assert.ok(r1.ok)
      assert.ok(r2.ok)
      if (r1.ok && r2.ok) {
        assert.strictEqual(strategyConfigsEqual(r1.value.config, r2.value.config), strategyConfigsEqual(r2.value.config, r1.value.config))
      }
    })

    it("same inputs always produce same configHash (SR-014)", () => {
      const r1 = createStrategyConfig(VALID_RAW)
      const r2 = createStrategyConfig(VALID_RAW)
      assert.ok(r1.ok)
      assert.ok(r2.ok)
      if (r1.ok && r2.ok) {
        assert.strictEqual(r1.value.hash, r2.value.hash)
      }
    })

    it("different inputs produce different configHash (SR-014)", () => {
      const r1 = createStrategyConfig(VALID_RAW)
      const altered = { ...VALID_RAW, benchmark: "NIFTY500TR" }
      const r2 = createStrategyConfig(altered)
      assert.ok(r1.ok)
      assert.ok(r2.ok)
      if (r1.ok && r2.ok) {
        assert.notStrictEqual(r1.value.hash, r2.value.hash)
      }
    })
  })

  describe("RegimeState fail-closed model", () => {
    it("any null indicator → CRISIS (RM-008)", () => {
      const nullIndicators = {
        nifty50AboveDMA200: null as boolean | null,
        nifty500AboveDMA200: null as boolean | null,
        breadthAbove200DMA_pct: null as number | null,
        breadthAbove100DMA_pct: null as number | null,
        benchmarkVolatility20D: null as number | null,
        marketDrawdownFrom52W: null as number | null,
        creditStressProxy: null as number | null,
      }
      const result = createRegimeState({
        indicators: nullIndicators,
        dataVersionId: DV_ID,
        asOf: "2024-01-01",
        evaluatedAt: NOW,
        crisisDrawdownPct: 15.0,
        highVolatilityThreshold: 25.0,
      })
      assert.ok(result.ok)
      if (result.ok) assert.strictEqual(result.value.category, "CRISIS")
    })

    it("CRISIS exposure is exactly [0, 0] (RM-005)", () => {
      const result = createRegimeState({
        indicators: {
          nifty50AboveDMA200: false, nifty500AboveDMA200: false,
          breadthAbove200DMA_pct: 10, breadthAbove100DMA_pct: 15,
          benchmarkVolatility20D: 40, marketDrawdownFrom52W: 0.20,
          creditStressProxy: 2.0,
        },
        dataVersionId: DV_ID,
        asOf: "2024-01-01",
        evaluatedAt: NOW,
        crisisDrawdownPct: 15.0,
        highVolatilityThreshold: 25.0,
      })
      assert.ok(result.ok)
      if (result.ok) {
        assert.strictEqual(result.value.equityExposureMinPct, 0)
        assert.strictEqual(result.value.equityExposureMaxPct, 0)
      }
    })
  })

  describe("CorporateAction state machine model", () => {
    it("PENDING → PROCESSED terminal (CA-003)", () => {
      const id = parseCorporateActionId("CA-MODEL-001")
      assert.ok(id.ok)
      if (!id.ok) return

      const ca = createCorporateAction({
        actionId: id.value,
        instrumentId: "INS-001" as unknown as import("../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId,
        actionType: "CASH_DIVIDEND",
        effectiveDate: "2024-01-05",
        announcedAt: NOW,
        source: "EXCHANGE_FILING",
        createdAt: NOW,
      })
      assert.ok(ca.ok)
      if (!ca.ok) return

      const processed = applyCorporateActionTransition(ca.value, "PROCESSED", NOW, {
        priceAdjustmentFactor: 1.0,
        quantityAdjustmentFactor: 1.0,
        taxLotLineagePreserved: true,
        economicValueConserved: true,
      })
      assert.ok(processed.ok)
      if (processed.ok) {
        // Second transition from PROCESSED should fail (terminal)
        const second = applyCorporateActionTransition(processed.value, "PROCESSED", NOW)
        assert.ok(!second.ok)
      }
    })

    it("BLOCKED → REQUIRES_MANUAL_REVIEW is valid", () => {
      const id = parseCorporateActionId("CA-MODEL-002")
      assert.ok(id.ok)
      if (!id.ok) return

      const ca = createCorporateAction({
        actionId: id.value,
        instrumentId: "INS-001" as unknown as import("../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId,
        actionType: "MERGER",
        effectiveDate: "2024-02-01",
        announcedAt: NOW,
        source: "EXCHANGE_FILING",
        createdAt: NOW,
      })
      assert.ok(ca.ok)
      if (!ca.ok) return

      const blocked = applyCorporateActionTransition(ca.value, "BLOCKED", NOW)
      assert.ok(blocked.ok)
      if (blocked.ok) {
        const review = applyCorporateActionTransition(blocked.value, "REQUIRES_MANUAL_REVIEW", NOW)
        assert.ok(review.ok)
      }
    })
  })
})
