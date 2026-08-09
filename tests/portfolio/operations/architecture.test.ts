import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as operationsApi from '../../../server/portfolio/operations.ts'
import * as portfolioApi from '../../../server/portfolio/index.ts'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const operationsFiles = [
  'server/portfolio/domain/operations/contracts.ts',
  'server/portfolio/ports/operations/operations-port.ts',
  'server/portfolio/application/operations/job-coordinator.ts',
  'server/portfolio/application/operations/health-service.ts',
  'server/portfolio/application/operations/backup-recovery-service.ts',
  'server/portfolio/application/operations/incident-service.ts',
  'server/portfolio/operations.ts',
]

test('U06 basic runtime stays isolated from legacy, transport, credentials, and concrete storage', () => {
  for (const relative of operationsFiles) {
    const source = fs.readFileSync(path.join(workspaceRoot, relative), 'utf8')
    assert.doesNotMatch(source, /ticker_proxy|simulation_engine|trade-execution|paper-trades/u)
    assert.doesNotMatch(source, /node:(?:fs|http|https|net)|better-sqlite3|process\.env/u)
    assert.doesNotMatch(source, /credential|password|secret/u)
    assert.doesNotMatch(source, /export\s+\*\s+from/u)
  }
})

test('U06 basic public surface uses explicit application and port contracts', () => {
  assert.equal(typeof operationsApi.JobCoordinator, 'function')
  assert.equal(typeof operationsApi.OperationsHealthService, 'function')
  assert.equal(typeof operationsApi.BackupRecoveryService, 'function')
  assert.equal(typeof operationsApi.IncidentService, 'function')
  assert.equal(portfolioApi.JobCoordinator, operationsApi.JobCoordinator)
})
