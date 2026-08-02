'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createSnapshotDatabase } = require('../server/snapshot-db');
const { migrate } = require('../server/migrate-snapshot-files');

function writeArchive(dir, date) {
  const file = path.join(dir, `simulation_snapshots_${date}.json.gz`);
  const payload = {
    date,
    snapshots:[{ id:date, at:`${date}T04:00:00.000Z`, candidates:[] }],
  };
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(payload)));
  return file;
}

test('migration selects recent weekdays, verifies database rows, and deletes only migrated sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-snapshot-migration-'));
  const dbPath = path.join(dir, 'simulation_snapshots.db');
  const friday = writeArchive(dir, '2026-07-31');
  const thursday = writeArchive(dir, '2026-07-30');
  const saturday = writeArchive(dir, '2026-07-25');
  try {
    const result = migrate({ days:2, deleteSource:true, includeWeekends:false, snapshotDir:dir, dbPath });
    assert.deepEqual(result.dates, ['2026-07-31', '2026-07-30']);
    assert.equal(fs.existsSync(friday), false);
    assert.equal(fs.existsSync(thursday), false);
    assert.equal(fs.existsSync(saturday), true);

    const store = createSnapshotDatabase({ dbPath });
    try {
      assert.deepEqual(store.listDays().map(row => row.date), ['2026-07-31', '2026-07-30']);
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
