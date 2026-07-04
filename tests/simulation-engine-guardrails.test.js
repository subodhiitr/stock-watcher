const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');

test('momentum runner exits early when it makes no progress and deteriorates', () => {
  const trade = {
    symbol: 'TCS',
    side: 'buy',
    entryPrice: 100,
    stop: 98,
    target: 103,
    qty: 1,
    setupType: 'MOMENTUM_RUNNER',
    openedAt: '2026-06-25T05:00:00.000Z',
    _maxFavorablePct: 0,
    _bestPrice: 100,
  };
  const candidate = {
    symbol: 'TCS',
    side: 'buy',
    price: 99.8,
    score: 20,
    signal: 'watch',
    indicators: {
      vwap: 100.5,
      ema9: 99.8,
      ema20: 100.2,
      superTrendDirection: 'bearish',
    },
  };

  const exit = SimulationEngine.getSimulationExit(
    trade,
    99.8,
    candidate,
    '2026-06-25T05:13:00.000Z',
    {
      SIMULATION_NO_PROGRESS_EXIT_MIN: 12,
      SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 0.2,
      SIMULATION_NO_PROGRESS_ADVERSE_PCT: 0.15,
    }
  );

  assert.equal(exit?.reason, 'Simulation zero-progress exit');
  assert.equal(exit?.exitPrice, 99.8);
});

test('early momentum runner can enter before generic score reaches 70', () => {
  const candidate = {
    symbol: 'SUVEN',
    side: 'buy',
    signal: 'buy',
    price: 106,
    score: 41,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.4 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 103',
      dayChange: 6,
      relVolumeTimeAdjusted: 1.9,
      vwap: 104,
      rsi: 63,
      ema9: 105.2,
      ema20: 103.8,
      superTrendDirection: 'bullish',
      volumeSpike: true,
      stopPct: 0.7,
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 1.1,
        volumeRatio5m: 1.4,
        recentHigh: 105.8,
      },
      reasons: ['Opening range breakout', 'previous day high'],
    },
  };

  assert.equal(SimulationEngine.deriveSetupType(candidate), 'MOMENTUM_RUNNER');
  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate).mode, 'early');
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-02T04:15:00.000Z'), true);
});

test('late stale momentum runner is blocked despite high cumulative relative volume', () => {
  const candidate = {
    symbol: 'SUVEN',
    side: 'buy',
    signal: 'buy',
    price: 327.4,
    score: 73,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.03 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 320.85 with VWAP hold',
      dayChange: 9.88,
      relVolumeTimeAdjusted: 6.47,
      vwap: 325.45,
      rsi: 58.8,
      ema9: 327.41,
      ema20: 327.22,
      superTrendDirection: 'bearish',
      stopPct: 0.4,
      reasons: ['Opening range breakout', 'Above previous day high'],
      volumeShock: {
        isShock: false,
        breakout: false,
        volumeRatio3m: 0.17,
        volumeRatio5m: 0.27,
        recentHigh: 329.25,
        dayChangePct: 9.88,
      },
    },
  };

  const info = SimulationEngine.getMomentumRunnerInfo(candidate);
  assert.equal(info.ok, false);
  assert.equal(info.reason, 'runner needs bullish SuperTrend');
  candidate.setupType = 'MOMENTUM_RUNNER';
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-03T07:27:00.000Z'), false);
});

test('late momentum runner can pass only with fresh shock or high breakout confirmation', () => {
  const candidate = {
    symbol: 'DIGITIDE',
    side: 'buy',
    signal: 'buy',
    price: 104,
    score: 82,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.2 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 9.4,
      relVolumeTimeAdjusted: 7,
      vwap: 103,
      rsi: 70,
      ema9: 103.8,
      ema20: 102.9,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'Above previous day high'],
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 0.7,
        volumeRatio5m: 1.35,
        recentHigh: 103.8,
        dayChangePct: 9.4,
      },
    },
  };

  assert.equal(SimulationEngine.isLateRunnerAllowed(candidate), true);
  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate).ok, true);
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-03T07:27:00.000Z'), true);
});

