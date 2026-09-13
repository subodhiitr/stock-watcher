const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

function candleSeries(startIso, count = 24) {
  const start = Date.parse(startIso);
  return Array.from({ length:count }, (_, index) => {
    const base = 99.4 + index * 0.055;
    return {
      time:new Date(start + index * 5 * 60000).toISOString(),
      open:base - 0.08,
      high:index === count - 4 ? 101.5 : base + 0.12,
      low:base - 0.18,
      close:base,
      volume:1000 + index * 25,
    };
  }).map((candle, index, rows) => index === rows.length - 2
    ? { ...candle, high:100.65, close:100.55 }
    : (index === rows.length - 1 ? { ...candle, high:100.95, low:100.45, close:100.8 } : candle));
}

function controlledRetestCandidate(overrides = {}) {
  return {
    symbol:'SUVEN',
    side:'buy',
    signal:'buy',
    price:100.6,
    score:76,
    decisionScore:76,
    cost:{ ok:true, netPct:1.25 },
    freshness:{ stale:false },
    candles:candleSeries('2026-08-20T03:45:00.000Z'),
    indicators:{
      entryStatus:'Triggered',
      entryTrigger:'Buy above 99.8',
      dayChange:3.2,
      vwap:100,
      ema9:100.5,
      ema20:100.1,
      atr:0.8,
      superTrendDirection:'bullish',
      volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.2, change5m:0.2 },
      stopPct:0.6,
    },
    ...overrides,
  };
}

test('leader indicators retain 30-minute rank memory and compute retest diagnostics', () => {
  const candidate = controlledRetestCandidate();
  const at = '2026-08-20T05:50:00.000Z';
  const history = new Map([['SUVEN', [
    { atMs:Date.parse('2026-08-20T05:25:00.000Z'), rank:2 },
    { atMs:Date.parse('2026-08-20T05:35:00.000Z'), rank:3 },
    { atMs:Date.parse('2026-08-20T05:45:00.000Z'), rank:null },
  ]] ]);
  candidate.topGainerRank = 2;

  SimulationEngine.annotateLeaderIndicators([candidate], at, history, {});

  assert.equal(candidate.indicators.leaderRankPersistencePct30m, 75);
  assert.ok(candidate.indicators.leaderRankStability30m >= 0 && candidate.indicators.leaderRankStability30m <= 1);
  assert.ok(candidate.indicators.recentHighRetestPct >= 0.5 && candidate.indicators.recentHighRetestPct <= 1.2);
  assert.equal(typeof candidate.indicators.emaSpreadSlope3Bars, 'number');
  assert.equal(candidate.indicators.triggerExtensionAtr, 1);
  assert.equal(candidate.indicators.leaderReacceleration, true);
});

test('controlled retest is observable in shadow but disabled for automatic execution', () => {
  const candidate = controlledRetestCandidate();
  Object.assign(candidate.indicators, {
    leaderRankPersistencePct30m:75,
    leaderRankStability30m:0.8,
    leaderRankAgeMin:5,
    recentHighRetestPct:0.9,
    emaSpreadSlope3Bars:0.04,
    triggerExtensionAtr:1,
    leaderReacceleration:true,
  });
  const settings = TradeRules.withDefaults({
    SIMULATION_TOP_GAINER_CONTROLLED_RETEST_ENABLED:false,
    SIMULATION_TOP_GAINER_CONTROLLED_RETEST_SHADOW_ENABLED:true,
  });
  const context = {
    market:{ indices:{ nifty50:{ change:-0.1 } }, breadth:{ advancePct:70 } },
    sectorTrend:{ Pharma:0.5 },
  };
  candidate.sector = 'Pharma';

  const executable = SimulationEngine.getTopGainerControlledRetestInfo(candidate, settings, '2026-08-20T05:50:00.000Z', context);
  const shadow = SimulationEngine.getTopGainerControlledRetestInfo(candidate, settings, '2026-08-20T05:50:00.000Z', context, { ignoreEnabled:true });

  assert.equal(executable.ok, false);
  assert.match(executable.reason, /execution disabled/);
  assert.equal(shadow.ok, true);
  assert.equal(shadow.status, 'hypothesis');
});

