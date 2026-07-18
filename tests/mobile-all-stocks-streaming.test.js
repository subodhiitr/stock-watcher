const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('All Stocks renders its universe before connecting the live quote stream', () => {
  const start = source.indexOf('async function loadAllStocks');
  const end = source.indexOf('function renderSettings', start);
  const body = source.slice(start, end);
  const populate = body.indexOf('populateAllStocks(universe)');
  const render = body.indexOf('renderAllStocks();', populate);
  const stream = body.indexOf('scheduleAllStockStreams();', populate);

  assert.ok(populate >= 0, 'stock rows should be populated from the lightweight universe');
  assert.ok(render > populate, 'stock rows should render after universe population');
  assert.ok(stream > render, 'live streaming should be scheduled after the initial rows render');
});

test('All Stocks uses the bulk market request only when EventSource is unavailable', () => {
  const start = source.indexOf('async function loadAllStocks');
  const end = source.indexOf('function renderSettings', start);
  const body = source.slice(start, end);

  assert.match(body, /if \(!window\.EventSource && symbols\.length\)/);
  assert.match(body, /api\(`\/dashboard-market\?symbols=/);
});

test('All Stocks prefetches and caches its lightweight universe before the tab is clicked', () => {
  assert.match(source, /state\.allStockUniverse = readCachedAllStockUniverse\(\)/);
  assert.match(source, /preloadAllStockUniverse\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(source, /intradayx\.mobile\.stockUniverse/);
});

test('All Stocks lets the first table paint before opening heavy streams', () => {
  assert.match(source, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{/);
  assert.match(source, /connectHealthStream\(state\.allStocks\)/);
  assert.match(source, /connectAllStockQuoteStream\(\)/);
  assert.match(source, /connectLiveStream\(\)/);
});

test('All Stocks merges progressively streamed price and change quotes', () => {
  assert.match(source, /\/stream\/mobile-stock-quotes\?symbols=/);
  assert.match(source, /quote\.change \?\? quote\.changePct \?\? quote\.percentChange/);
  assert.match(source, /row\.quote = \{ \.\.\.\(row\.quote \|\| \{\}\), \.\.\.quote, price, change \}/);
});
