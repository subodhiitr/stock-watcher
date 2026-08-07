import assert from 'node:assert/strict'
import test from 'node:test'

import { ExecutionRunService } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  DeterministicExecutionIds,
  FIXTURE_IDS,
  FixtureExecutionStatePort,
  TEST_NOW,
  makeAggregateLineage,
  makeApprovedApproval,
  makeApprovalBinding,
  makeExecutionPolicyLineage,
  makeReconciliationRunEvidence,
  makeApprovalEvidence,
  makeOwnerWithPortfolio,
  makePlanState,
  makeReconciliationRun,
  money,
} from './support/fixtures.ts'
import { must } from '../persistence/support.ts'

function loadAccounting(owner: ReturnType<typeof makeOwnerWithPortfolio>['owner']) {
  const portfolio = must(owner.portfolios.getById(FIXTURE_IDS.portfolioId))
  assert.ok(portfolio)
  if (!portfolio) throw new Error('missing portfolio')
  const snapshot = portfolio.snapshot()
  return Object.freeze({
    snapshot,
    totalReservedCash: money(0n),
    holdingsByInstrument: new Map(snapshot.holdings.map((holding) => [holding.instrumentId, holding])),
    stateVersion: snapshot.stateVersion,
    asOf: TEST_NOW,
  })
}

async function persistApprovalAndReconciliation(
  owner: ReturnType<typeof makeOwnerWithPortfolio>['owner'],
) {
  const committed = owner.executionUnitOfWork.execute((transaction) => {
    const approval = makeApprovedApproval()
    const insertedApproval = transaction.approvals.insert(approval)
    if (!insertedApproval.ok) return insertedApproval
    const reconciliation = makeReconciliationRun()
    const insertedReconciliation = transaction.reconciliationRuns.insert(reconciliation)
    if (!insertedReconciliation.ok) return insertedReconciliation
    const staged = transaction.stageEvidence([
      makeApprovalEvidence(approval),
      makeReconciliationRunEvidence(reconciliation),
    ])
    return staged.ok ? { ok: true as const, value: undefined } : staged
  })
  assert.equal(committed.ok, true)
}

test('execution run service sorts sells before buys and replays by approval id', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Run')
  try {
    await persistApprovalAndReconciliation(owner)
    const state = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      plan: makePlanState(),
      policy: makeExecutionPolicyLineage(),
      aggregate: makeAggregateLineage(),
    })
    const service = new ExecutionRunService(
      state,
      owner.executionUnitOfWork,
      { now: () => TEST_NOW, today: () => makeApprovalBinding().executionDate },
      new DeterministicExecutionIds('run'),
    )
    const created = await service.createRun({
      portfolioId: FIXTURE_IDS.portfolioId,
      approvalId: FIXTURE_IDS.approvalId,
      mode: 'PAPER',
      preExecutionReconciliationId: FIXTURE_IDS.reconciliationRunId,
      policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
      timeoutMs: 5_000,
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const sequences = created.value.value.orders.map((order) => `${order.sequence}:${order.side}`)
    assert.deepEqual(sequences, ['1:SELL', '2:BUY'])
    assert.equal(created.value.value.run.state, 'CREATED')

    const replay = await service.createRun({
      portfolioId: FIXTURE_IDS.portfolioId,
      approvalId: FIXTURE_IDS.approvalId,
      mode: 'PAPER',
      preExecutionReconciliationId: FIXTURE_IDS.reconciliationRunId,
      policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
      timeoutMs: 5_000,
    })
    assert.equal(replay.ok, true)
    if (replay.ok) {
      assert.equal(replay.value.value.run.executionRunId, created.value.value.run.executionRunId)
      assert.equal(replay.value.value.orders.length, 2)
    }
  } finally {
    closeOwner(owner)
  }
})

test('execution run service fails when the policy snapshot or reconciliation lineage no longer matches', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Run Invalid')
  try {
    await persistApprovalAndReconciliation(owner)
    const state = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      policy: makeExecutionPolicyLineage(),
      aggregate: makeAggregateLineage(),
    })
    const service = new ExecutionRunService(
      state,
      owner.executionUnitOfWork,
      { now: () => TEST_NOW, today: () => makeApprovalBinding().executionDate },
      new DeterministicExecutionIds('run-invalid'),
    )
    const wrongPolicy = await service.createRun({
      portfolioId: FIXTURE_IDS.portfolioId,
      approvalId: FIXTURE_IDS.approvalId,
      mode: 'PAPER',
      preExecutionReconciliationId: FIXTURE_IDS.reconciliationRunId,
      policySnapshotId: FIXTURE_IDS.quoteSnapshotId as never,
      timeoutMs: 5_000,
    })
    assert.equal(wrongPolicy.ok, false)
    if (!wrongPolicy.ok) assert.equal(wrongPolicy.error.code, 'APPROVAL_REVALIDATION_FAILED')

    const staleRecon = await service.createRun({
      portfolioId: FIXTURE_IDS.portfolioId,
      approvalId: FIXTURE_IDS.approvalId,
      mode: 'PAPER',
      preExecutionReconciliationId: FIXTURE_IDS.reconciliationSnapshotId as never,
      policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
      timeoutMs: 5_000,
    })
    assert.equal(staleRecon.ok, false)
  } finally {
    closeOwner(owner)
  }
})
