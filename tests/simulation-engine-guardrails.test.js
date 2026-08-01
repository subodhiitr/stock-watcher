const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

// This suite isolates the pre-existing setup-specific guardrails. Global long
// entry quality is covered separately in simulation-entry-quality.test.js.
TradeRules.DEFAULT_SETTINGS.SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED = false;

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
    candles: [
      { time:'2026-06-25T05:15:00.000Z', open:100, high:100.1, low:99.7, close:99.8, volume:1000 },
    ],
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
    '2026-06-25T05:25:00.000Z',
    {
      SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN: 25,
      SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 0.2,
      SIMULATION_NO_PROGRESS_ADVERSE_PCT: 0.15,
      SIMULATION_NO_PROGRESS_CONFIRM_BARS: 1,
    }
  );

  assert.equal(exit?.reason, 'Simulation zero-progress exit');
  assert.equal(exit?.exitPrice, 99.8);
});

test('default zero-progress settings release stalled capital within 35 to 45 minutes', () => {
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_EXIT_MIN, 45);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN, 45);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN, 35);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT, 0.15);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_ADVERSE_PCT, 0.1);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_NO_PROGRESS_CONFIRM_BARS, 1);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_EXIT_MIN_HOLD_MIN, 30);
});

test('gain milestones protect a reached half-percent long gain over time', () => {
  const trade = {
    symbol:'TEST',
    side:'buy',
    entryPrice:100,
    stop:99,
    target:103,
    qty:100,
    setupType:'FRESH_BREAKOUT',
    openedAt:'2026-06-25T05:00:00.000Z',
  };
  const candidate = {
    symbol:'TEST',
    side:'buy',
    score:80,
    signal:'buy',
    indicators:{ vwap:100.2, superTrendDirection:'bullish' },
  };
  const settings = {
    SIMULATION_GAIN_MILESTONE_ENABLED:true,
    SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
    SIMULATION_TRAIL_START_PCT:3,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };

  assert.equal(
    SimulationEngine.getSimulationExit(
      trade,
      100.65,
      { ...candidate, price:100.65 },
      '2026-06-25T05:05:00.000Z',
      settings
    ),
    null,
    'crossing 0.5% should arm the floor without exiting immediately'
  );
  assert.equal(trade._gainMilestoneFloorPct, 0.5);
  assert.equal(trade._gainMilestoneArmedAt, '2026-06-25T05:05:00.000Z');
  assert.deepEqual(trade.gainMilestones, [{
    symbol:'TEST',
    milestonePct:0.5,
    reachedAt:'2026-06-25T05:05:00.000Z',
    price:100.65,
    holdMin:5,
  }]);

  const exit = SimulationEngine.getSimulationExit(
    trade,
    100.49,
    { ...candidate, price:100.49 },
    '2026-06-25T05:10:00.000Z',
    settings
  );
  assert.equal(exit?.reason, 'Simulation 0.5% gain milestone');
  assert.equal(exit?.exitPrice, 100.5);
  assert.equal(exit?.holdMin, 10);
});

test('gain milestone ratchets through the configured floors and stops at two percent', () => {
  const settings = {
    SIMULATION_GAIN_MILESTONE_ENABLED:true,
    SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
    SIMULATION_TRAIL_START_PCT:5,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };
  const candidate = { score:80, signal:'buy', indicators:{} };
  const trade = {
    symbol:'TEST',
    side:'buy',
    entryPrice:100,
    stop:99,
    target:110,
    qty:100,
    openedAt:'2026-06-25T05:00:00.000Z',
  };

  assert.equal(SimulationEngine.getSimulationExit(trade, 102.6, candidate, '2026-06-25T05:05:00.000Z', settings), null);
  assert.equal(trade._gainMilestoneFloorPct, 2, 'there must be no automatic 2.5% floor');
  const exit = SimulationEngine.getSimulationExit(trade, 101.99, candidate, '2026-06-25T05:06:00.000Z', settings);
  assert.equal(exit?.gainMilestonePct, 2);
  assert.equal(exit?.exitPrice, 102);
});

test('gain milestones protect short positions symmetrically', () => {
  const settings = {
    SIMULATION_GAIN_MILESTONE_ENABLED:true,
    SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
    SIMULATION_SHORT_PROFIT_LOCK_PCT:5,
    SIMULATION_TRAIL_START_PCT:5,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };
  const trade = {
    symbol:'TEST',
    side:'sell',
    entryPrice:100,
    stop:101,
    target:95,
    qty:100,
    openedAt:'2026-06-25T05:00:00.000Z',
  };

  assert.equal(
    SimulationEngine.getSimulationExit(trade, 98.8, { score:-80, signal:'sell', indicators:{} }, '2026-06-25T05:05:00.000Z', settings),
    null
  );
  assert.equal(trade._gainMilestoneFloorPct, 1);
  const exit = SimulationEngine.getSimulationExit(
    trade,
    99.01,
    { score:-80, signal:'sell', indicators:{} },
    '2026-06-25T05:06:00.000Z',
    settings
  );
  assert.equal(exit?.exitPrice, 99);
});

test('gain milestones remain inactive before the first half-percent gain', () => {
  const trade = {
    symbol:'TEST',
    side:'buy',
    entryPrice:100,
    stop:99,
    target:103,
    qty:100,
    openedAt:'2026-06-25T05:00:00.000Z',
  };
  const exit = SimulationEngine.getSimulationExit(
    trade,
    100.49,
    { score:80, signal:'buy', indicators:{} },
    '2026-06-25T05:05:00.000Z',
    {
      SIMULATION_GAIN_MILESTONE_ENABLED:true,
      SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
      SIMULATION_TRAIL_START_PCT:3,
      SIMULATION_EXIT_MIN_HOLD_MIN:999,
    }
  );
  assert.equal(exit, null);
  assert.equal(trade._gainMilestoneFloorPct, undefined);
});

