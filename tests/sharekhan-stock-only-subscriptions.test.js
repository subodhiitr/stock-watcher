'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');

test('Sharekhan websocket initial subscription uses stock-only universe', () => {
  assert.match(source, /function getSharekhanStockUniverseSymbols\(\)/);
  assert.match(source, /filter\(sym => !isEtfSimulationSymbol\(sym\)\)/);
  assert.match(source, /const universeSyms = getSharekhanStockUniverseSymbols\(\);/);
});

test('Sharekhan websocket always includes the 63MOONS ticker', () => {
  assert.match(source, /SHAREKHAN_EXTRA_TICKER_SYMBOLS\s*=\s*Object\.freeze\(\['63MOONS'\]\)/);
  assert.match(source, /\.\.\.SHAREKHAN_EXTRA_TICKER_SYMBOLS/);
});

test('mobile stock universe follows live Sharekhan stock subscriptions and excludes index codes', () => {
  const helperStart = source.indexOf('function getSharekhanSubscribedStockSymbols');
  const helperEnd = source.indexOf('function rememberSimulationUniverse', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const universeStart = source.indexOf('function buildMobileStockUniverse');
  const universeEnd = source.indexOf('function buildHealthPayload', universeStart);
  const universe = source.slice(universeStart, universeEnd);

  assert.ok(helperStart >= 0);
  assert.match(helper, /sharekhanTicker\._subscribedCodes/);
  assert.match(helper, /sharekhanIndexCodeMap\.keys\(\)/);
  assert.match(helper, /!indexCodes\.has\(Number\(code\)\)/);
  assert.match(helper, /sharekhanTicker\.getSymbol\(code\)/);
  assert.match(universe, /getSharekhanSubscribedStockSymbols\(\)/);
  assert.doesNotMatch(universe, /Math\.min\(300/);
  assert.doesNotMatch(universe, /stocks:\[\.\.\.bySymbol\.values\(\)\]\.slice\(0, 300\)/);
});

test('Sharekhan websocket incremental subscriptions reject ETFs', () => {
  assert.match(source, /filter\(sym => sym && universe\.has\(sym\) && !isEtfSimulationSymbol\(sym\)\)/);
});

test('Sharekhan startup logs stock subscription count for every pooled connection', () => {
  assert.match(source, /Connection \$\{connectionIndex \+ 1\}\/\$\{sharekhanTicker\.connectionCount\}: subscribed to \$\{stockCount\} stock symbols/);
});

test('active Sharekhan ticker uses one connection for the full universe', () => {
  assert.match(source, /poolSize:\s*1/);
  assert.match(source, /startStaggerMs:\s*0/);
});
