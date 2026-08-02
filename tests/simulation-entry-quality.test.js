const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

function qualityCandidate(overrides = {}) {
  return {
    symbol:'QUALITY',
    side:'buy',
    signal:'buy',
    price:101,
    score:90,
    setupType:'MOMENTUM_RUNNER',
    derivedSetupType:'MOMENTUM_RUNNER',
    rr:2.2,
    cost:{ ok:true, netPct:1.2 },
    indicators:{
      entryStatus:'Triggered',
      entryTrigger:'Buy above 100.5',
      vwap:100,
      ema9:100.8,
      ema20:100.2,
      superTrendDirection:'bullish',
      relVolumeTimeAdjusted:1.8,
      stopPct:0.7,
      reasons:['Opening range breakout'],
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:0.2 },
    },
    ...overrides,
  };
}

test('decision score blends raw score with independent entry-quality evidence', () => {
  const strong = SimulationEngine.applyDecisionScore(qualityCandidate(), null, {});
  const weak = qualityCandidate({
    symbol:'WEAK',
    indicators:{
      entryStatus:'Triggered',
      entryTrigger:'Buy above 100.5',
      vwap:102,
      ema9:99,
      ema20:100,
      superTrendDirection:'bearish',
      relVolumeTimeAdjusted:0.7,
      stopPct:1.4,
      reasons:['Opening range breakout'],
      volumeShock:{ volumeRatio3m:0.5, volumeRatio5m:0.6, change5m:-0.4 },
    },
  });
  SimulationEngine.applyDecisionScore(weak, null, {});

  assert.equal(strong.score, 90, 'raw source score remains available for audit');
  assert.ok(strong.decisionScore > weak.decisionScore);
  assert.ok(weak.decisionScore < weak.score);
  assert.equal(strong.scoreAudit.independentEvidenceCount >= 5, true);
});

test('a sufficiently sampled loss-making setup and score band is blocked on net expectancy', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_EXPECTANCY_MIN_SAMPLE:12,
    SIMULATION_EXPECTANCY_BLOCK_MIN_SAMPLE:25,
  });
  const trades = Array.from({ length:25 }, (_, index) => ({
    id:`loss-${index}`,
    symbol:`LOSS${index}`,
    source:'simulation',
    status:'closed',
    setupType:'MOMENTUM_RUNNER',
    score:84,
    entryPrice:100,
    qty:100,
    pnl:-100,
    closedAt:new Date(Date.UTC(2026, 6, 1, 4, index)).toISOString(),
  }));
  const model = SimulationEngine.buildNetExpectancyModel(trades, settings);
  const candidate = SimulationEngine.applyDecisionScore(qualityCandidate({ score:84 }), model, settings);

  assert.equal(candidate.scoreAudit.expectancy.source, 'setup-score-band');
  assert.equal(candidate.scoreAudit.expectancy.sample, 25);
  assert.match(SimulationEngine.getNegativeExpectancyBlockReason(candidate, settings), /negative net expectancy/);
});

test('entry audit snapshots are deterministic and contain the active decision controls', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_MAX_NEW_PER_CYCLE:1,
    SIMULATION_LONG_CONFIRM_MODE:'completed_candle_hold',
  });
  const snapshot = SimulationEngine.buildSettingsAuditSnapshot(settings);
  const fingerprint = SimulationEngine.stableAuditFingerprint(snapshot);

  assert.equal(snapshot.SIMULATION_MAX_NEW_PER_CYCLE, 1);
  assert.equal(snapshot.SIMULATION_LONG_CONFIRM_MODE, 'completed_candle_hold');
  assert.equal(snapshot.SIMULATION_LONG_HARD_MIN_DECISION_SCORE, 65);
  assert.equal(snapshot.SIMULATION_LONG_ENTRY_CUTOFF_MIN, 14 * 60 + 15);
  assert.equal(snapshot.SIMULATION_RUNNER_SCALE_IN_MIN_MFE_PCT, 0.5);
  assert.equal(snapshot.SIMULATION_MAX_POSITION_MULTIPLIER, 1);
  assert.equal(fingerprint, SimulationEngine.stableAuditFingerprint({ ...snapshot }));
  assert.deepEqual(
    SimulationEngine.buildIndicatorAuditSnapshot(qualityCandidate()).entryStatus,
    'Triggered'
  );
});

