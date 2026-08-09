import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'

import {
  TemporaryTestEncryptionAttestation,
  openPortfolioDatabase,
  parseInstant,
} from '../../../server/portfolio/index.ts'
import { INITIAL_SCHEMA_MIGRATION } from '../../../server/portfolio/infrastructure/persistence/migrations/001-initial-schema.ts'
import {
  createTemporaryDatabasePath,
  must,
  openTestOwner,
  removeTemporaryDirectory,
  temporaryConfiguration,
} from './support.ts'

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const portfolioRoot = path.join(workspaceRoot, 'server', 'portfolio')

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(absolute)
      : entry.name.endsWith('.ts')
        ? [absolute]
        : []
  })
}

test('persistence adapters do not import the public barrel or legacy trading modules', () => {
  const persistenceFiles = [
    ...sourceFiles(path.join(portfolioRoot, 'adapters', 'persistence')),
    ...sourceFiles(path.join(portfolioRoot, 'infrastructure', 'persistence')),
  ]
  for (const file of persistenceFiles) {
    const source = fs.readFileSync(file, 'utf8')
    assert.equal(source.includes("../../index.ts"), false, file)
    assert.equal(source.includes('stock-watcher.db'), false, file)
    for (const legacy of ['ticker_proxy', 'simulation_engine', 'dashboard-app']) {
      assert.equal(source.includes(legacy), false, `${file} imports ${legacy}`)
    }
  }
})

test('database construction is confined to the owner and schema protects audit facts', () => {
  const files = sourceFiles(portfolioRoot)
  const constructors = files.filter((file) =>
    /\bnew Database\s*\(/u.test(fs.readFileSync(file, 'utf8')))
  assert.deepEqual(constructors, [
    path.join(
      portfolioRoot,
      'infrastructure',
      'persistence',
      'database-owner.ts',
    ),
  ])
  assert.match(INITIAL_SCHEMA_MIGRATION.upSql, /domain_events_no_update/u)
  assert.match(INITIAL_SCHEMA_MIGRATION.upSql, /domain_events_no_delete/u)
  assert.match(INITIAL_SCHEMA_MIGRATION.checksum, /^[a-f0-9]{64}$/u)
})

test('protected legacy paths are rejected before SQLite opens them', () => {
  const now = must(parseInstant('2026-01-01T00:00:00.000Z'))
  const configuration = {
    ...temporaryConfiguration('C:\\data\\project\\stock-watcher\\stock-watcher.db'),
    protectedLegacyPaths: ['C:\\data\\project\\stock-watcher\\stock-watcher.db'],
    encryptionAttestation: new TemporaryTestEncryptionAttestation(now),
  }
  const result = openPortfolioDatabase(configuration)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'PROTECTED_DATABASE_PATH')
})

test('critical repository and event-head queries use indexes', () => {
  const temporary = createTemporaryDatabasePath()
  try {
    const owner = openTestOwner(temporary.databasePath)
    must(owner.close())
    const database = new Database(temporary.databasePath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const allocationPlan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM portfolio_allocations
        WHERE portfolio_id = ? AND is_current = 1
      `).all('portfolio:paper-default') as { detail: string }[]
      const eventHeadPlan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT stream_sequence, event_hash
        FROM domain_events
        WHERE stream_key = ?
        ORDER BY stream_sequence DESC
        LIMIT 1
      `).all('portfolio:portfolio:paper-default') as { detail: string }[]
      assert.match(
        allocationPlan.map((row) => row.detail).join(' '),
        /portfolio_current_allocation_uq/u,
      )
      assert.match(
        eventHeadPlan.map((row) => row.detail).join(' '),
        /INDEX/u,
      )
    } finally {
      database.close()
    }
  } finally {
    removeTemporaryDirectory(temporary.directory)
  }
})
