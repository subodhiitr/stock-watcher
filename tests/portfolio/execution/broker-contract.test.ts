import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BrokerResilienceGovernor,
  DeterministicPaperBroker,
  DryRunBroker,
  ImmediatePaperFillPolicy,
  composeTrustedExecutionBroker,
} from '../../../server/portfolio/execution.ts'
import {
  DisabledSharekhanBrokerFacade,
  DisabledZerodhaBrokerFacade,
  normalizeReviewedSharekhanPlacement,
  normalizeReviewedZerodhaPlacement,
} from '../../../server/portfolio/adapters/broker/disabled-live-facades.ts'
import {
  DeterministicClock,
  DeterministicExecutionIds,
  DeterministicSeed,
  FIXTURE_IDS,
  INSTRUMENT_A,
  TEST_LATER,
  TEST_NOW,
  makeOrderIntent,
  makeMapping,
  makeReconciliationSnapshot,
  money,
  quantity,
} from './support/fixtures.ts'
import { ScriptedBroker, makePlacementRequest } from './support/scripted-broker.ts'

async function contractPlacement(name: string, broker: { placeOrder: (request: ReturnType<typeof makePlacementRequest>) => Promise<{ ok: boolean, value?: { certainty: string } }> }) {
  const result = await broker.placeOrder(makePlacementRequest())
  assert.equal(typeof result.ok, 'boolean', `${name} returns a DomainResult`)
  return result
}

test('paper, dry-run, scripted, and disabled brokers satisfy their normalized contracts', async () => {
  const clock = new DeterministicClock()
  const request = makePlacementRequest()

  const paper = new DeterministicPaperBroker(
    clock,
    new DeterministicSeed(100),
    [Object.freeze({
      portfolioId: request.portfolioId,
      accountBindingId: request.accountBindingId,
      cash: money(100_000_000n),
      holdings: Object.freeze([Object.freeze({
        instrumentId: request.intent.instrumentId,
        totalQuantity: quantity(20n),
        availableDeliveryQuantity: quantity(20n),
        reservedQuantity: quantity(0n),
        averageCost: money(11_000n),
        mappingHash: request.intent.mapping.snapshotHash,
      })]),
    })],
    new ImmediatePaperFillPolicy(),
  )
  const paperResult = await contractPlacement('paper', paper)
  assert.equal(paperResult.ok, true)
  if (paperResult.ok) assert.equal(paperResult.value?.certainty, 'ACKNOWLEDGED')

  const dryRun = new DryRunBroker(clock)
  const dryRunResult = await dryRun.placeOrder(request)
  assert.equal(dryRunResult.ok, false)
  assert.equal(dryRun.records().length, 1)

  const scripted = ScriptedBroker.scenario('sell-only', clock)
  const scriptedResult = await contractPlacement('scripted', scripted)
  assert.equal(scriptedResult.ok, true)
  if (scriptedResult.ok) assert.equal(scriptedResult.value?.certainty, 'ACKNOWLEDGED')

  const zerodha = new DisabledZerodhaBrokerFacade()
  const sharekhan = new DisabledSharekhanBrokerFacade()
  const inert = await Promise.all([
    zerodha.placeOrder(request),
    sharekhan.placeOrder(request),
    zerodha.collectReconciliationSnapshot({
      snapshotId: FIXTURE_IDS.reconciliationSnapshotId,
      portfolioId: request.portfolioId,
      accountBindingId: request.accountBindingId,
      deadlineAt: TEST_LATER,
      mappingSnapshotHash: request.intent.mapping.snapshotHash,
    }),
  ])
  assert.deepEqual(inert.map((item) => item.ok), [false, false, false])

  const normalizedZerodha = normalizeReviewedZerodhaPlacement(request, {
    status: 'ACCEPTED',
    brokerOrderId: 'Z-1',
    attemptedAt: TEST_NOW,
    completedAt: TEST_LATER,
  })
  assert.equal(normalizedZerodha.ok, true)
  const normalizedSharekhan = normalizeReviewedSharekhanPlacement(request, 'DELIVERY', {
    status: 'REJECTED',
    attemptedAt: TEST_NOW,
    completedAt: TEST_LATER,
  })
  assert.equal(normalizedSharekhan.ok, true)
})

