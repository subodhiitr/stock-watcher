const test = require('node:test');
const assert = require('node:assert/strict');

const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

function candle(time, close) {
  return {
    time,
    open: close + 0.1,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 1000,
  };
}

function stopCandidate(time, close) {
  return {
    symbol: 'TEST',
    price: close,
    score: 20,
    signal: 'watch',
    candles: [candle(time, close)],
    indicators: {
      vwap: 100,
      ema9: 99,
      ema20: 100,
      superTrendDirection: 'bearish',
    },
  };
}

test('normal stop honors grace and counts each completed candle only once', () => {
  const trade = {
    symbol: 'TEST',
    side: 'buy',
    entryPrice: 100,
    stop: 99,
    openedAt: '2026-07-27T04:30:00.000Z',
  };
  const settings = {
    SIMULATION_STOP_GRACE_MIN: 10,
    SIMULATION_STOP_CONFIRM_BARS: 2,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN: 5,
    SIMULATION_EMERGENCY_STOP_PCT: 1.25,
  };
  const first = stopCandidate('2026-07-27T04:30:00.000Z', 98.9);

  assert.equal(
    SimulationEngine.getSimulationStopExit(trade, 98.9, first, '2026-07-27T04:39:00.000Z', settings),
    null,
    'a normal breach inside grace must not exit'
  );
  assert.equal(trade._stopBreachCount, 1);
  assert.equal(
    SimulationEngine.getSimulationStopExit(trade, 98.9, first, '2026-07-27T04:40:00.000Z', settings),
    null,
    'refreshing the same completed candle must not increment confirmation'
  );
  assert.equal(trade._stopBreachCount, 1);

  const second = stopCandidate('2026-07-27T04:35:00.000Z', 98.8);
  const exit = SimulationEngine.getSimulationStopExit(
    trade,
    98.8,
    second,
    '2026-07-27T04:41:00.000Z',
    settings
  );
  assert.equal(exit?.reason, 'Simulation confirmed stop');
  assert.equal(exit?.confirmedBars, 2);
});

test('emergency stop remains immediate during normal-stop grace', () => {
  const trade = {
    symbol: 'TEST',
    side: 'buy',
    entryPrice: 100,
    stop: 99,
    openedAt: '2026-07-27T04:30:00.000Z',
  };
  const exit = SimulationEngine.getSimulationStopExit(
    trade,
    98.5,
    stopCandidate('2026-07-27T04:30:00.000Z', 98.5),
    '2026-07-27T04:32:00.000Z',
    {
      SIMULATION_STOP_GRACE_MIN: 10,
      SIMULATION_STOP_CONFIRM_BARS: 2,
      SIMULATION_EMERGENCY_STOP_PCT: 1.25,
    }
  );
  assert.equal(exit?.reason, 'Simulation emergency stop');
});

test('VWAP fade confirmation counts distinct completed candles, not refreshes', () => {
  const trade = {
    symbol: 'TEST',
    side: 'buy',
    entryPrice: 100,
    stop: 98,
    openedAt: '2026-07-27T04:30:00.000Z',
  };
  const settings = {
    SIMULATION_EXIT_MIN_HOLD_MIN: 12,
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 3,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN: 5,
  };
  const first = stopCandidate('2026-07-27T04:35:00.000Z', 99);

  assert.equal(SimulationEngine.getMomentumFadeExit(trade, 99, first, '2026-07-27T04:45:00.000Z', settings), null);
  assert.equal(SimulationEngine.getMomentumFadeExit(trade, 99, first, '2026-07-27T04:46:00.000Z', settings), null);
  assert.equal(SimulationEngine.getMomentumFadeExit(trade, 99, first, '2026-07-27T04:47:00.000Z', settings), null);
  assert.equal(trade._fadeBreachCount, 1, 'three refreshes of one candle must remain one breach');

  const second = stopCandidate('2026-07-27T04:40:00.000Z', 98.9);
  assert.equal(SimulationEngine.getMomentumFadeExit(trade, 98.9, second, '2026-07-27T04:46:00.000Z', settings), null);
  assert.equal(trade._fadeBreachCount, 2);

  const third = stopCandidate('2026-07-27T04:45:00.000Z', 98.8);
  const exit = SimulationEngine.getMomentumFadeExit(trade, 98.8, third, '2026-07-27T04:51:00.000Z', settings);
  assert.equal(exit?.reason, 'Simulation VWAP loss');
  assert.equal(exit?.confirmedBars, 3);
});