test('gain milestone rollout does not backfill an impossible historical floor price', () => {
  const trade = {
    symbol:'LEGACY',
    side:'buy',
    entryPrice:100,
    stop:99,
    target:105,
    qty:100,
    openedAt:'2026-06-25T05:00:00.000Z',
    _maxFavorablePct:1.7,
    _bestPrice:101.7,
  };
  const exit = SimulationEngine.getSimulationExit(
    trade,
    100.4,
    { score:80, signal:'buy', indicators:{} },
    '2026-06-25T05:30:00.000Z',
    {
      SIMULATION_GAIN_MILESTONE_ENABLED:true,
      SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
      SIMULATION_TRAIL_START_PCT:3,
      SIMULATION_EXIT_MIN_HOLD_MIN:999,
    }
  );
  assert.equal(exit?.gainMilestonePct, 1.5);
  assert.equal(exit?.exitPrice, 100.4);
});

test('gain milestone histories are captured independently for each stock', () => {
  const settings = {
    SIMULATION_GAIN_MILESTONE_ENABLED:true,
    SIMULATION_GAIN_MILESTONES_PCT:'0.5,1,1.5,2',
    SIMULATION_TRAIL_START_PCT:5,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };
  const makeTrade = symbol => ({
    symbol,
    side:'buy',
    entryPrice:100,
    stop:99,
    target:105,
    qty:100,
    openedAt:'2026-06-25T05:00:00.000Z',
  });
  const alpha = makeTrade('ALPHA');
  const beta = makeTrade('BETA');
  const candidate = { score:80, signal:'buy', indicators:{} };

  assert.equal(SimulationEngine.getSimulationExit(alpha, 101.6, candidate, '2026-06-25T05:10:00.000Z', settings), null);
  assert.equal(SimulationEngine.getSimulationExit(beta, 100.7, candidate, '2026-06-25T05:12:00.000Z', settings), null);

  assert.equal(alpha.gainMilestoneFloorPct, 1.5);
  assert.deepEqual(alpha.gainMilestones.map(item => item.milestonePct), [0.5, 1, 1.5]);
  assert.ok(alpha.gainMilestones.every(item => item.symbol === 'ALPHA'));
  assert.equal(beta.gainMilestoneFloorPct, 0.5);
  assert.deepEqual(beta.gainMilestones.map(item => item.milestonePct), [0.5]);
  assert.ok(beta.gainMilestones.every(item => item.symbol === 'BETA'));

  const alphaExit = SimulationEngine.getSimulationExit(alpha, 101.49, candidate, '2026-06-25T05:15:00.000Z', settings);
  assert.equal(alphaExit?.gainMilestonePct, 1.5);
  assert.equal(beta.gainMilestoneFloorPct, 0.5, 'ALPHA exit must not change BETA milestone state');
});

test('momentum runner initial stop is fixed at 0.80 percent', () => {
  const candidate = {
    setupType: 'MOMENTUM_RUNNER',
    indicators: { target: 1301.94, stop: 1281.21, atr: 6.61 },
  };
  const plan = SimulationEngine.getPaperPlanForCandidate(candidate, 'buy', 1286.5);
  assert.equal(plan.stop, 1276.21);

  const capped = SimulationEngine.getPaperPlanForCandidate(
    { setupType: 'MOMENTUM_RUNNER', indicators: { atr: 30, stop: 1281.21 } },
    'buy',
    1286.5
  );
  assert.equal(capped.stop, 1276.21);
});

test('momentum runner scale-in requires the 0.50 percent milestone and current VWAP/trigger hold', () => {
  const trade = {
    id:'runner-1',
    symbol:'TEST',
    side:'buy',
    setupType:'MOMENTUM_RUNNER',
    qty:50,
    entryPrice:100,
    stop:99.2,
    _momentumRunnerFullQty:100,
  };
  const candidate = {
    symbol:'TEST',
    price:100.5,
    indicators:{ vwap:100.05, entryTrigger:'Buy above 100.10' },
  };
  const intent = SimulationEngine.getMomentumRunnerScaleInIntent(trade, candidate, candidate.price);
  assert.equal(intent?.qty, 50);
  assert.equal(intent?.action, 'scale_in');

  assert.equal(
    SimulationEngine.getMomentumRunnerScaleInIntent(
      { ...trade, _maxFavorablePct:0.49 },
      { ...candidate, price:100.05 },
      100.05
    ),
    null,
    'must not add before the MFE threshold or while below the trigger'
  );
  assert.equal(
    SimulationEngine.getMomentumRunnerScaleInIntent(
      { ...trade, _maxFavorablePct:0.55 },
      { ...candidate, price:100.08 },
      100.08
    ),
    null,
    'historical MFE alone is insufficient when the current price has lost the trigger'
  );
});

test('hard long score floor blocks an early momentum runner below 65', () => {
  const candidate = {
    symbol: 'SUVEN',
    side: 'buy',
    signal: 'buy',
    price: 104,
    score: 41,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.4 },
    candles:[{ time:'2026-07-02T04:05:00.000Z', open:103, high:104.1, low:102.9, close:103.8, volume:1000 }],
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 103',
      dayChange: 1.4,
      relVolumeTimeAdjusted: 1.4,
      vwap: 103.2,
      rsi: 63,
      ema9: 103.6,
      ema20: 103.1,
      superTrendDirection: 'bullish',
      volumeShock: { volumeRatio3m: 1, volumeRatio5m: 1.2, change5m:0.2 },
      volumeSpike: true,
      stopPct: 0.7,
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 1.1,
        volumeRatio5m: 1.4,
        change5m: 0.2,
        recentHigh: 103.9,
      },
      reasons: ['Opening range breakout', 'previous day high'],
    },
  };
  candidate.previousCandidate = SimulationEngine.toConfirmationCandidate(candidate);

  assert.equal(SimulationEngine.deriveSetupType(candidate), 'MOMENTUM_RUNNER');
  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate).mode, 'early');
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-02T04:15:00.000Z'), false);
  assert.match(
    SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T04:15:00.000Z').reasons.join(' | '),
    /hard decision score/
  );
});

