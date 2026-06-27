#!/usr/bin/env node
/**
 * Detailed P&L impact analysis for fade-exit thresholds
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

function analyzeDetailedImpact() {
  const snapshots = loadSnapshots();
  if (!snapshots.length) {
    console.log('No snapshots found');
    return;
  }

  console.log(`\n💰 Detailed P&L Impact Analysis\n`);

  // Track trades and their prices
  const tradeTimeline = {};
  const tradeResults = [];

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
          qty: trade.qty || 1,
        };
      }
      tradeTimeline[key].snapshots.push({
        index: i,
        time: new Date(snap.at),
        trade,
        price: trade.price || trade.entryPrice,
      });
    });
  }

  // Analyze each trade
  Object.keys(tradeTimeline).forEach(key => {
    const tl = tradeTimeline[key];
    const lastSnap = tl.snapshots[tl.snapshots.length - 1];
    const lastIndex = lastSnap.index;
    
    // Trade exited if gap exists
    if (lastIndex < snapshots.length - 10) {
      const exitPrice = lastSnap.trade.exitPrice || lastSnap.trade.price || tl.entryPrice;
      const grossPnl = ((exitPrice - tl.entryPrice) / tl.entryPrice) * 100;
      const lifespan = tl.snapshots.length;
      
      // Count consecutive weaknesses
      let maxConsecutiveWeak = 0;
      let currentWeak = 0;
      
      tl.snapshots.forEach(snap => {
        const candidate = snapshots[snap.index].candidates.find(c => c.symbol === tl.symbol);
        if (candidate) {
          const score = Number(candidate.score) || 0;
          const signal = String(candidate.signal || '').toLowerCase();
          const side = tl.snapshots[0].trade.side;
          const minScore = side === 'sell' ? -60 : 60;
          const isWeak = (side === 'sell' && signal !== 'sell') || (side !== 'sell' && signal !== 'buy') || Math.abs(score) < Math.abs(minScore);
          
          if (isWeak) {
            currentWeak++;
            maxConsecutiveWeak = Math.max(maxConsecutiveWeak, currentWeak);
          } else {
            currentWeak = 0;
          }
        }
      });

      tradeResults.push({
        symbol: tl.symbol,
        lifespan,
        entryPrice: tl.entryPrice,
        exitPrice,
        pnlPct: grossPnl.toFixed(2),
        maxConsecWeak: maxConsecutiveWeak,
        wouldExitAt2Bar: maxConsecutiveWeak >= 2,
        wouldExitAt3Bar: maxConsecutiveWeak >= 3,
        wouldExitAt4Bar: maxConsecutiveWeak >= 4,
      });
    }
  });

  // Analyze by loss/profit
  const losses = tradeResults.filter(t => parseFloat(t.pnlPct) < 0);
  const profits = tradeResults.filter(t => parseFloat(t.pnlPct) >= 0);

  console.log(`Total trades exited: ${tradeResults.length}`);
  console.log(`  Losses: ${losses.length} (${((losses.length / tradeResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Profits: ${profits.length} (${((profits.length / tradeResults.length) * 100).toFixed(1)}%)\n`);

  // Threshold comparison
  const stats = {
    '2-bar': { wouldExit: 0, avgLoss: 0, avgProfit: 0, count: 0 },
    '3-bar': { wouldExit: 0, avgLoss: 0, avgProfit: 0, count: 0 },
    '4-bar': { wouldExit: 0, avgLoss: 0, avgProfit: 0, count: 0 },
  };

  tradeResults.forEach(t => {
    const pnl = parseFloat(t.pnlPct);
    
    if (t.wouldExitAt2Bar) {
      stats['2-bar'].wouldExit++;
      if (pnl < 0) stats['2-bar'].avgLoss += pnl;
      else stats['2-bar'].avgProfit += pnl;
      stats['2-bar'].count++;
    }
    if (t.wouldExitAt3Bar) {
      stats['3-bar'].wouldExit++;
      if (pnl < 0) stats['3-bar'].avgLoss += pnl;
      else stats['3-bar'].avgProfit += pnl;
      stats['3-bar'].count++;
    }
    if (t.wouldExitAt4Bar) {
      stats['4-bar'].wouldExit++;
      if (pnl < 0) stats['4-bar'].avgLoss += pnl;
      else stats['4-bar'].avgProfit += pnl;
      stats['4-bar'].count++;
    }
  });

  console.log('Threshold Comparison:\n');
  console.log('           | Exits | Avg Loss % | Avg Profit %');
  console.log('-----------|-------|-----------|-------------');
  ['2-bar', '3-bar', '4-bar'].forEach(k => {
    const s = stats[k];
    const lossCount = losses.filter(t => t[`wouldExitAt${k.split('-')[0]}`]).length;
    const profitCount = profits.filter(t => t[`wouldExitAt${k.split('-')[0]}`]).length;
    const avgL = lossCount > 0 ? (s.avgLoss / lossCount).toFixed(2) : 'N/A';
    const avgP = profitCount > 0 ? (s.avgProfit / profitCount).toFixed(2) : 'N/A';
    console.log(`${k.padEnd(10)} | ${s.count.toString().padEnd(5)} | ${avgL.toString().padEnd(9)} | ${avgP}`);
  });

  // Sample losing trades with weak signals
  console.log('\n\nLoser Trades with Weak Signal Streaks:');
  losses.filter(t => t.maxConsecWeak >= 2).slice(0, 8).forEach(t => {
    const action2 = t.wouldExitAt2Bar ? '✓' : '✗';
    const action3 = t.wouldExitAt3Bar ? '✓' : '✗';
    const action4 = t.wouldExitAt4Bar ? '✓' : '✗';
    console.log(`  ${t.symbol.padEnd(10)} | PnL: ${t.pnlPct.padEnd(7)}% | Max Streak: ${t.maxConsecWeak} | 2: ${action2} | 3: ${action3} | 4: ${action4}`);
  });

  console.log('\n\n📈 Recommendation:');
  const prevented23 = stats['2-bar'].count - stats['3-bar'].count;
  const prevented34 = stats['3-bar'].count - stats['4-bar'].count;
  
  if (prevented23 === 0 && prevented34 === 0) {
    console.log('  ⚠️  Very minimal difference between thresholds');
    console.log('  → Use 3-bar for slightly better filters, or stick with 2-bar');
  } else if (prevented34 > prevented23) {
    console.log('  ✅ Use 4-bar threshold:');
    console.log(`     • Prevents ${prevented34} additional whipsaws vs 3-bar`);
    console.log(`     • Minimal reduction in legitimate exits`);
  } else {
    console.log('  ✅ Use 3-bar threshold:');
    console.log(`     • Prevents ${prevented23} whipsaws vs 2-bar`);
    console.log(`     • Still responsive to real signal breakdown`);
  }
}

analyzeDetailedImpact();
