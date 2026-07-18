const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');

test('market overview warms the complete dashboard stock universe', () => {
  const route = source.slice(source.indexOf("if (pathname === '/stream/market-overview')"));
  assert.match(route, /rememberSimulationUniverse\(loadDashboardStockUniverse\(\)\.map\(row => row\.sym\)\)/);
  assert.match(route, /refreshIntradayLiveCache\('market-overview-client'\)/);
});

test('Yahoo index mapping uses the actual Nifty Midcap 150 symbol', () => {
  const indexMap = source.slice(source.indexOf('const INDEX_MAP = {'), source.indexOf('async function yahooIndices'));
  assert.match(indexMap, /'NIFTYMIDCAP150\.NS'\s*:\s*'midcap'/);
  assert.doesNotMatch(indexMap, /\^NSMIDCP/);
});
