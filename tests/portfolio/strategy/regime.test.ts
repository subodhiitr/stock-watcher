import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createRegimeState,
  isFailClosedTowardsCrisis,
  type RegimeIndicators,
} from "../../../server/portfolio/domain/strategy/regime-state.ts"
import type { DataVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const DV_ID = "dv-001" as DataVersionId
const AS_OF = "2024-01-15"
const EVAL_AT = "2024-01-16T08:00:00Z"
const CRISIS_DD = 15.0
const HIGH_VOL = 25.0

const RISK_ON_IND: RegimeIndicators = Object.freeze({
  nifty50AboveDMA200: true, nifty500AboveDMA200: true,
  breadthAbove200DMA_pct: 60, breadthAbove100DMA_pct: 65,
  benchmarkVolatility20D: 15, marketDrawdownFrom52W: 0.03,
  creditStressProxy: 0.5,
})

const RISK_OFF_IND: RegimeIndicators = Object.freeze({
  nifty50AboveDMA200: false, nifty500AboveDMA200: false,
  breadthAbove200DMA_pct: 25, breadthAbove100DMA_pct: 30,
  benchmarkVolatility20D: 20, marketDrawdownFrom52W: 0.05,
  creditStressProxy: 0.8,
})

const CRISIS_IND: RegimeIndicators = Object.freeze({
  nifty50AboveDMA200: false, nifty500AboveDMA200: false,
  breadthAbove200DMA_pct: 10, breadthAbove100DMA_pct: 15,
  benchmarkVolatility20D: 40, marketDrawdownFrom52W: 0.20, // 20% > 15% threshold
  creditStressProxy: 2.0,
})

const NULL_IND: RegimeIndicators = Object.freeze({
  nifty50AboveDMA200: null, nifty500AboveDMA200: null,
  breadthAbove200DMA_pct: null, breadthAbove100DMA_pct: null,
  benchmarkVolatility20D: null, marketDrawdownFrom52W: null,
  creditStressProxy: null,
})

function makeParams(indicators: RegimeIndicators, overrides: Record<string, unknown> = {}) {
  return { indicators, dataVersionId: DV_ID, asOf: AS_OF, evaluatedAt: EVAL_AT, crisisDrawdownPct: CRISIS_DD, highVolatilityThreshold: HIGH_VOL, ...overrides }
}

describe("createRegimeState", () => {
  it("RISK_ON when all positive indicators (RM-002)", () => {
    const result = createRegimeState(makeParams(RISK_ON_IND))
    assert.ok(result.ok)
    assert.strictEqual(result.value.category, "RISK_ON")
    assert.strictEqual(result.value.equityExposureMinPct, 90)
    assert.strictEqual(result.value.equityExposureMaxPct, 100)
  })

  it("RISK_OFF when all negative indicators (RM-004)", () => {
    const result = createRegimeState(makeParams(RISK_OFF_IND))
    assert.ok(result.ok)
    assert.strictEqual(result.value.category, "RISK_OFF")
    assert.strictEqual(result.value.equityExposureMinPct, 30)
    assert.strictEqual(result.value.equityExposureMaxPct, 50)
  })

  it("CRISIS when drawdown exceeds threshold (RM-005)", () => {
    const result = createRegimeState(makeParams(CRISIS_IND))
    assert.ok(result.ok)
    assert.strictEqual(result.value.category, "CRISIS")
    assert.strictEqual(result.value.isCrisisImmediate, true)
    assert.strictEqual(result.value.equityExposureMinPct, 0)
    assert.strictEqual(result.value.equityExposureMaxPct, 0)
  })

  it("fail-closed to CRISIS when indicators are null (RM-008)", () => {
    const result = createRegimeState(makeParams(NULL_IND))
    assert.ok(result.ok)
    assert.strictEqual(result.value.category, "CRISIS")
    assert.ok(isFailClosedTowardsCrisis(result.value))
    assert.strictEqual(result.value.crisisReason, "REGIME_DATA_UNAVAILABLE")
  })

  it("CAUTION is the default fallback regime", () => {
    const cautionInd: RegimeIndicators = Object.freeze({
      nifty50AboveDMA200: true, nifty500AboveDMA200: false,
      breadthAbove200DMA_pct: 45, breadthAbove100DMA_pct: 50,
      benchmarkVolatility20D: 20, marketDrawdownFrom52W: 0.05,
      creditStressProxy: 0.7,
    })
    const result = createRegimeState(makeParams(cautionInd))
    assert.ok(result.ok)
    assert.strictEqual(result.value.category, "CAUTION")
    assert.strictEqual(result.value.equityExposureMinPct, 60)
    assert.strictEqual(result.value.equityExposureMaxPct, 80)
  })

  it("regime requires confirmation periods before transitioning (RM-006)", () => {
    // Previously RISK_ON, now weakening to CAUTION but needs 2 periods
    const partialResult = createRegimeState(makeParams({
      ...RISK_OFF_IND,
      nifty50AboveDMA200: true, nifty500AboveDMA200: false,
      breadthAbove200DMA_pct: 45,
    }, { previousRegime: "RISK_ON", previousConfirmationCount: 0 }))
    assert.ok(partialResult.ok)
    assert.strictEqual(partialResult.value.confirmationStatus, "CONFIRMING")
    assert.strictEqual(partialResult.value.category, "RISK_ON") // Still RISK_ON during confirming
  })

  it("result is frozen (RM-001)", () => {
    const result = createRegimeState(makeParams(RISK_ON_IND))
    assert.ok(result.ok)
    assert.ok(Object.isFrozen(result.value))
  })
})
