const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

test('manual trade controls render broker selector', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /function paperBrokerSelectId\(/);
  assert.match(source, /<select id="\$\{escapeHTML\(brokerSelectId\)\}" class="paper-broker-select"/);
});

test('openPaperTrade posts selected broker mode instead of global toggle directly', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /const selectedBrokerMode = getManualTradeBrokerMode\(sym\);/);
  assert.match(source, /brokerMode:\s*selectedBrokerMode/);
});
