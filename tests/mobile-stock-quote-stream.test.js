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
  assert.match(source, /const CONCURRENCY = 8;/);
  assert.match(source, /const MOBILE_STOCK_QUOTE_CONCURRENCY = Math\.min\(8, YAHOO_QUOTE_CONCURRENCY\);/);
  assert.match(source, /const yahooQuoteCache = new Map\(\);/);
  assert.match(source, /if \(yahooQuoteInFlight\.has\(sym\)\) return yahooQuoteInFlight\.get\(sym\);/);
  assert.match(body, /slice\(0, 300\)/);
  assert.match(body, /await mapWithConcurrency\(symbols, MOBILE_STOCK_QUOTE_CONCURRENCY/);
  assert.match(body, /await yahooQuoteForSymbol\(symbol\)/);
  assert.match(body, /quotes:quoteBatch/);
  assert.match(body, /done:loaded >= symbols\.length/);
  assert.doesNotMatch(body, /for \(let i = 0; i < symbols\.length/);
});
