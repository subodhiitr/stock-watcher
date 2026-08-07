import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'
import fc from 'fast-check'

import { createMoney, createQuantity, createWeight } from '../../../server/portfolio/index.ts'
import { failure, parsePortfolioId } from '../../../server/portfolio/index.ts'
import {
  decodeMoney,
  decodeQuantity,
  decodeWeight,
  encodeMoney,
  encodeQuantity,
  encodeWeight,
} from '../../../server/portfolio/adapters/persistence/codecs.ts'
import { persistenceFailure } from '../../../server/portfolio/infrastructure/persistence/failures.ts'
import {
  MIGRATIONS,
  migrateDatabase,
} from '../../../server/portfolio/infrastructure/persistence/migrations/index.ts'
import {
  createTemporaryDatabasePath,
  makePortfolio,
  must,
  openTestOwner,
  removeTemporaryDirectory,
  TEST_INSTANT,
} from './support.ts'

test('exact-value persistence codecs round-trip canonical values', () => {
  fc.assert(fc.property(
    fc.bigInt({ min: 0n, max: 9_000_000_000_000_000n }),
    fc.bigInt({ min: 0n, max: 9_000_000_000_000_000n }),
    fc.bigInt({ min: 0n, max: 1_000_000n }),
    (minorUnits, shares, partsPerMillion) => {
      const money = must(createMoney(minorUnits))
      const quantity = must(createQuantity(shares))
      const weight = must(createWeight(partsPerMillion))
      assert.deepEqual(must(decodeMoney(encodeMoney(money))), money)
      assert.deepEqual(must(decodeQuantity(encodeQuantity(quantity))), quantity)
      assert.deepEqual(must(decodeWeight(encodeWeight(weight))), weight)
    },
  ), { numRuns: 1_000 })
})

test('exact-value decoders reject non-canonical or unsafe storage values', () => {
  fc.assert(fc.property(
    fc.oneof(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      fc.stringMatching(/^0[0-9]+$/),
      fc.stringMatching(/^[0-9]+\.[0-9]+$/),
      fc.stringMatching(/^-[0-9]+$/),
      fc.constant(''),
    ),
    (invalid) => {
      assert.equal(decodeMoney(invalid).ok, false)
      assert.equal(decodeQuantity(invalid).ok, false)
    },
  ), { numRuns: 1_000 })
})

test('generated temporary databases preserve isolation and rollback atomicity', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 1_000_000 }),
    (index) => {
      const owner = openTestOwner()
      try {
        const committed = makePortfolio(`property:${index}`, `Property ${index}`)
        const inserted = owner.unitOfWork.execute((transaction) => {
          const saved = transaction.portfolios.insert(committed.state)
          if (!saved.ok) return saved
          return transaction.appendDomainEvents(committed.events)
        })
        assert.equal(inserted.ok, true)
        assert.ok(must(owner.portfolios.getById(committed.state.portfolioId)))
        assert.ok(must(owner.portfolios.getById(
          must(parsePortfolioId('portfolio:paper-default')),
        )))

        const rolledBack = makePortfolio(
          `property-rollback:${index}`,
          `Property Rollback ${index}`,
        )
        const rollback = owner.unitOfWork.execute((transaction) => {
          const saved = transaction.portfolios.insert(rolledBack.state)
          if (!saved.ok) return saved
          return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
        })
        assert.equal(rollback.ok, false)
        assert.equal(
          must(owner.portfolios.getById(rolledBack.state.portfolioId)),
          undefined,
        )
      } finally {
        must(owner.close())
      }
    },
  ), { numRuns: 500 })
})

test('repeated generated file initialization preserves stable seed identity', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 1_000_000 }),
    () => {
      const temporary = createTemporaryDatabasePath()
      try {
        const first = openTestOwner(temporary.databasePath)
        const firstPortfolio = must(first.portfolios.getById(
          must(parsePortfolioId('portfolio:paper-default')),
        ))
        must(first.close())

        const second = openTestOwner(temporary.databasePath)
        try {
          const secondPortfolio = must(second.portfolios.getById(
            must(parsePortfolioId('portfolio:paper-default')),
          ))
          assert.equal(firstPortfolio?.portfolioId, secondPortfolio?.portfolioId)
          assert.equal(secondPortfolio?.stateVersion, 1)
          assert.equal(must(second.health()).verifiedEventStreams, 1)
        } finally {
          must(second.close())
        }
      } finally {
        removeTemporaryDirectory(temporary.directory)
      }
    },
  ), { numRuns: 50 })
})

test('migration model is idempotent and rejects generated checksum divergence', () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[a-f0-9]{64}$/).filter(
      (checksum) => checksum !== MIGRATIONS[0]?.checksum,
    ),
    (checksum) => {
      const database = new Database(':memory:')
      try {
        assert.equal(must(migrateDatabase(
          database,
          TEST_INSTANT,
          'test',
        )), 2)
        assert.equal(must(migrateDatabase(
          database,
          TEST_INSTANT,
          'test',
        )), 2)
        database.prepare(
          'UPDATE schema_migrations SET checksum = ? WHERE id = 1',
        ).run(checksum)
        const diverged = migrateDatabase(database, TEST_INSTANT, 'test')
        assert.equal(diverged.ok, false)
        if (!diverged.ok) {
          assert.equal(diverged.error.code, 'MIGRATION_HISTORY_DIVERGED')
        }
      } finally {
        database.close()
      }
    },
  ), { numRuns: 500 })
})
