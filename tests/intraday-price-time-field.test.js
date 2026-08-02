const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('intraday signal payload includes explicit price timestamp fields', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function buildIntradaySignal\(/);
  assert.match(source, /\bpriceTime\b/);
  assert.match(source, /\bpriceTimeMs\b/);
});
