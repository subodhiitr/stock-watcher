#!/usr/bin/env node
'use strict';

const fs = require('fs');
const Backtest = require('./backtest_simulation');

function setupStatsFromBacktest(result) {
  return Object.entries(result?.bySetup || {})
    .map(([setup, row]) => ({
      setup,
      trades:Number(row.trades) || 0,
      wins:Number(row.wins) || 0,
      losses:Number(row.losses) || 0,
      winRate:Number(row.winRate) || 0,
      net:Number(row.net) || 0,
      fees:Number(row.fees) || 0,
    }))
    .sort((a, b) => b.net - a.net);
}

function rejectedFromBacktest(result) {
  const rows = [
    ...(result?.missed?.longProfit || []),
    ...(result?.missed?.shortProfit || []),
    ...(result?.missed?.longRisk || []),
    ...(result?.missed?.shortRisk || []),
  ];
  return rows
    .map((row, index) => ({
      symbol:row.symbol,
      side:row.side,
      setupType:row.setup || '--',
      rank:index + 1,
      score:row.score,
      price:row.entry,
      reason:row.reason || '--',
      net:row.net,
      movePct:row.movePct,
    }))
    .sort((a, b) => Math.abs(Number(b.net) || 0) - Math.abs(Number(a.net) || 0))
    .slice(0, 40);
}

function compactReplayResult(result) {
  return {
    snapshots:result?.snapshots || 0,
    first:result?.first || null,
    last:result?.last || null,
    settings:result?.settings || {},
    summary:result?.summary || {},
    trades:Array.isArray(result?.trades) ? result.trades : [],
    rejected:rejectedFromBacktest(result),
    setupStats:setupStatsFromBacktest(result),
    quality:result?.quality || null,
    dataQuality:result?.dataQuality || [],
    top:result?.top || [],
    bottom:result?.bottom || [],
  };
}

function normalizeSweepRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    minScore:row.minScore,
    topN:row.topN,
    perCycle:row.perCycle,
    firstHour:row.firstHour ?? row.firstHourMaxEntries,
    trail:row.trail ?? row.longTrail,
    trades:row.trades,
    winRate:row.winRate,
    net:row.net,
    drawdown:row.drawdown ?? row.maxDrawdown,
    maxDrawdown:row.maxDrawdown ?? row.drawdown,
    maxDrawdownPct:row.maxDrawdownPct,
    lossStreak:row.lossStreak ?? row.maxLossStreak,
  }));
}

function uniqueSweepSettings(settingsList) {
  const seen = new Set();
  return settingsList.filter(settings => {
    const key = [
      settings.SIMULATION_MIN_SCORE,
      settings.SIMULATION_TOP_N,
      settings.SIMULATION_MAX_NEW_PER_CYCLE,
      settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
      settings.SIMULATION_LONG_TRAIL_PCT,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildQuickSweepSettings(baseSettings) {
  const base = { ...baseSettings };
  return uniqueSweepSettings([
    base,
    { ...base, SIMULATION_MIN_SCORE:55 },
    { ...base, SIMULATION_TOP_N:15 },
    { ...base, SIMULATION_FIRST_HOUR_MAX_ENTRIES:1 },
    { ...base, SIMULATION_FIRST_HOUR_MAX_ENTRIES:3 },
    { ...base, SIMULATION_MAX_NEW_PER_CYCLE:3 },
    { ...base, SIMULATION_LONG_TRAIL_PCT:0.8 },
  ]);
}

function runQuickReplaySweep(snapshots, baseSettings, maxVariants = 5) {
  return normalizeSweepRows(buildQuickSweepSettings(baseSettings).slice(0, maxVariants).map(settings => {
    const result = Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings);
    return {
      minScore:settings.SIMULATION_MIN_SCORE,
      topN:settings.SIMULATION_TOP_N,
      perCycle:settings.SIMULATION_MAX_NEW_PER_CYCLE,
      firstHour:settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
      trail:settings.SIMULATION_LONG_TRAIL_PCT,
      trades:result.summary.trades,
      winRate:result.summary.winRate,
      net:result.summary.net,
      returnPct:result.summary.returnPct,
      maxDrawdown:result.summary.maxDrawdown,
      maxDrawdownPct:result.summary.maxDrawdownPct,
      maxLossStreak:result.summary.maxLossStreak,
    };
  }))
    .sort((a, b) => b.net - a.net || a.maxDrawdown - b.maxDrawdown || b.winRate - a.winRate)
    .slice(0, 10);
}

function readSnapshotsForDay(day) {
  const file = Backtest.getDailySnapshotFile(day);
  return Backtest.readSnapshots(fs.existsSync(file) ? file : null, day);
}

function runReplay(day, mode) {
  const settings = Backtest.loadSettings({ day });
  if (mode === 'autotune') {
    const all = Backtest.readSnapshots(null, null);
    const days = [...new Set(all.map(s => Backtest.istDateKey(s.at)).filter(Boolean))].sort().slice(-5);
    const recent = all.filter(s => days.includes(Backtest.istDateKey(s.at)));
    return {
      ok:true,
      date:day,
      days,
      count:recent.length,
      autoTuneRows:runQuickReplaySweep(recent, settings, 3),
    };
  }
  const snapshots = readSnapshotsForDay(day);
  const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
  const response = {
    ok:true,
    date:day,
    count:snapshots.length,
    result,
  };
  if (mode === 'sweep') {
    response.sweepRows = runQuickReplaySweep(snapshots, settings, 5);
  }
  return response;
}

process.on('message', message => {
  try {
    const day = String(message?.day || '').trim();
    const mode = ['report', 'sweep', 'autotune'].includes(message?.mode) ? message.mode : 'report';
    if (!day) throw new Error('day is required');
    process.send?.({ ok:true, payload:runReplay(day, mode) });
  } catch (e) {
    process.send?.({ ok:false, error:e.stack || e.message || String(e) });
  }
});
