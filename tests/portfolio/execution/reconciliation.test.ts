import assert from 'node:assert/strict'
import test from 'node:test'

import { ReconciliationService } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  DeterministicClock,
  FIXTURE_IDS,
  TEST_LATER,
  TEST_NOW,
  makeComparator,
  makeExecutionOrder,
  makeExecutionRun,
  makeNormalizedFill,
  makeOrderIntent,
  makeOwnerWithPortfolio,
  makeReconciliationRun,
  makeReconciliationSnapshot,
  makeSimpleTerminalRelease,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'

function difference(kind: 'VALUE_MISMATCH' | 'UNKNOWN_ORDER') {
  return Object.freeze({
    differenceId: makeReconciliationSnapshot().contentHash,
    kind,
    severity: kind === 'UNKNOWN_ORDER' ? 'CRITICAL' : 'BLOCKING',
    orderId: FIXTURE_IDS.orderSellId,
    instrumentId: makeExecutionOrder().instrumentId,
    expected: 'local',
    actual: 'external',
    resolution: kind === 'UNKNOWN_ORDER' ? 'NONE' : 'REQUIRES_ADJUSTMENT_APPROVAL',
  })
}

test('reconciliation service blocks incoherent external snapshots and preserves immutable local snapshots', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Reconciliation Blocked')
  try {
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }, {
      reconciliation: [Object.freeze({
        snapshot: makeReconciliationSnapshot({
          source: 'PAPER',
          snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
          endpointTimes: Object.freeze({
            holdings: TEST_NOW,
            cash: TEST_LATER,
            fills: '2026-08-03T05:00:30.000Z' as typeof TEST_NOW,
          }),
        }),
        coherent: false,
      })],
    })
    const service = new ReconciliationService(
      owner.executionUnitOfWork,
      broker,
      makeComparator(),
      { apply: async () => ({ ok: true as const, value: undefined }) },
      new DeterministicClock(),
      new DeterministicClock(),
      makeSimpleTerminalRelease(),
    )
    const local = makeReconciliationSnapshot()
    const result = await service.reconcile({
      run: makeReconciliationRun({ state: 'REQUESTED' }),
      localSnapshot: local,
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      externalSnapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
      mappingSnapshotHash: local.contentHash,
      deadlineAt: TEST_LATER,
      totalDeadlineMs: 5_000,
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.value.state, 'BLOCKED')
  } finally {
    closeOwner(owner)
  }
})

test('reconciliation service finalizes blocked outcomes deterministically when containment is required', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Reconciliation Final')
  try {
    const broker = new ScriptedBroker({ now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate }, {
      reconciliation: [Object.freeze({
        snapshot: makeReconciliationSnapshot({
          source: 'PAPER',
          snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
          fills: Object.freeze([makeNormalizedFill()]),
        }),
        coherent: true,
      })],
    })
    const service = new ReconciliationService(
      owner.executionUnitOfWork,
      broker,
      makeComparator(Object.freeze([difference('VALUE_MISMATCH'), difference('UNKNOWN_ORDER')])),
      { apply: async () => ({ ok: true as const, value: undefined }) },
      new DeterministicClock(),
      new DeterministicClock(),
      makeSimpleTerminalRelease(),
    )
    const result = await service.reconcile({
      run: makeReconciliationRun({ state: 'REQUESTED' }),
      localSnapshot: makeReconciliationSnapshot(),
      portfolioId: FIXTURE_IDS.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      externalSnapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
      mappingSnapshotHash: makeReconciliationSnapshot().contentHash,
      deadlineAt: TEST_LATER,
      totalDeadlineMs: 5_000,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.value.state, 'BLOCKED')
    assert.equal(result.value.value.differences.length, 0)
    const completed = result.value.postCommitEvidence.find((payload) => payload.kind === 'RECONCILIATION_COMPLETED')
    assert.deepEqual(completed, Object.freeze({
      kind: 'RECONCILIATION_COMPLETED',
      portfolioId: FIXTURE_IDS.portfolioId,
      reconciliationRunId: FIXTURE_IDS.reconciliationRunId,
      state: 'BLOCKED',
      differenceCount: 0,
      occurredAt: TEST_NOW,
    }))
  } finally {
    closeOwner(owner)
  }
})
