import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveSnapshotDay,
  loadSnapshotDay,
  listSnapshotDays,
  pruneOldSnapshots,
} from '../server/snapshot-store.js';

function tempSnapshotDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshot-store-'));
}

function snapshot(id, date) {
  return { id, at:`${date}T04:00:00.000Z`, candidates:[] };
}

test('snapshot store saves and loads a database-backed trading day', async () => {
  const dir = tempSnapshotDir();
  try {
    const date = '2026-07-31';
    await saveSnapshotDay(date, { snapshots:[snapshot('one', date)] }, dir);
    const loaded = await loadSnapshotDay(date, dir);
    assert.equal(loaded.storage, 'sqlite');
    assert.deepEqual(loaded.snapshots.map(row => row.id), ['one']);
    assert.equal(fs.existsSync(path.join(dir, 'simulation_snapshots.db')), true);
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.json') || name.endsWith('.json.gz')), false);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('snapshot store does not fall back to a legacy archive', async () => {
  const dir = tempSnapshotDir();
  try {
    fs.writeFileSync(path.join(dir, 'simulation_snapshots_2026-07-31.json'), JSON.stringify({ snapshots:[snapshot('legacy', '2026-07-31')] }));
    await assert.rejects(() => loadSnapshotDay('2026-07-31', dir), /Snapshot not found/);
    assert.deepEqual(await listSnapshotDays(dir), []);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('snapshot store lists database dates and prunes expired rows', async () => {
  const dir = tempSnapshotDir();
  try {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const recentDate = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    await saveSnapshotDay(oldDate, { snapshots:[snapshot('old', oldDate)] }, dir);
    await saveSnapshotDay(recentDate, { snapshots:[snapshot('recent', recentDate)] }, dir);
    assert.deepEqual(await listSnapshotDays(dir), [recentDate, oldDate]);
    await pruneOldSnapshots(30, dir);
    assert.deepEqual(await listSnapshotDays(dir), [recentDate]);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
