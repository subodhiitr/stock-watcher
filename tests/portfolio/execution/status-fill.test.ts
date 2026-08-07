import assert from 'node:assert/strict'
import test from 'node:test'

import { StatusFillCoordinator } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  DeterministicClock,
  DeterministicTimer,
  FIXTURE_IDS,
  TEST_LATER,
  TEST_NOW,
  makeApprovedApproval,
  makeApprovalEvidence,
  makeBrokerReference,
  makeExecutionOrder,
  makeExecutionRun,
  makeNormalizedFill,
  makeOrderEvidence,
  makeOrderIntent,
  makeOwnerWithPortfolio,
  makeReconciliationRun,
  makeReconciliationRunEvidence,
  makeRunEvidence,
  makeSimpleTerminalRelease,
  money,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'
import { must } from '../persistence/support.ts'

function seedRunAndOrder(owner: ReturnType<typeof makeOwnerWithPortfolio>['owner']) {
  const run = makeExecutionRun({ state: 'SELLING' })
  const order = Object.freeze({
    ...makeExecutionOrder({
      state: 'ACKNOWLEDGED',
      brokerReference: makeBrokerReference('status-fill:test'),
      reservedDeliveryQuantity: quantity(10n),
    }),
    intent: makeOrderIntent(),
  })
  const approval = Object.freeze({
    ...makeExecutionRun(),
  })
  const seeded = owner.executionUnitOfWork.execute((transaction) => {
    const approved = makeApprovedApproval()
    const approvalInserted = transaction.approvals.insert(approved)
    if (!approvalInserted.ok) return approvalInserted
    const reconciliation = makeReconciliationRun()
    const reconInserted = transaction.reconciliationRuns.insert(reconciliation)
    if (!reconInserted.ok) return reconInserted
    const runInserted = transaction.runs.insert(run)
    if (!runInserted.ok) return runInserted
    const orderInserted = transaction.orders.insert(order)
    if (!orderInserted.ok) return orderInserted
    return transaction.stageEvidence([
      makeApprovalEvidence(approved),
      makeReconciliationRunEvidence(reconciliation),
      makeRunEvidence(run),
      makeOrderEvidence(order),
    ])
  })
  void approval
  assert.equal(seeded.ok, true)
  return { run, order }
}

test('status/fill coordinator escalates broker-filled without local fills to unknown reconciliation-required', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Status Fill')
  try {
    const { order } = seedRunAndOrder(owner)
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }, {
      status: [Object.freeze({
        orderId: order.orderId,
        snapshot: Object.freeze({
          brokerReference: order.brokerReference!,
          status: 'FILLED' as const,
          orderedQuantity: quantity(10n),
          filledQuantity: quantity(10n),
          openQuantity: quantity(0n),
          averageFillPrice: money(12_400n),
          asOf: TEST_LATER,
        }),
        asOf: TEST_LATER,
      })],
      fills: [Object.freeze({
        fills: Object.freeze([]),
        asOf: TEST_LATER,
        coherent: true,
      })],
    })
    const coordinator = new StatusFillCoordinator(
      owner.executionUnitOfWork,
      broker,
      { apply: () => { throw new Error('unexpected atomic accounting') } },
      makeSimpleTerminalRelease(),
      new DeterministicTimer(new DeterministicClock()),
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
    )
    const checked = await coordinator.check({
      order,
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      accountingContext: () => ({ ok: true, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
    })
    assert.equal(checked.ok, true)
    if (!checked.ok) return
    assert.equal(checked.value.value.order.state, 'UNKNOWN')
    assert.equal(checked.value.value.reconciliationRequired, true)
  } finally {
    closeOwner(owner)
  }
})

test('status/fill coordinator rejects incoherent broker fill pages before mutating state', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Status Incoherent')
  try {
    const { order } = seedRunAndOrder(owner)
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }, {
      status: [Object.freeze({
        orderId: order.orderId,
        snapshot: Object.freeze({
          brokerReference: order.brokerReference!,
          status: 'OPEN' as const,
          orderedQuantity: quantity(10n),
          filledQuantity: quantity(0n),
          openQuantity: quantity(10n),
          asOf: TEST_NOW,
        }),
        asOf: TEST_NOW,
      })],
      fills: [Object.freeze({
        fills: Object.freeze([makeNormalizedFill()]),
        nextCursor: 'cursor:bad',
        asOf: TEST_NOW,
        coherent: false,
      })],
    })
    const coordinator = new StatusFillCoordinator(
      owner.executionUnitOfWork,
      broker,
      { apply: () => { throw new Error('unexpected atomic accounting') } },
      makeSimpleTerminalRelease(),
      new DeterministicTimer(new DeterministicClock()),
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
    )
    const checked = await coordinator.check({
      order,
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      accountingContext: () => ({ ok: true, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
    })
    assert.equal(checked.ok, false)
    if (!checked.ok) assert.equal(checked.error.code, 'BROKER_SNAPSHOT_INCOHERENT')
  } finally {
    closeOwner(owner)
  }
})
