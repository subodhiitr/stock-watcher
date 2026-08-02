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
