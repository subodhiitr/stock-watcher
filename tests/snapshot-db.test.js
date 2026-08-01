'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { createSnapshotDatabase } = require('../server/snapshot-db');

function snapshot(id, at, symbol = 'SBIN') {
  return {
    id,
    at,
    source:'test',
    candidates:[{ symbol, price:100 }],
    candidateCount:1,
  };
}

test('snapshot database appends compressed rows and replaces only the same time bucket', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshot-db-'));
  const dbPath = path.join(dir, 'simulation_snapshots.db');
  const store = createSnapshotDatabase({ dbPath });
  try {
    const day = '2026-07-31';
    assert.equal(store.appendSnapshot(day, snapshot('first', '2026-07-31T04:00:05.000Z')).count, 1);
    assert.equal(store.appendSnapshot(day, snapshot('newer-in-bucket', '2026-07-31T04:01:55.000Z', 'TCS')).count, 1);
    assert.equal(store.appendSnapshot(day, snapshot('next-bucket', '2026-07-31T04:02:05.000Z')).count, 2);

    const loaded = store.loadDay(day);
    assert.deepEqual(loaded.map(row => row.id), ['newer-in-bucket', 'next-bucket']);
    assert.equal(loaded[0].candidates[0].symbol, 'TCS');

    const raw = new Database(dbPath, { readonly:true });
    try {
      const row = raw.prepare('SELECT payload, payload_encoding FROM simulation_snapshots LIMIT 1').get();
      assert.equal(row.payload_encoding, 'gzip-json');
      assert.deepEqual([...row.payload.subarray(0, 2)], [0x1f, 0x8b]);
    } finally {
      raw.close();
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('snapshot database supports indexed day reads, versions, and retention pruning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshot-db-'));
  const dbPath = path.join(dir, 'simulation_snapshots.db');
  const store = createSnapshotDatabase({ dbPath });
  try {
    store.importSnapshots('2026-07-29', [snapshot('old', '2026-07-29T04:00:00.000Z')]);
    store.importSnapshots('2026-07-31', [snapshot('recent', '2026-07-31T04:00:00.000Z')]);

    assert.equal(store.latestDay(), '2026-07-31');
    assert.deepEqual(store.listDays().map(row => row.date), ['2026-07-31', '2026-07-29']);
    assert.match(store.version('2026-07-31'), /^1:/);

    const now = Date.parse('2026-08-01T04:00:00.000Z');
    assert.equal(store.prune(2, now), 1);
    assert.equal(store.hasDay('2026-07-29'), false);
    assert.equal(store.hasDay('2026-07-31'), true);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('snapshot writer appends directly to SQLite without a legacy archive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshot-worker-'));
  const dbPath = path.join(dir, 'simulation_snapshots.db');
  try {
    const worker = new Worker(path.join(__dirname, '..', 'server', 'snapshot-writer-worker.js'), {
      workerData:{
        dbFile:dbPath,
        date:'2026-07-31',
        snapshot:snapshot('new', '2026-07-31T04:02:00.000Z', 'TCS'),
        retentionDays:30,
        bucketMs:2 * 60 * 1000,
      },
    });
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`worker exited with ${code}`)); });
    });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);

    const store = createSnapshotDatabase({ dbPath });
    try {
      assert.deepEqual(store.loadDay('2026-07-31').map(row => row.id), ['new']);
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
