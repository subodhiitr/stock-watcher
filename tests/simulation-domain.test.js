const test = require('node:test');
const assert = require('node:assert/strict');

const { runSimulationDomainCycle } = require('../server/simulation-domain');

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
