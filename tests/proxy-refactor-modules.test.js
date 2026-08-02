const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readWorkspaceFile(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('fresh news endpoint delegates to extracted service module', () => {
  const proxySource = readWorkspaceFile('ticker_proxy.js');
  const freshNewsSource = readWorkspaceFile('server', 'fresh-news.js');

  assert.match(proxySource, /createFreshNewsService/);
  assert.match(proxySource, /freshNewsService\.handleRoute\(req, res, \{ searchParams, readJsonBody \}\)/);
  assert.match(freshNewsSource, /async function fetchFreshStockNews/);
  assert.match(freshNewsSource, /function freshNewsCronDelayMs/);
  assert.doesNotMatch(proxySource, /async function fetchFreshStockNews/);
  assert.doesNotMatch(proxySource, /function freshNewsCronDelayMs/);
});

test('simulation replay endpoints delegate to route module', () => {
  const proxySource = readWorkspaceFile('ticker_proxy.js');
  const replayRouteSource = readWorkspaceFile('server', 'routes', 'replay.js');

  assert.match(proxySource, /handleReplayRoute\(req, res, pathname, searchParams/);
  assert.match(replayRouteSource, /pathname === '\/simulation-replay\/why'/);
  assert.match(replayRouteSource, /pathname === '\/simulation-replay\/jobs'/);
  assert.match(replayRouteSource, /pathname === '\/simulation-replay'/);
  assert.doesNotMatch(proxySource, /Could not create replay job/);
  assert.doesNotMatch(proxySource, /Why missed failed/);
});

test('broker, trade execution, and simulation runtime endpoints delegate to route modules', () => {
  const proxySource = readWorkspaceFile('ticker_proxy.js');
  const brokerRouteSource = readWorkspaceFile('server', 'routes', 'broker.js');
  const tradeRouteSource = readWorkspaceFile('server', 'routes', 'trade-execution.js');
  const simulationRouteSource = readWorkspaceFile('server', 'routes', 'simulation-runtime.js');

  assert.match(proxySource, /handleBrokerRoute\(req, res, pathname, searchParams/);
  assert.match(proxySource, /handleTradeExecutionRoute\(req, res, pathname, searchParams/);
  assert.match(proxySource, /handleSimulationRuntimeRoute\(req, res, pathname, searchParams/);
  assert.match(brokerRouteSource, /pathname === '\/broker-mode'/);
  assert.match(tradeRouteSource, /pathname !== deps\.tradeExecutionPath/);
  assert.match(simulationRouteSource, /pathname === '\/simulation\/start'/);
  assert.match(simulationRouteSource, /pathname === '\/simulation-snapshots'/);
  assert.doesNotMatch(proxySource, /Live trade execution requires confirmation token LIVE/);
  assert.doesNotMatch(proxySource, /Sharekhan integration is not initialized/);
  assert.doesNotMatch(proxySource, /Invalid snapshot payload/);
});

test('dashboard and trade-settings endpoints delegate through route registry modules', () => {
  const proxySource = readWorkspaceFile('ticker_proxy.js');
  const registrySource = readWorkspaceFile('server', 'routes', 'registry.js');
  const dashboardRouteSource = readWorkspaceFile('server', 'routes', 'dashboard.js');
  const tradeSettingsRouteSource = readWorkspaceFile('server', 'routes', 'trade-settings.js');

  assert.match(proxySource, /dispatchRoute\(/);
  assert.match(registrySource, /async function dispatchRoute/);
  assert.match(proxySource, /handleDashboardRoute\(req, res, pathname, searchParams/);
  assert.match(proxySource, /handleTradeSettingsRoute\(req, res, pathname/);
  assert.match(dashboardRouteSource, /pathname === '\/health'/);
  assert.match(dashboardRouteSource, /pathname === '\/dashboard-bootstrap'/);
  assert.match(dashboardRouteSource, /pathname === '\/dashboard-market'/);
  assert.match(tradeSettingsRouteSource, /pathname !== '\/trade-settings'/);
  assert.doesNotMatch(proxySource, /Market payload failed/);
  assert.doesNotMatch(proxySource, /Could not save trade settings/);
});