test('early momentum runner rejects an otherwise strong opportunity after it is already extended', () => {
  const candidate = {
    symbol: 'LATE',
    side: 'buy',
    signal: 'buy',
    price: 105,
    score: 45,
    guard: { level: 'ok' },
    cost: { ok: true, netPct: 1.2 },
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 103',
      dayChange: 2.5,
      relVolumeTimeAdjusted: 1.5,
      vwap: 103.5,
      rsi: 64,
      ema9: 104,
      ema20: 103.4,
      superTrendDirection: 'bullish',
      volumeShock: { volumeRatio3m: 1, volumeRatio5m: 1.2 },
      stopPct: 0.7,
      volumeShock: { breakout: true, volumeRatio3m: 1.1, volumeRatio5m: 1.3, recentHigh: 104.9 },
      reasons: ['Opening range breakout', 'Above previous day high'],
    },
  };

  assert.equal(SimulationEngine.getMomentumRunnerInfo(candidate).ok, false);
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-02T04:15:00.000Z'), false);
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
    candles:[{ time:'2026-07-03T07:15:00.000Z', open:103.4, high:104.2, low:103.2, close:104, volume:1000 }],
    indicators: {
      entryStatus: 'Triggered',
      entryTrigger: 'Buy above 101',
      dayChange: 5.4,
      relVolumeTimeAdjusted: 7,
      vwap: 103,
      rsi: 70,
      ema9: 103.8,
      ema20: 102.9,
      superTrendDirection: 'bullish',
      volumeShock: { volumeRatio3m: 1, volumeRatio5m: 1.2 },
      stopPct: 0.6,
      reasons: ['Opening range breakout', 'Above previous day high'],
      volumeShock: {
        isShock: false,
        breakout: true,
        volumeRatio3m: 0.7,
        volumeRatio5m: 1.35,
        change5m: 0.2,
        recentHigh: 103.8,
        dayChangePct: 5.4,
      },
    },
  };
  candidate.previousCandidate = SimulationEngine.toConfirmationCandidate(candidate);

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

test('strong volume-shock breakout cannot bypass the 65 hard score floor', () => {
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
  assert.equal(SimulationEngine.isReplayCandidateEligible(base, '2026-07-02T05:00:00.000Z'), false);
  assert.equal(SimulationEngine.isReplayCandidateEligible({ ...base, score:65 }, '2026-07-02T05:00:00.000Z'), true);
  assert.equal(SimulationEngine.isReplayCandidateEligible({ ...base, score: 54 }, '2026-07-02T05:00:00.000Z'), false);
  assert.equal(SimulationEngine.isReplayCandidateEligible({
    ...base,
    indicators: { ...base.indicators, rsi: 78 },
  }, '2026-07-02T05:00:00.000Z'), false);
});

test('volume shock is blocked when trend confirmation is not aligned', () => {
  const candidate = makeEligibleCandidate('SHOCK', 90);
  candidate.indicators.volumeShock = { isShock: true, dayChangePct: 4, vwapExtensionPct: 0.8 };
  candidate.indicators.dayChange = 4;
  candidate.indicators.relVolumeTimeAdjusted = 3.5;
  candidate.indicators.superTrendDirection = 'bearish';
  candidate.indicators.reasons = ['Opening range breakout'];

  assert.equal(SimulationEngine.deriveSetupType(candidate), 'VOLUME_SHOCK_BREAKOUT');
  assert.match(
    SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T05:00:00.000Z').reasons.join(' | '),
    /volume shock needs aligned/
  );
});

test('openSymbols blocks an overlapping position when count map is omitted', () => {
  const candidate = makeEligibleCandidate('DUPLICATE', 90);
  const selected = SimulationEngine.selectSimulationEntryCandidates(
    [candidate],
    '2026-07-02T05:00:00.000Z',
    {},
    { openSymbols: new Set(['DUPLICATE']) }
  );
  assert.equal(selected.length, 0);
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
    candles:[{ time:'2026-07-02T04:50:00.000Z', open:100.3, high:100.9, low:100.2, close:100.8, volume:1000 }],
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
      volumeShock: { volumeRatio3m: 0.75, volumeRatio5m: 0.95 },
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
    candles:[{ time:'2026-07-02T05:50:00.000Z', open:100.8, high:101.7, low:100.7, close:101.5, volume:1000 }],
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
      volumeShock: { volumeRatio3m: 0.75, volumeRatio5m: 0.95 },
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
    candles:[{ time:'2026-07-02T05:50:00.000Z', open:100.8, high:101.7, low:100.7, close:101.5, volume:1000 }],
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
      volumeShock: { volumeRatio3m: 1, volumeRatio5m: 1.2, change5m:0.2 },
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

test('fresh breakout requires recent volume impulse and aligned index breadth', () => {
  const candidate = makeEligibleCandidate('FRESH-CONTEXT', 75);
  candidate.setupType = 'FRESH_BREAKOUT';
  candidate.derivedSetupType = 'FRESH_BREAKOUT';
  candidate.indicators.volumeShock = { volumeRatio3m: 0.4, volumeRatio5m: 0.6 };
  let explanation = SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T05:00:00.000Z', {}, {
    previousCandidate: candidate.previousCandidate,
    market: { indices: { nifty50: { change: 0.2 } }, breadth: { advancePct: 60 } },
  });
  assert.ok(explanation.reasons.some(reason => /volume impulse/.test(reason)));

  candidate.indicators.volumeShock = { volumeRatio3m: 0.75, volumeRatio5m: 0.95 };
  explanation = SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T05:00:00.000Z', {}, {
    previousCandidate: candidate.previousCandidate,
    market: { indices: { nifty50: { change: -0.3 } }, breadth: { advancePct: 45 } },
  });
  assert.ok(explanation.reasons.some(reason => /fresh breakout Nifty/.test(reason)));
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
    candles:[
      { time:'2026-07-02T04:50:00.000Z', open:100.1, high:100.8, low:100, close:100.7, volume:900 },
      { time:'2026-07-02T04:55:00.000Z', open:100.7, high:101.1, low:100.6, close:100.9, volume:1000 },
    ],
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
      volumeShock: { volumeRatio3m: 1, volumeRatio5m: 1.2, change5m:0.2 },
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

