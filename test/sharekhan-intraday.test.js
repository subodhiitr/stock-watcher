const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildScripCodeMap, loadScripCache, saveScripCache, normalizeSharekhanCandles } = require('../sharekhan-intraday');

test('buildScripCodeMap extracts EQ scripts only and maps symbol → scripCode', () => {
  const masterData = [
    { scripCode: 676,  tradingSymbol: 'EXIDEIND', instType: 'EQ' },
    { scripCode: 1660, tradingSymbol: 'ITC',      instType: 'EQ' },
    { scripCode: 9999, tradingSymbol: 'NIFTY-FUT', instType: 'FU' }, // excluded
    { scripCode: 0,    tradingSymbol: 'BADSCRIPT', instType: 'EQ' }, // excluded (no code)
    { scripCode: 100,  tradingSymbol: '',          instType: 'EQ' }, // excluded (no symbol)
  ];
  const map = buildScripCodeMap(masterData);
  assert.equal(map.get('EXIDEIND'), 676);
  assert.equal(map.get('ITC'), 1660);
  assert.equal(map.has('NIFTY-FUT'), false);
  assert.equal(map.has('BADSCRIPT'), false);
  assert.equal(map.size, 2);
});

test('loadScripCache returns null when file does not exist', () => {
  const tmp = path.join(os.tmpdir(), `sk_test_${Date.now()}.json`);
  assert.equal(loadScripCache(tmp), null);
});

test('saveScripCache and loadScripCache round-trip preserves symbol→code map', () => {
  const tmp = path.join(os.tmpdir(), `sk_test_${Date.now()}.json`);
  const map = new Map([['EXIDEIND', 676], ['ITC', 1660]]);
  saveScripCache(map, tmp);
  const loaded = loadScripCache(tmp);
  assert.ok(loaded instanceof Map);
  assert.equal(loaded.get('EXIDEIND'), 676);
  assert.equal(loaded.get('ITC'), 1660);
  assert.equal(loaded.size, 2);
  fs.unlinkSync(tmp); // cleanup
});

test('loadScripCache returns null when cache is expired (past TTL)', () => {
  const tmp = path.join(os.tmpdir(), `sk_test_${Date.now()}.json`);
  // Write cache with savedAt in the past (25 hours ago)
  const expired = { savedAt: Date.now() - (25 * 60 * 60 * 1000), symbols: { EXIDEIND: 676 } };
  fs.writeFileSync(tmp, JSON.stringify(expired), 'utf8');
  assert.equal(loadScripCache(tmp), null);
  fs.unlinkSync(tmp); // cleanup
});

test('loadScripCache returns null when symbols key is null or missing', () => {
  const tmp = path.join(os.tmpdir(), `sk_test_${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), symbols: null }), 'utf8');
  assert.equal(loadScripCache(tmp), null);
  fs.unlinkSync(tmp);
});

test('normalizeSharekhanCandles returns null for empty/invalid input', () => {
  assert.equal(normalizeSharekhanCandles('EXIDEIND', null), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', ''), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', []), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', 'not-json'), null);
});

test('normalizeSharekhanCandles converts candle array to Yahoo-compatible result', () => {
  const candles = [
    { time: '2026-06-27T04:15:00.000Z', open: 390.0, high: 392.0, low: 389.0, close: 391.0, volume: 10000 },
    { time: '2026-06-27T04:20:00.000Z', open: 391.0, high: 393.0, low: 390.5, close: 392.5, volume: 12000 },
    { time: '2026-06-27T04:25:00.000Z', open: 392.5, high: 394.0, low: 391.5, close: 393.0, volume: 8000  },
  ];
  const result = normalizeSharekhanCandles('EXIDEIND', candles);
  assert.ok(result, 'result must not be null');
  assert.ok(Array.isArray(result.timestamp), 'must have timestamp array');
  assert.equal(result.timestamp.length, 3);
  assert.ok(Number.isFinite(result.timestamp[0]));
  assert.deepEqual(result.indicators.quote[0].open,   [390.0, 391.0, 392.5]);
  assert.deepEqual(result.indicators.quote[0].high,   [392.0, 393.0, 394.0]);
  assert.deepEqual(result.indicators.quote[0].low,    [389.0, 390.5, 391.5]);
  assert.deepEqual(result.indicators.quote[0].close,  [391.0, 392.5, 393.0]);
  assert.deepEqual(result.indicators.quote[0].volume, [10000, 12000, 8000]);
  assert.equal(result.meta.regularMarketPrice, 393.0);
  assert.equal(result.meta.regularMarketOpen,  390.0);
  assert.equal(result.meta.previousClose,      null);
});

test('normalizeSharekhanCandles sorts candles ascending by timestamp (reverse-order input)', () => {
  const candles = [
    { time: '2026-06-27T04:25:00.000Z', open: 392.5, high: 394.0, low: 391.5, close: 393.0, volume: 8000  },
    { time: '2026-06-27T04:20:00.000Z', open: 391.0, high: 393.0, low: 390.5, close: 392.5, volume: 12000 },
    { time: '2026-06-27T04:15:00.000Z', open: 390.0, high: 392.0, low: 389.0, close: 391.0, volume: 10000 },
  ];
  const result = normalizeSharekhanCandles('EXIDEIND', candles);
  assert.ok(result);
  assert.equal(result.meta.regularMarketOpen,  390.0);
  assert.equal(result.meta.regularMarketPrice, 393.0);
  assert.equal(result.indicators.quote[0].open[0],  390.0);
  assert.equal(result.indicators.quote[0].close[2], 393.0);
  assert.ok(result.timestamp[0] < result.timestamp[1]);
  assert.ok(result.timestamp[1] < result.timestamp[2]);
});

test('normalizeSharekhanCandles handles alternate field names (o/h/l/c/v, dt)', () => {
  const candles = [
    { dt: 1782542000, o: 100.0, h: 105.0, l: 99.0, c: 103.0, v: 5000 },
    { dt: 1782542300, o: 103.0, h: 106.0, l: 102.0, c: 105.0, v: 6000 },
  ];
  const result = normalizeSharekhanCandles('ITC', candles);
  assert.ok(result);
  assert.equal(result.timestamp[0], 1782542000);
  assert.equal(result.indicators.quote[0].open[0], 100.0);
  assert.equal(result.indicators.quote[0].close[1], 105.0);
});

test('normalizeSharekhanCandles deduplicates by timestamp (keeps last occurrence)', () => {
  const candles = [
    { time: '2026-06-27T04:15:00.000Z', open: 390.0, high: 392.0, low: 389.0, close: 391.0, volume: 10000 },
    { time: '2026-06-27T04:15:00.000Z', open: 395.0, high: 397.0, low: 394.0, close: 396.0, volume: 15000 },
  ];
  const result = normalizeSharekhanCandles('TEST', candles);
  assert.equal(result.timestamp.length, 1);
  assert.equal(result.indicators.quote[0].open[0], 395.0);
  assert.equal(result.indicators.quote[0].volume[0], 15000);
});
