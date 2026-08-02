const test = require('node:test');
const assert = require('node:assert/strict');

const Backtest = require('../backtest_simulation');

test('recorded entry intents align to the nearest replay snapshot', () => {
  const snapshots = [
    { at:'2026-07-24T04:25:00.000Z', candidates:[] },
    { at:'2026-07-24T04:30:00.000Z', candidates:[] },
  ];
  const cycles = new Map([[
    '2026-07-24T04:25:10.000Z',
    {
      snapshotAt:'2026-07-24T04:25:10.000Z',
      entryIntents:[{ symbol:'GRSE', side:'sell' }],
      rankedCandidates:[],
    },
  ]]);

  const aligned = Backtest.alignRecordedDecisionCycles(snapshots, cycles, 1);
  assert.equal(aligned.get(snapshots[0].at).entryIntents[0].symbol, 'GRSE');
});

test('replay-only time blocks are deterministic and do not change live settings', () => {
  const settings = { REPLAY_ENTRY_BLOCK_RANGES:[{ startMin:630, endMin:720 }] };
  assert.equal(Backtest.isReplayEntryTimeBlocked('2026-07-24T05:30:00.000Z', settings), true);
  assert.equal(Backtest.isReplayEntryTimeBlocked('2026-07-24T04:30:00.000Z', settings), false);
});

test('frozen strategy settings fail closed if defaults drift', () => {
  const frozen = require('../strategy_versions/frozen-2026-07-25');
  const settings = frozen.loadFrozenSettings();
  assert.equal(settings.PORTFOLIO_CAPITAL_SOURCE, frozen.STRATEGY_ID);
  assert.equal(settings.SIMULATION_OVERRIDE_STOP_GUARD, true);
  assert.equal(settings.SIMULATION_DAILY_MAX_TRADES, 20);
  assert.equal(settings.SIMULATION_BULL_FLAG_CONTINUATION_ENABLED, false);
  assert.equal(settings.SIMULATION_GAP_AND_GO_ENABLED, false);
  assert.equal(settings.SIMULATION_MOMENTUM_CATALYST_ENABLED, false);
});
