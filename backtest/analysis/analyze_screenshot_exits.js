#!/usr/bin/env node
/**
 * Analyze recent exits from screenshot data
 * Check if signal deterioration exits are following 3-bar threshold
 */

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

// Trades from screenshot (visible exits)
const screenshotTrades = [
  { symbol: 'JSWSTEEL', entry: 1231, live: 1231.2, exitReason: 'Simulation signal deterioration', pnl: -98.78 },
  { symbol: 'PAGEIND', entry: 171.32, live: 170.23, exitReason: 'Simulation confirmed stop', pnl: -717.93 },
  { symbol: 'GRASIM', entry: 1561.5, live: 1552.7, exitReason: 'Simulation confirmed stop', pnl: -645.7 },
  { symbol: 'SWIGGY', entry: 429.9, live: 430.45, exitReason: 'Simulation signal deterioration', pnl: 44.98 },
  { symbol: 'TMCV', entry: 435.8, live: 433.5, exitReason: 'Simulation confirmed stop', pnl: -609.16 },
  { symbol: 'INDHOTEL', entry: 942.2, live: 942.05, exitReason: 'Simulation signal deterioration', pnl: -66.74 },
  { symbol: 'PVRINOX', entry: 630.15, live: 625, exitReason: 'Simulation confirmed stop', pnl: -895.99 },
  { symbol: 'WHIRLPOOL', entry: 633.25, live: 629.9, exitReason: 'Simulation confirmed stop', pnl: -608.27 },
  { symbol: 'CAMS', entry: 724.95, live: 724.5, exitReason: 'Simulation signal deterioration', pnl: -20.79 },
  { symbol: 'CHOLAFIN', entry: 3581.3, live: 3583, exitReason: 'Simulation signal deterioration', pnl: -35.62 },
  { symbol: 'PINELABS', entry: 989, live: 991.05, exitReason: 'Simulation time stop cost guard', pnl: -289.71 },
  { symbol: 'IEX', entry: 3353.6, live: 3355.15, exitReason: 'Simulation confirmed stop', pnl: -519.71 },
];

