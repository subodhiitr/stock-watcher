const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        openBrace = source.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

test('stock price cell opens intraday candle chart modal', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const renderStockRowHTML = vm.runInNewContext(`(${extractFunctionSource(source, 'renderStockRowHTML')})`, {
    getDisplayChangePct: () => 1.23,
    getSignal: () => 'buy',
    escapeHTML: value => String(value ?? ''),
    isStockFavorite: () => false,
    isCustomStock: () => false,
    renderTradeCell: () => '',
    renderShortTargetCell: () => '',
    renderHealthCell: () => '',
    renderHealthEventBadges: () => '',
    sparkBars: () => '',
    renderTargetCell: () => '',
  });

  const html = renderStockRowHTML({ sym: 'TCS', name: 'TCS', sector: 'IT', cap: 'large', data: { price: 3400, low52: 3000, high52: 4200 } });

  assert.match(html, /openIntradayCandleChart\('TCS'/);
  assert.match(html, /title="Open 5m intraday candlestick chart"/);
});

test('dashboard defines intraday candle chart modal rendering hooks', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');

  assert.match(source, /const INTRADAY_CANDLES_ENDPOINT = `\$\{PROXY\}\/intraday-candles`/);
  assert.match(source, /function openIntradayCandleChart\(/);
  assert.match(source, /function renderIntradayCandleChart\(/);
  assert.match(source, /data-chart-range="1d"/);
  assert.match(source, /data-chart-range="2d"/);
  assert.match(source, /data-chart-range="5d"/);
});

test('intraday candle chart renders gridlines, x-axis time labels, volume bars, and hover details', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const script = new vm.Script(`
    ${extractFunctionSource(source, 'normalizeChartCandles')}
    ${extractFunctionSource(source, 'renderIntradayCandleChart')}
    renderIntradayCandleChart;
  `);
  const renderIntradayCandleChart = script.runInNewContext({
    Number,
    Math,
    Date,
    escapeHTML: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])),
  });

  const html = renderIntradayCandleChart('NAUKRI', [
    { time: '2026-07-08T03:45:00.000Z', open: 1210, high: 1217.5, low: 1208.5, close: 1215, volume: 1000 },
    { time: '2026-07-08T03:50:00.000Z', open: 1215, high: 1216, low: 1209, close: 1210, volume: 2500 },
    { time: '2026-07-08T03:55:00.000Z', open: 1210, high: 1212, low: 1207, close: 1211, volume: 1500 },
  ]);

  assert.match(html, /intraday-y-grid/);
  assert.match(html, /intraday-y-axis-label/);
  assert.match(html, /intraday-x-axis-label/);
  assert.match(html, /intraday-volume-bar/);
  assert.match(html, /intraday-candle-hover/);
  assert.match(html, /intraday-crosshair/);
  assert.match(html, /Volume/);
  assert.match(html, /O:1210\.00 H:1217\.50 L:1208\.50 C:1215\.00 V:1,000/);
});

test('intraday candle chart ignores bad outlier candles when scaling', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const script = new vm.Script(`
    ${extractFunctionSource(source, 'normalizeChartCandles')}
    ${extractFunctionSource(source, 'renderIntradayCandleChart')}
    renderIntradayCandleChart;
  `);
  const renderIntradayCandleChart = script.runInNewContext({
    Number,
    Math,
    Date,
    escapeHTML: value => String(value ?? ''),
  });

  const html = renderIntradayCandleChart('INDIGO', [
    { time: '2026-07-08T03:45:00.000Z', open: 5200, high: 5220, low: 5180, close: 5198, volume: 1000 },
    { time: '2026-07-08T03:50:00.000Z', open: 5198, high: 5205, low: 5190, close: 5195, volume: 2500 },
    { time: '2026-07-08T03:55:00.000Z', open: 0, high: 1, low: -10, close: 0.8, volume: 1500 },
  ]);

  assert.doesNotMatch(html, /₹-?\d{1,3}\.\d{2}/);
  assert.doesNotMatch(html, /C:0\.80/);
  assert.match(html, /2 candles/);
});
