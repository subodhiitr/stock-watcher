const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'mobile.css'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

test('trade click immediately shows opening state and disables duplicate clicks', () => {
  assert.match(app, /pendingTradeSymbols: new Set\(\)/);
  assert.match(app, /Opening…/);
  assert.match(app, /state\.pendingTradeSymbols\.has\(symbol\)/);
  assert.match(css, /\.setup-card\.is-opening, \.all-stock-row\.is-opening/);
});

test('trade result immediately updates open state and shows global success or failure', () => {
  assert.match(controller, /id="global-status" role="status"/);
  assert.match(app, /state\.trades = \[\.\.\.state\.trades\.filter/);
  assert.match(app, /brokerState === 'pending'/);
  assert.match(app, /trade failed: \$\{statusText\}/);
  assert.match(app, /X-Live-Trade-Confirm/);
  assert.match(app, /trade failed:/);
  assert.match(css, /\.global-status\.visible/);
});
