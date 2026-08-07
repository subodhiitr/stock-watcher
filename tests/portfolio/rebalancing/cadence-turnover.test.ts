import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDriftBand,
  calculateTurnoverConsumption,
  evaluateDiscretionaryHolding,
  evaluateTurnoverWindows,
  isCadenceOpen,
  type CadencePolicySnapshot,
  type LocalDate,
  type PlanningTurnoverWindow,
} from '../../../server/portfolio/index.ts'
import { exactMoney } from './support/fixtures.ts'

function cadence(
  routineFrequency: CadencePolicySnapshot['routineFrequency'],
): CadencePolicySnapshot {
  return Object.freeze({
    strategyHorizon: routineFrequency === 'BIWEEKLY' ? 'SHORT'
      : routineFrequency === 'MONTHLY' ? 'MEDIUM' : 'LONG',
    routineFrequency,
    driftReviewFrequency: 'MONTHLY',
    nextRoutineDecisionDate: '2026-07-31' as LocalDate,
    nextDriftReviewDate: '2026-07-31' as LocalDate,
    preferredMinimumHoldDays: 30,
  })
}

test('biweekly monthly and quarterly cadence gates use explicit dates', () => {
  for (const frequency of ['BIWEEKLY', 'MONTHLY', 'QUARTERLY'] as const) {
    const open = isCadenceOpen({
      asOf: '2026-07-31',
      reviewKind: 'CONSTITUENT',
      cadence: cadence(frequency),
      decisionSessionDate: '2026-07-31',
      eligibleExecutionDate: '2026-08-03',
    })
    assert.equal(open.ok, true)
    if (open.ok) assert.equal(open.value, true)
    const closed = isCadenceOpen({
      asOf: '2026-07-30',
      reviewKind: 'CONSTITUENT',
      cadence: cadence(frequency),
      decisionSessionDate: '2026-07-30',
      eligibleExecutionDate: '2026-07-31',
    })
    assert.equal(closed.ok, true)
    if (closed.ok) assert.equal(closed.value, false)
  }
})

test('same-session routine planning is rejected', () => {
  const result = isCadenceOpen({
    asOf: '2026-07-31',
    reviewKind: 'CONSTITUENT',
    cadence: cadence('MONTHLY'),
    decisionSessionDate: '2026-07-31',
    eligibleExecutionDate: '2026-07-31',
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'ROUTINE_TIMING_VIOLATION')
})

test('drift band uses the greater of absolute and relative thresholds', () => {
  assert.equal(calculateDriftBand({
    targetWeight: Object.freeze({ partsPerMillion: 200_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 5_000n }),
    relativeDriftBand: Object.freeze({ numerator: 20n, scale: 100n }),
  }), 40_000n)
  assert.equal(calculateDriftBand({
    targetWeight: Object.freeze({ partsPerMillion: 10_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 5_000n }),
    relativeDriftBand: Object.freeze({ numerator: 20n, scale: 100n }),
  }), 5_000n)
})

test('inside-band and preferred-hold incumbents are skipped unless mandatory', () => {
  const insideBand = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 200_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 205_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 10_000n }),
    relativeDriftBand: Object.freeze({ numerator: 10n, scale: 100n }),
    daysHeld: 100,
    preferredMinimumHoldDays: 30,
    mandatory: false,
  })
  assert.equal(insideBand.ok, true)
  if (insideBand.ok) {
    assert.equal(insideBand.value.allowed, false)
    assert.equal(insideBand.value.reasonBundle?.primaryCode, 'INSIDE_DRIFT_BAND')
  }
  const mandatory = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 200_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 205_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 10_000n }),
    relativeDriftBand: Object.freeze({ numerator: 10n, scale: 100n }),
    daysHeld: 1,
    preferredMinimumHoldDays: 30,
    mandatory: true,
  })
  assert.equal(mandatory.ok, true)
  if (mandatory.ok) assert.equal(mandatory.value.allowed, true)
})

test('hold-rank buffers and after-drag hurdles suppress non-material replacements', () => {
  const buffered = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 300_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 0n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 10_000n }),
    relativeDriftBand: Object.freeze({ numerator: 10n, scale: 100n }),
    daysHeld: 100,
    preferredMinimumHoldDays: 30,
    mandatory: false,
    holdRankBufferActive: true,
    replacementScoreGapPpm: 20_000n,
    requiredReplacementGapPpm: 50_000n,
  })
  assert.equal(buffered.ok, true)
  if (buffered.ok) {
    assert.equal(buffered.value.allowed, false)
    assert.equal(buffered.value.reasonBundle?.primaryCode, 'HOLD_RANK_BUFFER_ACTIVE')
  }

  const afterDrag = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 300_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 0n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 10_000n }),
    relativeDriftBand: Object.freeze({ numerator: 10n, scale: 100n }),
    daysHeld: 100,
    preferredMinimumHoldDays: 30,
    mandatory: false,
    holdRankBufferActive: false,
    replacementScoreGapPpm: 40_000n,
    requiredReplacementGapPpm: 50_000n,
  })
  assert.equal(afterDrag.ok, true)
  if (afterDrag.ok) {
    assert.equal(afterDrag.value.allowed, false)
    assert.equal(afterDrag.value.reasonBundle?.primaryCode, 'REPLACEMENT_HURDLE_NOT_MET')
  }
})

test('turnover uses conservative max buy or sell notional over NAV', () => {
  const result = calculateTurnoverConsumption({
    totalBuyNotional: exactMoney(200_000n),
    totalSellNotional: exactMoney(300_000n),
    startingNav: exactMoney(1_000_000n),
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value, { numerator: 300_000n, scale: 1_000_000n })
})

test('all four turnover windows aggregate prior consumption and bind excess', () => {
  const kinds = [
    'ROLLING_30_DAY',
    'CALENDAR_MONTH',
    'CALENDAR_QUARTER',
    'CALENDAR_YEAR',
  ] as const
  const windows: readonly PlanningTurnoverWindow[] = Object.freeze(kinds.map((windowKind) =>
    Object.freeze({
      windowKind,
      budgetLimit: Object.freeze({ numerator: 500_000n, scale: 1_000_000n }),
      consumedBeforePlan: Object.freeze({
        numerator: windowKind === 'CALENDAR_YEAR' ? 450_000n : 100_000n,
        scale: 1_000_000n,
      }),
    })))
  const result = evaluateTurnoverWindows({
    proposedConsumption: Object.freeze({ numerator: 100_000n, scale: 1_000_000n }),
    windows,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.windows.length, 4)
  assert.equal(result.value.accepted, false)
  assert.equal(result.value.reasonBundle?.primaryCode, 'TURNOVER_BUDGET_EXCEEDED')
  assert.equal(
    result.value.windows.find((window) =>
      window.windowKind === 'CALENDAR_MONTH')?.consumedAfterPlan.numerator,
    200_000n,
  )
})
