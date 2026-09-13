const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

test('mobile setup cards render a clickable 52-week low/high range', () => {
  const start = app.indexOf('function renderSetups');
  const end = app.indexOf('function syncDirectionalActionLabels', start);
  const body = app.slice(start, end);

  assert.match(app, /function setup52WeekRangeContent/);
  assert.match(app, /summary\.low52/);
  assert.match(app, /summary\.high52/);
  assert.match(body, /renderSetup52WeekRange\(c\)/);
  assert.match(app, /data-52w-symbol=/);
  assert.match(app, /data-sparkline-symbol=/);
  assert.match(app, /state\.stockSummaries\[symbol\] = message\.data/);
  assert.match(css, /\.setup-52w-track/);
});

test('clicking the 52-week range opens a one-month sparkline in the shared chart sheet', () => {
  assert.match(app, /async function openSparklineOverlay/);
  assert.match(app, /\/sparklines\?symbols=/);
  assert.match(app, /function renderSparklineSvg/);
  assert.match(app, /1 Month Trend/);
  assert.match(app, /closest\('\[data-sparkline-symbol\]'\)/);
  assert.match(app, /openSparklineOverlay\(sparklineRange\.dataset\.sparklineSymbol\)/);
  assert.match(controller, /id="candle-interval-toolbar"/);
  assert.match(css, /\.candle-interval-toolbar\[hidden\]/);
  assert.match(css, /\.mobile-sparkline-svg/);
});