test('momentum runner late strict window blocks extended entries after 13:45 IST', () => {
  const candidate = {
    symbol: 'DIGITIDE',
    side: 'buy',
    signal: 'buy',
    price: 104,
    score: 82,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.2 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 6.2,
      relVolumeTimeAdjusted: 7,
      vwap: 103,
      rsi: 70,
      ema9: 103.8,
      ema20: 102.9,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'Above previous day high'],
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 0.9,
        volumeRatio5m: 1.35,
        recentHigh: 103.8,
        dayChangePct: 6.2,
      },
    },
  };

  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate, {}, '2026-07-03T08:00:00.000Z').ok, true);
  const late = SimulationEngine.getMomentumRunnerInfo(candidate, {}, '2026-07-03T08:15:00.000Z');
  assert.equal(late.ok, false);
  assert.match(late.reason, /late momentum runner trigger extension/);
  assert.notEqual(SimulationEngine.deriveSetupType(candidate, {}, '2026-07-03T08:15:00.000Z'), 'MOMENTUM_RUNNER');
});

test('momentum runner entries are blocked after 14:30 IST', () => {
  const candidate = {
    symbol: 'CLEANRUN',
    side: 'buy',
    signal: 'buy',
    price: 102,
    score: 82,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.2 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 5,
      relVolumeTimeAdjusted: 5,
      vwap: 101.4,
      rsi: 66,
      ema9: 101.8,
      ema20: 101.1,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'Above previous day high'],
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 0.9,
        volumeRatio5m: 1.2,
        recentHigh: 101.9,
      },
    },
  };

  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate, {}, '2026-07-03T08:59:00.000Z').ok, true);
  const late = SimulationEngine.getMomentumRunnerInfo(candidate, {}, '2026-07-03T09:01:00.000Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'momentum runner blocked after 14:30 IST');
});

test('late momentum runner sizing is reduced', () => {
  const candidate = makeEligibleCandidate('RUNNER', 90);
  candidate.setupType = 'MOMENTUM_RUNNER';
  candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.indicators.dayChange = 7.5;
  candidate.indicators.relVolumeTimeAdjusted = 4;
  candidate.indicators.volumeShock = {
    isShock: false,
    breakout: false,
    volumeRatio3m: 1,
    volumeRatio5m: 1.2,
    recentHigh: 101.2,
  };
  const full = SimulationEngine.getSuggestedQty(
    { ...candidate, indicators: { ...candidate.indicators, dayChange: 6.5 } },
    'buy',
    100,
    100000,
    100000
  );
  const reduced = SimulationEngine.getSuggestedQty(candidate, 'buy', 100, 100000, 100000);

  assert.equal(reduced.sizeFactor, 0.5);
  assert.ok(reduced.qty <= Math.floor(full.qty * 0.5));
});

test('strong volume-shock breakout can enter at 55 score only with quality filters', () => {
  const base = {
    symbol: 'PERSISTENT',
    side: 'buy',
    signal: 'buy',
    price: 104,
    score: 55,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.3 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 103',
      dayChange: 5,
      relVolumeTimeAdjusted: 3.2,
      vwap: 102.8,
      rsi: 72,
      ema9: 103.5,
      ema20: 102.5,
      superTrendDirection: 'bullish',
      stopPct: 0.7,
      volumeShock: { isShock: true, vwapExtensionPct: 1.17, dayChangePct: 5 },
      reasons: ['Opening range breakout'],
    },
  };

  assert.equal(SimulationEngine.deriveSetupType(base), 'VOLUME_SHOCK_BREAKOUT');
  assert.equal(SimulationEngine.isStrongVolumeBreakoutCandidate(base), true);
  assert.equal(SimulationEngine.isReplayCandidateEligible(base, '2026-07-02T05:00:00.000Z'), true);
  assert.equal(SimulationEngine.isReplayCandidateEligible({ ...base, score: 54 }, '2026-07-02T05:00:00.000Z'), false);
  assert.equal(SimulationEngine.isReplayCandidateEligible({
    ...base,
    indicators: { ...base.indicators, rsi: 78 },
  }, '2026-07-02T05:00:00.000Z'), false);
});

test('fresh breakout VWAP extension relaxes to 1 percent only on high relative volume', () => {
  const previousCandidate = {
    symbol: 'PERSISTENT',
    side: 'buy',
    signal: 'buy',
    price: 100.8,
    indicators: { entryStatus: 'Triggered', vwap: 100 },
  };
  const candidate = {
    symbol: 'PERSISTENT',
    side: 'buy',
    signal: 'buy',
    price: 100.95,
    score: 75,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.2 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 100.5',
      dayChange: 4,
      relVolumeTimeAdjusted: 2.1,
      vwap: 100,
      rsi: 66,
      ema9: 100.8,
      ema20: 100.1,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['previous day high'],
    },
  };

  assert.equal(SimulationEngine.deriveSetupType(candidate), 'FRESH_BREAKOUT');
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-02T05:00:00.000Z', {}, { previousCandidate }), true);
  assert.equal(SimulationEngine.isReplayCandidateEligible({
    ...candidate,
    indicators: { ...candidate.indicators, relVolumeTimeAdjusted: 1.9 },
  }, '2026-07-02T05:00:00.000Z', {}, { previousCandidate }), false);
});

