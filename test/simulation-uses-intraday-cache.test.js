const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('scheduler candidate builder uses intraday cache instead of direct fetches', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function buildSchedulerCandidatesFromIntradayCache\(settings\)/);
  const start = source.indexOf('function buildSchedulerCandidatesFromIntradayCache(settings)');
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
