const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
const body = source.slice(source.indexOf('async function fetchPortfolioResearchHistory('), source.indexOf('function portfolioBenchmarkYahooSymbol('));

async function history(count) {
  const context = vm.createContext({
    portfolioResearchHistoryCache: new Map(), PORTFOLIO_RESEARCH_CACHE_TTL_MS: 1000,
    portfolioYahooSymbol: symbol => `${symbol}.NS`, YAHOO_HEADERS: {},
    httpsGet: async () => ({ status: 200, body: JSON.stringify({ chart: { result: [{
      timestamp: Array.from({ length: count }, (_, i) => 1788825600 + i * 86400),
      indicators: { quote: [{ close: Array.from({ length: count }, (_, i) => 190 + i), volume: Array(count).fill(10000) }] },
    }] } }) }),
  });
  vm.runInContext(body, context);
  return context.fetchPortfolioResearchHistory('DEEPA');
}

test('DEEPA with four sessions is retained without invented long-term metrics', async () => {
  const result = await history(4);
  assert.equal(result.price, 193);
  assert.equal(result.listingHistoryDays, 3);
  for (const key of ['m3m1', 'm6m1', 'trend', 'volatility60d', 'downsideDeviation', 'maxDrawdown', 'median20dTradedValueLakh']) {
    assert.equal(result[key], null, key);
  }
});

test('empty history remains unavailable and mature history retains metrics', async () => {
  assert.equal(await history(0), null);
  const result = await history(260);
  assert.ok(result.m6m1 > 0);
  assert.ok(result.trend > 0);
  assert.ok(result.median20dTradedValueLakh > 0);
});
