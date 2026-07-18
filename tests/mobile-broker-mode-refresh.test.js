const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

test('mobile broker selector uses supported modes and confirms live changes', () => {
  assert.doesNotMatch(controller, /option value="paper"/);
  assert.match(controller, /option value="zerodha_dry_run"/);
  assert.match(app, /'X-Live-Trade-Confirm': 'LIVE'/);
  assert.match(app, /liveConfirm: 'LIVE'/);
});

test('mobile broker change refreshes broker-specific portfolio and P&L', () => {
  const handler = app.slice(app.indexOf("$('broker-mode-select').addEventListener('change'"));
  assert.match(handler, /state\.brokerStatus = await api\('\/broker-status'\)/);
  assert.match(handler, /await refreshActiveBrokerPortfolio\(\)/);
  assert.match(handler, /renderHeader\(\)/);
  assert.match(handler, /renderPnlOverlay\(\)/);
});

test('mobile shell cache version exposes the broker-mode fix', () => {
  const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'mobile-sw.js'), 'utf8');
  assert.match(controller, /mobile-app\.js\?v=20260718-47/);
  assert.match(serviceWorker, /intradayx-mobile-v54/);
  assert.match(serviceWorker, /mobile-app\.js\?v=20260718-47/);
});
