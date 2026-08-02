const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('dashboard manual entries request server-side simulation validation', () => {
  const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'server', 'routes', 'trade-execution.js'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

  assert.match(dashboard, /source:\s*'manual',\s*validateSimulationEntry:\s*true/);
  assert.match(route, /payload\.validateSimulationEntry === true/);
  assert.match(route, /deps\.prepareManualTradeEntryPayload\(payload, trades\)/);
  assert.match(proxy, /manualValidated:true/);
  assert.match(proxy, /settingsFingerprint:SimulationEngine\.stableAuditFingerprint\(settingsSnapshot\)/);
});

test('browser simulation settings prefer the server runtime settings and snapshots record the same fingerprint', () => {
  const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

  assert.match(dashboard, /simulationRuntimeStatus\?\.settings/);
  assert.match(dashboard, /caps:\s*analysis\.settings \|\| \{\}/);
  assert.match(dashboard, /settingsFingerprint:analysis\.settingsFingerprint \|\| ''/);
  assert.match(proxy, /settingsFingerprint:SimulationEngine\.stableAuditFingerprint\(settingsAudit\)/);
  assert.match(proxy, /caps:\s*settings,\s*settingsFingerprint:/);
});
