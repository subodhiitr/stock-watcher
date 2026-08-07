import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createDataProvenance, PRODUCTION_QUALITY_SOURCES, isProductionQualitySource } from "../../../server/portfolio/domain/market-data/data-provenance.ts"
import { createMarketDataRecord } from "../../../server/portfolio/domain/market-data/market-data-record.ts"
import { createDataVersionSnapshot } from "../../../server/portfolio/domain/market-data/data-version-snapshot.ts"
import type { DataVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

function makeRecordInput(overrides: Record<string, unknown> = {}) {
  return {
    recordId: "rec-001",
    instrumentId: "INS-001",
    dataType: "EOD_PRICE",
    effectiveDate: "2024-01-15",
    fetchedAt: "2024-01-16T08:00:00Z",
    marketTimestamp: "2024-01-15T15:30:00Z",
    source: "LICENSED_EOD",
    version: "1.0",
    validationStatus: "VALID",
    staleAfterInstant: "2024-01-17T00:00:00Z",
    payload: { close: 1500.25 },
    ...overrides,
  }
}

describe("createDataProvenance", () => {
  it("creates valid provenance from known provider", () => {
    const result = createDataProvenance({
      source: "LICENSED_EOD",
      fetchedAt: "2024-01-16T08:00:00Z",
      marketTimestamp: "2024-01-15T15:30:00Z",
      effectiveDate: "2024-01-15",
      version: "1.0",
      validationStatus: "VALID",
    })
    assert.ok(result.ok, "Expected success")
    assert.strictEqual(result.value.source, "LICENSED_EOD")
    assert.ok(Object.isFrozen(result.value))
  })

  it("rejects unknown provider", () => {
    const result = createDataProvenance({ source: "UNKNOWN_PROVIDER", fetchedAt: "2024-01-16T08:00:00Z", marketTimestamp: "2024-01-15T15:30:00Z", effectiveDate: "2024-01-15", version: "1.0", validationStatus: "VALID" })
    assert.ok(!result.ok)
  })

  it("rejects missing source", () => {
    const result = createDataProvenance({ fetchedAt: "2024-01-16T08:00:00Z", marketTimestamp: "2024-01-15T15:30:00Z", effectiveDate: "2024-01-15", version: "1.0", validationStatus: "VALID" })
    assert.ok(!result.ok)
  })
})

describe("isProductionQualitySource", () => {
  it("LICENSED_EOD is production quality", () => { assert.ok(isProductionQualitySource("LICENSED_EOD")) })
  it("BROKER_API is production quality", () => { assert.ok(isProductionQualitySource("BROKER_API")) })
  it("EXCHANGE_FILING is production quality", () => { assert.ok(isProductionQualitySource("EXCHANGE_FILING")) })
  it("NSE_OFFICIAL is NOT production quality (MD-012)", () => { assert.ok(!isProductionQualitySource("NSE_OFFICIAL")) })
  it("YAHOO_RESEARCH is NOT production quality (MD-012)", () => { assert.ok(!isProductionQualitySource("YAHOO_RESEARCH")) })
  it("PRODUCTION_QUALITY_SOURCES contains exactly 3 providers", () => { assert.strictEqual(PRODUCTION_QUALITY_SOURCES.length, 3) })
})

describe("createMarketDataRecord", () => {
  it("creates a valid record with production quality source", () => {
    const result = createMarketDataRecord(makeRecordInput())
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.dataType, "EOD_PRICE")
    assert.strictEqual(result.value.isProductionQuality, true)
    assert.ok(Object.isFrozen(result.value))
  })

  it("sets isProductionQuality = false for NSE_OFFICIAL (MD-012)", () => {
    const result = createMarketDataRecord(makeRecordInput({ source: "NSE_OFFICIAL" }))
    assert.ok(result.ok)
    assert.strictEqual(result.value.isProductionQuality, false)
  })

  it("sets isProductionQuality = false for YAHOO_RESEARCH (MD-012)", () => {
    const result = createMarketDataRecord(makeRecordInput({ source: "YAHOO_RESEARCH" }))
    assert.ok(result.ok)
    assert.strictEqual(result.value.isProductionQuality, false)
  })

  it("rejects null input", () => {
    const result = createMarketDataRecord(null)
    assert.ok(!result.ok)
  })

  it("rejects missing dataType", () => {
    const result = createMarketDataRecord({ ...makeRecordInput(), dataType: "INVALID_TYPE" })
    assert.ok(!result.ok)
  })

  it("rejects missing recordId", () => {
    const result = createMarketDataRecord({ ...makeRecordInput(), recordId: "" })
    assert.ok(!result.ok)
  })

  it("rejects null payload", () => {
    const result = createMarketDataRecord({ ...makeRecordInput(), payload: null })
    assert.ok(!result.ok)
  })

  it("defaults validationStatus to VALID when omitted", () => {
    const input = makeRecordInput()
    const raw = { ...input } as Record<string, unknown>
    delete raw["validationStatus"]
    const result = createMarketDataRecord(raw)
    assert.ok(result.ok)
    assert.strictEqual(result.value.validationStatus, "VALID")
  })
})

describe("createDataVersionSnapshot", () => {
  it("creates a valid snapshot with all required types present (MD-015)", () => {
    const rec1Result = createMarketDataRecord(makeRecordInput({ dataType: "EOD_PRICE" }))
    const rec2Result = createMarketDataRecord(makeRecordInput({ recordId: "rec-002", dataType: "FUNDAMENTALS" }))
    assert.ok(rec1Result.ok)
    assert.ok(rec2Result.ok)
    const result = createDataVersionSnapshot({
      dataVersionId: "dv-001" as DataVersionId,
      asOf: "2024-01-15",
      createdAt: "2024-01-16T08:00:00Z",
      records: [rec1Result.value, rec2Result.value],
      requiredTypes: ["EOD_PRICE", "FUNDAMENTALS"],
    })
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.recordCount, 2)
    assert.ok(Object.isFrozen(result.value))
  })

  it("isProductionQuality true when all sources are production quality", () => {
    const rec = createMarketDataRecord(makeRecordInput({ source: "LICENSED_EOD" }))
    assert.ok(rec.ok)
    const snap = createDataVersionSnapshot({
      dataVersionId: "dv-002" as DataVersionId,
      asOf: "2024-01-15",
      createdAt: "2024-01-16T08:00:00Z",
      records: [rec.value],
      requiredTypes: ["EOD_PRICE"],
    })
    assert.ok(snap.ok)
    assert.strictEqual(snap.value.isProductionQuality, true)
  })

  it("isProductionQuality false when any source is research-only", () => {
    const rec = createMarketDataRecord(makeRecordInput({ source: "YAHOO_RESEARCH" }))
    assert.ok(rec.ok)
    const snap = createDataVersionSnapshot({
      dataVersionId: "dv-003" as DataVersionId,
      asOf: "2024-01-15",
      createdAt: "2024-01-16T08:00:00Z",
      records: [rec.value],
      requiredTypes: ["EOD_PRICE"],
    })
    assert.ok(snap.ok)
    assert.strictEqual(snap.value.isProductionQuality, false)
  })
})