test('a completed candle that recovers above VWAP resets fade confirmation', () => {
  const trade = {
    symbol: 'TEST',
    side: 'buy',
    entryPrice: 100,
    openedAt: '2026-07-27T04:30:00.000Z',
  };
  const settings = {
    SIMULATION_EXIT_MIN_HOLD_MIN: 12,
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 2,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN: 5,
  };

  assert.equal(
    SimulationEngine.getMomentumFadeExit(
      trade,
      99,
      stopCandidate('2026-07-27T04:35:00.000Z', 99),
      '2026-07-27T04:45:00.000Z',
      settings
    ),
    null
  );
  assert.equal(trade._fadeBreachCount, 1);

  const recovered = stopCandidate('2026-07-27T04:40:00.000Z', 100.2);
  assert.equal(
    SimulationEngine.getMomentumFadeExit(trade, 100.2, recovered, '2026-07-27T04:46:00.000Z', settings),
    null
  );
  assert.equal(trade._fadeBreachCount, 0);
  assert.equal(trade._fadeLastBreachBarTime, null);
});

test('zero-progress exit requires the configured adverse move and two distinct completed candles', () => {
  const trade = {
    symbol:'STALLED',
    side:'buy',
    entryPrice:100,
    stop:98,
    target:103,
    qty:1,
    setupType:'MOMENTUM_RUNNER',
    openedAt:'2026-07-27T04:30:00.000Z',
    _maxFavorablePct:0,
    _bestPrice:100,
  };
  const settings = {
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN:75,
    SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT:0.2,
    SIMULATION_NO_PROGRESS_ADVERSE_PCT:0.3,
    SIMULATION_NO_PROGRESS_CONFIRM_BARS:2,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN:5,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };
  const first = {
    ...stopCandidate('2026-07-27T05:40:00.000Z', 99.6),
    symbol:'STALLED',
  };

  assert.equal(
    SimulationEngine.getSimulationExit(trade, 99.6, first, '2026-07-27T05:46:00.000Z', settings),
    null
  );
  assert.equal(trade._noProgressBreachCount, 1);
  assert.equal(
    SimulationEngine.getSimulationExit(trade, 99.6, first, '2026-07-27T05:47:00.000Z', settings),
    null,
    'refreshing one candle must not satisfy confirmation'
  );
  assert.equal(trade._noProgressBreachCount, 1);

  const second = {
    ...first,
    candles:[candle('2026-07-27T05:45:00.000Z', 99.5)],
  };
  const exit = SimulationEngine.getSimulationExit(
    trade,
    99.5,
    second,
    '2026-07-27T05:51:00.000Z',
    settings
  );
  assert.equal(exit?.reason, 'Simulation zero-progress exit');
  assert.equal(exit?.confirmedBars, 2);
});

test('zero-progress confirmation resets after price recovers inside the adverse threshold', () => {
  const trade = {
    symbol:'RECOVERY',
    side:'buy',
    entryPrice:100,
    stop:98,
    target:103,
    qty:1,
    setupType:'MOMENTUM_RUNNER',
    openedAt:'2026-07-27T04:30:00.000Z',
    _maxFavorablePct:0,
  };
  const settings = {
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN:75,
    SIMULATION_NO_PROGRESS_ADVERSE_PCT:0.3,
    SIMULATION_NO_PROGRESS_CONFIRM_BARS:2,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN:5,
    SIMULATION_EXIT_MIN_HOLD_MIN:999,
  };

  assert.equal(
    SimulationEngine.getSimulationExit(
      trade,
      99.6,
      { ...stopCandidate('2026-07-27T05:40:00.000Z', 99.6), symbol:'RECOVERY' },
      '2026-07-27T05:46:00.000Z',
      settings
    ),
    null
  );
  assert.equal(trade._noProgressBreachCount, 1);

  assert.equal(
    SimulationEngine.getSimulationExit(
      trade,
      99.8,
      { ...stopCandidate('2026-07-27T05:45:00.000Z', 99.8), symbol:'RECOVERY' },
      '2026-07-27T05:51:00.000Z',
      settings
    ),
    null
  );
  assert.equal(trade._noProgressBreachCount, 0);
  assert.equal(trade._noProgressLastBreachBarTime, null);
});

