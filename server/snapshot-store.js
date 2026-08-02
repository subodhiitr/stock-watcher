'use strict';

const path = require('node:path');
const { createSnapshotDatabase } = require('./snapshot-db');

const DEFAULT_SNAPSHOT_DIR = path.join(process.cwd(), 'snapshots');

function snapshotDatabasePath(snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  return path.join(snapshotDir, 'simulation_snapshots.db');
}

function withSnapshotDatabase(snapshotDir, callback) {
  const store = createSnapshotDatabase({ dbPath:snapshotDatabasePath(snapshotDir) });
  try { return callback(store); }
  finally { store.close(); }
}

async function saveSnapshotDay(date, data, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
  return withSnapshotDatabase(snapshotDir, store => store.replaceDay(date, snapshots));
}

async function loadSnapshotDay(date, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  const snapshots = withSnapshotDatabase(snapshotDir, store => store.loadDay(date));
  if (!snapshots.length) throw new Error(`Snapshot not found for date ${date}`);
  return { savedAt:Date.now(), date, storage:'sqlite', snapshots };
}

async function listSnapshotDays(snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  return withSnapshotDatabase(snapshotDir, store => store.listDays().map(row => row.date));
}

async function pruneOldSnapshots(retentionDays, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  return withSnapshotDatabase(snapshotDir, store => store.prune(retentionDays));
}

module.exports = { saveSnapshotDay, loadSnapshotDay, listSnapshotDays, pruneOldSnapshots, snapshotDatabasePath };
