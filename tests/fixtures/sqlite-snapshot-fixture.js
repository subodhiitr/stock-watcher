'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSnapshotDatabase } = require('../../server/snapshot-db');

function fixtureSnapshot(day, minute = 15) {
  const at = `${day}T03:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id:`fixture-${day}-${minute}`,
    at,
    source:'sqlite-fixture',
    candidates:[{
      symbol:'FIXTURE',
      price:100,
      signal:'buy',
      score:75,
      setupType:'FIXTURE_SETUP',
    }],
  };
}

function createSnapshotFixture(days) {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshots-'));
  const store = createSnapshotDatabase({ dbPath:path.join(snapshotDir, 'simulation_snapshots.db') });
  try {
    for (const day of days) {
      store.replaceDay(day, [fixtureSnapshot(day, 45)]);
    }
  } finally {
    store.close();
  }
  return {
    snapshotDir,
    dbPath:path.join(snapshotDir, 'simulation_snapshots.db'),
    cleanup() {
      fs.rmSync(snapshotDir, { recursive:true, force:true });
    },
  };
}

async function withSnapshotFixture(days, callback) {
  const fixture = createSnapshotFixture(days);
  const previous = process.env.STOCK_WATCHER_SNAPSHOT_DIR;
  process.env.STOCK_WATCHER_SNAPSHOT_DIR = fixture.snapshotDir;
  try {
    return await callback(fixture);
  } finally {
    if (previous === undefined) delete process.env.STOCK_WATCHER_SNAPSHOT_DIR;
    else process.env.STOCK_WATCHER_SNAPSHOT_DIR = previous;
    fixture.cleanup();
  }
}

module.exports = { createSnapshotFixture, withSnapshotFixture };
