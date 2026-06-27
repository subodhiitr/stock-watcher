import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const fsPromises = fs.promises;
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_SNAPSHOT_DIR = path.join(process.cwd(), 'snapshots');

/**
 * Save a snapshot for a given date with gzip compression
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {object} data - Snapshot data to save
 * @param {string} snapshotDir - Directory to save snapshots (optional)
 */
export async function saveSnapshotDay(date, data, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  await fsPromises.mkdir(snapshotDir, { recursive: true });

  const gzPath = path.join(snapshotDir, `snapshot-${date}.json.gz`);
  const jsonStr = JSON.stringify(data);
  const compressed = await gzip(jsonStr);
  
  await fsPromises.writeFile(gzPath, compressed);
}

/**
 * Load a snapshot for a given date
 * Falls back to legacy .json if .gz is not available
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {string} snapshotDir - Directory to load snapshots from (optional)
 * @returns {object} Snapshot data
 */
export async function loadSnapshotDay(date, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  const gzPath = path.join(snapshotDir, `snapshot-${date}.json.gz`);
  const legacyJsonPath = path.join(snapshotDir, `snapshot-${date}.json`);
  const legacySimPath = path.join(snapshotDir, `simulation_snapshots_${date}.json.gz`);
  const legacySimJsonPath = path.join(snapshotDir, `simulation_snapshots_${date}.json`);

  // Try snapshot-{date}.json.gz first (snapshot-store standard)
  try {
    const compressed = await fsPromises.readFile(gzPath);
    const decompressed = await gunzip(compressed);
    try {
      return JSON.parse(decompressed.toString());
    } catch (parseErr) {
      throw new Error(`Failed to parse compressed snapshot for date ${date}: ${parseErr.message}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Try simulation_snapshots_{date}.json.gz (legacy compressed)
  try {
    const compressed = await fsPromises.readFile(legacySimPath);
    const decompressed = await gunzip(compressed);
    return JSON.parse(decompressed.toString());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Try snapshot-{date}.json (legacy uncompressed, snapshot-store naming)
  try {
    const jsonStr = await fsPromises.readFile(legacyJsonPath, 'utf-8');
    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      throw new Error(`Failed to parse legacy snapshot for date ${date}: ${parseErr.message}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Try simulation_snapshots_{date}.json (legacy uncompressed, production naming)
  try {
    const jsonStr = await fsPromises.readFile(legacySimJsonPath, 'utf-8');
    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      throw new Error(`Failed to parse legacy simulation snapshot for date ${date}: ${parseErr.message}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Snapshot not found for date ${date}`);
    }
    throw err;
  }
}

/**
 * List all available snapshot dates sorted in descending order
 * @param {string} snapshotDir - Directory to search for snapshots (optional)
 * @returns {string[]} Array of ISO date strings sorted descending
 */
export async function listSnapshotDays(snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  try {
    const files = await fsPromises.readdir(snapshotDir);
    const dateSet = new Set();

    for (const file of files) {
      // snapshot-YYYY-MM-DD.json.gz  (snapshot-store standard)
      // snapshot-YYYY-MM-DD.json     (legacy snapshot-store uncompressed)
      // simulation_snapshots_YYYY-MM-DD.json.gz  (legacy compressed)
      // simulation_snapshots_YYYY-MM-DD.json     (legacy production uncompressed)
      const match =
        file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/) ||
        file.match(/^simulation_snapshots_(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/);
      if (match) dateSet.add(match[1]);
    }

    return Array.from(dateSet).sort().reverse();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Delete snapshots older than the specified retention days
 * @param {number} retentionDays - Number of days to retain
 * @param {string} snapshotDir - Directory to prune snapshots from (optional)
 */
export async function pruneOldSnapshots(retentionDays, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  try {
    await fsPromises.readdir(snapshotDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  // Calculate cutoff date in UTC to ensure consistent timezone handling
  const now = new Date();
  const cutoffDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays));

  const dates = await listSnapshotDays(snapshotDir);

  for (const date of dates) {
    // Parse snapshot date in UTC to match cutoff calculation
    const snapshotDate = new Date(date + 'T00:00:00Z');
    if (snapshotDate < cutoffDate) {
      // Delete both .gz and .json if they exist
      const gzPath = path.join(snapshotDir, `snapshot-${date}.json.gz`);
      const jsonPath = path.join(snapshotDir, `snapshot-${date}.json`);

      try {
        await fsPromises.unlink(gzPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      try {
        await fsPromises.unlink(jsonPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }
}
