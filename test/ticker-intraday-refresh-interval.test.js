const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

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

function loadRefreshIntervalFn(fakeNowIso) {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const weekendSource = extractFunctionSource(source, 'isIstWeekend');
  const fnSource = extractFunctionSource(source, 'getIntradayLiveRefreshIntervalSec');
  class FakeDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : fakeNowIso);
    }
    static now() {
      return new Date(fakeNowIso).getTime();
    }
  }
  const isIstWeekend = vm.runInNewContext(`(${weekendSource})`, { Date: FakeDate });
  return vm.runInNewContext(`(${fnSource})`, {
    Date: FakeDate,
    isIstWeekend,
    INTRADAY_LIVE_REFRESH_MARKET_SEC: 60,
    INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC: 900,
  });
}

test('server intraday refresh uses 60s during market hours', () => {
  const fn = loadRefreshIntervalFn('2026-06-25T05:00:00.000Z'); // 10:30 IST
  assert.equal(fn(), 60);
});

test('server intraday refresh uses 15min outside market hours', () => {
  const beforeOpen = loadRefreshIntervalFn('2026-06-25T02:00:00.000Z'); // 07:30 IST
  assert.equal(beforeOpen(), 900);
});

test('server intraday refresh loop is weekend cache-only (no fetch)', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function isIstWeekend\(/);
  assert.match(source, /if\s*\(isIstWeekend\(\)\)\s*\{\s*return\s*\{\s*ok:\s*true,\s*skipped:\s*true,\s*reason:\s*'weekend-cache-only'\s*\};\s*\}/);
});
