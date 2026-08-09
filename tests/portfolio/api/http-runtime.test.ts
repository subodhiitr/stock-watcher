import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'

import { createPortfolioHttpRuntime } from '../../../server/portfolio/composition/http-runtime.ts'
import { passwordDigest } from '../../../server/portfolio/composition/security-adapters.ts'
import {
  createTemporaryDatabasePath,
  openTestOwner,
  removeTemporaryDirectory,
} from '../persistence/support.ts'

type RunningRuntime = Readonly<{
  baseUrl: string
  owner: ReturnType<typeof openTestOwner>
  close(): Promise<void>
}>

function normalStrategicBenchmarkHistory(
  strategicBenchmarks: Readonly<{ riskBenchmark: string; defensiveBenchmark: string }>,
) {
  const risk = []
  const defensive = []
  let riskLevel = 100
  let defensiveLevel = 100
  const sessionCount = 2_600
  const finalSession = Date.parse('2026-08-08T00:00:00.000Z')
  for (let index = 0; index < sessionCount; index += 1) {
    const sessionDate = new Date(finalSession - (sessionCount - index - 1) * 86_400_000).toISOString().slice(0, 10)
    defensiveLevel *= 1.0001
    riskLevel *= index >= sessionCount - 320 ? 1.0007 : 1.0003
    risk.push(Object.freeze({ sessionDate, adjustedLevel: riskLevel }))
    defensive.push(Object.freeze({ sessionDate, adjustedLevel: defensiveLevel }))
  }
  return Object.freeze({
    source: 'YAHOO_RESEARCH' as const,
    adjustment: 'ADJUSTED_CLOSE' as const,
    retrievedAt: '2026-08-08T02:30:00.000Z',
    riskBenchmark: strategicBenchmarks.riskBenchmark,
    defensiveBenchmark: strategicBenchmarks.defensiveBenchmark,
    risk: Object.freeze(risk),
    defensive: Object.freeze(defensive),
  })
}

async function startRuntime(): Promise<RunningRuntime> {
  const temporary = createTemporaryDatabasePath()
  const owner = openTestOwner(temporary.databasePath)
  const operationsBackupDirectory = path.join(temporary.directory, 'backups')
  const fixedNow = Date.parse('2026-08-08T02:30:00.000Z')
  const runtime = createPortfolioHttpRuntime({
    owner,
    now: () => fixedNow,
    allowedOrigins: ['http://portfolio.test'],
    secureCookies: false,
    operationsBackupDirectory,
    bootstrap: {
      username: 'admin',
      password: 'correct-horse-battery-staple',
      displayName: 'Portfolio Admin',
      mfaSecret: 'JBSWY3DPEHPK3PXP',
    },
    marketQuotes: async (symbols) => Object.freeze({
      quotes: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, Object.freeze({
        symbol,
        price: symbol === 'RELIANCE' ? 1_500 : 100,
        prevClose: symbol === 'RELIANCE' ? 1_480 : 99,
      })]))),
    }),
    marketAnalysis: async (request) => Object.freeze({
      source: 'YAHOO_RESEARCH' as const,
      indexUniverse: request.indexUniverse,
      benchmark: request.benchmark,
      asOf: '2026-08-08T02:30:00.000Z',
      constituentCount: 3,
      analyzedCount: 3,
      warnings: Object.freeze([]),
      candidates: Object.freeze([
        { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'Technology', price: 1_000, prevClose: 990 },
        { symbol: 'INFY', name: 'Infosys', sector: 'Technology', price: 500, prevClose: 495 },
        { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', price: 1_500, prevClose: 1_480 },
      ].map((candidate, index) => Object.freeze({
        ...candidate,
        listingHistoryDays: 2_000,
        median20dTradedValueLakh: 10_000,
        marketTimestamp: '2026-08-08T02:30:00.000Z',
        metrics: Object.freeze({
          m3m1: 0.30 - index * 0.08, m6m1: 0.50 - index * 0.10,
          relativeStrength: 0.20 - index * 0.05, trend: 0.25 - index * 0.06,
          earningsMomentum: 0.18 - index * 0.03, liquidity: 8 - index,
          volatilityAdjusted: 1.8 - index * 0.4, returnOnEquity: 0.28 - index * 0.04,
          debtCoverage: 4 - index, volatility60d: 0.18 + index * 0.04,
          maxDrawdown: 0.12 + index * 0.04, downsideDeviation: 0.10 + index * 0.03,
          beta: 0.8 + index * 0.1, liquidityRisk: -8 + index,
        }),
      }))),
      ...(request.strategicBenchmarks === undefined ? {} : {
        strategicBenchmarkHistory: normalStrategicBenchmarkHistory(request.strategicBenchmarks),
      }),
    }),
  })
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    await runtime.handle(request, response, pathname)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test server unavailable')
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    owner,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      owner.close()
      removeTemporaryDirectory(temporary.directory)
    },
  })
}