test('ordinary long entries stop at 14:15 IST while strict continuation setups use the exception gate', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED:false,
  });
  const ordinary = qualityCandidate({
    setupType:'FRESH_BREAKOUT',
    derivedSetupType:'FRESH_BREAKOUT',
    decisionScore:95,
  });
  assert.doesNotMatch(
    SimulationEngine.getSetupBlockReason(ordinary, 'FRESH_BREAKOUT', '2026-07-16T08:44:00.000Z', settings),
    /ordinary long entries blocked/
  );
  assert.match(
    SimulationEngine.getSetupBlockReason(ordinary, 'FRESH_BREAKOUT', '2026-07-16T08:45:00.000Z', settings),
    /ordinary long entries blocked after 14:15 IST/
  );

  const exceptional = qualityCandidate({
    setupType:'VWAP_TREND_CONTINUATION',
    derivedSetupType:'VWAP_TREND_CONTINUATION',
    decisionScore:95,
    indicators:{
      ...qualityCandidate().indicators,
      relVolumeTimeAdjusted:2.5,
      volumeShock:{ volumeRatio3m:1.3, volumeRatio5m:1.3, change5m:0.3, recentHigh:101 },
    },
  });
  const exceptionReason = SimulationEngine.getSetupBlockReason(
    exceptional,
    'VWAP_TREND_CONTINUATION',
    '2026-07-16T08:50:00.000Z',
    settings
  );
  assert.doesNotMatch(exceptionReason, /ordinary long entries blocked/);

  exceptional.decisionScore = 89;
  assert.match(
    SimulationEngine.getSetupBlockReason(exceptional, 'VWAP_TREND_CONTINUATION', '2026-07-16T08:50:00.000Z', settings),
    /late long decision score 89 < 90/
  );
});

test('completed-candle mode requires a closed breakout candle followed by a live trigger and VWAP hold', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_LONG_CONFIRM_MODE:'completed_candle_hold',
    SIMULATION_LONG_CONFIRM_CANDLE_MIN:5,
  });
  const candidate = qualityCandidate({
    __snapshotAt:'2026-07-16T05:10:30.000Z',
    candles:[
      { time:'2026-07-16T05:00:00.000Z', open:100, high:100.8, low:99.9, close:100.7, volume:1000 },
      { time:'2026-07-16T05:10:00.000Z', open:100.9, high:101.1, low:100.8, close:101, volume:200 },
    ],
  });

  const confirmation = SimulationEngine.getLongEntryConfirmation(
    candidate,
    null,
    'buy',
    candidate.__snapshotAt,
    settings
  );
  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.candle.time, '2026-07-16T05:00:00.000Z');
  assert.equal(confirmation.candleBeyondTrigger, true);
  assert.equal(confirmation.triggerHeld, true);
  assert.equal(confirmation.vwapHeld, true);

  candidate.price = 100.2;
  const failedHold = SimulationEngine.getLongEntryConfirmation(candidate, null, 'buy', candidate.__snapshotAt, settings);
  assert.equal(failedHold.ok, false);
  assert.match(failedHold.reason, /post-breakout hold failed/);
});

test('completed-candle mode does not accept two snapshots without a completed breakout candle', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_LONG_CONFIRM_MODE:'completed_candle_hold' });
  const candidate = qualityCandidate({ __snapshotAt:'2026-07-16T05:10:30.000Z' });
  candidate.previousCandidate = SimulationEngine.toConfirmationCandidate(candidate);

  const confirmation = SimulationEngine.getLongEntryConfirmation(
    candidate,
    candidate.previousCandidate,
    'buy',
    candidate.__snapshotAt,
    settings
  );
  assert.equal(confirmation.ok, false);
  assert.match(confirmation.reason, /completed 5m candle/);
});

function globallyConfirmedShort(overrides = {}) {
  const base = qualityCandidate({
    symbol:'SHORT-QUALITY',
    side:'sell',
    signal:'sell',
    price:99.7,
    score:-85,
    setupType:'BREAKDOWN',
    derivedSetupType:'BREAKDOWN',
    __snapshotAt:'2026-07-16T05:10:30.000Z',
    candles:[
      { time:'2026-07-16T04:55:00.000Z', open:100.2, high:100.25, low:99.7, close:99.8, volume:900 },
      { time:'2026-07-16T05:00:00.000Z', open:100.15, high:100.2, low:99.55, close:99.75, volume:1000 },
    ],
    indicators:{
      ...qualityCandidate().indicators,
      entryTrigger:'Sell below 100',
      vwap:99.9,
      rsi:38,
      ema9:99.7,
      ema20:100.05,
      superTrendDirection:'bearish',
      dayChange:-1.2,
      volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.2, change5m:-0.2 },
    },
  });
  return { ...base, ...overrides };
}

