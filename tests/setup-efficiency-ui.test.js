import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../nse_midcap_dashboard.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../dashboard-app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const proxy = fs.readFileSync(new URL('../ticker_proxy.js', import.meta.url), 'utf8');

test('setup efficiency is a Replay-adjacent responsive side panel', () => {
  const replayIndex = html.indexOf('runReplayToday()');
  const efficiencyIndex = html.indexOf('openSetupEfficiencyPanel()');
  assert.ok(replayIndex >= 0);
  assert.ok(efficiencyIndex > replayIndex);
  assert.match(html, /id="setup-efficiency-modal"/);
  assert.match(css, /#setup-efficiency-modal \.setup-efficiency-panel/);
  assert.match(css, /@media\(max-width:820px\).*#setup-efficiency-modal/s);
});

test('panel streams updates only while open and exposes efficiency criteria', () => {
  assert.match(js, /new EventSource\(`\$\{SETUP_EFFICIENCY_STREAM_ENDPOINT\}/);
  assert.match(js, /function closeSetupEfficiencyPanel[\s\S]*stopSetupEfficiencyStream\(\)/);
  assert.match(js, /expectancy 30%.*profit factor 20%.*drawdown 15%/);
  assert.match(js, /Win rate[\s\S]*Profit factor[\s\S]*Max drawdown[\s\S]*Recent trend/);
});

test('panel loads its initial payload before opening the persistent update stream', () => {
  const loadStart = js.indexOf('async function loadSetupEfficiency');
  const loadEnd = js.indexOf('function stopSetupEfficiencyStream', loadStart);
  const loadSource = js.slice(loadStart, loadEnd);
  const openStart = js.indexOf('function openSetupEfficiencyPanel');
  const openEnd = js.indexOf('function closeSetupEfficiencyPanel', openStart);
  const openSource = js.slice(openStart, openEnd);
  const bootstrapApply = loadSource.indexOf('applySetupEfficiencyPayload(bootstrapPayload)');
  const bootstrapStream = loadSource.indexOf('startSetupEfficiencyStream()', bootstrapApply);
  const networkApply = loadSource.indexOf('applySetupEfficiencyPayload(payload)');
  const networkStream = loadSource.indexOf('startSetupEfficiencyStream()', networkApply);
  assert.ok(bootstrapApply >= 0 && bootstrapStream > bootstrapApply);
  assert.ok(networkApply >= 0 && networkStream > networkApply);
  assert.match(loadSource, /SETUP_EFFICIENCY_LOAD_TIMEOUT_MS/);
  assert.match(loadSource, /attempt < 1/);
  assert.match(loadSource, />Retry<\/button>/);
  assert.doesNotMatch(openSource, /startSetupEfficiencyStream\(\)/);
});

test('panel supports on-demand analysis for one close date', () => {
  assert.match(js, /id="setup-efficiency-date"[\s\S]*type="date"/);
  assert.match(js, /setupEfficiencyDate \|\| getTradeDateISO\(\)/);
  assert.match(js, /\['10d', '10 days'\]/);
  assert.match(js, /\/analyze-date\?date=/);
  assert.match(js, /function clearSetupEfficiencyDate/);
  assert.match(js, /if \(setupEfficiencyDate\) return;/);
  assert.match(css, /\.efficiency-date-request/);
});

test('proxy starts hourly setup reconciliation after database initialization', () => {
  const initIndex = proxy.indexOf('initDb()', proxy.indexOf('async function initializeProxy'));
  const startIndex = proxy.indexOf('setupEfficiencyService.start()', initIndex);
  assert.ok(initIndex >= 0);
  assert.ok(startIndex > initIndex);
  assert.match(proxy, /intervalMs:\s*60\s*\*\s*60\s*\*\s*1000/);
});
