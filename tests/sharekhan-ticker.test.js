'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildYahooShapeFromCandles } = require('../sharekhan-intraday');

test('buildYahooShapeFromCandles returns null for empty input', () => {
  assert.equal(buildYahooShapeFromCandles('TEST', []), null);
});

test('buildYahooShapeFromCandles returns correct Yahoo-shape', () => {
  const candles = [
    { unixSec: 1000, open: 100, high: 105, low: 99, close: 103, vol: 500 },
    { unixSec: 1300, open: 103, high: 107, low: 102, close: 106, vol: 800 },
  ];
  const result = buildYahooShapeFromCandles('TEST', candles);
  assert.ok(result);
  assert.deepEqual(result.timestamp, [1000, 1300]);
  assert.deepEqual(result.indicators.quote[0].open,  [100, 103]);
  assert.deepEqual(result.indicators.quote[0].close, [103, 106]);
  assert.equal(result.meta.regularMarketPrice, 106);
  assert.equal(result.meta.regularMarketOpen, 100);
  assert.equal(result.meta.previousClose, null);
});

const { parseTickTime } = require('../sharekhan-ticker');

test('parseTickTime floors to 5-min bar start (unix seconds)', () => {
  // "06/30/2026 09:32:45" IST = 04:02:45 UTC → bar start 04:00:00 UTC
  const result = parseTickTime('06/30/2026 09:32:45');
  assert.ok(result !== null);
  const barStart = parseTickTime('06/30/2026 09:30:00'); // 04:00 UTC
  assert.equal(result, barStart);
  // Verify it's actually 04:00 UTC on that date
  assert.equal(new Date(result * 1000).toISOString(), '2026-06-30T04:00:00.000Z');
});

test('parseTickTime returns different bar for different 5-min window', () => {
  const bar1 = parseTickTime('06/30/2026 09:30:00');
  const bar2 = parseTickTime('06/30/2026 09:35:00');
  assert.ok(bar1 !== null && bar2 !== null);
  assert.equal(bar2 - bar1, 300); // 5 minutes = 300 seconds
});

test('parseTickTime returns null for invalid input', () => {
  assert.equal(parseTickTime(null), null);
  assert.equal(parseTickTime('0'), null);
  assert.equal(parseTickTime('bad'), null);
});
