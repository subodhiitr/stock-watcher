const test = require('node:test');
const assert = require('node:assert');
const TradeRules = require('../trade_rules');
const SimulationEngine = require('../simulation_engine');

function makeEligibleCandidate(overrides = {}) {
  return {
    symbol: 'TEST',
    side: 'buy',
    signal: 'buy',
    price: 1000,
    score: 90,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.4 },
    freshness: { stale: false },
    candles:[{ time:'2026-07-02T04:50:00.000Z', open:994, high:998, low:993, close:997, volume:1000 }],
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 995',
      dayChange: 3.2,
      relVolumeTimeAdjusted: 2.1,
      vwap: 998,
      rsi: 61,
      ema9: 1002,
      ema20: 996,
      superTrendDirection: 'bullish',
      volumeShock: { volumeRatio3m: 0.75, volumeRatio5m: 0.95 },
      stopPct: 0.6,
      target: 1100,
      stop: 950,
      reasons: ['previous day high']
    },
    previousCandidate: {
      symbol: 'TEST',
      side: 'buy',
      signal: 'buy',
      price: 998,
      indicators: { entryStatus: 'Triggered', vwap: 997 }
    },
    ...overrides
  };
}

test('getSuggestedQty accepts positionMultiplier parameter', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE: 100000,
    PORTFOLIO_INITIAL_CAPITAL: 500000,
    TRADE_RISK_PCT: 1,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false
  });

  const candidate = {
    symbol: 'TEST',
    indicators: {
      entryStatus: 'confirmed'
    }
  };
  const price = 100;
  const availableCash = 200000;
  const maxExposure = 100000;

  // Test with no multiplier (should use default 1.0)
  const suggestedFull = SimulationEngine.getSuggestedQty(
    candidate, 'buy', price, availableCash, maxExposure, settings
  );

  // Test with reduced multiplier (50%)
  const suggestedReduced = SimulationEngine.getSuggestedQty(
    candidate, 'buy', price, availableCash, maxExposure, settings, 0.5
  );

  assert(suggestedFull.qty > 0, 'Should have qty with full multiplier');
  assert(suggestedReduced.qty > 0, 'Should have qty with 0.5 multiplier');
  assert(suggestedReduced.qty <= suggestedFull.qty, 'Reduced multiplier should produce smaller or equal qty');
  
  // Note: Exact qty comparison might vary based on rounding, so we just verify structure
  assert(suggestedFull.plan, 'Should have target/stop plan');
  assert(suggestedReduced.plan, 'Should have target/stop plan with multiplier');
});

test('getSimulationEntryIntents applies context cashAvailable and positionMultiplier to computed qty', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE: 100000,
    PORTFOLIO_INITIAL_CAPITAL: 500000,
    TRADE_RISK_PCT: 1,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false
  });
  const candidate = makeEligibleCandidate();
  const context = {
    cashAvailable: 10000,
    positionMultiplier: 1.0,
    openPositionCounts: new Map(),
    previousCandidateBySymbol: new Map([[candidate.symbol, candidate.previousCandidate]])
  };

  const fullSized = SimulationEngine.getSimulationEntryIntents(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    settings,
    context
  );
  const reducedSized = SimulationEngine.getSimulationEntryIntents(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    settings,
    { ...context, positionMultiplier: 0.5 }
  );

  assert.equal(fullSized.length, 1, 'Expected one eligible entry intent');
  assert.equal(reducedSized.length, 1, 'Expected one eligible entry intent with reduced sizing');
  assert.equal(fullSized[0].qty, 10, 'cashAvailable should cap qty at 10 shares');
  assert.equal(reducedSized[0].qty, 5, 'positionMultiplier should halve the computed qty');
});

test('entry sizing reserves cash sequentially and skips zero-sized entries', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE: 100000,
    PORTFOLIO_INITIAL_CAPITAL: 1000000,
    TRADE_RISK_PCT: 1,
    SIMULATION_MAX_NEW_PER_CYCLE: 3,
    SIMULATION_SECTOR_PRIORITY_ENABLED: false,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false
  });
  const first = makeEligibleCandidate({ symbol: 'FIRST', price: 1000 });
  const second = makeEligibleCandidate({ symbol: 'SECOND', price: 1000 });
  const third = makeEligibleCandidate({ symbol: 'THIRD', price: 1000 });
  const previousCandidateBySymbol = new Map([
    ['FIRST', { ...first.previousCandidate, symbol: 'FIRST' }],
    ['SECOND', { ...second.previousCandidate, symbol: 'SECOND' }],
    ['THIRD', { ...third.previousCandidate, symbol: 'THIRD' }]
  ]);
  const intents = SimulationEngine.getSimulationEntryIntents(
    [first, second, third],
    '2026-07-02T05:00:00.000Z',
    settings,
    { cashAvailable: 150000, positionMultiplier: 1, openPositionCounts: new Map(), previousCandidateBySymbol }
  );
  assert.deepEqual(intents.map(intent => intent.qty), [100, 50]);
  assert.equal(SimulationEngine.getSimulationEntryIntents(
    [first],
    '2026-07-02T05:00:00.000Z',
    settings,
    { cashAvailable: 0, positionMultiplier: 1, openPositionCounts: new Map(), previousCandidateBySymbol }
  ).length, 0, 'zero available cash must not become a one-share order');
});

