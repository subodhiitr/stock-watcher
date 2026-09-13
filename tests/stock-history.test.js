const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHistory, createStockHistoryService } = require('../server/stock-history');

test('history excludes missing and invalid closes without losing date alignment', () => {
  assert.deepEqual(parseHistory({ timestamp: [1, 2, 3, 4, 5], indicators: { quote: [{ close: [10, null, 12, 0, -1] }] } }), [{ time: 1000, close: 10 }, { time: 3000, close: 12 }]);
});

test('history coalesces requests, caches data and preserves dated corporate actions', async () => {
  let calls = 0;
  let time = 0;
  const service = createStockHistoryService({ now: () => time, fetchChart: async () => {
    calls++;
    return { timestamp: [1, 2], indicators: { quote: [{ close: [100, 101] }] }, events: { dividends: { one: { date: 2, amount: 5 } }, splits: { two: { date: 1, splitRatio: '2:1' } } } };
  } });
  const [a, b] = await Promise.all([service.load('TCS'), service.load('TCS')]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.events.length, 2);
  assert.equal(a.events[0].date, '1970-01-01T00:00:02.000Z');
  await service.load('TCS');
  assert.equal(calls, 1);
  time = 16 * 60 * 1000;
  await service.load('TCS');
  assert.equal(calls, 2);
  await assert.rejects(service.load('../secret'), /Invalid/);
});

test('failed history is retryable and is not cached', async () => {
  let calls = 0;
  const service = createStockHistoryService({ fetchChart: async () => { calls++; return {}; } });
  await assert.rejects(service.load('TCS'), /unavailable/);
  await assert.rejects(service.load('TCS'), /unavailable/);
  assert.equal(calls, 2);
});

const source = fs.readFileSync(require.resolve('../dashboard-app.js'), 'utf8');
const rangeFunction = source.slice(source.indexOf('function stockHistoryRange('), source.indexOf('function ensureStockHistoryModal('));
test('one month clamps end-of-month and includes only selected period', () => {
  const range = vm.runInNewContext(`${rangeFunction};stockHistoryRange`);
  const prices = ['2026-02-27', '2026-02-28', '2026-03-31'].map(date => ({ time: Date.parse(date), close: 100 }));
  assert.deepEqual(Array.from(range(prices, 1), row => row.time), prices.slice(1).map(row => row.time));
  assert.equal(range(prices, 6).length, 3);
  assert.equal(range([], 12).length, 0);
});

test('event details escape markup and reject unsafe source links', () => {
  const detail = {};
  const fn = source.slice(source.indexOf('function showStockHistoryEvent('), source.indexOf('function renderStockHistory('));
  vm.runInNewContext(`${fn};showStockHistoryEvent(0)`, {
    document: { getElementById: () => detail },
    stockHistoryState: { groups: [[{ title: '<img src=x>', date: '2026-09-01', url: 'javascript:alert(1)', category: 'News' }]] },
    escapeHTML: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  assert.ok(detail.innerHTML.includes('&lt;img'));
  assert.ok(!detail.innerHTML.includes('javascript:'));
});

test('late responses from a previous stock cannot replace the active chart', async () => {
  const requests = [];
  const context = vm.createContext({
    AbortController, PROXY: '', document: { activeElement: {} },
    stockHistoryState: { request: 0 },
    ensureStockHistoryModal: () => ({ open: true }), renderStockHistory() {}, loadStockOwnership() {},
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
  });
  const fn = source.slice(source.indexOf('async function openStockHistory('), source.indexOf('function stockTrendButton('));
  vm.runInContext(fn, context);
  const first = context.openStockHistory('TCS');
  const second = context.openStockHistory('RELIANCE');
  for (const request of requests.slice(2)) request.resolve({ ok: true, json: async () => ({ prices: [{ close: 200 }], events: [], coverage: 'current' }) });
  await second;
  for (const request of requests.slice(0, 2)) request.resolve({ ok: true, json: async () => ({ prices: [{ close: 1 }], events: [{ title: 'stale' }] }) });
  await first;
  assert.equal(context.stockHistoryState.symbol, 'RELIANCE');
  assert.equal(context.stockHistoryState.prices[0].close, 200);
  assert.equal(context.stockHistoryState.events.length, 0);
});
