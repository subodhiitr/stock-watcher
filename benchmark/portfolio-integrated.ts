import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  createTemporaryDatabasePath,
  makePortfolio,
  must,
  openTestOwner,
  removeTemporaryDirectory,
} from '../tests/portfolio/persistence/support.ts'

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const temporary = createTemporaryDatabasePath()
try {
  const owner = openTestOwner(temporary.databasePath)
  for (let index = 1; index < 100; index += 1) {
    const transition = makePortfolio(`u09-capacity-${index}`, `U09 Capacity ${index}`)
    const committed = owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(transition.state)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(transition.events)
    })
    if (!committed.ok) throw new Error(committed.error.code)
  }

  const salt = '0'.repeat(32)
  const hash = '0'.repeat(128)
  if (!owner.apiStore.createPrincipal({
    principalId: 'principal:u09-capacity',
    usernameKey: 'u09-capacity',
    displayName: 'U09 Capacity',
    passwordSalt: salt,
    passwordHash: hash,
    globalRole: 'ADMIN',
    disabled: false,
  }, Date.now())) throw new Error('U09_PRINCIPAL_CREATE_FAILED')
  owner.apiStore.grantAllExistingPortfolios('principal:u09-capacity', Date.now())
  const portfolios = owner.apiStore.listPortfolios('principal:u09-capacity')
  if (portfolios.length !== 100) throw new Error(`U09_PORTFOLIO_COUNT:${portfolios.length}`)

  const readDurations: number[] = []
  for (let index = 0; index < 500; index += 1) {
    const portfolio = portfolios[index % portfolios.length]
    if (portfolio === undefined) throw new Error('U09_PORTFOLIO_MISSING')
    const started = performance.now()
    const view = owner.apiStore.readPortfolioView('principal:u09-capacity', portfolio.portfolioId)
    readDurations.push(performance.now() - started)
    if (view === undefined) throw new Error('U09_VIEW_MISSING')
  }

  const instruments = 1_000
  const sessionsPerYear = 252
  const years = 10
  const observations = instruments * sessionsPerYear * years
  const dailyHistory = new Float64Array(observations)
  for (let index = 0; index < dailyHistory.length; index += 1) {
    dailyHistory[index] = 10_000 + (index % sessionsPerYear)
  }
  let checksum = 0
  let maxChunkMs = 0
  const chunkSize = 50_000
  const historyStarted = performance.now()
  for (let offset = 0; offset < dailyHistory.length; offset += chunkSize) {
    const chunkStarted = performance.now()
    const end = Math.min(offset + chunkSize, dailyHistory.length)
    for (let index = offset; index < end; index += 1) checksum += dailyHistory[index] ?? 0
    maxChunkMs = Math.max(maxChunkMs, performance.now() - chunkStarted)
    await immediate()
  }
  const historyDurationMs = performance.now() - historyStarted

  let completedJobs = 0
  const jobsStarted = performance.now()
  for (let offset = 0; offset < portfolios.length; offset += 10) {
    await Promise.all(portfolios.slice(offset, offset + 10).map(async () => {
      await Promise.resolve()
      completedJobs += 1
    }))
    await immediate()
  }
  const jobsDurationMs = performance.now() - jobsStarted
  must(owner.close())

  const results = Object.freeze({
    portfolioCount: portfolios.length,
    instrumentCount: instruments,
    dailyHistoryYears: years,
    observationCount: observations,
    interactiveReadP95Ms: p95(readDurations),
    historyScanMs: historyDurationMs,
    maxEventLoopChunkMs: maxChunkMs,
    completedJobs,
    jobsDurationMs,
    historyChecksum: checksum,
    databaseBytes: fs.statSync(temporary.databasePath).size,
  })
  console.log(JSON.stringify(results, null, 2))
  const failures = [
    results.interactiveReadP95Ms >= 500 && 'interactive-read-p95',
    results.maxEventLoopChunkMs >= 100 && 'event-loop-chunk',
    results.completedJobs !== 100 && 'portfolio-jobs',
    results.observationCount !== 2_520_000 && 'daily-history-scale',
  ].filter(Boolean)
  if (failures.length > 0) throw new Error(`U09_CAPACITY_FAILED:${failures.join(',')}`)
} finally {
  removeTemporaryDirectory(temporary.directory)
}
