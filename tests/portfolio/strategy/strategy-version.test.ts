import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createVersion,
  submitForActivation,
  activate,
  withdrawVersion,
  type EvidenceReference,
} from "../../../server/portfolio/domain/strategy/strategy-version.ts"
import { createStrategyConfig } from "../../../server/portfolio/domain/strategy/strategy-config.ts"
import type { ActorId, CorrelationId, EvidenceId, StrategyVersionEventId, StrategyVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"
import type { Instant } from "../../../server/portfolio/domain/shared/time.ts"

const SV_ID = "sv-001" as StrategyVersionId
const ACTOR = "user-abc" as ActorId
const CORR = "corr-001" as CorrelationId
const EV_ID = "ev-001" as StrategyVersionEventId
const EV_ID2 = "ev-002" as StrategyVersionEventId
const EV_ID3 = "ev-003" as StrategyVersionEventId
const CREATED_AT = "2024-01-15T08:00:00Z" as Instant

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

function getConfig() {
  const result = createStrategyConfig(VALID_RAW)
  if (!result.ok) throw new Error("config creation failed")
  return result.value
}

const ALL_EVIDENCE: EvidenceReference[] = [
  { evidenceId: "ev-bt-001" as EvidenceId, evidenceType: "BACKTEST", passed: true },
  { evidenceId: "ev-wf-001" as EvidenceId, evidenceType: "WALK_FORWARD", passed: true },
  { evidenceId: "ev-os-001" as EvidenceId, evidenceType: "OUT_OF_SAMPLE", passed: true },
  { evidenceId: "ev-sh-001" as EvidenceId, evidenceType: "SHADOW_OPERATION", passed: true },
]

describe("createVersion", () => {
  it("creates version in DRAFT status (SV-001)", () => {
    const { config, hash } = getConfig()
    const result = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.version.status, "DRAFT")
    assert.strictEqual(result.value.event.type, "StrategyVersionCreated")
    assert.ok(Object.isFrozen(result.value.version))
  })

  it("rejects empty versionLabel (SV-001)", () => {
    const { config, hash } = getConfig()
    const result = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(!result.ok)
  })
})

describe("submitForActivation", () => {
  it("transitions DRAFT -> ACTIVATION_PENDING (SV-002)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const result = submitForActivation(created.value.version, {
      evidenceRefs: ALL_EVIDENCE,
      submittedBy: ACTOR,
      submittedAt: CREATED_AT,
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.version.status, "ACTIVATION_PENDING")
    assert.strictEqual(result.value.event.type, "StrategyVersionSubmittedForActivation")
  })

  it("rejects empty evidence refs (SV-006)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const result = submitForActivation(created.value.version, {
      evidenceRefs: [],
      submittedBy: ACTOR,
      submittedAt: CREATED_AT,
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(!result.ok)
  })
})

describe("activate", () => {
  it("transitions ACTIVATION_PENDING -> ACTIVE with all 4 evidence types (SV-003)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const pending = submitForActivation(created.value.version, {
      evidenceRefs: ALL_EVIDENCE,
      submittedBy: ACTOR,
      submittedAt: CREATED_AT,
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(pending.ok)
    const result = activate(pending.value.version, undefined, {
      approvedBy: ACTOR,
      approvedAt: CREATED_AT,
      effectiveFrom: CREATED_AT,
      eventId: EV_ID3,
      supersededEventId: "ev-004" as StrategyVersionEventId,
      correlationId: CORR,
    })
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.activated.status, "ACTIVE")
    assert.ok(Array.isArray(result.value.events))
  })

  it("rejects AI evidence reference (SV-011)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const aiEvidence = ALL_EVIDENCE.map((e, i) => i === 0 ? { ...e, evidenceId: "ai-bt-001" as EvidenceId } : e)
    const pending = submitForActivation(created.value.version, {
      evidenceRefs: aiEvidence,
      submittedBy: ACTOR,
      submittedAt: CREATED_AT,
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(pending.ok)
    const result = activate(pending.value.version, undefined, {
      approvedBy: ACTOR,
      approvedAt: CREATED_AT,
      effectiveFrom: CREATED_AT,
      eventId: EV_ID3,
      supersededEventId: "ev-004" as StrategyVersionEventId,
      correlationId: CORR,
    })
    assert.ok(!result.ok)
  })
})

describe("withdrawVersion", () => {
  it("can withdraw DRAFT version (SV-012)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const result = withdrawVersion(created.value.version, {
      withdrawnBy: ACTOR,
      withdrawnAt: CREATED_AT,
      withdrawalReason: "No longer needed",
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(result.ok)
    assert.strictEqual(result.value.version.status, "WITHDRAWN")
  })

  it("cannot withdraw already WITHDRAWN version (SV-012)", () => {
    const { config, hash } = getConfig()
    const created = createVersion({
      strategyVersionId: SV_ID,
      strategyId: "strategy-001",
      versionLabel: "1.0.0",
      config,
      configHash: hash,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
      isPreset: false,
      eventId: EV_ID,
      correlationId: CORR,
    })
    assert.ok(created.ok)
    const withdrawn = withdrawVersion(created.value.version, {
      withdrawnBy: ACTOR,
      withdrawnAt: CREATED_AT,
      withdrawalReason: "No longer needed",
      eventId: EV_ID2,
      correlationId: CORR,
    })
    assert.ok(withdrawn.ok)
    const again = withdrawVersion(withdrawn.value.version, {
      withdrawnBy: ACTOR,
      withdrawnAt: CREATED_AT,
      withdrawalReason: "Duplicate",
      eventId: EV_ID3,
      correlationId: CORR,
    })
    assert.ok(!again.ok)
  })
})
