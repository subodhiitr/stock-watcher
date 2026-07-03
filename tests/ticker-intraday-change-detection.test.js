const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

function loadChangeHelpers() {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(`
    ${extractFunctionSource(source, 'buildIntradaySignalMaterialSignature')}
    ${extractFunctionSource(source, 'hasIntradaySignalMaterialChange')}
    module.exports = { buildIntradaySignalMaterialSignature, hasIntradaySignalMaterialChange };
  `, { module });
  return module.exports;
}

test('ignores non-material intraday metadata changes', () => {
  const { hasIntradaySignalMaterialChange } = loadChangeHelpers();
  const prev = {
    symbol: 'ABC',
    signal: 'buy',
    score: 82,
    price: 101.25,
    entryStatus: 'Triggered',
    target: 103.1,
    stop: 100.5,
    stale: false,
    staleReason: '',
    savedAt: '2026-07-03T10:00:00.000Z',
    _updatedAt: 1000,
    _lastBroadcastAt: 2000,
  };
  const next = {
    ...prev,
    savedAt: '2026-07-03T10:00:10.000Z',
    _updatedAt: 1010,
    _lastBroadcastAt: 2010,
  };
  assert.equal(hasIntradaySignalMaterialChange(prev, next), false);
});

test('detects material intraday price/score changes', () => {
  const { hasIntradaySignalMaterialChange } = loadChangeHelpers();
  const prev = { symbol: 'ABC', signal: 'buy', score: 82, price: 101.25, entryStatus: 'Triggered', stale: false };
  const nextPrice = { ...prev, price: 102.0 };
  const nextScore = { ...prev, score: 76 };
  assert.equal(hasIntradaySignalMaterialChange(prev, nextPrice), true);
  assert.equal(hasIntradaySignalMaterialChange(prev, nextScore), true);
});

