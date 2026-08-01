const test = require('node:test');
const assert = require('node:assert/strict');

const Backtest = require('../backtest_simulation.js');

test('historical snapshot settings and capital override current replay state', () => {
  const snapshots = [{
    at:'2026-07-31T03:45:00.000Z',
    caps:{ SIMULATION_MIN_SCORE:47, SIMULATION_MAX_OPEN:3 },
    portfolio:{ capital:750000, cashAvailable:620000, equity:755000, openExposure:135000 },
  }];
  const settings = Backtest.loadSettings({ snapshots });

  assert.equal(settings.SIMULATION_MIN_SCORE, 47);
  assert.equal(settings.SIMULATION_MAX_OPEN, 3);
  assert.equal(settings.PORTFOLIO_INITIAL_CAPITAL, 750000);
  assert.equal(settings.PORTFOLIO_AVAILABLE_CASH, 620000);
  assert.equal(settings.REPLAY_SETTINGS_SOURCE, 'historical-snapshot');
  assert.equal(settings.PORTFOLIO_CAPITAL_SOURCE, 'historical-snapshot');
});

test('snapshot-keyed recorded decisions require an exact snapshot timestamp', () => {
  const at = '2026-07-31T04:00:00.000Z';
  const exact = Backtest.loadRecordedDecisionCyclesFromSnapshots([{
    at,
    decisionCycle:{ snapshotAt:at, entryIntents:[{ symbol:'TCS' }], rankedCandidates:[] },
  }]);
  const inexact = Backtest.loadRecordedDecisionCyclesFromSnapshots([{
    at,
    decisionCycle:{ snapshotAt:'2026-07-31T04:00:30.000Z', entryIntents:[{ symbol:'TCS' }], rankedCandidates:[] },
  }]);

  assert.equal(exact.get(at).entryIntents[0].symbol, 'TCS');
  assert.equal(inexact.size, 0);
});

test('replay reliability only labels complete, low-gap historical data reliable', () => {
  const start = Date.parse('2026-07-31T03:45:00.000Z');
  const snapshots = Array.from({ length:188 }, (_, index) => ({
    at:new Date(start + index * 2 * 60000).toISOString(),
    caps:{ SIMULATION_MIN_SCORE:65 },
    portfolio:{ capital:500000, cashAvailable:500000, equity:500000, openExposure:0 },
  }));
  const complete = Backtest.assessReplayReliability(snapshots, {});
  const incomplete = Backtest.assessReplayReliability(snapshots.slice(0, 30), {});

  assert.equal(complete.status, 'reliable');
  assert.equal(complete.maxGapMin, 2);
  assert.equal(incomplete.status, 'unreliable');
  assert.match(incomplete.issues.join(' '), /only 30 market-hour snapshots/);
});