test('candidate ranking selects momentum runner ahead of higher-score fresh breakout', () => {
  const runner = makeEligibleCandidate('RUNNER-RANK', 70);
  runner.setupType = 'MOMENTUM_RUNNER';
  runner.derivedSetupType = 'MOMENTUM_RUNNER';
  const fresh = makeEligibleCandidate('FRESH-RANK', 95);
  fresh.setupType = 'FRESH_BREAKOUT';
  fresh.derivedSetupType = 'FRESH_BREAKOUT';
  const selected = SimulationEngine.selectSimulationEntryCandidates(
    [fresh, runner],
    '2026-07-02T05:00:00.000Z',
    {},
    {
      topN: 1,
      openSymbols: new Set(),
      market: { indices: { nifty50: { change: 0.3 } }, breadth: { advancePct: 60 } },
    }
  );
  assert.equal(selected[0]?.symbol, 'RUNNER-RANK');
});

test('momentum runner entries are capped at 0.50 percent above VWAP', () => {
  const candidate = makeEligibleCandidate('RUNNER-VWAP', 95);
  candidate.setupType = candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.price = 100.7;
  candidate.candles = [{ time:'2026-07-02T04:50:00.000Z', open:100.1, high:100.8, low:100, close:100.6, volume:1000 }];
  candidate.indicators = {
    ...candidate.indicators,
    entryTrigger:'Buy above 100.2',
    vwap:100.1,
    volumeShock:{ isShock:true, volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:0.2 },
  };
  assert.match(
    SimulationEngine.getSetupBlockReason(candidate, 'MOMENTUM_RUNNER', '2026-07-02T05:00:00.000Z', {
      SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:true,
      SIMULATION_MOMENTUM_RUNNER_MAX_VWAP_EXTENSION_PCT:0.5,
    }, {}),
    /long VWAP extension .* exceeds 0.5%/
  );
});