test('short entries require a bearish completed candle, a live hold, and fresh volume', () => {
  const settings = TradeRules.withDefaults({});
  const candidate = globallyConfirmedShort();
  const confirmation = SimulationEngine.getShortEntryConfirmation(candidate, null, 'sell', candidate.__snapshotAt, settings);
  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.retestRejected, true);

  const noCandle = globallyConfirmedShort({ candles:[] });
  assert.match(
    SimulationEngine.getShortEntryConfirmation(noCandle, null, 'sell', noCandle.__snapshotAt, settings).reason,
    /completed 5m candle/
  );

  const staleVolume = globallyConfirmedShort({
    indicators:{ ...candidate.indicators, volumeShock:{ volumeRatio3m:0.7, volumeRatio5m:0.8 } },
  });
  assert.match(
    SimulationEngine.getShortEntryConfirmation(staleVolume, null, 'sell', staleVolume.__snapshotAt, settings).reason,
    /fresh post-confirmation volume/
  );

  const reclaimed = globallyConfirmedShort({ price:100.05 });
  assert.match(
    SimulationEngine.getShortEntryConfirmation(reclaimed, null, 'sell', reclaimed.__snapshotAt, settings).reason,
    /post-breakdown hold failed/
  );
});

test('late deeply-declined shorts need a completed trigger or VWAP retest rejection', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_SHORT_LATE_ACCELERATION_ENABLED:false });
  const at = '2026-07-16T05:10:30.000Z'; // 10:40 IST
  const rejectedRetest = globallyConfirmedShort({
    __snapshotAt:at,
    indicators:{ ...globallyConfirmedShort().indicators, dayChange:-3 },
  });
  assert.equal(SimulationEngine.getSetupBlockReason(rejectedRetest, 'BREAKDOWN', at, settings), '');

  const noRetest = globallyConfirmedShort({
    __snapshotAt:at,
    candles:[
      { time:'2026-07-16T04:55:00.000Z', open:99.82, high:99.85, low:99.7, close:99.75, volume:900 },
      { time:'2026-07-16T05:00:00.000Z', open:99.82, high:99.86, low:99.6, close:99.65, volume:1000 },
    ],
    indicators:{ ...globallyConfirmedShort().indicators, dayChange:-3 },
  });
  assert.match(
    SimulationEngine.getSetupBlockReason(noRetest, 'BREAKDOWN', at, settings),
    /late short blocked/
  );
});

test('late shorts require full stock, candle, Nifty and sector acceleration alignment', () => {
  const settings = TradeRules.withDefaults({});
  const at = '2026-07-16T05:10:30.000Z';
  const candidate = globallyConfirmedShort({
    __snapshotAt:at,
    candles:[
      { time:'2026-07-16T04:55:00.000Z', open:100.2, high:100.25, low:99.7, close:99.8, volume:900 },
      { time:'2026-07-16T05:00:00.000Z', open:100.15, high:100.2, low:99.55, close:99.7, volume:1000 },
    ],
    indicators:{
      ...globallyConfirmedShort().indicators,
      dayChange:-1.5,
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:-0.3 },
    },
    sector:'IT',
  });
  const context = {
    market:{ indices:{ nifty50:{ change:-0.7 } } },
    sectorTrend:{ IT:-1 },
    marketHistory:[{ at:'2026-07-16T05:00:00.000Z', market:{ indices:{ nifty50:{ change:-0.5 } } }, sectorTrend:{ IT:-0.8 } }],
  };
  const info = SimulationEngine.getLateShortAccelerationInfo(candidate, at, context, settings,
    SimulationEngine.getShortEntryConfirmation(candidate, null, 'sell', at, settings));
  assert.equal(info.ok, true);
  assert.equal(info.required, 4);
  assert.equal(info.count, 4);
  assert.equal(SimulationEngine.getSetupBlockReason(candidate, 'BREAKDOWN', at, settings, context), '');

  const stalled = globallyConfirmedShort({
    ...candidate,
    indicators:{ ...candidate.indicators, volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:0.1 } },
  });
  assert.match(
    SimulationEngine.getSetupBlockReason(stalled, 'BREAKDOWN', at, settings, {
      market:{ indices:{ nifty50:{ change:-0.4 } } },
      sectorTrend:{ IT:-0.5 },
      marketHistory:context.marketHistory,
    }),
    /late short acceleration/
  );
});

