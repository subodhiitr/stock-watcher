import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../nse_midcap_dashboard.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../dashboard-app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const proxy = fs.readFileSync(new URL('../ticker_proxy.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../replay_worker.js', import.meta.url), 'utf8');

test('Strategy Advisor is parallel to Replay and responsive on mobile', () => {
  assert.match(html, /Replay<\/button>[\s\S]*openStrategyAdvisorPanel\(\)">Strategy Advisor/);
  assert.match(html, /id="strategy-advisor-modal"/);
  assert.match(css, /#strategy-advisor-modal \.strategy-advisor-panel/);
  assert.match(css, /@media\(max-width:820px\).*#strategy-advisor-modal/s);
});

test('Strategy Advisor streams file updates and never exposes an automatic apply action', () => {
  assert.match(js, /new EventSource\(`\$\{STRATEGY_ADVISOR_ENDPOINT\}\/stream/);
  assert.match(js, /Prepare evidence/);
  assert.match(js, /Evidence file is ready/);
  assert.match(js, /Replay off/);
  assert.doesNotMatch(js, /applyStrategyAdvisor/);
});

test('Codex advisor does not call AI or invoke a targeted replay worker', () => {
  assert.doesNotMatch(proxy, /callStrategyAdvisorModel|runStrategyAdvisorTargetedTrial/);
  assert.doesNotMatch(worker, /runTargetedTrial|mode === 'targeted'/);
});
