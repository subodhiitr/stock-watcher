import fc from 'fast-check'

import {
  createMoney,
  createPortfolioStateVersion,
  createQuantity,
  createScaledRate,
  parseIdempotencyKey,
  parseIntegrityHash,
  parseOrderId,
  parsePortfolioId,
  parseStrategyVersionId,
  type ApprovalBinding,
  type ApprovalDecisionSnapshot,
  type ExecutionOrderSnapshot,
  type NormalizedFill,
  type ReconciliationDifference,
  type ReconciliationRunSnapshot,
} from '../../../../server/portfolio/index.ts'
import {
  parseApprovalId,
  parseBrokerAccountBindingId,
  parseExecutionRunId,
  parseFillId,
  parseReconciliationRunId,
  parseReconciliationSnapshotId,
  parseSubmissionAttemptId,
} from '../../../../server/portfolio/domain/shared/identifiers.ts'
import {
  FIXTURE_IDS,
  INSTRUMENT_A,
  INSTRUMENT_B,
  LOGICAL_ORDER_KEY_BUY,
  MAPPING_HASH,
  PLAN_HASH,
  PLAN_INPUT_HASH,
  POLICY_HASH,
  TEST_DATE,
  TEST_EXPIRY,
  TEST_LATER,
  TEST_NOW,
  makeIntegrityHash,
  makeMapping,
  makeReconciliationSnapshot,
  money,
  quantity,
  rate,
} from './fixtures.ts'

function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new TypeError('invalid arbitrary')
  return result.value
}

export const REPLAY_SEEDS = Object.freeze([
  { seed: 50_501, path: '0:0' },
  { seed: 50_502, path: '1:2:0' },
  { seed: 50_503, path: '2:1:1:0' },
])

export const identifierArbitrary = fc
  .tuple(
    fc.constantFrom('portfolio', 'approval', 'run', 'order', 'fill', 'reconciliation'),
    fc.integer({ min: 1, max: 50_000 }),
  )
  .map(([prefix, suffix]) => `${prefix}:arb:${suffix}`)

export const moneyArbitrary = fc.bigInt({ min: 0n, max: 5_000_000_000n })
  .map((minorUnits) => valueOf(createMoney(minorUnits)))

export const quantityArbitrary = fc.bigInt({ min: 0n, max: 10_000n })
  .map((shares) => valueOf(createQuantity(shares)))

export const deviationArbitrary = fc.bigInt({ min: 0n, max: 250_000n })
  .map((ppm) => valueOf(createScaledRate(ppm, 1_000_000n)))

export const approvalBindingArbitrary: fc.Arbitrary<ApprovalBinding> = fc.record({
  executionDay: fc.integer({ min: 1, max: 28 }),
  quantityA: fc.bigInt({ min: 1n, max: 20n }),
  quantityB: fc.bigInt({ min: 1n, max: 20n }),
  quoteAgePpm: fc.bigInt({ min: 0n, max: 100_000n }),
}).map((value) => Object.freeze({
  planHash: PLAN_HASH,
  planInputHash: PLAN_INPUT_HASH,
  strategyVersionId: FIXTURE_IDS.strategyVersionId,
  strategyConfigHash: POLICY_HASH,
  portfolioStateVersion: valueOf(createPortfolioStateVersion(1, true)),
  reconciliationSnapshotId: FIXTURE_IDS.reconciliationSnapshotId,
  quoteSnapshotId: FIXTURE_IDS.quoteSnapshotId,
  approvedLogicalOrderKeys: Object.freeze([LOGICAL_ORDER_KEY_BUY]),
  priceBoundsByOrder: Object.freeze([Object.freeze({
    logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
    referencePrice: money(8_000n + value.quantityA * 10n),
    approvedLimitPrice: money(8_050n + value.quantityB * 10n),
    maximumDeviation: valueOf(createScaledRate(value.quoteAgePpm, 1_000_000n)),
    quoteStaleAfter: TEST_EXPIRY,
  })]),
  executionDate: TEST_DATE,
  windowStart: '09:20',
  windowEnd: '15:15',
  timeZone: 'Asia/Kolkata',
  expiresAt: TEST_EXPIRY,
}))

