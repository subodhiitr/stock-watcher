import assert from 'node:assert/strict'
import test from 'node:test'
import fc from 'fast-check'

import {
  createMoney,
  createQuantity,
  createScaledRate,
  createWeight,
  moneyEquals,
  parseMoney,
  parseQuantity,
  parseScaledRate,
  parseWeight,
  scaledRateEquals,
  serializeMoney,
  serializeQuantity,
  serializeScaledRate,
  serializeWeight,
} from '../../server/portfolio/index.ts'
import {
  must,
  nonNegativeMinorUnitsArbitrary,
} from './support/arbitraries.ts'

test('PBT exact Money round-trips for at least 1,000 generated values', () => {
  fc.assert(
    fc.property(nonNegativeMinorUnitsArbitrary, (minorUnits) => {
      const money = must(createMoney(minorUnits))
      assert.ok(moneyEquals(must(parseMoney(serializeMoney(money))), money))
    }),
    { numRuns: 1_000 },
  )
})

test('PBT Quantity and Weight codecs preserve exact integer boundaries', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 10_000_000_000n }),
      fc.bigInt({ min: 0n, max: 1_000_000n }),
      (shares, partsPerMillion) => {
        const quantity = must(createQuantity(shares))
        const weight = must(createWeight(partsPerMillion))
        assert.deepEqual(must(parseQuantity(serializeQuantity(quantity))), quantity)
        assert.deepEqual(must(parseWeight(serializeWeight(weight))), weight)
      },
    ),
    { numRuns: 1_000 },
  )
})

test('PBT ScaledRate codec preserves normalized value', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }),
      fc.bigInt({ min: 1n, max: 1_000_000n }),
      (numerator, scale) => {
        const rate = must(createScaledRate(numerator, scale))
        const parsed = must(parseScaledRate(serializeScaledRate(rate)))
        assert.ok(scaledRateEquals(parsed, rate))
      },
    ),
    { numRuns: 1_000 },
  )
})
