const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildScripCodeMap, loadScripCache, saveScripCache } = require('../sharekhan-intraday');

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
