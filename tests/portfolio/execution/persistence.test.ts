import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'

import { openPortfolioDatabase } from '../../../server/portfolio/index.ts'
import { EXECUTION_SCHEMA_MIGRATION } from '../../../server/portfolio/infrastructure/persistence/migrations/002-execution-schema.ts'
import {
  decodeExecutionApproval,
  encodeExecutionApproval,
} from '../../../server/portfolio/adapters/persistence/execution-codecs.ts'
import { verifyExecutionEventChains } from '../../../server/portfolio/adapters/persistence/execution-event-ledger.ts'
import {
  createTemporaryDatabasePath,
  makePortfolio,
  must,
  removeTemporaryDirectory,
  temporaryConfiguration,
} from '../persistence/support.ts'
import {
  FIXTURE_IDS,
  makeApprovalEvidence,
  makeApprovedApproval,
  makeOwnerWithPortfolio,
} from './support/fixtures.ts'

test('migration 002 creates execution schema tables indexes and immutable triggers', () => {
  assert.match(EXECUTION_SCHEMA_MIGRATION.upSql, /execution_approvals/u)
  assert.match(EXECUTION_SCHEMA_MIGRATION.upSql, /execution_runs/u)
  assert.match(EXECUTION_SCHEMA_MIGRATION.upSql, /execution_orders/u)
  assert.match(EXECUTION_SCHEMA_MIGRATION.upSql, /execution_domain_events/u)
  assert.match(EXECUTION_SCHEMA_MIGRATION.upSql, /execution_fills_no_update/u)
  assert.match(EXECUTION_SCHEMA_MIGRATION.checksum, /^[a-f0-9]{64}$/u)
})

test('execution persistence codecs and backup fingerprint round trip on a real temporary sqlite database', async () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const owner = must(openPortfolioDatabase(temporaryConfiguration(temporary.databasePath)))
    const portfolio = makePortfolio('u05', 'U05 Persistence Temp')
    const portfolioInserted = owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(portfolio.state)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(portfolio.events)
    })
    assert.equal(portfolioInserted.ok, true)
    const approvalInserted = owner.executionUnitOfWork.execute((transaction) => {
      const approval = makeApprovedApproval()
      const inserted = transaction.approvals.insert(approval)
      if (!inserted.ok) return inserted
      return transaction.stageEvidence([makeApprovalEvidence(approval)])
    })
    assert.equal(approvalInserted.ok, true)
    const encoded = encodeExecutionApproval(makeApprovedApproval())
    const decoded = decodeExecutionApproval(encoded)
    assert.equal(decoded.ok, true)
    if (decoded.ok) assert.equal(decoded.value.approvalId, FIXTURE_IDS.approvalId)

    const health = owner.health()
    assert.equal(health.ok, true)
    const backup = await owner.backupTo(`${temporary.databasePath}.execution.backup`)
    assert.equal(backup.ok, true)
    if (backup.ok) assert.ok(backup.value.verifiedEventStreams >= 1)
    must(owner.close())

    const database = new Database(temporary.databasePath, { readonly: true, fileMustExist: true })
    try {
      const orderLookupPlan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT canonical_payload
        FROM execution_orders
        WHERE broker_order_reference_id = ?
      `).all('broker-ref') as { detail: string }[]
      assert.match(orderLookupPlan.map((row) => row.detail).join(' '), /INDEX/u)
      const chains = verifyExecutionEventChains(database)
      assert.equal(chains.ok, true)
    } finally {
      database.close()
    }
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})

test('execution unit of work rolls back aggregate writes without matching execution evidence', () => {
  const { owner } = makeOwnerWithPortfolio('u05', 'U05 Persistence Mismatch')
  try {
    const result = owner.executionUnitOfWork.execute((transaction) =>
      transaction.approvals.insert(makeApprovedApproval({ approvalId: FIXTURE_IDS.secondApprovalId })))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'PERSISTED_EVENT_MISMATCH')
  } finally {
    must(owner.close())
  }
})
