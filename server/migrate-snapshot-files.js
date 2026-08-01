#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_BUCKET_MS,
  createSnapshotDatabase,
  readLegacySnapshotFile,
  snapshotTime,
} = require('./snapshot-db');

function parseArgs(argv) {
  const options = { days:15, deleteSource:false, includeWeekends:false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--days') options.days = Number(argv[++index]);
    else if (arg === '--snapshot-dir') options.snapshotDir = argv[++index];
    else if (arg === '--database') options.dbPath = argv[++index];
    else if (arg === '--delete-source') options.deleteSource = true;
    else if (arg === '--include-weekends') options.includeWeekends = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1) throw new Error('--days must be a positive integer');
  return options;
}

function usage() {
  return [
    'Usage: node server/migrate-snapshot-files.js [options]',
    '',
    'Options:',
    '  --days <count>        Migrate the most recent available dates (default: 15)',
    '  --snapshot-dir <dir>  Snapshot archive directory (default: ./snapshots)',
    '  --database <file>     Destination SQLite database',
    '  --delete-source       Delete each source archive only after verification',
    '  --include-weekends    Include Saturday and Sunday archive dates',
  ].join('\n');
}

function listArchiveGroups(snapshotDir) {
  const groups = new Map();
  if (!fs.existsSync(snapshotDir)) return groups;
  for (const name of fs.readdirSync(snapshotDir)) {
    const match = name.match(/^(?:simulation_snapshots_|snapshot-)(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/);
    if (!match) continue;
    const date = match[1];
    const files = groups.get(date) || [];
    files.push(path.join(snapshotDir, name));
    groups.set(date, files);
  }
  return groups;
}

function latestByBucket(snapshots, bucketMs = DEFAULT_BUCKET_MS) {
  const buckets = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const at = snapshotTime(snapshot);
    if (!at) continue;
    const bucket = Math.floor(at / bucketMs);
    const current = buckets.get(bucket);
    if (!current || snapshotTime(current) <= at) buckets.set(bucket, snapshot);
  }
  return [...buckets.values()].sort((left, right) => snapshotTime(left) - snapshotTime(right));
}

function chooseArchive(files) {
  return [...files].sort((left, right) => {
    const gzipOrder = Number(right.endsWith('.gz')) - Number(left.endsWith('.gz'));
    return gzipOrder || fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
  })[0];
}

function migrate(options) {
  const snapshotDir = path.resolve(options.snapshotDir || path.join(process.cwd(), 'snapshots'));
  const dbPath = path.resolve(options.dbPath || path.join(snapshotDir, 'simulation_snapshots.db'));
  const groups = listArchiveGroups(snapshotDir);
  const dates = [...groups.keys()]
    .filter(date => options.includeWeekends || ![0, 6].includes(new Date(`${date}T12:00:00.000Z`).getUTCDay()))
    .sort()
    .reverse()
    .slice(0, options.days);
  if (!dates.length) throw new Error(`No snapshot archives found in ${snapshotDir}`);

  const store = createSnapshotDatabase({ dbPath });
  const results = [];
  try {
    for (const date of dates) {
      const sourceFiles = groups.get(date) || [];
      const source = chooseArchive(sourceFiles);
      const legacy = readLegacySnapshotFile(source);
      const before = store.loadDay(date);
      const expected = latestByBucket([...before, ...(legacy?.snapshots || [])]);
      store.importSnapshots(date, legacy?.snapshots || [], DEFAULT_BUCKET_MS);
      const migrated = store.loadDay(date);
      const expectedIds = expected.map(snapshot => String(snapshot?.id || ''));
      const migratedIds = migrated.map(snapshot => String(snapshot?.id || ''));
      if (migrated.length !== expected.length || migratedIds.some((id, index) => id !== expectedIds[index])) {
        throw new Error(`Verification failed for ${date}: expected ${expected.length} rows, found ${migrated.length}`);
      }
      if (options.deleteSource) {
        for (const file of sourceFiles) fs.unlinkSync(file);
      }
      results.push({ date, source:path.basename(source), sourceRows:legacy.snapshots.length, databaseRows:migrated.length, deleted:options.deleteSource ? sourceFiles.map(file => path.basename(file)) : [] });
    }
  } finally {
    store.close();
  }
  return { database:dbPath, dates, results };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      console.log(JSON.stringify(migrate(options), null, 2));
    }
  } catch (error) {
    console.error(`Snapshot migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { chooseArchive, latestByBucket, listArchiveGroups, migrate, parseArgs };
