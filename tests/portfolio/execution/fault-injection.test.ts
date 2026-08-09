import assert from 'node:assert/strict'
import test from 'node:test'

import { BrokerResilienceGovernor, RecoveryService, StatusFillCoordinator } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  DeterministicClock,
  DeterministicSeed,
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
  makeRunEvidence,
  makeSimpleTerminalRelease,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'

test('fault injection: placement deadlines degrade to definitely-not-sent and read failures remain explicit', async () => {
  const clock = new DeterministicClock()
  const governor = new BrokerResilienceGovernor(
    new ScriptedBroker(clock, {
      status: [{ ok: false, error: { code: 'BROKER_DISCONNECTED', retryability: 'AFTER_STATE_REFRESH' } as never }],
    }) as never,
    clock,
    new DeterministicTimer(clock),
    new DeterministicSeed(7),
  )
  const placement = await governor.placeOrder({
    submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
    orderId: FIXTURE_IDS.orderSellId,
    portfolioId: FIXTURE_IDS.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    intent: makeOrderIntent(),
    deadlineAt: TEST_NOW,
  })
  assert.equal(placement.ok, true)
  if (placement.ok) assert.equal(placement.value.certainty, 'DEFINITELY_NOT_SENT')
})

test('fault injection: malformed broker bindings fail closed in status checks', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Fault Status')
  try {
    const run = makeExecutionRun({ state: 'SELLING' })
    const order = Object.freeze({
      ...makeExecutionOrder({
        state: 'ACKNOWLEDGED',
        brokerReference: makeBrokerReference('fault:binding'),
        reservedDeliveryQuantity: quantity(10n),
      }),
      intent: makeOrderIntent(),
    })
    const seeded = owner.executionUnitOfWork.execute((transaction) => {
      const approval = makeApprovedApproval()
      const approvalInserted = transaction.approvals.insert(approval)
      if (!approvalInserted.ok) return approvalInserted
      const runInserted = transaction.runs.insert(run)
      if (!runInserted.ok) return runInserted
      const orderInserted = transaction.orders.insert(order)
      if (!orderInserted.ok) return orderInserted
      return transaction.stageEvidence([
        makeApprovalEvidence(approval),
        makeRunEvidence(run),
        makeOrderEvidence(order),
      ])
    })
    assert.equal(seeded.ok, true)
    const coordinator = new StatusFillCoordinator(
      owner.executionUnitOfWork,
      new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }, {
        status: [Object.freeze({
          orderId: order.orderId,
          snapshot: Object.freeze({
            brokerReference: makeBrokerReference('fault:other'),
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
          asOf: TEST_NOW,
          coherent: true,
        })],
      }),
      { apply: () => ({ ok: true as const, value: { accountingEvidence: Object.freeze({}) as never, run, runEvidence: Object.freeze({}) as never } }) },
      makeSimpleTerminalRelease(),
      new DeterministicTimer(new DeterministicClock()),
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
    )
    const checked = await coordinator.check({
      order,
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      accountingContext: () => ({ ok: true as const, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
    })
    assert.equal(checked.ok, false)
    if (!checked.ok) assert.equal(checked.error.code, 'FILL_BINDING_INVALID')
  } finally {
    closeOwner(owner)
  }
})

test('fault injection: repeated cold recovery remains deterministic after crash boundaries', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Fault Recovery')
  try {
    const run = makeExecutionRun({ state: 'RECOVERY_REQUIRED' })
    const order = Object.freeze({
      ...makeExecutionOrder({ state: 'SUBMISSION_IN_FLIGHT' }),
      intent: makeOrderIntent(),
      submissionAttempts: Object.freeze([Object.freeze({
        submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
        attemptNumber: 1,
        intentHash: makeOrderIntent().planHash,
        state: 'SUBMISSION_IN_FLIGHT' as const,
        startedAt: TEST_NOW,
      })]),
    })
    const seeded = owner.executionUnitOfWork.execute((transaction) => {
      const approval = makeApprovedApproval()
      const approvalInserted = transaction.approvals.insert(approval)
      if (!approvalInserted.ok) return approvalInserted
      const runInserted = transaction.runs.insert(run)
      if (!runInserted.ok) return runInserted
      const orderInserted = transaction.orders.insert(order)
      if (!orderInserted.ok) return orderInserted
      return transaction.stageEvidence([
        makeApprovalEvidence(approval),
        makeRunEvidence(run),
        makeOrderEvidence(order),
      ])
    })
    assert.equal(seeded.ok, true)
    const recovery = new RecoveryService(
      owner.executionUnitOfWork,
      new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }),
      { check: async () => ({ ok: true as const, value: Object.freeze({ value: Object.freeze({ order, status: Object.freeze({}) as never, fills: Object.freeze({}) as never, reconciliationRequired: false }), postCommitEvidence: Object.freeze([]) }) }) } as never,
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
    )
    const first = await recovery.recover({
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      preflight: { verify: async () => ({ ok: true as const, value: undefined }) },
      statusCheck: () => ({
        portfolioId: FIXTURE_IDS.portfolioId,
        accountBindingId: FIXTURE_IDS.accountBindingId,
        deadlineAt: TEST_LATER,
        accountingContext: () => ({ ok: true as const, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
      }),
    })
    const second = await recovery.recover({
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      preflight: { verify: async () => ({ ok: true as const, value: undefined }) },
      statusCheck: () => ({
        portfolioId: FIXTURE_IDS.portfolioId,
        accountBindingId: FIXTURE_IDS.accountBindingId,
        deadlineAt: TEST_LATER,
        accountingContext: () => ({ ok: true as const, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
      }),
    })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (first.ok && second.ok) {
      assert.equal(first.value.value.orders[0]?.state, 'UNKNOWN')
      assert.equal(second.value.value.orders[0]?.state, 'UNKNOWN')
    }
  } finally {
    closeOwner(owner)
  }
})
