import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PlanningSnapshotAssembler,
  constructIdealTarget,
  projectCandidates,
  type PlanningSnapshot,
} from '../../../server/portfolio/index.ts'
import {
  INSTRUMENT_A,
  INSTRUMENT_B,
  makeAssemblyRequest,
  makeFakePorts,
  makePlanningSnapshot,
} from './support/fixtures.ts'

async function construct(snapshot = makePlanningSnapshot()) {
  const assembled = await new PlanningSnapshotAssembler(
    makeFakePorts({ snapshot }),
  ).assemble(makeAssemblyRequest())
  assert.equal(assembled.ok, true)
  if (!assembled.ok) throw new TypeError('assembly failed')
  const projection = projectCandidates(assembled.value.context.candidates)
  assert.equal(projection.ok, true)
  if (!projection.ok) throw new TypeError('projection failed')
  const navMinorUnits = assembled.value.context.cash.minorUnits
    + assembled.value.context.candidates.reduce(
      (total, candidate) => total
        + (candidate.currentHolding?.totalQuantity.shares ?? 0n)
          * candidate.price.minorUnits,
      0n,
    )
  const result = constructIdealTarget({
    projection: projection.value,
    startingNav: Object.freeze({ currency: 'INR', minorUnits: navMinorUnits }),
    constraints: assembled.value.context.constraints,
  })
  return { assembled, projection, result }
}

test('ideal target retains eligible incumbent and adds ranked entrant', async () => {
  const { result } = await construct()
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(
    result.value.positions.map((position) => position.instrumentId),
    [INSTRUMENT_A, INSTRUMENT_B],
  )
  assert.ok(result.value.positions[0]?.targetWeight.partsPerMillion)
  assert.equal(
    result.value.totalEquityWeight.partsPerMillion
      + result.value.cashWeight.partsPerMillion,
    1_000_000n,
  )
})

test('ideal target uses regime exposure and cash buffer caps exactly', async () => {
  const { result, assembled } = await construct()
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(
    result.value.totalEquityWeight.partsPerMillion
      <= assembled.value.context.constraints.regimeExposureCap.partsPerMillion,
  )
  assert.ok(
    result.value.cashWeight.partsPerMillion
      >= assembled.value.context.constraints.cashBufferFloor.partsPerMillion,
  )
  for (const position of result.value.positions) {
    assert.ok(
      position.targetWeight.partsPerMillion
        <= assembled.value.context.constraints.maxStockWeight.partsPerMillion,
    )
  }
})

test('ideal target blocks an attractive entrant with missing group classification', async () => {
  const base = makePlanningSnapshot()
  const second = base.evaluations[1]
  assert.ok(second)
  const snapshot = makePlanningSnapshot({
    evaluations: Object.freeze([
      base.evaluations[0] as PlanningSnapshot['evaluations'][number],
      Object.freeze({
        ...second,
        groupId: undefined,
      }) as unknown as PlanningSnapshot['evaluations'][number],
    ]),
  })
  const { projection, result } = await construct(snapshot)
  assert.equal(projection.value.blockedCandidates.length, 1)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(
    result.value.positions.map((position) => position.instrumentId),
    [INSTRUMENT_A],
  )
  assert.equal(
    result.value.excludedCandidates.some((entry) =>
      entry.instrumentId === INSTRUMENT_B),
    true,
  )
})

test('ideal target never invents filler positions', async () => {
  const base = makePlanningSnapshot()
  const { result } = await construct(makePlanningSnapshot({
    evaluations: Object.freeze([
      base.evaluations[0] as PlanningSnapshot['evaluations'][number],
    ]),
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.positions.length, 1)
  assert.ok(result.value.cashWeight.partsPerMillion > 0n)
})

test('ideal target ordering and values are independent of candidate input order', async () => {
  const base = makePlanningSnapshot()
  const forward = await construct(base)
  const reverse = await construct(makePlanningSnapshot({
    evaluations: Object.freeze([...base.evaluations].reverse()),
  }))
  assert.equal(forward.result.ok, true)
  assert.equal(reverse.result.ok, true)
  if (!forward.result.ok || !reverse.result.ok) return
  assert.deepEqual(reverse.result.value, forward.result.value)
})

test('mandatory hard-risk incumbents are zeroed before weighting', async () => {
  const base = makePlanningSnapshot()
  const first = base.evaluations[0]
  assert.ok(first)
  const snapshot = makePlanningSnapshot({
    evaluations: Object.freeze([
      Object.freeze({
        ...first,
        eligibility: Object.freeze({
          ...first.eligibility,
          status: 'INELIGIBLE',
          hardRiskFlag: true,
        }),
      }),
      base.evaluations[1] as PlanningSnapshot['evaluations'][number],
    ]),
  })
  const { projection, result } = await construct(snapshot)
  assert.equal(projection.value.mandatoryExits.length, 1)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(
    result.value.positions.some((position) => position.instrumentId === INSTRUMENT_A),
    false,
  )
})
