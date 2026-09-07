const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

test('dashboard bootstrap carries the default setup-efficiency payload', () => {
  const start = proxy.indexOf('function buildDashboardBootstrap()');
  const end = proxy.indexOf('function hasUsableMobileCandidates', start);
  const body = proxy.slice(start, end);

  assert.match(body, /setupEfficiency:setupEfficiencyService\.getPayload\('all'\)/);
});

test('first setup-efficiency open renders bootstrap data before opening its stream', () => {
  const start = dashboard.indexOf('async function loadSetupEfficiency(attempt = 0)');
  const end = dashboard.indexOf('function stopSetupEfficiencyStream', start);
  const body = dashboard.slice(start, end);
  const apply = body.indexOf('applySetupEfficiencyPayload(bootstrapPayload)');
  const stream = body.indexOf('startSetupEfficiencyStream()', apply);
  const fetchRequest = body.indexOf('await fetch(', stream);

  assert.match(body, /dashboardBootstrap\?\.setupEfficiency/);
  assert.ok(apply >= 0, 'bootstrap payload should be applied');
  assert.ok(stream > apply, 'stream should start after bootstrap paint');
  assert.ok(fetchRequest > stream, 'network fetch should remain a fallback');
});

test('older running proxies are prefetched before persistent dashboard streams start', () => {
  const prefetchStart = dashboard.indexOf('async function prefetchSetupEfficiencyBootstrap()');
  const readyStart = dashboard.indexOf("document.addEventListener('DOMContentLoaded'");
  const readyBody = dashboard.slice(readyStart);
  const prefetchCall = readyBody.indexOf('await prefetchSetupEfficiencyBootstrap()');
  const marketStream = readyBody.indexOf('subscribeMarketOverviewStream()');

  assert.ok(prefetchStart >= 0);
  assert.match(dashboard.slice(prefetchStart, readyStart), /SETUP_EFFICIENCY_ENDPOINT/);
  assert.ok(prefetchCall >= 0 && marketStream > prefetchCall);
});
