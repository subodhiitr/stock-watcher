import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'

import {
  failure,
  parsePortfolioId,
  type PortfolioTransaction,
} from '../../../server/portfolio/index.ts'
import { persistenceFailure } from '../../../server/portfolio/infrastructure/persistence/failures.ts'
import {
  createTemporaryDatabasePath,
  makePortfolio,
  must,
  openTestOwner,
  removeTemporaryDirectory,
  temporaryConfiguration,
} from './support.ts'

test('rolls aggregate and events back atomically when work fails', () => {
  const owner = openTestOwner()
  try {
    const transition = makePortfolio('rollback', 'Rollback Portfolio')
    const result = owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(transition.state)
      if (!inserted.ok) return inserted
      const appended = transaction.appendDomainEvents(transition.events)
      if (!appended.ok) return appended
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    })

    assert.equal(result.ok, false)
    assert.equal(
      must(owner.portfolios.getById(must(parsePortfolioId('portfolio:test:rollback')))),
      undefined,
    )
    assert.equal(must(owner.health()).verifiedEventStreams, 1)
  } finally {
    must(owner.close())
  }
})

test('rejects aggregate commits without a matching staged domain event', () => {
  const owner = openTestOwner()
  try {
    const transition = makePortfolio('missing-event', 'Missing Event Portfolio')
    const result = owner.unitOfWork.execute((transaction) =>
      transaction.portfolios.insert(transition.state))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'PERSISTED_EVENT_MISMATCH')
    assert.equal(
      must(owner.portfolios.getById(transition.state.portfolioId)),
      undefined,
    )
  } finally {
    must(owner.close())
  }
})

test('rejects stale writes and nested transactions', () => {
  const owner = openTestOwner()
  try {
    const transition = makePortfolio('conflict', 'Conflict Portfolio')
    const inserted = owner.unitOfWork.execute((transaction) => {
      const result = transaction.portfolios.insert(transition.state)
      if (!result.ok) return result
      return transaction.appendDomainEvents(transition.events)
    })

    test('revokes transaction and owner capabilities after their lifetime ends', () => {
      const owner = openTestOwner()
      const transition = makePortfolio('capability', 'Capability Portfolio')
      let captured: PortfolioTransaction | undefined
      const result = owner.unitOfWork.execute((transaction) => {
        captured = transaction
        return { ok: true, value: undefined }
      })
      assert.equal(result.ok, true)
      assert.ok(captured)
      const leakedWrite = captured.portfolios.insert(transition.state)
      assert.equal(leakedWrite.ok, false)
      if (!leakedWrite.ok) {
        assert.equal(leakedWrite.error.code, 'PERSISTENCE_CAPABILITY_LEAK')
      }

      must(owner.close())
      const closedRead = owner.portfolios.getById(transition.state.portfolioId)
      assert.equal(closedRead.ok, false)
      if (!closedRead.ok) assert.equal(closedRead.error.code, 'PERSISTENCE_CAPABILITY_LEAK')
      const closedTransaction = owner.unitOfWork.execute(() => ({
        ok: true,
        value: undefined,
      }))
      assert.equal(closedTransaction.ok, false)
      if (!closedTransaction.ok) assert.equal(closedTransaction.error.code, 'PERSISTENCE_NOT_OPEN')
    })
    assert.equal(inserted.ok, true)

    const conflict = owner.unitOfWork.execute((transaction) =>
      transaction.portfolios.save(transition.state, 0 as never))
    assert.equal(conflict.ok, false)
    if (!conflict.ok) assert.equal(conflict.error.code, 'PERSISTENCE_VERSION_CONFLICT')

    const nested = owner.unitOfWork.execute(() => owner.unitOfWork.execute(() => ({
      ok: true,
      value: undefined,
    })))
    assert.equal(nested.ok, false)
    if (!nested.ok) assert.equal(nested.error.code, 'NESTED_TRANSACTION_FORBIDDEN')
  } finally {
    must(owner.close())
  }
})

test('creates and verifies an owner-mediated backup', async () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const owner = must((await import('../../../server/portfolio/index.ts')).openPortfolioDatabase(
      temporaryConfiguration(temporary.databasePath),
    ))
    const destination = `${temporary.databasePath}.backup`
    const backup = await owner.backupTo(destination)
    assert.equal(backup.ok, true)
    if (backup.ok) assert.equal(backup.value.verifiedEventStreams, 1)
    must(owner.close())

    const restored = must((await import('../../../server/portfolio/index.ts')).openPortfolioDatabase(
      temporaryConfiguration(destination),
    ))
    try {
      assert.equal(must(restored.health()).databaseIntegrity, 'ok')
    } finally {
      must(restored.close())
    }
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})

test('persisted event facts reject updates and deletes', () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const owner = openTestOwner(temporary.databasePath)
    must(owner.close())
    const database = new Database(temporary.databasePath)
    assert.throws(
      () => database.prepare(
        "UPDATE domain_events SET actor_id = 'actor:tampered'",
      ).run(),
      /IMMUTABLE_DOMAIN_EVENT/u,
    )
    assert.throws(
      () => database.prepare('DELETE FROM domain_events').run(),
      /IMMUTABLE_DOMAIN_EVENT/u,
    )
    database.close()
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})
