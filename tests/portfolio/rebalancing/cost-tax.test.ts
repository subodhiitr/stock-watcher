import assert from 'node:assert/strict'
import test from 'node:test'

import {
  estimateOrderCost,
  evaluateDiscretionaryHolding,
  selectTaxLots,
  type CostSchedule,
  type HoldingLot,
  type HoldingLotId,
  type LocalDate,
  type TaxRuleSet,
} from '../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  INSTRUMENT_A,
  exactMoney,
  exactQuantity,
  makePlanningSnapshot,
  makePolicyResolution,
} from './support/fixtures.ts'

function schedule(): CostSchedule {
  const value = makePolicyResolution().costSchedule
  return Object.freeze({
    scheduleVersionId: value.scheduleVersionId,
    effectiveFrom: value.effectiveFrom,
    chargeRules: value.chargeRules,
    spreadRatePpm: value.spreadRatePpm,
    slippageRatePpm: value.slippageRatePpm,
    impactRatePpm: value.impactRatePpm,
  })
}

function taxRules(
  policy: TaxRuleSet['lotSelectionPolicy'],
): TaxRuleSet {
  return Object.freeze({
    taxRuleVersionId: FIXTURE_IDS.taxRuleVersionId,
    effectiveFrom: '2026-01-01' as LocalDate,
    holdingPeriodThresholdDays: 365,
    shortTermRatePpm: 150_000n,
    longTermRatePpm: 100_000n,
    lotSelectionPolicy: policy,
  })
}

function lots(): readonly HoldingLot[] {
  const original = makePlanningSnapshot().portfolio.holdings[0]?.lots[0]
  assert.ok(original)
  const newer = Object.freeze({
    ...original,
    lotId: 'LOT-U04-NEWER' as HoldingLotId,
    acquiredOn: '2026-06-01' as LocalDate,
    originalQuantity: exactQuantity(10n),
    openQuantity: exactQuantity(10n),
    unitCost: exactMoney(12_000n),
  })
  return Object.freeze([original, newer])
}

test('cost estimator composes every configured charge exactly', () => {
  const result = estimateOrderCost({
    schedule: schedule(),
    asOf: '2026-07-31' as LocalDate,
    side: 'BUY',
    grossNotional: exactMoney(1_000_000n),
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.brokerage.minorUnits, 100n)
  assert.equal(result.value.stt.minorUnits, 100n)
  assert.equal(result.value.exchangeCharges.minorUnits, 100n)
  assert.equal(result.value.gst.minorUnits, 100n)
  assert.equal(result.value.sebiCharges.minorUnits, 100n)
  assert.equal(result.value.stampDuty.minorUnits, 100n)
  assert.equal(result.value.dpCharges.minorUnits, 100n)
  assert.equal(result.value.brokerFees.minorUnits, 100n)
  assert.equal(result.value.spreadCost.minorUnits, 100n)
  assert.equal(result.value.slippageCost.minorUnits, 100n)
  assert.equal(result.value.impactCost.minorUnits, 100n)
  assert.equal(result.value.totalCost.minorUnits, 1_100n)
})

test('missing or future cost schedule inputs fail closed', () => {
  const missing: CostSchedule = Object.freeze({
    ...schedule(),
    chargeRules: Object.freeze(schedule().chargeRules.filter((rule) =>
      rule.chargeCode !== 'STT')),
  })
  const missingResult = estimateOrderCost({
    schedule: missing,
    asOf: '2026-07-31' as LocalDate,
    side: 'SELL',
    grossNotional: exactMoney(100_000n),
  })
  assert.equal(missingResult.ok, false)
  if (!missingResult.ok) assert.equal(missingResult.error.code, 'COST_INPUT_MISSING')

  const futureResult = estimateOrderCost({
    schedule: Object.freeze({
      ...schedule(),
      effectiveFrom: '2027-01-01' as LocalDate,
    }),
    asOf: '2026-07-31' as LocalDate,
    side: 'BUY',
    grossNotional: exactMoney(100_000n),
  })
  assert.equal(futureResult.ok, false)
  if (!futureResult.ok) {
    assert.equal(futureResult.error.code, 'COST_SCHEDULE_NOT_EFFECTIVE')
  }
})

test('FIFO and HIFO lot selection use deterministic documented order', () => {
  const fifo = selectTaxLots({
    lots: lots(),
    sellQuantity: exactQuantity(5n),
    salePrice: exactMoney(15_000n),
    asOf: '2026-07-31' as LocalDate,
    taxRules: taxRules('FIFO'),
    mandatoryHardRiskExit: false,
  })
  const hifo = selectTaxLots({
    lots: lots(),
    sellQuantity: exactQuantity(5n),
    salePrice: exactMoney(15_000n),
    asOf: '2026-07-31' as LocalDate,
    taxRules: taxRules('HIFO'),
    mandatoryHardRiskExit: false,
  })
  assert.equal(fifo.ok, true)
  assert.equal(hifo.ok, true)
  if (!fifo.ok || !hifo.ok) return
  assert.equal(fifo.value.selectedLots[0]?.unitCost.minorUnits, 8_000n)
  assert.equal(fifo.value.selectedLots[0]?.termClassification, 'LONG_TERM')
  assert.equal(hifo.value.selectedLots[0]?.unitCost.minorUnits, 12_000n)
  assert.equal(hifo.value.selectedLots[0]?.termClassification, 'SHORT_TERM')
})

test('SPECIFIC selection enforces instructions and hard risk uses provisional FIFO', () => {
  const blocked = selectTaxLots({
    lots: lots(),
    sellQuantity: exactQuantity(5n),
    salePrice: exactMoney(15_000n),
    asOf: '2026-07-31' as LocalDate,
    taxRules: taxRules('SPECIFIC'),
    mandatoryHardRiskExit: false,
  })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.error.code, 'LOT_SELECTION_INSTRUCTION_MISSING')
  }
  const provisional = selectTaxLots({
    lots: lots(),
    sellQuantity: exactQuantity(5n),
    salePrice: exactMoney(15_000n),
    asOf: '2026-07-31' as LocalDate,
    taxRules: taxRules('SPECIFIC'),
    mandatoryHardRiskExit: true,
  })
  assert.equal(provisional.ok, true)
  if (!provisional.ok) return
  assert.equal(provisional.value.isProvisional, true)
  assert.equal(provisional.value.selectedLots[0]?.lotId, `LOT-${INSTRUMENT_A}`)
})

test('after-drag replacement that does not clear its hurdle is skipped', () => {
  const result = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 200_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 300_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 1_000n }),
    relativeDriftBand: Object.freeze({ numerator: 1n, scale: 100n }),
    daysHeld: 400,
    preferredMinimumHoldDays: 30,
    replacementScoreGapPpm: 49_999n,
    requiredReplacementGapPpm: 50_000n,
    mandatory: false,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.allowed, false)
  assert.equal(result.value.reasonBundle?.primaryCode, 'REPLACEMENT_HURDLE_NOT_MET')
})
