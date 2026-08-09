import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FULL_WEIGHT,
  addMoney,
  convertScaledRate,
  createMoney,
  createQuantity,
  createScaledRate,
  createWeight,
  moneyEquals,
  parseInstant,
  parseLocalDate,
  parseMoney,
  parsePortfolioId,
  parseQuantity,
  parseScaledRate,
  parseWeight,
  scaledRateEquals,
  serializeMoney,
  serializeQuantity,
  serializeScaledRate,
  serializeWeight,
} from '../../server/portfolio/index.ts'
import { must } from './support/arbitraries.ts'

test('exact financial values round-trip without floating point', () => {
  const money = must(createMoney(123_456_789n))
  const quantity = must(createQuantity(42n))
  const weight = must(createWeight(333_333n))
  const rate = must(createScaledRate(-125n, 10_000n))

  assert.ok(moneyEquals(must(parseMoney(serializeMoney(money))), money))
  assert.deepEqual(must(parseQuantity(serializeQuantity(quantity))), quantity)
  assert.deepEqual(must(parseWeight(serializeWeight(weight))), weight)
  assert.ok(scaledRateEquals(must(parseScaledRate(serializeScaledRate(rate))), rate))
  assert.equal(FULL_WEIGHT.partsPerMillion, 1_000_000n)
})

test('exact values reject unsupported currency, invalid ranges, and inexact conversion', () => {
  assert.equal(createMoney(1n, 'USD').ok, false)
  assert.equal(createQuantity(-1n).ok, false)
  assert.equal(createWeight(1_000_001n).ok, false)
  assert.equal(convertScaledRate(must(createScaledRate(1n, 3n)), 10n).ok, false)
  assert.equal(addMoney(must(createMoney(1n)), must(createMoney(2n))).ok, true)
})

test('identifiers and canonical dates fail closed', () => {
  assert.equal(parsePortfolioId(' portfolio').ok, false)
  assert.equal(parsePortfolioId('portfolio/unsafe').ok, false)
  assert.equal(parseLocalDate('2027-02-29').ok, false)
  assert.equal(parseLocalDate('2028-02-29').ok, true)
  assert.equal(parseInstant('2027-01-01T00:00:00Z').ok, false)
  assert.equal(parseInstant('2027-01-01T00:00:00.000Z').ok, true)
})
