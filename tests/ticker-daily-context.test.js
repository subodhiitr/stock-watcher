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

test('buildDailyTradeContext uses chart previous close when a null daily row precedes current session', () => {
  const context = proxy.__test__.buildDailyTradeContextForTests({
    meta: {
      previousClose: 108.5,
    },
    indicators: {
      quote: [{
        high: [105, 122.66, null, 108.79],
        low: [95, 104.3, null, 103.65],
        close: [102.22, 120.55, null, 106.36],
        volume: [1000, 70931051, null, 1754375],
      }],
    },
  });

  assert.equal(context.prevDayClose, 108.5);
});

test('buildDailyTradeContext does not use monthly chartPreviousClose as previous day close', () => {
  const context = proxy.__test__.buildDailyTradeContextForTests({
    meta: {
      chartPreviousClose: 84.49,
    },
    indicators: {
      quote: [{
        high: [105, 122.66, null, 108.79],
        low: [95, 104.3, null, 103.65],
        close: [102.22, 120.55, null, 106.36],
        volume: [1000, 70931051, null, 1754375],
      }],
    },
  });

  assert.equal(context.prevDayClose, 120.55);
});

test('pickChartPreviousClose accepts short-chart chartPreviousClose fallback', () => {
  const previousClose = proxy.__test__.pickChartPreviousCloseForTests({
    meta: {
      chartPreviousClose: 108.5,
    },
  });

  assert.equal(previousClose, 108.5);
});
