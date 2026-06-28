#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SNAPSHOT_DIR = path.join(__dirname, '../../snapshots');
const SNAPSHOT_DATE = '2026-06-25';

function loadSnapshotDaySync(date, dir) {
  const candidates = [
    [path.join(dir, `snapshot-${date}.json.gz`), true],
    [path.join(dir, `simulation_snapshots_${date}.json.gz`), true],
    [path.join(dir, `simulation_snapshots_${date}.json`), false],
    [path.join(dir, `snapshot-${date}.json`), false],
  ];
  for (const [filePath, isGz] of candidates) {
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      return JSON.parse(isGz ? zlib.gunzipSync(buf).toString() : buf.toString('utf8'));
    }
  }
  throw new Error(`Snapshot not found for date ${date}`);
}

function loadSnapshots() {
  try {
    const data = loadSnapshotDaySync(SNAPSHOT_DATE, SNAPSHOT_DIR);
    return (data.snapshots || []).sort((a, b) => new Date(a.at) - new Date(b.at));
  } catch (e) {
    console.error('Failed to load snapshots:', e.message);
    return [];
  }
}

function analyzeFadeExitThresholds() {
  const snapshots = loadSnapshots();
  if (!snapshots.length) {
    console.log('No snapshots found');
    return;
  }

  console.log(`\n≡ƒôè Analyzing ${snapshots.length} snapshots for fade-exit effectiveness\n`);

  // Track trades across snapshots
  const tradeHistory = {};
  const tradeExits = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.openSimulationTrades) continue;

    snap.openSimulationTrades.forEach(trade => {
      const key = `${trade.symbol}-${trade.entryPrice}`;
      if (!tradeHistory[key]) {
        tradeHistory[key] = [];
      }
      tradeHistory[key].push({
        index: i,
        time: new Date(snap.at),
        trade,
        candidates: snap.candidates || [],
      });
    });
  }

  // Find trades that exited and analyze signal progression
  Object.keys(tradeHistory).forEach(key => {
    const history = tradeHistory[key];
    const lastIndex = history[history.length - 1].index;
    
    // Trade exited if there's a significant gap
    if (lastIndex < snapshots.length - 10) {
      const sym = history[0].trade.symbol;
      const lifespan = history.length;
      
      // Analyze signal deterioration pattern
      let consecutiveDeteriorations = [0, 0, 0]; // counts for 2-bar, 3-bar, 4-bar
      let currentStreak = 0;
      let lastWasWeak = false;

      for (let h = 0; h < history.length; h++) {
        const current = history[h];
        const candidate = current.candidates.find(c => c.symbol === sym);
        
        if (!candidate) continue;

        // Check if signal is weak (score faded, VWAP lost, etc)
        const side = current.trade.side;
        const score = Number(candidate.score) || 0;
        const signal = String(candidate.signal || '').toLowerCase();
        const minScore = side === 'sell' ? -60 : 60;
        const signalOk = side === 'sell' ? signal === 'sell' : signal === 'buy';
        const isWeak = !signalOk || Math.abs(score) < Math.abs(minScore);

        if (isWeak) {
          currentStreak++;
          if (currentStreak >= 2) consecutiveDeteriorations[0]++; // 2-bar
          if (currentStreak >= 3) consecutiveDeteriorations[1]++; // 3-bar
          if (currentStreak >= 4) consecutiveDeteriorations[2]++; // 4-bar
        } else {
          currentStreak = 0;
        }
      }

      tradeExits.push({
        symbol: sym,
        lifespan,
        deteriorations2: consecutiveDeteriorations[0],
        deteriorations3: consecutiveDeteriorations[1],
        deteriorations4: consecutiveDeteriorations[2],
        entryPrice: history[0].trade.entryPrice,
        exitPrice: history[history.length - 1].trade.exitPrice,
      });
    }
  });

  // Analyze thresholds
  console.log('Exit Threshold Analysis:');
  console.log(`Total exited trades: ${tradeExits.length}\n`);

  const stats2Bar = tradeExits.filter(t => t.deteriorations2 > 0).length;
  const stats3Bar = tradeExits.filter(t => t.deteriorations3 > 0).length;
  const stats4Bar = tradeExits.filter(t => t.deteriorations4 > 0).length;

  console.log('Trades that would trigger fade exit with:');
  console.log(`  2-bar threshold: ${stats2Bar} trades (${((stats2Bar / tradeExits.length) * 100).toFixed(1)}%)`);
  console.log(`  3-bar threshold: ${stats3Bar} trades (${((stats3Bar / tradeExits.length) * 100).toFixed(1)}%)`);
  console.log(`  4-bar threshold: ${stats4Bar} trades (${((stats4Bar / tradeExits.length) * 100).toFixed(1)}%)`);

  const prevented2to3 = stats2Bar - stats3Bar;
  const prevented3to4 = stats3Bar - stats4Bar;

  console.log(`\nTrades prevented from exiting:`);
  console.log(`  2ΓåÆ3 bars: ${prevented2to3} trades (${((prevented2to3 / stats2Bar) * 100).toFixed(1)}% reduction)`);
  console.log(`  3ΓåÆ4 bars: ${prevented3to4} trades (${((prevented3to4 / stats3Bar) * 100).toFixed(1)}% reduction)`);

  // Show distribution
  console.log('\nDetailed breakdown (sample trades):');
  tradeExits.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol} | Life: ${t.lifespan}s | 2-bar: ${t.deteriorations2} | 3-bar: ${t.deteriorations3} | 4-bar: ${t.deteriorations4}`);
  });

  console.log('\nΓ£à Recommendation:');
  if (prevented2to3 > prevented3to4 * 1.5) {
    console.log('  Use 3-bar threshold: Good filter rate without over-holding');
  } else if (prevented3to4 > prevented2to3 * 0.5) {
    console.log('  Consider 4-bar threshold: More conservative, fewer false exits');
  } else {
    console.log('  3-bar threshold is balanced');
  }
}

analyzeFadeExitThresholds();