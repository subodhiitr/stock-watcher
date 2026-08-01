const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISABLE_AUTO_INIT = '1';
const proxy = require('../ticker_proxy');
const validate = proxy.__test__.resolveValidatedSharekhanIndexChangeForTests;
const reanchor = proxy.__test__.reanchorSharekhanIndicesForTests;

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

test('fresh Yahoo quotes re-anchor live Sharekhan index percentages after a pre-market start', () => {
  const result = reanchor(
    {
      nifty50: { price: 24149.35, change: -0.76 },
      midcap: { price: 23035.4, change: 0.29 },
    },
    {
      nifty50: { price: 24148.1, change: 0.244, source: 'sharekhan-ws', updatedAt: '2026-07-20T07:21:33.839Z' },
      midcap: { price: 23032.9, change: -0.135, source: 'sharekhan-ws', updatedAt: '2026-07-20T07:21:33.535Z' },
    }
  );

  assert.equal(result.nifty50.price, 24148.1);
  assert.equal(result.nifty50.change, -0.765);
  assert.equal(result.midcap.price, 23032.9);
  assert.equal(result.midcap.change, 0.279);
  assert.equal(result.nifty50.source, 'sharekhan-ws');
  assert.equal(result.midcap.source, 'sharekhan-ws');
});

test('non-Sharekhan index quotes use the fresh Yahoo values unchanged', () => {
  const fresh = {
    nifty50: { price: 24149.35, change: -0.76 },
    midcap: { price: 23035.4, change: 0.29 },
  };
  assert.deepEqual(reanchor(fresh, {
    nifty50: { price: 24000, change: 1, source: 'yahoo' },
  }), fresh);
});

test('Midcap re-anchoring prefers the explicit previous close over a stale percentage', () => {
  const result = reanchor(
    { midcap:{ price:22940, change:-1.05, previousClose:22705.69 } },
    { midcap:{ price:22685.25, change:-0.1, source:'sharekhan-ws' } }
  );
  assert.equal(result.midcap.previousClose, 22705.69);
  assert.equal(result.midcap.change, -0.09);
});

test('index previous close is frozen for the IST session and resets on the next day', () => {
  proxy.__test__.resetFrozenIndexPreviousClosesForTests();
  const freeze = proxy.__test__.applyFrozenIndexPreviousClosesForTests;
  const opened = freeze(
    { midcap:{ price:22935.15, previousClose:22933.05, source:'sharekhan-ws' } },
    '2026-07-28T03:46:00.000Z'
  );
  assert.equal(opened.midcap.previousClose, 22933.05);

  const corrupted = freeze(
    { midcap:{ price:22949.2, previousClose:22685.2, source:'sharekhan-ws' } },
    '2026-07-28T07:32:00.000Z'
  );
  assert.equal(corrupted.midcap.previousClose, 22933.05);
  assert.equal(corrupted.midcap.change, 0.07);
  assert.match(corrupted.midcap.changeValidation, /rejected mid-session previous close/);

  const nextDay = freeze(
    { midcap:{ price:23000, previousClose:22931.45, source:'sharekhan-ws' } },
    '2026-07-29T03:46:00.000Z'
  );
  assert.equal(nextDay.midcap.previousClose, 22931.45);
});
