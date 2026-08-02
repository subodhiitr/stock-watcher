'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'mobile-sw.js'), 'utf8');

test('setup price and change card opens the existing 5m or 15m candle overlay', () => {
  assert.match(app, /class="setup-chart-trigger" data-chart-symbol="\$\{sym\}"/);
  assert.match(app, /Price \/ Change/);
  assert.match(app, /event\.target\.closest\('\[data-chart-symbol\]'\)/);
  assert.match(app, /openCandleOverlay\(chartCard\.dataset\.chartSymbol\)/);
  assert.match(app, /interval === '15m' \? '15m' : '5m'/);
  assert.match(css, /\.setup-chart-trigger \{[^}]*cursor: pointer/);
});

test('mobile cache versions include the chart-trigger assets', () => {
  assert.match(controller, /mobile\.css\?v=20260801-20/);
  assert.match(controller, /mobile-app\.js\?v=20260801-60/);
  assert.match(serviceWorker, /intradayx-mobile-v64/);
  assert.match(serviceWorker, /mobile\.css\?v=20260801-20/);
  assert.match(serviceWorker, /mobile-app\.js\?v=20260801-60/);
});
