const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

function loadFreshNewsHelpers(fakeNowIso) {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  class FakeDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : fakeNowIso);
    }
    static now() {
      return new Date(fakeNowIso).getTime();
    }
  }
  const context = {
    Date: FakeDate,
    FRESH_NEWS_CRON_TIMES_IST: ['10:30', '15:45'],
  };
  const module = { exports: {} };
  vm.runInNewContext(`
    ${extractFunctionSource(source, 'lastBusinessDateKey')}
    ${extractFunctionSource(source, 'freshNewsDateKey')}
    ${extractFunctionSource(source, 'freshNewsRefreshDateKeys')}
    ${extractFunctionSource(source, 'dedupeFreshNewsItems')}
    ${extractFunctionSource(source, 'mergeFreshNewsDayEntries')}
    ${extractFunctionSource(source, 'freshNewsCronDelayMs')}
    module.exports = { freshNewsRefreshDateKeys, mergeFreshNewsDayEntries, freshNewsCronDelayMs };
  `, { ...context, module });
  return module.exports;
}

test('fresh-news refresh targets weekend date in addition to previous business day', () => {
  const { freshNewsRefreshDateKeys } = loadFreshNewsHelpers('2026-06-27T05:00:00.000Z'); // Sat 10:30 IST
  assert.deepEqual(Array.from(freshNewsRefreshDateKeys()), ['2026-06-26', '2026-06-27']);
});

test('fresh-news refresh on Sunday includes Saturday and Sunday plus previous business day', () => {
  const { freshNewsRefreshDateKeys } = loadFreshNewsHelpers('2026-06-28T05:00:00.000Z'); // Sun 10:30 IST
  assert.deepEqual(Array.from(freshNewsRefreshDateKeys()), ['2026-06-26', '2026-06-27', '2026-06-28']);
});

test('fresh-news refresh on weekday includes today plus previous business day', () => {
  const { freshNewsRefreshDateKeys } = loadFreshNewsHelpers('2026-06-24T05:00:00.000Z'); // Wed 10:30 IST
  assert.deepEqual(Array.from(freshNewsRefreshDateKeys()), ['2026-06-24', '2026-06-23']);
});

test('fresh-news scheduler includes weekend refresh slots', () => {
  const { freshNewsCronDelayMs } = loadFreshNewsHelpers('2026-06-26T11:00:00.000Z'); // Fri 16:30 IST
  const delayMs = freshNewsCronDelayMs();
  assert.equal(delayMs, 18 * 60 * 60 * 1000);
});

test('fresh-news default weekend response merges previous business day and weekend items', () => {
  const { mergeFreshNewsDayEntries } = loadFreshNewsHelpers('2026-06-27T05:00:00.000Z');
  const merged = mergeFreshNewsDayEntries([
    {
      ok: true,
      date: '2026-06-26',
      savedAt: 100,
      builtInMs: 10,
      scanned: 2,
      count: 1,
      symbolCount: 1,
      source: 'nse-market-wide+symbol-announcements',
      items: [{ symbol: 'ABC', title: 'Friday item', tradeImpactAbs: 10 }],
      errors: [],
    },
    {
      ok: true,
      date: '2026-06-27',
      savedAt: 200,
      builtInMs: 20,
      scanned: 2,
      count: 1,
      symbolCount: 1,
      source: 'nse-market-wide+symbol-announcements',
      items: [{ symbol: 'PRICOLLTD', title: 'Demerger item', tradeImpactAbs: 80 }],
      errors: [],
    },
  ]);

  assert.equal(merged.date, '2026-06-26+2026-06-27');
  assert.equal(merged.count, 2);
  assert.equal(merged.symbolCount, 2);
  assert.deepEqual(Array.from(merged.items.map(item => item.symbol)), ['PRICOLLTD', 'ABC']);
});
