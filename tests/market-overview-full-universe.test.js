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