test('degraded intraday data quality reduces entries before blocking fully', () => {
  const settings = {
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 4,
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 0.25,
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 0.5,
    SIMULATION_DATA_QUALITY_REDUCED_TOP_N: 2,
    SIMULATION_TOP_N: 10,
    SIMULATION_SECTOR_PRIORITY_ENABLED: false,
  };
  const candidates = [
    makeEligibleCandidate('AAA', 100),
    makeEligibleCandidate('BBB', 95),
    makeEligibleCandidate('CCC', 90),
    makeBadCandidate('BAD'),
  ];

  const quality = SimulationEngine.getSnapshotDataQuality(candidates, settings);
  assert.equal(quality.mode, 'reduce');
  const selected = SimulationEngine.selectSimulationEntryCandidates(candidates, '2026-07-02T05:00:00.000Z', settings, {
    market: { indices: { nifty50: { change: 0.2 } } },
  });
  assert.equal(selected.length, 1);
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

test('global long momentum gate blocks negative 5m VWAP continuation even at a fresh high', () => {
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
  candidate.candles = [{ time:'2026-07-03T05:10:00.000Z', open:100.4, high:101.2, low:100.3, close:101.1, volume:1000 }];
  candidate.previousCandidate = SimulationEngine.toConfirmationCandidate(candidate);

  assert.equal(SimulationEngine.getVwapContinuationInfo(candidate).ok, true);
  assert.equal(SimulationEngine.isReplayCandidateEligible(candidate, '2026-07-03T05:22:00.000Z'), false);

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
  assert.equal(SimulationEngine.getMomentumRunnerExit(trade, 1478.5, candidate), null);
});

test('post-partial runner ignores first momentum break and exits only at its trail', () => {
  const trade = {
    symbol: 'LODHA', side: 'buy', entryPrice: 100, target: 102, qty: 5,
    setupType: 'VWAP_TREND_CONTINUATION', _partialTargetBooked: true,
    _runnerArmed: true, _bestPrice: 110,
  };
  const broken = {
    symbol: 'LODHA', side: 'buy', price: 109.5, score: 20,
    indicators: { vwap: 110, ema9: 109, ema20: 110, superTrendDirection: 'bearish' },
  };
  assert.equal(SimulationEngine.getMomentumRunnerExit(trade, 109.5, broken), null);
  assert.equal(SimulationEngine.getMomentumRunnerExit(trade, 108.9, { ...broken, price: 108.9 })?.reason, 'Simulation runner trail');
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
    candles: [
      { time:'2026-07-02T05:20:00.000Z', open:100, high:100.1, low:99.7, close:99.8, volume:1000 },
    ],
    indicators: {
      vwap: 100.5,
      ema9: 99.8,
      ema20: 100.2,
      superTrendDirection: 'bearish',
      relVolumeTimeAdjusted: 0.9,
    },
  };
  const legacyConfirmationSettings = {
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN:60,
    SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN:30,
    SIMULATION_NO_PROGRESS_ADVERSE_PCT:0.15,
    SIMULATION_NO_PROGRESS_CONFIRM_BARS:1,
  };

  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'MOMENTUM_RUNNER' },
    99.8,
    weakCandidate,
    '2026-07-02T05:59:30.000Z',
    legacyConfirmationSettings
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'MOMENTUM_RUNNER' },
    99.8,
    weakCandidate,
    '2026-07-02T06:00:00.000Z',
    legacyConfirmationSettings
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'FRESH_BREAKOUT' },
    99.8,
    weakCandidate,
    '2026-07-02T05:29:59.000Z',
    legacyConfirmationSettings
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'FRESH_BREAKOUT' },
    99.8,
    weakCandidate,
    '2026-07-02T05:30:00.000Z',
    legacyConfirmationSettings
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    { ...weakCandidate, indicators: { ...weakCandidate.indicators, relVolumeTimeAdjusted: 1.6 } },
    '2026-07-02T05:30:00.000Z',
    legacyConfirmationSettings
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    { ...weakCandidate, indicators: { ...weakCandidate.indicators, relVolumeTimeAdjusted: 1.3 } },
    '2026-07-02T05:29:59.000Z',
    legacyConfirmationSettings
  ), null);
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    { ...weakCandidate, indicators: { ...weakCandidate.indicators, relVolumeTimeAdjusted: 1.3 } },
    '2026-07-02T05:30:00.000Z',
    legacyConfirmationSettings
  )?.reason, 'Simulation zero-progress exit');
  assert.equal(SimulationEngine.getSimulationExit(
    { ...baseTrade, setupType: 'VWAP_TREND_CONTINUATION' },
    99.8,
    weakCandidate,
    '2026-07-02T05:30:00.000Z',
    legacyConfirmationSettings
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

test('strong sector-relative momentum runner may override only a mild negative Nifty conflict', () => {
  const candidate = {
    symbol: 'HCLTECH',
    side: 'buy',
    sector: 'IT',
    score: 92,
    setupType: 'MOMENTUM_RUNNER',
    blockReason: 'market regime conflict: Nifty -0.42%',
    indicators: { dayChange: 1.1, entryStatus: 'Triggered' },
  };
  const regime = SimulationEngine.getMarketRegime(candidate, 'buy', {
    market: { indices: { nifty50: { change: -0.42 } } },
    sectorTrend: { IT: 0.72 },
  });

  assert.equal(regime.ok, true);
  assert.equal(regime.sectorRsOverride, true);
  assert.match(regime.reason, /sector RS override/);
});

test('sector-relative override remains bounded by setup, score, sector, RS, and Nifty decline', () => {
  const base = {
    symbol: 'TEST', side: 'buy', sector: 'IT', score: 92, setupType: 'MOMENTUM_RUNNER',
    indicators: { dayChange: 1.1, entryStatus: 'Triggered' },
  };
  const context = nifty => ({ market: { indices: { nifty50: { change: nifty } } }, sectorTrend: { IT: 0.72 } });

  assert.equal(SimulationEngine.getMarketRegime({ ...base, score: 84 }, 'buy', context(-0.42)).ok, false);
  assert.equal(SimulationEngine.getMarketRegime({ ...base, setupType: 'FRESH_BREAKOUT' }, 'buy', context(-0.42)).ok, false);
  assert.equal(SimulationEngine.getMarketRegime({ ...base, indicators: { ...base.indicators, dayChange: -0.1 } }, 'buy', context(-0.42)).ok, false);
  assert.equal(SimulationEngine.getMarketRegime(base, 'buy', { ...context(-0.42), sectorTrend: { IT: 0.49 } }).ok, false);
  assert.equal(SimulationEngine.getMarketRegime(base, 'buy', context(-0.8)).ok, false);
});

test('candidate selection forwards sector trend into the shared market-regime rule', () => {
  const candidate = makeEligibleCandidate('HCLTECH', 92);
  candidate.sector = 'IT';
  candidate.setupType = 'MOMENTUM_RUNNER';
  candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.indicators.dayChange = 1.1;
  const selected = SimulationEngine.selectSimulationEntryCandidates([candidate], '2026-07-13T06:00:00.000Z', { SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000 }, {
    openSymbols: new Set(),
    market: { indices: { nifty50: { change: -0.42 } } },
    sectorTrend: { IT: 0.72 },
  });

  assert.equal(selected.length, 1);
});

test('candidate selection reserves only the remaining rolling entry capacity in one cycle', () => {
  const candidates = ['ONE', 'TWO', 'THREE'].map((symbol, index) => makeEligibleCandidate(symbol, 95 - index));
  const selected = SimulationEngine.selectSimulationEntryCandidates(candidates, '2026-07-13T05:25:00.000Z', { SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000 }, {
    openSymbols: new Set(),
    dayStats: { rollingEntries: 1 },
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].symbol, 'ONE');
});

test('candidate selection enforces concurrent short and total open-position caps', () => {
  const candidate = makeEligibleCandidate('NEW-SHORT', 90);
  candidate.side = candidate.signal = 'sell';
  candidate.score = candidate.decisionScore = -90;
  candidate.setupType = candidate.derivedSetupType = 'BREAKDOWN';
  candidate.price = 99.65;
  candidate.candles = [{ time:'2026-07-13T05:15:00.000Z', open:100.15, high:100.2, low:99.55, close:99.75, volume:1000 }];
  candidate.indicators = {
    ...candidate.indicators,
    entryTrigger:'Sell below 100', vwap:99.9, dayChange:-1,
    rsi:38, ema9:99.7, ema20:100.05, superTrendDirection:'bearish',
    volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.2 },
  };
  const settings = {
    SIMULATION_MAX_CONCURRENT_SHORTS:4,
    SIMULATION_MAX_OPEN:10,
    SIMULATION_MAX_ACTIVE_OPEN:8,
  };
  const baseContext = {
    openSymbols:new Set(),
    openPositionCounts:new Map([['EXISTING', 4]]),
    openSideCounts:{ buy:0, sell:4 },
  };
  assert.equal(
    SimulationEngine.selectSimulationEntryCandidates([candidate], '2026-07-13T05:25:30.000Z', settings, baseContext).length,
    0
  );
  assert.equal(
    SimulationEngine.selectSimulationEntryCandidates([candidate], '2026-07-13T05:25:30.000Z', settings, {
      ...baseContext,
      openPositionCounts:new Map([['EXISTING', 10]]),
      openSideCounts:{ buy:6, sell:3 },
    }).length,
    0
  );
});

test('sector alignment adds a bounded boost without outranking a materially better candidate', () => {
  const aligned = makeEligibleCandidate('HCLTECH', 85);
  aligned.sector = 'IT';
  aligned.setupType = aligned.derivedSetupType = 'MOMENTUM_RUNNER';
  aligned.indicators.dayChange = 1.5;
  const ordinary = makeEligibleCandidate('ORDINARY', 100);
  ordinary.sector = 'Finance';
  ordinary.setupType = ordinary.derivedSetupType = 'MOMENTUM_RUNNER';
  ordinary.indicators.dayChange = 1.5;
  const sectorBreadth = [
    { symbol:'IT-A', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.8 } },
    { symbol:'IT-B', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.7 } },
  ];
  const selected = SimulationEngine.selectSimulationEntryCandidates([ordinary, aligned, ...sectorBreadth], '2026-07-13T06:00:00.000Z', { SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000 }, {
    openSymbols:new Set(),
    dayStats:{ rollingEntries:0, rollingOrdinaryEntries:0, rollingSectorEntries:0 },
    market:{ indices:{ nifty50:{ change:-0.1 } } },
    sectorTrend:{ IT:1.0, Finance:0.1 },
  });

  assert.deepEqual(selected.map(candidate => candidate.symbol), ['ORDINARY']);
  assert.equal(aligned.sectorPriority.aligned, true);
  assert.ok(aligned.sectorPriority.boost > 0);
});

