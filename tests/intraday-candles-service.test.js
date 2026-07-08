const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeYahooCandles,
  createIntradayCandlesService,
} = require('../server/intraday-candles');

test('normalizeYahooCandles converts Yahoo 5m chart response to OHLC candles', () => {
  const result = normalizeYahooCandles('TCS', '2d', {
    chart: {
      result: [{
        timestamp: [1783496700, 1783497000],
        indicators: {
          quote: [{
            open: [3400, 3402],
            high: [3405, 3408],
            low: [3398, 3400],
            close: [3402, 3406],
            volume: [1200, 1800],
          }],
        },
      }],
    },
  });

  assert.equal(result.symbol, 'TCS');
  assert.equal(result.interval, '5m');
  assert.equal(result.range, '2d');
  assert.deepEqual(result.candles, [
    { time: '2026-07-08T07:45:00.000Z', open: 3400, high: 3405, low: 3398, close: 3402, volume: 1200 },
    { time: '2026-07-08T07:50:00.000Z', open: 3402, high: 3408, low: 3400, close: 3406, volume: 1800 },
  ]);
});

test('normalizeYahooCandles drops invalid zero and extreme outlier candles', () => {
  const result = normalizeYahooCandles('INDIGO', '1d', {
    chart: {
      result: [{
        timestamp: [1783496700, 1783497000, 1783497300, 1783497600],
        indicators: {
          quote: [{
            open: [5200, 5198, 0, 5195],
            high: [5220, 5205, 1, 5200],
            low: [5180, 5190, 0.5, -10],
            close: [5198, 5195, 0.8, 5197],
            volume: [1200, 1800, 2000, 1500],
          }],
        },
      }],
    },
  });

  assert.deepEqual(result.candles.map(c => c.close), [5198, 5195]);
});

test('intraday candles route fetches Yahoo 5m candles for requested range', async () => {
  const calls = [];
  const service = createIntradayCandlesService({
    resolveNseSymbol: symbol => symbol,
    httpsGet: async options => {
      calls.push(options);
      return {
        status: 200,
        body: JSON.stringify({
          chart: {
            result: [{
              timestamp: [1783496700],
              indicators: { quote: [{ open: [100], high: [102], low: [99], close: [101], volume: [500] }] },
            }],
          },
        }),
      };
    },
    yahooHeaders: { Accept: 'application/json' },
  });
  const chunks = [];
  const req = { method: 'GET' };
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { chunks.push(body); },
  };

  const handled = await service.handleRoute(req, res, '/intraday-candles', new URLSearchParams('symbol=TCS&range=2d'));
  const payload = JSON.parse(chunks.join(''));

  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.symbol, 'TCS');
  assert.equal(payload.candles.length, 1);
  assert.match(calls[0].path, /interval=5m/);
  assert.match(calls[0].path, /range=2d/);
});