test('broker resilience and trusted composition fail closed for live and deadline unsafe paths', async () => {
  const clock = new DeterministicClock()
  const timers = {
    schedule: () => ({ ok: true as const, value: { cancel() {}, get done() { return false } } }),
    delay: async () => ({ ok: true as const, value: undefined }),
  }
  const governor = new BrokerResilienceGovernor(
    new ScriptedBroker(clock, {
      place: [{
        ok: false,
        error: { code: 'BROKER_DISCONNECTED', retryability: 'AFTER_STATE_REFRESH' } as never,
      }],
    }) as never,
    clock,
    timers as never,
    new DeterministicSeed(1),
  )
  const safePlacement = await governor.placeOrder(makePlacementRequest({ deadlineAt: TEST_NOW }))
  assert.equal(safePlacement.ok, true)
  if (safePlacement.ok) assert.equal(safePlacement.value.certainty, 'DEFINITELY_NOT_SENT')

  const composedPaper = composeTrustedExecutionBroker('PAPER', {
    paperBroker: ScriptedBroker.scenario('sell-only', clock),
    dryRunBroker: new DryRunBroker(clock),
  })
  assert.equal(composedPaper.ok, true)
  const composedLive = composeTrustedExecutionBroker('LIVE_ZERODHA', {
    paperBroker: ScriptedBroker.scenario('sell-only', clock),
    dryRunBroker: new DryRunBroker(clock),
  })
  assert.equal(composedLive.ok, false)
})

test('paper open buy orders reserve cash and release it on cancellation', async () => {
  const clock = new DeterministicClock()
  const ids = new DeterministicExecutionIds('paper-buy-reservation')
  const firstIntent = makeOrderIntent({
    side: 'BUY',
    quantity: quantity(10n),
    limitPrice: money(12_500n),
  })
  const secondIntent = makeOrderIntent({
    orderId: FIXTURE_IDS.orderBuyId,
    side: 'BUY',
    quantity: quantity(1n),
    limitPrice: money(12_500n),
  })
  const broker = new DeterministicPaperBroker(
    clock,
    new DeterministicSeed(101),
    [Object.freeze({
      portfolioId: firstIntent.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      cash: money(125_000n),
    })],
    { decide: () => Object.freeze({ kind: 'LEAVE_OPEN' as const }) },
  )
  const first = await broker.placeOrder(makePlacementRequest({
    submissionAttemptId: ids.submissionAttemptId(),
    orderId: firstIntent.orderId,
    intent: firstIntent,
  }))
  assert.equal(first.ok, true)
  if (!first.ok || first.value.brokerReference === undefined) return

  const overbooked = await broker.placeOrder(makePlacementRequest({
    submissionAttemptId: ids.submissionAttemptId(),
    orderId: secondIntent.orderId,
    intent: secondIntent,
  }))
  assert.equal(overbooked.ok, true)
  if (overbooked.ok) assert.equal(overbooked.value.certainty, 'REJECTED')

  const reserved = await broker.collectReconciliationSnapshot({
    snapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    deadlineAt: TEST_LATER,
    mappingSnapshotHash: firstIntent.mapping.snapshotHash,
  })
  assert.equal(reserved.ok, true)
  if (reserved.ok) assert.equal(reserved.value.snapshot.cash.minorUnits, 0n)

  const cancelled = await broker.cancelOrder({
    cancellationId: ids.cancellationId(),
    orderId: firstIntent.orderId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    brokerOrderReferenceId: first.value.brokerReference.brokerOrderReferenceId,
    deadlineAt: TEST_LATER,
  })
  assert.equal(cancelled.ok, true)
  const cancelledStatus = await broker.fetchOrderStatus({
    orderId: firstIntent.orderId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    brokerOrderReferenceId: first.value.brokerReference.brokerOrderReferenceId,
    deadlineAt: TEST_LATER,
  })
  assert.equal(cancelledStatus.ok, true)
  if (cancelledStatus.ok) {
    assert.equal(cancelledStatus.value.snapshot.status, 'CANCELLED')
    assert.equal(cancelledStatus.value.snapshot.openQuantity.shares, 0n)
  }
  const released = await broker.collectReconciliationSnapshot({
    snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    deadlineAt: TEST_LATER,
    mappingSnapshotHash: firstIntent.mapping.snapshotHash,
  })
  assert.equal(released.ok, true)
  if (released.ok) {
    assert.equal(released.value.snapshot.cash.minorUnits, 125_000n)
    const cancellationEvidence = released.value.snapshot.openOrders.find((order) =>
      order.brokerReference.brokerOrderReferenceId
        === first.value.brokerReference?.brokerOrderReferenceId)
    assert.equal(cancellationEvidence?.status, 'CANCELLED')
    assert.equal(cancellationEvidence?.openQuantity.shares, 0n)
  }

  const afterRelease = await broker.placeOrder(makePlacementRequest({
    submissionAttemptId: ids.submissionAttemptId(),
    orderId: secondIntent.orderId,
    intent: secondIntent,
  }))
  assert.equal(afterRelease.ok, true)
  if (afterRelease.ok) assert.equal(afterRelease.value.certainty, 'ACKNOWLEDGED')
})

