const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) return null;
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
  if (openBrace < 0) return null;
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function loadAggregateFunction(candidates, context = {}) {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  for (const functionName of candidates) {
    const fnSource = extractFunctionSource(source, functionName);
    if (fnSource) return vm.runInNewContext(`(${fnSource})`, context);
  }
  throw new Error(`None of these functions were found: ${candidates.join(', ')}`);
}

test('aggregates combined open count and day P&L across brokers', () => {
  const aggregateBrokerPortfolioState = loadAggregateFunction([
    'aggregateBrokerPortfolioState',
  ]);

  const result = aggregateBrokerPortfolioState({
    zerodha: {
      ok: true,
      data: { portfolio: { positions: { openCount: 3, dayPnl: 1820 } } },
    },
    sharekhan: {
      ok: true,
      data: { portfolio: { positions: { openCount: 4, dayPnl: 2500 } } },
    },
  });

  assert.equal(result.combinedOpenCount, 7);
  assert.equal(result.combinedDayPnl, 4320);
  assert.match(JSON.stringify(result), /zerodha/i);
  assert.match(JSON.stringify(result), /sharekhan/i);
});

test('preserves partial availability when one broker fails', () => {
  const aggregateBrokerPortfolioState = loadAggregateFunction([
    'aggregateBrokerPortfolioState',
  ]);

  const result = aggregateBrokerPortfolioState({
    zerodha: {
      ok: true,
      data: { portfolio: { positions: { openCount: 2, dayPnl: -500 } } },
    },
    sharekhan: {
      ok: false,
      error: 'timeout',
    },
  });

  assert.equal(result.combinedOpenCount, 2);
  assert.equal(result.combinedDayPnl, -500);
  assert.ok(result.partialAvailability ?? result.partial ?? result.isPartial ?? result.hasPartialAvailability);
  assert.match(JSON.stringify(result), /timeout/i);
});
