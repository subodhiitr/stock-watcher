const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_HTML_PATH = path.join(__dirname, '..', 'nse_midcap_dashboard.html');
const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

test('last refresh button uses full fetch handler', () => {
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  assert.match(html, /id="last-refresh-card"[\s\S]*onclick="fetchAll\(\)"/);
});

test('countdown timer uses UI-only refresh handler', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /function startCountdown\([\s\S]*refreshDashboardUiOnly\(\);/);
});