test('paper open sell orders reserve delivery quantity and release it on cancellation', async () => {
  const clock = new DeterministicClock()
  const ids = new DeterministicExecutionIds('paper-sell-reservation')
  const firstIntent = makeOrderIntent({ quantity: quantity(7n) })
  const secondIntent = makeOrderIntent({
    orderId: FIXTURE_IDS.orderBuyId,
    logicalOrderKey: firstIntent.logicalOrderKey,
    instrumentId: INSTRUMENT_A,
    mapping: makeMapping(INSTRUMENT_A),
    quantity: quantity(4n),
  })
  const broker = new DeterministicPaperBroker(
    clock,
    new DeterministicSeed(102),
    [Object.freeze({
      portfolioId: firstIntent.portfolioId,
      accountBindingId: FIXTURE_IDS.accountBindingId,
      cash: money(0n),
      holdings: Object.freeze([Object.freeze({
        instrumentId: INSTRUMENT_A,
        totalQuantity: quantity(10n),
        availableDeliveryQuantity: quantity(10n),
        reservedQuantity: quantity(0n),
        mappingHash: firstIntent.mapping.snapshotHash,
      })]),
    })],
    { decide: () => Object.freeze({ kind: 'LEAVE_OPEN' as const }) },
  )
  const first = await broker.placeOrder(makePlacementRequest({
    submissionAttemptId: ids.submissionAttemptId(),
    orderId: firstIntent.orderId,
    intent: firstIntent,
  }))
  assert.equal(first.ok, true)
  if (!first.ok || first.value.brokerReference === undefined) return
  const overbooked = await broker.placeOrder(makePlacementRequest({
    submissionAttemptId: ids.submissionAttemptId(),
    orderId: secondIntent.orderId,
    intent: secondIntent,
  }))
  assert.equal(overbooked.ok, true)
  if (overbooked.ok) assert.equal(overbooked.value.certainty, 'REJECTED')

  const reserved = await broker.collectReconciliationSnapshot({
    snapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    deadlineAt: TEST_LATER,
    mappingSnapshotHash: firstIntent.mapping.snapshotHash,
  })
  assert.equal(reserved.ok, true)
  if (reserved.ok) {
    assert.equal(reserved.value.snapshot.holdings[0]?.availableDeliveryQuantity.shares, 3n)
    assert.equal(reserved.value.snapshot.holdings[0]?.reservedQuantity.shares, 7n)
  }

  const cancelled = await broker.cancelOrder({
    cancellationId: ids.cancellationId(),
    orderId: firstIntent.orderId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    brokerOrderReferenceId: first.value.brokerReference.brokerOrderReferenceId,
    deadlineAt: TEST_LATER,
  })
  assert.equal(cancelled.ok, true)
  const released = await broker.collectReconciliationSnapshot({
    snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
    portfolioId: firstIntent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    deadlineAt: TEST_LATER,
    mappingSnapshotHash: firstIntent.mapping.snapshotHash,
  })
  assert.equal(released.ok, true)
  if (released.ok) {
    assert.equal(released.value.snapshot.holdings[0]?.availableDeliveryQuantity.shares, 10n)
    assert.equal(released.value.snapshot.holdings[0]?.reservedQuantity.shares, 0n)
  }
})
