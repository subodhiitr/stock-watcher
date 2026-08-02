const test = require('node:test');
const assert = require('node:assert/strict');

const ProxyRuntime = require('../ticker_proxy');

test('intraday scorer awards bounded warm-up points before long indicators mature', () => {
  const closes = [100, 100.2, 100.05, 100.25, 100.15, 100.3, 100.4, 100.5];
  const opens = closes.map((close, index) => index ? closes[index - 1] : 99.95);
  const highs = closes.map(close => close + 0.05);
  const lows = closes.map(close => close - 0.1);
  const volumes = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 2000];
  const start = Date.parse('2026-07-22T03:45:00.000Z') / 1000;
  const timestamp = closes.map((_, index) => start + index * 300);
  const result = {
    meta:{ regularMarketPrice:100.5, regularMarketOpen:99.95, previousClose:99.9 },
    timestamp,
    indicators:{ quote:[{ open:opens, high:highs, low:lows, close:closes, volume:volumes }] },
  };
  const signal = ProxyRuntime.__test__.buildIntradaySignalForTests('EARLY', result, {
    prevDayClose:99.9,
    prevDayHigh:101.5,
    prevDayLow:98.5,
    pivot:100,
    high5:103,
    low5:97,
    high20:105,
    low20:95,
    avgVolume20:9000,
  });

  assert.equal(signal.ema20, null);
  assert.equal(signal.rsi, null);
  assert.equal(signal.superTrendDirection, null);
  assert.equal(signal.earlyMomentum.active, true);
  assert.equal(signal.entryPrice, signal.openingHigh);
  assert.ok(signal.score >= 55, `expected early score >= 55, received ${signal.score}`);
  assert.ok(signal.reasons.some(reason => /^Early /.test(reason)));
  assert.equal(signal.ohlc.recentBars.length, 6);
});
