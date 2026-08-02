'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'nse_midcap_dashboard.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

test('Check Proxy activates the dashboard before awaiting health', () => {
  const start = dashboard.indexOf('async function connectYahoo()');
  const end = dashboard.indexOf('async function fetchYahooIndices()', start);
  const body = dashboard.slice(start, end);
  assert.ok(start >= 0);
  assert.ok(body.indexOf('const healthCheck = checkProxy();') < body.indexOf("await healthCheck;"));
  assert.ok(body.indexOf("activateDashboard('yahoo');") < body.indexOf('await healthCheck;'));
  assert.doesNotMatch(body, /await checkProxy\(\)/);
  assert.doesNotMatch(body, /changeSource\(\)/);
  assert.match(body, /Dashboard remains active and will populate/);
  assert.match(html, /onclick="void connectYahoo\(\)"/);
});

test('dashboard paints before starting heavy first-load work', () => {
  const start = dashboard.indexOf('function activateDashboard(src)');
  const end = dashboard.indexOf('function renderDashboardShell', start);
  const body = dashboard.slice(start, end);
  assert.match(body, /const startDashboardLoads = \(\) => \{/);
  assert.match(body, /requestAnimationFrame\(\(\) => requestAnimationFrame\(startDashboardLoads\)\)/);
  assert.match(body, /void fetchAll\(\)/);
  assert.doesNotMatch(body, /setView\('stocks'/);
  assert.match(dashboard, /Waiting for the first live quote batch/);
});

test('desktop Yahoo first load streams quotes progressively in the background', () => {
  const start = dashboard.indexOf('async function fetchYahooStocks(firstLoad = false)');
  const end = dashboard.indexOf('//  NSE DIRECT', start);
  const body = dashboard.slice(start, end);
  assert.match(body, /\/stream\/mobile-stock-quotes\?symbols=/);
  assert.match(body, /applyYahooQuotes\(payload\.quotes \|\| \{\}\)/);
  assert.match(body, /offset \+= 300/);
  assert.match(body, /symbols\.slice\(offset, offset \+ 300\)/);
  assert.match(body, /scheduleTableRender\(\)/);
  assert.doesNotMatch(body, /\/dashboard-market\?symbols=/);
});

test('SSE helper applies the final payload before resolving done', () => {
  const start = dashboard.indexOf('function openSSEStream(');
  const end = dashboard.indexOf('const sparklineData', start);
  const body = dashboard.slice(start, end);
  assert.ok(body.indexOf('onData(msg);') < body.indexOf('if (msg.done)'));
});

test('desktop shells expose the asynchronous connect asset version', () => {
  assert.match(html, /dashboard-app\.js\?v=20260801-71/);
  assert.match(controller, /dashboard-app\.js\?v=20260801-71/);
});