export const approvalArbitrary: fc.Arbitrary<ApprovalDecisionSnapshot> = fc.record({
  suffix: fc.integer({ min: 1, max: 10_000 }),
  state: fc.constantFrom('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'CONSUMED'),
  binding: fc.option(approvalBindingArbitrary, { nil: undefined }),
}).map((value) => Object.freeze({
  approvalId: valueOf(parseApprovalId(`approval:arb:${value.suffix}`)),
  portfolioId: FIXTURE_IDS.portfolioId,
  rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
  state: value.state,
  decisionKind: value.state === 'PENDING' ? 'REJECT' : 'APPROVE_BASKET',
  decidedBy: FIXTURE_IDS.actorId,
  authorizationEvidenceId: FIXTURE_IDS.evidenceId,
  idempotencyKey: FIXTURE_IDS.idempotencyKey,
  decisionHash: makeIntegrityHash(`approval:${value.suffix}`),
  decidedAt: TEST_NOW,
  stateVersion: value.state === 'PENDING' ? 1 : 2,
  ...(value.binding === undefined ? {} : { binding: value.binding }),
  ...(value.state === 'CONSUMED'
    ? { consumedByExecutionRunId: FIXTURE_IDS.executionRunId }
    : {}),
}))

export const executionOrderArbitrary: fc.Arbitrary<ExecutionOrderSnapshot> = fc.record({
  suffix: fc.integer({ min: 1, max: 10_000 }),
  shares: fc.bigInt({ min: 1n, max: 25n }),
  side: fc.constantFrom('BUY', 'SELL'),
  state: fc.constantFrom('PLANNED', 'INTENT_RECORDED', 'OPEN', 'PARTIALLY_FILLED', 'UNKNOWN'),
}).map((value) => Object.freeze({
  orderId: valueOf(parseOrderId(`order:arb:${value.suffix}`)),
  executionRunId: FIXTURE_IDS.executionRunId,
  portfolioId: FIXTURE_IDS.portfolioId,
  instrumentId: (value.side === 'BUY' ? INSTRUMENT_B : INSTRUMENT_A) as never,
  side: value.side,
  product: 'CNC',
  logicalOrderKey: value.side === 'BUY' ? LOGICAL_ORDER_KEY_BUY : makeIntegrityHash(`sell:${value.suffix}`),
  idempotencyKey: valueOf(parseIdempotencyKey(`idempotency:arb:${value.suffix}`)),
  sequence: 1,
  approvedQuantityCeiling: valueOf(createQuantity(value.shares)),
  state: value.state,
  submissionAttempts: Object.freeze([]),
  fills: Object.freeze([]),
  filledQuantity: quantity(0n),
  cancellations: Object.freeze([]),
  cancellationOutcomes: Object.freeze([]),
  stateVersion: 1,
}))

export const normalizedFillArbitrary: fc.Arbitrary<NormalizedFill> = fc.record({
  suffix: fc.integer({ min: 1, max: 10_000 }),
  shares: fc.bigInt({ min: 1n, max: 20n }),
  price: fc.bigInt({ min: 100n, max: 100_000n }),
  charges: fc.bigInt({ min: 0n, max: 500n }),
  side: fc.constantFrom('BUY', 'SELL'),
}).map((value) => Object.freeze({
  fillId: valueOf(parseFillId(`fill:arb:${value.suffix}`)),
  portfolioId: FIXTURE_IDS.portfolioId,
  orderId: FIXTURE_IDS.orderSellId,
  executionRunId: FIXTURE_IDS.executionRunId,
  instrumentId: (value.side === 'BUY' ? INSTRUMENT_B : INSTRUMENT_A) as never,
  side: value.side,
  product: 'CNC',
  quantity: valueOf(createQuantity(value.shares)),
  price: valueOf(createMoney(value.price)),
  charges: valueOf(createMoney(value.charges)),
  tradeTime: TEST_LATER,
  brokerFillId: `fill:${value.suffix}`,
  contentHash: makeIntegrityHash(`fill-content:${value.suffix}`),
}))

export const linkedValidFillSequenceArbitrary = fc.uniqueArray(
  normalizedFillArbitrary,
  {
    minLength: 1,
    maxLength: 6,
    selector: (fill) => fill.fillId,
  },
).map((fills) => {
  const total = fills.reduce((sum, fill) => sum + fill.quantity.shares, 0n)
  const ceiling = total < 1n ? 1n : total
  const order = Object.freeze({
    orderId: FIXTURE_IDS.orderSellId,
    executionRunId: FIXTURE_IDS.executionRunId,
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId: INSTRUMENT_A as never,
    side: 'SELL' as const,
    product: 'CNC' as const,
    logicalOrderKey: makeIntegrityHash('linked-valid'),
    idempotencyKey: FIXTURE_IDS.idempotencyKey,
    sequence: 1,
    approvedQuantityCeiling: quantity(ceiling),
    state: 'OPEN' as const,
    submissionAttempts: Object.freeze([]),
    fills: Object.freeze([]),
    filledQuantity: quantity(0n),
    cancellations: Object.freeze([]),
    cancellationOutcomes: Object.freeze([]),
    brokerReference: {
      brokerOrderReferenceId: FIXTURE_IDS.brokerReferenceId,
      brokerOrderId: 'arb',
      accountBindingId: FIXTURE_IDS.accountBindingId,
      acknowledgedAt: TEST_NOW,
    },
    stateVersion: 1,
  })
  return Object.freeze({ order, fills })
})

export const invalidFillArbitrary = fc.record({
  suffix: fc.integer({ min: 1, max: 10_000 }),
  overrun: fc.bigInt({ min: 21n, max: 200n }),
}).map((value) => makeNormalizedFillInvalid(value.suffix, value.overrun))

function makeNormalizedFillInvalid(suffix: number, overrun: bigint): NormalizedFill {
  return Object.freeze({
    fillId: valueOf(parseFillId(`fill:invalid:${suffix}`)),
    portfolioId: FIXTURE_IDS.portfolioId,
    orderId: FIXTURE_IDS.orderSellId,
    executionRunId: FIXTURE_IDS.executionRunId,
    instrumentId: INSTRUMENT_A as never,
    side: 'SELL',
    product: 'CNC',
    quantity: quantity(overrun),
    price: money(12_400n),
    charges: money(0n),
    tradeTime: TEST_LATER,
    brokerFillId: `invalid:${suffix}`,
    contentHash: makeIntegrityHash(`invalid-fill:${suffix}`),
  })
}

export const reconciliationDifferenceArbitrary: fc.Arbitrary<ReconciliationDifference> = fc.record({
  kind: fc.constantFrom('EXTERNAL_CHANGE', 'LOCAL_MISSING_FILL', 'VALUE_MISMATCH', 'UNKNOWN_ORDER', 'CASH_ROUNDING'),
  severity: fc.constantFrom('INFO', 'BLOCKING', 'CRITICAL'),
  expected: fc.string({ minLength: 1, maxLength: 16 }),
  actual: fc.string({ minLength: 1, maxLength: 16 }),
}).map((value) => Object.freeze({
  differenceId: makeIntegrityHash(`difference:${value.kind}:${value.expected}:${value.actual}`),
  kind: value.kind,
  severity: value.severity,
  orderId: FIXTURE_IDS.orderSellId,
  instrumentId: INSTRUMENT_A as never,
  expected: value.expected,
  actual: value.actual,
  resolution: value.kind === 'LOCAL_MISSING_FILL' ? 'APPLY_KNOWN_FILL' : 'NONE',
}))

export const reconciliationRunArbitrary: fc.Arbitrary<ReconciliationRunSnapshot> = fc.record({
  suffix: fc.integer({ min: 1, max: 10_000 }),
  state: fc.constantFrom('REQUESTED', 'COLLECTING', 'MATCHED', 'UNKNOWN', 'BLOCKED'),
  differences: fc.array(reconciliationDifferenceArbitrary, { minLength: 0, maxLength: 4 }),
}).map((value) => Object.freeze({
  reconciliationRunId: valueOf(parseReconciliationRunId(`reconciliation-run:arb:${value.suffix}`)),
  portfolioId: FIXTURE_IDS.portfolioId,
  reason: 'AFTER_BUYS',
  state: value.state,
  localSnapshotId: FIXTURE_IDS.reconciliationSnapshotId,
  externalSnapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
  differences: Object.freeze(value.differences),
  startedAt: TEST_NOW,
  snapshotHash: makeIntegrityHash(`reconciliation:${value.suffix}`),
  stateVersion: 1,
  ...((value.state === 'REQUESTED' || value.state === 'COLLECTING')
    ? {}
    : { completedAt: TEST_LATER }),
}))

export const reconciliationSnapshotPairArbitrary = fc.record({
  cashDelta: fc.bigInt({ min: -10_000n, max: 10_000n }),
  quantityDelta: fc.bigInt({ min: -3n, max: 3n }),
}).map((value) => {
  const base = makeReconciliationSnapshot()
  const externalQuantity = base.holdings[0]!.totalQuantity.shares + value.quantityDelta
  return Object.freeze({
    local: base,
    external: makeReconciliationSnapshot({
      source: 'PAPER',
      snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
      cash: money(base.cash.minorUnits + value.cashDelta),
      holdings: Object.freeze([Object.freeze({
        ...base.holdings[0]!,
        totalQuantity: quantity(externalQuantity < 0n ? 0n : externalQuantity),
      })]),
    }),
  })
})
