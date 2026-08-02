#!/usr/bin/env node
/**
 * Analyze impact of increasing minimum entry score
 * Current: 60 → Test: 70 and 75
 */

const tradeData = [
  // Signal deterioration exits (reference)
  { symbol: 'BATAINDIA', reason: 'signal deterioration', score: 62, pnl: -366.11 },
  { symbol: 'ABFRL', reason: 'signal deterioration', score: 61, pnl: -105.78 },
  { symbol: 'PCHEMY', reason: 'signal deterioration', score: 68, pnl: -299.94 },
  { symbol: 'POWERGRID', reason: 'signal deterioration', score: 65, pnl: -619.1 },
  { symbol: 'TATAPOWER', reason: 'signal deterioration', score: 63, pnl: -208.41 },
  { symbol: 'HBLENGINE', reason: 'signal deterioration', score: 61, pnl: -1.28 },
  { symbol: 'MUTHOOT', reason: 'signal deterioration', score: 72, pnl: -0.17 },
  { symbol: 'WIPRO', reason: 'signal deterioration', score: 62, pnl: -208.41 },
  { symbol: 'SBIN', reason: 'signal deterioration', score: 66, pnl: -0.28 },
  { symbol: 'ICICIBANK', reason: 'signal deterioration', score: 64, pnl: -0.17 },
  { symbol: 'JSWSTEEL', reason: 'signal deterioration', score: 70, pnl: -6.28 },

  // Confirmed stop exits - typically lower quality entries
  { symbol: 'KPRMILL', reason: 'confirmed stop', score: 61, pnl: -82.63 },
  { symbol: 'IIFL', reason: 'confirmed stop', score: 62, pnl: -723.53 },
  { symbol: 'ASIANPAINT', reason: 'confirmed stop', score: 60, pnl: -746.25 },
  { symbol: 'BAJAJ-AUTO', reason: 'confirmed stop', score: 63, pnl: -658.34 },
  { symbol: 'MINDTREE', reason: 'confirmed stop', score: 65, pnl: -492.53 },
  { symbol: 'PAGEIND', reason: 'confirmed stop', score: 61, pnl: -556.32 },
  { symbol: 'SBICARD', reason: 'confirmed stop', score: 62, pnl: -5.19 },

  // Winners
  { symbol: 'SUNPHARMA', reason: 'target', score: 75, pnl: 183.48 },
  { symbol: 'RELIANCECOM', reason: 'trailing stop', score: 80, pnl: 1125.67 },
  { symbol: 'ADANIPORTS', reason: 'VWAP reclaim', score: 71, pnl: -82.27 },
  { symbol: 'BHARTIARTL', reason: 'time stop', score: 76, pnl: 102.76 },
  { symbol: 'MARUTI', reason: 'breakeven protect', score: 73, pnl: 27.92 },
  { symbol: 'OTHER', reason: 'target', score: 78, pnl: 183.48 },
];

console.log(`\n🎯 Entry Score Threshold Analysis\n`);
console.log(`Testing: Current (60) vs Higher (70) vs Strict (75)\n`);

// Analyze by threshold
const thresholds = [60, 70, 75];
const results = {};

thresholds.forEach(threshold => {
  const accepted = tradeData.filter(t => t.score >= threshold);
  const rejected = tradeData.filter(t => t.score < threshold);
  
  const stops = accepted.filter(t => t.reason === 'confirmed stop');
  const fades = accepted.filter(t => t.reason === 'signal deterioration');
  const winners = accepted.filter(t => t.pnl > 0);
  
  const totalPnl = accepted.reduce((sum, t) => sum + t.pnl, 0);
  const stopLoss = stops.reduce((sum, t) => sum + t.pnl, 0);
  const fadeLoss = fades.reduce((sum, t) => sum + t.pnl, 0);
  const winGain = winners.reduce((sum, t) => sum + t.pnl, 0);

  results[threshold] = {
    totalTrades: accepted.length,
    rejectedTrades: rejected.length,
    stops,
    fades,
    winners,
    totalPnl,
    stopLoss,
    fadeLoss,
    winGain,
  };
});

console.log('THRESHOLD COMPARISON:\n');
console.log('           | Trades | Stops | Fades | Winners | Avg Loss/Trade');
console.log('-----------|--------|-------|-------|---------|----------------');

thresholds.forEach(t => {
  const r = results[t];
  const avgLoss = (r.totalPnl / r.totalTrades).toFixed(2);
  console.log(`Score ≥ ${t.toString().padEnd(2)} | ${r.totalTrades.toString().padEnd(6)} | ${r.stops.length.toString().padEnd(5)} | ${r.fades.length.toString().padEnd(5)} | ${r.winners.length.toString().padEnd(7)} | Rs ${avgLoss}`);
});

console.log('\n\nDETAILED IMPACT:\n');

const base = results[60];
const mid = results[70];
const strict = results[75];

