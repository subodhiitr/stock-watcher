const test = require('node:test');
const assert = require('node:assert/strict');
const Backtest = require('../backtest_simulation.js');

test('dated replay selects the requested SQLite trading day without a file fallback', () => {
  const selected = Backtest.parseArgs(['--day', '2026-07-24']);
  assert.equal(selected.day, '2026-07-24');
  assert.equal(selected.file, undefined);
});

test('dated snapshot loading does not load and filter every available day', async () => {
  const startedAt = Date.now();
  const snapshots = await Backtest.readSnapshots(null, '2026-07-24');
  const elapsedMs = Date.now() - startedAt;

  assert.ok(snapshots.length > 0);
  assert.ok(snapshots.every(snapshot => Backtest.istDateKey(snapshot.at) === '2026-07-24'));
  assert.ok(elapsedMs < 10000, `expected one-day snapshot loading under 10s, got ${elapsedMs}ms`);
});
