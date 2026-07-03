const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const DASHBOARD_HTML_PATH = path.join(__dirname, '..', 'nse_midcap_dashboard.html');

test('action bar exposes simulation data quality modal trigger', () => {
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  assert.match(html, /id="simulation-data-quality-btn"/);
  assert.match(html, /onclick="openSimulationDataQualityModal\(\)"/);
  assert.match(html, /Simulation Data Quality/);
});

test('dashboard includes simulation data quality modal shell', () => {
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  assert.match(html, /id="simulation-data-quality-modal"/);
  assert.match(html, /id="simulation-data-quality-modal-body"/);
});

test('dashboard app exposes simulation data quality modal handlers', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /function renderSimulationDataQualityModal\(/);
  assert.match(source, /function openSimulationDataQualityModal\(/);
  assert.match(source, /function closeSimulationDataQualityModal\(/);
});

