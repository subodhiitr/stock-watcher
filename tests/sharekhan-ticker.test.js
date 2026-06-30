'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { buildYahooShapeFromCandles } = require('../sharekhan-intraday');

test('buildYahooShapeFromCandles returns null for empty input', () => {
  assert.equal(buildYahooShapeFromCandles('TEST', []), null);
});

test('buildYahooShapeFromCandles returns correct Yahoo-shape', () => {
  const candles = [
    { unixSec: 1000, open: 100, high: 105, low: 99, close: 103, vol: 500 },
    { unixSec: 1300, open: 103, high: 107, low: 102, close: 106, vol: 800 },
  ];
  const result = buildYahooShapeFromCandles('TEST', candles);
  assert.ok(result);
  assert.deepEqual(result.timestamp, [1000, 1300]);
  assert.deepEqual(result.indicators.quote[0].open,  [100, 103]);
  assert.deepEqual(result.indicators.quote[0].close, [103, 106]);
  assert.equal(result.meta.regularMarketPrice, 106);
  assert.equal(result.meta.regularMarketOpen, 100);
  assert.equal(result.meta.previousClose, null);
});

const { parseTickTime } = require('../sharekhan-ticker');

test('parseTickTime floors to 5-min bar start (unix seconds)', () => {
  // "06/30/2026 09:32:45" IST = 04:02:45 UTC → bar start 04:00:00 UTC
  const result = parseTickTime('06/30/2026 09:32:45');
  assert.ok(result !== null);
  const barStart = parseTickTime('06/30/2026 09:30:00'); // 04:00 UTC
  assert.equal(result, barStart);
  // Verify it's actually 04:00 UTC on that date
  assert.equal(new Date(result * 1000).toISOString(), '2026-06-30T04:00:00.000Z');
});

test('parseTickTime returns different bar for different 5-min window', () => {
  const bar1 = parseTickTime('06/30/2026 09:30:00');
  const bar2 = parseTickTime('06/30/2026 09:35:00');
  assert.ok(bar1 !== null && bar2 !== null);
  assert.equal(bar2 - bar1, 300); // 5 minutes = 300 seconds
});

test('parseTickTime returns null for invalid input', () => {
  assert.equal(parseTickTime(null), null);
  assert.equal(parseTickTime('0'), null);
  assert.equal(parseTickTime('bad'), null);
});

const { SharekhanTicker } = require('../sharekhan-ticker');

test('processTick builds first candle from tick (open = first ltp)', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 1000, lastUpdatedTime: '06/30/2026 09:30:10' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.ok(Array.isArray(candles) && candles.length === 1);
  assert.equal(candles[0].open, 100);
  assert.equal(candles[0].close, 100);
  assert.equal(candles[0].high, 100);
  assert.equal(candles[0].low, 100);
});

test('processTick updates same candle for same 5-min bar', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 108, qty: 700, lastUpdatedTime: '06/30/2026 09:32:45' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].open, 100);   // first ltp in bar
  assert.equal(candles[0].close, 108);  // last ltp in bar
  assert.equal(candles[0].high, 108);
  assert.equal(candles[0].low, 100);
  assert.equal(candles[0].vol, 700);    // latest cumulative qty
});

test('processTick closes bar and opens new one on 5-min boundary', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 106, qty: 900, lastUpdatedTime: '06/30/2026 09:35:20' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].close, 100);  // closed bar
  assert.equal(candles[1].open, 106);   // new bar open = first ltp
  assert.equal(candles[1].close, 106);
});

test('getCandlesWithOpenBar returns null for unknown scripCode', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  assert.equal(ticker.getCandlesWithOpenBar(9999), null);
});

test('onCandleUpdate callback is called on tick', () => {
  let called = false;
  let cbSym, cbCandles;
  const ticker = new SharekhanTicker({
    accessToken: 'fake',
    scripToSymbol: new Map([[2885, 'RELIANCE']]),
    onCandleUpdate: (sym, candles) => { called = true; cbSym = sym; cbCandles = candles; },
  });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  assert.ok(called);
  assert.equal(cbSym, 'RELIANCE');
  assert.ok(Array.isArray(cbCandles) && cbCandles.length === 1);
});

test('start opens direct Sharekhan websocket and sends subscription/feed on open', () => {
  const sent = [];
  let openedUrl = '';
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super();
      openedUrl = url;
      this.readyState = 1;
    }
    send(payload) { sent.push(JSON.parse(payload)); }
    close() {}
  }

  const ticker = new SharekhanTicker({
    accessToken: 'token with spaces',
    reconnectDelayMs: 60_000,
    webSocketFactory: url => new FakeSocket(url),
  });
  ticker.subscribe([2885]);
  ticker.start();
  ticker._ws.emit('open');

  assert.equal(openedUrl, 'wss://stream.sharekhan.com/skstream/api/stream?ACCESS_TOKEN=token%20with%20spaces');
  assert.deepEqual(sent[0], { action: 'subscribe', key: ['feed'], value: [''] });
  assert.deepEqual(sent[1], { action: 'feed', key: ['ltp'], value: ['NC2885'] });
  ticker.stop();
});

test('unexpected websocket HTTP response schedules reconnect without throwing', () => {
  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
    }
    send() {}
    close() {}
  }

  const ticker = new SharekhanTicker({
    accessToken: 'fake',
    reconnectDelayMs: 60_000,
    webSocketFactory: () => new FakeSocket(),
  });
  ticker.start();
  assert.doesNotThrow(() => {
    ticker._ws.emit('unexpected-response', null, {
      statusCode: 200,
      statusMessage: 'OK',
      resume() {},
    });
  });
  assert.equal(ticker._connected, false);
  assert.ok(ticker._reconnectTimer);
  ticker.stop();
});

test('missing access token does not create reconnect loop', () => {
  let created = false;
  const ticker = new SharekhanTicker({
    accessToken: '',
    reconnectDelayMs: 1,
    webSocketFactory: () => {
      created = true;
      throw new Error('should not create socket without token');
    },
  });

  ticker.start();

  assert.equal(created, false);
  assert.equal(ticker._reconnectTimer, null);
  assert.equal(ticker._connected, false);
});