async function startUnconfiguredRuntime(): Promise<RunningRuntime> {
  const owner = openTestOwner()
  const fixedNow = Date.parse('2026-08-08T02:30:00.000Z')
  const runtime = createPortfolioHttpRuntime({
    owner,
    now: () => fixedNow,
    allowedOrigins: ['http://portfolio.test'],
    secureCookies: false,
    bootstrap: {},
  })
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    await runtime.handle(request, response, pathname)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test server unavailable')
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    owner,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      owner.close()
    },
  })
}

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/u, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value >= 0) bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function totp(secret: string, epochMs: number): string {
  const counter = Math.floor(epochMs / 30_000)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32(secret)).update(message).digest()
  const last = digest.at(-1)
  if (last === undefined) throw new Error('empty digest')
  const offset = last & 0x0f
  const b0 = digest[offset]
  const b1 = digest[offset + 1]
  const b2 = digest[offset + 2]
  const b3 = digest[offset + 3]
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error('short digest')
  }
  const code = (
    ((b0 & 0x7f) << 24)
    | ((b1 & 0xff) << 16)
    | ((b2 & 0xff) << 8)
    | (b3 & 0xff)
  ) % 1_000_000
  return String(code).padStart(6, '0')
}

async function login(baseUrl: string, username = 'admin', password = 'correct-horse-battery-staple', mfaCode = totp('JBSWY3DPEHPK3PXP', Date.parse('2026-08-08T02:30:00.000Z'))) {
  const response = await fetch(`${baseUrl}/api/portfolio/auth/login`, {
    method: 'POST',
    headers: { origin: 'http://portfolio.test', 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, mfaCode }),
  })
  const cookies = response.headers.getSetCookie()
  const session = cookies.find((item) => item.startsWith('portfolio_session='))?.split(';')[0]
  const csrf = cookies.find((item) => item.startsWith('portfolio_csrf='))?.split(';')[0]
  return { response, cookie: `${session}; ${csrf}`, csrf: decodeURIComponent(csrf?.split('=')[1] ?? '') }
}

async function postJsonWithHost(baseUrl: string, path: string, host: string, origin: string, body: unknown) {
  const url = new URL(path, baseUrl)
  const bodyText = JSON.stringify(body)
  return await new Promise<Readonly<{
    status: number
    headers: http.IncomingHttpHeaders
    bodyText: string
  }>>((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        host,
        origin,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyText),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        resolve(Object.freeze({
          status: response.statusCode ?? 0,
          headers: response.headers,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        }))
      })
    })
    request.on('error', reject)
    request.end(bodyText)
  })
}

function mutationHeaders(cookie: string, csrf: string, idempotencyKey = `test:${randomUUID()}`) {
  return {
    origin: 'http://portfolio.test',
    cookie,
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    'x-correlation-id': `test:${randomUUID()}`,
    'idempotency-key': idempotencyKey,
  }
}

