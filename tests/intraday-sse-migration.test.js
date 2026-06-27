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

test('SSE broadcast payload includes sectorTrend from server cache', () => {
  const source = fs.readFileSync(TICKER_PROXY_PATH, 'utf8');
  assert.match(source, /sectorTrend: buildSectorTrendFromCache\(\)/);
});

test('dashboard SSE handler updates serverSectorTrend from payload', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /serverSectorTrend\s*=\s*payload\.sectorTrend/);
});

test('renderSectors applies serverSectorTrend override to sectorTrendCache', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /Object\.assign\(sectorTrendCache,\s*serverSectorTrend\)/);
});