test('strong sector alignment never bypasses trigger distance or entry quality guards', () => {
  const sectorFillers = [
    { symbol:'IT-GUARD-A', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.8 } },
    { symbol:'IT-GUARD-B', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.7 } },
  ];
  const context = {
    openSymbols:new Set(),
    dayStats:{ rollingEntries:0, rollingOrdinaryEntries:0, rollingSectorEntries:0 },
    market:{ indices:{ nifty50:{ change:0.1 } } },
    sectorTrend:{ IT:1.0 },
  };
  const select = candidate => SimulationEngine.selectSimulationEntryCandidates(
    [candidate, ...sectorFillers],
    '2026-07-13T06:00:00.000Z',
    {},
    context
  );

  const chasing = makeEligibleCandidate('IT-TOO-FAR', 90);
  chasing.sector = 'IT';
  chasing.setupType = chasing.derivedSetupType = 'FRESH_BREAKOUT';
  chasing.price = 106;
  chasing.indicators.vwap = 105.5;
  assert.equal(select(chasing).length, 0);
  assert.equal(chasing.sectorPriority.aligned, true);
  assert.match(
    SimulationEngine.explainCandidateEligibility(chasing, '2026-07-13T06:00:00.000Z', {}, {
      previousCandidate:chasing.previousCandidate,
      market:{ indices:{ nifty50:{ change:0.1 } }, breadth:{ advancePct:100 } },
      sectorTrend:{ IT:1.0 },
    }).reasons.join(' | '),
    /chasing .*% from trigger/
  );

  const stale = makeEligibleCandidate('IT-STALE', 90);
  stale.sector = 'IT';
  stale.freshness = { stale:true, reason:'old candle 6m' };
  assert.equal(select(stale).length, 0);
  assert.equal(stale.sectorPriority.aligned, false);

  const uneconomic = makeEligibleCandidate('IT-COSTLY', 90);
  uneconomic.sector = 'IT';
  uneconomic.cost = { ok:false, netPct:0.2 };
  assert.equal(select(uneconomic).length, 0);
  assert.equal(uneconomic.sectorPriority.aligned, true);

  const wideStop = makeEligibleCandidate('IT-WIDE-STOP', 90);
  wideStop.sector = 'IT';
  wideStop.indicators.stopPct = 1.2;
  assert.equal(select(wideStop).length, 0);
  assert.equal(wideStop.sectorPriority.aligned, true);
});

test('an ordinary rolling entry preserves the remaining slot for a sector-aligned candidate', () => {
  const aligned = makeEligibleCandidate('TECHM', 90);
  aligned.sector = 'IT';
  aligned.setupType = aligned.derivedSetupType = 'MOMENTUM_RUNNER';
  aligned.indicators.dayChange = 1.5;
  const ordinary = makeEligibleCandidate('ORDINARY-2', 100);
  ordinary.sector = 'Finance';
  ordinary.setupType = ordinary.derivedSetupType = 'MOMENTUM_RUNNER';
  const fillers = [
    { symbol:'IT-C', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.8 } },
    { symbol:'IT-D', sector:'IT', side:'watch', score:0, indicators:{ dayChange:0.7 } },
  ];
  const selected = SimulationEngine.selectSimulationEntryCandidates([ordinary, aligned, ...fillers], '2026-07-13T06:00:00.000Z', { SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:20000 }, {
    openSymbols:new Set(),
    dayStats:{ rollingEntries:1, rollingOrdinaryEntries:1, rollingSectorEntries:0 },
    market:{ indices:{ nifty50:{ change:-0.1 } } },
    sectorTrend:{ IT:1.0, Finance:0.1 },
  });

  assert.deepEqual(selected.map(candidate => candidate.symbol), ['TECHM']);
});

test('breakeven protection waits for distinct completed VWAP-loss candles', () => {
  const openedAt = '2026-07-10T04:45:00.000Z';
  const trade = {
    symbol: 'TEST', side: 'buy', qty: 100, entryPrice: 100,
    target: 102, stop: 99, openedAt, setupType: 'MOMENTUM_RUNNER',
    _partialTargetBooked:true,
  };
  const candidate = { symbol: 'TEST', price: 100.7, indicators: { vwap:100.2 } };
  const settings = {
    SIMULATION_GAIN_MILESTONE_ENABLED:false,
    SIMULATION_BREAKEVEN_PROTECT_PCT: 0.65,
    SIMULATION_LONG_PROFIT_LOCK_PCT: 0.65,
    SIMULATION_BREAKEVEN_MIN_HOLD_MIN: 5,
    SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN: 5,
    SIMULATION_BREAKEVEN_COST_BUFFER_PCT: 0.02,
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 2,
    SIMULATION_TRAIL_START_PCT: 2,
  };

  assert.equal(SimulationEngine.getSimulationExit(trade, 100.7, candidate, '2026-07-10T04:46:00.000Z', settings), null);
  const firstBreach = {
    ...candidate,
    price:100.1,
    candles:[{ time:'2026-07-10T04:50:00.000Z', open:100.25, high:100.3, low:100.05, close:100.1, volume:1000 }],
  };
  assert.equal(SimulationEngine.getSimulationExit(trade, 100.1, firstBreach, '2026-07-10T04:56:00.000Z', settings), null);
  assert.equal(SimulationEngine.getSimulationExit(trade, 100.1, firstBreach, '2026-07-10T04:57:00.000Z', settings), null);
  assert.equal(trade._breakevenBreachCount, 1, 'refreshing one completed candle must not confirm the exit');
  const secondBreach = {
    ...candidate,
    price:100.05,
    candles:[{ time:'2026-07-10T04:55:00.000Z', open:100.15, high:100.2, low:100, close:100.05, volume:1000 }],
  };
  const exit = SimulationEngine.getSimulationExit(trade, 100.05, secondBreach, '2026-07-10T05:01:00.000Z', settings);
  assert.equal(exit.reason, 'Simulation breakeven guard');
  assert.equal(exit.exitPrice, 100.05);
  assert.equal(exit.confirmedBars, 2);
  assert.notEqual(exit.exitPrice, trade.entryPrice);
});