test('quality fresh breakout can pass just below generic score with modest extension', () => {
  const previousCandidate = {
    symbol: 'AEGISLOG',
    side: 'buy',
    signal: 'buy',
    price: 101,
    indicators: { entryStatus: 'Triggered', vwap: 100 },
  };
  const candidate = {
    symbol: 'AEGISLOG',
    side: 'buy',
    signal: 'buy',
    price: 101.95,
    score: 73,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.3 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 3.2,
      relVolumeTimeAdjusted: 2.2,
      vwap: 101,
      rsi: 66,
      ema9: 101.5,
      ema20: 100.8,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'previous day high'],
    },
  };

  assert.equal(SimulationEngine.deriveSetupType(candidate), 'FRESH_BREAKOUT');
  assert.equal(SimulationEngine.isReplayCandidateEligible(
    candidate,
    '2026-07-02T06:00:00.000Z',
    { SIMULATION_MIN_SCORE: 78 },
    { previousCandidate }
  ), true);
});

test('quality fresh breakout relaxation still blocks larger trigger chases', () => {
  const previousCandidate = {
    symbol: 'ANGELONE',
    side: 'buy',
    signal: 'buy',
    price: 101,
    indicators: { entryStatus: 'Triggered', vwap: 100 },
  };
  const candidate = {
    symbol: 'ANGELONE',
    side: 'buy',
    signal: 'buy',
    price: 103.1,
    score: 82,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.3 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 3.2,
      relVolumeTimeAdjusted: 2.2,
      vwap: 102.2,
      rsi: 66,
      ema9: 102.8,
      ema20: 101.8,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'previous day high'],
    },
  };

  const explanation = SimulationEngine.explainCandidateEligibility(
    candidate,
    '2026-07-02T06:00:00.000Z',
    { SIMULATION_MIN_SCORE: 78 },
    { previousCandidate }
  );

  assert.equal(explanation.eligible, false);
  assert.ok(explanation.reasons.some(reason => /chasing/.test(reason)));
});

function makeEligibleCandidate(symbol, score = 85) {
  return {
    symbol,
    side: 'buy',
    signal: 'buy',
    price: 101,
    score,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.3 },
    freshness: { stale: false },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 100.5',
      dayChange: 3.5,
      relVolumeTimeAdjusted: 2,
      vwap: 100,
      rsi: 62,
      ema9: 100.8,
      ema20: 100.1,
      superTrendDirection: 'bullish',
      stopPct: 0.6,
      reasons: ['previous day high'],
    },
    previousCandidate: {
      symbol,
      side: 'buy',
      signal: 'buy',
      price: 100.8,
      indicators: { entryStatus: 'Triggered', vwap: 100 },
    },
  };
}

function makeBadCandidate(symbol) {
  return {
    symbol,
    side: 'buy',
    signal: 'buy',
    price: null,
    score: 100,
    freshness: { stale: true, reason: 'Insufficient intraday data (0 candles, need 1+)' },
    indicators: { entryStatus: 'Triggered', reasons: ['Signal unavailable'] },
  };
}

test('degraded intraday data quality reduces entries before blocking fully', () => {
  const settings = {
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 4,
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 0.25,
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 0.5,
    SIMULATION_DATA_QUALITY_REDUCED_TOP_N: 2,
    SIMULATION_TOP_N: 10,
  };
  const candidates = [
    makeEligibleCandidate('AAA', 100),
    makeEligibleCandidate('BBB', 95),
    makeEligibleCandidate('CCC', 90),
    makeBadCandidate('BAD'),
  ];

  const quality = SimulationEngine.getSnapshotDataQuality(candidates, settings);
  assert.equal(quality.mode, 'reduce');
  const selected = SimulationEngine.selectSimulationEntryCandidates(candidates, '2026-07-02T05:00:00.000Z', settings);
  assert.equal(selected.length, 2);
});

test('severely degraded intraday data quality blocks new entries', () => {
  const settings = {
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 4,
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 0.25,
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 0.5,
  };
  const candidates = [
    makeEligibleCandidate('AAA', 100),
    makeEligibleCandidate('BBB', 95),
    makeBadCandidate('BAD1'),
    makeBadCandidate('BAD2'),
  ];

  const quality = SimulationEngine.getSnapshotDataQuality(candidates, settings);
  assert.equal(quality.mode, 'block');
  assert.equal(SimulationEngine.selectSimulationEntryCandidates(candidates, '2026-07-02T05:00:00.000Z', settings).length, 0);
});