test('opening-flush reversal requires VWAP reclaim, higher closes, fresh volume and index recovery', () => {
  const at = '2026-07-16T05:20:30.000Z';
  const candidate = qualityCandidate({
    side:'buy',
    signal:'buy',
    price:100.3,
    __snapshotAt:at,
    candles:[
      { time:'2026-07-16T05:00:00.000Z', open:99.2, high:99.3, low:98.5, close:98.8, volume:800 },
      { time:'2026-07-16T05:05:00.000Z', open:98.8, high:99.7, low:98.7, close:99.5, volume:900 },
      { time:'2026-07-16T05:10:00.000Z', open:99.5, high:100.3, low:99.4, close:100.2, volume:1200 },
    ],
    indicators:{
      ...qualityCandidate().indicators,
      entryTrigger:'Buy above 100.1',
      vwap:100,
      openingHigh:101,
      ohlc:{ previousClose:100, session:{ low:97 } },
      volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.2 },
    },
  });
  const info = SimulationEngine.getOpeningFlushReversalInfo(candidate, {}, at, {
    market:{ indices:{ nifty50:{ change:-0.2 } } },
    marketHistory:[{ at:'2026-07-16T04:50:00.000Z', market:{ indices:{ nifty50:{ change:-0.8 } } } }],
  });
  assert.equal(info.ok, true);
  assert.equal(info.twoHigherCloses, true);
  assert.ok(info.indexRecoveryPct >= 0.5);
});

test('armed entry triggers stay frozen for fifteen minutes', () => {
  const settings = TradeRules.withDefaults({});
  const previous = {
    side:'sell',
    __frozenEntryTrigger:102,
    __frozenTriggerAt:new Date('2026-07-16T05:00:00.000Z').getTime(),
  };
  const candidate = globallyConfirmedShort({
    indicators:{ ...globallyConfirmedShort().indicators, entryStatus:'Triggered', entryTrigger:'Sell below 100' },
  });
  SimulationEngine.applyFrozenEntryTrigger(candidate, previous, '2026-07-16T05:10:00.000Z', settings);
  assert.equal(SimulationEngine.getEntryTriggerPrice(candidate), 102);
  const rearmed = globallyConfirmedShort({
    indicators:{ ...globallyConfirmedShort().indicators, entryStatus:'Triggered', entryTrigger:'Sell below 100' },
  });
  SimulationEngine.applyFrozenEntryTrigger(rearmed, previous, '2026-07-16T05:16:00.000Z', settings);
  assert.equal(SimulationEngine.getEntryTriggerPrice(rearmed), 100);
});

