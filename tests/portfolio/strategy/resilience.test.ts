import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { CircuitBreakerRegistry } from "../../../server/portfolio/infrastructure/resilience/circuit-breaker-registry.ts"
import { ProviderResilienceWrapper } from "../../../server/portfolio/infrastructure/resilience/provider-resilience-wrapper.ts"
import { CredentialRedactor } from "../../../server/portfolio/infrastructure/resilience/credential-redactor.ts"
import { ResearchModeGate } from "../../../server/portfolio/infrastructure/resilience/research-mode-gate.ts"
import { createMarketDataRecord } from "../../../server/portfolio/domain/market-data/market-data-record.ts"
import { createDataVersionSnapshot } from "../../../server/portfolio/domain/market-data/data-version-snapshot.ts"
import type { DataVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

describe("CircuitBreakerRegistry", () => {
  it("starts CLOSED (PR-007)", () => {
    const registry = new CircuitBreakerRegistry()
    assert.strictEqual(registry.getStatus("provider-a"), "CLOSED")
  })

  it("opens after reaching failure threshold (PR-007)", () => {
    const registry = new CircuitBreakerRegistry(3, 60_000)
    registry.recordFailure("provider-a")
    registry.recordFailure("provider-a")
    assert.strictEqual(registry.getStatus("provider-a"), "CLOSED")
    registry.recordFailure("provider-a")
    assert.strictEqual(registry.getStatus("provider-a"), "OPEN")
  })

  it("recordSuccess resets to CLOSED", () => {
    const registry = new CircuitBreakerRegistry(3, 60_000)
    registry.recordFailure("provider-b")
    registry.recordFailure("provider-b")
    registry.recordFailure("provider-b")
    assert.strictEqual(registry.getStatus("provider-b"), "OPEN")
    registry.recordSuccess("provider-b")
    assert.strictEqual(registry.getStatus("provider-b"), "CLOSED")
  })

  it("allProviderHealth returns known providers", () => {
    const registry = new CircuitBreakerRegistry()
    registry.getStatus("provider-x")
    registry.getStatus("provider-y")
    const health = registry.allProviderHealth()
    assert.ok(health.length >= 2)
    assert.ok(health.every(h => typeof h.providerIdentity === "string"))
  })
})

describe("ProviderResilienceWrapper", () => {
  it("calls underlying function and returns success (PR-001)", async () => {
    const registry = new CircuitBreakerRegistry()
    const redactor = new CredentialRedactor()
    const wrapper = new ProviderResilienceWrapper(registry, redactor, { deadlineMs: 5000, maxRetries: 0 })
    const result = await wrapper.call("provider-test", async () => "data-value")
    assert.ok(result.ok)
    assert.strictEqual(result.value, "data-value")
  })

  it("returns failure when circuit is OPEN (PR-007)", async () => {
    const registry = new CircuitBreakerRegistry(1, 60_000)
    registry.recordFailure("provider-open")
    assert.strictEqual(registry.getStatus("provider-open"), "OPEN")
    const redactor = new CredentialRedactor()
    const wrapper = new ProviderResilienceWrapper(registry, redactor, { deadlineMs: 5000, maxRetries: 0 })
    const result = await wrapper.call("provider-open", async () => "data")
    assert.ok(!result.ok)
  })

  it("aborts on deadline exceeded (PR-003)", async () => {
    const registry = new CircuitBreakerRegistry()
    const redactor = new CredentialRedactor()
    const wrapper = new ProviderResilienceWrapper(registry, redactor, { deadlineMs: 50, maxRetries: 0 })
    const result = await wrapper.call("provider-slow", async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(() => resolve(), 500)
        signal.addEventListener("abort", () => { clearTimeout(id); reject(new Error("Aborted")) })
      })
      return "value"
    })
    assert.ok(!result.ok)
  })
})

describe("CredentialRedactor", () => {
  it("redacts credential fields from error context (SEC-001)", () => {
    const redactor = new CredentialRedactor()
    const context = {
      apiKey: "very-secret-key",
      endpoint: "https://api.provider.com",
      token: "bearer-token-xyz",
      data: "safe-data",
    }
    const redacted = redactor.redactProviderContext(context)
    assert.notStrictEqual(redacted["apiKey"], "very-secret-key")
    assert.notStrictEqual(redacted["token"], "bearer-token-xyz")
    assert.strictEqual(redacted["data"], "safe-data")
  })
})

describe("ResearchModeGate", () => {
  it("allows production data snapshot (RM-010)", async () => {
    const rec = createMarketDataRecord({
      recordId: "rec-001", instrumentId: "INS-001", dataType: "EOD_PRICE",
      effectiveDate: "2024-01-15", fetchedAt: "2024-01-16T08:00:00Z",
      marketTimestamp: "2024-01-15T15:30:00Z", source: "LICENSED_EOD",
      version: "1.0", validationStatus: "VALID",
      staleAfterInstant: "2099-12-31T00:00:00Z",
      payload: { close: 1500 },
    })
    assert.ok(rec.ok)
    const snap = createDataVersionSnapshot({
      dataVersionId: "dv-001" as DataVersionId,
      asOf: "2024-01-15",
      createdAt: "2024-01-16T08:00:00Z",
      records: [rec.value],
      requiredTypes: ["EOD_PRICE"],
    })
    assert.ok(snap.ok)
    const gate = new ResearchModeGate()
    const check = gate.checkProductionAllowed(snap.value, "2024-01-16T08:00:00Z")
    assert.ok(check.ok)
  })

  it("rejects research-only snapshot for production evaluation (RM-009)", async () => {
    const rec = createMarketDataRecord({
      recordId: "rec-002", instrumentId: "INS-001", dataType: "EOD_PRICE",
      effectiveDate: "2024-01-15", fetchedAt: "2024-01-16T08:00:00Z",
      marketTimestamp: "2024-01-15T15:30:00Z", source: "YAHOO_RESEARCH",
      version: "1.0", validationStatus: "VALID",
      staleAfterInstant: "2099-12-31T00:00:00Z",
      payload: { close: 1500 },
    })
    assert.ok(rec.ok)
    const snap = createDataVersionSnapshot({
      dataVersionId: "dv-002" as DataVersionId,
      asOf: "2024-01-15",
      createdAt: "2024-01-16T08:00:00Z",
      records: [rec.value],
      requiredTypes: ["EOD_PRICE"],
    })
    assert.ok(snap.ok)
    const gate = new ResearchModeGate()
    const check = gate.checkProductionAllowed(snap.value, "2024-01-16T08:00:00Z")
    assert.ok(!check.ok)
  })
})
