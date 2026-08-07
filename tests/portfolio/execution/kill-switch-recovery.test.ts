import assert from 'node:assert/strict'
import test from 'node:test'

import { KillSwitchService, RecoveryService } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  DeterministicExecutionIds,
  FIXTURE_IDS,
  InMemoryDispatchFence,
  TEST_LATER,
  TEST_NOW,
  makeApprovedApproval,
  makeApprovalEvidence,
  makeBrokerReference,
  makeExecutionOrder,
  makeExecutionRun,
  makeOrderEvidence,
  makeOrderIntent,
  makeOwnerWithPortfolio,
  makeRunEvidence,
  makeSimpleTerminalRelease,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker } from './support/scripted-broker.ts'

test('recovery service reclassifies submission-in-flight orders to unknown without placement authority', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Recovery')
  try {
    const run = makeExecutionRun({ state: 'RECOVERY_REQUIRED' })
    const order = Object.freeze({
      ...makeExecutionOrder({
        state: 'SUBMISSION_IN_FLIGHT',
      }),
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
    const recovered = await recovery.recover({
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
    assert.equal(recovered.ok, true)
    if (!recovered.ok) return
    assert.equal(recovered.value.value.orders[0]?.state, 'UNKNOWN')
    assert.equal(recovered.value.value.reconciliationRequired, true)
  } finally {
    closeOwner(owner)
  }
})

test('kill switch activation closes the dispatch fence and contains unresolved admissions before reset', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Kill Switch')
  try {
    const fence = new InMemoryDispatchFence()
    fence.unresolved.push({
      admission: Object.freeze({
        scope: Object.freeze({ kind: 'PORTFOLIO', portfolioId: FIXTURE_IDS.portfolioId }),
        portfolioId: FIXTURE_IDS.portfolioId,
        executionRunId: FIXTURE_IDS.executionRunId,
        orderId: FIXTURE_IDS.orderSellId,
        submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
        clientIdentity: Object.freeze({
          idempotencyKey: FIXTURE_IDS.idempotencyKey,
          intentHash: makeOrderIntent().planHash,
        }),
      }),
      brokerDispatched: true,
      failureCode: 'SUBMISSION_OUTCOME_UNKNOWN',
    })
    const killSwitch = Object.freeze({
      killSwitchId: FIXTURE_IDS.killSwitchId,
      scope: Object.freeze({ kind: 'PORTFOLIO', portfolioId: FIXTURE_IDS.portfolioId }),
      state: 'INACTIVE' as const,
      stateVersion: 1,
      history: Object.freeze([]),
    })
    const service = new KillSwitchService(
      owner.executionUnitOfWork,
      { request: async () => ({ ok: true as const, value: Object.freeze({ value: makeExecutionOrder({ state: 'CANCEL_PENDING' }), postCommitEvidence: Object.freeze([]) }) }) } as never,
      { now: () => TEST_NOW, today: () => makeOrderIntent().executionWindow.executionDate },
      { assess: async () => ({ ok: true as const, value: Object.freeze({
        killSwitchId: FIXTURE_IDS.killSwitchId,
        killSwitchStateVersion: 2,
        checkedAt: TEST_LATER,
        contentHash: makeOrderIntent().planHash,
        healthSnapshotHash: makeOrderIntent().planHash,
        reconciliationSnapshotIds: Object.freeze([FIXTURE_IDS.reconciliationSnapshotId]),
        affectedPortfolioVersions: Object.freeze([{ portfolioId: FIXTURE_IDS.portfolioId, stateVersion: makeExecutionRun().portfolioStateVersion }]),
      }) }) },
      { create: () => ({ ok: true as const, value: {
        order: makeExecutionOrder({ state: 'ACKNOWLEDGED', brokerReference: makeBrokerReference('kill:1'), reservedDeliveryQuantity: quantity(10n) }),
        accountBindingId: FIXTURE_IDS.accountBindingId,
        requestedBy: 'kill',
        reasonCode: 'KILL_SWITCH',
        idempotencyKey: FIXTURE_IDS.idempotencyKey,
        deadlineAt: TEST_LATER,
        statusCheck: {
          portfolioId: FIXTURE_IDS.portfolioId,
          accountBindingId: FIXTURE_IDS.accountBindingId,
          deadlineAt: TEST_LATER,
          accountingContext: () => ({ ok: true as const, value: Object.freeze({ sellLotMutations: Object.freeze([]) }) }),
        },
      } }) },
      fence,
      { containAndRequireReconciliation: async () => ({ ok: true as const, value: undefined }) },
    )
    const activated = await service.activate({
      snapshot: killSwitch,
      activation: Object.freeze({
        reasonCode: 'OPS_STOP',
        actorId: FIXTURE_IDS.actorId,
        evidenceId: FIXTURE_IDS.evidenceId,
        activatedAt: TEST_NOW,
        correlationId: FIXTURE_IDS.correlationId,
      }),
    })
    assert.equal(activated.ok, true)
    if (!activated.ok) return
    assert.equal(activated.value.value.snapshot.state, 'ACTIVE')
    assert.equal(activated.value.value.unresolvedAdmissions.length, 1)
    assert.equal(activated.value.value.cancellationCoverageComplete, false)
  } finally {
    closeOwner(owner)
  }
})