test('top-gainer pullback reclaim and bull/bear-flag continuations are separate confirmed setups', () => {
  const settings = TradeRules.withDefaults({});
  const at = '2026-07-16T05:10:30.000Z';
  const pullback = qualityCandidate({
    symbol:'GAINER', price:100.4, score:85, topGainerRank:1, __snapshotAt:at,
    candles:[{ time:'2026-07-16T05:00:00.000Z', open:99.9, high:100.4, low:99.8, close:100.3, volume:1000 }],
    indicators:{
      ...qualityCandidate().indicators,
      dayChange:6, vwap:100, ema9:100.3, ema20:99.8, superTrendDirection:'bullish',
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3 },
    },
  });
  assert.equal(SimulationEngine.getTopGainerPullbackReclaimInfo(pullback, settings, at).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(pullback, settings, at), 'TOP_GAINER_PULLBACK_RECLAIM');

  const bullFlag = qualityCandidate({
    symbol:'BULL-FLAG', price:101.05, score:85, sector:'IT', __snapshotAt:at,
    previousCandidate:{ side:'buy', signal:'buy', price:100.7, indicators:{ vwap:100.4 } },
    candles:[
      { time:'2026-07-16T04:40:00.000Z', open:99.7, high:100.5, low:99.65, close:100.4, volume:1200 },
      { time:'2026-07-16T04:45:00.000Z', open:100.4, high:100.9, low:100.2, close:100.7, volume:800 },
      { time:'2026-07-16T04:50:00.000Z', open:100.7, high:100.85, low:100.3, close:100.65, volume:700 },
      { time:'2026-07-16T05:00:00.000Z', open:100.7, high:101.15, low:100.6, close:101.05, volume:1200 },
    ],
    indicators:{
      ...qualityCandidate().indicators,
      dayChange:3, vwap:100.4,
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:0.3 },
    },
  });
  assert.equal(SimulationEngine.getBullFlagContinuationInfo(bullFlag, settings, at).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(bullFlag, settings, at), 'BULL_FLAG_CONTINUATION');
  const weakPole = structuredClone(bullFlag);
  weakPole.candles[0] = { ...weakPole.candles[0], open:100.1, close:100.4, volume:800 };
  assert.match(SimulationEngine.getBullFlagContinuationInfo(weakPole, settings, at).reason, /pole gain/);

  const bearFlag = globallyConfirmedShort({
    symbol:'BEAR-FLAG', price:99.65, score:-85, sector:'IT', __snapshotAt:at,
    previousCandidate:{ side:'sell', signal:'sell', price:100.2, indicators:{ vwap:100.5 } },
    candles:[
      { time:'2026-07-16T04:45:00.000Z', open:100.7, high:101, low:100, close:100.4, volume:800 },
      { time:'2026-07-16T04:50:00.000Z', open:100.4, high:100.8, low:100, close:100.2, volume:700 },
      { time:'2026-07-16T05:00:00.000Z', open:100.3, high:100.4, low:99.5, close:99.7, volume:1200 },
    ],
    indicators:{
      ...globallyConfirmedShort().indicators,
      dayChange:-3, vwap:100.3,
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:-0.3 },
    },
  });
  assert.equal(SimulationEngine.getBearFlagContinuationInfo(bearFlag, settings, at).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(bearFlag, settings, at), 'BEAR_FLAG_CONTINUATION');
});

test('gap-and-go requires a prior-range gap, opening hold, first-hour timing, and fresh volume', () => {
  const at = '2026-07-16T04:30:00.000Z';
  const longGap = qualityCandidate({
    symbol:'LONG-GAP', side:'buy', signal:'buy', price:102, open:101.5, score:85, __snapshotAt:at,
    indicators:{
      ...qualityCandidate().indicators,
      gapPct:1.5, gapQuality:'gap-up holding', prevDayHigh:101, prevDayLow:98,
      relVolumeTimeAdjusted:1.8,
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.3, change5m:0.3 },
    },
  });
  assert.equal(SimulationEngine.getGapAndGoInfo(longGap, {}, at).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(longGap, {}, at), 'GAP_AND_GO');

  const shortGap = globallyConfirmedShort({
    symbol:'SHORT-GAP', side:'sell', signal:'sell', price:97.8, open:98.2, score:-85, __snapshotAt:at,
    indicators:{
      ...globallyConfirmedShort().indicators,
      gapPct:-1.8, gapQuality:'gap-down weak', prevDayHigh:102, prevDayLow:99,
      relVolumeTimeAdjusted:1.9,
      volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.4, change5m:-0.4 },
    },
  });
  assert.equal(SimulationEngine.getGapAndGoInfo(shortGap, {}, at).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(shortGap, {}, at), 'GAP_AND_GO');
  assert.match(SimulationEngine.getGapAndGoInfo({ ...longGap, price:101.2, indicators:{ ...longGap.indicators, gapQuality:'gap-up fading' } }, {}, at).reason, /hold/);
  assert.match(SimulationEngine.getGapAndGoInfo(longGap, {}, '2026-07-16T05:01:00.000Z').reason, /blocked after 10:30/);
});

test('fresh directional news adjusts only momentum ranking within the configured bound', () => {
  const base = qualityCandidate({
    setupType:'MOMENTUM_RUNNER', derivedSetupType:'MOMENTUM_RUNNER', side:'buy', signal:'buy',
    __snapshotAt:'2026-07-16T05:00:00.000Z',
    indicators:{
      ...qualityCandidate().indicators,
      newsImpact:{ tradeImpactScore:80, newsSentiment:'Positive', tradeImpactReason:'Order win', publishedAt:'2026-07-16T04:00:00.000Z' },
    },
  });
  const positive = SimulationEngine.getMomentumCatalystAdjustment(base, {});
  assert.equal(positive.adjustment, 4);
  assert.equal(positive.applied, true);
  const conflicting = SimulationEngine.getMomentumCatalystAdjustment({
    ...base,
    indicators:{ ...base.indicators, newsImpact:{ ...base.indicators.newsImpact, tradeImpactScore:-85 } },
  }, {});
  assert.equal(conflicting.adjustment, -4.25);
  assert.equal(SimulationEngine.getMomentumCatalystAdjustment({ ...base, derivedSetupType:'FRESH_BREAKOUT' }, {}).adjustment, 0);
  assert.equal(SimulationEngine.getMomentumCatalystAdjustment({
    ...base,
    indicators:{ ...base.indicators, newsImpact:{ ...base.indicators.newsImpact, publishedAt:'2026-07-10T04:00:00.000Z' } },
  }, {}).adjustment, 0);
});