test('entry sizing never exceeds the remaining gross portfolio exposure', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE:100000,
    PORTFOLIO_INITIAL_CAPITAL:10000,
    TRADE_RISK_PCT:1,
    SIMULATION_MAX_GROSS_EXPOSURE_PCT:80,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:false,
  });
  const candidate = makeEligibleCandidate();
  const context = {
    cashAvailable:10000,
    portfolioEquity:10000,
    openExposure:3000,
    positionMultiplier:1,
    openPositionCounts:new Map(),
    previousCandidateBySymbol:new Map([[candidate.symbol, candidate.previousCandidate]]),
  };
  const intents = SimulationEngine.getSimulationEntryIntents(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    settings,
    context
  );
  assert.equal(intents.length, 1);
  assert.ok(intents[0].qty <= 5, `expected at most 5 shares, received ${intents[0].qty}`);
  assert.equal(
    SimulationEngine.getSimulationEntryIntents([candidate], '2026-07-02T05:00:00.000Z', settings, {
      ...context,
      openExposure:8000,
    }).length,
    0
  );
});

test('top-gainer pullback reclaim entries use half-sized positions', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE:100000,
    PORTFOLIO_INITIAL_CAPITAL:500000,
    TRADE_RISK_PCT:1,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:false,
  });
  const candidate = makeEligibleCandidate({
    symbol:'GAINER-RECLAIM',
    topGainerRank:1,
    candles:[{ time:'2026-07-02T04:50:00.000Z', open:997.8, high:999.5, low:997.5, close:999, volume:1000 }],
    indicators:{
      ...makeEligibleCandidate().indicators,
      dayChange:6,
      vwap:998,
      ema9:1002,
      ema20:996,
      superTrendDirection:'bullish',
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:-0.1 },
    },
  });
  const full = SimulationEngine.getSuggestedQty(candidate, 'buy', candidate.price, 100000, 100000, settings, 1);
  const intents = SimulationEngine.getSimulationEntryIntents(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    settings,
    {
      cashAvailable:100000,
      portfolioEquity:500000,
      openExposure:0,
      openPositionCounts:new Map(),
      previousCandidateBySymbol:new Map(),
    }
  );
  assert.equal(intents.length, 1);
  assert.equal(intents[0].setupType, 'TOP_GAINER_PULLBACK_RECLAIM');
  assert.equal(intents[0].qty, Math.floor(full.qty * 0.5));
  assert.equal(intents[0].entryContext.entryPositionMultiplier, 0.5);
  assert.equal(intents[0].entryContext.negativeMomentumReclaimSizeReduced, true);
});

test('momentum runner entry intent starts at half of its planned full quantity', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE:100000,
    PORTFOLIO_INITIAL_CAPITAL:500000,
    TRADE_RISK_PCT:1,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:false,
    SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000,
    SIMULATION_TOP_GAINER_CONTINUATION_ENABLED:false,
  });
  const candidate = makeEligibleCandidate({
    symbol:'RUNNER-HALF',
    derivedSetupType:'MOMENTUM_RUNNER',
    setupType:'MOMENTUM_RUNNER',
    indicators:{
      ...makeEligibleCandidate().indicators,
      relVolumeTimeAdjusted:4,
      volumeShock:{ isShock:true, breakout:true, volumeRatio3m:1.3, volumeRatio5m:1.4, change5m:0.2, recentHigh:999 },
    },
  });
  const full = SimulationEngine.getSuggestedQty(candidate, 'buy', candidate.price, 100000, 100000, settings, 1);
  const intents = SimulationEngine.getSimulationEntryIntents(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    settings,
    {
      cashAvailable:100000,
      portfolioEquity:500000,
      openExposure:0,
      openPositionCounts:new Map(),
      previousCandidateBySymbol:new Map([[candidate.symbol, candidate.previousCandidate]]),
    }
  );
  assert.equal(intents.length, 1);
  assert.equal(intents[0].setupType, 'MOMENTUM_RUNNER');
  assert.equal(intents[0].qty, Math.floor(full.qty * 0.5));
  assert.equal(intents[0].entryContext.plannedFullQty, full.qty);
});
