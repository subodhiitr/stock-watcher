const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

function loadPureFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source should be extractable`);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}; result = ${name};`, context);
  return context.result;
}

test('short-term trend metrics reward a steady one-month advance', () => {
  const compute = loadPureFunction('computeShortTermTrendMetrics', 'getShortTermPickInfo');
  const metrics = compute([0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4]);
  assert.equal(metrics.sampleSize, 11);
  assert.equal(metrics.oneMonthReturnPct, 4);
  assert.equal(metrics.upRatio, 1);
  assert.equal(metrics.r2, 1);
  assert.equal(metrics.maxDrawdownPct, 0);
});

test('short-term quality fails closed and uses decimal ETF return thresholds', () => {
  assert.match(source, /metrics\.sampleSize < 10/);
  assert.match(source, /blocks\.push\('intraday trade data unavailable'\)/);
  assert.match(source, /marketOpen && freshness\.stale/);
  assert.match(source, /metrics\.maxDrawdownPct > 6/);
  assert.match(source, /health < 60/);
  assert.match(source, /sectorRelativePct < 0/);
  assert.match(source, /oneMonth < 0\.02/);
  assert.match(source, /oneYear < 0\.15/);
  assert.match(source, /quality score \$\{score\} < 65/);
});

test('short-term cards rank qualifying stocks and ETFs by quality score', () => {
  assert.match(source, /activeSetupCard === 'shortterm'[\s\S]*?\{ col: 'shortterm', dir: -1 \}/);
  assert.match(source, /activeETFSetupCard === 'shortterm' \? \{ col:'shortterm', dir:-1 \}/);
  assert.match(source, /renderShortTermQualityBadge\(row\)/);
  assert.match(source, /STQ \$\{info\.score\}/);
});
