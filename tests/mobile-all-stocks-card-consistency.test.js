const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('All Stocks uses the same mobile card structure and data fields as Setups', () => {
  const start = source.indexOf('function renderAllStocks');
  const end = source.indexOf('function readCachedAllStockUniverse', start);
  const body = source.slice(start, end);

  assert.match(body, /class="setup-card all-stock-card/);
  assert.match(body, /class="setup-head"/);
  assert.match(body, /class="setup-trade-row"/);
  assert.match(body, /renderSetup52WeekRange\(row\)/);
  assert.match(body, /class="setup-metrics"/);
  for (const field of ['Status', 'Category', 'Entry', 'Stop', 'R:R', 'VWAP', 'Sector', 'Net potential', 'Health']) {
    assert.match(body, new RegExp(`>${field} <b|${field} <b`));
  }
  assert.match(body, /renderSetupDecisionContext\(row\)/);
  assert.match(body, /setupSpecificIndicator\(row\)/);
  assert.match(body, /data-chart-symbol="\$\{row\.symbol\}"/);
  assert.match(body, /data-all-trade="\$\{row\.symbol\}"/);
});

test('All Stocks preserves full setup candidate data while adding universe metadata', () => {
  const start = source.indexOf('function populateAllStocks');
  const end = source.indexOf('function scheduleAllStockStreams', start);
  const body = source.slice(start, end);
  assert.match(body, /return \{\s*\.\.\.candidate,\s*symbol,/);
});
