const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseShareholding, createShareholdingService } = require('../server/stock-shareholding');
const attribute = (name, rows) => `data-${name}BarChart="${JSON.stringify(rows).replaceAll('"', '&quot;')}"`;
const fixture = attribute('promoter', [['Quarter', 'Promoter Holding (%)', { role: 'annotation' }, 'Pledges as % of promoter shares (%)'], ['Jun 2026', 59.43, '', 0], ['Mar 2026', 59.44, '', 0.02], ['Jan 15, 2026', 99], ['Dec 2025', null]]) + attribute('fii', [['Quarter', 'Holding (%)'], ['Mar 2026', 19.51], ['Jun 2026', 19.03]]) + attribute('mf', [['Quarter', 'Holding (%)'], ['Jun 2026', 9.06], ['Mar 2026', 8.30]]);

test('joins categories by quarter, omits off-quarter filings, preserves zero and missing values', () => {
  const rows = parseShareholding(fixture);
  assert.deepEqual(rows.map(row => row.period), ['Mar 2026', 'Jun 2026']);
  assert.equal(rows[0].pledge, .02);
  assert.equal(rows[1].pledge, 0);
  assert.equal(rows[1].mf, 9.06);
  assert.equal(rows[0].fii, 19.51);
  assert.deepEqual(parseShareholding('<html>Unavailable</html>'), []);
});
test('uses the pledge table dates and excludes public pledged shares', () => {
  const html = attribute('promoter', [['Quarter', 'Promoter Holding (%)'], ['Jun 2026', 50], ['Mar 2026', 49]]) + `<table id="shareSummaryTable"><thead><tr><th>Summary</th><th>Mar 2026</th><th>Jun 2026</th></tr></thead><tbody><tr class="Promoter-holding"><td>Pledged</td><td>0.02%</td><td>--</td></tr><tr class="Public-holding"><td>Pledged</td><td>99%</td><td>99%</td></tr></tbody></table>`;
  assert.deepEqual(parseShareholding(html).map(row => row.pledge), [.02, null]);
});
test('keeps only five chronological quarters and rejects invalid percentages', () => {
  const rows = parseShareholding(attribute('mf', [['Quarter', 'Holding (%)'], ...['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'].map(period => [period, 5])]) + attribute('fii', [['Quarter', 'Holding (%)'], ['Jun 2026', 101], ['Mar 2026', ''], ['Dec 2025', -1]]));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].period, 'Jun 2025');
  assert.ok(rows.every(row => row.fii === null));
});
const search = [{ country: 'IND', NSEcode: 'TEST', urls: [['Share Holding', 'https://trendlyne.com/equity/share-holding/1/TEST/latest/test/']] }];
test('matches exact NSE symbol, coalesces requests and expires cache', async () => {
  let calls = 0, time = 1000;
  const service = createShareholdingService({ now: () => time, minRequestGapMs: 0, cacheTtlMs: 100, fetchImpl: async url => {
    calls++;
    return { ok: true, text: async () => url.includes('/member/') ? JSON.stringify([{ ...search[0], NSEcode: 'TEST2' }, ...search]) : fixture };
  } });
  const [a, b] = await Promise.all([service.load('test'), service.load('TEST')]);
  assert.equal(calls, 2);
  assert.deepEqual(a, b);
  await service.load('TEST');
  assert.equal(calls, 2);
  time += 101;
  await service.load('TEST');
  assert.equal(calls, 4);
  await assert.rejects(service.load('../bad'), /Invalid/);
});
test('provider failures are retryable and near symbol matches are rejected', async () => {
  let failed = true;
  const service = createShareholdingService({ minRequestGapMs: 0, fetchImpl: async url => ({ ok: !failed, status: 503, text: async () => url.includes('/member/') ? JSON.stringify(search) : fixture }) });
  await assert.rejects(service.load('TEST'), /503/);
  failed = false;
  assert.equal((await service.load('TEST')).quarters.length, 2);
  await assert.rejects(service.load('TEST2'), /unavailable/);
});

const source = fs.readFileSync(require.resolve('../dashboard-app.js'), 'utf8');
const functions = source.slice(source.indexOf('function ownershipChange('), source.indexOf('function renderStockHistory('));
test('summaries use full precision, percentage points, unchanged and missing latest values', () => {
  const context = vm.createContext({});
  vm.runInContext(functions, context);
  const change = context.ownershipChange(parseShareholding(fixture), 'promoter', 'Promoters');
  assert.match(change.text, /59.44% to 59.43%/);
  assert.match(change.text, /-0.01 percentage points/);
  assert.equal(change.tone, 'decrease');
  assert.match(context.ownershipChange([{ mf: 0 }, { mf: 0, period: 'Jun 2026' }], 'mf', 'MF').text, /remained at 0.00%/);
  assert.match(context.ownershipChange([{ mf: 10 }, { mf: null }], 'mf', 'MF').text, /not reported/);
});
test('ownership renders alongside unavailable price data and exposes exact values', () => {
  const target = {};
  const context = vm.createContext({ stockHistoryState: { ownership: { quarters: parseShareholding(fixture), source: 'Trendlyne', sourceUrl: search[0].urls[0][1] } }, document: { getElementById: () => target }, escapeHTML: value => String(value) });
  vm.runInContext(functions + ';renderStockOwnership()', context);
  assert.equal((target.innerHTML.match(/<svg /g) || []).length, 3);
  assert.match(target.innerHTML, /59.43/);
  assert.match(target.innerHTML, /View exact percentages/);
});
test('late ownership responses never replace the newly selected stock', async () => {
  const requests = [];
  const context = vm.createContext({ stockHistoryState: { request: 1, symbol: 'OLD', controller: new AbortController() }, PROXY: '', document: { getElementById: () => ({}) }, escapeHTML: String, fetch: url => new Promise(resolve => requests.push({ url, resolve })) });
  vm.runInContext(functions, context);
  const first = context.loadStockOwnership();
  context.stockHistoryState = { request: 2, symbol: 'NEW', controller: new AbortController() };
  const second = context.loadStockOwnership();
  requests[1].resolve({ ok: true, json: async () => ({ symbol: 'NEW', quarters: [] }) });
  await second;
  requests[0].resolve({ ok: true, json: async () => ({ symbol: 'OLD', quarters: [] }) });
  await first;
  assert.equal(context.stockHistoryState.ownership.symbol, 'NEW');
});
test('shareholding endpoint is forwarded by the UI server', async () => {
  const { shouldProxyPath } = await import('../my-remix-app/proxy-routes.ts');
  assert.equal(shouldProxyPath('/stock-shareholding'), true);
});
