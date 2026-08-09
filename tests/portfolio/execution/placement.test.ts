import assert from 'node:assert/strict'
import test from 'node:test'

import { PlacementCoordinator } from '../../../server/portfolio/execution.ts'
import { hashExecutionValue } from '../../../server/portfolio/domain/execution/canonical-codec.ts'
import {
  closeOwner,
  DeterministicExecutionIds,
  FIXTURE_IDS,
  INSTRUMENT_B,
  InMemoryDispatchFence,
  LOGICAL_ORDER_KEY_BUY,
  TEST_LATER,
  TEST_NOW,
  makeAggregateLineage,
  makeAllGatesContext,
  makeApprovedApproval,
  makeApprovalEvidence,
  makeExecutionOrder,
  makeExecutionRun,
  makeDispatchGateRefresh,
  makeMapping,
  makeOrderEvidence,
  makeOrderIntent,
  makeOwnerWithPortfolio,
  makePreTradeRiskContext,
  makeReconciliationRun,
  makeReconciliationRunEvidence,
  makeRunEvidence,
  makeSimpleReservation,
  makeSimpleTerminalRelease,
  money,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'
import { must } from '../persistence/support.ts'

function seedPlacementState(owner: ReturnType<typeof makeOwnerWithPortfolio>['owner']) {
  const run = makeExecutionRun({
    state: 'BUYING',
    phaseReconciliationIds: Object.freeze([FIXTURE_IDS.reconciliationRunId]),
  })
  const approval = makeApprovedApproval({
    state: 'CONSUMED',
    consumedByExecutionRunId: run.executionRunId,
  })
  const order = makeExecutionOrder({
    orderId: FIXTURE_IDS.orderBuyId,
    instrumentId: INSTRUMENT_B,
    side: 'BUY',
    logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
    sequence: 2,
    approvedQuantityCeiling: quantity(4n),
  })
  const persisted = owner.executionUnitOfWork.execute((transaction) => {
    const approvalInserted = transaction.approvals.insert(approval)
    if (!approvalInserted.ok) return approvalInserted
    const reconciliation = makeReconciliationRun({ reason: 'AFTER_SELLS' })
    const reconInserted = transaction.reconciliationRuns.insert(reconciliation)
    if (!reconInserted.ok) return reconInserted
    const runInserted = transaction.runs.insert(run)
    if (!runInserted.ok) return runInserted
    const orderInserted = transaction.orders.insert(order)
    if (!orderInserted.ok) return orderInserted
    return transaction.stageEvidence([
      makeApprovalEvidence(approval),
      makeReconciliationRunEvidence(reconciliation),
      makeRunEvidence(run),
      makeOrderEvidence(order),
    ])
  })
  assert.equal(persisted.ok, true)
  return { approval, run, order }
}

test('placement coordinator persists acknowledged placement with deterministic sell authority', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => intent.executionWindow.executionDate }, {
      place: [Object.freeze({
        submissionAttemptId: new DeterministicExecutionIds('placement').submissionAttemptId(),
        certainty: 'ACKNOWLEDGED' as const,
        brokerReference: {
          brokerOrderReferenceId: FIXTURE_IDS.brokerReferenceId,
          brokerOrderId: 'scripted:ack',
          accountBindingId: FIXTURE_IDS.accountBindingId,
          acknowledgedAt: TEST_NOW,
        },
        attemptedAt: TEST_NOW,
        completedAt: TEST_NOW,
      })],
    })
    const fence = new InMemoryDispatchFence()
    const coordinator = new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      fence,
      new DeterministicExecutionIds('placement'),
      makeDispatchGateRefresh(makeAllGatesContext({ run, approval })),
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    )
    const placed = await coordinator.place({
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates: makeAllGatesContext({ run, approval }),
    })
    assert.equal(placed.ok, true, placed.ok ? undefined : `${placed.error.code}:${placed.error.field}`)
    if (!placed.ok) return
    assert.equal(placed.value.value.certainty, 'ACKNOWLEDGED')
    assert.equal(placed.value.value.order.state, 'ACKNOWLEDGED')
    assert.equal(broker.calls.place.length, 1)
  } finally {
    closeOwner(owner)
  }
})

