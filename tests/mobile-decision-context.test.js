'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

test('mobile cards show entry quality and Sharekhan live spread and depth liquidity', () => {
  assert.match(app, /function renderSetupDecisionContext\(candidate = \{\}\)/);
  assert.match(app, /indicators\.marketDepth \|\| candidate\.marketDepth/);
  assert.match(app, /sharekhan-ws/);
  assert.match(app, /data-depth-spread=/);
  assert.match(app, /Spread \$\{spreadPct == null/);
  assert.match(app, /Sharekhan depth/);
  assert.match(app, /Bid heavy \$\{Math\.round\(bidShare\)\}%/);
  assert.match(app, /Ask heavy \$\{Math\.round\(100 - bidShare\)\}%/);
  assert.match(app, /class="depth-liquidity-track"/);
  assert.match(app, /class="depth-bid" style="width:\$\{bidShare\.toFixed\(1\)\}%"/);
  assert.match(app, /class="depth-ask" style="width:\$\{\(100 - bidShare\)\.toFixed\(1\)\}%"/);
  assert.match(app, /Extended \$\{fmt\(Math\.abs\(directionalDistance\)\)\}%/);
  assert.match(proxy, /signal\.marketDepth = sharekhanMarketDepthCache\.get\(cacheKey\) \|\| null/);
  assert.match(css, /\.setup-decision-context/);
  assert.match(css, /\.depth-liquidity-track/);
  assert.match(css, /\.setup-52w-values > b, \.depth-liquidity-values > b/);
});

test('mobile cards show timeframe, market alignment and consolidated event timing', () => {
  for (const label of ["'5 min'", "'15 min'", "'Daily'", "'Sector'", "'Nifty'"]) {
    assert.ok(app.includes(`trendChip(${label}`));
  }
  assert.match(app, /data-event-line="\$\{symbol\}"/);
  assert.match(app, /compactDecisionAge\(item\.publishedAt/);
  assert.match(app, /kind === 'results' \? nextResultTiming\(symbol\) : '--'/);
  assert.match(app, /api\('\/result-calendar'/);
  assert.match(app, /void loadDecisionCalendar\(state\.candidates/);
  assert.match(app, /void loadDecisionCalendar\(state\.allStocks/);
  assert.match(proxy, /trend15m/);
  assert.match(proxy, /dailyTrend/);
});

test('Setup and All Stocks cards use the same decision context renderer', () => {
  assert.equal((app.match(/const decisionContext = renderSetupDecisionContext\(/g) || []).length, 2);
  assert.equal((app.match(/\$\{decisionContext\}/g) || []).length, 2);
});
