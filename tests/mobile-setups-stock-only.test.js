const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');

test('mobile setups warm all stocks and gate ETFs behind the simulation setting', () => {
  const start = source.indexOf('function buildMobileSetupsPayload');
  const end = source.indexOf('function buildMobileStockUniverse', start);
  const body = source.slice(start, end);
  assert.match(body, /const dashboardStocks = loadDashboardStockUniverse\(\)/);
  assert.match(body, /rememberSimulationUniverse\(\[\.\.\.stockSymbols\]\)/);
  assert.match(body, /const etfEnabled = settings\.SIMULATION_ENABLE_ETF === true/);
  assert.match(body, /if \(!etfEnabled\) return false/);
  assert.match(body, /isEtfSimulationSymbol\(normalized\)/);
  assert.match(body, /filter\(candidate => isAllowedMobileSetup\(candidate\.symbol, candidate\)\)/);
});

test('mobile settings exposes ETF simulation and refreshes setups after save', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
  assert.match(controller, /name="SIMULATION_ENABLE_ETF" type="checkbox"/);
  assert.match(mobile, /state\.overrides = payload\.overrides \|\| next;[\s\S]*?await loadSetups\(\)/);
});
