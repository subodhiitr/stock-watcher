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
  const legacyPath = path.join(snapshotDir, `snapshot-${date}.json`);

  // Try compressed first
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

  // Fall back to legacy uncompressed
  try {
    const jsonStr = await fsPromises.readFile(legacyPath, 'utf-8');
    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      throw new Error(`Failed to parse legacy snapshot for date ${date}: ${parseErr.message}`);
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

    // Extract dates from both .gz and .json files
    for (const file of files) {
      const gzMatch = file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json\.gz$/);
      const jsonMatch = file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/);

      if (gzMatch) {
        dateSet.add(gzMatch[1]);
      } else if (jsonMatch) {
        dateSet.add(jsonMatch[1]);
      }
    }

    // Sort descending
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
