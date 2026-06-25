const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const TICKER_PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('dashboard intraday stream uses server-owned live SSE endpoint', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /\/stream\/intraday-live/);
});

test('proxy exposes server-owned live SSE endpoint for intraday updates', () => {
  const source = fs.readFileSync(TICKER_PROXY_PATH, 'utf8');
  assert.match(source, /pathname === '\/stream\/intraday-live'/);
});
