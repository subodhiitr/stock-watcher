import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createAiAdvisoryRequest,
  createAiAdvisoryResult,
} from "../../../server/portfolio/domain/strategy/ai-advisory.ts"
import { AI_PERMITTED_OPERATIONS } from "../../../server/portfolio/domain/strategy/constants.ts"
import type { EventId } from "../../../server/portfolio/domain/shared/identifiers.ts"
import type { Instant } from "../../../server/portfolio/domain/shared/time.ts"

const REQ_ID = "req-001" as EventId
const PRODUCED_AT = "2024-01-16T08:00:00Z" as Instant

describe("createAiAdvisoryRequest", () => {
  it("creates a valid request for SUMMARIZE operation (AI-001)", () => {
    const result = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "SUMMARIZE",
      inputContent: { structuredData: { factorScores: { momentum: 0.65 } } },
      correlationId: "corr-001",
    })
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.operation, "SUMMARIZE")
    assert.ok(Object.isFrozen(result.value))
  })

  it("rejects unlisted operations (AI-001)", () => {
    const result = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "EXECUTE_TRADE",
      inputContent: { structuredData: {} },
      correlationId: "corr-001",
    })
    assert.ok(!result.ok)
  })

  it("accepts all 6 permitted operations", () => {
    for (const op of AI_PERMITTED_OPERATIONS) {
      const result = createAiAdvisoryRequest({
        requestId: REQ_ID,
        operation: op,
        inputContent: { structuredData: { data: "test" } },
        correlationId: "corr-001",
      })
      assert.ok(result.ok, `Expected success for operation ${op}`)
    }
  })

  it("rejects input containing prohibited fields - portfolio (AI-007)", () => {
    const result = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "SUMMARIZE",
      inputContent: { structuredData: { portfolio: { positions: [] } } },
      correlationId: "corr-001",
    })
    assert.ok(!result.ok)
  })

  it("rejects input containing prohibited fields - credentials (AI-007)", () => {
    const result = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "SUMMARIZE",
      inputContent: { structuredData: { credentials: { apiKey: "secret" } } },
      correlationId: "corr-001",
    })
    assert.ok(!result.ok)
  })
})

describe("createAiAdvisoryResult", () => {
  it("creates result with advisoryText (not outputText) (AI-002)", () => {
    const reqResult = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "SUMMARIZE",
      inputContent: { structuredData: { data: "factors" } },
      correlationId: "corr-001",
    })
    assert.ok(reqResult.ok)
    const result = createAiAdvisoryResult(reqResult.value, "Analysis complete.", PRODUCED_AT)
    assert.ok(result.ok)
    assert.strictEqual(typeof result.value.advisoryText, "string")
    assert.strictEqual(result.value.advisoryText, "Analysis complete.")
    // Structural false constraints (AI-002, AI-003)
    assert.strictEqual(result.value.canInfluenceState, false)
    assert.strictEqual(result.value.canDetermineOrderQuantity, false)
    assert.strictEqual(result.value.canAlterParameters, false)
  })

  it("result includes deterministic requestHash (AI-006)", () => {
    const reqResult = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "CLASSIFY",
      inputContent: { structuredData: { data: "sectors" } },
      correlationId: "corr-001",
    })
    assert.ok(reqResult.ok)
    const r1 = createAiAdvisoryResult(reqResult.value, "Classification text.", PRODUCED_AT)
    const r2 = createAiAdvisoryResult(reqResult.value, "Different text.", PRODUCED_AT)
    assert.ok(r1.ok)
    assert.ok(r2.ok)
    assert.strictEqual(r1.value.requestHash, r2.value.requestHash, "requestHash must be deterministic for same request")
    assert.match(r1.value.requestHash, /^[0-9a-f]{64}$/)
  })

  it("result is frozen (AI-001)", () => {
    const reqResult = createAiAdvisoryRequest({
      requestId: REQ_ID,
      operation: "EXPLAIN",
      inputContent: { structuredData: { rule: "SR-001" } },
      correlationId: "corr-001",
    })
    assert.ok(reqResult.ok)
    const result = createAiAdvisoryResult(reqResult.value, "Explanation here.", PRODUCED_AT)
    assert.ok(result.ok)
    assert.ok(Object.isFrozen(result.value))
  })
})
