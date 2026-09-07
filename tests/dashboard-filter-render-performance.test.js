const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test('ordinary stock filters skip unchanged setup-card recomputation', () => {
  const setFilterSource = functionSource('setFilter', 'setTargetFilter');
  const renderNowSource = functionSource('renderTableNow', 'normPercent');

  assert.match(setFilterSource, /renderTable\(\{ skipSetupCards: true \}\)/);
  assert.match(renderNowSource, /if \(!options\.skipSetupCards\) renderSetupCards\(rows\)/);
});

test('coalesced normal renders override filter-only setup-card skips', () => {
  const renderSource = functionSource('renderTable', 'updateStatsBar');

  assert.match(renderSource, /const needsSetupCards = options\.skipSetupCards !== true/);
  assert.match(renderSource, /tableRenderNeedsSetupCards = tableRenderNeedsSetupCards \|\| needsSetupCards/);
  assert.match(renderSource, /skipSetupCards: !tableRenderNeedsSetupCards/);
  assert.match(renderSource, /renderTableNow\(renderOptions\)/);
});

test('setup cards reuse one cached setup classification per symbol', () => {
  const filterFnsSource = functionSource('getStockFilterFns', 'getStockFilterGroups');
  const setupCardsSource = functionSource('renderSetupCards', 'renderTable');

  assert.match(filterFnsSource, /const setupTypeBySymbol = new Map\(\)/);
  assert.match(filterFnsSource, /if \(setupTypeBySymbol\.has\(r\.sym\)\) return setupTypeBySymbol\.get\(r\.sym\)/);
  assert.match(setupCardsSource, /const filterFns = getStockFilterFns\(\)/);
  assert.match(setupCardsSource, /applyStockFilters\(rows, new Set\(modes\.filter\(Boolean\)\), filterFns\)/);
  assert.doesNotMatch(setupCardsSource, /countRowsForStockFilters/);
});