test('VWAP continuation requires stronger relative volume after fade', () => {
  const candidate = makeEligibleCandidate('VWAPTEST', 90);
  candidate.indicators.reasons = [];
  candidate.indicators.relVolumeTimeAdjusted = 1.3;
  candidate.indicators.vwapBandPosition = 'upper-half';
  candidate.indicators.volumeShock = {
    isShock: false,
    breakout: false,
    volumeRatio3m: 0.9,
    volumeRatio5m: 1.2,
    change5m: 0.1,
    recentHigh: 101,
  };
  candidate.setupType = 'VWAP_TREND_CONTINUATION';
  candidate.derivedSetupType = 'VWAP_TREND_CONTINUATION';

  const explain = SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T05:00:00.000Z');
  assert.equal(explain.eligible, false);
  assert.ok(explain.reasons.some(reason => /VWAP continuation volume 1.3x < 1.5x/.test(reason)));
});

test('VWAP continuation blocks weak recent volume impulse at entry', () => {
  const candidate = makeEligibleCandidate('ACC', 100);
  candidate.setupType = 'VWAP_TREND_CONTINUATION';
  candidate.derivedSetupType = 'VWAP_TREND_CONTINUATION';
  candidate.indicators.relVolumeTimeAdjusted = 2.3;
  candidate.indicators.vwapBandPosition = 'upper-half';
  candidate.indicators.volumeShock = {
    isShock: false,
    breakout: false,
    volumeRatio3m: 0.19,
    volumeRatio5m: 0.45,
    change5m: -0.37,
    recentHigh: 102,
  };

  const info = SimulationEngine.getVwapContinuationInfo(candidate);
  assert.equal(info.ok, false);
  assert.equal(info.reason, 'VWAP continuation needs fresh volume impulse');
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-03T05:22:00.000Z'), false);
});

test('VWAP continuation allows negative 5m change only on fresh high breakout', () => {
  const candidate = makeEligibleCandidate('FRESHHIGH', 100);
  candidate.setupType = 'VWAP_TREND_CONTINUATION';
  candidate.derivedSetupType = 'VWAP_TREND_CONTINUATION';
  candidate.price = 101.1;
  candidate.indicators.relVolumeTimeAdjusted = 2.4;
  candidate.indicators.vwap = 100.2;
  candidate.indicators.vwapBandPosition = 'upper-half';
  candidate.indicators.entryTrigger = 'Buy above 100.2';
  candidate.indicators.volumeShock = {
    isShock: false,
    breakout: false,
    volumeRatio3m: 0.9,
    volumeRatio5m: 1.2,
    change5m: -0.2,
    recentHigh: 101.1,
  };

  assert.equal(SimulationEngine.getVwapContinuationInfo(candidate).ok, true);
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-03T05:22:00.000Z'), true);

  const faded = {
    ...candidate,
    price: 101,
    indicators: { ...candidate.indicators, volumeShock: { ...candidate.indicators.volumeShock, recentHigh: 101.1 } },
  };
  const info = SimulationEngine.getVwapContinuationInfo(faded);
  assert.equal(info.ok, false);
  assert.equal(info.reason, 'VWAP continuation 5m change fading without fresh high');
});

test('target runner partial sets a next target when momentum continues', () => {
  const trade = {
    symbol: 'EXIDEIND',
    side: 'buy',
    entryPrice: 100,
    stop: 99,
    target: 101,
    qty: 4,
    setupType: 'FRESH_BREAKOUT',
    openedAt: '2026-07-02T04:00:00.000Z',
  };
  const candidate = {
    symbol: 'EXIDEIND',
    side: 'buy',
    signal: 'buy',
    price: 101,
    score: 75,
    indicators: {
      vwap: 100.4,
      ema9: 101,
      ema20: 100.2,
      superTrendDirection: 'bullish',
      relVolumeTimeAdjusted: 2.1,
    },
  };

  const exit = SimulationEngine.getSimulationExit(
    trade,
    101,
    candidate,
    '2026-07-02T04:08:00.000Z'
  );

  assert.equal(exit?.reason, 'Simulation partial target runner');
  assert.equal(exit?.runner, true);
  assert.equal(exit?.newTarget, 102.21);
});

