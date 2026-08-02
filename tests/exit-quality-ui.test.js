import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../nse_midcap_dashboard.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../dashboard-app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const proxy = fs.readFileSync(new URL('../ticker_proxy.js', import.meta.url), 'utf8');

test('Exit Quality tab opens a responsive side panel', () => {
  assert.match(html, /onclick="openExitQualityPanel\(\)">Exit Quality/);
  assert.match(html, /id="exit-quality-modal"/);
  assert.match(css, /#exit-quality-modal \.exit-quality-panel/);
  assert.match(css, /@media\(max-width:820px\).*#exit-quality-modal/s);
});

test('Exit Quality supports rolling SSE and on-demand dates', () => {
  assert.match(js, /new EventSource\(`\$\{EXIT_QUALITY_STREAM_ENDPOINT\}/);
  assert.match(js, /id="exit-quality-date"[\s\S]*type="date"/);
  assert.match(js, /exitQualityDate \|\| getTradeDateISO\(\)/);
  assert.match(js, /\['10d', '10 days'\]/);
  assert.match(js, /\/analyze-date\?date=/);
  assert.match(js, /Opportunity is side-adjusted/);
  assert.match(js, /Opportunity loss[\s\S]*Perfect exit/);
});

test('server starts exit reconciliation in the background every hour', () => {
  assert.match(proxy, /createExitQualityService\([\s\S]*intervalMs:60 \* 60 \* 1000/);
  assert.match(proxy, /setupEfficiencyService\.start\(\);\s*exitQualityService\.start\(\);/);
  assert.match(proxy, /resolveSimulationDayClosePrice/);
});
