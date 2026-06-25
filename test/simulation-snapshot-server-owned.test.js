const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('dashboard intraday SSE handler no longer posts simulation snapshots', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.doesNotMatch(source, /saveSimulationSnapshot\('intraday-refresh'\)/);
});

test('proxy persists simulation snapshots from server intraday refresh loop', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function persistServerSimulationSnapshot\(/);
  assert.match(source, /persistServerSimulationSnapshot\(/);
});
