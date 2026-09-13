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

test('Sharekhan heartbeats never refresh a previous-day market price', () => {
  const now = Date.UTC(2026, 8, 8, 5, 30);
  const freshness = loadGetIntradayFreshness(now);
  const quote = { dataSource: 'sharekhan-ws', priceTime: '2026-09-07T10:00:00Z', _updatedAt: now - 60000 };
  const before = freshness({ ...quote, fetchedAt: now - 60000 });
  const after = freshness({ ...quote, fetchedAt: now });
  assert.equal(after.stale, true);
  assert.equal(after.ageMs, before.ageMs);
  assert.match(after.reason, /Market data age/);
  assert.ok(after.ageMin > 1000);
});

test('Sharekhan uses original receipt time and tolerates an active candle start', () => {
  const now = Date.UTC(2026, 8, 8, 5, 29, 59);
  const freshness = loadGetIntradayFreshness(now);
  const quote = { dataSource: 'sharekhan-ws', priceTimeMs: now - 299000, _updatedAt: now - 1000, fetchedAt: now };
  assert.equal(freshness(quote).stale, false);
  assert.equal(freshness({ ...quote, _updatedAt: now - 360000 }).stale, true);
  assert.match(freshness({ ...quote, _updatedAt: now - 360000 }).reason, /Last quote received/);
  assert.equal(freshness({ ...quote, priceTimeMs: now - 540000 }).stale, false);
  assert.equal(freshness({ ...quote, priceTimeMs: now - 601000 }).stale, true);
});

test('Sharekhan missing timestamps cannot fall back to heartbeat arrival time', () => {
  const now = Date.now();
  const freshness = loadGetIntradayFreshness(now);
  assert.equal(freshness({ dataSource: 'sharekhan-ws', fetchedAt: now }).stale, true);
  assert.equal(freshness({ dataSource: 'sharekhan-ws', priceTimeMs: now, fetchedAt: now }).stale, true);
  assert.equal(freshness({ dataSource: 'sharekhan-ws', _updatedAt: now, priceTimeMs: 0, priceTime: new Date(now).toISOString() }).stale, false);
});
