const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const TICKER_PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');
const MOBILE_APP_PATH = path.join(__dirname, '..', 'mobile-app.js');

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

test('live sector updates preserve locally computed sector coverage', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /if \(payload\.sectorTrend\) updateSectorTilesPartial\(payload\.sectorTrend\)/);
  assert.doesNotMatch(source, /Object\.assign\(sectorTrendCache,\s*serverSectorTrend\)/);
});

test('mobile app subscribes to live intraday and trade streams', () => {
  const source = fs.readFileSync(MOBILE_APP_PATH, 'utf8');
  assert.match(source, /new EventSource\(`\/stream\/intraday-live\?symbols=/);
  assert.match(source, /new EventSource\('\/trade-execution\/stream'\)/);
  assert.match(source, /mergeLiveCandidates\(JSON\.parse/);
});

test('mobile setup selection uses the lightweight cache endpoint', () => {
  const mobile = fs.readFileSync(MOBILE_APP_PATH, 'utf8');
  const proxy = fs.readFileSync(TICKER_PROXY_PATH, 'utf8');
  assert.match(mobile, /api\(`\/mobile-setups\?filter=/);
  assert.doesNotMatch(mobile, /simulation\/analysis\?source=.*mobile/);
  assert.match(proxy, /function buildMobileSetupsPayload/);
});
