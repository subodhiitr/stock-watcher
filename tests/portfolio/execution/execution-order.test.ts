import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyFillProgress,
  recordAcknowledged,
  recordDefinitelyNotSent,
  recordIntent,
  recordRejected,
  requestCancellation,
  resolveFromUnknown,
  startSubmission,
} from '../../../server/portfolio/domain/execution/execution-order.ts'
import { FIXTURE_IDS, TEST_LATER, TEST_NOW, makeBrokerReference, makeExecutionOrder, makeNormalizedFill, makeOrderIntent, quantity } from './support/fixtures.ts'

test('order intent recording is idempotent for the same canonical payload', () => {
  const order = makeExecutionOrder()
  const intent = makeOrderIntent()
  const recorded = recordIntent(order, intent, intent.planHash, order.stateVersion + 1)
  assert.equal(recorded.ok, true)
  if (!recorded.ok) return
  assert.equal(recorded.value.state, 'INTENT_RECORDED')
  const replay = recordIntent(recorded.value, intent, intent.planHash, recorded.value.stateVersion + 1)
  assert.equal(replay.ok, true)
  if (replay.ok) assert.equal(replay.value.stateVersion, recorded.value.stateVersion)
})

test('submission definite-not-sent stays retryable while acknowledgement anchors broker reference', () => {
  const intented = recordIntent(makeExecutionOrder(), makeOrderIntent(), makeOrderIntent().planHash, 2)
  assert.equal(intented.ok, true)
  if (!intented.ok) return
  const submitted = startSubmission(intented.value, Object.freeze({
    submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
    attemptNumber: 1,
    intentHash: makeOrderIntent().planHash,
    state: 'SUBMISSION_IN_FLIGHT' as const,
    startedAt: TEST_NOW,
  }), 3)
  assert.equal(submitted.ok, true)
  if (!submitted.ok) return
  const safeRetry = recordDefinitelyNotSent(submitted.value, 4)
  assert.equal(safeRetry.ok, true)
  if (!safeRetry.ok) return
  assert.equal(safeRetry.value.state, 'INTENT_RECORDED')

  const resubmitted = startSubmission(safeRetry.value, Object.freeze({
    submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
    attemptNumber: 2,
    intentHash: makeOrderIntent().planHash,
    state: 'SUBMISSION_IN_FLIGHT' as const,
    startedAt: TEST_LATER,
  }), 5)
  assert.equal(resubmitted.ok, true)
  if (!resubmitted.ok) return
  const acknowledged = recordAcknowledged(resubmitted.value, makeBrokerReference('order:test'), 6)
  assert.equal(acknowledged.ok, true)
  if (acknowledged.ok) {
    assert.equal(acknowledged.value.brokerReference?.brokerOrderId, 'order:test')
  }
})

test('fill progression is monotone and bounded by the approved quantity ceiling', () => {
  const intented = recordIntent(makeExecutionOrder(), makeOrderIntent(), makeOrderIntent().planHash, 2)
  assert.equal(intented.ok, true)
  if (!intented.ok) return
  const submitted = startSubmission(intented.value, Object.freeze({
    submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
    attemptNumber: 1,
    intentHash: makeOrderIntent().planHash,
    state: 'SUBMISSION_IN_FLIGHT' as const,
    startedAt: TEST_NOW,
  }), 3)
  assert.equal(submitted.ok, true)
  if (!submitted.ok) return
  const filledBase = recordAcknowledged(submitted.value, makeBrokerReference('fill:test'), 4)
  assert.equal(filledBase.ok, true)
  if (!filledBase.ok) return
  const openOrder = Object.freeze({ ...filledBase.value, intent: makeOrderIntent() })
  const firstFill = applyFillProgress(openOrder, makeNormalizedFill({ quantity: quantity(4n) }), quantity(4n), 5)
  assert.equal(firstFill.ok, true)
  if (!firstFill.ok) return
  assert.equal(firstFill.value.state, 'PARTIALLY_FILLED')

  const overflow = applyFillProgress(firstFill.value, makeNormalizedFill({ fillId: FIXTURE_IDS.fillTwoId, quantity: quantity(7n) }), quantity(11n), 6)
  assert.equal(overflow.ok, false)
  const completed = applyFillProgress(firstFill.value, makeNormalizedFill({ fillId: FIXTURE_IDS.fillTwoId, quantity: quantity(6n) }), quantity(10n), 6)
  assert.equal(completed.ok, true)
  if (completed.ok) assert.equal(completed.value.state, 'FILLED')
})

test('unknown orders can resolve only through allowed reconciliation outcomes and cancellations are scoped', () => {
  const pending = requestCancellation(
    Object.freeze({
      ...makeExecutionOrder({
        state: 'ACKNOWLEDGED',
        brokerReference: makeBrokerReference('cancel:test'),
      }),
      intent: makeOrderIntent(),
    }),
    Object.freeze({
      cancellationId: FIXTURE_IDS.cancellationId,
      orderId: FIXTURE_IDS.orderSellId,
      idempotencyKey: FIXTURE_IDS.idempotencyKey,
      requestedBy: 'suite',
      reasonCode: 'USER_REQUEST',
      requestedAt: TEST_NOW,
      deadlineAt: TEST_LATER,
    }),
    2,
  )
  assert.equal(pending.ok, true)
  if (pending.ok) assert.equal(pending.value.state, 'CANCEL_PENDING')

  const rejected = recordRejected(
    Object.freeze({
      ...makeExecutionOrder({ state: 'SUBMISSION_IN_FLIGHT' }),
      intent: makeOrderIntent(),
    }),
    'ORDER_REJECTED',
    2,
  )
  assert.equal(rejected.ok, true)
  if (!rejected.ok) return
  const unresolved = resolveFromUnknown(Object.freeze({ ...rejected.value, state: 'UNKNOWN' }), 'FILLED', 3)
  assert.equal(unresolved.ok, true)
  if (unresolved.ok) assert.equal(unresolved.value.state, 'FILLED')
})
