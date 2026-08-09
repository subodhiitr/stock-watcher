import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as apiBoundary from '../../../server/portfolio/api.ts'
import * as portfolioApi from '../../../server/portfolio/index.ts'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const apiFiles = [
  'server/portfolio/api/api-contracts.ts',
  'server/portfolio/api/security-headers.ts',
  'server/portfolio/api/secure-handler.ts',
  'server/portfolio/api.ts',
]

test('U07 basic API boundary has no business storage, broker, legacy route, or credential dependency', () => {
  for (const relative of apiFiles) {
    const source = fs.readFileSync(path.join(workspaceRoot, relative), 'utf8')
    assert.doesNotMatch(source, /ticker_proxy|simulation_engine|trade-execution|paper-trades/u)
    assert.doesNotMatch(source, /better-sqlite3|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/u)
    assert.doesNotMatch(source, /kiteconnect|sharekhan|process\.env|node:(?:fs|http|https|net)/u)
    assert.doesNotMatch(source, /export\s+\*\s+from/u)
  }
})

test('U07 basic public surface is explicit', () => {
  assert.equal(typeof apiBoundary.SecurePortfolioApi, 'function')
  assert.equal(typeof apiBoundary.portfolioHtmlSecurityHeaders, 'function')
  assert.equal(portfolioApi.SecurePortfolioApi, apiBoundary.SecurePortfolioApi)
})

