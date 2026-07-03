const test = require('node:test');
const assert = require('node:assert/strict');

const proxy = require('../ticker_proxy');

test('buildDailyTradeContext uses latest completed day when daily chart ends with null close', () => {
  const context = proxy.__test__.buildDailyTradeContextForTests({
    indicators: {
      quote: [{
        high: [105, 112, 120],
        low: [95, 101, 110],
        close: [100, 110, null],
        volume: [1000, 1500, 900],
      }],
    },
  });

  assert.equal(context.prevDayHigh, 112);
  assert.equal(context.prevDayLow, 101);
  assert.equal(context.prevDayClose, 110);
});

test('buildDailyTradeContext still uses the prior row when the current day close is present', () => {
  const context = proxy.__test__.buildDailyTradeContextForTests({
    indicators: {
      quote: [{
        high: [105, 112, 120],
        low: [95, 101, 110],
        close: [100, 110, 118],
        volume: [1000, 1500, 900],
      }],
    },
  });

  assert.equal(context.prevDayHigh, 112);
  assert.equal(context.prevDayLow, 101);
  assert.equal(context.prevDayClose, 110);
});
