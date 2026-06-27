const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

test('dashboard has retry scheduler for trade-settings server sync', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /function scheduleTradeSettingsSyncRetry\(/);
});

test('trade-setting save schedules retry when server save fails', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const start = source.indexOf('async function saveTradeSettingOverrides(');
  assert.ok(start > -1, 'saveTradeSettingOverrides must exist');
  const body = source.slice(start, start + 1200);
  assert.match(body, /scheduleTradeSettingsSyncRetry\(/);
});
