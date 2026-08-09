import assert from 'node:assert/strict'
import test from 'node:test'

import { CancellationCoordinator } from '../../../server/portfolio/execution.ts'
import { requestCancellation } from '../../../server/portfolio/domain/execution/execution-order.ts'
import {
  closeOwner,
  DeterministicExecutionIds,
  FIXTURE_IDS,
  INSTRUMENT_B,
  LOGICAL_ORDER_KEY_BUY,
  TEST_LATER,
  TEST_NOW,
  makeApprovedApproval,
  makeApprovalEvidence,
  makeBrokerReference,
  makeExecutionOrder,
  makeExecutionRun,
  makeMapping,
  makeNormalizedFill,
  makeOrderEvidence,
  makeOrderIntent,
  makeOwnerWithPortfolio,
  makeReconciliationRun,
  makeReconciliationRunEvidence,
  makeRunEvidence,
  makeReconciliationSnapshotEvidence,
  makeReconciliationSnapshot,
  makeSimpleTerminalRelease,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'
import { must } from '../persistence/support.ts'

function seedCancellationState(owner: ReturnType<typeof makeOwnerWithPortfolio>['owner']) {
  const run = makeExecutionRun({ state: 'CANCELLING' })
  const order = Object.freeze({
    ...makeExecutionOrder({
      state: 'ACKNOWLEDGED',
      brokerReference: makeBrokerReference('cancel:seed'),
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
    const runInserted = transaction.runs.insert(run)
    if (!runInserted.ok) return runInserted
    const orderInserted = transaction.orders.insert(order)
    if (!orderInserted.ok) return orderInserted
    return transaction.stageEvidence([
      makeApprovalEvidence(approved),
      makeRunEvidence(run),
      makeOrderEvidence(order),
    ])
  })
  void approval
  assert.equal(seeded.ok, true)
  return { run, order }
}

test('cancellation coordinator persists unknown cancellation races and returns the status-checked order', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Cancellation')
  try {
    const { order } = seedCancellationState(owner)
    const broker = ScriptedBroker.scenario('race-fill', {
      now: () => TEST_NOW,
      today: () => makeOrderIntent().executionWindow.executionDate,
    })
    const statusFill = {
      async check(command: { order: typeof order }) {
        return {
          ok: true as const,
          value: Object.freeze({
            value: Object.freeze({
              order: Object.freeze({ ...command.order, state: 'UNKNOWN' as const }),
              status: Object.freeze({}) as never,
              fills: Object.freeze({}) as never,
              reconciliationRequired: true,
            }),
            postCommitEvidence: Object.freeze([]),
          }),
        }
      },
    } as never
    const coordinator = new CancellationCoordinator(
      owner.executionUnitOfWork,
      broker,
      statusFill,
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
      new DeterministicExecutionIds('cancel'),
      makeSimpleTerminalRelease(),
    )
    const cancelled = await coordinator.request({
      order,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      requestedBy: 'suite',
      reasonCode: 'KILL_SWITCH',
      idempotencyKey: FIXTURE_IDS.idempotencyKey,
      deadlineAt: TEST_LATER,
      statusCheck: {
        portfolioId: FIXTURE_IDS.portfolioId,
        accountBindingId: FIXTURE_IDS.accountBindingId,
        deadlineAt: TEST_LATER,
        accountingContext: () => ({ ok: true, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
      },
    })
    assert.equal(cancelled.ok, true)
    if (cancelled.ok) assert.equal(cancelled.value.value.state, 'UNKNOWN')
  } finally {
    closeOwner(owner)
  }
})

test('cancellation terminal confirmation requires matched after-cancellation reconciliation with zero open quantity', () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Cancellation Confirm')
  try {
    const run = makeExecutionRun({ state: 'CANCELLING' })
    const base = Object.freeze({
      ...makeExecutionOrder({
        orderId: FIXTURE_IDS.orderBuyId,
        instrumentId: INSTRUMENT_B,
        side: 'BUY',
        logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
        sequence: 2,
        approvedQuantityCeiling: quantity(4n),
        state: 'ACKNOWLEDGED',
        brokerReference: makeBrokerReference('cancel:confirm'),
      }),
      intent: makeOrderIntent({
        orderId: FIXTURE_IDS.orderBuyId,
        instrumentId: INSTRUMENT_B,
        mapping: makeMapping(INSTRUMENT_B),
        side: 'BUY',
        logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
        sequence: 2,
        quantity: quantity(4n),
      }),
    })
    const requested = requestCancellation(base, {
      cancellationId: FIXTURE_IDS.cancellationId,
      orderId: base.orderId,
      idempotencyKey: FIXTURE_IDS.idempotencyKey,
      requestedBy: 'suite',
      reasonCode: 'USER_REQUEST',
      requestedAt: TEST_NOW,
      deadlineAt: TEST_LATER,
    }, 2)
    assert.equal(requested.ok, true)
    if (!requested.ok) return
    const seeded = owner.executionUnitOfWork.execute((transaction) => {
      const approved = makeApprovedApproval()
      const approvalInserted = transaction.approvals.insert(approved)
      if (!approvalInserted.ok) return approvalInserted
      const runInserted = transaction.runs.insert(run)
      if (!runInserted.ok) return runInserted
      const orderInserted = transaction.orders.insert(requested.value)
      if (!orderInserted.ok) return orderInserted
      const snapshot = makeReconciliationSnapshot({
        source: 'PAPER',
        snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
        openOrders: Object.freeze([Object.freeze({
          brokerReference: requested.value.brokerReference!,
          status: 'CANCELLED' as const,
          orderedQuantity: quantity(4n),
          filledQuantity: quantity(0n),
          openQuantity: quantity(0n),
          asOf: TEST_LATER,
        })]),
      })
      const snapInserted = transaction.reconciliationSnapshots.insert(snapshot)
      if (!snapInserted.ok) return snapInserted
      const reconciliation = makeReconciliationRun({
        reason: 'AFTER_CANCELLATION',
        externalSnapshotId: snapshot.snapshotId,
      })
      const reconInserted = transaction.reconciliationRuns.insert(reconciliation)
      if (!reconInserted.ok) return reconInserted
      return transaction.stageEvidence([
        makeApprovalEvidence(approved),
        makeRunEvidence(run),
        makeOrderEvidence(requested.value),
        makeReconciliationSnapshotEvidence(snapshot, reconciliation.reconciliationRunId),
        makeReconciliationRunEvidence(reconciliation),
      ])
    })
    assert.equal(seeded.ok, true)
    const coordinator = new CancellationCoordinator(
      owner.executionUnitOfWork,
      new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }),
      { check: async () => ({ ok: true as const, value: Object.freeze({ value: Object.freeze({ order: requested.value, status: Object.freeze({}) as never, fills: Object.freeze({}) as never, reconciliationRequired: false }), postCommitEvidence: Object.freeze([]) }) }) } as never,
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
      new DeterministicExecutionIds('cancel-confirm'),
      makeSimpleTerminalRelease(),
    )
    const confirmed = coordinator.confirmTerminal({
      orderId: requested.value.orderId,
      reconciliation: makeReconciliationRun({
        reason: 'AFTER_CANCELLATION',
        externalSnapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
      }),
    })
    assert.equal(confirmed.ok, true)
    if (confirmed.ok) assert.equal(confirmed.value.value.state, 'CANCELLED')
  } finally {
    closeOwner(owner)
  }
})

test('cancellation replay does not redispatch an unresolved persisted request', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Cancellation Replay Fence')
  try {
    const { order } = seedCancellationState(owner)
    const request = Object.freeze({
      cancellationId: FIXTURE_IDS.cancellationId,
      orderId: order.orderId,
      idempotencyKey: FIXTURE_IDS.idempotencyKey,
      requestedBy: 'suite',
      reasonCode: 'KILL_SWITCH',
      requestedAt: TEST_NOW,
      deadlineAt: TEST_LATER,
    })
    const pending = requestCancellation(order, request, order.stateVersion + 1)
    assert.equal(pending.ok, true)
    if (!pending.ok) return
    const persisted = owner.executionUnitOfWork.execute((transaction) => {
      const inserted = transaction.cancellations.insertRequest(request)
      if (!inserted.ok) return inserted
      const saved = transaction.orders.save(pending.value, order.stateVersion)
      if (!saved.ok) return saved
      return transaction.stageEvidence([
        Object.freeze({
          kind: 'CANCELLATION_REQUESTED' as const,
          portfolioId: order.portfolioId,
          executionRunId: order.executionRunId,
          orderId: order.orderId,
          cancellationId: request.cancellationId,
          occurredAt: request.requestedAt,
        }),
        Object.freeze({
          kind: 'ORDER_STATE_CHANGED' as const,
          portfolioId: order.portfolioId,
          executionRunId: order.executionRunId,
          orderId: order.orderId,
          previousState: order.state,
          newState: pending.value.state,
          stateVersion: pending.value.stateVersion,
          occurredAt: request.requestedAt,
        }),
      ])
    })
    assert.equal(persisted.ok, true)
    const broker = new ScriptedBroker({
      now: () => TEST_NOW,
      today: () => makeOrderIntent().executionWindow.executionDate,
    })
    const coordinator = new CancellationCoordinator(
      owner.executionUnitOfWork,
      broker,
      { check: async () => { throw new Error('status check must not run') } } as never,
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
      new DeterministicExecutionIds('cancel-replay'),
      makeSimpleTerminalRelease(),
    )
    const replay = await coordinator.request({
      order: pending.value,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      requestedBy: request.requestedBy,
      reasonCode: request.reasonCode,
      idempotencyKey: request.idempotencyKey,
      deadlineAt: TEST_LATER,
      statusCheck: {
        portfolioId: FIXTURE_IDS.portfolioId,
        accountBindingId: FIXTURE_IDS.accountBindingId,
        deadlineAt: TEST_LATER,
        accountingContext: () => ({
          ok: true,
          value: Object.freeze({ sellLotMutations: Object.freeze([]) }),
        }),
      },
    })
    assert.equal(replay.ok, false)
    if (!replay.ok) assert.equal(replay.error.code, 'CANCELLATION_OUTCOME_UNKNOWN')
    assert.equal(broker.calls.cancel.length, 0)
  } finally {
    closeOwner(owner)
  }
})
