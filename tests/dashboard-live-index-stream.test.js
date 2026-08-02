const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop dashboard subscribes to live market indices and re-renders cards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

  assert.match(source, /MARKET_OVERVIEW_STREAM_ENDPOINT = `\$\{PROXY\}\/stream\/market-overview`/);
  assert.match(source, /function subscribeMarketOverviewStream\(\)/);
  assert.match(source, /new EventSource\(MARKET_OVERVIEW_STREAM_ENDPOINT\)/);
  assert.match(source, /mergeLiveIndices\(payload\.indices\)/);
  assert.match(source, /indexData = \{ \.\.\.indexData, \.\.\.indices \}/);
  assert.match(source, /mergeLiveIndices[\s\S]*renderIndices\(\)/);
  assert.match(source, /await loadDashboardBootstrap\(\);\s*subscribeMarketOverviewStream\(\);/);
  assert.match(source, /scheduleMarketOverviewReconnect\(\)/);
});