test('short target runner does not break on bearish continuation', () => {
  const trade = {
    symbol: 'OLECTRA',
    side: 'sell',
    entryPrice: 1488,
    stop: 1499,
    target: 1470,
    qty: 10,
    setupType: 'BREAKDOWN',
    openedAt: '2026-07-03T05:20:23.114Z',
    _partialTargetBooked: true,
    _runnerArmed: true,
    _bestPrice: 1466.5,
  };
  const candidate = {
    symbol: 'OLECTRA',
    side: 'sell',
    price: 1466.5,
    score: -78,
    indicators: {
      vwap: 1478,
      ema9: 1468,
      ema20: 1474,
      superTrendDirection: 'bearish',
    },
  };

  assert.equal(SimulationEngine.isMomentumRunnerBroken(trade, candidate, 1466.5), false);
  assert.equal(SimulationEngine.getMomentumRunnerExit(trade, 1466.5, candidate), null);
});

test('short target runner exits when bearish continuation breaks', () => {
  const trade = {
    symbol: 'OLECTRA',
    side: 'sell',
    entryPrice: 1488,
    stop: 1499,
    target: 1470,
    qty: 10,
    setupType: 'BREAKDOWN',
    openedAt: '2026-07-03T05:20:23.114Z',
    _partialTargetBooked: true,
    _runnerArmed: true,
    _bestPrice: 1466.5,
  };
  const candidate = {
    symbol: 'OLECTRA',
    side: 'sell',
    price: 1478.5,
    score: -20,
    indicators: {
      vwap: 1477,
      ema9: 1478,
      ema20: 1472,
      superTrendDirection: 'bullish',
    },
  };

  assert.equal(SimulationEngine.isMomentumRunnerBroken(trade, candidate, 1478.5), true);
  assert.equal(SimulationEngine.getMomentumRunnerExit(trade, 1478.5, candidate)?.reason, 'Simulation momentum break');
});

test('no-progress exit uses setup-specific timing and VWAP continuation volume fade', () => {
  const baseTrade = {
    symbol: 'TEST',
    side: 'buy',
    entryPrice: 100,
    stop: 98,
    target: 103,
    qty: 1,
    openedAt: '2026-07-02T05:00:00.000Z',
    _maxFavorablePct: 0,
    _bestPrice: 100,
  };
  const weakCandidate = {
    symbol: 'TEST',
    side: 'buy',
    price: 99.8,
    score: 20,
    indicators: {
      vwap: 100.5,
      ema9: 99.8,
      ema20: 100.2,
      superTrendDirection: 'bearish',
      relVolumeTimeAdjusted: 0.9,
    },
  };

  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'MOMENTUM_RUNNER' },
    99.8,
    weakCandidate,
    '2026-07-02T05:08:30.000Z'
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'MOMENTUM_RUNNER' },
    99.8,
    weakCandidate,
    '2026-07-02T05:09:00.000Z'
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'FRESH_BREAKOUT' },
    99.8,
    weakCandidate,
    '2026-07-02T05:10:00.000Z'
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'FRESH_BREAKOUT' },
    99.8,
    weakCandidate,
    '2026-07-02T05:12:00.000Z'
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    { ...weakCandidate, indicators: { ...weakCandidate.indicators, relVolumeTimeAdjusted: 1.6 } },
    '2026-07-02T05:12:00.000Z'
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    { ...weakCandidate, indicators: { ...weakCandidate.indicators, relVolumeTimeAdjusted: 1.3 } },
    '2026-07-02T05:08:00.000Z'
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    weakCandidate,
    '2026-07-02T05:08:00.000Z'
  )?.reason, 'Simulation zero-progress exit');
});

test('short market regime fails closed when Nifty data is missing', () => {
  const regime = SimulationEngine.getMarketRegime(
    { symbol: 'IGL', side: 'sell', indicators: { dayChange: -1.2 } },
    'sell',
    { market: { indices: {} } }
  );

  assert.equal(regime.ok, false);
  assert.match(regime.reason, /Nifty unavailable/);
});

test('strict short market guard blocks mild bullish regime before generic threshold', () => {
  const regime = SimulationEngine.getMarketRegime(
    { symbol: 'BSOFT', side: 'sell', sector: 'IT', indicators: { dayChange: -0.2 } },
    'sell',
    {
      market: {
        indices: { nifty50: { change: 0.12 } },
        breadth: { advancePct: 53 },
      },
      sectorTrend: { IT: 0.06 },
    }
  );

  assert.equal(regime.ok, false);
  assert.match(regime.reason, /Nifty 0.12%/);
  assert.match(regime.reason, /breadth 53% advances/);
  assert.match(regime.reason, /sector 0.1%/);
});
