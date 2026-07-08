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
    TRADE_RISK_PCT: 1
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
    TRADE_RISK_PCT: 1
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
