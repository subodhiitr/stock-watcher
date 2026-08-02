'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');

const DEFAULT_BUCKET_MS = 2 * 60 * 1000;

function snapshotTime(snapshot) {
  const value = new Date(snapshot?.at || snapshot?.savedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function decodePayload(row) {
  try {
    const buffer = Buffer.isBuffer(row?.payload) ? row.payload : Buffer.from(row?.payload || '');
    const json = row?.payload_encoding === 'gzip-json'
      ? zlib.gunzipSync(buffer).toString('utf8')
      : buffer.toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`Could not decode snapshot ${row?.id || '(unknown)'}: ${error.message}`);
  }
}

function readLegacySnapshotFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const buffer = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  const parsed = JSON.parse(text || '{}');
  return {
    ...parsed,
    snapshots:Array.isArray(parsed?.snapshots) ? parsed.snapshots : [],
  };
}

function createSnapshotDatabase(options = {}) {
  const dbPath = path.resolve(String(options.dbPath || path.join(process.cwd(), 'snapshots', 'simulation_snapshots.db')));
  fs.mkdirSync(path.dirname(dbPath), { recursive:true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_snapshots (
      id TEXT PRIMARY KEY,
      trading_date TEXT NOT NULL,
      snapshot_at INTEGER NOT NULL,
      bucket INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      candidate_count INTEGER NOT NULL DEFAULT 0,
      payload BLOB NOT NULL,
      payload_encoding TEXT NOT NULL DEFAULT 'gzip-json',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (trading_date, bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_simulation_snapshots_date_at
      ON simulation_snapshots (trading_date, snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_simulation_snapshots_at
      ON simulation_snapshots (snapshot_at);
  `);

  const insert = db.prepare(`
    INSERT INTO simulation_snapshots (
      id, trading_date, snapshot_at, bucket, source, candidate_count,
      payload, payload_encoding, created_at, updated_at
    ) VALUES (
      @id, @tradingDate, @snapshotAt, @bucket, @source, @candidateCount,
      @payload, 'gzip-json', @now, @now
    )
    ON CONFLICT (trading_date, bucket) DO UPDATE SET
      id = excluded.id,
      snapshot_at = excluded.snapshot_at,
      source = excluded.source,
      candidate_count = excluded.candidate_count,
      payload = excluded.payload,
      payload_encoding = excluded.payload_encoding,
      updated_at = excluded.updated_at
    WHERE excluded.snapshot_at >= simulation_snapshots.snapshot_at
  `);
  const loadDayRows = db.prepare(`
    SELECT id, payload, payload_encoding
    FROM simulation_snapshots
    WHERE trading_date = ?
    ORDER BY snapshot_at ASC
  `);
  const loadAllRows = db.prepare(`
    SELECT id, payload, payload_encoding
    FROM simulation_snapshots
    ORDER BY snapshot_at ASC
  `);
  const countDay = db.prepare('SELECT COUNT(*) AS count FROM simulation_snapshots WHERE trading_date = ?');
  const listDays = db.prepare(`
    SELECT trading_date AS date, COUNT(*) AS count, MAX(snapshot_at) AS latestAt
    FROM simulation_snapshots
    GROUP BY trading_date
    ORDER BY trading_date DESC
  `);
  const latestDay = db.prepare('SELECT MAX(trading_date) AS date FROM simulation_snapshots');
  const deleteDay = db.prepare('DELETE FROM simulation_snapshots WHERE trading_date = ?');
  const deleteBefore = db.prepare('DELETE FROM simulation_snapshots WHERE snapshot_at < ?');
  const version = db.prepare(`
    SELECT COUNT(*) AS count, MAX(snapshot_at) AS latestAt, MAX(updated_at) AS updatedAt,
           COALESCE(SUM(LENGTH(payload)), 0) AS bytes
    FROM simulation_snapshots
    WHERE (? IS NULL OR trading_date = ?)
  `);

  function encode(snapshot, tradingDate, bucketMs = DEFAULT_BUCKET_MS) {
    const snapshotAt = snapshotTime(snapshot);
    if (!snapshotAt) throw new Error('Snapshot requires a valid at or savedAt timestamp');
    const id = String(snapshot?.id || `${snapshotAt}-${Math.random().toString(36).slice(2, 8)}`);
    const normalized = snapshot?.id ? snapshot : { ...snapshot, id };
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify(normalized)));
    return {
      id,
      tradingDate,
      snapshotAt,
      bucket:Math.floor(snapshotAt / Math.max(1, Number(bucketMs) || DEFAULT_BUCKET_MS)),
      source:String(snapshot?.source || ''),
      candidateCount:Number(snapshot?.candidateCount) || (Array.isArray(snapshot?.candidates) ? snapshot.candidates.length : 0),
      payload,
      now:Date.now(),
    };
  }

  function appendSnapshot(tradingDate, snapshot, bucketMs = DEFAULT_BUCKET_MS) {
    const row = encode(snapshot, tradingDate, bucketMs);
    const result = insert.run(row);
    return {
      changed:result.changes > 0,
      id:row.id,
      bytes:row.payload.length,
      count:Number(countDay.get(tradingDate)?.count || 0),
    };
  }

  const importTransaction = db.transaction((tradingDate, snapshots, bucketMs) => {
    for (const snapshot of snapshots) insert.run(encode(snapshot, tradingDate, bucketMs));
    return Number(countDay.get(tradingDate)?.count || 0);
  });

  function importSnapshots(tradingDate, snapshots, bucketMs = DEFAULT_BUCKET_MS) {
    return importTransaction(tradingDate, Array.isArray(snapshots) ? snapshots : [], bucketMs);
  }

  const replaceTransaction = db.transaction((tradingDate, snapshots, bucketMs) => {
    deleteDay.run(tradingDate);
    for (const snapshot of snapshots) insert.run(encode(snapshot, tradingDate, bucketMs));
    return Number(countDay.get(tradingDate)?.count || 0);
  });

  return {
    path:dbPath,
    appendSnapshot,
    importSnapshots,
    replaceDay(tradingDate, snapshots, bucketMs = DEFAULT_BUCKET_MS) {
      return replaceTransaction(tradingDate, Array.isArray(snapshots) ? snapshots : [], bucketMs);
    },
    loadDay(tradingDate) {
      return loadDayRows.all(tradingDate).map(decodePayload);
    },
    loadAll() {
      return loadAllRows.all().map(decodePayload);
    },
    countDay(tradingDate) {
      return Number(countDay.get(tradingDate)?.count || 0);
    },
    hasDay(tradingDate) {
      return Number(countDay.get(tradingDate)?.count || 0) > 0;
    },
    listDays() {
      return listDays.all();
    },
    latestDay() {
      return latestDay.get()?.date || '';
    },
    prune(retentionDays, now = Date.now()) {
      const cutoff = Number(now) - (Math.max(0, Number(retentionDays) || 0) * 24 * 60 * 60 * 1000);
      return deleteBefore.run(cutoff).changes;
    },
    version(tradingDate = null) {
      const selected = tradingDate || null;
      const row = version.get(selected, selected);
      return `${row?.count || 0}:${row?.latestAt || 0}:${row?.updatedAt || 0}:${row?.bytes || 0}`;
    },
    close() {
      db.close();
    },
  };
}

module.exports = {
  DEFAULT_BUCKET_MS,
  createSnapshotDatabase,
  readLegacySnapshotFile,
  snapshotTime,
};
