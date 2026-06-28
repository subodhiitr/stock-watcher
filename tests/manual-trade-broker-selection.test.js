const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

test('manual trade controls render broker selector without paper mode', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /function paperBrokerSelectId\(/);
  assert.match(source, /<select id="\$\{escapeHTML\(brokerSelectId\)\}" class="paper-broker-select"/);
  assert.doesNotMatch(source, /<option value="paper"/);
  assert.doesNotMatch(source, /\['paper',\s*'Paper'\]/);
  assert.match(source, /'zerodha_dry_run'/);
  assert.match(source, /'zerodha_live'/);
  assert.match(source, /'sharekhan_live'/);
});

test('openPaperTrade posts selected broker mode instead of global toggle directly', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /const selectedBrokerMode = getManualTradeBrokerMode\(sym\);/);
  assert.match(source, /brokerMode:\s*selectedBrokerMode/);
});

test('paper broker mode is not a dashboard fallback or toggle target', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.doesNotMatch(source, /let brokerMode = \['paper'/);
  assert.doesNotMatch(source, /brokerMode = 'paper'/);
  assert.doesNotMatch(source, /Cycle through: paper/);
  assert.match(source, /: 'zerodha_dry_run';/);
});
