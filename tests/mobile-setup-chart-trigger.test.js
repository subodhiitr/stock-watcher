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

test("today's position entry price opens the existing 5-minute candle overlay", () => {
  assert.match(app, /<span>Entry<\/span><button type="button" class="setup-chart-trigger trade-entry-chart-trigger" data-chart-symbol="\$\{sym\}"/);
  assert.match(app, /aria-label="Open \$\{sym\} 5-minute candle chart"/);
  assert.match(app, /const chartCard = event\.target\.closest\('\[data-chart-symbol\]'\);/);
  assert.match(app, /openCandleOverlay\(chartCard\.dataset\.chartSymbol\)/);
  assert.match(app, /async function openCandleOverlay\(symbol, interval = '5m'\)/);
});

test('mobile cache versions include the chart-trigger assets', () => {
  assert.match(controller, /mobile\.css\?v=20260905-32/);
  assert.match(controller, /mobile-app\.js\?v=20260905-78/);
  assert.match(serviceWorker, /intradayx-mobile-v83/);
  assert.match(serviceWorker, /mobile\.css\?v=20260905-32/);
  assert.match(serviceWorker, /mobile-app\.js\?v=20260905-78/);
});