test('database-backed login, authorization, creation, idempotency, and logout work end to end', async () => {
  const running = await startRuntime()
  try {
    const signedIn = await login(running.baseUrl)
    assert.equal(signedIn.response.status, 200)
    assert.match(signedIn.cookie, /portfolio_session=/u)
    assert.ok(signedIn.csrf.length > 20)

    const list = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(list.status, 200)
    const initial = await list.json() as { portfolios: readonly { portfolioId: string }[]; strategies: readonly { strategyVersionId: string }[] }
    assert.equal(initial.portfolios[0]?.portfolioId, 'portfolio:paper-default')
    assert.equal(initial.strategies.length, 4)
    assert.ok(initial.strategies.some((item) => item.strategyVersionId === 'strategy-version:adaptive-momentum-quality:v2-strategic'))

    const key = `test:${randomUUID()}`
    const createBody = JSON.stringify({
      displayName: 'Long Term Family',
      startingCashMinorUnits: '25000000',
      mode: 'PAPER',
      strategyVersionId: initial.strategies[1]?.strategyVersionId,
    })
    const headers = mutationHeaders(signedIn.cookie, signedIn.csrf, key)
    const created = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      method: 'POST', headers, body: createBody,
    })
    assert.equal(created.status, 201)
    const createdBody = await created.json() as { portfolioId: string }
    assert.match(createdBody.portfolioId, /^portfolio:/u)

    const replay = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      method: 'POST', headers: { ...headers, 'x-correlation-id': `test:${randomUUID()}` }, body: createBody,
    })
    assert.equal(replay.status, 201)
    assert.deepEqual(await replay.json(), createdBody)

    const detail = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(detail.status, 200)
    assert.match(await detail.text(), /Long Term Family/u)

    const imported = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/holdings/import`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        instrumentId: 'NSE:RELIANCE',
        quantity: '100',
        unitCostMinorUnits: '145025',
        acquiredOn: '2026-08-01',
      }),
    })
    assert.equal(imported.status, 201)
    const importedBody = await imported.json() as { snapshotStateVersion: number }
    assert.equal(importedBody.snapshotStateVersion, 2)

    const afterImport = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    const afterImportBody = await afterImport.json() as {
      portfolioSnapshot: { stateVersion: number; holdingsIncluded: number; lotsIncluded: number }
      holdings: readonly { instrument_id: string; total_quantity: string }[]
      lots: readonly { source_kind: string; unit_cost_minor_units: string }[]
      rebalance: { status: string; blockers: readonly string[] }
    }
    assert.equal(afterImportBody.portfolioSnapshot.stateVersion, 2)
    assert.equal(afterImportBody.portfolioSnapshot.holdingsIncluded, 1)
    assert.equal(afterImportBody.portfolioSnapshot.lotsIncluded, 1)
    assert.deepEqual(afterImportBody.holdings.map((holding) => [holding.instrument_id, holding.total_quantity]), [['NSE:RELIANCE', '100']])
    assert.deepEqual(afterImportBody.lots.map((lot) => [lot.source_kind, lot.unit_cost_minor_units]), [['IMPORT', '145025']])
    assert.equal(afterImportBody.rebalance.status, 'NO_PLAN')
    assert.deepEqual(afterImportBody.rebalance.blockers, ['PREVIEW_NOT_GENERATED'])

    const duplicate = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/holdings/import`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        instrumentId: 'NSE:RELIANCE',
        quantity: '1',
        unitCostMinorUnits: '150000',
        acquiredOn: '2026-08-02',
      }),
    })
    assert.equal(duplicate.status, 409)

    const strategyVersionId = initial.strategies.find((item) =>
      item.strategyVersionId.includes('long-horizon'))?.strategyVersionId
    assert.ok(strategyVersionId)
    const assigned = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/strategy/assign`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ strategyVersionId }),
    })
    assert.equal(assigned.status, 200)
    assert.deepEqual(await assigned.json(), {
      portfolioId: createdBody.portfolioId,
      strategyVersionId,
      stateVersion: 3,
      changed: true,
    })

    const generated = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/rebalance/generate`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'GENERATE_RESEARCH_PREVIEW' }),
    })
    assert.equal(generated.status, 201)
    const generatedBody = await generated.json() as {
      planId: string
      portfolioStateVersion: number
      strategyVersionId: string
      state: string
      scope: string
      actions: readonly { instrumentId: string; action: string; isNewOpportunity: boolean; currentQuantity: string; targetQuantity: string; strategicTargetQuantity: string; deltaQuantity: string; stagedByTurnoverLimit: boolean; reasonCode: string; explanation: string }[]
      marketData: { source: string; asOf: string; executionEligible: boolean; indexUniverse: string; benchmark: string; constituentCount: number; analyzedCount: number; eligibleCount: number; researchModelVersion: string; researchModelWeights: Readonly<Record<string, number>>; catalystScanCoveragePct: number }
    }
    assert.equal(generatedBody.portfolioStateVersion, 3)
    assert.equal(generatedBody.strategyVersionId, strategyVersionId)
    assert.equal(generatedBody.state, 'PREVIEW_READY')
    assert.equal(generatedBody.scope, 'STRATEGY_UNIVERSE_RESEARCH')
    assert.deepEqual(generatedBody.marketData, {
      source: 'YAHOO_RESEARCH',
      asOf: generatedBody.marketData.asOf,
      executionEligible: false,
      indexUniverse: 'NIFTY500',
      benchmark: 'NIFTY500',
      constituentCount: 3,
      analyzedCount: 3,
      eligibleCount: 3,
      researchModelVersion: 'SIX_FACTOR_RESEARCH_V2',
      researchModelWeights: {
        momentum: 0.35,
        quality: 0.20,
        earnings: 0.15,
        sector: 0.10,
        catalyst: 0.10,
        lowRisk: 0.10,
      },
      catalystScanCoveragePct: 0,
    })
    assert.ok(generatedBody.actions.some((action) => action.instrumentId === 'NSE:TCS'))
    assert.ok(generatedBody.actions.some((action) => action.isNewOpportunity))
    assert.ok(generatedBody.actions.filter((action) => action.isNewOpportunity)
      .every((action) => action.targetQuantity === action.strategicTargetQuantity && !action.stagedByTurnoverLimit))
    const existingAction = generatedBody.actions.find((action) => action.instrumentId === 'NSE:RELIANCE')
    assert.ok(existingAction)
    assert.equal(existingAction.currentQuantity, '100')
    assert.equal(BigInt(existingAction.targetQuantity), 100n + BigInt(existingAction.deltaQuantity))
    assert.ok(BigInt(existingAction.deltaQuantity) < 0n)
    assert.match(existingAction.explanation, /existing holding/u)

    const withPlan = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    const withPlanBody = await withPlan.json() as {
      rebalance: { status: string; blockers: readonly string[]; plans: readonly unknown[] }
      strategy: readonly { strategy_version_id: string; approved_profile?: { validationStatus: string } }[]
    }
    assert.equal(withPlanBody.rebalance.status, 'PREVIEW_READY')
    assert.deepEqual(withPlanBody.rebalance.blockers, [])
    assert.equal(withPlanBody.rebalance.plans.length, 1)
    assert.equal(withPlanBody.strategy[0]?.strategy_version_id, strategyVersionId)
    assert.equal(withPlanBody.strategy[0]?.approved_profile?.validationStatus, 'SEEDED_APPROVED_PRESET')

    const approved = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/rebalance/execute`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'EXECUTE_PAPER_PLAN', planId: generatedBody.planId }),
    })
    assert.equal(approved.status, 200)
    assert.equal((await approved.json() as { state: string }).state, 'APPROVED_PAPER')

    const approvedView = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    const approvedViewBody = await approvedView.json() as {
      portfolio: { cash_minor_units: string; state_version: number }
      holdings: readonly { instrument_id: string; total_quantity: string }[]
      lots: readonly { source_kind: string; source_reference_id: string }[]
      manualExits: readonly { instrument_id: string; quantity: string; exit_kind: string; reason_code: string; executed_at: string }[]
      rebalance: { status: string; history: readonly { planId: string; state: string; executedAt: string; actions: readonly unknown[] }[] }
    }
    assert.equal(approvedViewBody.rebalance.status, 'APPROVED_PAPER')
    assert.equal(approvedViewBody.rebalance.history.length, 1)
    assert.equal(approvedViewBody.rebalance.history[0]?.planId, generatedBody.planId)
    assert.equal(approvedViewBody.rebalance.history[0]?.state, 'APPROVED_PAPER')
    assert.equal(approvedViewBody.rebalance.history[0]?.executedAt, '2026-08-08T02:30:00.000Z')
    assert.equal(approvedViewBody.rebalance.history[0]?.actions.length, generatedBody.actions.length)
    assert.equal(approvedViewBody.portfolio.state_version, 4)
    assert.ok(BigInt(approvedViewBody.portfolio.cash_minor_units) >= 0n)
    assert.ok(approvedViewBody.holdings.some((holding) => holding.instrument_id === 'NSE:TCS' && BigInt(holding.total_quantity) > 0n))
    assert.equal(new Set(approvedViewBody.holdings.map((holding) => holding.instrument_id)).size, approvedViewBody.holdings.length)
    for (const action of generatedBody.actions) {
      const holding = approvedViewBody.holdings.find((item) => item.instrument_id === action.instrumentId)
      if (BigInt(action.targetQuantity) === 0n) assert.equal(holding, undefined)
      else assert.equal(holding?.total_quantity, action.targetQuantity)
    }
    assert.ok(approvedViewBody.lots.some((lot) => lot.source_kind === 'FILL' && lot.source_reference_id === `paper-plan:${generatedBody.planId}`))
    const rebalanceExit = approvedViewBody.manualExits.find((exit) => exit.instrument_id === 'NSE:RELIANCE')
    assert.equal(rebalanceExit?.quantity, (-BigInt(existingAction.deltaQuantity)).toString())
    assert.equal(rebalanceExit?.exit_kind, 'PARTIAL')
    assert.equal(rebalanceExit?.reason_code, `REBALANCE_${existingAction.reasonCode}`)
    assert.equal(rebalanceExit?.executed_at, '2026-08-08T02:30:00.000Z')

    const performanceRefresh = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/performance/refresh`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'RECORD_PERFORMANCE_OBSERVATION' }),
    })
    assert.equal(performanceRefresh.status, 201)
    const performanceRefreshBody = await performanceRefresh.json() as {
      navMinorUnits: string
      benchmarkSymbol: string
      quoteCount: number
      totalHoldings: number
      attribution: readonly { instrumentId: string }[]
    }
    assert.ok(BigInt(performanceRefreshBody.navMinorUnits) > 0n)
    assert.equal(performanceRefreshBody.benchmarkSymbol, 'MONIFTY500.NS')
    assert.equal(performanceRefreshBody.quoteCount, performanceRefreshBody.totalHoldings)
    assert.equal(performanceRefreshBody.attribution.length, approvedViewBody.holdings.length)

    const performanceView = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/performance`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(performanceView.status, 200)
    const performanceViewBody = await performanceView.json() as {
      status: string
      observationCount: number
      observations: readonly unknown[]
      attribution: readonly unknown[]
    }
    assert.equal(performanceViewBody.status, 'CURRENT')
    assert.equal(performanceViewBody.observationCount, 1)
    assert.equal(performanceViewBody.observations.length, 1)
    assert.equal(performanceViewBody.attribution.length, approvedViewBody.holdings.length)

    const exitTarget = approvedViewBody.holdings.find((holding) => BigInt(holding.total_quantity) > 1n)
    assert.ok(exitTarget)
    const partialExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/holdings/exit`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        confirmation: 'EXIT_PAPER_HOLDING',
        instrumentId: exitTarget.instrument_id,
        quantity: '1',
        portfolioStateVersion: approvedViewBody.portfolio.state_version,
      }),
    })
    assert.equal(partialExit.status, 200)
    const partialExitBody = await partialExit.json() as {
      exitKind: string
      quantity: string
      netProceedsMinorUnits: string
      realizedPnlMinorUnits: string
      portfolioStateVersionAfter: number
    }
    assert.equal(partialExitBody.exitKind, 'PARTIAL')
    assert.equal(partialExitBody.quantity, '1')
    assert.equal(partialExitBody.portfolioStateVersionAfter, approvedViewBody.portfolio.state_version + 1)

    const afterPartialExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    const afterPartialExitBody = await afterPartialExit.json() as {
      portfolio: { cash_minor_units: string; state_version: number }
      holdings: readonly { holding_id: string; instrument_id: string; total_quantity: string }[]
      performance: { status: string }
    }
    assert.equal(
      afterPartialExitBody.holdings.find((holding) => holding.instrument_id === exitTarget.instrument_id)?.total_quantity,
      (BigInt(exitTarget.total_quantity) - 1n).toString(),
    )
    assert.equal(
      BigInt(afterPartialExitBody.portfolio.cash_minor_units),
      BigInt(approvedViewBody.portfolio.cash_minor_units) + BigInt(partialExitBody.netProceedsMinorUnits),
    )
    assert.equal(afterPartialExitBody.performance.status, 'STALE')

    const staleExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/holdings/exit`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        confirmation: 'EXIT_PAPER_HOLDING',
        instrumentId: exitTarget.instrument_id,
        quantity: '1',
        portfolioStateVersion: approvedViewBody.portfolio.state_version,
      }),
    })
    assert.equal(staleExit.status, 409)

    const remainingExitQuantity = BigInt(exitTarget.total_quantity) - 1n
    const fullExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/holdings/exit`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        confirmation: 'EXIT_PAPER_HOLDING',
        instrumentId: exitTarget.instrument_id,
        quantity: remainingExitQuantity.toString(),
        portfolioStateVersion: afterPartialExitBody.portfolio.state_version,
      }),
    })
    assert.equal(fullExit.status, 200)
    const fullExitBody = await fullExit.json() as {
      exitKind: string
      netProceedsMinorUnits: string
      realizedPnlMinorUnits: string
      portfolioStateVersionAfter: number
    }
    assert.equal(fullExitBody.exitKind, 'FULL')
    const afterFullExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    const afterFullExitBody = await afterFullExit.json() as {
      portfolio: { cash_minor_units: string; state_version: number }
      holdings: readonly { instrument_id: string }[]
      manualExits: readonly { instrument_id: string; exit_kind: string }[]
    }
    assert.equal(afterFullExitBody.holdings.some((holding) => holding.instrument_id === exitTarget.instrument_id), false)
    assert.equal(afterFullExitBody.portfolio.state_version, fullExitBody.portfolioStateVersionAfter)
    assert.deepEqual(
      afterFullExitBody.manualExits.filter((exit) => exit.instrument_id === exitTarget.instrument_id).map((exit) => exit.exit_kind).sort(),
      ['FULL', 'PARTIAL'],
    )
    assert.equal(
      BigInt(afterFullExitBody.portfolio.cash_minor_units),
      BigInt(afterPartialExitBody.portfolio.cash_minor_units) + BigInt(fullExitBody.netProceedsMinorUnits),
    )

    const refreshedAfterExit = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/performance/refresh`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'RECORD_PERFORMANCE_OBSERVATION' }),
    })
    assert.equal(refreshedAfterExit.status, 201)
    const refreshedAfterExitBody = await refreshedAfterExit.json() as { realizedPnlMinorUnits: string }
    assert.ok(
      BigInt(refreshedAfterExitBody.realizedPnlMinorUnits)
      >= BigInt(partialExitBody.realizedPnlMinorUnits) + BigInt(fullExitBody.realizedPnlMinorUnits),
    )

    await running.owner.operations.appendAuditDecision({
      auditEventId: `audit:${randomUUID()}`,
      actorId: 'actor:test-admin',
      portfolioId: createdBody.portfolioId as never,
      eventType: 'PORTFOLIO_CREATED',
      reasonCode: 'USER_REQUEST',
      explanation: 'Portfolio was created through the protected API.',
      inputVersionHash: 'a'.repeat(64),
      createdAt: new Date().toISOString() as never,
      redactedPayload: { displayName: 'Long Term Family' },
    })
    const operations = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/operations`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(operations.status, 200)
    const operationsBody = await operations.json() as { operations?: { audit?: readonly unknown[] }; database?: { operationsAuditValid?: boolean } }
    assert.equal(operationsBody.database?.operationsAuditValid, true)
    assert.equal(operationsBody.operations?.audit?.length, 1)

    for (const action of ['health', 'backup', 'restore-preflight', 'recovery-scan'] as const) {
      const response = await fetch(
        `${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/operations/${action}`,
        {
          method: 'POST',
          headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
          body: JSON.stringify({ confirmation: 'RUN_OPERATION' }),
        },
      )
      assert.equal(response.status, action === 'backup' ? 201 : 200, `${action}: ${await response.text()}`)
    }

    const openedIncident = await fetch(
      `${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/operations/incidents`,
      {
        method: 'POST',
        headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
        body: JSON.stringify({ severity: 'SEV2', code: 'MARKET_DATA_OUTAGE', correlationId: 'test:operations-incident' }),
      },
    )
    assert.equal(openedIncident.status, 201)
    const incidentId = (await openedIncident.json() as { incidentId: string }).incidentId
    const closedIncident = await fetch(
      `${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/operations/incidents/${encodeURIComponent(incidentId)}/close`,
      {
        method: 'POST',
        headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
        body: JSON.stringify({ actionCodes: ['PROVIDER_RECOVERED', 'DATA_VERIFIED'] }),
      },
    )
    assert.equal(closedIncident.status, 200)
    assert.equal((await closedIncident.json() as { state: string }).state, 'CLOSED')

    const completedOperations = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(createdBody.portfolioId)}/operations`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(completedOperations.status, 200)
    const completedOperationsBody = await completedOperations.json() as {
      operations: {
        jobs: readonly { state: string }[]
        backups: readonly unknown[]
        incidents: readonly { incidentId: string; state: string }[]
        audit: readonly unknown[]
        health: { components: readonly unknown[] }
      }
    }
    assert.equal(completedOperationsBody.operations.jobs.length, 4)
    assert.equal(completedOperationsBody.operations.jobs.every((job) => job.state === 'SUCCEEDED'), true)
    assert.equal(completedOperationsBody.operations.backups.length, 1)
    assert.equal(completedOperationsBody.operations.health.components.length, 3)
    assert.equal(completedOperationsBody.operations.incidents.find((item) => item.incidentId === incidentId)?.state, 'CLOSED')
    assert.ok(completedOperationsBody.operations.audit.length >= 7)

    const logout = await fetch(`${running.baseUrl}/api/portfolio/auth/logout`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirm: true }),
    })
    assert.equal(logout.status, 200)
    const afterLogout = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(afterLogout.status, 401)
  } finally {
    await running.close()
  }
})

test('privileged Sharekhan reconciliation atomically matches PAPER holdings and avoids duplicates', async () => {
  const running = await startRuntime()
  try {
    const signedIn = await login(running.baseUrl)
    assert.equal(signedIn.response.status, 200)
    const portfolioId = 'portfolio:paper-default'
    const beforeResponse = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(beforeResponse.status, 200)
    const before = await beforeResponse.json() as { portfolio: { state_version: number } }
    const payload = {
      confirmation: 'RECONCILE_SHAREKHAN_PAPER',
      brokerAsOf: Date.parse('2026-08-08T02:30:00.000Z'),
      portfolioStateVersion: before.portfolio.state_version,
      availableCashMinorUnits: '1437846',
      fallbackAcquiredOn: '2025-01-15',
      holdings: [
        { instrumentId: 'NSE:EXIDEIND', quantity: '6350', unitCostMinorUnits: '47411' },
        { instrumentId: 'NSE:BLUSPRING', quantity: '4251', unitCostMinorUnits: '0' },
      ],
    }
    const applied = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/sharekhan-reconciliation/apply`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify(payload),
    })
    assert.equal(applied.status, 200)
    const result = await applied.json() as { addedCount: number; updatedCount: number; cashMinorUnits: string; portfolioStateVersion: number }
    assert.deepEqual({ added:result.addedCount, updated:result.updatedCount, cash:result.cashMinorUnits }, { added:2, updated:0, cash:'1437846' })

    const repeated = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/sharekhan-reconciliation/apply`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ ...payload, portfolioStateVersion: result.portfolioStateVersion }),
    })
    assert.equal(repeated.status, 200)
    const repeatedResult = await repeated.json() as { addedCount: number; updatedCount: number; unchangedCount: number }
    assert.deepEqual(
      { added:repeatedResult.addedCount, updated:repeatedResult.updatedCount, unchanged:repeatedResult.unchangedCount },
      { added:0, updated:0, unchanged:2 },
    )

    const afterResponse = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}`, {
      headers: { cookie: signedIn.cookie },
    })
    const after = await afterResponse.json() as {
      portfolio: { cash_minor_units: string }
      holdings: readonly { instrument_id: string }[]
      lots: readonly { instrument_id: string; acquired_on: string; unit_cost_minor_units: string }[]
      brokerReconciliation: readonly unknown[]
    }
    assert.equal(after.portfolio.cash_minor_units, '1437846')
    assert.deepEqual(after.holdings.map((holding) => holding.instrument_id), ['NSE:BLUSPRING', 'NSE:EXIDEIND'])
    assert.equal(after.lots.length, 2)
    assert.ok(after.lots.every((lot) => lot.acquired_on === '2025-01-15'))
    assert.equal(after.lots.find((lot) => lot.instrument_id === 'NSE:BLUSPRING')?.unit_cost_minor_units, '0')
    assert.equal(after.brokerReconciliation.length, 2)
  } finally {
    await running.close()
  }
})

