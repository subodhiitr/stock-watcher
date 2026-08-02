const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const mobileController = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
const simulationRoutes = fs.readFileSync(path.join(root, 'server', 'routes', 'simulation-runtime.js'), 'utf8');
const remixServer = fs.readFileSync(path.join(root, 'my-remix-app', 'server.ts'), 'utf8');

test('server analysis assigns a stable point-in-time rank and selection reason', () => {
  assert.match(proxy, /serverRank: index \+ 1/);
  assert.match(proxy, /selectionReason/);
  assert.match(proxy, /Selected: \$\{selectionDetails\.join\('\s*\| '\)\}/);
  assert.match(proxy, /Not selected: \$\{rejectionReasons\[0\]/);
});

test('desktop has a dedicated server simulation Top 25 setup card', () => {
  assert.match(dashboard, /'Server Simulation Top 25'/);
  assert.match(dashboard, /async function loadServerSimulationTop25/);
  assert.match(dashboard, /\.slice\(0, 25\)/);
  assert.match(dashboard, /const serverTop25Active = activeSetupCard === 'simulation_top25'/);
  assert.match(dashboard, /serverTop25Active \? getServerSimulationTop25Rows\(\) : getAllStockRows\(\)/);
  assert.match(dashboard, /\{ col: 'serverrank', dir: 1 \}/);
});

test('combined setup view keeps one profitability-ranked leader per setup on desktop and mobile', () => {
  assert.match(proxy, /selectTopCandidatesBySetup/);
  assert.match(proxy, /combinedRank:index \+ 1/);
  assert.match(proxy, /profitabilityReason/);
  assert.match(dashboard, /'Combined Top Setups'/);
  assert.match(dashboard, /function getServerCombinedSetupRows\(\)/);
  assert.match(dashboard, /selectServerCombinedSetupsCard\(\)/);
  assert.match(mobileController, /<option value="combined_top">Combined Top Setups<\/option>/);
  assert.match(mobile, /combined_top: \(a, b\) => n\(a\.combinedRank\) - n\(b\.combinedRank\)/);
  assert.match(mobile, /Profitability ranking/);
});

test('Top 25 Trade cells show server rank and entry selection reason', () => {
  assert.match(dashboard, /`Server #\$\{Number\(serverCandidate\.serverRank\) \|\| '--'\}`/);
  assert.match(dashboard, /serverCandidate\.selectionReason/);
  assert.match(dashboard, /class="simulation-selection-reason \$\{serverCandidate\.selected \? 'selected' : ''\}"/);
  assert.match(css, /\.simulation-selection-reason\.selected/);
});

test('Top 25 refreshes over SSE only while its card is active', () => {
  assert.match(simulationRoutes, /pathname === '\/simulation\/analysis\/stream'/);
  assert.match(simulationRoutes, /'Content-Type': 'text\/event-stream'/);
  assert.match(simulationRoutes, /if \(closed \|\| refreshRunning\) return/);
  assert.match(simulationRoutes, /deps\.buildServerSimulationAnalysisPayload\('server-analysis-stream'\)/);
  assert.match(simulationRoutes, /payload\.candidates\.slice\(0, 25\)/);
  assert.match(dashboard, /new EventSource\(SIMULATION_ANALYSIS_STREAM_ENDPOINT\)/);
  assert.match(dashboard, /!isServerSimulationCardActive\(\) \|\| currentView !== 'stocks'/);
  assert.match(dashboard, /function disconnectServerSimulationTop25Stream\(\)/);
  assert.match(remixServer, /'\/simulation\/analysis\/stream'/);
});

test('mobile exposes the same server Top 25 view with card-scoped SSE', () => {
  assert.match(mobileController, /<option value="simulation_top25">Server Simulation Top 25<\/option>/);
  assert.match(mobile, /new EventSource\('\/simulation\/analysis\/stream'\)/);
  assert.match(mobile, /serverSimulationFilterActive\(\)/);
  assert.match(mobile, /disconnectServerSimulationStream\(\)/);
  assert.match(mobile, /\.slice\(0, serverFilter \? 25 : 24\)/);
  assert.match(mobile, /activeFilter === 'combined_top' \? 'Profitability ranking' : 'Entry selection'/);
  assert.match(mobile, /Server #\$\{n\(c\.serverRank\) \|\| index \+ 1\}/);
});
