const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateCandles,
  limitCandlesToRange,
  normalizeYahooCandles,
  createIntradayCandlesService,
} = require('../server/intraday-candles');

test('aggregateCandles combines aligned 5m bars into a 15m OHLCV candle', () => {
  const result = aggregateCandles([
    { time:'2026-07-08T03:45:00.000Z', open:100, high:103, low:99, close:102, volume:100 },
    { time:'2026-07-08T03:50:00.000Z', open:102, high:105, low:101, close:104, volume:200 },
    { time:'2026-07-08T03:55:00.000Z', open:104, high:106, low:103, close:105, volume:300 },
  ], '15m');

  assert.deepEqual(result, [{
    time:'2026-07-08T03:45:00.000Z', open:100, high:106, low:99, close:105, volume:600,
  }]);
});

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

test('Today is restricted to the current IST date while multi-day ranges keep latest sessions', () => {
  const candles = [
    { time:'2026-07-06T03:45:00.000Z', close:100 },
    { time:'2026-07-07T03:45:00.000Z', close:101 },
    { time:'2026-07-08T03:45:00.000Z', close:102 },
  ];
  const now = Date.parse('2026-07-08T04:30:00.000Z');
  assert.deepEqual(limitCandlesToRange(candles, '1d', now).map(c => c.close), [102]);
  assert.deepEqual(limitCandlesToRange(candles, '2d', now).map(c => c.close), [101, 102]);
  assert.deepEqual(limitCandlesToRange(candles.slice(0, 2), '1d', now), []);
});

test('intraday candles use Sharekhan historical 5m data before Yahoo', async () => {
  let yahooCalls = 0;
  const service = createIntradayCandlesService({
    now:() => Date.parse('2026-07-08T04:30:00.000Z'),
    resolveNseSymbol: symbol => symbol,
    fetchSharekhanCandles: async symbol => ({
      timestamp:[1783482300, 1783482600],
      indicators:{ quote:[{
        open:[100, 102], high:[103, 105], low:[99, 101], close:[102, 104], volume:[100, 200],
      }] },
      meta:{ regularMarketPrice:104 },
      symbol,
    }),
    httpsGet: async () => {
      yahooCalls += 1;
      throw new Error('Yahoo should not be called');
    },
  });

  const payload = await service.fetchCandles('TCS', '1d', '5m');

  assert.equal(payload.source, 'sharekhan-historical');
  assert.equal(payload.interval, '5m');
  assert.equal(payload.candles.length, 2);
  assert.equal(payload.candles[1].close, 104);
  assert.equal(yahooCalls, 0);
});

test('intraday candles fall back to Yahoo when Sharekhan history is empty', async () => {
  let yahooCalls = 0;
  const service = createIntradayCandlesService({
    now:() => Date.parse('2026-07-08T04:30:00.000Z'),
    resolveNseSymbol: symbol => symbol,
    fetchSharekhanCandles: async () => null,
    httpsGet: async () => {
      yahooCalls += 1;
      return {
        status:200,
        body:JSON.stringify({ chart:{ result:[{
          timestamp:[1783482300],
          indicators:{ quote:[{ open:[100], high:[103], low:[99], close:[102], volume:[100] }] },
        }] } }),
      };
    },
  });

  const payload = await service.fetchCandles('TCS', '1d', '5m');

  assert.equal(payload.source, 'yahoo');
  assert.equal(payload.fallbackFrom, 'sharekhan-historical');
  assert.equal(payload.candles.length, 1);
  assert.equal(yahooCalls, 1);
});

test('during market hours stale Sharekhan history falls back to current Yahoo candles', async () => {
  let yahooCalls = 0;
  const service = createIntradayCandlesService({
    now:() => Date.parse('2026-07-08T04:30:00.000Z'),
    resolveNseSymbol:symbol => symbol,
    fetchSharekhanCandles:async () => ({
      timestamp:[1783395900],
      indicators:{ quote:[{ open:[98], high:[100], low:[97], close:[99], volume:[100] }] },
    }),
    httpsGet:async () => {
      yahooCalls += 1;
      return {
        status:200,
        body:JSON.stringify({ chart:{ result:[{
          timestamp:[1783482300],
          indicators:{ quote:[{ open:[100], high:[103], low:[99], close:[102], volume:[200] }] },
        }] } }),
      };
    },
  });

  const payload = await service.fetchCandles('TCS', '1d', '5m');

  assert.equal(payload.source, 'yahoo');
  assert.equal(payload.candles.length, 1);
  assert.equal(payload.candles[0].close, 102);
  assert.match(payload.fallbackReason, /current IST session/);
  assert.equal(yahooCalls, 1);
});

test('Today returns no previous-session candles before market open', async () => {
  const service = createIntradayCandlesService({
    now:() => Date.parse('2026-07-08T02:30:00.000Z'),
    resolveNseSymbol:symbol => symbol,
    httpsGet:async () => ({
      status:200,
      body:JSON.stringify({ chart:{ result:[{
        timestamp:[1783395900],
        indicators:{ quote:[{ open:[98], high:[100], low:[97], close:[99], volume:[100] }] },
      }] } }),
    }),
  });

  const payload = await service.fetchCandles('TCS', '1d', '5m');

  assert.equal(payload.source, 'yahoo');
  assert.deepEqual(payload.candles, []);
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

test('intraday candles route returns requested 15m aggregation', async () => {
  const service = createIntradayCandlesService({
    now:() => Date.parse('2026-07-08T04:30:00.000Z'),
    resolveNseSymbol: symbol => symbol,
    httpsGet: async () => ({
      status:200,
      body:JSON.stringify({ chart:{ result:[{
        timestamp:[1783482300, 1783482600, 1783482900],
        indicators:{ quote:[{ open:[100,102,104], high:[103,105,106], low:[99,101,103], close:[102,104,105], volume:[100,200,300] }] },
      }] } }),
    }),
  });
  const chunks = [];
  const res = { writeHead(status) { this.status = status; }, end(body) { chunks.push(body); } };
  await service.handleRoute({ method:'GET' }, res, '/intraday-candles', new URLSearchParams('symbol=TCS&range=1d&interval=15m'));
  const payload = JSON.parse(chunks.join(''));

  assert.equal(payload.interval, '15m');
  assert.equal(payload.candles.length, 1);
  assert.equal(payload.candles[0].volume, 600);
});
