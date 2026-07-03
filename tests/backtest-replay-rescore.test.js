const test = require('node:test');
const assert = require('node:assert/strict');

const Backtest = require('../backtest_simulation.js');

function buildStretchedGapSnapshot() {
  return [{
    at: '2026-07-03T04:45:00.000Z',
    market: {},
    candidates: [{
      symbol: 'GAPUP',
      name: 'Gap Up Ltd',
      assetType: 'stock',
      sector: 'IT',
      price: 100,
      priceAtSnapshot: 100,
      side: 'buy',
      signal: 'buy',
      score: 46,
      rawScore: 46,
      freshness: { stale: false, ageMin: 0, dataSource: 'snapshot' },
      quote: { price: 100, change: 4.2 },
      cost: { ok: true, netPct: 1.4 },
      derivedSetupType: 'LONG_MOMENTUM',
      indicators: {
        symbol: 'GAPUP',
        price: 100,
        score: 46,
        signal: 'buy',
        entryStatus: 'Triggered',
        entryTrigger: 'Buy above 99.80 with VWAP hold',
        target: 101.4,
        stop: 99.3,
        stopPct: 0.7,
        rr: 2,
        gapPct: 2.0,
        dayChange: 4.2,
        relVolumeTimeAdjusted: 1.2,
        relVolume: 1.2,
        volumeShock: { isShock: false },
        reasons: ['Gap-up holding', 'Adequate volume'],
      },
    }],
  }];
}

function buildReplaySettings(overrides = {}) {
  return {
    PORTFOLIO_INITIAL_CAPITAL: 100000,
    PORTFOLIO_AVAILABLE_CASH: 100000,
    MAX_POSITION_EXPOSURE: 25000,
    SIMULATION_MIN_SCORE: 35,
    SIMULATION_MAX_OPEN: 1,
    SIMULATION_MAX_ACTIVE_OPEN: 1,
    SIMULATION_MAX_NEW_PER_CYCLE: 1,
    SIMULATION_AUTO_SHORTS: false,
    SIMULATION_MARKET_REGIME_NIFTY_PCT: 999,
    SIMULATION_MARKET_REGIME_RS_PCT: 999,
    SIMULATION_MARKET_REGIME_SECTOR_PCT: 999,
    ...overrides,
  };
}

test('runBacktest can recompute snapshot scores to drop stretched bullish gap-ups', () => {
  const baseline = Backtest.runBacktest(
    Backtest.cloneSnapshots(buildStretchedGapSnapshot()),
    buildReplaySettings()
  );
  assert.equal(baseline.summary.trades, 1, 'baseline replay should open the stored snapshot candidate');

  const rescored = Backtest.runBacktest(
    Backtest.cloneSnapshots(buildStretchedGapSnapshot()),
    buildReplaySettings({ REPLAY_RECOMPUTE_SCORES: true })
  );

  assert.equal(rescored.summary.trades, 0, 'rescored replay should block the stretched gap-up candidate');
});
