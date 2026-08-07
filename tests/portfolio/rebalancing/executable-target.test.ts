import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PlanningSnapshotAssembler,
  allocateWholeSharesGreedy,
  calculateImplementationShortfall,
  constructIdealTarget,
  createMoney,
  createWeight,
  projectCandidates,
  type IdealTarget,
  type PlanningCandidate,
  type PlanningSnapshot,
} from '../../../server/portfolio/index.ts'
import {
  INSTRUMENT_A,
  makeAssemblyRequest,
  makeFakePorts,
  makePlanningSnapshot,
} from './support/fixtures.ts'

async function planningValues(snapshot = makePlanningSnapshot()) {
  const assembled = await new PlanningSnapshotAssembler(
    makeFakePorts({ snapshot }),
  ).assemble(makeAssemblyRequest())
  assert.equal(assembled.ok, true)
  if (!assembled.ok) throw new TypeError('assembly failed')
  const context = assembled.value.context
  const projection = projectCandidates(context.candidates)
  assert.equal(projection.ok, true)
  if (!projection.ok) throw new TypeError('projection failed')
  const startingNav = createMoney(
    context.cash.minorUnits + context.candidates.reduce(
      (total, candidate) => total
        + (candidate.currentHolding?.totalQuantity.shares ?? 0n)
          * candidate.price.minorUnits,
      0n,
    ),
  )
  assert.equal(startingNav.ok, true)
  if (!startingNav.ok) throw new TypeError('NAV failed')
  const ideal = constructIdealTarget({
    projection: projection.value,
    startingNav: startingNav.value,
    constraints: context.constraints,
  })
  assert.equal(ideal.ok, true)
  if (!ideal.ok) throw new TypeError('ideal target failed')
  return { context, startingNav: startingNav.value, ideal: ideal.value }
}

test('whole-share seed and greedy allocation preserve exact cash and canonical order', async () => {
  const values = await planningValues()
  const result = allocateWholeSharesGreedy({
    idealTarget: values.ideal,
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.value.positions.every((position) =>
    typeof position.targetQuantity.shares === 'bigint'
    && position.targetQuantity.shares >= 0n))
  assert.ok(result.value.residualCash.minorUnits >= 0n)
  assert.deepEqual(
    result.value.positions.map((position) => position.instrumentId),
    [...result.value.positions.map((position) => position.instrumentId)].sort(),
  )
  assert.equal(result.value.constraintChecks.every((check) => check.passed), true)
})

test('executable allocation never exceeds available delivery on mandatory exits', async () => {
  const base = makePlanningSnapshot()
  const portfolio = base.portfolio
  const originalHolding = portfolio.holdings[0]
  const firstEvaluation = base.evaluations[0]
  assert.ok(originalHolding)
  assert.ok(firstEvaluation)
  const limitedHolding = Object.freeze({
    ...originalHolding,
    availableDeliveryQuantity: Object.freeze({ shares: 5n }),
  })
  const snapshot = makePlanningSnapshot({
    portfolio: Object.freeze({
      ...portfolio,
      holdings: Object.freeze([limitedHolding]),
    }),
    evaluations: Object.freeze([
      Object.freeze({
        ...firstEvaluation,
        eligibility: Object.freeze({
          ...firstEvaluation.eligibility,
          status: 'INELIGIBLE',
          hardRiskFlag: true,
        }),
      }),
      base.evaluations[1] as PlanningSnapshot['evaluations'][number],
    ]),
  })
  const values = await planningValues(snapshot)
  const result = allocateWholeSharesGreedy({
    idealTarget: values.ideal,
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  const first = result.value.positions.find((position) =>
    position.instrumentId === INSTRUMENT_A)
  assert.ok(first)
  assert.equal(first.targetQuantity.shares, 15n)
  assert.equal(first.deltaQuantityShares, -5n)
})

test('a reconciled exact target produces a valid no-trade plan', async () => {
  const values = await planningValues()
  const candidate = values.context.candidates.find((item) =>
    item.instrumentId === INSTRUMENT_A) as PlanningCandidate
  const targetWeight = createWeight(200_000n)
  const cashWeight = createWeight(800_000n)
  const targetValue = createMoney(200_000n)
  assert.ok(targetWeight.ok && cashWeight.ok && targetValue.ok)
  const ideal: IdealTarget = Object.freeze({
    totalEquityWeight: targetWeight.value,
    cashWeight: cashWeight.value,
    positions: Object.freeze([Object.freeze({
      instrumentId: candidate.instrumentId,
      rank: candidate.rank,
      compositeScorePpm: candidate.compositeScorePpm,
      inverseVolatilityWeight: targetWeight.value,
      targetWeight: targetWeight.value,
      targetValue: targetValue.value,
      bindingConstraintIds: Object.freeze([]),
    })]),
    excludedCandidates: Object.freeze([]),
  })
  const result = allocateWholeSharesGreedy({
    idealTarget: ideal,
    candidates: Object.freeze([candidate]),
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.noTrade, true)
  assert.equal(result.value.positions[0]?.deltaQuantityShares, 0n)
  assert.equal(result.value.residualCash.minorUnits, 800_000n)
})

test('implementation shortfall quantifies weight cash notional and drag gaps', async () => {
  const values = await planningValues()
  const executable = allocateWholeSharesGreedy({
    idealTarget: values.ideal,
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(executable.ok, true)
  if (!executable.ok) return
  const result = calculateImplementationShortfall({
    idealPositions: values.ideal.positions,
    executablePositions: executable.value.positions,
    idealCashWeight: values.ideal.cashWeight,
    executableCashWeight: executable.value.cashWeight,
    estimatedCost: Object.freeze({ currency: 'INR', minorUnits: 100n }),
    estimatedTax: Object.freeze({ currency: 'INR', minorUnits: 50n }),
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.dragGap.minorUnits, 150n)
  assert.ok(result.value.weightGap.partsPerMillion >= 0n)
  assert.ok(result.value.cashGap.partsPerMillion >= 0n)
  assert.ok(result.value.notionalGap.minorUnits >= 0n)
})