test('short profit lock books half at 0.25 percent and protects the remainder', () => {
  const trade = {
    symbol:'SHORT-LOCK', side:'sell', qty:100, entryPrice:100,
    target:98, stop:101, openedAt:'2026-07-10T04:45:00.000Z', setupType:'BREAKDOWN',
  };
  const candidate = {
    symbol:'SHORT-LOCK', side:'sell', price:99.75, score:-80,
    indicators:{ vwap:100.2, ema9:99.8, ema20:100.1, superTrendDirection:'bearish' },
  };
  const settings = TradeRules.withDefaults({
    SIMULATION_SHORT_PROFIT_LOCK_PCT:0.25,
    SIMULATION_SHORT_PROFIT_LOCK_PARTIAL_QTY_PCT:50,
    SIMULATION_BREAKEVEN_MIN_HOLD_MIN:0,
    SIMULATION_EXIT_FADE_CONFIRM_BARS:1,
  });
  const partial = SimulationEngine.getSimulationExit(trade, 99.75, candidate, '2026-07-10T04:46:00.000Z', settings);
  assert.equal(partial.reason, 'Simulation short profit lock');
  assert.equal(partial.action, 'partial');
  assert.equal(partial.qtyPct, 50);
  assert.equal(partial.newTarget, 98);
  assert.equal(partial.protectRemainder, true);

  trade._partialTargetBooked = true;
  assert.equal(SimulationEngine.getSimulationExit(
    trade,
    100,
    { ...candidate, price:100 },
    '2026-07-10T04:47:00.000Z',
    settings
  ), null, 'the first retracement to cost must not exit without a completed VWAP-loss candle');
  const protectedExit = SimulationEngine.getSimulationExit(
    trade,
    100,
    {
      ...candidate,
      price:100,
      indicators:{ ...candidate.indicators, vwap:99.8 },
      candles:[{ time:'2026-07-10T04:45:00.000Z', open:99.9, high:100.1, low:99.85, close:100, volume:1000 }],
    },
    '2026-07-10T04:51:00.000Z',
    settings
  );
  assert.equal(protectedExit.reason, 'Simulation breakeven guard');
  assert.equal(protectedExit.confirmedBars, 1);
});

test('momentum runner requires non-negative 5m momentum even after a VWAP reclaim', () => {
  const candidate = makeEligibleCandidate('RECLAIM-RUNNER', 90);
  candidate.setupType = candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.sectorPriority = { aligned:true, sectorAvg:1, breadthPct:75, rs:1.2 };
  candidate.indicators.volumeShock = {
    ...candidate.indicators.volumeShock,
    change5m:-0.2,
  };
  let reason = SimulationEngine.getSetupBlockReason(
    candidate,
    'MOMENTUM_RUNNER',
    '2026-07-02T05:00:00.000Z',
    {},
    {}
  );
  assert.match(reason, /long 5m momentum -0.2% is negative/);

  candidate.candles = [
    { time:'2026-07-02T04:45:00.000Z', open:100.2, high:100.3, low:99.8, close:100.1, volume:900 },
    { time:'2026-07-02T04:50:00.000Z', open:100.05, high:100.8, low:100, close:100.7, volume:1200 },
  ];
  reason = SimulationEngine.getSetupBlockReason(
    candidate,
    'MOMENTUM_RUNNER',
    '2026-07-02T05:00:00.000Z',
    { SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION:false },
    {}
  );
  assert.match(reason, /long 5m momentum -0.2% is negative/);
});

test('momentum runner requires sector alignment or strong stock-relative strength', () => {
  const candidate = makeEligibleCandidate('RS-RUNNER', 90);
  candidate.setupType = candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.sectorPriority = { aligned:false, sectorAvg:0.1, breadthPct:45, rs:0.4 };
  let reason = SimulationEngine.getSetupBlockReason(candidate, 'MOMENTUM_RUNNER', '2026-07-02T05:00:00.000Z', {}, {
    market:{ indices:{ nifty50:{ change:0.1 } } },
  });
  assert.match(reason, /sector alignment or RS/);
  candidate.sectorPriority.rs = 0.9;
  reason = SimulationEngine.getSetupBlockReason(candidate, 'MOMENTUM_RUNNER', '2026-07-02T05:00:00.000Z', {}, {
    market:{ indices:{ nifty50:{ change:0.1 } } },
  });
  assert.doesNotMatch(reason, /sector alignment or RS/);
});

test('fragmented market permits only dominant-sector long leaders', () => {
  const candidate = makeEligibleCandidate('FRAGMENTED', 90);
  candidate.setupType = candidate.derivedSetupType = 'VWAP_PULLBACK_OR_HOLD';
  candidate.sectorPriority = { aligned:false, sectorAvg:0.1, breadthPct:45, rs:0.4 };
  const context = {
    market:{ indices:{
      nifty50:{ change:0.05 },
      banknifty:{ change:-0.4 },
      smallcap:{ change:-0.3 },
    } },
  };
  let reason = SimulationEngine.getSetupBlockReason(candidate, candidate.setupType, '2026-07-02T05:00:00.000Z', {}, context);
  assert.match(reason, /fragmented market/);
  candidate.sectorPriority = { aligned:true, sectorAvg:1.1, sectorRank:1, sectorCount:8, breadthPct:75, rs:1.3 };
  reason = SimulationEngine.getSetupBlockReason(candidate, candidate.setupType, '2026-07-02T05:00:00.000Z', {}, context);
  assert.doesNotMatch(reason, /fragmented market/);
});

