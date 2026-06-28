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

function loadFunction(functionName, context = {}) {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const fnSource = extractFunctionSource(source, functionName);
  return vm.runInNewContext(`(${fnSource})`, context);
}

test('renderShortTargetCell preserves locked target view when open trade exists', () => {
  const renderShortTargetCell = loadFunction('renderShortTargetCell', {
    intradayData: {},
    getOpenPaperTrade: () => ({
      target: 120,
      stop: 95,
      entryPrice: 100,
    }),
    getCurrentTradePrice: () => 110,
    getPaperTradePnl: () => ({ pnl: 500, pnlPct: 5, charges: 10 }),
    moneyINR: (value) => `Rs ${Number(value).toFixed(2)}`,
    getPositionSize: () => ({ qty: 1 }),
    getTradeCostContext: () => ({ costPct: 0.4, netPct: 1.8 }),
    TRADE_RISK_PCT: 1,
    console: { debug: () => {} },
  });

  const html = renderShortTargetCell({ sym: 'INFY' });
  assert.match(html, /Locked Rs 120\.00/);
  assert.match(html, /SL Rs 95\.00/);
  assert.match(html, /Entry Rs 100\.00/);
  assert.match(html, /Net P&L Rs 500\.00 \(5%\)/);
});

test('formatEntryJournal keeps legacy setup metadata when setupType is absent', () => {
  const formatEntryJournal = loadFunction('formatEntryJournal');

  const journal = formatEntryJournal({
    source: 'manual',
    setup: 'Triggered | VWAP reclaim | Vol 1.7x',
    entryContext: null,
  });

  assert.match(journal, /Triggered/);
  assert.match(journal, /VWAP reclaim/);
});

test('renderPaperTradeControls shows No 5m data when intraday setup is missing', () => {
  const renderPaperTradeControls = loadFunction('renderPaperTradeControls', {
    getOpenPaperTrade: () => null,
    getCurrentTradePrice: () => null,
    escapeHTML: value => String(value ?? ''),
    getPortfolioSummary: () => ({ cashAvailable: 100000 }),
    getSuggestedPaperQty: () => ({ qty: 0 }),
    paperQtyInputId: sym => `qty-${sym}`,
    paperBrokerSelectId: sym => `broker-${sym}`,
    getManualTradeBrokerMode: () => 'zerodha_dry_run',
  });

  const html = renderPaperTradeControls({ sym: 'INFY' }, null);

  assert.match(html, /No 5m data/);
  assert.doesNotMatch(html, /<button class="paper-btn buy"/);
});
