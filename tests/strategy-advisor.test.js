import test from 'node:test';
import assert from 'node:assert/strict';
import advisor from '../server/strategy-advisor.js';

test('snapshot diagnostics summarizes setup evidence without retaining raw snapshots', () => {
  const diagnostics = advisor.snapshotDiagnostics([{
    at:'2026-07-30T05:00:00.000Z',
    candidates:[{
      symbol:'TEST',
      priceAtSnapshot:102,
      score:72,
      signal:'buy',
      derivedSetupType:'FRESH_BREAKOUT',
      indicators:{
        entryStatus:'Triggered',
        reasons:['Above VWAP', 'High relative volume'],
      },
    }],
  }], { SIMULATION_MIN_SCORE:65 });

  assert.equal(diagnostics.snapshots, 1);
  assert.equal(diagnostics.usableSnapshots, 1);
  assert.equal(diagnostics.actionableRows, 1);
  assert.equal(diagnostics.setups[0].setupType, 'FRESH_BREAKOUT');
  assert.equal(diagnostics.setups[0].uniqueSymbols, 1);
});

test('configuration evidence maps effective values, defaults, overrides, and descriptions to each setup', () => {
  const settings = {
    SIMULATION_FRESH_BREAKOUT_ENABLED:true,
    SIMULATION_FRESH_BREAKOUT_MIN_SCORE:68,
    SIMULATION_MIN_SCORE:65,
  };
  const evidence = advisor.buildConfigurationEvidence(
    settings,
    { SIMULATION_FRESH_BREAKOUT_MIN_SCORE:68 },
    { setups:[{ setupType:'FRESH_BREAKOUT', appearances:20, actionable:8 }] },
    { setups:[{ setupType:'FRESH_BREAKOUT', label:'Fresh Breakout', trades:2, netPnl:-100, winRate:0 }] }
  );
  const fresh = evidence.setups.find(row => row.setupType === 'FRESH_BREAKOUT');
  const score = fresh.configuration.find(row => row.key === 'SIMULATION_FRESH_BREAKOUT_MIN_SCORE');

  assert.equal(fresh.enabled, true);
  assert.equal(fresh.usedOnDate, true);
  assert.equal(fresh.transactionPerformance.trades, 2);
  assert.equal(fresh.snapshotActivity.appearances, 20);
  assert.equal(score.value, 68);
  assert.equal(score.defaultValue, 60);
  assert.equal(score.overridden, true);
  assert.equal(score.source, 'current-override');
  assert.ok(score.description);
  assert.equal(evidence.sharedConfiguration[0].key, 'SIMULATION_MIN_SCORE');
});
