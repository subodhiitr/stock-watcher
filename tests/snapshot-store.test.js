import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  saveSnapshotDay,
  loadSnapshotDay,
  listSnapshotDays,
  pruneOldSnapshots,
} from '../server/snapshot-store.js';

const TEST_SNAPSHOT_DIR = path.join(process.cwd(), 'test-snapshots');

// Helper to clean up test snapshots
function cleanupTestDir() {
  if (fs.existsSync(TEST_SNAPSHOT_DIR)) {
    fs.rmSync(TEST_SNAPSHOT_DIR, { recursive: true });
  }
}

test('saveSnapshotDay writes compressed snapshot and loadSnapshotDay reads it back', async () => {
  cleanupTestDir();
  
  const date = '2024-01-15';
  const testData = {
    trades: [{ id: 1, symbol: 'SBIN', quantity: 10 }],
    prices: { SBIN: 1500, TCS: 3500 },
  };

  // Save snapshot
  await saveSnapshotDay(date, testData, TEST_SNAPSHOT_DIR);

  // Verify .gz file exists
  const gzPath = path.join(TEST_SNAPSHOT_DIR, `snapshot-${date}.json.gz`);
  assert.ok(fs.existsSync(gzPath), `Compressed file should exist at ${gzPath}`);

  // Load it back
  const loaded = await loadSnapshotDay(date, TEST_SNAPSHOT_DIR);
  assert.deepStrictEqual(loaded, testData, 'Loaded data should match saved data');

  cleanupTestDir();
});

test('loadSnapshotDay falls back to legacy .json when .gz is missing', async () => {
  cleanupTestDir();
  
  const date = '2024-01-10';
  const legacyData = {
    trades: [{ id: 2, symbol: 'TCS', quantity: 5 }],
    prices: { TCS: 3500 },
  };

  // Write legacy uncompressed .json
  fs.mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
  const jsonPath = path.join(TEST_SNAPSHOT_DIR, `snapshot-${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(legacyData));

  // Load should fall back to legacy
  const loaded = await loadSnapshotDay(date, TEST_SNAPSHOT_DIR);
  assert.deepStrictEqual(loaded, legacyData, 'Should load legacy .json when .gz missing');

  cleanupTestDir();
});

test('listSnapshotDays returns available snapshot dates sorted descending', async () => {
  cleanupTestDir();

  const dates = ['2024-01-15', '2024-01-10', '2024-01-20'];
  const testData = { trades: [], prices: {} };

  // Save multiple snapshots
  for (const date of dates) {
    await saveSnapshotDay(date, testData, TEST_SNAPSHOT_DIR);
  }

  // List snapshots
  const listed = await listSnapshotDays(TEST_SNAPSHOT_DIR);
  
  // Should be sorted descending
  const expected = ['2024-01-20', '2024-01-15', '2024-01-10'];
  assert.deepStrictEqual(listed, expected, 'Dates should be sorted descending');

  cleanupTestDir();
});

test('pruneOldSnapshots deletes snapshots older than retention days', async () => {
  cleanupTestDir();

  const now = new Date();
  const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
  const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
  
  const oldDateStr = oldDate.toISOString().split('T')[0];
  const recentDateStr = recentDate.toISOString().split('T')[0];

  const testData = { trades: [], prices: {} };

  // Save old and recent snapshots
  fs.mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
  
  await saveSnapshotDay(oldDateStr, testData, TEST_SNAPSHOT_DIR);
  await saveSnapshotDay(recentDateStr, testData, TEST_SNAPSHOT_DIR);

  // Verify both exist
  const beforePrune = await listSnapshotDays(TEST_SNAPSHOT_DIR);
  assert.strictEqual(beforePrune.length, 2, 'Should have 2 snapshots before pruning');

  // Prune with 30-day retention
  await pruneOldSnapshots(30, TEST_SNAPSHOT_DIR);

  // Verify old one deleted, recent one kept
  const afterPrune = await listSnapshotDays(TEST_SNAPSHOT_DIR);
  assert.deepStrictEqual(afterPrune, [recentDateStr], 'Old snapshot should be deleted, recent kept');

  cleanupTestDir();
});
