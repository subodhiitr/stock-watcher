import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import Database from 'better-sqlite3'

import {
  Portfolio,
  createHolding,
  createHoldingLot,
  createMoney,
  createPortfolioStateVersion,
  createQuantity,
  openPortfolioDatabase,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parseLocalDate,
  parseDomainEvent,
  parsePortfolioId,
} from '../server/portfolio/index.ts'
import { appendDomainEvents } from '../server/portfolio/adapters/persistence/event-ledger.ts'
import { failure } from '../server/portfolio/domain/errors/result.ts'
import { persistenceFailure } from '../server/portfolio/infrastructure/persistence/failures.ts'
import { makePortfolio, must, temporaryConfiguration } from '../tests/portfolio/persistence/support.ts'

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
}

function measure(iterations: number, operation: (index: number) => void): number {
  const durations: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    operation(index)
    durations.push(performance.now() - startedAt)
  }
  return p95(durations)
}

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'stock-watcher-persistence-benchmark-'),
)

try {
  const freshP95 = measure(30, (index) => {
    const opened = must(openPortfolioDatabase(
      temporaryConfiguration(path.join(temporaryDirectory, `fresh-${index}.db`)),
    ))
    must(opened.close())
  })

  const currentPath = path.join(temporaryDirectory, 'current.db')
  const initialized = must(openPortfolioDatabase(
    temporaryConfiguration(currentPath),
  ))
  must(initialized.close())
  const currentOpenP95 = measure(100, () => {
    const opened = must(openPortfolioDatabase(
      temporaryConfiguration(currentPath),
    ))
    must(opened.close())
  })

  const owner = must(openPortfolioDatabase(
    temporaryConfiguration(path.join(temporaryDirectory, 'operations.db')),
  ))
  const paperId = must(parsePortfolioId('portfolio:paper-default'))
  const loadP95 = measure(500, () => {
    const loaded = must(owner.portfolios.getById(paperId))
    if (loaded === undefined) throw new Error('MISSING_BENCHMARK_PORTFOLIO')
  })
  const mutationP95 = measure(500, (index) => {
    const transition = makePortfolio(`benchmark-${index}`, `Benchmark ${index}`)
    const committed = owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(transition.state)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(transition.events)
    })
    if (!committed.ok) throw new Error(committed.error.code)
  })
  const rollbackP95 = measure(500, () => {
    const rolledBack = owner.unitOfWork.execute(() =>
      failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED')))
    if (rolledBack.ok) throw new Error('ROLLBACK_BENCHMARK_COMMITTED')
  })

  const base = makePortfolio('large', 'Large Benchmark').state
  const quantityTen = must(createQuantity(10n))
  const quantityOne = must(createQuantity(1n))
  const holdings = Array.from({ length: 1_000 }, (_, holdingIndex) => {
    const holdingId = must(parseHoldingId(`holding:benchmark:${holdingIndex}`))
    const instrumentId = must(parseInstrumentId(`instrument:benchmark:${holdingIndex}`))
    const lots = Array.from({ length: 10 }, (_, lotIndex) =>
      must(createHoldingLot({
        lotId: must(parseHoldingLotId(`lot:benchmark:${holdingIndex}:${lotIndex}`)),
        portfolioId: base.portfolioId,
        instrumentId,
        acquiredOn: must(parseLocalDate('2025-01-01')),
        originalQuantity: quantityOne,
        openQuantity: quantityOne,
        unitCost: must(createMoney(10_000n)),
        sourceReference: {
          kind: 'IMPORT',
          referenceId: `benchmark:${holdingIndex}:${lotIndex}`,
        },
      })))
    return must(createHolding({
      holdingId,
      portfolioId: base.portfolioId,
      instrumentId,
      totalQuantity: quantityTen,
      availableDeliveryQuantity: quantityTen,
      reservedQuantity: must(createQuantity(0n)),
      lots,
      stateVersion: must(createPortfolioStateVersion(1)),
      marginFunded: false,
    }))
  })
  const large = Portfolio.rehydrate({
    ...base.snapshot(),
    holdings,
  })
  const largeInsert = owner.unitOfWork.execute((transaction) => {
    const inserted = transaction.portfolios.insert(large)
    if (!inserted.ok) return inserted
    return transaction.appendDomainEvents(makePortfolio('large', 'Large Benchmark').events)
  })
  if (!largeInsert.ok) throw new Error(largeInsert.error.code)
  const largeLoadP95 = measure(30, () => {
    const loaded = must(owner.portfolios.getById(large.portfolioId))
    if (loaded?.holdings.length !== 1_000) throw new Error('INVALID_LARGE_LOAD')
  })
  global.gc?.()
  const heapBeforeLargeLoad = process.memoryUsage().heapUsed
  const retainedLargePortfolio = must(owner.portfolios.getById(large.portfolioId))
  if (retainedLargePortfolio?.holdings.length !== 1_000) {
    throw new Error('INVALID_RETAINED_LARGE_LOAD')
  }
  global.gc?.()
  const largeLoadHeapDeltaBytes = Math.max(
    0,
    process.memoryUsage().heapUsed - heapBeforeLargeLoad,
  )
  must(owner.close())

  const millionEventPath = path.join(temporaryDirectory, 'million-events.db')
  const millionOwner = must(openPortfolioDatabase(
    temporaryConfiguration(millionEventPath),
  ))
  must(millionOwner.close())
  const millionDatabase = new Database(millionEventPath)
  millionDatabase.pragma('foreign_keys = ON')
  millionDatabase.exec(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 2
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < 1000000
    )
    INSERT INTO domain_events (
      event_id, stream_key, stream_sequence, previous_hash, event_hash,
      event_type, event_schema_version, portfolio_id, aggregate_state_version,
      occurred_at, actor_id, command_id, correlation_id, causation_id,
      canonical_payload, inserted_at
    )
    SELECT
      printf('benchmark-event-%07d', value),
      'portfolio:portfolio:paper-default',
      value,
      printf('%064x', value - 1),
      printf('%064x', value),
      'PortfolioCreated',
      1,
      'portfolio:paper-default',
      1,
      '2026-01-01T00:00:00.000Z',
      'actor:benchmark',
      printf('command:benchmark:%07d', value),
      'correlation:benchmark',
      printf('causation:benchmark:%07d', value),
      '{}',
      '2026-01-01T00:00:00.000Z'
    FROM sequence;
  `)
  const seedPayload = millionDatabase.prepare(`
    SELECT canonical_payload FROM domain_events WHERE stream_sequence = 1
  `).get() as { canonical_payload: string } | undefined
  if (seedPayload === undefined) throw new Error('MISSING_BENCHMARK_EVENT')
  const benchmarkEvent = must(parseDomainEvent(seedPayload.canonical_payload))
  const millionAppendP95 = measure(30, (index) => {
    const event = {
      ...benchmarkEvent,
      eventId: `benchmark-tail-event-${index}` as typeof benchmarkEvent.eventId,
      portfolioId: paperId,
      stateVersion: must(createPortfolioStateVersion(1)),
    }
    millionDatabase.exec('BEGIN IMMEDIATE')
    const appended = appendDomainEvents(
      millionDatabase,
      [event],
      '2026-01-01T00:00:00.000Z',
    )
    if (!appended.ok) throw new Error(appended.error.code)
    millionDatabase.exec('ROLLBACK')
  })
  millionDatabase.close()
  const millionEventDatabaseBytes = fs.statSync(millionEventPath).size

  const results = {
    freshInitializationP95Ms: freshP95,
    currentOpenP95Ms: currentOpenP95,
    representativeLoadP95Ms: loadP95,
    largeLoadP95Ms: largeLoadP95,
    mutationCommitP95Ms: mutationP95,
    rollbackP95Ms: rollbackP95,
    millionEventAppendP95Ms: millionAppendP95,
    largeLoadHeapDeltaBytes,
    millionEventDatabaseBytes,
  }
  console.log(JSON.stringify(results, null, 2))

  const failures = [
    freshP95 >= 2_000 && 'fresh initialization',
    currentOpenP95 >= 1_000 && 'current open',
    loadP95 >= 25 && 'representative load',
    largeLoadP95 >= 150 && 'large load',
    mutationP95 >= 50 && 'mutation commit',
    rollbackP95 >= 50 && 'rollback',
    millionAppendP95 >= 20 && 'million-event append',
    largeLoadHeapDeltaBytes >= 128 * 1024 * 1024 && 'large-load heap',
  ].filter(Boolean)
  if (failures.length > 0) {
    throw new Error(`PERSISTENCE_BENCHMARK_FAILED:${failures.join(',')}`)
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