test('placement coordinator preserves ambiguous broker outcomes as unknown for recovery', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement Unknown')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const broker = ScriptedBroker.scenario('ambiguity', {
      now: () => TEST_NOW,
      today: () => intent.executionWindow.executionDate,
    })
    const coordinator = new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      new InMemoryDispatchFence(),
      new DeterministicExecutionIds('placement-unknown'),
      makeDispatchGateRefresh(makeAllGatesContext({ run, approval })),
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    )
    const placed = await coordinator.place({
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates: makeAllGatesContext({ run, approval }),
    })
    assert.equal(placed.ok, true, placed.ok ? undefined : `${placed.error.code}:${placed.error.field}`)
    if (placed.ok) {
      assert.equal(placed.value.value.order.state, 'UNKNOWN')
      assert.equal(placed.value.value.certainty, 'UNKNOWN')
    }
  } finally {
    closeOwner(owner)
  }
})

test('placement coordinator does not call the broker when affordability gates fail', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement Risk')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => intent.executionWindow.executionDate })
    const placed = await new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      new InMemoryDispatchFence(),
      new DeterministicExecutionIds('placement-risk'),
      makeDispatchGateRefresh(makeAllGatesContext({
        run,
        approval,
        preTradeRisk: makePreTradeRiskContext({ cashAdequate: false }),
      })),
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    ).place({
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates: makeAllGatesContext({
        run,
        approval,
        preTradeRisk: makePreTradeRiskContext({ cashAdequate: false }),
      }),
    })
    assert.equal(placed.ok, false)
    assert.equal(broker.calls.place.length, 0)
  } finally {
    closeOwner(owner)
  }
})

test('placement coordinator refreshes dispatch gates and blocks a newly failed risk check', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement Refresh')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const broker = new ScriptedBroker({
      now: () => TEST_NOW,
      today: () => intent.executionWindow.executionDate,
    })
    let refreshCalls = 0
    const initialGates = makeAllGatesContext({ run, approval })
    const coordinator = new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      new InMemoryDispatchFence(),
      new DeterministicExecutionIds('placement-refresh'),
      {
        async refresh() {
          refreshCalls += 1
          return {
            ok: true as const,
            value: Object.freeze({
              liveEnablement: initialGates.liveEnablement,
              executionWindow: initialGates.executionWindow,
              quote: initialGates.quote,
              preTradeRisk: makePreTradeRiskContext({ cashAdequate: false }),
              currentPlanHash: initialGates.currentPlanHash,
              currentPlanInputHash: approval.binding!.planInputHash,
              strategyVersionId: approval.binding!.strategyVersionId,
              strategyConfigHash: approval.binding!.strategyConfigHash,
              policySnapshotId: run.policySnapshotId,
              reconciliationSnapshotId: initialGates.reconciliation.externalSnapshotId!,
              maximumQuoteAgeMs: initialGates.quote.maximumQuoteAgeMs,
            }),
          }
        },
      },
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    )
    const placed = await coordinator.place({
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates: initialGates,
    })
    assert.equal(placed.ok, true, placed.ok ? undefined : `${placed.error.code}:${placed.error.field}`)
    if (placed.ok) {
      assert.equal(placed.value.value.certainty, 'DEFINITELY_NOT_SENT')
      assert.equal(placed.value.value.brokerCallMade, false)
      assert.equal(
        placed.value.value.order.submissionAttempts.at(-1)?.failureCode,
        'BUY_AFFORDABILITY_FAILED',
      )
    }
    assert.equal(refreshCalls, 1)
    assert.equal(broker.calls.place.length, 0)
  } finally {
    closeOwner(owner)
  }
})

