'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createSnapshotDatabase } = require('./snapshot-db');

async function run() {
  const {
    dbFile,
    date,
    snapshot,
    retentionDays,
    bucketMs,
  } = workerData;
  const startedAt = Date.now();
  let store = null;
  try {
    store = createSnapshotDatabase({ dbPath:dbFile });
    const result = store.appendSnapshot(date, snapshot, bucketMs);
    store.prune(retentionDays);
    parentPort.postMessage({ ok:true, count:result.count, bytes:result.bytes, durationMs:Date.now() - startedAt });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error?.message || String(error), durationMs: Date.now() - startedAt });
  } finally {
    try { store?.close(); } catch (_) {}
  }
}

run();
