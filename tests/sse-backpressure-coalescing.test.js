const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('SSE writes expose Node backpressure instead of reporting unconditional success', () => {
  const start = source.indexOf('function writeSseEvent(');
  const body = source.slice(start, start + 400);
  assert.match(body, /writableEnded \|\| res\.destroyed/);
  assert.match(body, /res\.write\([\s\S]*\) !== false/);
});

test('intraday tick broadcasts are coalesced and pause slow clients until drain', () => {
  assert.match(source, /function flushIntradayLiveBroadcast\(\)/);
  assert.match(source, /setTimeout\(flushIntradayLiveBroadcast, 250\)/);
  assert.match(source, /if \(intradayBroadcastTimer\) return/);
  assert.match(source, /client\.res\.once\('drain'/);
  assert.match(source, /if \(client\.backpressured\) continue/);
});

test('intraday tick broadcasts send the full subscribed snapshot on each update', () => {
  const start = source.indexOf('function flushIntradayLiveBroadcast()');
  const body = source.slice(start, source.indexOf('\nfunction broadcastIntradayLive', start));
  assert.match(body, /data: buildIntradayLiveData\(symbolFilter\)/);
  assert.match(body, /changedSymbols: Array\.isArray\(changedSymbols\)/);
  assert.doesNotMatch(body, /changedSymbolsForClient/);
  assert.doesNotMatch(body, /dataSymbols/);
});

test('dashboard throttles expensive intraday consumers but applies row updates immediately', () => {
  assert.match(dashboardSource, /if \(liveQuoteConsumerRefreshTimer\) return/);
  assert.match(dashboardSource, /INTRADAY_CONSUMER_REFRESH_MS = 750/);
  assert.match(dashboardSource, /applyPartialRowUpdates\(changedSymbols\)/);
  assert.doesNotMatch(dashboardSource, /schedulePartialRowUpdates\(changedSymbols\)/);
  assert.doesNotMatch(dashboardSource, /INTRADAY_ROW_REFRESH_MS/);
  assert.doesNotMatch(dashboardSource, /pendingIntradayRowSymbols/);
  assert.match(dashboardSource, /new Map\(getAllStockRows\(\)\.map\(row => \[row\.sym, row\]\)\)/);
});

test('heavy replay worker failures never fall back inside the live proxy', () => {
  assert.match(source, /if \(mode !== 'report'\)/);
  assert.match(source, /Sweep modes are intentionally worker-only/);
  assert.match(source, /REPLAY_DEEP_SWEEP_STARTUP_ENABLED/);
  assert.match(source, /REPLAY_DEEP_SWEEP_STARTUP === '1'/);
});

test('automatic deep sweeps require explicit opt-in while manual jobs remain available', () => {
  assert.match(source, /REPLAY_DEEP_SWEEP_SCHEDULE_ENABLED = process\.env\.REPLAY_DEEP_SWEEP_SCHEDULE === '1'/);
  const schedulerStart = source.indexOf('function startReplayDeepSweepScheduler()');
  const schedulerBody = source.slice(schedulerStart, schedulerStart + 700);
  assert.match(schedulerBody, /if \(!REPLAY_DEEP_SWEEP_SCHEDULE_ENABLED\)[\s\S]*return;[\s\S]*scheduleNextDeepSweep\(\)/);
  assert.match(source, /\['report', 'sweep', 'autotune', 'deep_sweep'\]\.includes\(mode\)/);
});

test('live symbol metadata never decompresses retained replay snapshots', () => {
  const start = source.indexOf('function getSimulationSymbolMetaIndex()');
  const end = source.indexOf('\nfunction buildSectorTrendFromCandidates', start);
  const body = source.slice(start, end);
  assert.match(body, /loadDashboardStockUniverse\(\)/);
  assert.doesNotMatch(body, /loadAllSimulationSnapshots\(\)/);
  assert.doesNotMatch(body, /loadLatestSimulationSnapshots\(\)/);
});

test('sector aggregation excludes stale and zero-price rows and deduplicates symbols', () => {
  const start = source.indexOf('function buildSectorTrendFromCandidates(');
  const end = source.indexOf('\nfunction buildSectorTrendFromCache', start);
  const body = source.slice(start, end);
  assert.match(body, /freshness\?\.stale/);
  assert.match(body, /Number\(rawPrice\) > 0/);
  assert.match(body, /new Map\(\)/);
  assert.match(body, /changeMap\.values\(\)/);
});

test('Sharekhan day change never substitutes a five-minute close for previous-day close', () => {
  const start = source.indexOf('async function pushSharekhanTickerCandles(');
  const end = source.indexOf('\nasync function fetchIntradaySignal', start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /closes\[closes\.length - 2\]/);
});
