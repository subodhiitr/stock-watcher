'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Backtest = require('../backtest_simulation');
const { createSnapshotDatabase } = require('../server/snapshot-db');
const { snapshotDiagnostics } = require('../server/strategy-advisor');
const { withSnapshotFixture } = require('./fixtures/sqlite-snapshot-fixture');

const root = path.join(__dirname, '..');

test('Replay worker loads a requested day through the database-backed Backtest loader', () => {
  const source = fs.readFileSync(path.join(root, 'replay_worker.js'), 'utf8');
  assert.match(source, /Backtest\.readSnapshots\(null, day\)/);
  assert.doesNotMatch(source, /getDailySnapshotFile|simulation_snapshots_.*\.json|fs\.existsSync\(file\)/);
});

test('Strategy Advisor is wired directly to the dedicated snapshot database', () => {
  const source = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');
  assert.match(source, /loadSnapshots:day => getSimulationSnapshotDatabase\(\)\.loadDay\(day\)/);
  assert.doesNotMatch(source, /loadSnapshots:day => loadSimulationSnapshotsFile/);
});

test('Replay reads the migrated SQLite snapshot day', async () => {
  await withSnapshotFixture(['2026-07-31'], async fixture => {
    const store = createSnapshotDatabase({ dbPath:fixture.dbPath });
    let expected;
    try {
      expected = store.countDay('2026-07-31');
    } finally {
      store.close();
    }
    assert.ok(expected > 0, 'expected migrated snapshots for 2026-07-31');
    const snapshots = await Backtest.readSnapshots(null, '2026-07-31');
    assert.equal(snapshots.length, expected);
  });
});

test('Strategy Advisor diagnostics consume the migrated SQLite snapshot day', () => {
  return withSnapshotFixture(['2026-07-31'], fixture => {
    const store = createSnapshotDatabase({ dbPath:fixture.dbPath });
    try {
      const snapshots = store.loadDay('2026-07-31');
      const diagnostics = snapshotDiagnostics(snapshots, {});
      assert.ok(snapshots.length > 0);
      assert.equal(diagnostics.snapshots, snapshots.length);
      assert.ok(diagnostics.candidateRows > 0);
    } finally {
      store.close();
    }
  });
});