function globallyConfirmedLong(overrides = {}) {
  const base = qualityCandidate({
    price:100.5,
    setupType:'VWAP_PULLBACK_OR_HOLD',
    derivedSetupType:'VWAP_PULLBACK_OR_HOLD',
    __snapshotAt:'2026-07-16T05:10:30.000Z',
    candles:[
      { time:'2026-07-16T05:00:00.000Z', open:100, high:100.8, low:99.9, close:100.7, volume:1000 },
    ],
    indicators:{
      ...qualityCandidate().indicators,
      entryTrigger:'Buy above 100.20 with VWAP hold',
      vwap:100,
      volumeShock:{ volumeRatio3m:1.1, volumeRatio5m:1.2, change5m:0.1 },
    },
  });
  return { ...base, ...overrides };
}

test('every long setup requires a completed candle and fresh volume observed after confirmation', () => {
  const settings = TradeRules.withDefaults({});
  const candidate = globallyConfirmedLong();
  assert.equal(
    SimulationEngine.getSetupBlockReason(candidate, candidate.setupType, candidate.__snapshotAt, settings),
    ''
  );

  const noCandle = globallyConfirmedLong({ candles:[] });
  assert.match(
    SimulationEngine.getSetupBlockReason(noCandle, noCandle.setupType, noCandle.__snapshotAt, settings),
    /completed 5m candle/
  );

  const staleVolume = globallyConfirmedLong({
    indicators:{
      ...candidate.indicators,
      volumeShock:{ volumeRatio3m:0.8, volumeRatio5m:0.9, change5m:0.1 },
    },
  });
  const confirmation = SimulationEngine.getLongEntryConfirmation(
    staleVolume,
    null,
    'buy',
    staleVolume.__snapshotAt,
    settings
  );
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.volumeObservedAfterConfirmation, true);
  assert.match(confirmation.reason, /fresh post-confirmation volume/);
});

test('all long setups enforce 0.60 percent trigger and 0.80 percent VWAP extension limits', () => {
  const settings = TradeRules.withDefaults({});
  const triggerChase = globallyConfirmedLong({ price:100.9 });
  assert.match(
    SimulationEngine.getSetupBlockReason(triggerChase, triggerChase.setupType, triggerChase.__snapshotAt, settings),
    /long trigger extension/
  );

  const vwapChase = globallyConfirmedLong({
    price:100.9,
    indicators:{
      ...globallyConfirmedLong().indicators,
      entryTrigger:'Buy above 100.40 with VWAP hold',
    },
  });
  assert.match(
    SimulationEngine.getSetupBlockReason(vwapChase, vwapChase.setupType, vwapChase.__snapshotAt, settings),
    /long VWAP extension/
  );
});

function earlyMomentumCandidate(overrides = {}) {
  const base = qualityCandidate({
    symbol:'EARLY',
    price:100.5,
    score:59,
    setupType:'',
    derivedSetupType:'',
    __snapshotAt:'2026-07-16T05:10:30.000Z',
    candles:[
      { time:'2026-07-16T05:00:00.000Z', open:99.9, high:100.4, low:99.8, close:100.3, volume:1000 },
      { time:'2026-07-16T05:10:00.000Z', open:100.4, high:100.6, low:100.4, close:100.5, volume:200 },
    ],
    indicators:{
      ...qualityCandidate().indicators,
      entryTrigger:'Buy above 100 with VWAP hold',
      vwap:100.1,
      ema5:100.3,
      ema9:null,
      ema20:null,
      rsi7:66,
      rsi:null,
      superTrendDirection:null,
      relVolumeTimeAdjusted:2,
      volumeShock:{ volumeRatio3m:1.2, volumeRatio5m:1.1, change5m:0.2 },
      earlyMomentum:{
        active:true,
        warmup:true,
        trigger:100,
        emaBullish:true,
        higherCloses:true,
        higherLows:true,
        rsiHealthy:true,
        freshVolume:true,
      },
    },
  });
  return { ...base, ...overrides };
}

