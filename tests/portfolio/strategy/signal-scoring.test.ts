import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createSignalSnapshot } from "../../../server/portfolio/domain/strategy/signal-snapshot.ts"
import type { DataVersionId, InstrumentId, StrategyVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const INS_ID = "INS-001" as InstrumentId
const SV_ID = "sv-001" as StrategyVersionId
const DV_ID = "dv-001" as DataVersionId
const AS_OF = "2024-01-15"

const MOM_COMPS = Object.freeze({ m3m1: 0.5, m6m1: 0.6, relativeStrength: 0.7, trend: 0.8, earningsMomentum: 0.4, liquidity: 0.3, volatilityAdjusted: 0.2 })
const QUAL_COMPS = Object.freeze({ returnOnEquity: 0.6, returnOnAssets: 0.5, earningsStability: 0.7, debtCoverage: 0.8, cashFlowQuality: 0.6, promoterPledge: 0.4 })
const RISK_COMPS = Object.freeze({ volatility60d: 0.3, maxDrawdown: 0.4, downsideDeviation: 0.35, beta: 0.5, liquidityRisk: 0.2 })

function makeSnapshotParams(overrides: Record<string, unknown> = {}) {
  return {
    instrumentId: INS_ID,
    strategyVersionId: SV_ID,
    dataVersionId: DV_ID,
    asOf: AS_OF,
    isBfsi: false,
    momentumComponents: MOM_COMPS,
    qualityComponents: QUAL_COMPS,
    riskComponents: RISK_COMPS,
    momentumScore: 0.65,
    qualityScore: 0.60,
    riskScore: 0.55,
    compositeScore: 0.62,
    convictionMultiplier: 1.0,
    rank: 5,
    computedAt: "2024-01-16T08:00:00Z",
    ...overrides,
  }
}

describe("createSignalSnapshot", () => {
  it("creates a valid snapshot (SS-001)", () => {
    const result = createSignalSnapshot(makeSnapshotParams())
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.instrumentId, INS_ID)
    assert.strictEqual(result.value.rank, 5)
    assert.ok(Object.isFrozen(result.value))
  })

  it("convictionMultiplier must be in [0.80, 1.20] (SS-007)", () => {
    const tooLow = createSignalSnapshot(makeSnapshotParams({ convictionMultiplier: 0.5 }))
    assert.ok(!tooLow.ok, "Expected failure for convictionMultiplier below 0.80")
    const tooHigh = createSignalSnapshot(makeSnapshotParams({ convictionMultiplier: 1.5 }))
    assert.ok(!tooHigh.ok, "Expected failure for convictionMultiplier above 1.20")
    const boundary = createSignalSnapshot(makeSnapshotParams({ convictionMultiplier: 0.80 }))
    assert.ok(boundary.ok)
    const boundary2 = createSignalSnapshot(makeSnapshotParams({ convictionMultiplier: 1.20 }))
    assert.ok(boundary2.ok)
  })

  it("rank must be a positive integer (SS-006)", () => {
    const negRank = createSignalSnapshot(makeSnapshotParams({ rank: -1 }))
    assert.ok(!negRank.ok)
    const zeroRank = createSignalSnapshot(makeSnapshotParams({ rank: 0 }))
    assert.ok(!zeroRank.ok)
    const fracRank = createSignalSnapshot(makeSnapshotParams({ rank: 1.5 }))
    assert.ok(!fracRank.ok)
  })

  it("rejects NaN in momentum components (SS-002)", () => {
    const result = createSignalSnapshot(makeSnapshotParams({
      momentumComponents: { ...MOM_COMPS, m3m1: NaN },
    }))
    assert.ok(!result.ok)
  })

  it("rejects Infinity in quality components", () => {
    const result = createSignalSnapshot(makeSnapshotParams({
      qualityComponents: { ...QUAL_COMPS, returnOnEquity: Infinity },
    }))
    assert.ok(!result.ok)
  })

  it("degradedAdvisoryContext defaults to false (AI-001)", () => {
    const result = createSignalSnapshot(makeSnapshotParams())
    assert.ok(result.ok)
    assert.strictEqual(result.value.degradedAdvisoryContext, false)
  })

  it("accepts isBfsi=true with standard quality components", () => {
    const result = createSignalSnapshot(makeSnapshotParams({ isBfsi: true }))
    assert.ok(result.ok)
    assert.strictEqual(result.value.isBfsi, true)
  })

  it("riskFlags defaults to empty array", () => {
    const result = createSignalSnapshot(makeSnapshotParams())
    assert.ok(result.ok)
    assert.strictEqual(result.value.riskFlags.length, 0)
  })
})
