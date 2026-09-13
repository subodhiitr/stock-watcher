const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseListedStocks, parseUpcoming, createIpoCalendarService } = require('../server/ipo-calendar');
const fs = require('node:fs');
const vm = require('node:vm');
test('new IPO filter participates in filtering alongside existing filters', () => {
  const source = fs.readFileSync(require.resolve('../dashboard-app.js'), 'utf8');
  const groups = source.slice(source.indexOf('function getStockFilterGroups()'), source.indexOf('function countRowsForStockFilters('));
  const filter = vm.runInNewContext(`${groups}; applyStockFilters`);
  const rows = [{ sym: 'NEW' }, { sym: 'OLD' }];
  assert.deepEqual(filter(rows, new Set(['newipo']), { newipo: row => row.sym === 'NEW' }), [rows[0]]);
});

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const csv = `SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING\nNEW,"New, Ltd",EQ,${today}\nOLD,Old Ltd,EQ,01-Jan-2000\nFUTURE,Future,EQ,01-Jan-2099\nFUND,Fund,BE,${today}`;
test('new listings respect date window, quoted names and equity series', () => {
  const rows = parseListedStocks(csv, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'New, Ltd');
  assert.throws(() => parseListedStocks('<html>blocked</html>'), /Invalid/);
});
test('upcoming excludes closed historical issues and permits missing symbols', () => {
  const rows = parseUpcoming([{ companyName: 'Next', issueEndDate: '01-Jan-2099' }, { companyName: 'Past', issueEndDate: '01-Jan-2000' }], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Next');
});
test('NSE calendar dates retain their day in India and missing listing dates remain unknown', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    const [row] = parseUpcoming([{ companyName: 'Example', issueStartDate: '08-Sep-2026', issueEndDate: '10-Sep-2026' }], Date.UTC(2026, 8, 6));
    assert.equal(row.openDate, '2026-09-08');
    assert.equal(row.closeDate, '2026-09-10');
    assert.equal(row.listingDate, null);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test('refresh adds only missing listed stocks and coalesces concurrent requests', async () => {
  let fetches = 0;
  const stocks = [];
  const service = createIpoCalendarService({ fetchListings: async () => { fetches++; return csv; }, fetchUpcoming: async () => [], getStocks: () => stocks, addStocks: rows => stocks.push(...rows) });
  await Promise.all([service.refresh(), service.refresh()]);
  await service.refresh();
  assert.equal(fetches, 1);
  assert.equal(stocks.length, 1);
  const existing = createIpoCalendarService({ fetchListings: async () => csv, fetchUpcoming: async () => [], getStocks: () => stocks, addStocks: () => assert.fail('must not overwrite existing') });
  await existing.refresh();
});
test('feed failures retain cached records and expose stale status', async () => {
  const service = createIpoCalendarService({ readCache: () => ({ listed: [], upcoming: [{ name: 'Cached' }], updatedAt: 0 }), fetchListings: async () => { throw Error('offline'); }, fetchUpcoming: async () => { throw Error('offline'); }, getStocks: () => [], addStocks: () => assert.fail() });
  const result = await service.refresh();
  assert.match(result.error, /offline/);
  assert.equal(result.upcoming[0].name, 'Cached');
  assert.equal(result.updatedAt, 0);
});
