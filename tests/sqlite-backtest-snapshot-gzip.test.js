import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const BACKTEST_APP_PATH = path.join(import.meta.url.replace('file:///', ''), '..', '..', 'backtest_simulation.js').replace(/\\/g, '/');

test('backtest uses snapshot store module for loading snapshots', () => {
  const source = fs.readFileSync(BACKTEST_APP_PATH.replace(/\//g, '\\'), 'utf8');
  
  // Verify snapshot-store is imported/required
  assert.ok(
    source.includes("require('./server/snapshot-store'") || 
    source.includes('require("./server/snapshot-store"') ||
    source.includes('import') && source.includes('snapshot-store'),
    'backtest_simulation.js should import/require snapshot-store module'
  );

  // Verify loadSnapshotDay is used
  assert.ok(
    source.includes('loadSnapshotDay'),
    'backtest_simulation.js should use loadSnapshotDay function'
  );
});

test('backtest does not use direct file I/O for snapshot reads', () => {
  const source = fs.readFileSync(BACKTEST_APP_PATH.replace(/\//g, '\\'), 'utf8');
  
  // Find all fs.readFileSync calls in the file
  const lines = source.split('\n');
  let foundDirectSnapshotRead = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for fs.readFileSync used with snapshot files
    if (line.includes('fs.readFileSync') && 
        (line.includes('snapshot') || line.includes('SNAPSHOT'))) {
      foundDirectSnapshotRead = true;
      break;
    }
  }
  
  assert.strictEqual(
    foundDirectSnapshotRead,
    false,
    'backtest_simulation.js should not use fs.readFileSync for snapshot files'
  );
});