test('default fresh-breakout no-progress rule releases stalled capital after 35 minutes', () => {
  const trade = {
    symbol:'STALE-BREAKOUT',
    side:'buy',
    entryPrice:100,
    stop:98,
    target:103,
    qty:1,
    setupType:'FRESH_BREAKOUT',
    openedAt:'2026-07-27T04:30:00.000Z',
    _maxFavorablePct:0.05,
  };
  const candidate = {
    ...stopCandidate('2026-07-27T05:00:00.000Z', 99.89),
    symbol:'STALE-BREAKOUT',
  };
  const exit = SimulationEngine.getSimulationExit(
    trade,
    99.89,
    candidate,
    '2026-07-27T05:06:00.000Z',
    {
      SIMULATION_EXIT_MIN_HOLD_MIN:999,
      SIMULATION_NEGATIVE_CANDLE_EXIT_ENABLED:false,
    }
  );
  assert.equal(exit?.reason, 'Simulation zero-progress exit');
  assert.equal(exit?.confirmedBars, 1);
});

test('breakeven confirmation ignores refreshes and resets after cost or VWAP recovery', () => {
  const trade = {
    symbol:'LOCKED',
    side:'buy',
    entryPrice:100,
    openedAt:'2026-07-27T04:30:00.000Z',
  };
  const settings = {
    SIMULATION_EXIT_FADE_CONFIRM_BARS:2,
    SIMULATION_LONG_CONFIRM_CANDLE_MIN:5,
  };
  const details = { protectedPrice:100.15, costPct:0.08, slippagePct:0.06 };
  const first = {
    symbol:'LOCKED',
    price:100.1,
    candles:[candle('2026-07-27T04:40:00.000Z', 100.1)],
    indicators:{ vwap:100.2 },
  };

  assert.equal(
    SimulationEngine.getConfirmedBreakevenExit(trade, 100.1, first, '2026-07-27T04:46:00.000Z', settings, details),
    null
  );
  assert.equal(
    SimulationEngine.getConfirmedBreakevenExit(trade, 100.1, first, '2026-07-27T04:47:00.000Z', settings, details),
    null
  );
  assert.equal(trade._breakevenBreachCount, 1);

  const recovered = {
    ...first,
    price:100.3,
    candles:[candle('2026-07-27T04:45:00.000Z', 100.3)],
  };
  assert.equal(
    SimulationEngine.getConfirmedBreakevenExit(trade, 100.3, recovered, '2026-07-27T04:51:00.000Z', settings, details),
    null
  );
  assert.equal(trade._breakevenBreachCount, 0);
  assert.equal(trade._breakevenLastBreachBarTime, null);

  const newBreach = {
    ...first,
    candles:[candle('2026-07-27T04:50:00.000Z', 100.05)],
  };
  assert.equal(
    SimulationEngine.getConfirmedBreakevenExit(trade, 100.05, newBreach, '2026-07-27T04:56:00.000Z', settings, details),
    null
  );
  assert.equal(trade._breakevenBreachCount, 1, 'recovery must force a fresh confirmation sequence');
});

test('zero-progress holds a sub-0.30 percent adverse trade while a strong sector is reclaiming VWAP', () => {
  const trade = {
    symbol:'SECTOR-HOLD',
    side:'buy',
    qty:10,
    entryPrice:100,
    target:102,
    stop:99,
    setupType:'MOMENTUM_RUNNER',
    openedAt:'2026-07-27T04:00:00.000Z',
    _maxFavorablePct:0.05,
    entryContext:{ sectorPriority:{ aligned:true, sectorAvg:1.1, breadthPct:75, rs:1.2 } },
  };
  const candidate = {
    symbol:'SECTOR-HOLD',
    side:'buy',
    signal:'watch',
    score:20,
    price:99.71,
    indicators:{ vwap:100, ema9:99.7, ema20:100.1, superTrendDirection:'bearish' },
    candles:[
      { time:'2026-07-27T05:15:00.000Z', open:99.8, high:99.85, low:99.65, close:99.7, volume:900 },
      { time:'2026-07-27T05:20:00.000Z', open:99.7, high:99.95, low:99.68, close:99.9, volume:1000 },
    ],
  };
  const exit = SimulationEngine.getSimulationExit(
    trade,
    candidate.price,
    candidate,
    '2026-07-27T05:26:00.000Z',
    TradeRules.withDefaults({
      SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN:60,
      SIMULATION_NO_PROGRESS_ADVERSE_PCT:0.3,
      SIMULATION_TRAIL_START_PCT:2,
      SIMULATION_EXIT_MIN_HOLD_MIN:999,
    })
  );
  assert.equal(exit, null);
  assert.equal(trade._noProgressHoldReason, 'strong sector with VWAP reclaim in progress');
});
