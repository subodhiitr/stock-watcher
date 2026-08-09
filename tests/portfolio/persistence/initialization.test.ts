import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'

import {
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parsePortfolioId,
  createPortfolioStateVersion,
  RejectingEncryptionAttestation,
  openPortfolioDatabase,
} from '../../../server/portfolio/index.ts'
import {
  TEST_INSTANT,
  createTemporaryDatabasePath,
  must,
  openTestOwner,
  removeTemporaryDirectory,
  temporaryConfiguration,
} from './support.ts'

test('opens an isolated SQLite owner with hardened settings and stable seeds', () => {
  const owner = openTestOwner()
  try {
    const health = must(owner.health())
    assert.equal(health.databaseIntegrity, 'ok')
    assert.equal(health.foreignKeysEnabled, true)
    assert.equal(health.trustedSchemaDisabled, true)
    assert.equal(health.attachedDatabaseCount, 1)
    assert.equal(health.verifiedEventStreams, 1)

    const portfolio = must(owner.portfolios.getById(
      must(parsePortfolioId('portfolio:paper-default')),
    ))
    assert.ok(portfolio)
    assert.equal(portfolio.snapshot().name.display, 'Paper Portfolio')
    assert.equal(portfolio.cash.minorUnits, 100_000_000n)
    assert.equal(portfolio.mode, 'PAPER')
  } finally {
    must(owner.close())
  }
})

test('reopening does not recreate or reset the stable paper portfolio', () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const owner = openTestOwner(temporary.databasePath)
    const id = must(parsePortfolioId('portfolio:paper-default'))
    const portfolio = must(owner.portfolios.getById(id))
    assert.ok(portfolio)
    const archived = must(portfolio.archive({
      portfolioId: id,
      context: {
        commandId: must(parseCommandId('command:test:archive-seed')),
        actorId: must(parseActorId('actor:test-suite')),
        correlationId: must(parseCorrelationId('correlation:test:archive-seed')),
        causationId: must(parseCausationId('causation:test:archive-seed')),
        effectiveAt: TEST_INSTANT,
        expectedStateVersion: must(createPortfolioStateVersion(1)),
      },
      eventId: must(parseEventId('event:test:archive-seed')),
    }))
    const committed = owner.unitOfWork.execute((transaction) => {
      const saved = transaction.portfolios.save(archived.state, archived.priorStateVersion)
      if (!saved.ok) return saved
      const appended = transaction.appendDomainEvents(archived.events)
      return appended.ok ? { ok: true, value: undefined } : appended
    })
    assert.equal(committed.ok, true)
    must(owner.close())

    const reopened = openTestOwner(temporary.databasePath)
    try {
      assert.equal(must(reopened.portfolios.getById(id))?.status, 'ARCHIVED')
    } finally {
      must(reopened.close())
    }
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})

test('persistent startup fails closed without encryption attestation', () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const configuration = {
      ...temporaryConfiguration(temporary.databasePath),
      mode: 'PERSISTENT' as const,
      encryptionAttestation: new RejectingEncryptionAttestation(),
      now: () => TEST_INSTANT,
    }
    const result = openPortfolioDatabase(configuration)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'ENCRYPTION_AT_REST_REQUIRED')
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})

test('startup detects migration and seed identity tampering', () => {
  const migrationTemporary = createTemporaryDatabasePath()
  try {
    const owner = openTestOwner(migrationTemporary.databasePath)
    must(owner.close())
    const database = new Database(migrationTemporary.databasePath)
    database.prepare(
      "UPDATE schema_migrations SET checksum = ? WHERE id = 1",
    ).run('0'.repeat(64))
    database.close()
    const reopened = openPortfolioDatabase(
      temporaryConfiguration(migrationTemporary.databasePath),
    )
    assert.equal(reopened.ok, false)
    if (!reopened.ok) assert.equal(reopened.error.code, 'MIGRATION_HISTORY_DIVERGED')
  } finally {
    removeTemporaryDirectory(migrationTemporary.directory)
  }

  const seedTemporary = createTemporaryDatabasePath()
  try {
    const owner = openTestOwner(seedTemporary.databasePath)
    must(owner.close())
    const database = new Database(seedTemporary.databasePath)
    database.prepare(`
      UPDATE seed_registry
      SET entity_id = 'portfolio:wrong'
      WHERE seed_key = 'seed:portfolio:paper-default'
    `).run()
    database.close()
    const reopened = openPortfolioDatabase(
      temporaryConfiguration(seedTemporary.databasePath),
    )
    assert.equal(reopened.ok, false)
    if (!reopened.ok) assert.equal(reopened.error.code, 'SEED_IDENTITY_CONFLICT')
  } finally {
    removeTemporaryDirectory(seedTemporary.directory)
  }
})

test('allows only one live owner per file path', () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const first = openTestOwner(temporary.databasePath)
    const duplicate = openPortfolioDatabase(
      temporaryConfiguration(temporary.databasePath),
    )
    assert.equal(duplicate.ok, false)
    if (!duplicate.ok) {
      assert.equal(duplicate.error.code, 'PERSISTENCE_OWNER_REQUIRED')
    }
    must(first.close())

    const reopened = openTestOwner(temporary.databasePath)
    must(reopened.close())
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})