test('explicitly enabled controlled retest uses its own extension band through eligibility', () => {
  const candidate = controlledRetestCandidate({ sector:'Pharma' });
  Object.assign(candidate.indicators, {
    leaderRankPersistencePct30m:75,
    leaderRankStability30m:0.8,
    leaderRankAgeMin:5,
    recentHighRetestPct:0.9,
    emaSpreadSlope3Bars:0.04,
    triggerExtensionAtr:1,
    leaderReacceleration:true,
  });
  const settings = TradeRules.withDefaults({ SIMULATION_TOP_GAINER_CONTROLLED_RETEST_ENABLED:true });
  const context = {
    market:{ indices:{ nifty50:{ change:-0.1 } }, breadth:{ advancePct:70 } },
    sectorTrend:{ Pharma:0.5 },
  };

  assert.equal(
    SimulationEngine.getTopGainerControlledRetestInfo(candidate, settings, '2026-08-20T05:50:00.000Z', context).ok,
    true
  );
  assert.equal(
    SimulationEngine.getSetupBlockReason(candidate, 'TOP_GAINER_CONTROLLED_RETEST', '2026-08-20T05:50:00.000Z', settings, context),
    ''
  );
});

test('controlled retest books 75 percent at 0.7 percent and trails the remainder', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_GAIN_MILESTONE_ENABLED:true });
  const candidate = controlledRetestCandidate({
    price:100.75,
    candles:[{ time:'2026-08-20T05:35:00.000Z', open:100.5, high:100.9, low:100.4, close:100.7, volume:1200 }],
  });
  candidate.indicators.leaderRankAgeMin = 5;
  const trade = {
    symbol:'SUVEN', side:'buy', setupType:'TOP_GAINER_CONTROLLED_RETEST', entryPrice:100,
    qty:100, target:102, stop:99, openedAt:'2026-08-20T05:00:00.000Z', _maxFavorablePct:0,
  };
  const partial = SimulationEngine.getSimulationExit(trade, 100.75, candidate, '2026-08-20T05:45:00.000Z', settings);
  assert.equal(partial?.action, 'partial');
  assert.equal(partial?.qtyPct, 75);

  trade._partialTargetBooked = true;
  candidate.price = 100.35;
  const trail = SimulationEngine.getSimulationExit(trade, 100.35, candidate, '2026-08-20T05:45:00.000Z', settings);
  assert.equal(trail?.reason, 'Simulation controlled-retest VWAP/candle-low trail');
});

test('Rangebound signal recovery observer records a completed VWAP reclaim without delaying exit', () => {
  const trade = {
    symbol:'OLAELEC', side:'buy', setupType:'RANGEBOUND', entryPrice:100, stop:98.8,
  };
  const exitCandidate = { indicators:{ vwap:100 }, price:99.7 };
  const observation = SimulationEngine.startRangeboundSignalRecoveryObservation(
    trade, exitCandidate, '2026-08-26T05:00:00.000Z', {}
  );
  assert.equal(observation.status, 'pending');

  const recoveryCandidate = {
    price:100.3,
    indicators:{ vwap:100 },
    candles:[{ time:'2026-08-26T05:05:00.000Z', open:99.7, high:100.4, low:99.4, close:100.2, volume:1200 }],
  };
  const changed = SimulationEngine.updateRangeboundSignalRecoveryObservations(
    [trade], new Map([['OLAELEC', recoveryCandidate]]), '2026-08-26T05:10:00.000Z', {}
  );
  assert.equal(changed, true);
  assert.equal(trade.signalRecoveryObservation.recoveredBeforeStop, true);
  assert.equal(trade.signalRecoveryObservation.outcome, 'completed-candle-vwap-reclaim-before-stop');
});

test('selection telemetry retains rolling ordinary-capacity rejection', () => {
  const candidate = controlledRetestCandidate({ symbol:'OLAELEC', setupType:'MOMENTUM_RUNNER', derivedSetupType:'MOMENTUM_RUNNER' });
  candidate.price = 100.2;
  candidate.indicators.entryTrigger = 'Buy above 100';
  candidate.previousCandidate = { ...candidate, price:100.1, indicators:{ ...candidate.indicators } };
  const selected = SimulationEngine.selectSimulationEntryCandidates(
    [candidate],
    '2026-08-20T05:50:00.000Z',
    {
      SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:false,
      SIMULATION_FRAGMENTED_MARKET_FILTER_ENABLED:false,
      SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000,
      SIMULATION_ROLLING_ORDINARY_ENTRY_MAX:1,
    },
    {
      openSymbols:new Set(),
      dayStats:{ rollingEntries:1, rollingOrdinaryEntries:1, rollingSectorEntries:0 },
      market:{ indices:{ nifty50:{ change:0.1 } }, breadth:{ advancePct:70 } },
      sectorTrend:{},
      topN:10,
    }
  );
  assert.equal(selected.length, 0);
  assert.match(candidate.rejectionReasons.join(' | '), /rolling ordinary capacity exhausted 1\/1/);
  assert.match(candidate.selectionReason, /^Not selected:/);
});
