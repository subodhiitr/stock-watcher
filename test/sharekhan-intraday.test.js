const test = require('node:test');
const assert = require('node:assert/strict');

const { buildScripCodeMap } = require('../sharekhan-intraday');

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
