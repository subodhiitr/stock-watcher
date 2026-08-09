import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PlanningSnapshotAssembler,
  RebalancePlanningService,
  comparePlanEquivalence,
  createDraftPlanLifecycle,
  revalidatePlanLifecycle,
  transitionPlanLifecycle,
  type LocalDate,
  type PlanningSnapshot,
  type RebalancePlan,
} from '../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  exactMoney,
  exactQuantity,
  makeAssemblyRequest,
  makeFakePorts,
  makePlanningSnapshot,
  makePortfolioSnapshot,
  makeStrategyConfig,
} from './support/fixtures.ts'

const PHASE_DURATIONS = Object.freeze([
  Object.freeze({ phase: 'GATE' as const, durationMs: 0 }),
  Object.freeze({ phase: 'IDEAL_TARGET' as const, durationMs: 0 }),
  Object.freeze({ phase: 'EXECUTABLE_ALLOCATION' as const, durationMs: 0 }),
  Object.freeze({ phase: 'COST_TAX' as const, durationMs: 0 }),
  Object.freeze({ phase: 'CONSTRAINT_VERIFICATION' as const, durationMs: 0 }),
  Object.freeze({ phase: 'ASSEMBLY' as const, durationMs: 0 }),
])

async function createPlan(
  request = makeAssemblyRequest(),
): Promise<RebalancePlan> {
  const assembler = new PlanningSnapshotAssembler(makeFakePorts())
  const service = new RebalancePlanningService({ assembler })
  const result = await service.plan({
    assembly: request,
    phaseDurations: PHASE_DURATIONS,
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new TypeError('planning failed')
  return result.value
}

async function createPlanForSnapshot(snapshot: PlanningSnapshot): Promise<RebalancePlan> {
  const assembler = new PlanningSnapshotAssembler(makeFakePorts({ snapshot }))
  const service = new RebalancePlanningService({ assembler })
  const result = await service.plan({
    assembly: makeAssemblyRequest(),
    phaseDurations: PHASE_DURATIONS,
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new TypeError('planning failed')
  return result.value
}

function portfolioWithHolding(input: Readonly<{
  shares: bigint
  cashMinorUnits: bigint
  acquiredOn?: LocalDate
}>): PlanningSnapshot['portfolio'] {
  const portfolio = makePortfolioSnapshot()
  const incumbent = portfolio.holdings[0]
  assert.ok(incumbent)
  const quantity = exactQuantity(input.shares)
  const adjustedHolding = Object.freeze({
    ...incumbent,
    totalQuantity: quantity,
    availableDeliveryQuantity: quantity,
    lots: Object.freeze(incumbent.lots.map((lot) => Object.freeze({
      ...lot,
      ...(input.acquiredOn === undefined ? {} : { acquiredOn: input.acquiredOn }),
      originalQuantity: quantity,
      openQuantity: quantity,
    }))),
  })
  return makePortfolioSnapshot({
    cash: exactMoney(input.cashMinorUnits),
    holdings: Object.freeze([adjustedHolding]),
  })
}

function replacementSnapshot(input: Readonly<{
  incumbentEligibility: 'ELIGIBLE' | 'HOLD_ELIGIBLE'
  incumbentScore: number
}>): PlanningSnapshot {
  const base = makePlanningSnapshot()
  const incumbent = base.evaluations[0]
  const entrant = base.evaluations[1]
  assert.ok(incumbent)
  assert.ok(entrant)
  const strategy = makeStrategyConfig()
  return makePlanningSnapshot({
    strategyConfig: Object.freeze({
      ...strategy,
      construction: Object.freeze({
        ...strategy.construction,
        targetHoldings: 1,
      }),
    }),
    evaluations: Object.freeze([
      Object.freeze({
        ...incumbent,
        eligibility: Object.freeze({
          ...incumbent.eligibility,
          status: input.incumbentEligibility,
        }),
        signal: Object.freeze({
          ...incumbent.signal,
          rank: 12,
          compositeScore: input.incumbentScore,
        }),
      }),
      Object.freeze({
        ...entrant,
        signal: Object.freeze({
          ...entrant.signal,
          rank: 1,
          compositeScore: 1,
        }),
      }),
    ]),
  })
}

test('full planning produces approval-ready proposed skipped and blocked ledgers', async () => {
  const plan = await createPlan()
  assert.equal(plan.state, 'APPROVAL_READY')
  assert.ok(plan.actionBuckets.proposed.length > 0)
  assert.equal(plan.actionBuckets.skipped.length, 0)
  assert.equal(plan.actionBuckets.blocked.length, 0)
  assert.equal(
    plan.observability.actionCounts.proposed,
    plan.actionBuckets.proposed.length,
  )
  assert.ok(plan.actionBuckets.proposed.every((order) =>
    order.logicalOrderKey.length === 64
    && order.reasonBundle.humanExplanation.length > 0))
})

test('full planning keeps an incumbent inside its drift band and records the policy skip', async () => {
  const portfolio = portfolioWithHolding({
    shares: 40n,
    cashMinorUnits: 600_000n,
  })
  const incumbent = portfolio.holdings[0]
  assert.ok(incumbent)
  const snapshot = makePlanningSnapshot({
    portfolio,
  })
  const plan = await createPlanForSnapshot(snapshot)
  const skipped = plan.actionBuckets.skipped.find((order) =>
    order.instrumentId === incumbent.instrumentId)
  assert.equal(skipped?.reasonBundle.primaryCode, 'INSIDE_DRIFT_BAND')
  assert.equal(plan.actionBuckets.proposed.some((order) =>
    order.instrumentId === incumbent.instrumentId), false)
  assert.equal(plan.executableTarget.positions.find((position) =>
    position.instrumentId === incumbent.instrumentId)?.deltaQuantityShares, 0n)
})

test('full planning preserves a recently acquired incumbent outside the drift band', async () => {
  const snapshot = makePlanningSnapshot({
    portfolio: portfolioWithHolding({
      shares: 20n,
      cashMinorUnits: 800_000n,
      acquiredOn: '2026-07-20' as LocalDate,
    }),
  })
  const incumbentId = snapshot.portfolio.holdings[0]?.instrumentId
  assert.ok(incumbentId)
  const plan = await createPlanForSnapshot(snapshot)
  assert.equal(plan.actionBuckets.skipped.find((order) =>
    order.instrumentId === incumbentId)?.reasonBundle.primaryCode,
  'PREFERRED_HOLD_ACTIVE')
  assert.equal(plan.executableTarget.positions.find((position) =>
    position.instrumentId === incumbentId)?.deltaQuantityShares, 0n)
})

test('full planning keeps a hold-eligible incumbent and suppresses its paired entrant', async () => {
  const snapshot = replacementSnapshot({
    incumbentEligibility: 'HOLD_ELIGIBLE',
    incumbentScore: 0.96,
  })
  const incumbentId = snapshot.portfolio.holdings[0]?.instrumentId
  const entrantId = snapshot.evaluations.find((item) =>
    item.signal.instrumentId !== incumbentId)?.signal.instrumentId
  assert.ok(incumbentId)
  assert.ok(entrantId)
  const plan = await createPlanForSnapshot(snapshot)
  for (const instrumentId of [incumbentId, entrantId]) {
    assert.equal(plan.actionBuckets.skipped.find((order) =>
      order.instrumentId === instrumentId)?.reasonBundle.primaryCode,
    'HOLD_RANK_BUFFER_ACTIVE')
    assert.equal(plan.actionBuckets.proposed.some((order) =>
      order.instrumentId === instrumentId), false)
    assert.equal(plan.executableTarget.positions.find((position) =>
      position.instrumentId === instrumentId)?.deltaQuantityShares, 0n)
  }
})

test('full planning rejects a replacement below the after-drag hurdle', async () => {
  const snapshot = replacementSnapshot({
    incumbentEligibility: 'ELIGIBLE',
    incumbentScore: 0.96,
  })
  const incumbentId = snapshot.portfolio.holdings[0]?.instrumentId
  const entrantId = snapshot.evaluations.find((item) =>
    item.signal.instrumentId !== incumbentId)?.signal.instrumentId
  assert.ok(incumbentId)
  assert.ok(entrantId)
  const plan = await createPlanForSnapshot(snapshot)
  for (const instrumentId of [incumbentId, entrantId]) {
    assert.equal(plan.actionBuckets.skipped.find((order) =>
      order.instrumentId === instrumentId)?.reasonBundle.primaryCode,
    'REPLACEMENT_HURDLE_NOT_MET')
    assert.equal(plan.executableTarget.positions.find((position) =>
      position.instrumentId === instrumentId)?.deltaQuantityShares, 0n)
  }
})

test('hard stock-cap reduction bypasses preferred-hold suppression', async () => {
  const strategy = makeStrategyConfig()
  const snapshot = makePlanningSnapshot({
    portfolio: portfolioWithHolding({
      shares: 20n,
      cashMinorUnits: 800_000n,
      acquiredOn: '2026-07-20' as LocalDate,
    }),
    strategyConfig: Object.freeze({
      ...strategy,
      eligibility: Object.freeze({
        ...strategy.eligibility,
        maxStockWeightPct: 15,
      }),
    }),
  })
  const incumbentId = snapshot.portfolio.holdings[0]?.instrumentId
  assert.ok(incumbentId)
  const plan = await createPlanForSnapshot(snapshot)
  const proposed = plan.actionBuckets.proposed.find((order) =>
    order.instrumentId === incumbentId)
  assert.ok(proposed)
  assert.equal(proposed.side, 'SELL')
  assert.ok(proposed.quantityShares > 0n)
  assert.equal(plan.actionBuckets.skipped.some((order) =>
    order.instrumentId === incumbentId), false)
})

test('approval-ready summary reconciles current and projected views', async () => {
  const plan = await createPlan()
  assert.equal(plan.summary.currentCash.minorUnits, 800_000n)
  assert.equal(
    plan.summary.projectedCash.minorUnits,
    plan.executableTarget.residualCash.minorUnits,
  )
  assert.equal(
    plan.summary.projectedExposure.partsPerMillion,
    plan.executableTarget.totalEquityWeight.partsPerMillion,
  )
  assert.ok(plan.summary.totalEstimatedCosts.minorUnits >= 0n)
  assert.ok(plan.implementationShortfall.notionalGap.minorUnits >= 0n)
})

test('equivalent replay ignores run identity and creation timestamp', async () => {
  const first = await createPlan()
  const second = await createPlan(makeAssemblyRequest({
    rebalanceRunId: 'REBALANCE-U04-REPLAY' as typeof FIXTURE_IDS.rebalanceRunId,
    createdAt: '2026-07-31T13:30:00.000Z' as ReturnType<typeof makeAssemblyRequest>['createdAt'],
  }))
  assert.equal(second.planInputHash, first.planInputHash)
  assert.equal(second.planHash, first.planHash)
  assert.deepEqual(
    second.actionBuckets.proposed.map((order) => order.logicalOrderKey),
    first.actionBuckets.proposed.map((order) => order.logicalOrderKey),
  )
  assert.equal(comparePlanEquivalence(first, second).equivalent, true)
})

test('lifecycle allows readiness then one immutable terminal transition only', () => {
  const draft = createDraftPlanLifecycle(FIXTURE_IDS.rebalanceRunId)
  const ready = transitionPlanLifecycle(
    draft,
    'APPROVAL_READY',
    '2026-07-31T12:30:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  const superseded = transitionPlanLifecycle(
    ready.value,
    'SUPERSEDED',
    '2026-07-31T13:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  assert.equal(superseded.ok, true)
  if (!superseded.ok) return
  assert.equal(superseded.value.history.length, 2)
  const illegal = transitionPlanLifecycle(
    superseded.value,
    'APPROVAL_READY',
    '2026-07-31T14:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  assert.equal(illegal.ok, false)
  if (!illegal.ok) assert.equal(illegal.error.code, 'PLAN_STATE_UNSUPPORTED')
})

test('revalidation invalidates stale lineage and expires a missed window', async () => {
  const plan = await createPlan()
  const invalidated = revalidatePlanLifecycle({
    plan,
    checkedAt: '2026-08-01T12:00:00.000Z' as Parameters<typeof revalidatePlanLifecycle>[0]['checkedAt'],
    checkedOn: '2026-08-01' as Parameters<typeof revalidatePlanLifecycle>[0]['checkedOn'],
    lineageCurrent: false,
    supersededByNonEquivalentPlan: false,
  })
  assert.equal(invalidated.ok, true)
  if (invalidated.ok) {
    assert.equal(invalidated.value.state, 'INVALIDATED')
    assert.equal(invalidated.value.planHash, plan.planHash)
  }
  const expired = revalidatePlanLifecycle({
    plan,
    checkedAt: '2026-08-04T12:00:00.000Z' as Parameters<typeof revalidatePlanLifecycle>[0]['checkedAt'],
    checkedOn: '2026-08-04' as Parameters<typeof revalidatePlanLifecycle>[0]['checkedOn'],
    lineageCurrent: true,
    supersededByNonEquivalentPlan: false,
  })
  assert.equal(expired.ok, true)
  if (expired.ok) assert.equal(expired.value.state, 'EXPIRED')
})
