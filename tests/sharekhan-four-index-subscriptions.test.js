const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Sharekhan subscription map includes all four dashboard indices', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');

  for (const key of ['nifty50', 'midcap', 'smallcap', 'banknifty']) {
    assert.match(source, new RegExp(`key:'${key}'`));
  }
  assert.match(source, /SHAREKHAN_SMALLCAP100_SCRIP_CODE/);
  assert.match(source, /SHAREKHAN_BANKNIFTY_SCRIP_CODE/);
  assert.match(source, /candidates:\['NIFTYSML100FREE'/);
  assert.match(source, /candidates:\['NIFTYBANK'/);
  assert.match(source, /sharekhanTicker\.subscribe\(\[\.\.\.symToCode\.values\(\), \.\.\.sharekhanIndexCodeMap\.keys\(\)\]\)/);
});
