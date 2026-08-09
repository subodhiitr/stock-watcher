import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalService } from '../../../server/portfolio/execution.ts'
import {
  closeOwner,
  FIXTURE_IDS,
  FixtureExecutionStatePort,
  TEST_EXPIRY,
  TEST_NOW,
  makeAggregateLineage,
  makeApprovedApproval,
  makeApprovalBinding,
  makeCorporateActionEvidence,
  makeIntegrityHash,
  makeOwnerWithPortfolio,
  makePendingApproval,
  money,
  rate,
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

test('approval service approves the full basket and persists evidence once', async () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Approval')
  try {
    const state = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      aggregate: makeAggregateLineage(),
    })
    const service = new ApprovalService(state, owner.executionUnitOfWork, {
      now: () => TEST_NOW,
      today: () => makeApprovalBinding().executionDate,
    })
    const pending = makePendingApproval()
    const decided = await service.decide({
      pending,
      binding: makeApprovalBinding(),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(decided.ok, true)
    if (!decided.ok) return
    assert.equal(decided.value.value.state, 'APPROVED')
    assert.equal(decided.value.postCommitEvidence.length, 1)
    const persisted = must(owner.executionUnitOfWork.execute((transaction) =>
      transaction.approvals.getById(pending.approvalId)))
    assert.equal(persisted.value?.state, 'APPROVED')

    const replay = await service.decide({
      pending,
      binding: makeApprovalBinding(),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(replay.ok, true)
    if (replay.ok) {
      assert.equal(replay.value.value.approvalId, decided.value.value.approvalId)
    }
  } finally {
    closeOwner(owner)
  }
})

test('approval service enforces mandatory subset membership', async () => {
  const { owner } = makeOwnerWithPortfolio('u05-subset', 'U05 Approval Subset')
  try {
    const state = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      aggregate: makeAggregateLineage(),
    })

    const service = new ApprovalService(state, owner.executionUnitOfWork, {
      now: () => TEST_NOW,
      today: () => makeApprovalBinding().executionDate,
    })
    const result = await service.decide({
      pending: makePendingApproval({
        approvalId: FIXTURE_IDS.secondApprovalId,
      }),
      binding: makeApprovalBinding({
        approvedLogicalOrderKeys: Object.freeze([]),
        priceBoundsByOrder: Object.freeze([]),
      }),
      decisionKind: 'APPROVE_SUBSET',
      mandatoryLogicalOrderKeys: Object.freeze([makeApprovalBinding().approvedLogicalOrderKeys[0]!]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'APPROVAL_SCOPE_INVALID')
    }
  } finally {
    closeOwner(owner)
  }
})

test('approval service requires an exact key match between basket scope and price bounds', async () => {
  const { owner } = makeOwnerWithPortfolio('u05-bound-keys', 'U05 Approval Bound Keys')
  try {
    const state = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      aggregate: makeAggregateLineage(),
    })

    const service = new ApprovalService(state, owner.executionUnitOfWork, {
      now: () => TEST_NOW,
      today: () => makeApprovalBinding().executionDate,
    })
    const binding = makeApprovalBinding()
    const mismatched = await service.decide({
      pending: makePendingApproval({ approvalId: FIXTURE_IDS.secondApprovalId }),
      binding: makeApprovalBinding({
        priceBoundsByOrder: Object.freeze([
          binding.priceBoundsByOrder[0]!,
          Object.freeze({
            ...binding.priceBoundsByOrder[1]!,
            logicalOrderKey: makeIntegrityHash('unapproved-price-bound-key'),
          }),
        ]),
      }),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(mismatched.ok, false)
    if (!mismatched.ok) {
      assert.equal(mismatched.error.code, 'APPROVAL_BINDING_INCOMPLETE')
    }
  } finally {
    closeOwner(owner)
  }
})

test('approval service rejects price bounds widened beyond the current plan and policy', async () => {
  const { owner } = makeOwnerWithPortfolio('u05-widened-bounds', 'U05 Widened Bounds')
  try {
    const service = new ApprovalService(
      new FixtureExecutionStatePort({
        accounting: loadAccounting(owner),
        aggregate: makeAggregateLineage(),
      }),
      owner.executionUnitOfWork,
      { now: () => TEST_NOW, today: () => makeApprovalBinding().executionDate },
    )
    const binding = makeApprovalBinding()
    const widened = await service.decide({
      pending: makePendingApproval({ approvalId: FIXTURE_IDS.secondApprovalId }),
      binding: makeApprovalBinding({
        priceBoundsByOrder: Object.freeze(binding.priceBoundsByOrder.map(
          (bound) => Object.freeze({ ...bound, maximumDeviation: rate(100_000n) }),
        )),
      }),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(widened.ok, false)
    if (!widened.ok) assert.equal(widened.error.code, 'APPROVAL_BINDING_INCOMPLETE')
  } finally {
    closeOwner(owner)
  }
})

test('approval service fails closed when corporate actions or stale bindings exist', async () => {
  const { owner } = makeOwnerWithPortfolio('u05-stale', 'U05 Approval Stale')
  try {
    const staleState = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      corporateActions: makeCorporateActionEvidence({
        pendingActions: Object.freeze([Object.freeze({ actionId: 'ca:test' }) as never]),
      }),
      aggregate: makeAggregateLineage(),
    })
    const service = new ApprovalService(staleState, owner.executionUnitOfWork, {
      now: () => TEST_NOW,
      today: () => makeApprovalBinding().executionDate,
    })
    const stale = await service.decide({
      pending: makePendingApproval({
        approvalId: FIXTURE_IDS.secondApprovalId,
      }),
      binding: makeApprovalBinding(),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.error.code, 'APPROVAL_STALE')

    const expiredState = new FixtureExecutionStatePort({
      accounting: loadAccounting(owner),
      aggregate: makeAggregateLineage(),
    })
    const expiredService = new ApprovalService(expiredState, owner.executionUnitOfWork, {
      now: () => TEST_EXPIRY,
      today: () => makeApprovalBinding().executionDate,
    })
    const expired = await expiredService.decide({
      pending: makePendingApproval({
        approvalId: FIXTURE_IDS.secondApprovalId,
        idempotencyKey: FIXTURE_IDS.idempotencyKey,
      }),
      binding: makeApprovalBinding({ expiresAt: TEST_NOW }),
      decisionKind: 'APPROVE_BASKET',
      mandatoryLogicalOrderKeys: Object.freeze([]),
      mode: 'PAPER',
      timeoutMs: 5_000,
    })
    assert.equal(expired.ok, false)
    if (!expired.ok) {
      assert.equal(expired.error.code, 'APPROVAL_BINDING_INCOMPLETE')
    }
  } finally {
    closeOwner(owner)
  }
})
