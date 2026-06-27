const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
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

function loadGetIntradayFreshness(nowMs, staleMs = 5 * 60 * 1000) {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const fnSource = extractFunctionSource(source, 'getIntradayFreshness');
  const FakeDate = {
    now: () => nowMs,
    parse: (value) => Date.parse(value),
  };
  return vm.runInNewContext(`(${fnSource})`, {
    INTRADAY_STALE_MS: staleMs,
    Date: FakeDate,
  });
}

test('freshness uses priceTimeMs over fetchedAt when available', () => {
  const now = Date.UTC(2026, 5, 25, 9, 0, 0);
  const getIntradayFreshness = loadGetIntradayFreshness(now);
  const result = getIntradayFreshness({
    priceTimeMs: now - (6 * 60 * 1000),
    fetchedAt: now - (30 * 1000),
  });
  assert.equal(result.stale, true);
});

test('freshness uses fetchedAt only when price time is missing', () => {
  const now = Date.UTC(2026, 5, 25, 9, 0, 0);
  const getIntradayFreshness = loadGetIntradayFreshness(now);
  const result = getIntradayFreshness({
    fetchedAt: now - (30 * 1000),
  });
  assert.equal(result.stale, false);
});
