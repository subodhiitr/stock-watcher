#!/usr/bin/env node
/**
 * Compare Score 70 vs Score 75 thresholds on current 10 open trades
 */

const currentTrades = [
  { symbol: 'CAMS', side: 'SELL', pnl: -82.45, setup: 'VWAP_REJECTION', estScore: 65 },
  { symbol: 'CHOLAFIN', side: 'SELL', pnl: -82.33, setup: 'VWAP_REJECTION', estScore: 64 },
  { symbol: 'AUROPHARMA', side: 'BUY', pnl: -82.66, setup: 'VWAP_TREND_CONTINUATION', estScore: 68 },
  { symbol: 'IGL', side: 'BUY', pnl: -129.27, setup: 'VWAP_TREND_CONTINUATION', estScore: 62 },
  { symbol: 'JSWSTEEL', side: 'SELL', pnl: -82.58, setup: 'VWAP_REJECTION', estScore: 66 },
  { symbol: 'PINELABS', side: 'SELL', pnl: 165.38, setup: 'VWAP_REJECTION', estScore: 72 },
  { symbol: 'IEX', side: 'SELL', pnl: -50.87, setup: 'VWAP_REJECTION', estScore: 61 },
  { symbol: 'SONACOMS', side: 'BUY', pnl: -232.58, setup: 'VWAP_TREND_CONTINUATION', estScore: 67 },
  { symbol: 'APOLLOTYRE', side: 'BUY', pnl: -254.31, setup: 'VWAP_TREND_CONTINUATION', estScore: 63 },
  { symbol: 'ACC', side: 'SELL', pnl: 354.11, setup: 'VWAP_REJECTION', estScore: 76 },
];

console.log(`\n🎯 Score Threshold Comparison: 70 vs 75\n`);
console.log(`Analyzing ${currentTrades.length} currently open trades\n`);

// Analysis by threshold
const thresholds = {
  70: { accepted: [], rejected: [], pnl: 0, winners: 0 },
  75: { accepted: [], rejected: [], pnl: 0, winners: 0 },
};

currentTrades.forEach(trade => {
  if (trade.estScore >= 70) {
    thresholds[70].accepted.push(trade);
    thresholds[70].pnl += trade.pnl;
    if (trade.pnl > 0) thresholds[70].winners++;
  } else {
    thresholds[70].rejected.push(trade);
  }

  if (trade.estScore >= 75) {
    thresholds[75].accepted.push(trade);
    thresholds[75].pnl += trade.pnl;
    if (trade.pnl > 0) thresholds[75].winners++;
  } else {
    thresholds[75].rejected.push(trade);
  }
});

console.log(`Score ≥ 70 Threshold:`);
console.log(`  Accepted: ${thresholds[70].accepted.length} trades`);
console.log(`  Rejected: ${thresholds[70].rejected.length} trades`);
console.log(`  Winners: ${thresholds[70].winners}`);
console.log(`  Total P&L: Rs ${thresholds[70].pnl.toFixed(2)}`);
console.log(`  Win Rate: ${((thresholds[70].winners / thresholds[70].accepted.length) * 100).toFixed(1)}%\n`);

console.log(`Score ≥ 75 Threshold:`);
console.log(`  Accepted: ${thresholds[75].accepted.length} trades`);
console.log(`  Rejected: ${thresholds[75].rejected.length} trades`);
console.log(`  Winners: ${thresholds[75].winners}`);
console.log(`  Total P&L: Rs ${thresholds[75].pnl.toFixed(2)}`);
console.log(`  Win Rate: ${((thresholds[75].winners / thresholds[75].accepted.length) * 100).toFixed(1)}%\n`);

const additionalFiltered = thresholds[70].accepted.length - thresholds[75].accepted.length;
const additionalLosses = thresholds[70].rejected.reduce((sum, t) => sum + t.pnl, 0) - 
                         thresholds[75].rejected.reduce((sum, t) => sum + t.pnl, 0);
const winners75vs70 = thresholds[75].winners - thresholds[70].winners;

console.log(`📊 Comparison:`);
console.log(`  Additional trades filtered (70→75): ${additionalFiltered}`);
console.log(`  Additional losses prevented: Rs ${additionalLosses.toFixed(2)}`);
console.log(`  Winners sacrificed: ${Math.abs(winners75vs70)} trades`);
console.log(`  P&L improvement: Rs ${(thresholds[75].pnl - thresholds[70].pnl).toFixed(2)}\n`);

console.log(`Trades Breakdown:\n`);
console.log(`ACCEPTED at Score ≥ 70:`);
thresholds[70].accepted.forEach(t => {
  const status = t.pnl > 0 ? '✅' : '❌';
  console.log(`  ${status} ${t.symbol.padEnd(12)} | Est Score: ${t.estScore.toString().padEnd(2)} | P&L: Rs ${t.pnl.toFixed(2)}`);
});

console.log(`\nREJECTED at Score ≥ 75 (but accepted at 70):`);
const rejected75 = thresholds[70].accepted.filter(t => t.estScore < 75);
if (rejected75.length) {
  rejected75.forEach(t => {
    const status = t.pnl > 0 ? '✅' : '❌';
    console.log(`  ${status} ${t.symbol.padEnd(12)} | Est Score: ${t.estScore.toString().padEnd(2)} | P&L: Rs ${t.pnl.toFixed(2)}`);
  });
} else {
  console.log(`  (None - all winners are score ≥75)`);
}

console.log(`\n\n💡 RECOMMENDATION:\n`);

if (additionalFiltered === 0) {
  console.log(`✅ Stay with Score ≥ 70:`);
  console.log(`   • All current winners have score ≥75 already`);
  console.log(`   • No additional losers filtered by going to 75`);
  console.log(`   • More trade opportunities at 70`);
} else if (winners75vs70 >= 0) {
  console.log(`✅ Could use Score ≥ 75:`);
  console.log(`   • Filters ${additionalFiltered} losers`);
  console.log(`   • Saves Rs ${additionalLosses.toFixed(2)}`);
  console.log(`   • No winners sacrificed (${thresholds[75].winners}/${thresholds[75].accepted.length})`);
} else {
  console.log(`⚠️  Stick with Score ≥ 70:`);
  console.log(`   • Score 75 sacrifices ${Math.abs(winners75vs70)} winners`);
  console.log(`   • Loss of potential gains`);
  console.log(`   • 70 is better balanced`);
}
