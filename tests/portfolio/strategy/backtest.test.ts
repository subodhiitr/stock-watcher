import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createBacktestRun,
  startBacktestRun,
  recordBiasCheck,
  completeBacktestRun,
  failBacktestRun,
  BACKTEST_CONSTANTS,
  type BacktestResult,
} from "../../../server/portfolio/domain/strategy/backtest-run.ts"
import type { BacktestRunId, DataVersionId, StrategyVersionId } from "../../../server/portfolio/domain/shared/identifiers.ts"

const RUN_ID = "bt-001" as BacktestRunId
const SV_ID = "sv-001" as StrategyVersionId
const DV_ID = "dv-001" as DataVersionId
const CREATED_AT = "2024-01-01T00:00:00Z"
const UPDATED_AT = "2024-01-02T00:00:00Z"

function makeRunParams(overrides: Record<string, unknown> = {}) {
  return {
    backtestRunId: RUN_ID,
    strategyVersionId: SV_ID,
    startDate: "2015-01-01",  // 9 years span
    endDate: "2024-01-01",
    randomSeed: 42,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function makeValidResult(): BacktestResult {
  const fold = Object.freeze({
    foldIndex: 0,
    inSampleStart: "2015-01-01",
    inSampleEnd: "2018-12-31",
    outOfSampleStart: "2019-01-01",
    outOfSampleEnd: "2021-12-31",
    dataVersionId: DV_ID,
    keyMetrics: Object.freeze({ cagr: 0.18, sharpe: 1.2 }),
  })
  return Object.freeze({
    dataVersionId: DV_ID,
    folds: Object.freeze([fold, { ...fold, foldIndex: 1, inSampleStart: "2016-01-01", inSampleEnd: "2019-12-31", outOfSampleStart: "2020-01-01", outOfSampleEnd: "2022-12-31" }, { ...fold, foldIndex: 2, inSampleStart: "2017-01-01", inSampleEnd: "2020-12-31", outOfSampleStart: "2021-01-01", outOfSampleEnd: "2023-12-31" }]),
    calendarVersion: "NSE-2024",
    timezone: "Asia/Kolkata",
    randomSeed: 42,
    estimatedCostDragBps: 50,
    estimatedTaxDragBps: 80,
    noReturnGuaranteeStatement: "Past performance does not guarantee future results.",
    lookAheadViolations: 0,
    survivorshipViolations: 0,
    lookAheadChecksPerformed: true,
    survivorshipBiasChecksPerformed: true,
  })
}

describe("createBacktestRun", () => {
  it("creates run in PENDING status (BT-001)", () => {
    const result = createBacktestRun(makeRunParams())
    assert.ok(result.ok, JSON.stringify(!result.ok ? result.error : ""))
    assert.strictEqual(result.value.status, "PENDING")
    assert.ok(Object.isFrozen(result.value))
  })

  it("rejects runs with less than 5 years of data (BT-006)", () => {
    const result = createBacktestRun(makeRunParams({ startDate: "2022-01-01", endDate: "2024-01-01" }))
    assert.ok(!result.ok)
  })

  it("initial bias check fields are false (BT-007)", () => {
    const result = createBacktestRun(makeRunParams())
    assert.ok(result.ok)
    assert.strictEqual(result.value.lookAheadChecksPerformed, false)
    assert.strictEqual(result.value.survivorshipBiasChecksPerformed, false)
    assert.strictEqual(result.value.lookAheadViolations, 0)
    assert.strictEqual(result.value.survivorshipViolations, 0)
  })
})

describe("backtest lifecycle", () => {
  it("PENDING -> RUNNING -> COMPLETED (BT-001)", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const running = startBacktestRun(created.value, UPDATED_AT)
    assert.ok(running.ok)
    assert.strictEqual(running.value.status, "RUNNING")

    // Record bias checks
    const biasChecked = recordBiasCheck(running.value, "LOOK_AHEAD", 0, UPDATED_AT)
    assert.ok(biasChecked.ok)
    const survivorChecked = recordBiasCheck(biasChecked.value, "SURVIVORSHIP", 0, UPDATED_AT)
    assert.ok(survivorChecked.ok)

    const completed = completeBacktestRun(survivorChecked.value, makeValidResult(), UPDATED_AT)
    assert.ok(completed.ok, JSON.stringify(!completed.ok ? completed.error : ""))
    assert.strictEqual(completed.value.status, "COMPLETED")
  })

  it("cannot start a run that is already RUNNING", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const running = startBacktestRun(created.value, UPDATED_AT)
    assert.ok(running.ok)
    const again = startBacktestRun(running.value, UPDATED_AT)
    assert.ok(!again.ok)
  })

  it("cannot complete without bias checks performed (BT-007)", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const running = startBacktestRun(created.value, UPDATED_AT)
    assert.ok(running.ok)
    // Complete without bias checks
    const completed = completeBacktestRun(running.value, makeValidResult(), UPDATED_AT)
    assert.ok(!completed.ok)
  })

  it("cannot complete with look-ahead violations (BT-008)", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const running = startBacktestRun(created.value, UPDATED_AT)
    assert.ok(running.ok)
    const withViolation = recordBiasCheck(running.value, "LOOK_AHEAD", 3, UPDATED_AT)
    assert.ok(withViolation.ok)
    const survivorChecked = recordBiasCheck(withViolation.value, "SURVIVORSHIP", 0, UPDATED_AT)
    assert.ok(survivorChecked.ok)
    const completed = completeBacktestRun(survivorChecked.value, makeValidResult(), UPDATED_AT)
    assert.ok(!completed.ok)
  })

  it("PENDING -> FAILED is valid (BT-001)", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const failed = failBacktestRun(created.value, "Data provider unavailable", UPDATED_AT)
    assert.ok(failed.ok)
    assert.strictEqual(failed.value.status, "FAILED")
  })

  it("COMPLETED cannot transition to FAILED", () => {
    const created = createBacktestRun(makeRunParams())
    assert.ok(created.ok)
    const running = startBacktestRun(created.value, UPDATED_AT)
    assert.ok(running.ok)
    const biasChecked = recordBiasCheck(running.value, "LOOK_AHEAD", 0, UPDATED_AT)
    assert.ok(biasChecked.ok)
    const survivorChecked = recordBiasCheck(biasChecked.value, "SURVIVORSHIP", 0, UPDATED_AT)
    assert.ok(survivorChecked.ok)
    const completed = completeBacktestRun(survivorChecked.value, makeValidResult(), UPDATED_AT)
    assert.ok(completed.ok)
    const failed = failBacktestRun(completed.value, "reason", UPDATED_AT)
    assert.ok(!failed.ok)
  })
})

describe("BACKTEST_CONSTANTS", () => {
  it("MIN_BACKTEST_YEARS is 5 (BT-006)", () => {
    assert.strictEqual(BACKTEST_CONSTANTS.MIN_BACKTEST_YEARS, 5)
  })

  it("MIN_WALKFORWARD_FOLDS is 3 (BT-009)", () => {
    assert.strictEqual(BACKTEST_CONSTANTS.MIN_WALKFORWARD_FOLDS, 3)
  })
})
