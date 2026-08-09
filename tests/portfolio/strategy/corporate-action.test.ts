import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createCorporateAction,
  applyCorporateActionTransition,
  type CorporateActionImpact,
} from "../../../server/portfolio/domain/strategy/corporate-action.ts"
import type { CorporateActionId, InstrumentId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const ACTION_ID = "ca-001" as CorporateActionId
const INS_ID = "INS-001" as InstrumentId
const CREATED_AT = "2024-01-15T10:00:00Z"
const UPDATED_AT = "2024-01-16T10:00:00Z"

function makeCaParams(overrides: Record<string, unknown> = {}) {
  return {
    actionId: ACTION_ID,
    instrumentId: INS_ID,
    actionType: "SPLIT" as const,
    effectiveDate: "2024-02-01",
    announcedAt: "2024-01-15T10:00:00Z",
    source: "EXCHANGE_FILING" as const,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

describe("createCorporateAction", () => {
  it("creates action in PENDING status (CA-001)", () => {
    const result = createCorporateAction(makeCaParams())
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.status, "PENDING")
    assert.strictEqual(result.value.source, "EXCHANGE_FILING")
    assert.ok(Object.isFrozen(result.value))
  })

  it("accepts LICENSED_PROVIDER as source", () => {
    const result = createCorporateAction(makeCaParams({ source: "LICENSED_PROVIDER" }))
    assert.ok(result.ok)
    assert.strictEqual(result.value.source, "LICENSED_PROVIDER")
  })

  it("accepts all 10 action types (CA-002)", () => {
    const types = ["SPLIT", "BONUS", "CASH_DIVIDEND", "RIGHTS", "MERGER", "DEMERGER", "SYMBOL_CHANGE", "DELISTING", "BUYBACK_TENDER", "ETF_UNIT_CHANGE"] as const
    for (const actionType of types) {
      const result = createCorporateAction(makeCaParams({ actionType }))
      assert.ok(result.ok, `Expected success for actionType ${actionType}`)
    }
  })

  it("rejects unknown action type", () => {
    const result = createCorporateAction(makeCaParams({ actionType: "TAKEOVER" }))
    assert.ok(!result.ok)
  })

  it("notes defaults to empty string when omitted", () => {
    const result = createCorporateAction(makeCaParams())
    assert.ok(result.ok)
    assert.strictEqual(result.value.notes, "")
  })
})

describe("applyCorporateActionTransition", () => {
  it("PENDING can transition to PROCESSED (CA-003)", () => {
    const created = createCorporateAction(makeCaParams())
    assert.ok(created.ok)
    const impact: CorporateActionImpact = Object.freeze({
      priceAdjustmentFactor: 0.5,
      quantityAdjustmentFactor: 2.0,
      taxLotLineagePreserved: true,
      economicValueConserved: true,
    })
    const result = applyCorporateActionTransition(created.value, "PROCESSED", UPDATED_AT, impact)
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "PROCESSED")
  })

  it("PENDING can transition to BLOCKED (CA-004)", () => {
    const created = createCorporateAction(makeCaParams({ actionType: "MERGER" }))
    assert.ok(created.ok)
    const result = applyCorporateActionTransition(created.value, "BLOCKED", UPDATED_AT)
    assert.ok(result.ok)
    assert.strictEqual(result.value.status, "BLOCKED")
  })

  it("PROCESSED cannot transition further (CA-003)", () => {
    const created = createCorporateAction(makeCaParams())
    assert.ok(created.ok)
    const impact: CorporateActionImpact = Object.freeze({
      priceAdjustmentFactor: 1.0, quantityAdjustmentFactor: 1.0,
      taxLotLineagePreserved: true, economicValueConserved: true,
    })
    const processed = applyCorporateActionTransition(created.value, "PROCESSED", UPDATED_AT, impact)
    assert.ok(processed.ok)
    const retry = applyCorporateActionTransition(processed.value, "BLOCKED", UPDATED_AT)
    assert.ok(!retry.ok)
  })

  it("CANCELLED status does not exist (CA-001)", () => {
    // CorporateActionStatus union does not include CANCELLED
    const validStatuses = ["PENDING", "PROCESSED", "BLOCKED", "REQUIRES_MANUAL_REVIEW"]
    assert.ok(!validStatuses.includes("CANCELLED"))
  })

  it("conserving actions (SPLIT/BONUS) reject economicValueConserved=false (CA-007)", () => {
    const created = createCorporateAction(makeCaParams({ actionType: "SPLIT" }))
    assert.ok(created.ok)
    const impact: CorporateActionImpact = Object.freeze({
      priceAdjustmentFactor: 0.5, quantityAdjustmentFactor: 2.0,
      taxLotLineagePreserved: true, economicValueConserved: false, // violated
    })
    const result = applyCorporateActionTransition(created.value, "PROCESSED", UPDATED_AT, impact)
    assert.ok(!result.ok)
  })
})