test('early momentum uses partial warm-up evidence and retains completed-candle entry guards', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_EARLY_MOMENTUM_ENTRY_CUTOFF_MIN:11 * 60,
    SIMULATION_LONG_HARD_MIN_DECISION_SCORE_ENABLED:false,
  });
  const candidate = earlyMomentumCandidate();
  assert.equal(SimulationEngine.getEarlyMomentumInfo(candidate, settings).ok, true);
  assert.equal(SimulationEngine.deriveSetupType(candidate, settings, candidate.__snapshotAt), 'EARLY_MOMENTUM');
  candidate.derivedSetupType = 'EARLY_MOMENTUM';
  assert.equal(
    SimulationEngine.getMinScoreForCandidate(settings, 'buy', 'EARLY_MOMENTUM', candidate),
    55
  );
  assert.equal(
    SimulationEngine.getSetupBlockReason(candidate, 'EARLY_MOMENTUM', candidate.__snapshotAt, settings),
    ''
  );

  const noCompletedBreakout = earlyMomentumCandidate({
    candles:[{ time:'2026-07-16T05:10:00.000Z', open:100.4, high:100.6, low:100.4, close:100.5, volume:200 }],
  });
  noCompletedBreakout.derivedSetupType = 'EARLY_MOMENTUM';
  assert.match(
    SimulationEngine.getSetupBlockReason(noCompletedBreakout, 'EARLY_MOMENTUM', noCompletedBreakout.__snapshotAt, settings),
    /completed 5m candle/
  );
});

test('early momentum rejects stale volume and strict extension breaches', () => {
  const settings = TradeRules.withDefaults({});
  const staleVolume = earlyMomentumCandidate({
    indicators:{
      ...earlyMomentumCandidate().indicators,
      volumeShock:{ volumeRatio3m:0.8, volumeRatio5m:0.9, change5m:0.2 },
    },
  });
  assert.equal(SimulationEngine.getEarlyMomentumInfo(staleVolume, settings).ok, false);

  const extended = earlyMomentumCandidate({ price:100.9 });
  assert.equal(SimulationEngine.getEarlyMomentumInfo(extended, settings).ok, false);
});

test('early momentum is blocked after 10:15 IST and requires sector support when market evidence exists', () => {
  const settings = TradeRules.withDefaults({});
  const late = earlyMomentumCandidate({ __snapshotAt:'2026-07-28T04:56:00.000Z' });
  assert.match(
    SimulationEngine.getEarlyMomentumInfo(late, settings, late.__snapshotAt, {}).reason,
    /blocked after 10:15 IST/
  );

  const unsupported = earlyMomentumCandidate({ __snapshotAt:'2026-07-28T04:35:00.000Z' });
  unsupported.sectorPriority = { aligned:false, sectorAvg:0.2, sectorRank:6, sectorCount:12, breadthPct:45, rs:0.4 };
  assert.match(
    SimulationEngine.getEarlyMomentumInfo(
      unsupported,
      settings,
      unsupported.__snapshotAt,
      { market:{ indices:{ nifty50:{ change:0.1 } } } }
    ).reason,
    /sector alignment or RS/
  );
});

test('standard long profit lock books 25 percent without exiting on the first cost retracement', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_GAIN_MILESTONE_ENABLED:false,
    SIMULATION_TRAIL_START_PCT:2,
  });
  const trade = {
    symbol:'LOCK',
    side:'buy',
    setupType:'VWAP_PULLBACK_OR_HOLD',
    entryPrice:100,
    qty:10,
    openedAt:'2026-07-16T05:00:00.000Z',
  };
  const candidate = globallyConfirmedLong({ symbol:'LOCK', price:100.8 });
  assert.equal(
    SimulationEngine.getSimulationExit(trade, 100.8, candidate, '2026-07-16T05:14:59.000Z', settings, {}),
    null,
    'profit lock must not activate before the configured minimum hold'
  );
  const partial = SimulationEngine.getSimulationExit(trade, 100.8, candidate, '2026-07-16T05:15:00.000Z', settings, {});
  assert.equal(partial.reason, 'Simulation long profit lock');
  assert.equal(partial.action, 'partial');
  assert.equal(partial.qtyPct, 25);
  assert.equal(partial.protectRemainder, true);
  trade._partialTargetBooked = true;
  const locked = SimulationEngine.getSimulationExit(
    trade,
    100.1,
    { ...candidate, price:100.1 },
    '2026-07-16T05:15:10.000Z',
    settings,
    {}
  );
  assert.equal(locked, null, 'breakeven requires completed VWAP deterioration confirmation');
});

