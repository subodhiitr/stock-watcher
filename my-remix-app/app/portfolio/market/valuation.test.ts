import assert from 'node:assert/strict'
import test from 'node:test'

import type { PortfolioView } from '../types/views.ts'
import {
  buildPortfolioValuation,
  portfolioQuoteSymbols,
  quoteSymbolForInstrument,
} from './valuation.ts'
import { groupPortfolioLots } from './lot-groups.ts'

function view(): PortfolioView {
  return Object.freeze({
    portfolio: Object.freeze({
      portfolio_id: 'portfolio:test',
      display_name: 'Test',
      status: 'ACTIVE',
      operating_mode: 'PAPER',
      cash_minor_units: '500000',
      state_version: 2,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-08T00:00:00.000Z',
    }),
    holdings: Object.freeze([Object.freeze({
      holding_id: 'holding:one',
      instrument_id: 'NSE:RELIANCE',
      total_quantity: '10',
      available_delivery_quantity: '10',
      reserved_quantity: '0',
      state_version: 2,
    })]),
    lots: Object.freeze([Object.freeze({
      lot_id: 'lot:one',
      holding_id: 'holding:one',
      instrument_id: 'NSE:RELIANCE',
      acquired_on: '2026-08-01',
      open_quantity: '10',
      unit_cost_minor_units: '10000',
      source_kind: 'IMPORT',
    })]),
    strategy: Object.freeze([]),
    portfolioSnapshot: Object.freeze({ stateVersion: 2, holdingsIncluded: 1, lotsIncluded: 1, asOf: '2026-08-08T00:00:00.000Z' }),
    rebalance: Object.freeze({ plans: Object.freeze([]), status: 'NO_PLAN', blockers: Object.freeze(['PLANNING_SNAPSHOT_NOT_CONNECTED']) }),
    performance: Object.freeze({ observations: Object.freeze([]), attribution: Object.freeze([]), observationCount: 0, status: 'NO_OBSERVATIONS' }),
    execution: Object.freeze([]),
    reconciliation: Object.freeze([]),
  })
}

test('normalizes NSE portfolio instruments for the Yahoo quote endpoint', () => {
  assert.equal(quoteSymbolForInstrument('NSE:RELIANCE'), 'RELIANCE')
  assert.equal(quoteSymbolForInstrument('reliance.ns'), 'RELIANCE')
  assert.equal(quoteSymbolForInstrument('BSE:500325'), undefined)
  assert.deepEqual(portfolioQuoteSymbols(view()), ['RELIANCE'])
})

test('calculates exact cost, market value, unrealized P/L, and day P/L', () => {
  const valuation = buildPortfolioValuation(view(), {
    RELIANCE: Object.freeze({
      symbol: 'RELIANCE',
      price: 120,
      prevClose: 110,
      change: 9.09,
      high52: 150,
      low52: 90,
      volume: 123456,
      open: 112,
      marketState: 'REGULAR',
    }),
  })
  assert.equal(valuation.investedMinorUnits, 100000n)
  assert.equal(valuation.marketValueMinorUnits, 120000n)
  assert.equal(valuation.unrealizedPnlMinorUnits, 20000n)
  assert.equal(valuation.dayPnlMinorUnits, 10000n)
  assert.equal(valuation.complete, true)
  assert.equal(valuation.holdings[0]?.averageCostMinorUnits, 10000n)
})

test('fails closed when a holding has no usable quote', () => {
  const valuation = buildPortfolioValuation(view(), {})
  assert.equal(valuation.complete, false)
  assert.equal(valuation.quotedHoldings, 0)
  assert.equal(valuation.holdings[0]?.marketValueMinorUnits, undefined)
})

test('consolidates matching fills without losing their audit references', () => {
  const groups = groupPortfolioLots([
    Object.freeze({ lot_id: 'lot:one', instrument_id: 'NSE:HFCL', acquired_on: '2026-08-08', open_quantity: '125', unit_cost_minor_units: '20798', source_kind: 'FILL', source_reference_id: 'paper-plan:one' }),
    Object.freeze({ lot_id: 'lot:two', instrument_id: 'NSE:HFCL', acquired_on: '2026-08-08', open_quantity: '107', unit_cost_minor_units: '20798', source_kind: 'FILL', source_reference_id: 'paper-plan:two' }),
    Object.freeze({ lot_id: 'lot:three', instrument_id: 'NSE:HFCL', acquired_on: '2026-08-08', open_quantity: '5', unit_cost_minor_units: '21000', source_kind: 'FILL', source_reference_id: 'paper-plan:three' }),
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0]?.openQuantity, 232n)
  assert.equal(groups[0]?.lotCount, 2)
  assert.deepEqual(groups[0]?.sourceReferenceIds, ['paper-plan:one', 'paper-plan:two'])
  assert.equal(groups[1]?.openQuantity, 5n)
})
