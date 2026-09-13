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
test('combined browser trade card keeps mobile-style metrics and desktop details', () => {
  const renderCombinedTradeCell = loadFunction('renderCombinedTradeCell', {
    intradayData: { INFY: { price: 100, target: 104, stop: 98, rr: 2 } },
    getOpenPaperTrade: () => null,
    getCurrentTradePrice: () => 100,
    getPaperTradePnl: () => null,
    getTradeCostContext: () => ({ costPct: 0.2, netPct: 3.8 }),
    getPositionSize: () => ({ qty: 25 }),
    adjustedTradeSignal: () => 'buy',
    adjustedTradeScore: () => 80,
    renderTradeMarketCharts: () => '<div>market charts</div>',
    renderTradeCell: () => '<div class="trade-cell">legacy desktop details</div>',
    moneyINR: value => `Rs ${Number(value).toFixed(2)}`,
    escapeHTML: value => String(value ?? ''),
  });

  const html = renderCombinedTradeCell({ sym:'INFY', data:{ price:100 } });
  assert.match(html, /browser-trade-card/);
  assert.match(html, />Signal</);
  assert.match(html, />Target</);
  assert.match(html, />Stop</);
  assert.match(html, />R:R</);
  assert.doesNotMatch(html, />Price</);
  assert.doesNotMatch(html, />Cost</);
  assert.doesNotMatch(html, />Net</);
  assert.doesNotMatch(html, />Qty</);
  assert.equal((html.match(/browser-trade-stat/g) || []).length, 4);
  assert.match(html, /Setup &amp; execution details/);
  assert.match(html, /legacy desktop details/);
  assert.match(html, /market charts/);
});

test('trade details use friendly chips and an amber recommendation footer', () => {
  const renderTradeContext = loadFunction('renderTradeContext', {
    getIntradayFreshness: () => ({ stale:false, reason:'Live', label:'Fresh 0m' }),
    getRelativeStrength: () => 2.4,
    sectorTrendCache: { IT:1.1 },
    getLiquidityInfo: () => ({ level:'good', label:'High liquidity', tradedCr:72 }),
    getTradeCostContext: () => ({ netPct:1.2 }),
    getTimeWarning: () => ({ level:'ok', label:'' }),
    getEventFlag: () => null,
    escapeHTML: value => String(value ?? ''),
  });
  const contextHtml = renderTradeContext({ sym:'INFY', sector:'IT' }, {
    entryStatus:'Triggered',
    price:101,
    pivot:100,
    high5:100.5,
    relVolume:1.8,
  });
  assert.match(contextHtml, /trade-chip-row/);
  assert.match(contextHtml, /Above pivot/);
  assert.match(contextHtml, /5-day breakout/);
  assert.doesNotMatch(contextHtml, / · /);

  const renderTradeCell = loadFunction('renderTradeCell', {
    activeSetupCard: '',
    serverSimulationCandidateSnapshot: {},
    intradayData: { INFY: { entryTrigger:'Wait for VWAP confirmation', reasons:['Above pivot', 'Volume improving'] } },
    adjustedTradeScore: () => 44,
    adjustedTradeSignal: () => 'watch',
    getRiskGuard: () => ({ level:'small', label:'Small qty', reason:'Reduce size' }),
    getTradeConfidence: () => ({ level:'low', label:'Low', reason:'Needs confirmation' }),
    renderTradeContext: () => '<div class="trade-chip-row">context</div>',
    renderShortTermQualityBadge: () => '',
    renderRangeboundTradeInfo: () => '',
    renderPaperTradeControls: () => '<div class="paper-actions">qty and trade controls</div>',
    escapeHTML: value => String(value ?? ''),
  });
  const detailHtml = renderTradeCell({ sym:'INFY' });
  assert.match(detailHtml, /trade-overview/);
  assert.match(detailHtml, /browser-trade-recommendation/);
  assert.match(detailHtml, /Recommendation:/);
  assert.match(detailHtml, /Wait for VWAP confirmation · Above pivot · Volume improving/);
  assert.match(detailHtml, /qty and trade controls/);
});
test('browser trade charts show 52-week position and Sharekhan bid ask data', () => {
  const renderTradeMarketCharts = loadFunction('renderTradeMarketCharts', {
    moneyINR: value => `Rs ${Number(value).toFixed(2)}`,
    escapeHTML: value => String(value ?? ''),
  });
  const html = renderTradeMarketCharts({ sym:'INFY', data:{ low52:80, high52:120 } }, {
    marketDepth:{
      source:'sharekhan-ws',
      bestBidPrice:99.9,
      bestAskPrice:100.1,
      totalBidQuantity:60000,
      totalAskQuantity:40000,
      spreadPct:0.2,
    },
  }, 100);
  assert.match(html, /52W Low \/ High/);
  assert.match(html, /50% through range/);
  assert.match(html, /Bid \/ Ask Depth/);
  assert.match(html, /Bid Rs 99\.90/);
  assert.match(html, /Ask Rs 100\.10/);
  assert.match(html, /Spread 0\.20%/);
  assert.match(html, /Bid heavy 60%/);
  assert.match(html, /width:60\.0%/);
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
