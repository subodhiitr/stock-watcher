const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Sharekhan-only polling retains expired ticks without making their timestamps fresh', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
  const start = source.indexOf('async function fetchIntradaySignal(');
  const end = source.indexOf('\nconst AMC_RULES', start);
  const receivedAt = Date.now() - 6 * 60000;
  const signal = { price: 100, dataSource: 'sharekhan-ws', _updatedAt: receivedAt };
  const context = vm.createContext({
    Date, INTRADAY_SIGNAL_TTL: 120000,
    intradaySignalCache: { ABC: { v: signal, t: receivedAt } },
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.fetchIntradaySignal('ABC', { sources: { sharekhan: true, yahoo: false } });
  assert.equal(result, signal);
  assert.equal(result._updatedAt, receivedAt);
  assert.equal(await context.fetchIntradaySignal('MISSING', { sources: { sharekhan: true, yahoo: false } }), null);
  assert.equal(await context.fetchIntradaySignal('ABC', { sources: { sharekhan: false, yahoo: false } }), null);
});

test('a tick arriving during a poll survives an empty polling result', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
  const start = source.indexOf("async function refreshIntradayLiveCache(reason = 'interval')");
  const end = source.indexOf('\nfunction getIntradayDataSourceSettings', start);
  const live = new Map([['ABC', { price: 100 }]]);
  let finish;
  const context = vm.createContext({
    isIstWeekend: () => false, intradayLiveRefreshInFlight: false,
    getIntradayDataSourceSettings: () => ({ sharekhan: true, yahoo: false }),
    getIntradayLiveUniverseSymbols: () => ['ABC'], CONCURRENCY: 4,
    intradayLiveCache: live,
    fetchIntradaySignal: () => new Promise(resolve => { finish = resolve; }),
    getIntradayLiveRefreshIntervalSec: () => 900, INTRADAY_LIVE_REFRESH_MARKET_SEC: 60,
  });
  vm.runInContext(source.slice(start, end), context);
  const pending = context.refreshIntradayLiveCache();
  const tick = { price: 102, dataSource: 'sharekhan-ws' };
  live.set('ABC', tick);
  finish(null);
  await pending;
  assert.equal(live.get('ABC'), tick);
});

function harness(httpsGet) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
  const start = source.indexOf('async function pushSharekhanTickerCandles(');
  const end = source.indexOf('\nasync function fetchIntradaySignal', start);
  const context = vm.createContext({
    console, httpsGet, Date, Promise,
    getIntradayDataSourceSettings: () => ({ sharekhan: true }),
    buildYahooShapeFromCandles: (sym, candles) => ({ meta: {}, price: candles[0] }),
    getIstDateKey: () => 'today', resolveNseSymbol: sym => sym,
    SHAREKHAN_DAILY_CONTEXT_TTL_MS: 60000, YAHOO_HEADERS: {},
    sharekhanDailyContextCache: new Map(), sharekhanDailyContextPending: new Map(),
    sharekhanMarketDepthCache: new Map(), intradaySignalCache: {}, intradayLiveCache: new Map(),
    pickChartPreviousClose: () => 99,
    buildDailyTradeContext: () => ({ prevDayClose: 99 }),
    buildIntradaySignal: (sym, result, daily) => ({ price: result.price, previousClose: daily.prevDayClose }),
    normalizeIntradayLiveSignal: (sym, signal) => ({ ...signal }),
    hasIntradaySignalMaterialChange: () => true,
    broadcastIntradayLive: () => {}, triggerSimulationTickAfterScoreUpdate: () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('slow daily history cannot block ticks, duplicate requests, or overwrite newer prices', async () => {
  let resolveHistory;
  let requests = 0;
  const c = harness(() => { requests++; return new Promise(resolve => { resolveHistory = resolve; }); });
  await c.pushSharekhanTickerCandles('ABC', [100]);
  assert.equal(c.intradayLiveCache.get('ABC').price, 100);
  await c.pushSharekhanTickerCandles('ABC', [102]);
  assert.equal(c.intradayLiveCache.get('ABC').price, 102);
  assert.equal(requests, 1);
  resolveHistory({ status: 200, body: JSON.stringify({ chart: { result: [{ meta: { previousClose: 99 } }] } }) });
  await c.sharekhanDailyContextPending.get('ABC');
  assert.equal(c.intradayLiveCache.get('ABC').price, 102);
  await c.pushSharekhanTickerCandles('ABC', [103]);
  assert.equal(c.intradayLiveCache.get('ABC').previousClose, 99);
  assert.equal(requests, 1);
  assert.equal(c.sharekhanDailyContextPending.size, 0);
});

test('failed history requests leave the live price available and suppress immediate retry storms', async () => {
  let requests = 0;
  const c = harness(async () => { requests++; throw new Error('timeout'); });
  await c.pushSharekhanTickerCandles('ABC', [100]);
  await c.sharekhanDailyContextPending.get('ABC');
  const count = requests;
  await c.pushSharekhanTickerCandles('ABC', [101]);
  assert.equal(c.intradayLiveCache.get('ABC').price, 101);
  assert.equal(c.intradayLiveCache.get('ABC').dataSource, 'sharekhan-ws');
  assert.equal(requests, count);
  assert.equal(c.sharekhanDailyContextPending.size, 0);
});
