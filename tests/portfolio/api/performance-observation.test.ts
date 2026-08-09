import assert from 'node:assert/strict'
import test from 'node:test'

import { createPerformanceObservation } from '../../../server/portfolio/application/api/performance-observation.ts'
import type { PerformanceAccountingRecord, PerformanceObservationRecord } from '../../../server/portfolio/ports/api/api-store.ts'

const accounting: PerformanceAccountingRecord = Object.freeze({
  capitalFlows: Object.freeze([
    Object.freeze({ occurredAt: '2026-08-01T00:00:00.000Z', amountMinorUnits: '500000', kind: 'STARTING_CASH' }),
    Object.freeze({ occurredAt: '2026-08-01T01:00:00.000Z', amountMinorUnits: '100000', kind: 'HOLDING_IMPORT' }),
  ]),
  realizedPnlMinorUnits: '5000',
  cumulativeChargesMinorUnits: '500',
  cumulativeTaxMinorUnits: '1000',
})

function observation(input: Readonly<{
  id: string
  observedAt: string
  price: bigint
  benchmark: bigint
  history?: readonly PerformanceObservationRecord[]
  accountingOverride?: PerformanceAccountingRecord
}>) {
  return createPerformanceObservation({
    observationId: input.id,
    portfolioId: 'portfolio:test',
    observedAt: input.observedAt,
    observationDate: input.observedAt.slice(0, 10),
    portfolioStateVersion: 2,
    cashMinorUnits: 500000n,
    benchmarkSymbol: '^CRSLDX',
    benchmarkPriceMinorUnits: input.benchmark,
    holdings: Object.freeze([Object.freeze({
      instrumentId: 'NSE:TEST', quantity: 10n, costBasisMinorUnits: 100000n,
      priceMinorUnits: input.price, previousCloseMinorUnits: 11000n,
    })]),
    accounting: input.accountingOverride ?? accounting,
    history: input.history ?? Object.freeze([]),
    createdBy: 'actor:test',
  })
}

test('creates the initial NAV, P/L, benchmark, tax, and attribution baseline', () => {
  const first = observation({ id: 'performance:first', observedAt: '2026-08-08T10:00:00.000Z', price: 12000n, benchmark: 10000n })
  assert.equal(first.navMinorUnits, '620000')
  assert.equal(first.netPnlMinorUnits, '20000')
  assert.equal(first.unrealizedPnlMinorUnits, '20000')
  assert.equal(first.realizedPnlMinorUnits, '5000')
  assert.equal(first.cumulativeChargesMinorUnits, '500')
  assert.equal(first.cumulativeTaxMinorUnits, '1000')
  assert.equal(first.totalReturnPpm, 33333)
  assert.equal(first.attribution[0]?.weightPpm, 193548)
})

test('chains flow-adjusted returns and benchmark-relative drawdown', () => {
  const first = observation({ id: 'performance:first', observedAt: '2026-08-08T10:00:00.000Z', price: 12000n, benchmark: 10000n })
  const second = observation({ id: 'performance:second', observedAt: '2026-08-09T10:00:00.000Z', price: 13000n, benchmark: 10200n, history: [first] })
  const third = observation({ id: 'performance:third', observedAt: '2026-08-10T10:00:00.000Z', price: 11000n, benchmark: 10100n, history: [first, second] })
  assert.equal(second.dayReturnPpm, 16129)
  assert.equal(second.benchmarkTotalReturnPpm, 20000)
  assert.ok(third.drawdownPpm < 0)
  assert.ok(third.annualizedVolatilityPpm > 0)
})

test('removes imported capital from the period return', () => {
  const firstAccounting: PerformanceAccountingRecord = Object.freeze({
    ...accounting,
    capitalFlows: Object.freeze([accounting.capitalFlows[0]!]),
  })
  const first = observation({ id: 'performance:first', observedAt: '2026-08-08T10:00:00.000Z', price: 12000n, benchmark: 10000n, accountingOverride: firstAccounting })
  const nextAccounting: PerformanceAccountingRecord = Object.freeze({
    ...accounting,
    capitalFlows: Object.freeze([
      accounting.capitalFlows[0]!,
      Object.freeze({ occurredAt: '2026-08-09T09:00:00.000Z', amountMinorUnits: '100000', kind: 'HOLDING_IMPORT' }),
    ]),
  })
  const second = createPerformanceObservation({
    observationId: 'performance:second', portfolioId: 'portfolio:test',
    observedAt: '2026-08-09T10:00:00.000Z', observationDate: '2026-08-09', portfolioStateVersion: 3,
    cashMinorUnits: 600000n, benchmarkSymbol: '^CRSLDX', benchmarkPriceMinorUnits: 10000n,
    holdings: first.attribution.map((item) => Object.freeze({
      instrumentId: item.instrumentId, quantity: BigInt(item.quantity), costBasisMinorUnits: BigInt(item.investedCostMinorUnits),
      priceMinorUnits: 12000n, previousCloseMinorUnits: 12000n,
    })),
    accounting: nextAccounting, history: [first], createdBy: 'actor:test',
  })
  assert.equal(second.dayReturnPpm, 0)
})
