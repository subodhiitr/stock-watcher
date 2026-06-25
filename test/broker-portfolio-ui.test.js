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

function loadDashboardFunction(candidates, context = {}) {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  for (const functionName of candidates) {
    const fnSource = extractFunctionSource(source, functionName);
    if (fnSource) return vm.runInNewContext(`(${fnSource})`, context);
  }
  throw new Error(`None of these functions were found: ${candidates.join(', ')}`);
}

function createPillStub() {
  const classes = new Set();
  return {
    textContent: '',
    title: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      snapshot: () => [...classes].sort(),
    },
  };
}

function renderCombinedContext(stateOverrides = {}) {
  const pill = createPillStub();
  const context = {
    brokerMode: 'paper',
    brokerPortfolioState: {
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
      ...stateOverrides,
    },
    zerodhaPortfolioState: stateOverrides.zerodhaPortfolioState || {
      loading: false,
      ok: true,
      data: {
        portfolio: {
          funds: { availableCash: 125000 },
          positions: { dayPnl: 1820, openCount: 3 },
          holdings: { count: 4 },
          asOf: 1710000000000,
        },
      },
    },
    document: {
      getElementById: (id) => (id === 'zerodha-portfolio-pill' ? pill : null),
    },
    moneyINR: (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`,
    toIST: (value) => `IST(${value})`,
    formatZerodhaPillMoney: (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`,
    console: { warn: () => {}, error: () => {} },
  };
  return { pill, context };
}

test('renders combined brokers-open pill copy', () => {
  const { pill, context } = renderCombinedContext();
  const fn = loadDashboardFunction(
    ['updateBrokerPortfolioPill', 'updateZerodhaPortfolioPill'],
    { ...context, document: { getElementById: (id) => (id === 'zerodha-portfolio-pill' ? pill : null) } },
  );

  fn();

  assert.equal(pill.textContent, 'Brokers Open 7 · Day +₹4,320');
  assert.match(pill.title, /Zerodha: Open 3 · Day \+₹1,820/);
  assert.match(pill.title, /Sharekhan: Open 4 · Day \+₹2,500/);
  assert.ok(pill.classList.contains('live'));
});

test('keeps tooltip breakdown and class in sync with combined day P&L', () => {
  const { pill, context } = renderCombinedContext({
    brokerPortfolioState: {
      loading: false,
      ok: true,
      data: {
        combinedOpenCount: 5,
        combinedDayPnl: 300,
        zerodha: {
          ok: true,
          portfolio: {
            positions: { openCount: 2, dayPnl: -500 },
          },
        },
        sharekhan: {
          ok: true,
          portfolio: {
            positions: { openCount: 3, dayPnl: 800 },
          },
        },
      },
    },
    zerodhaPortfolioState: {
      loading: false,
      ok: true,
      data: {
        portfolio: {
          funds: { availableCash: 90000 },
          positions: { dayPnl: -500, openCount: 2 },
          holdings: { count: 1 },
        },
      },
    },
  });

  const fn = loadDashboardFunction(
    ['updateBrokerPortfolioPill', 'updateZerodhaPortfolioPill'],
    {
      ...context,
      document: { getElementById: (id) => (id === 'zerodha-portfolio-pill' ? pill : null) },
    },
  );

  fn();

  assert.equal(pill.textContent, 'Brokers Open 5 · Day +₹300');
  assert.match(pill.title, /Zerodha: Open 2 · Day -₹500/);
  assert.match(pill.title, /Sharekhan: Open 3 · Day \+₹800/);
  assert.ok(pill.classList.contains('live'));
  assert.ok(!pill.classList.contains('warn'));
  assert.ok(!pill.classList.contains('down'));
});
