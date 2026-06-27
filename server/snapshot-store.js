import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

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
  fs.mkdirSync(snapshotDir, { recursive: true });

  const gzPath = path.join(snapshotDir, `snapshot-${date}.json.gz`);
  const jsonStr = JSON.stringify(data);
  const compressed = await gzip(jsonStr);
  
  fs.writeFileSync(gzPath, compressed);
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
  if (fs.existsSync(gzPath)) {
    const compressed = fs.readFileSync(gzPath);
    const decompressed = await gunzip(compressed);
    return JSON.parse(decompressed.toString());
  }

  // Fall back to legacy uncompressed
  if (fs.existsSync(legacyPath)) {
    const jsonStr = fs.readFileSync(legacyPath, 'utf-8');
    return JSON.parse(jsonStr);
  }

  throw new Error(`Snapshot not found for date ${date}`);
}

/**
 * List all available snapshot dates sorted in descending order
 * @param {string} snapshotDir - Directory to search for snapshots (optional)
 * @returns {string[]} Array of ISO date strings sorted descending
 */
export async function listSnapshotDays(snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  if (!fs.existsSync(snapshotDir)) {
    return [];
  }

  const files = fs.readdirSync(snapshotDir);
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
}

/**
 * Delete snapshots older than the specified retention days
 * @param {number} retentionDays - Number of days to retain
 * @param {string} snapshotDir - Directory to prune snapshots from (optional)
 */
export async function pruneOldSnapshots(retentionDays, snapshotDir = DEFAULT_SNAPSHOT_DIR) {
  if (!fs.existsSync(snapshotDir)) {
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const dates = await listSnapshotDays(snapshotDir);

  for (const date of dates) {
    const snapshotDate = new Date(date);
    if (snapshotDate < cutoffDate) {
      // Delete both .gz and .json if they exist
      const gzPath = path.join(snapshotDir, `snapshot-${date}.json.gz`);
      const jsonPath = path.join(snapshotDir, `snapshot-${date}.json`);

      if (fs.existsSync(gzPath)) {
        fs.unlinkSync(gzPath);
      }
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
      }
    }
  }
}
