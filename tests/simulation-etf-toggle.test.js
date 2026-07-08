const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

function baseEtfCandidate(overrides = {}) {
  return {
    symbol: 'NIFTYBEES',
    assetType: 'etf',
    setupType: 'VWAP_PULLBACK_OR_HOLD',
    side: 'buy',
    signal: 'buy',
    score: 90,
    price: 249.5,
    cost: { ok: true, netPct: 2, targetPct: 3, costPct: 0.1 },
    guard: { level: 'ok' },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'above 249',
      vwap: 249,
      vwapBandPosition: 'upper-half',
      superTrendDirection: 'bullish',
      ema9: 251,
      ema20: 249,
      rsi: 60,
      relVolumeTimeAdjusted: 2,
      stopPct: 0.4,
      target: 255,
      stop: 248,
      reasons: ['VWAP hold'],
    },
    freshness: { stale: false },
    ...overrides,
  };
}

test('ETF candidates are excluded by default from simulation', () => {
  const settings = TradeRules.withDefaults({});
  const candidate = baseEtfCandidate();

  assert.equal(settings.SIMULATION_ENABLE_ETF, false);
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, Date.now(), settings), false);
  assert.match(
    SimulationEngine.explainCandidateEligibility(candidate, Date.now(), settings).reasons.join('|'),
    /ETF simulation disabled/
  );
  assert.equal(SimulationEngine.selectSimulationEntryCandidates([candidate], Date.now(), settings, { openPositionCounts: new Map() }).length, 0);
});

test('ETF buy candidates are allowed when SIMULATION_ENABLE_ETF is enabled', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_ENABLE_ETF: true });
  const candidate = baseEtfCandidate({
    previousCandidate: baseEtfCandidate(),
  });

  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, Date.now(), settings), true);
  assert.equal(SimulationEngine.selectSimulationEntryCandidates([candidate], Date.now(), settings, { openPositionCounts: new Map() }).length, 1);
  assert.equal(SimulationEngine.getSimulationEntryIntents([candidate], Date.now(), settings, { openPositionCounts: new Map() })[0].assetType, 'etf');
});

test('ETF short candidates stay disabled even when ETF simulation is enabled', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_ENABLE_ETF: true });
  const candidate = baseEtfCandidate({
    side: 'sell',
    signal: 'sell',
    score: -90,
  });

  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, Date.now(), settings), false);
  assert.match(
    SimulationEngine.explainCandidateEligibility(candidate, Date.now(), settings).reasons.join('|'),
    /ETF short disabled/
  );
});
