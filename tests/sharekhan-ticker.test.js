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
