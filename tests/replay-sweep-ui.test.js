const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP = path.join(__dirname, '..', 'dashboard-app.js');

test('Best Settings button hydrates completed sweep jobs before starting a new job', () => {
  const source = fs.readFileSync(DASHBOARD_APP, 'utf8');

  assert.match(source, /function findCompletedReplaySweepJob/);
  assert.match(source, /function hydrateReplaySweepFromJob/);
  assert.match(source, /await loadReplayJobHistory\(\);/);
  assert.match(source, /const completedJob = findCompletedReplaySweepJob\(day\);/);
  assert.match(source, /hydrateReplaySweepFromJob\(completedJob/);
  assert.match(source, /const completedAnyJob = findCompletedReplaySweepJob\(day, \{ requireRows:false \}\);/);
  assert.match(source, /Not starting a duplicate sweep/);
  assert.match(source, /const activeJob = findActiveReplaySweepJob\(day\);/);
  assert.match(source, /Best Settings sweep is already/);
});

test('Replay job history auto-populates empty Best Settings table from completed job result', () => {
  const source = fs.readFileSync(DASHBOARD_APP, 'utf8');

  assert.match(source, /updateReplayJobHistory\(jobs\)/);
  assert.match(source, /!\(lastReplayDebugResult\.sweepRows \|\| \[\]\)\.length/);
  assert.match(source, /Loaded completed Best Settings sweep results/);
});

test('Replay job history marks completed sweeps with missing rows instead of showing blank error', () => {
  const source = fs.readFileSync(DASHBOARD_APP, 'utf8');

  assert.match(source, /Completed; rows unavailable/);
  assert.match(source, /options\.requireRows !== false/);
});
