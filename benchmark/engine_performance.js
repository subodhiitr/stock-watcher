#!/usr/bin/env node
'use strict';

const SimulationEngine = require('../simulation_engine');
const backtest = require('../backtest_simulation');
const db = require('better-sqlite3')('./stock-watcher.db');
const { performance } = require('perf_hooks');

// Helper function to generate synthetic snapshots for testing
function generateSyntheticSnapshots(days = 10, snapshotsPerDay = 8) {
  const snapshots = [];
  const symbols = ['RELIANCE', 'INFY', 'TCS', 'WIPRO', 'HCLTECH'];
  const baseTime = new Date();
  baseTime.setDate(baseTime.getDate() - days);

  for (let d = 0; d < days; d++) {
    const dayTime = new Date(baseTime);
    dayTime.setDate(dayTime.getDate() + d);
    
    // Skip weekends
    if (dayTime.getDay() === 0 || dayTime.getDay() === 6) continue;

    for (let s = 0; s < snapshotsPerDay; s++) {
      const minOffset = 570 + (s * 30); // 9:30 AM + 30 min intervals
      dayTime.setHours(Math.floor(minOffset / 60) + 5, minOffset % 60); // IST = UTC+5:30

      const candidates = symbols.map(symbol => ({
        symbol,
        price: 100 + Math.random() * 100,
        priceAtSnapshot: 100 + Math.random() * 100,
        volume: Math.floor(Math.random() * 1000000),
        indicators: {
          price: 100 + Math.random() * 100,
          vwap: 100 + Math.random() * 100,
        },
        score: Math.floor(Math.random() * 100 - 50),
        setupType: ['VOLUME_SHOCK_BREAKOUT', 'FRESH_BREAKOUT', 'VWAP_PULLBACK_OR_HOLD'][Math.floor(Math.random() * 3)],
        quote: {
          price: 100 + Math.random() * 100,
        },
      }));

      snapshots.push({
        at: dayTime.toISOString(),
        candidates,
      });
    }
  }

  return snapshots;
}

console.log('\n=== SIMULATION ENGINE PERFORMANCE BENCHMARK ===\n');

// Generate test data (simulate 10-day backtest)
const snapshots = generateSyntheticSnapshots(10, 8);
console.log(`Data: ${snapshots.length} snapshots over 10 days\n`);

// Load trade settings from database
let pass2Config = {};
try {
  const row = db.prepare("SELECT value FROM kv_store WHERE key = 'trade_settings'").get();
  if (row?.value) {
    const settings = JSON.parse(row.value);
    pass2Config = settings.overrides || {};
  }
} catch (e) {
  console.warn('Warning: Could not load Pass2 config from database:', e.message);
}

// Baseline config (DEFAULTS)
console.log('--- BASELINE CONFIG ---');
const startBaseline = performance.now();
const resultBaseline = backtest.runBacktest(snapshots, {});
const endBaseline = performance.now();

const baselineTime = endBaseline - startBaseline;
console.log(`Execution Time: ${baselineTime.toFixed(0)}ms`);
console.log(`Trades: ${resultBaseline.trades.length}`);

const baselineWinRate = resultBaseline.trades.filter(t => t.status === 'closed' && Number(t.pnl) > 0).length /
  (resultBaseline.trades.filter(t => t.status === 'closed').length || 1) * 100;
console.log(`Win Rate: ${baselineWinRate.toFixed(1)}%`);

if (resultBaseline.trades.length > 0) {
  const closedTrades = resultBaseline.trades.filter(t => t.status === 'closed');
  if (closedTrades.length > 0) {
    const avgPerTrade = closedTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0) / closedTrades.length;
    console.log(`Avg P/L per trade: ₹${avgPerTrade.toFixed(0)}`);
  }
}

// Pass2 config
console.log('\n--- PASS2 CONFIG ---');
const startPass2 = performance.now();
const resultPass2 = backtest.runBacktest(snapshots, pass2Config);
const endPass2 = performance.now();

const pass2Time = endPass2 - startPass2;
console.log(`Execution Time: ${pass2Time.toFixed(0)}ms`);
console.log(`Trades: ${resultPass2.trades.length}`);

const pass2WinRate = resultPass2.trades.filter(t => t.status === 'closed' && Number(t.pnl) > 0).length /
  (resultPass2.trades.filter(t => t.status === 'closed').length || 1) * 100;
console.log(`Win Rate: ${pass2WinRate.toFixed(1)}%`);

if (resultPass2.trades.length > 0) {
  const closedTrades = resultPass2.trades.filter(t => t.status === 'closed');
  if (closedTrades.length > 0) {
    const avgPerTrade = closedTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0) / closedTrades.length;
    console.log(`Avg P/L per trade: ₹${avgPerTrade.toFixed(0)}`);
  }
}

// Performance summary
const improvement = ((baselineTime - pass2Time) / baselineTime * 100).toFixed(1);

console.log('\n=== PERFORMANCE SUMMARY ===');
console.log(`Baseline:  ${baselineTime.toFixed(0)}ms`);
console.log(`Pass2:     ${pass2Time.toFixed(0)}ms`);
console.log(`Improvement: ${improvement}% ${pass2Time < baselineTime ? 'faster' : 'slower'}`);

// Memory check (approximate)
const baselineMemory = JSON.stringify(resultBaseline).length;
const pass2Memory = JSON.stringify(resultPass2).length;
console.log(`\nMemory footprint:`);
console.log(`Baseline: ${(baselineMemory / 1024 / 1024).toFixed(2)}MB`);
console.log(`Pass2: ${(pass2Memory / 1024 / 1024).toFixed(2)}MB`);

// Fee memoization benchmark
console.log('\n=== FEE CALCULATION OPTIMIZATION ===');
SimulationEngine.clearFeeCache?.();

const startFeeCache = performance.now();
for (let i = 0; i < 1000; i++) {
  SimulationEngine.getPaperTradePnl(
    { entryPrice: 100, qty: 10, side: 'buy' },
    105
  );
}
const endFeeCache = performance.now();

const avgFeeTime = (endFeeCache - startFeeCache) / 1000;
console.log(`1000 identical fee calls: ${avgFeeTime.toFixed(4)}ms per call`);
console.log(`(Expected: 0.01-0.1ms with memoization)`);

// Test varying parameters to measure speedup
SimulationEngine.clearFeeCache?.();
let nonCachedTime = 0;
for (let i = 0; i < 100; i++) {
  const s = performance.now();
  SimulationEngine.getPaperTradePnl(
    { entryPrice: 100 + i, qty: 10 + i, side: 'buy' },
    105 + i
  );
  nonCachedTime += performance.now() - s;
}

SimulationEngine.clearFeeCache?.();
SimulationEngine.getPaperTradePnl({ entryPrice: 100, qty: 10, side: 'buy' }, 105);
let cachedTime = 0;
for (let i = 0; i < 100; i++) {
  const s = performance.now();
  SimulationEngine.getPaperTradePnl(
    { entryPrice: 100, qty: 10, side: 'buy' },
    105
  );
  cachedTime += performance.now() - s;
}

const speedup = (nonCachedTime / cachedTime).toFixed(1);
console.log(`Speedup on cache hits: ${speedup}x`);

console.log('\n✅ Benchmark complete\n');

db.close();
