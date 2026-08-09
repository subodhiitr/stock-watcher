import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { createPortfolioHttpRuntime } from '../../../server/portfolio/composition/http-runtime.ts'
import { openTestOwner } from '../persistence/support.ts'

const ORIGIN = 'http://portfolio.test'

async function startRuntime() {
  const owner = openTestOwner()
  const runtime = createPortfolioHttpRuntime({
    owner,
    allowedOrigins: [ORIGIN],
    secureCookies: false,
    bootstrap: {
      username: 'acceptance-admin',
      password: 'acceptance-password-123',
      displayName: 'Acceptance Admin',
    },
  })
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    await runtime.handle(request, response, pathname)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('U09_SERVER_UNAVAILABLE')
  return {
    owner,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      runtime.close()
      owner.close()
    },
  }
}

async function signIn(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/portfolio/auth/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'acceptance-admin', password: 'acceptance-password-123' }),
  })
  assert.equal(response.status, 200)
  const cookies = response.headers.getSetCookie()
  const session = cookies.find((item) => item.startsWith('portfolio_session='))?.split(';')[0]
  const csrfCookie = cookies.find((item) => item.startsWith('portfolio_csrf='))?.split(';')[0]
  assert.ok(session)
  assert.ok(csrfCookie)
  return {
    cookie: `${session}; ${csrfCookie}`,
    csrf: decodeURIComponent(csrfCookie.split('=')[1] ?? ''),
  }
}

function mutationHeaders(auth: Readonly<{ cookie: string; csrf: string }>, key = `u09:${randomUUID()}`) {
  return {
    origin: ORIGIN,
    cookie: auth.cookie,
    'content-type': 'application/json',
    'x-csrf-token': auth.csrf,
    'x-correlation-id': `correlation:u09:${randomUUID()}`,
    'idempotency-key': key,
  }
}

test('U09 acceptance: seeded portfolio, four presets, isolated creation, views, archive, and session invalidation', async () => {
  const running = await startRuntime()
  try {
    const auth = await signIn(running.baseUrl)
    const initialResponse = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: auth.cookie },
    })
    assert.equal(initialResponse.status, 200)
    const initial = await initialResponse.json() as {
      portfolios: readonly { portfolioId: string; displayName: string; mode: string }[]
      strategies: readonly { strategyVersionId: string; horizon: string }[]
    }
    assert.deepEqual(initial.portfolios.map((item) => item.displayName), ['Paper Portfolio'])
    assert.equal(initial.portfolios[0]?.mode, 'PAPER')
    assert.equal(initial.strategies.length, 4)
    assert.deepEqual(new Set(initial.strategies.map((item) => item.horizon)), new Set(['SHORT', 'MEDIUM', 'LONG']))
    assert.ok(initial.strategies.some((item) => item.strategyVersionId === 'strategy-version:adaptive-momentum-quality:v2-strategic'))

    const createdIds: string[] = []
    for (const [index, strategy] of initial.strategies.entries()) {
      const body = JSON.stringify({
        displayName: `U09 ${strategy.horizon} Portfolio ${index + 1}`,
        startingCashMinorUnits: String(20_000_000 + index * 1_000_000),
        mode: strategy.strategyVersionId.endsWith(':v2-strategic')
          ? 'PAPER' : index === 0 ? 'OBSERVE' : index === 1 ? 'PAPER' : 'RECOMMENDATION',
        strategyVersionId: strategy.strategyVersionId,
      })
      const key = `u09:create:${index}:${strategy.horizon.toLowerCase()}`
      const headers = mutationHeaders(auth, key)
      const response = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
        method: 'POST', headers, body,
      })
      assert.equal(response.status, 201)
      const created = await response.json() as { portfolioId: string }
      createdIds.push(created.portfolioId)
      const replay = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
        method: 'POST',
        headers: { ...headers, 'x-correlation-id': `correlation:u09:replay:${index}` },
        body,
      })
      assert.equal(replay.status, 201)
      assert.deepEqual(await replay.json(), created)
    }

    assert.equal(new Set(createdIds).size, 4)
    for (const portfolioId of createdIds) {
      const detail = await fetch(
        `${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/overview`,
        { headers: { cookie: auth.cookie } },
      )
      assert.equal(detail.status, 200)
      const view = await detail.json() as { portfolio: { portfolio_id: string }; holdings: unknown[] }
      assert.equal(view.portfolio.portfolio_id, portfolioId)
      assert.deepEqual(view.holdings, [])
    }

    const archivedId = createdIds[0]
    assert.ok(archivedId)
    const archive = await fetch(
      `${running.baseUrl}/api/portfolio/portfolios/${encodeURIComponent(archivedId)}/archive`,
      {
        method: 'POST',
        headers: mutationHeaders(auth, 'u09:archive:first'),
        body: JSON.stringify({ confirmation: 'ARCHIVE' }),
      },
    )
    assert.equal(archive.status, 200)
    assert.equal((await archive.json() as { status: string }).status, 'ARCHIVED')

    const logout = await fetch(`${running.baseUrl}/api/portfolio/auth/logout`, {
      method: 'POST',
      headers: mutationHeaders(auth, 'u09:logout'),
      body: JSON.stringify({ confirm: true }),
    })
    assert.equal(logout.status, 200)
    const rejected = await fetch(`${running.baseUrl}/api/portfolio/portfolios`, {
      headers: { cookie: auth.cookie },
    })
    assert.equal(rejected.status, 401)
  } finally {
    await running.close()
  }
})
