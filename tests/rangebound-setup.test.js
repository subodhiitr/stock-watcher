const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ProxyRuntime = require('../ticker_proxy');
const SimulationEngine = require('../simulation_engine');

function rangeboundCandidate(price = 100.05) {
  return {
    symbol:'RANGE',
    side:'buy',
    signal:'buy',
    score:40,
    price,
    priceAtSnapshot:price,
    sector:'Retail',
    freshness:{ stale:false },
    guard:{ level:'ok' },
    cost:{
      targetPct:0.95,
      costPct:0.1,
      slippagePct:0.06,
      netPct:0.79,
      ok:false,
    },
    indicators:{
      price,
      entryPrice:100,
      entryStatus:'Triggered',
      entryTrigger:'Buy near lower range 100.00; upper range 101.00',
      stopPct:0.3,
      vwap:100.5,
      dayChange:0.1,
      rangebound:{
        detected:true,
        windowMin:45,
        bars:9,
        lower:100,
        upper:101,
        rangePct:1,
        lowerDistancePct:(price - 100),
        lowerTouches:5,
        upperTouches:4,
        midpointCrosses:7,
      },
    },
  };
}

test('intraday scorer identifies a 45-minute oscillation and triggers at its lower boundary', () => {
  const closes = [100.1, 100.8, 100.2, 100.9, 100.15, 100.85, 100.2, 100.8, 100.05];
  const opens = [100.15, 100.2, 100.75, 100.25, 100.8, 100.2, 100.75, 100.25, 100.7];
  const highs = [100.3, 101, 100.4, 101, 100.35, 101, 100.4, 101, 100.2];
  const lows = [100, 100.6, 100.05, 100.7, 100, 100.65, 100.05, 100.7, 100];
  const volumes = closes.map(() => 1000);
  const start = Date.parse('2026-07-30T04:00:00.000Z') / 1000;
  const timestamp = closes.map((_, index) => start + index * 300);
  const result = {
    meta:{ regularMarketPrice:100.05, regularMarketOpen:100.1, previousClose:100 },
    timestamp,
    indicators:{ quote:[{ open:opens, high:highs, low:lows, close:closes, volume:volumes }] },
  };

  const signal = ProxyRuntime.__test__.buildIntradaySignalForTests('RANGE', result, {
    prevDayClose:100,
    prevDayHigh:105,
    prevDayLow:95,
    pivot:102,
    high5:106,
    low5:94,
    high20:110,
    low20:90,
    avgVolume20:9000,
  });

  assert.equal(signal.rangebound.detected, true);
  assert.equal(signal.rangebound.atLower, true);
  assert.equal(signal.signal, 'buy');
  assert.equal(signal.entryStatus, 'Triggered');
  assert.equal(signal.entryPrice, 100);
  assert.equal(signal.target, 101);
  assert.match(signal.entryTrigger, /Buy near lower range 100\.00/);
});

test('rangebound setup uses relaxed eligibility only at the lower boundary', () => {
  const settings = {
    SIMULATION_RANGEBOUND_MIN_SCORE:35,
    SIMULATION_RANGEBOUND_MIN_BREADTH_PCT:25,
    SIMULATION_RANGEBOUND_MIN_NET_PROFIT_PCT:0.4,
    SIMULATION_RANGEBOUND_MIN_GROSS_TO_COST_MULTIPLE:1.5,
  };
  const context = {
    market:{
      breadth:{ advancePct:30 },
      indices:{ nifty50:{ change:-0.1 } },
    },
    sectorTrend:{ Retail:-0.5 },
  };
  const candidate = rangeboundCandidate();

  assert.equal(SimulationEngine.deriveSetupType(candidate, settings), 'RANGEBOUND');
  assert.equal(SimulationEngine.getRangeboundInfo(candidate, settings).ok, true);
  assert.deepEqual(
    SimulationEngine.explainCandidateEligibility(candidate, '2026-07-30T08:50:00.000Z', settings, context).reasons,
    []
  );

  const awayFromLower = rangeboundCandidate(100.4);
  awayFromLower.indicators.entryStatus = 'Wait';
  assert.match(
    SimulationEngine.getSetupBlockReason(awayFromLower, 'RANGEBOUND', '2026-07-30T08:50:00.000Z', settings, context),
    /above lower boundary/
  );
});

test('rangebound entries are allowed only from 10:00 through 14:45 IST', () => {
  const settings = {
    SIMULATION_RANGEBOUND_ENTRY_START_MIN:10 * 60,
    SIMULATION_RANGEBOUND_ENTRY_CUTOFF_MIN:14 * 60 + 45,
  };
  const candidate = rangeboundCandidate();

  assert.match(
    SimulationEngine.getSetupBlockReason(candidate, 'RANGEBOUND', '2026-07-30T04:29:00.000Z', settings, {}),
    /start at 10:00 IST/
  );
  assert.equal(
    SimulationEngine.getSetupBlockReason(candidate, 'RANGEBOUND', '2026-07-30T04:30:00.000Z', settings, {}),
    ''
  );
  assert.equal(
    SimulationEngine.getSetupBlockReason(candidate, 'RANGEBOUND', '2026-07-30T09:14:59.000Z', settings, {}),
    ''
  );
  assert.match(
    SimulationEngine.getSetupBlockReason(candidate, 'RANGEBOUND', '2026-07-30T09:15:00.000Z', settings, {}),
    /blocked after 14:45 IST/
  );
});

test('desktop and mobile setup selectors expose Rangebound', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
  const dashboardCss = fs.readFileSync(path.join(__dirname, '..', 'dashboard.css'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

  assert.match(dashboard, /setup_rangebound:\s*r\s*=>\s*setupType\(r\) === 'RANGEBOUND'/);
  assert.match(dashboard, /\['rangebound', 'Rangebound'/);
  assert.match(dashboard, /function renderRangeboundTradeInfo\(t\)/);
  assert.match(dashboard, /Range ₹\$\{lower\.toFixed\(2\)\}–₹\$\{upper\.toFixed\(2\)\}/);
  assert.match(dashboard, /\$\{renderRangeboundTradeInfo\(t\)\}/);
  assert.match(dashboardCss, /\.rangebound-trade-info\{/);
  assert.match(mobile, /rangebound:\s*c\s*=>\s*setupOf\(c\) === 'RANGEBOUND'/);
  assert.match(controller, /<option value="rangebound">Rangebound<\/option>/);
});
