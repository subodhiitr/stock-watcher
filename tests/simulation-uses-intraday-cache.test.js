const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('scheduler candidate builder uses intraday cache instead of direct fetches', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function buildSchedulerCandidatesFromIntradayCache\(settings,\s*symbolMetaBySymbol\s*=\s*null/);
  const start = source.indexOf('function buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol = null');
  const body = source.slice(start, start + 1200);
  assert.doesNotMatch(body, /fetchIntradaySignal\(/);
});

test('starting simulation scheduler triggers shared intraday cache refresh', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf("function startSimulationScheduler(reason = 'manual-start')");
  assert.ok(start > -1);
  const body = source.slice(start, start + 700);
  assert.match(body, /startIntradayLiveRefresh\('scheduler-start'\)/);
  assert.match(body, /refreshIntradayLiveCache\('scheduler-start'\)\.catch\(/);
});

test('scheduler tick input includes market indices and sector trend for regime checks', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf('async function readSchedulerTickInputAsync(settings)');
  assert.ok(start > -1);
  const body = source.slice(start, start + 2200);
  assert.match(body, /const market = await getSimulationMarketContext\(\)/);
  assert.match(body, /sectorTrend:\s*buildSectorTrendFromCandidates\(serverCandidates\)/);
});

test('scheduler passes sector trend context into simulation domain cycle', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf('const { exitIntents, entryIntents } = runSimulationDomainCycle(');
  assert.ok(start > -1);
  const body = source.slice(start, start + 700);
  assert.match(body, /sectorTrend:\s*tickInput\?\.sectorTrend \|\| \{\}/);
  assert.match(body, /indices:\s*tickInput\?\.market\?\.indices \|\| \{\}/);
});

test('ETF tab uses server-owned intraday stream instead of direct intraday batch fetch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
  const start = source.indexOf("async function setView(view, el)");
  assert.ok(start > -1);
  const body = source.slice(start, start + 1200);
  assert.match(body, /startIntradayLiveStream\(syms\)/);
  assert.doesNotMatch(body, /fetchIntradaySignals\(syms\)/);
});
