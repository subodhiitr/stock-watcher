const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');

test('proxy streams mobile stock prices and changes in quote batches', () => {
  const start = source.indexOf("pathname === '/stream/mobile-stock-quotes'");
  const end = source.indexOf('// /stream/intraday-live', start);
  const body = source.slice(start, end);

  assert.ok(start >= 0);
  assert.match(body, /slice\(0, 300\)/);
  assert.match(body, /i \+= CONCURRENCY/);
  assert.match(body, /await yahooQuote\(chunk\)/);
  assert.match(body, /quotes:result\.quotes \|\| \{\}/);
  assert.match(body, /done:loaded >= symbols\.length/);
});
