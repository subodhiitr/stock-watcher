const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freshNewsRefreshDateKeys,
  mergeFreshNewsDayEntries,
  freshNewsCronDelayMs,
} = require('../server/fresh-news');

test('fresh-news refresh targets weekend date in addition to previous business day', () => {
  assert.deepEqual(
    Array.from(freshNewsRefreshDateKeys(new Date('2026-06-27T05:00:00.000Z'))),
    ['2026-06-26', '2026-06-27']
  );
});

test('fresh-news refresh on Sunday includes Saturday and Sunday plus previous business day', () => {
  assert.deepEqual(
    Array.from(freshNewsRefreshDateKeys(new Date('2026-06-28T05:00:00.000Z'))),
    ['2026-06-26', '2026-06-27', '2026-06-28']
  );
});

test('fresh-news refresh on weekday includes today plus previous business day', () => {
  assert.deepEqual(
    Array.from(freshNewsRefreshDateKeys(new Date('2026-06-24T05:00:00.000Z'))),
    ['2026-06-24', '2026-06-23']
  );
});

test('fresh-news scheduler includes weekend refresh slots', () => {
  const delayMs = freshNewsCronDelayMs(new Date('2026-06-26T11:00:00.000Z'));
  assert.equal(delayMs, 18 * 60 * 60 * 1000);
});

test('fresh-news default weekend response merges previous business day and weekend items', () => {
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
