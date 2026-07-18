const test = require('node:test');
const assert = require('node:assert/strict');

const { runSimulationDomainCycle } = require('../server/simulation-domain');
const SimulationEngine = require('../simulation_engine');
const TradeRules = require('../trade_rules');

test('runSimulationDomainCycle returns entry and exit intent collections', () => {
  const openTrades = [{ symbol: 'INFY' }];
  const candidates = [{ symbol: 'TCS', side: 'buy', price: 3800 }];
  const calls = [];

  const engine = {
    getSimulationExitIntent(trade) {
      calls.push(`exit:${trade.symbol}`);
      return null;
    },
    getSimulationEntryIntents(nextCandidates, at, settings, context) {
      calls.push('entries');
      assert.ok(context.openSymbols instanceof Set);
      return [{ symbol: nextCandidates[0].symbol, side: 'buy', price: 3800 }];
    }
  };

  const intents = runSimulationDomainCycle(
    { openTrades, candidates, at: '2026-06-24T10:15:00.000Z', settings: {}, context: {} },
    { engine }
  );

  assert.deepEqual(calls, ['exit:INFY', 'entries']);
  assert.deepEqual(intents, {
    exitIntents: [],
    entryIntents: [{ symbol: 'TCS', side: 'buy', price: 3800 }]
  });
});

test('runSimulationDomainCycle computes exits before entries and frees symbols closed in the cycle', () => {
  const openTrades = [{ symbol: 'INFY' }];
  const candidates = [{ symbol: 'INFY', side: 'buy', price: 1610 }];
  const callOrder = [];

  const engine = {
    getSimulationExitIntent(trade) {
      callOrder.push(`exit:${trade.symbol}`);
      return { symbol: trade.symbol, action: 'close', reason: 'Simulation target', exitPrice: 1600 };
    },
    getSimulationEntryIntents(nextCandidates, at, settings, context) {
      callOrder.push('entries');
      assert.equal(context.openSymbols.has('INFY'), false);
      assert.ok(context.openPositionCounts instanceof Map);
      return nextCandidates.map(candidate => ({ symbol: candidate.symbol, side: candidate.side, price: candidate.price }));
    }
  };

  const intents = runSimulationDomainCycle(
    { openTrades, candidates, at: '2026-06-24T10:20:00.000Z', settings: {}, context: {} },
    { engine }
  );

  assert.deepEqual(callOrder, ['exit:INFY', 'entries']);
  assert.equal(intents.exitIntents.length, 1);
  assert.equal(intents.exitIntents[0].symbol, 'INFY');
  assert.deepEqual(intents.entryIntents, [{ symbol: 'INFY', side: 'buy', price: 1610 }]);
});

test('rolling five-minute entry limit never blocks an exit intent', () => {
  const at = '2026-07-13T05:25:00.000Z';
  const trade = {
    symbol: 'INFY',
    side: 'buy',
    qty: 1,
    entryPrice: 100,
    target: 101,
    stop: 99,
    openedAt: '2026-07-13T05:21:00.000Z',
    setupType: 'BREAKOUT',
  };
  const exitCandidate = {
    symbol: 'INFY',
    side: 'buy',
    price: 101.2,
    indicators: {},
  };
  const settings = TradeRules.withDefaults({
    SIMULATION_ROLLING_ENTRY_WINDOW_MIN: 5,
    SIMULATION_ROLLING_ENTRY_MAX: 2,
  });
  const context = {
    candidateBySymbol: new Map([['INFY', exitCandidate]]),
    dayStats: {
      rollingEntries: 2,
      rollingOrdinaryEntries: 1,
      rollingSectorEntries: 1,
    },
  };

  assert.equal(
    TradeRules.getEntryBlockReason('TCS', 'MOMENTUM_RUNNER', at, context.dayStats, settings),
    'rolling entry limit 2/5m'
  );

  const intents = runSimulationDomainCycle(
    { openTrades: [trade], candidates: [], at, settings, context },
    { engine: SimulationEngine }
  );

  assert.equal(intents.exitIntents.length, 1);
  assert.equal(intents.exitIntents[0].symbol, 'INFY');
  assert.equal(intents.exitIntents[0].reason, 'Simulation target');
  assert.equal(intents.entryIntents.length, 0);
});

test('runSimulationDomainCycle respects max concurrent positions per symbol setting', () => {
  // Simulate 1 open position on JKPAPER with 1 new candidate attempting entry
  const openTrades = [
    { symbol: 'JKPAPER' }
  ];
  const candidates = [
    { 
      symbol: 'JKPAPER', 
      side: 'buy', 
      signal: 'buy',
      price: 361, 
      score: 90, 
      cost: { ok: true, netPct: 1.4 }, 
      guard: { level: 'ok' }, 
      indicators: { 
        entryStatus: 'Triggered',
        entryTrigger: 'Above VWAP',
        dayChange: 2.5, 
        relVolumeTimeAdjusted: 1.5, 
        vwap: 360, 
        rsi: 60, 
        ema9: 362, 
        ema20: 359, 
        superTrendDirection: 'bullish', 
        stopPct: 0.6,
        target: 375,
        stop: 350
      },
      freshness: { stale: false }, 
      derivedSetupType: 'MOMENTUM_RUNNER',
      previousCandidate: { symbol: 'JKPAPER', side: 'buy', indicators: { vwap: 360 } }
    }
  ];

  const settings = TradeRules.withDefaults({ SIMULATION_MAX_CONCURRENT_POSITIONS_PER_SYMBOL: 1 });
  
  // Use the real engine to properly filter candidates
  const intents = runSimulationDomainCycle(
    { openTrades, candidates, at: '2026-07-07T09:00:00.000Z', settings, context: {} },
    { engine: SimulationEngine }
  );

  // JKPAPER candidate should be filtered out because max concurrent positions (1) is already reached
  assert.equal(intents.entryIntents.length, 0, 'Should not allow a 2nd position on JKPAPER when max concurrent is 1');
});