test('strategic V2 generates, persists, and approves a half-step paper rebalance end to end', async () => {
  const running = await startRuntime()
  try {
    const signedIn = await login(running.baseUrl)
    const listed = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(listed.status, 200)
    const strategies = (await listed.json() as {
      strategies: readonly { strategyVersionId: string }[]
    }).strategies
    const initialStrategyVersionId = strategies.find((item) =>
      item.strategyVersionId === 'strategy-version:adaptive-momentum-quality:v1')?.strategyVersionId
    const strategicStrategyVersionId = strategies.find((item) =>
      item.strategyVersionId === 'strategy-version:adaptive-momentum-quality:v2-strategic')?.strategyVersionId
    assert.ok(initialStrategyVersionId)
    assert.ok(strategicStrategyVersionId)

    const created = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        displayName: 'Strategic Paper Portfolio',
        startingCashMinorUnits: '50000000',
        mode: 'PAPER',
        strategyVersionId: initialStrategyVersionId,
      }),
    })
    assert.equal(created.status, 201)
    const { portfolioId } = await created.json() as { portfolioId: string }

    const imported = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/holdings/import`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({
        instrumentId: 'NSE:RELIANCE', quantity: '12', unitCostMinorUnits: '145025', acquiredOn: '2026-08-01',
      }),
    })
    assert.equal(imported.status, 201)

    const assigned = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/strategy/assign`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ strategyVersionId: strategicStrategyVersionId }),
    })
    assert.equal(assigned.status, 200)

    const generated = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/rebalance/generate`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'GENERATE_RESEARCH_PREVIEW' }),
    })
    assert.equal(generated.status, 201)
    const plan = await generated.json() as {
      planId: string
      state: string
      strategicRebalance: {
        state: string
        approvalBlocked: boolean
        appliedBuyFraction: number
        delayedBuyMinorUnits: string
        retainedCashMinorUnits: string
      }
      actions: readonly {
        instrumentId: string
        currentQuantity: string
        targetQuantity: string
        preTimingTargetQuantity: string
        delayedQuantity: string
        strategicTimingFraction: number
      }[]
    }
    assert.equal(plan.state, 'PREVIEW_READY')
    assert.equal(plan.strategicRebalance.state, 'NORMAL')
    assert.equal(plan.strategicRebalance.approvalBlocked, false)
    assert.equal(plan.strategicRebalance.appliedBuyFraction, 0.5)
    assert.equal(plan.strategicRebalance.delayedBuyMinorUnits, plan.strategicRebalance.retainedCashMinorUnits)
    assert.ok(BigInt(plan.strategicRebalance.delayedBuyMinorUnits) > 0n)
    const stagedBuy = plan.actions.find((action) =>
      BigInt(action.preTimingTargetQuantity) > BigInt(action.currentQuantity))
    assert.ok(stagedBuy)
    assert.equal(stagedBuy.strategicTimingFraction, 0.5)
    assert.ok(BigInt(stagedBuy.targetQuantity) < BigInt(stagedBuy.preTimingTargetQuantity))
    assert.ok(BigInt(stagedBuy.delayedQuantity) > 0n)

    const observation = running.owner.apiStore.readLatestStrategicRebalanceObservation(portfolioId)
    assert.ok(observation)
    assert.equal(observation.planId, plan.planId)
    assert.equal(observation.state, 'NORMAL')
    assert.equal(observation.delayedBuyMinorUnits, plan.strategicRebalance.delayedBuyMinorUnits)

    const approved = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/rebalance/approve`, {
      method: 'POST',
      headers: mutationHeaders(signedIn.cookie, signedIn.csrf),
      body: JSON.stringify({ confirmation: 'APPROVE_PAPER_PLAN', planId: plan.planId }),
    })
    assert.equal(approved.status, 200)
    assert.equal((await approved.json() as { state: string }).state, 'APPROVED_PAPER')

    const overview = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/overview`, {
      headers: { cookie: signedIn.cookie },
    })
    assert.equal(overview.status, 200)
    const holdings = (await overview.json() as {
      holdings: readonly { instrument_id: string; total_quantity: string }[]
    }).holdings
    assert.equal(new Set(holdings.map((holding) => holding.instrument_id)).size, holdings.length)
    for (const action of plan.actions) {
      const holding = holdings.find((item) => item.instrument_id === action.instrumentId)
      if (BigInt(action.targetQuantity) === 0n) assert.equal(holding, undefined)
      else assert.equal(holding?.total_quantity, action.targetQuantity)
    }
  } finally {
    await running.close()
  }
})

test('first-run bootstrap creates the administrator, signs in, and then closes', async () => {
  const running = await startUnconfiguredRuntime()
  try {
    const before = await fetch(`${running.baseUrl}/api/portfolio/auth/status`)
    assert.equal(before.status, 200)
    assert.deepEqual(await before.json(), { configured: false })

    const weak = await fetch(`${running.baseUrl}/api/portfolio/auth/bootstrap`, {
      method: 'POST',
      headers: { origin: 'http://portfolio.test', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'too-short' }),
    })
    assert.equal(weak.status, 400)

    const response = await fetch(`${running.baseUrl}/api/portfolio/auth/bootstrap`, {
      method: 'POST',
      headers: { origin: 'http://portfolio.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'correct-horse-battery-staple',
        displayName: 'Portfolio Admin',
      }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), {
      configured: true,
      authenticated: true,
      expiresAtEpochMs: Date.parse('2026-08-08T10:30:00.000Z'),
    })
    const cookies = response.headers.getSetCookie()
    const session = cookies.find((item) => item.startsWith('portfolio_session='))?.split(';')[0]
    const csrf = cookies.find((item) => item.startsWith('portfolio_csrf='))?.split(';')[0]
    assert.match(`${session}; ${csrf}`, /portfolio_session=/u)

    const list = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: `${session}; ${csrf}` },
    })
    assert.equal(list.status, 200)
    const portfolioId = (await list.json() as { portfolios: readonly { portfolioId: string }[] }).portfolios[0]?.portfolioId
    assert.ok(portfolioId)
    const sessionBeforeMfa = await fetch(`${running.baseUrl}/api/portfolio/auth/session`, {
      headers: { cookie: `${session}; ${csrf}` },
    })
    assert.equal(sessionBeforeMfa.status, 200)
    assert.equal((await sessionBeforeMfa.json() as { mfaConfigured: boolean; mfaVerified: boolean }).mfaConfigured, false)

    const csrfToken = decodeURIComponent(csrf?.split('=')[1] ?? '')
    const setupMfa = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/mfa/setup`, {
      method: 'POST',
      headers: mutationHeaders(`${session}; ${csrf}`, csrfToken),
      body: JSON.stringify({ confirmation: 'RUN_OPERATION' }),
    })
    assert.equal(setupMfa.status, 201)
    const enrollment = await setupMfa.json() as { secret: string; qrDataUrl: string }
    assert.match(enrollment.secret, /^[A-Z2-7]{32}$/u)
    assert.match(enrollment.qrDataUrl, /^data:image\/svg\+xml;base64,/u)
    const confirmMfa = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/mfa/confirm`, {
      method: 'POST',
      headers: mutationHeaders(`${session}; ${csrf}`, csrfToken),
      body: JSON.stringify({ code: totp(enrollment.secret, Date.parse('2026-08-08T02:30:00.000Z')) }),
    })
    assert.equal(confirmMfa.status, 200)
    assert.deepEqual(await confirmMfa.json(), { configured: true, reloginRequired: true })
    const invalidated = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: `${session}; ${csrf}` },
    })
    assert.equal(invalidated.status, 401)
    const signedInWithMfa = await login(
      running.baseUrl, 'admin', 'correct-horse-battery-staple',
      totp(enrollment.secret, Date.parse('2026-08-08T02:30:00.000Z')),
    )
    assert.equal(signedInWithMfa.response.status, 200)

    const second = await fetch(`${running.baseUrl}/api/portfolio/auth/bootstrap`, {
      method: 'POST',
      headers: { origin: 'http://portfolio.test', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'other', password: 'another-correct-password' }),
    })
    assert.equal(second.status, 409)
  } finally {
    await running.close()
  }
})

test('first-run bootstrap accepts same-host Tailscale origins', async () => {
  const running = await startUnconfiguredRuntime()
  try {
    const response = await postJsonWithHost(
      running.baseUrl,
      '/api/portfolio/auth/bootstrap',
      'lineysha.tail207387.ts.net',
      'https://lineysha.tail207387.ts.net',
      {
        username: 'subodhijitr',
        password: 'correct-horse-battery-staple',
        displayName: 'Subodh',
      },
    )
    assert.equal(response.status, 201)
    assert.match(String(response.headers['set-cookie']), /portfolio_session=/u)
    assert.deepEqual(JSON.parse(response.bodyText), {
      configured: true,
      authenticated: true,
      expiresAtEpochMs: Date.parse('2026-08-08T10:30:00.000Z'),
    })
  } finally {
    await running.close()
  }
})

test('foreign principals fail closed and repeated login failures raise an alert', async () => {
  const running = await startRuntime()
  try {
    const salt = randomBytes(16).toString('hex')
    assert.equal(running.owner.apiStore.createPrincipal({
      principalId: 'principal:foreign-user',
      usernameKey: 'foreign',
      displayName: 'Foreign User',
      passwordSalt: salt,
      passwordHash: passwordDigest('another-correct-password', salt),
      globalRole: 'INVESTOR',
      disabled: false,
    }, Date.now()), true)
    const foreign = await login(running.baseUrl, 'foreign', 'another-correct-password')
    assert.equal(foreign.response.status, 200)
    const denied = await fetch(`${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent('portfolio:paper-default')}/overview`, {
      headers: { cookie: foreign.cookie },
    })
    assert.equal(denied.status, 403)
    assert.doesNotMatch(await denied.text(), /Paper Portfolio|account|database/u)

    let lastStatus = 0
    for (let index = 0; index < 6; index += 1) {
      lastStatus = (await login(running.baseUrl, 'attacker', 'wrong-password')).response.status
    }
    assert.equal(lastStatus, 429)
    assert.equal(running.owner.apiStore.listSecurityAlerts(10).length, 1)
  } finally {
    await running.close()
  }
})
