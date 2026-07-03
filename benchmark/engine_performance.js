const SimulationEngine = require('../simulation_engine');
const { performance } = require('perf_hooks');

console.log('\nFee Memoization Benchmark\n');

// Test 1: First call (cache miss)
const start1 = performance.now();
const result1 = SimulationEngine.getPaperTradePnl(
  { entryPrice: 100, qty: 10, side: 'buy' },
  105
);
const time1 = performance.now() - start1;

// Test 2: Identical calls (cache hits)
SimulationEngine.clearFeeCache?.();
const start2 = performance.now();
for (let i = 0; i < 1000; i++) {
  SimulationEngine.getPaperTradePnl(
    { entryPrice: 100, qty: 10, side: 'buy' },
    105
  );
}
const time2 = performance.now() - start2;

console.log(`1000 identical calls:`);
console.log(`  First call (cold): ${time1.toFixed(2)}ms`);
console.log(`  1000 calls (hot): ${time2.toFixed(2)}ms`);
console.log(`  Per-call avg: ${(time2/1000).toFixed(4)}ms`);
console.log(`  Speedup: ${(time1 / (time2/1000)).toFixed(1)}x faster with memoization\n`);