function topGainerCandidate(symbol, dayChange, overrides = {}) {
  return qualityCandidate({
    symbol,
    price:100.5,
    assetType:'stock',
    setupType:'',
    derivedSetupType:'',
    indicators:{
      ...qualityCandidate().indicators,
      dayChange,
      entryTrigger:'Buy above 100.20 with VWAP hold',
      vwap:100,
      ema9:100.4,
      ema20:100.1,
      relVolumeTimeAdjusted:1.3,
      volumeShock:{ volumeRatio3m:1.05, volumeRatio5m:1.1, change5m:0.1 },
    },
    ...overrides,
  });
}

test('top-gainer continuation ranks the universe and applies its qualification and midday rules', () => {
  const settings = TradeRules.withDefaults({});
  const candidates = [
    topGainerCandidate('ONE', 2.2),
    topGainerCandidate('TWO', 3.1),
    topGainerCandidate('THREE', 1.9),
    topGainerCandidate('FOUR', 4.1),
    topGainerCandidate('FIVE', 2.7),
    topGainerCandidate('SIX', 1.8),
  ];
  SimulationEngine.annotateTopGainerRanks(candidates, settings);

  assert.equal(candidates.find(candidate => candidate.symbol === 'FOUR').topGainerRank, 1);
  assert.equal(candidates.find(candidate => candidate.symbol === 'SIX').topGainerRank, undefined);
  const qualified = candidates.find(candidate => candidate.symbol === 'TWO');
  assert.equal(
    SimulationEngine.getTopGainerContinuationInfo(qualified, settings, '2026-07-16T05:00:00.000Z').ok,
    true
  );
  assert.equal(
    SimulationEngine.deriveSetupType(qualified, settings, '2026-07-16T05:00:00.000Z'),
    'TOP_GAINER_CONTINUATION'
  );
  assert.match(
    SimulationEngine.getTopGainerContinuationInfo(qualified, settings, '2026-07-16T07:00:00.000Z').reason,
    /12:00 to 13:30/
  );

  qualified.price = 100.9;
  assert.match(
    SimulationEngine.getTopGainerContinuationInfo(qualified, settings, '2026-07-16T05:00:00.000Z').reason,
    /trigger extension/
  );
});

test('top-gainer continuation exits on a completed trigger/VWAP loss and locks profit at 0.8 percent', () => {
  const settings = TradeRules.withDefaults({});
  const trade = {
    symbol:'GAINER',
    side:'buy',
    setupType:'TOP_GAINER_CONTINUATION',
    entryPrice:100,
    qty:10,
    openedAt:'2026-07-16T05:00:00.000Z',
    entryContext:{ indicatorSnapshot:{ entryTrigger:'Buy above 100.20 with VWAP hold' } },
  };
  const failedHold = topGainerCandidate('GAINER', 3, {
    price:99.8,
    candles:[{ time:'2026-07-16T05:05:00.000Z', open:100.3, high:100.4, low:99.7, close:99.9, volume:1200 }],
    indicators:{
      ...topGainerCandidate('GAINER', 3).indicators,
      vwap:100,
    },
  });
  const holdExit = SimulationEngine.getTopGainerContinuationExit(
    trade,
    failedHold.price,
    failedHold,
    '2026-07-16T05:10:30.000Z',
    settings
  );
  assert.equal(holdExit.reason, 'Simulation top-gainer trigger and VWAP loss');

  trade._maxFavorablePct = 0.8;
  trade._bestPrice = 100.8;
  const partial = SimulationEngine.getTopGainerContinuationExit(
    trade,
    100.8,
    topGainerCandidate('GAINER', 3),
    '2026-07-16T05:06:00.000Z',
    settings
  );
  assert.equal(partial.action, 'partial');
  assert.equal(partial.qtyPct, 25);

  trade._partialTargetBooked = true;
  trade._bestPrice = 101;
  const trail = SimulationEngine.getTopGainerContinuationExit(
    trade,
    100.6,
    topGainerCandidate('GAINER', 3),
    '2026-07-16T05:20:00.000Z',
    settings
  );
  assert.equal(trail.reason, 'Simulation top-gainer profit trail');
});