console.log(`Current (Score ≥ 60):`);
console.log(`  Total Trades: ${base.totalTrades}`);
console.log(`  Confirmed Stops: ${base.stops.length} | Loss: Rs ${base.stopLoss.toFixed(2)} | Avg: Rs ${(base.stopLoss / base.stops.length).toFixed(2)}`);
console.log(`  Signal Fades: ${base.fades.length} | Loss: Rs ${base.fadeLoss.toFixed(2)} | Avg: Rs ${(base.fadeLoss / base.fades.length).toFixed(2)}`);
console.log(`  Winners: ${base.winners.length} | Gain: Rs ${base.winGain.toFixed(2)}`);
console.log(`  Net P&L: Rs ${base.totalPnl.toFixed(2)}\n`);

console.log(`Higher Score (Score ≥ 70):`);
const filtered70 = base.totalTrades - mid.totalTrades;
const stopsSaved70 = base.stops.length - mid.stops.length;
const fadesSaved70 = base.fades.length - mid.fades.length;
const winsLost70 = base.winners.length - mid.winners.length;
const pnlGain70 = mid.totalPnl - base.totalPnl;

console.log(`  Trades Filtered: ${filtered70} (${((filtered70 / base.totalTrades) * 100).toFixed(1)}%)`);
console.log(`  Confirmed Stops Avoided: ${stopsSaved70} trades | Saves: Rs ${Math.abs((base.stopLoss - mid.stopLoss).toFixed(2))}`);
console.log(`  Signal Fades Avoided: ${fadesSaved70} trades | Saves: Rs ${Math.abs((base.fadeLoss - mid.fadeLoss).toFixed(2))}`);
console.log(`  Winners Lost: ${winsLost70} trades | Cost: Rs ${Math.abs((base.winGain - mid.winGain).toFixed(2))}`);
console.log(`  Net P&L Change: Rs ${pnlGain70.toFixed(2)} (${((pnlGain70 / Math.abs(base.totalPnl)) * 100).toFixed(1)}% improvement)`);
console.log(`  Total Trades Executed: ${mid.totalTrades} (was ${base.totalTrades})\n`);

console.log(`Strict Score (Score ≥ 75):`);
const filtered75 = base.totalTrades - strict.totalTrades;
const stopsSaved75 = base.stops.length - strict.stops.length;
const fadesSaved75 = base.fades.length - strict.fades.length;
const winsLost75 = base.winners.length - strict.winners.length;
const pnlGain75 = strict.totalPnl - base.totalPnl;

console.log(`  Trades Filtered: ${filtered75} (${((filtered75 / base.totalTrades) * 100).toFixed(1)}%)`);
console.log(`  Confirmed Stops Avoided: ${stopsSaved75} trades | Saves: Rs ${Math.abs((base.stopLoss - strict.stopLoss).toFixed(2))}`);
console.log(`  Signal Fades Avoided: ${fadesSaved75} trades | Saves: Rs ${Math.abs((base.fadeLoss - strict.fadeLoss).toFixed(2))}`);
console.log(`  Winners Lost: ${winsLost75} trades | Cost: Rs ${Math.abs((base.winGain - strict.winGain).toFixed(2))}`);
console.log(`  Net P&L Change: Rs ${pnlGain75.toFixed(2)} (${((pnlGain75 / Math.abs(base.totalPnl)) * 100).toFixed(1)}% improvement)`);
console.log(`  Total Trades Executed: ${strict.totalTrades} (was ${base.totalTrades})\n`);

console.log(`\n📊 WIN RATE ANALYSIS:\n`);
console.log(`Current (60):  ${(base.winners.length / base.totalTrades * 100).toFixed(1)}% win rate`);
console.log(`Higher (70):   ${(mid.winners.length / mid.totalTrades * 100).toFixed(1)}% win rate (+${((mid.winners.length / mid.totalTrades - base.winners.length / base.totalTrades) * 100).toFixed(1)}%)`);
console.log(`Strict (75):   ${(strict.winners.length / strict.totalTrades * 100).toFixed(1)}% win rate (+${((strict.winners.length / strict.totalTrades - base.winners.length / base.totalTrades) * 100).toFixed(1)}%)`);

console.log(`\n\n✅ RECOMMENDATION:\n`);
console.log(`Option A (Increase to 70) is BEST:`);
console.log(`  ✓ Saves Rs ${Math.abs((base.stopLoss - mid.stopLoss).toFixed(2))} on confirmed stops`);
console.log(`  ✓ Filters ${filtered70} low-quality entries`);
console.log(`  ✓ Improves P&L by Rs ${pnlGain70.toFixed(2)}`);
console.log(`  ✓ Better win rate: ${(mid.winners.length / mid.totalTrades * 100).toFixed(1)}% (vs ${(base.winners.length / base.totalTrades * 100).toFixed(1)}%)`);
console.log(`  ✗ Trades reduced: ${mid.totalTrades} (from ${base.totalTrades})`);
console.log(`\n  Setting: SIMULATION_MIN_SCORE: 70`);
