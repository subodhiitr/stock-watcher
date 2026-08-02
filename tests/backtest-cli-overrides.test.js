const test = require('node:test');
const assert = require('node:assert/strict');

const Backtest = require('../backtest_simulation.js');

test('backtest command settings accept snake_case min_score override', () => {
  const args = Backtest.parseArgs(['--min_score', '61']);
  assert.equal(args.minScore, 61);

  const settings = Backtest.loadSettings(args);
  assert.equal(settings.SIMULATION_MIN_SCORE, 61);

  const result = Backtest.runBacktest([], settings);
  assert.equal(result.settings.minScore, 61);
});
