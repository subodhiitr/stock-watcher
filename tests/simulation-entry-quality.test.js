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
  assert.equal(fingerprint, SimulationEngine.stableAuditFingerprint({ ...snapshot }));
  assert.deepEqual(
    SimulationEngine.buildIndicatorAuditSnapshot(qualityCandidate()).entryStatus,
    'Triggered'
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

test('standard long profit lock activates at 0.40 percent without the legacy hold delay', () => {
  const settings = TradeRules.withDefaults({});
  const trade = {
    symbol:'LOCK',
    side:'buy',
    setupType:'VWAP_PULLBACK_OR_HOLD',
    entryPrice:100,
    qty:10,
    openedAt:'2026-07-16T05:00:00.000Z',
  };
  const candidate = globallyConfirmedLong({ symbol:'LOCK', price:100.4 });
  assert.equal(
    SimulationEngine.getSimulationExit(trade, 100.4, candidate, '2026-07-16T05:00:05.000Z', settings, {}),
    null
  );
  const locked = SimulationEngine.getSimulationExit(
    trade,
    100.1,
    { ...candidate, price:100.1 },
    '2026-07-16T05:00:10.000Z',
    settings,
    {}
  );
  assert.equal(locked.reason, 'Simulation breakeven guard');
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

test('top-gainer continuation exits on a completed trigger/VWAP loss and locks profit at 0.4 percent', () => {
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

  trade._maxFavorablePct = 0.4;
  trade._bestPrice = 100.4;
  const partial = SimulationEngine.getTopGainerContinuationExit(
    trade,
    100.4,
    topGainerCandidate('GAINER', 3),
    '2026-07-16T05:06:00.000Z',
    settings
  );
  assert.equal(partial.action, 'partial');
  assert.equal(partial.qtyPct, 50);

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
