const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISABLE_AUTO_INIT = '1';
const proxy = require('../ticker_proxy');
const validate = proxy.__test__.resolveValidatedSharekhanIndexChangeForTests;

test('Sharekhan index validation ignores ambiguous absolute change field', () => {
  const result = validate('nifty50', { change: -1.93 }, 24055.7, { price: 24056.95, change: 0.73 }, {});
  assert.ok(result.change > 0.7 && result.change < 0.75);
});

test('Sharekhan index validation advances cached change when a tick contains only LTP', () => {
  const result = validate('nifty50', { ltp: 24080 }, 24080, { price: 24000, change: 0.5 }, {});
  assert.ok(result.change > 0.83 && result.change < 0.84);
  assert.equal(result.reason, '');
});

test('Sharekhan index validation prefers price-derived percentage over corrupt direct percentage', () => {
  const result = validate(
    'nifty50',
    { pChange: -1.93, previousClose: 23882 },
    24055.7,
    { change: 0.73 },
    { midcap: { change: 0.7 }, banknifty: { change: 0.99 } }
  );
  assert.ok(result.change > 0.7 && result.change < 0.75);
  assert.match(result.reason, /disagrees/);
});

test('Sharekhan index validation retains cached change on peer-direction conflict', () => {
  const result = validate(
    'nifty50',
    { pChange: -1.93 },
    24055.7,
    { change: 0.73 },
    { midcap: { change: 0.7 }, banknifty: { change: 0.99 } }
  );
  assert.equal(result.change, 0.73);
});
