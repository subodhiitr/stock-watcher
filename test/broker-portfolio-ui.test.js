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

test('renders combined broker pill from source contract', () => {
  const { source, context } = loadDashboardApp();
  const contract = findFunctionByContracts(source, [
    'broker-portfolio-pill',
    'combinedOpenCount',
    'combinedDayPnl',
  ]);

  assert.ok(
    contract,
    'dashboard-app.js is missing the combined broker pill contract'
  );

  const updateBrokerPortfolioPill = context[contract.name];
  assert.equal(typeof updateBrokerPortfolioPill, 'function');

  const pill = context.document.getElementById('broker-portfolio-pill');
  context.brokerPortfolioState = {
    loading: false,
    ok: true,
    data: {
      combinedOpenCount: 7,
      combinedDayPnl: 4320,
      zerodha: {
        ok: true,
        portfolio: {
          positions: { openCount: 3, dayPnl: 1820 },
          funds: { availableCash: 125000 },
          holdings: { count: 4 },
        },
      },
      sharekhan: {
        ok: true,
        portfolio: {
          positions: { openCount: 4, dayPnl: 2500 },
          funds: { availableCash: 98000 },
          holdings: { count: 2 },
        },
      },
    },
  };

  updateBrokerPortfolioPill();

  assert.equal(pill.textContent, 'Brokers Open 7 · Day +₹4,320');
  assert.match(pill.title, /Zerodha: Open 3 · Day \+₹1,820/);
  assert.match(pill.title, /Sharekhan: Open 4 · Day \+₹2,500/);
  assert.ok(pill.classList.contains('live'));
});

test('keeps partial availability and class behavior in sync', () => {
  const { source, context } = loadDashboardApp();
  const contract = findFunctionByContracts(source, [
    'broker-portfolio-pill',
    'combinedOpenCount',
    'combinedDayPnl',
    'partial',
  ]);

  assert.ok(
    contract,
    'dashboard-app.js is missing the partial-availability broker pill contract'
  );

  const updateBrokerPortfolioPill = context[contract.name];
  assert.equal(typeof updateBrokerPortfolioPill, 'function');

  const pill = context.document.getElementById('broker-portfolio-pill');
  context.brokerPortfolioState = {
    loading: false,
    ok: true,
    data: {
      zerodha: {
        ok: true,
        portfolio: {
          positions: { openCount: 2, dayPnl: -500 },
        },
      },
      sharekhan: {
        ok: false,
        error: 'timeout',
      },
    },
  };

  updateBrokerPortfolioPill();

  assert.equal(pill.textContent, 'Brokers Open 2 · Day -₹500');
  assert.match(pill.title, /timeout/i);
  assert.match(pill.title, /partial/i);
  assert.ok(pill.classList.contains('warn'));
  assert.ok(!pill.classList.contains('down'));
});
