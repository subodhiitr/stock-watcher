const test = require('node:test');
const assert = require('node:assert/strict');
const SharekhanClient = require('../sharekhan-client');

test('fetchRawCandles retries transient Sharekhan 500 responses', async () => {
  const client = new SharekhanClient({ accessToken:'test-token' });
  client.historicalRequestSpacingMs = 0;
  client.historicalRetryBaseMs = 0;
  let calls = 0;
  client.client = {
    async getHistoricalIntervalData() {
      calls += 1;
      if (calls < 3) return { status:500, message:'Error' };
      return {
        status:200,
        data:[{ tradeDate:'17/7/2026', tradeTime:'09:19:58', open:100, high:102, low:99, close:101, qty:500 }],
      };
    },
  };

  const candles = await client.fetchRawCandles('NC', 2955, '5minute');

  assert.equal(calls, 3);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 101);
});

test('fetchRawCandles stops after bounded transient retries', async () => {
  const client = new SharekhanClient({ accessToken:'test-token' });
  client.historicalRequestSpacingMs = 0;
  client.historicalRetryBaseMs = 0;
  client.historicalRetryLimit = 3;
  let calls = 0;
  client.client = {
    async getHistoricalIntervalData() {
      calls += 1;
      return { status:500, message:'Error' };
    },
  };

  await assert.rejects(
    () => client.fetchRawCandles('NC', 2955, '5minute'),
    /SHAREKHAN_SERVER_ERROR_500/,
  );
  assert.equal(calls, 3);
});
