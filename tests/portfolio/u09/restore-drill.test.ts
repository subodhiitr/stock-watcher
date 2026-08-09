import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { parsePortfolioId } from '../../../server/portfolio/index.ts'
import {
  createTemporaryDatabasePath,
  makePortfolio,
  must,
  openTestOwner,
  removeTemporaryDirectory,
} from '../persistence/support.ts'

test('U09 restore drill verifies schema, exact state, strategy seeds, audit, and source preservation', async () => {
  const temporary = createTemporaryDatabasePath()
  const backupPath = path.join(temporary.directory, 'verified-backup.db')
  let source: ReturnType<typeof openTestOwner> | undefined
  let restored: ReturnType<typeof openTestOwner> | undefined
  try {
    source = openTestOwner(temporary.databasePath)
    const transition = makePortfolio('u09-restore', 'U09 Restore Portfolio')
    const committed = source.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(transition.state)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(transition.events)
    })
    assert.equal(committed.ok, true)
    const receipt = must(await source.backupTo(backupPath))
    assert.equal(receipt.schemaVersion, 10)
    assert.ok(receipt.verifiedEventStreams >= 2)
    must(source.close())
    source = undefined
    const sourceBytes = fs.statSync(temporary.databasePath).size

    restored = openTestOwner(backupPath)
    const health = must(restored.health())
    assert.equal(health.schemaVersion, 10)
    assert.equal(health.operationsAuditValid, true)
    assert.ok(health.verifiedEventStreams >= 2)
    const strategies = restored.apiStore.listStrategyOptions()
    assert.equal(strategies.length, 4)
    assert.ok(strategies.some((item) => item.strategyVersionId === 'strategy-version:adaptive-momentum-quality:v2-strategic'))
    const portfolioId = must(parsePortfolioId('portfolio:test:u09-restore'))
    const loaded = must(restored.portfolios.getById(portfolioId))
    assert.equal(loaded?.snapshot().name.display, 'U09 Restore Portfolio')
    assert.equal(loaded?.snapshot().cash.minorUnits, 100_000_000n)
    must(restored.close())

    assert.equal(fs.statSync(temporary.databasePath).size, sourceBytes)
    assert.notEqual(fs.realpathSync(temporary.databasePath), fs.realpathSync(backupPath))
  } finally {
    restored?.close()
    source?.close()
    removeTemporaryDirectory(temporary.directory)
  }
})