test('entry expected gross move must cover at least 2.5 times modeled costs', () => {
  const candidate = makeEligibleCandidate('COST-MULTIPLE', 90);
  candidate.setupType = candidate.derivedSetupType = 'VWAP_PULLBACK_OR_HOLD';
  candidate.cost = { ok:true, netPct:1.2, targetPct:0.3, costPct:0.08, slippagePct:0.06 };
  const explanation = SimulationEngine.explainCandidateEligibility(candidate, '2026-07-02T05:00:00.000Z', {}, {});
  assert.ok(explanation.reasons.some(reason => /2.5x modeled costs/.test(reason)));
});

test('flat-market generic runner locks at 0.55 while a dominant leader retains 0.80', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN:15, SIMULATION_TRAIL_START_PCT:2 });
  const market = { indices:{ nifty50:{ change:0.05 }, banknifty:{ change:-0.4 }, smallcap:{ change:-0.3 } } };
  const candidate = makeEligibleCandidate('ADAPTIVE-LOCK', 90);
  candidate.price = 100.55;
  candidate.sectorPriority = { aligned:false, sectorAvg:0.1, breadthPct:45, rs:0.4 };
  const trade = {
    symbol:candidate.symbol, side:'buy', setupType:'MOMENTUM_RUNNER',
    entryPrice:100, qty:20, openedAt:'2026-07-02T04:30:00.000Z',
  };
  const partial = SimulationEngine.getSimulationExit(trade, 100.55, candidate, '2026-07-02T05:00:00.000Z', settings, { market });
  assert.equal(partial?.action, 'partial');
  assert.equal(partial?.qtyPct, 25);
  assert.equal(trade._activeLongProfitLockPct, 0.55);

  const leaderTrade = { ...trade, _partialTargetBooked:false, _maxFavorablePct:0, _bestPrice:100 };
  const leaderCandidate = { ...candidate, sectorPriority:{ aligned:true, sectorAvg:1.2, sectorRank:1, sectorCount:8, breadthPct:75, rs:1.4 } };
  assert.equal(
    SimulationEngine.getSimulationExit(leaderTrade, 100.55, leaderCandidate, '2026-07-02T05:00:00.000Z', settings, { market }),
    null
  );
  assert.equal(leaderTrade._activeLongProfitLockPct, 0.8);
});

test('fragmented market requires an actual top-ranked sector, not merely aligned Finance', () => {
  const candidate = makeEligibleCandidate('JIOFIN-LIKE', 90);
  candidate.sector = 'Finance';
  candidate.setupType = candidate.derivedSetupType = 'VWAP_PULLBACK_OR_HOLD';
  const sectorStats = {
    Finance:{ count:8, avg:0.54, advancePct:75, declinePct:25 },
    IT:{ count:8, avg:2.42, advancePct:88, declinePct:12 },
    Media:{ count:8, avg:2.64, advancePct:88, declinePct:12 },
    'Consumer Services':{ count:8, avg:2.92, advancePct:88, declinePct:12 },
  };
  const context = {
    market:{ indices:{
      nifty50:{ change:0.14 },
      banknifty:{ change:-0.15 },
      smallcap:{ change:-0.35 },
    } },
    sectorTrend:{ Finance:0.54, IT:2.42, Media:2.64, 'Consumer Services':2.92 },
  };
  SimulationEngine.applySectorPriority(candidate, sectorStats, context, TradeRules.withDefaults({}));
  assert.equal(candidate.sectorPriority.aligned, true);
  assert.equal(candidate.sectorPriority.sectorRank, 4);
  assert.match(
    SimulationEngine.getSetupBlockReason(candidate, candidate.setupType, '2026-07-28T05:22:22.790Z', {}, context),
    /not a dominant-sector leader/
  );
});

test('momentum runner rejects a positive five-minute move after its prior impulse high has faded', () => {
  const candidate = makeEligibleCandidate('LATE-RUNNER', 90);
  candidate.price = 238.6;
  candidate.setupType = candidate.derivedSetupType = 'MOMENTUM_RUNNER';
  candidate.sectorPriority = { aligned:true, sectorAvg:1.2, sectorRank:1, sectorCount:8, breadthPct:75, rs:1.2 };
  candidate.indicators.vwap = 237.46;
  candidate.indicators.entryTrigger = 'Buy above 237.40';
  candidate.indicators.dayChange = 1.03;
  candidate.indicators.volumeShock = {
    ...candidate.indicators.volumeShock,
    change5m:0.55,
    recentHigh:239.18,
    recentHighAt:'2026-07-28T05:05:00.000Z',
    breakout:false,
  };
  assert.match(
    SimulationEngine.getSetupBlockReason(candidate, 'MOMENTUM_RUNNER', '2026-07-28T05:22:22.790Z', {}, {}),
    /impulse faded/
  );
});

test('zero-progress re-entry is limited to one completed VWAP reclaim', () => {
  const candidate = makeEligibleCandidate('REENTRY', 90);
  candidate.price = 100.6;
  candidate.indicators.vwap = 100;
  candidate.indicators.relVolumeTimeAdjusted = 1.4;
  candidate.candles = [
    { time:'2026-07-02T04:55:00.000Z', open:100.1, high:100.2, low:99.8, close:99.95, volume:900 },
    { time:'2026-07-02T05:00:00.000Z', open:99.95, high:100.7, low:99.9, close:100.55, volume:1200 },
  ];
  candidate.indicators.volumeShock = { volumeRatio3m:1.1, volumeRatio5m:1.2, change5m:0.2 };
  const closed = [{
    symbol:'REENTRY', status:'closed', side:'buy',
    closeReason:'Simulation zero-progress exit',
    closedAt:'2026-07-02T04:45:00.000Z',
  }];
  assert.equal(
    SimulationEngine.isTimedContinuationReentryAllowed(candidate, '2026-07-02T05:06:00.000Z', { closedTrades:closed }, {}),
    true
  );
  closed.push({
    symbol:'REENTRY', status:'closed', closeReason:'Simulation target',
    entryContext:{ continuationReentry:true },
  });
  assert.equal(
    SimulationEngine.isTimedContinuationReentryAllowed(candidate, '2026-07-02T05:06:00.000Z', { closedTrades:closed }, {}),
    false
  );
});
