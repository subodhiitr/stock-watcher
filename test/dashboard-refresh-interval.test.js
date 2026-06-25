const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  let openParen = source.indexOf('(', start);
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

function loadGetRefreshInterval(fakeNowIso) {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const fnSource = extractFunctionSource(source, 'getRefreshInterval');
  class FakeDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : fakeNowIso);
    }
    static now() {
      return new Date(fakeNowIso).getTime();
    }
  }
  return vm.runInNewContext(`(${fnSource})`, { Date: FakeDate });
}

test('uses 30s refresh cadence during market hours', () => {
  const getRefreshInterval = loadGetRefreshInterval('2026-06-25T05:00:00.000Z'); // 10:30 IST weekday
  assert.equal(getRefreshInterval(), 30);
});

test('uses 120s refresh cadence outside market hours', () => {
  const beforeOpen = loadGetRefreshInterval('2026-06-25T02:00:00.000Z'); // 07:30 IST weekday
  const weekend = loadGetRefreshInterval('2026-06-28T05:00:00.000Z'); // Sunday
  assert.equal(beforeOpen(), 120);
  assert.equal(weekend(), 120);
});
