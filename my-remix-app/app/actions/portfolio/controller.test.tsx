import assert from 'node:assert/strict'
import test from 'node:test'

import { router } from '../../router.ts'
import { routes } from '../../routes.ts'
import { assetServer } from '../../assets.ts'

test('dedicated portfolio routes render without legacy dashboard embedding', async () => {
  try {
    for (const path of [
    routes.portfolio.index.href(),
    routes.portfolio.overview.href({ portfolioId: 'portfolio:paper-default' }),
    routes.portfolio.holdings.href({ portfolioId: 'portfolio:paper-default' }),
    routes.portfolio.strategy.href({ portfolioId: 'portfolio:paper-default' }),
    routes.portfolio.rebalance.href({ portfolioId: 'portfolio:paper-default' }),
    routes.portfolio.performance.href({ portfolioId: 'portfolio:paper-default' }),
    routes.portfolio.operations.href({ portfolioId: 'portfolio:paper-default' }),
    ]) {
      const response = await router.fetch(new Request(`http://localhost${path}`))
      const html = await response.text()
      assert.equal(response.status, 200)
      assert.match(html, /Portfolio Workspace|Portfolio sign in/u)
      assert.doesNotMatch(html, /dashboard-app\.js|nse_midcap_dashboard|intraday/u)
      assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/u)
      assert.equal(response.headers.get('x-frame-options'), 'DENY')
    }
  } finally {
    await assetServer.close()
  }
})
