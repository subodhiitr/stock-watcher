#!/usr/bin/env node
/**
 * Check if recent exits are following 3-bar fade threshold
 */

const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE = path.join(__dirname, 'snapshots/simulation_snapshots_2026-06-25.json');

function loadSnapshots() {
  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    return (data.snapshots || []).sort((a, b) => new Date(a.at) - new Date(b.at));
  } catch (e) {
    console.error('Failed to load snapshots:', e.message);
    return [];
  }
}

function analyzeRecentExits() {
  const snapshots = loadSnapshots();
  if (!snapshots.length) {
    console.log('No snapshots found');
    return;
  }

  console.log(`\n📊 Analyzing Recent Exits for 3-Bar Compliance\n`);
  console.log(`Total snapshots: ${snapshots.length}`);
  console.log(`Latest snapshot: ${snapshots[snapshots.length - 1].at}\n`);

  // Track all trades
  const tradeTimeline = {};

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.openSimulationTrades) continue;

    snap.openSimulationTrades.forEach(trade => {
      const key = `${trade.symbol}-${trade.entryPrice}`;
      if (!tradeTimeline[key]) {
        tradeTimeline[key] = {
          snapshots: [],
          symbol: trade.symbol,
          entryPrice: trade.entryPrice,
          side: trade.side,
          exitOwner: trade.exitOwner,
        };
      }
      tradeTimeline[key].snapshots.push({
        index: i,
        time: new Date(snap.at),
        trade,
        candidates: snap.candidates || [],
      });
    });
  }

  console.log(`Tracked ${Object.keys(tradeTimeline).length} unique trades\n`);

  // Find exits and analyze
  const fadeExits = [];
  const otherExits = [];

  Object.keys(tradeTimeline).forEach(key => {
    const tl = tradeTimeline[key];
    const lastSnap = tl.snapshots[tl.snapshots.length - 1];
    const lastIndex = lastSnap.index;
    
    // Check if trade exited (disappeared from open trades)
    if (lastIndex < snapshots.length - 10) {
      const exitReason = lastSnap.trade.exitReason || 'unknown';
      
      // Count consecutive signal weaknesses
      let maxConsecWeak = 0;
      let currentWeak = 0;
      const weakHistory = [];

      for (let s = 0; s < tl.snapshots.length; s++) {
        const snap = tl.snapshots[s];
        const candidate = snapshots[snap.index].candidates.find(c => c.symbol === tl.symbol);
        
        if (!candidate) {
          weakHistory.push('?');
          continue;
        }

        const score = Number(candidate.score) || 0;
        const signal = String(candidate.signal || '').toLowerCase();
        const minScore = tl.side === 'sell' ? -60 : 60;
        const isWeak = (tl.side === 'sell' && signal !== 'sell') || 
                      (tl.side !== 'sell' && signal !== 'buy') || 
                      Math.abs(score) < Math.abs(minScore);

        if (isWeak) {
          currentWeak++;
          maxConsecWeak = Math.max(maxConsecWeak, currentWeak);
          weakHistory.push('W');
        } else {
          currentWeak = 0;
          weakHistory.push('S');
        }
      }

      if (exitReason.toLowerCase().includes('deterioration')) {
        fadeExits.push({
          symbol: tl.symbol,
          side: tl.side,
          lifespan: tl.snapshots.length,
          maxConsecWeak,
          exitReason,
          weakPattern: weakHistory.join(''),
          lastPrice: lastSnap.trade.price,
          exitPrice: lastSnap.trade.exitPrice,
        });
      } else if (exitReason.toLowerCase().includes('confirmed stop')) {
        otherExits.push({
          symbol: tl.symbol,
          side: tl.side,
          lifespan: tl.snapshots.length,
          exitReason,
        });
      }
    }
  });

  console.log(`Signal Deterioration Exits (Fade): ${fadeExits.length}\n`);
  
  if (fadeExits.length > 0) {
    console.log('Checking if 3-bar threshold is being respected:\n');
    console.log('Symbol        | Life | Max Streak | Pattern            | 3-Bar OK?');
    console.log('-------------------------------------------------------------------');
    
    const streak2 = fadeExits.filter(t => t.maxConsecWeak <= 2).length;
    const streak3plus = fadeExits.filter(t => t.maxConsecWeak >= 3).length;
    
    fadeExits.forEach(t => {
      const ok = t.maxConsecWeak >= 3 ? '✅ YES' : '❌ NO';
      console.log(`${t.symbol.padEnd(13)} | ${t.lifespan.toString().padEnd(4)} | ${t.maxConsecWeak.toString().padEnd(10)} | ${t.weakPattern.padEnd(18)} | ${ok}`);
    });
    
    console.log(`\n\n📊 RESULTS:`);
    console.log(`Exits with ≥3 bars of weakness: ${streak3plus} (✅ Compliant)`);
    console.log(`Exits with <3 bars of weakness: ${streak2} (❌ Non-compliant)`);
    console.log(`Compliance rate: ${((streak3plus / fadeExits.length) * 100).toFixed(1)}%\n`);

    if (streak2 > 0) {
      console.log(`⚠️  WARNING: ${streak2} exits did NOT wait for 3 bars!`);
      console.log(`   This suggests the setting may not be fully applied yet.`);
      console.log(`   Check if cache needs refresh or setting was not saved.\n`);
    } else {
      console.log(`✅ SUCCESS: All exits are respecting 3-bar threshold!`);
      console.log(`   Setting is working correctly.\n`);
    }
  } else {
    console.log('No signal deterioration exits found yet.');
    console.log('Wait for more exits to accumulate for verification.\n');
  }

  console.log(`Other Exits (Confirmed Stops): ${otherExits.length}`);
  if (otherExits.length > 0) {
    console.log('\nRecent Confirmed Stop Exits:');
    otherExits.slice(0, 5).forEach(t => {
      console.log(`  ${t.symbol} (${t.side}, life: ${t.lifespan} bars) - ${t.exitReason}`);
    });
  }
}

analyzeRecentExits();