function analyzeExitCompliance() {
  const snapshots = loadSnapshots();
  if (!snapshots.length) {
    console.log('No snapshots found');
    return;
  }

  console.log(`\n≡ƒôè RECENT EXIT ANALYSIS (From Screenshot)`);
  console.log(`Last snapshot: ${snapshots[snapshots.length - 1].at}\n`);

  // Separate by exit type
  const fadeExits = screenshotTrades.filter(t => t.exitReason.includes('deterioration'));
  const stopExits = screenshotTrades.filter(t => t.exitReason.includes('confirmed stop'));
  const otherExits = screenshotTrades.filter(t => !t.exitReason.includes('deterioration') && !t.exitReason.includes('confirmed stop'));

  console.log(`RESULTS:`);
  console.log(`  Signal Deterioration exits: ${fadeExits.length}`);
  console.log(`  Confirmed Stop exits: ${stopExits.length}`);
  console.log(`  Other exits: ${otherExits.length}\n`);

  // ============================================
  // KEY METRICS
  // ============================================
  console.log(`≡ƒôê COMPARING WITH PREVIOUS SESSIONS:\n`);

  console.log(`Signal Deterioration (FADE) Exits:`);
  fadeExits.forEach(t => {
    const pnlStr = t.pnl >= 0 ? `Γ£à +${t.pnl}` : `Γ¥î ${t.pnl}`;
    console.log(`  ${t.symbol.padEnd(12)} | ${pnlStr.padEnd(12)} (Entry: ${t.entry}, Live: ${t.live})`);
  });

  const fadeAvgPnL = fadeExits.reduce((s, t) => s + t.pnl, 0) / fadeExits.length;
  const fadeWinRate = fadeExits.filter(t => t.pnl >= 0).length / fadeExits.length * 100;

  console.log(`\n  Average PnL: ${fadeAvgPnL.toFixed(2)} Rs`);
  console.log(`  Win Rate: ${fadeWinRate.toFixed(1)}%`);

  console.log(`\n---`);
  console.log(`\nConfirmed Stop Exits:`);
  stopExits.forEach(t => {
    const pnlStr = t.pnl >= 0 ? `Γ£à +${t.pnl}` : `Γ¥î ${t.pnl}`;
    console.log(`  ${t.symbol.padEnd(12)} | ${pnlStr.padEnd(12)} (Entry: ${t.entry}, Live: ${t.live})`);
  });

  const stopAvgPnL = stopExits.reduce((s, t) => s + t.pnl, 0) / stopExits.length;
  const stopWinRate = stopExits.filter(t => t.pnl >= 0).length / stopExits.length * 100;

  console.log(`\n  Average PnL: ${stopAvgPnL.toFixed(2)} Rs`);
  console.log(`  Win Rate: ${stopWinRate.toFixed(1)}%`);

  // ============================================
  // ANALYSIS & VERIFICATION
  // ============================================
  console.log(`\n\n≡ƒöì VERIFICATION: Is 3-Bar Rule Being Applied?\n`);

  console.log(`Expected Behavior (with score ΓëÑ70 + 3-bar fade threshold):`);
  console.log(`  Γ£ô Fewer signal deterioration exits (should be quick, high-quality exits)`);
  console.log(`  Γ£ô Higher win rate on fades (targeting only score ΓëÑ70 entries)`);
  console.log(`  Γ£ô Fewer confirmed stops (weak score 60-70 entries are now filtered)\n`);

  console.log(`What We See:`);
  console.log(`  ΓÇó Signal deterioration exits: ${fadeExits.length}/12 (${(fadeExits.length/12*100).toFixed(0)}%)`);
  console.log(`  ΓÇó Fade average PnL: ${fadeAvgPnL.toFixed(2)} Rs`);
  console.log(`  ΓÇó Fade win rate: ${fadeWinRate.toFixed(1)}%`);
  console.log(`  ΓÇó Confirmed stops: ${stopExits.length}/12 (${(stopExits.length/12*100).toFixed(0)}%)`);
  console.log(`  ΓÇó Stop average PnL: ${stopAvgPnL.toFixed(2)} Rs\n`);

  // ============================================
  // INTERPRETATION
  // ============================================
  console.log(`≡ƒôï INTERPRETATION:\n`);

  const totalPnL = screenshotTrades.reduce((s, t) => s + t.pnl, 0);
  const avgPnL = totalPnL / screenshotTrades.length;

  if (fadeWinRate > 50 && stopAvgPnL < -500) {
    console.log(`Γ£à Settings are WORKING:`);
    console.log(`   ΓÇó 3-bar threshold is filtering noise (high fade win rate)`);
    console.log(`   ΓÇó Score ΓëÑ70 is preventing weak entries (stops are fewer but deep)`);
  } else if (fadeWinRate < 30 && stopAvgPnL > -300) {
    console.log(`ΓÜá∩╕Å  Settings may NOT be applied yet:`);
    console.log(`   ΓÇó Old data still showing (high stop count, low fade win rate)`);
    console.log(`   ΓÇó Wait 5-10 more minutes for new cycle with applied settings`);
  } else {
    console.log(`≡ƒöä Mixed signals - transition phase:`);
    console.log(`   ΓÇó Some trades using old settings, some using new`);
    console.log(`   ΓÇó Give it another cycle to stabilize`);
  }

  console.log(`\nTotal PnL (all 12 trades): ${totalPnL.toFixed(2)} Rs (${(totalPnL > 0 ? '+' : '')}${(totalPnL/12).toFixed(2)} per trade)`);

  console.log(`\n` + '='.repeat(70));
  console.log(`Next steps:`);
  console.log(`1. Wait 10 more minutes for next batch of exits`);
  console.log(`2. Check if confirmed stops DECREASE (vs screenshot baseline)`);
  console.log(`3. Verify fade exits have ΓëÑ3 bars of weakness before exiting`);
}

analyzeExitCompliance();