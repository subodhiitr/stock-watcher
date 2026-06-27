const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TradeRules = require('../trade_rules.js');
const SimulationEngine = require('../simulation_engine.js');

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

function makeElement() {
  const classes = new Set();
  return {
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    value: '',
    disabled: false,
    classList: {
      add(...items) { items.forEach(item => classes.add(item)); },
      remove(...items) { items.forEach(item => classes.delete(item)); },
      toggle(item, force) {
        if (force === true) { classes.add(item); return true; }
        if (force === false) { classes.delete(item); return false; }
        if (classes.has(item)) { classes.delete(item); return false; }
        classes.add(item);
        return true;
      },
      contains(item) { return classes.has(item); },
    },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    scrollIntoView() {},
    setAttribute() {},
  };
}

function createSandbox() {
  const elementCache = new Map();
  const document = {
    getElementById(id) {
      if (!elementCache.has(id)) elementCache.set(id, makeElement());
      return elementCache.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: makeElement(),
  };
  const window = {
    __DASHBOARD_ROUTE__: {},
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  window.window = window;
  return {
    window,
    document,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { protocol: 'file:', origin: 'http://localhost:3001' },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    AbortSignal: { timeout: () => ({}) },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout() {},
    clearInterval() {},
    Promise,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    RegExp,
    Array,
    Set,
    Map,
    WeakMap,
    WeakSet,
    Object,
    Error,
    TypeError,
    EventSource: function EventSource() {},
    alert: () => {},
    TradeRules,
    SimulationEngine,
  };
}

function loadDashboardApp() {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const context = createSandbox();
  vm.runInNewContext(source, context, { timeout: 1500 });
  return { source, context };
}

function findFunctionByContracts(source, requiredSnippets) {
  const candidates = [];
  const seen = new Set();
  const pattern = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const fnSource = extractFunctionSource(source, name);
    if (fnSource && requiredSnippets.every((snippet) => fnSource.includes(snippet))) {
      candidates.push({ name, fnSource });
    }
  }
  return candidates[0] || null;
}

test('aggregates broker state without exact helper names', () => {
  const { source, context } = loadDashboardApp();
  const aggregate = findFunctionByContracts(source, [
    'combinedOpenCount',
    'combinedDayPnl',
    'normalizeBrokerPortfolioSlice(',
  ]);

  assert.ok(
    aggregate,
    'dashboard-app.js is missing the combined broker aggregate contract'
  );

  const aggregateBrokerPortfolioState = context[aggregate.name];
  assert.equal(typeof aggregateBrokerPortfolioState, 'function');

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
  const { source, context } = loadDashboardApp();
  const aggregate = findFunctionByContracts(source, [
    'combinedOpenCount',
    'combinedDayPnl',
    'partial',
  ]);

  assert.ok(
    aggregate,
    'dashboard-app.js is missing the partial-availability aggregate contract'
  );

  const aggregateBrokerPortfolioState = context[aggregate.name];
  assert.equal(typeof aggregateBrokerPortfolioState, 'function');

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