test('placement coordinator blocks dispatch when refreshed approval lineage has changed', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement Lineage Refresh')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const broker = new ScriptedBroker({
      now: () => TEST_NOW,
      today: () => intent.executionWindow.executionDate,
    })
    const gates = makeAllGatesContext({ run, approval })
    const baselineRefresh = makeDispatchGateRefresh(gates)
    const coordinator = new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      new InMemoryDispatchFence(),
      new DeterministicExecutionIds('placement-lineage-refresh'),
      {
        async refresh(command) {
          const refreshed = await baselineRefresh.refresh(command)
          if (!refreshed.ok) return refreshed
          return {
            ok: true as const,
            value: Object.freeze({
              ...refreshed.value,
              currentPlanHash: must(hashExecutionValue('changed-plan', {})),
            }),
          }
        },
      },
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    )
    const placed = await coordinator.place({
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates,
    })
    assert.equal(placed.ok, true)
    if (placed.ok) {
      assert.equal(placed.value.value.brokerCallMade, false)
      assert.equal(
        placed.value.value.order.submissionAttempts.at(-1)?.failureCode,
        'APPROVAL_REVALIDATION_FAILED',
      )
    }
    assert.equal(broker.calls.place.length, 0)
  } finally {
    closeOwner(owner)
  }
})

test('placement coordinator persists retry exhaustion with one evidence record per mutation', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Placement Exhaustion')
  try {
    const { approval, run, order } = seedPlacementState(owner)
    const intent = makeOrderIntent({
      orderId: order.orderId,
      executionRunId: run.executionRunId,
      approvalId: approval.approvalId,
      instrumentId: order.instrumentId,
      mapping: makeMapping(order.instrumentId),
      side: order.side,
      logicalOrderKey: order.logicalOrderKey,
      quantity: order.approvedQuantityCeiling,
      limitPrice: money(8_000n),
      sequence: order.sequence,
    })
    const intentHash = must(hashExecutionValue('order-intent', intent))
    const placeCalls: unknown[] = []
    const broker = {
      async placeOrder(request: { submissionAttemptId: string }) {
        placeCalls.push(request)
        return {
          ok: true as const,
          value: Object.freeze({
            submissionAttemptId: request.submissionAttemptId,
            certainty: 'DEFINITELY_NOT_SENT' as const,
            attemptedAt: TEST_NOW,
            completedAt: TEST_NOW,
            failure: Object.freeze({
              failureCode: 'BROKER_DISCONNECTED' as const,
              certainty: 'DEFINITELY_NOT_SENT' as const,
              redactedDetail: 'TEST_NOT_SENT',
            }),
          }),
        }
      },
    }
    const gates = makeAllGatesContext({ run, approval })
    const coordinator = new PlacementCoordinator(
      owner.executionUnitOfWork,
      broker as never,
      makeSimpleReservation(),
      makeSimpleTerminalRelease(),
      new InMemoryDispatchFence(),
      new DeterministicExecutionIds('placement-exhaustion'),
      makeDispatchGateRefresh(gates),
      { now: () => TEST_NOW, today: () => intent.executionWindow.executionDate },
    )
    const command = {
      order,
      intent,
      intentHash,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      deadlineAt: TEST_LATER,
      gates,
    }
    const first = await coordinator.place(command)
    const second = await coordinator.place(command)
    const third = await coordinator.place(command)
    assert.equal(first.ok, true, first.ok ? undefined : `${first.error.code}:${first.error.field}`)
    assert.equal(second.ok, true, second.ok ? undefined : `${second.error.code}:${second.error.field}`)
    assert.equal(third.ok, true, third.ok ? undefined : `${third.error.code}:${third.error.field}`)
    if (third.ok) assert.equal(third.value.value.order.state, 'RESIDUAL')
    assert.equal(placeCalls.length, 3)
  } finally {
    closeOwner(owner)
  }
})
