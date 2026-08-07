import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createEligibilityResult,
  createRiskFlag,
  type EligibilityRuleResult,
} from "../../../server/portfolio/domain/strategy/eligibility-result.ts"
import type { DataVersionId, InstrumentId, StrategyVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const INS_ID = "INS-001" as InstrumentId
const SV_ID = "sv-001" as StrategyVersionId
const DV_ID = "dv-001" as DataVersionId
const AS_OF = "2024-01-15"
const EVAL_AT = "2024-01-16T08:00:00Z"

function rulePass(ruleId: EligibilityRuleResult["ruleId"]): EligibilityRuleResult {
  return Object.freeze({ ruleId, passed: true, reasonCode: "OK" })
}

function ruleFail(ruleId: EligibilityRuleResult["ruleId"], reasonCode: string): EligibilityRuleResult {
  return Object.freeze({ ruleId, passed: false, reasonCode })
}

const ALL_PASS: EligibilityRuleResult[] = [
  rulePass("LISTING_HISTORY"),
  rulePass("PRICE_AVAILABILITY"),
  rulePass("MIN_PRICE"),
  rulePass("TRADED_VALUE"),
  rulePass("CORPORATE_ACTION_STATUS"),
  rulePass("TRADING_STATUS"),
  rulePass("SURVEILLANCE_STATUS"),
  rulePass("PRICE_ADJUSTMENT_VALIDITY"),
  rulePass("FUNDAMENTAL_FRESHNESS"),
  rulePass("BROKER_MAPPING"),
  rulePass("DATA_ANOMALY"),
  rulePass("FUNDAMENTAL_HEALTH"),
]

describe("createEligibilityResult", () => {
  it("status is ELIGIBLE when all rules pass (EL-001)", () => {
    const result = createEligibilityResult({
      instrumentId: INS_ID,
      strategyVersionId: SV_ID,
      dataVersionId: DV_ID,
      asOf: AS_OF,
      ruleResults: ALL_PASS,
      isBfsi: false,
      evaluatedAt: EVAL_AT,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "ELIGIBLE")
    assert.ok(Object.isFrozen(result.value))
  })

  it("status is INELIGIBLE when SURVEILLANCE_STATUS fails with HARD_RISK_FLAG (EL-002)", () => {
    const results = [
      ...ALL_PASS.filter(r => r.ruleId !== "SURVEILLANCE_STATUS"),
      ruleFail("SURVEILLANCE_STATUS", "HARD_RISK_FLAG"),
    ]
    const result = createEligibilityResult({
      instrumentId: INS_ID, strategyVersionId: SV_ID, dataVersionId: DV_ID,
      asOf: AS_OF, ruleResults: results, isBfsi: false, evaluatedAt: EVAL_AT,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "INELIGIBLE")
    assert.ok(result.value.hardRiskFlag)
  })

  it("status is HOLD_ELIGIBLE when failures all have HOLD_ELIGIBLE reason", () => {
    const results = [
      ...ALL_PASS.filter(r => r.ruleId !== "TRADED_VALUE"),
      ruleFail("TRADED_VALUE", "HOLD_ELIGIBLE"),
    ]
    const result = createEligibilityResult({
      instrumentId: INS_ID, strategyVersionId: SV_ID, dataVersionId: DV_ID,
      asOf: AS_OF, ruleResults: results, isBfsi: false, evaluatedAt: EVAL_AT,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "HOLD_ELIGIBLE")
  })

  it("status is FORCED_REVIEW when failures all have FORCED_REVIEW reason", () => {
    const results = [
      ...ALL_PASS.filter(r => r.ruleId !== "FUNDAMENTAL_FRESHNESS"),
      ruleFail("FUNDAMENTAL_FRESHNESS", "FORCED_REVIEW"),
    ]
    const result = createEligibilityResult({
      instrumentId: INS_ID, strategyVersionId: SV_ID, dataVersionId: DV_ID,
      asOf: AS_OF, ruleResults: results, isBfsi: false, evaluatedAt: EVAL_AT,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "FORCED_REVIEW")
  })

  it("fundamentalHealthExclude is set when FUNDAMENTAL_HEALTH fails with exclusion code", () => {
    const results = [
      ...ALL_PASS.filter(r => r.ruleId !== "FUNDAMENTAL_HEALTH"),
      ruleFail("FUNDAMENTAL_HEALTH", "FUNDAMENTAL_HEALTH_EXCLUDE"),
    ]
    const result = createEligibilityResult({
      instrumentId: INS_ID, strategyVersionId: SV_ID, dataVersionId: DV_ID,
      asOf: AS_OF, ruleResults: results, isBfsi: false, evaluatedAt: EVAL_AT,
    })
    assert.ok(result.ok)
    assert.ok(result.value.fundamentalHealthExclude)
  })
})

describe("createRiskFlag", () => {
  it("creates HARD_RISK_FLAG from production source", () => {
    const result = createRiskFlag("HARD_RISK_FLAG", "LICENSED_EOD", "GSM category 4")
    assert.ok(result.ok)
    assert.strictEqual(result.value.flagType, "HARD_RISK_FLAG")
    assert.strictEqual(result.value.source, "LICENSED_EOD")
  })

  it("rejects YAHOO_RESEARCH source (EL-012)", () => {
    const result = createRiskFlag("HARD_RISK_FLAG", "YAHOO_RESEARCH", "reason")
    assert.ok(!result.ok)
  })

  it("rejects NSE_OFFICIAL source (EL-012)", () => {
    const result = createRiskFlag("HARD_RISK_FLAG", "NSE_OFFICIAL", "reason")
    assert.ok(!result.ok)
  })

  it("rejects empty reason", () => {
    const result = createRiskFlag("HARD_RISK_FLAG", "LICENSED_EOD", "")
    assert.ok(!result.ok)
  })
})
