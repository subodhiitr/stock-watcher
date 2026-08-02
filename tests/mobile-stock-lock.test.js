const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'mobile.css'), 'utf8');

test('setups and all stocks show open positions as locked with entry price', () => {
  assert.match(app, /function openTradeForSymbol/);
  assert.match(app, /stock-lock broker-status--\$\{brokerState\}"><b>Locked · Entry \$\{fmt\(lockedTrade\.entryPrice\)\}/);
  assert.match(app, /lockedTrade \? 'Locked' : canTrade \? 'Trade'/);
  assert.match(css, /\.setup-card\.is-locked, \.all-stock-row\.is-locked/);
});

test('trade stream refreshes locks and click handlers reject duplicate entries', () => {
  assert.match(app, /renderTrades\(\);\s*renderSetups\(\);\s*renderAllStocks\(\)/);
  assert.match(app, /is locked at entry \$\{fmt\(lockedTrade\.entryPrice\)\}/);
});
