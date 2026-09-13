const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('dashboard-app.js');
const dashboardCss = read('dashboard.css');
const desktopShell = read('nse_midcap_dashboard.html');
const mobile = read('mobile-app.js');
const mobileCss = read('mobile.css');
const mobileShell = read(path.join('my-remix-app', 'app', 'actions', 'controller.tsx'));
const mobileSw = read('mobile-sw.js');

test('desktop exposes Opportunity Research through the live server candidate view', () => {
  assert.match(dashboard, /'Opportunity Research'/);
  assert.match(dashboard, /selectOpportunityResearchCard\(\)/);
  assert.match(dashboard, /\['simulation_top25', 'combined_top', 'opportunity_research'\]/);
  assert.match(dashboard, /renderOpportunityResearch\(serverCandidate\)/);
  assert.match(dashboardCss, /\.opportunity-research-panel/);
});

test('desktop research panel renders shadow status, six leader indicators, and complete rejection evidence', () => {
  assert.match(dashboard, /TOP_GAINER_CONTROLLED_RETEST/);
  assert.match(dashboard, /Controlled Retest:/);
  assert.match(dashboard, /Shadow only/);
  for (const key of [
    'leaderRankPersistencePct30m',
    'leaderRankStability30m',
    'recentHighRetestPct',
    'emaSpreadSlope3Bars',
    'triggerExtensionAtr',
    'leaderReacceleration',
  ]) assert.match(dashboard, new RegExp(key));
  assert.match(dashboard, /candidate\.rejectionReasons/);
  assert.match(dashboard, /candidate\.eligibilityReasons/);
  assert.match(dashboard, /Selection \/ capacity evidence/);
});

test('mobile setup selector and stream expose Opportunity Research as a non-trading research view', () => {
  assert.match(mobileShell, /<option value="opportunity_research">Opportunity Research<\/option>/);
  assert.match(mobile, /opportunity_research: \(\) => true/);
  assert.match(mobile, /\['simulation_top25', 'combined_top', 'opportunity_research'\]\.includes\(state\.setupFilter\)/);
  assert.match(mobile, /const canTrade = !researchFilter/);
  assert.match(mobile, /renderOpportunityResearch\(c\)/);
  assert.match(mobileCss, /\.opportunity-research-panel/);
});

test('rangebound signal recovery observation is visible in mobile Today Positions and desktop trade history', () => {
  assert.match(mobile, /function renderSignalRecoveryObservation/);
  assert.match(mobile, /renderSignalRecoveryObservation\(trade\)/);
  assert.match(mobileCss, /\.signal-recovery-observation/);
  assert.match(dashboard, /function formatSignalRecoveryObservation/);
  assert.match(dashboard, /\[trade\.closeReason \|\| '--', formatSignalRecoveryObservation\(trade\)\]/);
});

test('desktop and mobile shells reference the opportunity-research asset versions', () => {
  assert.match(desktopShell, /dashboard\.css\?v=20260905-60/);
  assert.match(desktopShell, /dashboard-app\.js\?v=20260905-83/);
  assert.match(mobileShell, /dashboard\.css\?v=20260905-60/);
  assert.match(mobileShell, /dashboard-app\.js\?v=20260905-83/);
  assert.match(mobileShell, /mobile\.css\?v=20260905-32/);
  assert.match(mobileShell, /mobile-app\.js\?v=20260905-78/);
  assert.match(mobileSw, /intradayx-mobile-v83/);
  assert.match(mobileSw, /mobile\.css\?v=20260905-32/);
  assert.match(mobileSw, /mobile-app\.js\?v=20260905-78/);
});
