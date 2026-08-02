const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SimulationEngine = require('../simulation_engine');

test('management snapshot preserves indicators needed after an open symbol leaves candidate ranking', () => {
  const candidate = {
    symbol:'JIOFIN',
    side:'buy',
    signal:'buy',
    score:22,
    sector:'Finance',
    price:237.27,
    derivedSetupType:'MOMENTUM_RUNNER',
    sectorPriority:{ aligned:false, sectorAvg:0.2, sectorRank:7, sectorCount:20, breadthPct:45, rs:-0.3 },
    candles:[
      { time:'2026-07-28T06:20:00.000Z', open:237.9, high:238, low:237.5, close:237.6, volume:1000 },
      { time:'2026-07-28T06:25:00.000Z', open:237.6, high:237.7, low:237.2, close:237.27, volume:1200 },
    ],
    indicators:{
      vwap:237.7,
      ema9:237.4,
      ema20:237.8,
      superTrendDirection:'bearish',
      entryStatus:'Invalidated',
      ohlc:{ latestBar:{ time:'2026-07-28T06:25:00.000Z', close:237.27 } },
    },
  };
  const snapshot = SimulationEngine.buildManagementCandidateSnapshot(candidate);
  assert.equal(snapshot.score, 22);
  assert.equal(snapshot.indicators.vwap, 237.7);
  assert.equal(snapshot.indicators.ema9, 237.4);
  assert.equal(snapshot.indicators.ema20, 237.8);
  assert.equal(snapshot.indicators.superTrendDirection, 'bearish');
  assert.equal(snapshot.sectorPriority.sectorRank, 7);
  assert.equal(snapshot.candles.length, 2);
  assert.equal(SimulationEngine.isSimulationSignalDeteriorated(
    { side:'buy' },
    snapshot,
    snapshot.price
  ), true);
});

test('server, dashboard and replay share the open-position management snapshot contract', () => {
  const root = path.join(__dirname, '..');
  const ticker = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
  const replay = fs.readFileSync(path.join(root, 'backtest_simulation.js'), 'utf8');
  assert.match(ticker, /managementCandidate:SimulationEngine\.buildManagementCandidateSnapshot/);
  assert.match(ticker, /trade\.managementCandidate = managementCandidate/);
  assert.match(dashboard, /managementCandidate:SimulationEngine\.buildManagementCandidateSnapshot/);
  assert.match(replay, /open\.managementCandidate/);
  assert.match(replay, /storedIndicators/);
});
