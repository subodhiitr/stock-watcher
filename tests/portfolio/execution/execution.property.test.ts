import assert from 'node:assert/strict'
import test from 'node:test'

import fc from 'fast-check'

import type { ExecutionOrderSnapshot } from '../../../server/portfolio/domain/execution/execution-order.ts'
import { applyFillProgress, recordIntent } from '../../../server/portfolio/domain/execution/execution-order.ts'
import { canonicalExecutionJson, hashExecutionValue } from '../../../server/portfolio/domain/execution/canonical-codec.ts'
import {
  REPLAY_SEEDS,
  identifierArbitrary,
  invalidFillArbitrary,
  linkedValidFillSequenceArbitrary,
  reconciliationSnapshotPairArbitrary,
} from './support/arbitraries.ts'
import { oracleAccountForFills, oracleCompareReconciliation, oracleReplayFilledQuantity } from './support/execution-oracle.ts'
import { TEST_NOW, makeExecutionOrder, makeOrderIntent, quantity } from './support/fixtures.ts'

const REGRESSION_FILL_FIXTURE = Object.freeze({
  order: Object.freeze({
    ...makeExecutionOrder(),
    approvedQuantityCeiling: quantity(6n),
    intent: makeOrderIntent({ quantity: quantity(6n) }),
    state: 'ACKNOWLEDGED' as const,
  }),
})

test('property: canonical hashes stay stable for equivalent identifier payload permutations', () => {
  fc.assert(fc.property(identifierArbitrary, identifierArbitrary, (left, right) => {
    const a = canonicalExecutionJson({ left, right, at: TEST_NOW })
    const b = canonicalExecutionJson({ right, at: TEST_NOW, left })
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    if (a.ok && b.ok) assert.equal(a.value, b.value)
    const hashA = hashExecutionValue('approval-decision', { left, right })
    const hashB = hashExecutionValue('approval-decision', { right, left })
    assert.equal(hashA.ok, true)
    assert.equal(hashB.ok, true)
  }), { numRuns: 75, seed: REPLAY_SEEDS[0]!.seed })
})

test('property: fill replay totals and accounting remain permutation invariant against the oracle', () => {
  fc.assert(fc.property(linkedValidFillSequenceArbitrary, (sample) => {
    const runtimeBase = Object.freeze({
      ...sample.order,
      intent: makeOrderIntent({ quantity: sample.order.approvedQuantityCeiling }),
    })
    const oracle = oracleAccountForFills(runtimeBase, sample.fills)
    let runtime: ExecutionOrderSnapshot = runtimeBase
    let cumulative = 0n
    for (const fill of sample.fills) {
      cumulative += fill.quantity.shares
      const applied = applyFillProgress(runtime, fill, quantity(cumulative), runtime.stateVersion + 1)
      assert.equal(applied.ok, true)
      if (!applied.ok) return
      runtime = applied.value
    }
    assert.equal(runtime.filledQuantity.shares, oracle.filledShares)
    assert.equal(oracleReplayFilledQuantity(sample.fills), oracle.filledShares)
  }), { numRuns: 100, seed: REPLAY_SEEDS[1]!.seed })

  const regressionFill = applyFillProgress(
    REGRESSION_FILL_FIXTURE.order,
    makeOrderIntent().quantity.shares ? Object.freeze({
      ...sampleFill(),
      quantity: quantity(6n),
    }) : sampleFill(),
    quantity(6n),
    REGRESSION_FILL_FIXTURE.order.stateVersion + 1,
  )
  assert.equal(regressionFill.ok, true)
})

test('property: invalid fills and reconciliation mismatches fail closed with stable replay hints', () => {
  fc.assert(fc.property(invalidFillArbitrary, reconciliationSnapshotPairArbitrary, (fill, pair) => {
    const overflow = applyFillProgress(
      Object.freeze({
        ...makeExecutionOrder({
          state: 'ACKNOWLEDGED',
          approvedQuantityCeiling: quantity(10n),
        }),
        intent: makeOrderIntent({ quantity: quantity(10n) }),
      }),
      fill,
      fill.quantity,
      2,
    )
    assert.equal(overflow.ok, false)
    const differences = oracleCompareReconciliation(pair.local, pair.external)
    if (
      pair.local.cash.minorUnits !== pair.external.cash.minorUnits
      || pair.local.holdings[0]?.totalQuantity.shares !== pair.external.holdings[0]?.totalQuantity.shares
    ) {
      assert.ok(differences.length >= 1)
    }
  }), { numRuns: 80, seed: REPLAY_SEEDS[2]!.seed })
})

function sampleFill() {
  const order = makeExecutionOrder()
  const intent = makeOrderIntent()
  return Object.freeze({
    fillId: 'fill:regression' as never,
    portfolioId: order.portfolioId,
    orderId: order.orderId,
    executionRunId: order.executionRunId,
    instrumentId: order.instrumentId,
    side: 'SELL' as const,
    product: 'CNC' as const,
    quantity: quantity(1n),
    price: { ...intent.limitPrice },
    charges: { ...intent.limitPrice, minorUnits: 0n },
    tradeTime: TEST_NOW,
    contentHash: intent.planHash,
  })
}
