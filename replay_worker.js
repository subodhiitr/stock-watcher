#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const Backtest = require('./backtest_simulation');

function isClosedIpcError(e) {
  return e && e.code === 'ERR_IPC_CHANNEL_CLOSED';
}

function sendToParent(message) {
  if (typeof process.send !== 'function' || !process.connected) return false;
  try {
    process.send(message, err => {
      if (err && !isClosedIpcError(err)) throw err;
    });
    return true;
  } catch (e) {
    if (!isClosedIpcError(e)) throw e;
    return false;
  }
}

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
      settings.SIMULATION_STOP_CONFIRM_BARS,
      settings.SIMULATION_EXIT_FADE_CONFIRM_BARS,
      settings.SIMULATION_STOP_GRACE_MIN,
      settings.SIMULATION_TARGET_PARTIAL_QTY_PCT,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSweepOutcomes(rows) {
  const seen = new Set();
  const ordered = Array.isArray(rows) ? rows : [];
  return ordered.filter(row => {
    const key = [
      Number(row?.net || 0).toFixed(2),
      Number(row?.winRate || 0).toFixed(1),
      Math.floor(Number(row?.trades || 0)),
      Number(row?.maxDrawdown || row?.drawdown || 0).toFixed(2),
      Math.floor(Number(row?.maxLossStreak || row?.lossStreak || 0)),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSweepRow(settings, result) {
  return {
    minScore:settings.SIMULATION_MIN_SCORE,
    topN:settings.SIMULATION_TOP_N,
    perCycle:settings.SIMULATION_MAX_NEW_PER_CYCLE,
    firstHour:settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
    trail:settings.SIMULATION_LONG_TRAIL_PCT,
    stopConfirm:settings.SIMULATION_STOP_CONFIRM_BARS,
    fadeConfirm:settings.SIMULATION_EXIT_FADE_CONFIRM_BARS,
    stopGrace:settings.SIMULATION_STOP_GRACE_MIN,
    partialQty:settings.SIMULATION_TARGET_PARTIAL_QTY_PCT,
    trades:result.summary.trades,
    winRate:result.summary.winRate,
    net:result.summary.net,
    returnPct:result.summary.returnPct,
    maxDrawdown:result.summary.maxDrawdown,
    maxDrawdownPct:result.summary.maxDrawdownPct,
    maxLossStreak:result.summary.maxLossStreak,
  };
}

function runSweepBatch(settingsList, snapshots) {
  const cpuCount = Math.max(1, Math.min(os.cpus().length, 8));
  const chunkSize = Math.ceil(settingsList.length / cpuCount);
  const chunks = [];
  for (let i = 0; i < settingsList.length; i += chunkSize) {
    chunks.push(settingsList.slice(i, i + chunkSize));
  }
  const workers = [];
  let completed = 0;
  let settled = false;
  const results = new Array(chunks.length);
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      for (const w of workers) { try { w.terminate(); } catch (_) {} }
      reject(err);
    };
    chunks.forEach((batch, idx) => {
      const w = new Worker(__filename, { workerData:{ batch, snapshots } });
      workers.push(w);
      w.on('message', msg => {
        if (settled) return;
        if (msg && msg.ok === false) { fail(new Error(msg.error || 'Sweep worker failed')); return; }
        results[idx] = Array.isArray(msg) ? msg : [];
        if (++completed === chunks.length) { settled = true; resolve(results.flat()); }
      });
      w.on('error', err => fail(err));
      w.on('exit', code => { if (!settled && code !== 0) fail(new Error(`Sweep worker exited ${code}`)); });
    });
  });
}

function buildQuickSweepSettings(baseSettings) {
  const base = { ...baseSettings };
  const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
  const clampTrail = value => +Math.max(0.2, Math.min(2.0, Number(value) || 0.6)).toFixed(1);
  const candidateSet = (values, normalize) => [...new Set(values.map(normalize).filter(v => Number.isFinite(Number(v))))];

  const minScores = candidateSet([
    base.SIMULATION_MIN_SCORE,
    Number(base.SIMULATION_MIN_SCORE) - 5,
    Number(base.SIMULATION_MIN_SCORE) + 5,
  ], v => clampInt(v, 40, 90));

  const topNs = candidateSet([
    base.SIMULATION_TOP_N,
    Number(base.SIMULATION_TOP_N) - 2,
    Number(base.SIMULATION_TOP_N) + 2,
  ], v => clampInt(v, 5, 25));

  const perCycles = candidateSet([
    base.SIMULATION_MAX_NEW_PER_CYCLE,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) - 1,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) + 1,
  ], v => clampInt(v, 1, 8));

  const firstHours = candidateSet([
    base.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
    Number(base.SIMULATION_FIRST_HOUR_MAX_ENTRIES) - 1,
    Number(base.SIMULATION_FIRST_HOUR_MAX_ENTRIES) + 1,
  ], v => clampInt(v, 1, 6));

  const trails = candidateSet([
    base.SIMULATION_LONG_TRAIL_PCT,
    Number(base.SIMULATION_LONG_TRAIL_PCT) - 0.2,
    Number(base.SIMULATION_LONG_TRAIL_PCT) + 0.2,
  ], clampTrail);

  const variants = [base];
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const perCycle of perCycles) {
        for (const firstHour of firstHours) {
          for (const trail of trails) {
            variants.push({
              ...base,
              SIMULATION_MIN_SCORE:minScore,
              SIMULATION_TOP_N:topN,
              SIMULATION_MAX_NEW_PER_CYCLE:perCycle,
              SIMULATION_FIRST_HOUR_MAX_ENTRIES:firstHour,
              SIMULATION_LONG_TRAIL_PCT:trail,
            });
          }
        }
      }
    }
  }

  return uniqueSweepSettings(variants);
}

async function runQuickReplaySweep(snapshots, baseSettings, maxVariants = 5) {
  const limit = Math.max(1, Math.floor(Number(maxVariants) || 5));
  const rows = await runSweepBatch(buildQuickSweepSettings(baseSettings), snapshots);
  const ranked = normalizeSweepRows(rows)
    .sort((a, b) => b.net - a.net || a.maxDrawdown - b.maxDrawdown || b.winRate - a.winRate);
  return uniqueSweepOutcomes(ranked).slice(0, limit);
}

function buildDeepSweepSettings(baseSettings) {
  const base = { ...baseSettings };
  const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
  const clampTrail = value => +Math.max(0.2, Math.min(2.5, Number(value) || 0.6)).toFixed(1);
  const candidateSet = (values, normalize) => [...new Set(values.map(normalize).filter(v => Number.isFinite(Number(v))))];

  const minScores = candidateSet([
    base.SIMULATION_MIN_SCORE,
    Number(base.SIMULATION_MIN_SCORE) - 10,
    Number(base.SIMULATION_MIN_SCORE) - 5,
    Number(base.SIMULATION_MIN_SCORE) + 5,
    Number(base.SIMULATION_MIN_SCORE) + 10,
  ], v => clampInt(v, 35, 95));

  const topNs = candidateSet([
    base.SIMULATION_TOP_N,
    Number(base.SIMULATION_TOP_N) - 4,
    Number(base.SIMULATION_TOP_N) - 2,
    Number(base.SIMULATION_TOP_N) + 2,
    Number(base.SIMULATION_TOP_N) + 4,
  ], v => clampInt(v, 5, 30));

  const perCycles = candidateSet([
    base.SIMULATION_MAX_NEW_PER_CYCLE,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) - 2,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) - 1,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) + 1,
    Number(base.SIMULATION_MAX_NEW_PER_CYCLE) + 2,
  ], v => clampInt(v, 1, 10));

  const firstHours = candidateSet([
    base.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
    Number(base.SIMULATION_FIRST_HOUR_MAX_ENTRIES) - 1,
    Number(base.SIMULATION_FIRST_HOUR_MAX_ENTRIES) + 1,
    Number(base.SIMULATION_FIRST_HOUR_MAX_ENTRIES) + 2,
  ], v => clampInt(v, 1, 8));

  const trails = candidateSet([
    base.SIMULATION_LONG_TRAIL_PCT,
    Number(base.SIMULATION_LONG_TRAIL_PCT) - 0.4,
    Number(base.SIMULATION_LONG_TRAIL_PCT) - 0.2,
    Number(base.SIMULATION_LONG_TRAIL_PCT) + 0.2,
    Number(base.SIMULATION_LONG_TRAIL_PCT) + 0.4,
  ], clampTrail);

  const stopConfirmBars = candidateSet([
    base.SIMULATION_STOP_CONFIRM_BARS,
    Number(base.SIMULATION_STOP_CONFIRM_BARS) - 1,
    Number(base.SIMULATION_STOP_CONFIRM_BARS) + 1,
    Number(base.SIMULATION_STOP_CONFIRM_BARS) + 2,
  ], v => clampInt(v, 1, 6));

  const fadeConfirmBars = candidateSet([
    base.SIMULATION_EXIT_FADE_CONFIRM_BARS,
    Number(base.SIMULATION_EXIT_FADE_CONFIRM_BARS) - 1,
    Number(base.SIMULATION_EXIT_FADE_CONFIRM_BARS) + 1,
    Number(base.SIMULATION_EXIT_FADE_CONFIRM_BARS) + 2,
  ], v => clampInt(v, 1, 6));

  const stopGraceMins = candidateSet([
    base.SIMULATION_STOP_GRACE_MIN,
    Number(base.SIMULATION_STOP_GRACE_MIN) - 5,
    Number(base.SIMULATION_STOP_GRACE_MIN) + 5,
  ], v => clampInt(v, 3, 45));

  const partialQtyPcts = candidateSet([
    base.SIMULATION_TARGET_PARTIAL_QTY_PCT,
    Number(base.SIMULATION_TARGET_PARTIAL_QTY_PCT) - 10,
    Number(base.SIMULATION_TARGET_PARTIAL_QTY_PCT) + 10,
  ], v => clampInt(v, 20, 80));

  const variants = [base];

  // Core entry/flow parameters full cartesian sweep.
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const perCycle of perCycles) {
        for (const firstHour of firstHours) {
          for (const trail of trails) {
            variants.push({
              ...base,
              SIMULATION_MIN_SCORE:minScore,
              SIMULATION_TOP_N:topN,
              SIMULATION_MAX_NEW_PER_CYCLE:perCycle,
              SIMULATION_FIRST_HOUR_MAX_ENTRIES:firstHour,
              SIMULATION_LONG_TRAIL_PCT:trail,
            });
          }
        }
      }
    }
  }

  // Exit/risk-only cartesian sweep on base entry profile.
  for (const stopConfirm of stopConfirmBars) {
    for (const fadeConfirm of fadeConfirmBars) {
      for (const stopGrace of stopGraceMins) {
        for (const partialQty of partialQtyPcts) {
          variants.push({
            ...base,
            SIMULATION_STOP_CONFIRM_BARS:stopConfirm,
            SIMULATION_EXIT_FADE_CONFIRM_BARS:fadeConfirm,
            SIMULATION_STOP_GRACE_MIN:stopGrace,
            SIMULATION_TARGET_PARTIAL_QTY_PCT:partialQty,
          });
        }
      }
    }
  }

  // Couple core trend sensitivity with confirm bars.
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const trail of trails) {
        for (const stopConfirm of stopConfirmBars) {
          variants.push({
            ...base,
            SIMULATION_MIN_SCORE:minScore,
            SIMULATION_TOP_N:topN,
            SIMULATION_LONG_TRAIL_PCT:trail,
            SIMULATION_STOP_CONFIRM_BARS:stopConfirm,
          });
        }
        for (const fadeConfirm of fadeConfirmBars) {
          variants.push({
            ...base,
            SIMULATION_MIN_SCORE:minScore,
            SIMULATION_TOP_N:topN,
            SIMULATION_LONG_TRAIL_PCT:trail,
            SIMULATION_EXIT_FADE_CONFIRM_BARS:fadeConfirm,
          });
        }
      }
    }
  }

  return uniqueSweepSettings(variants);
}

async function runDeepReplaySweep(snapshots, baseSettings, maxVariants = 20) {
  const limit = Math.max(1, Math.floor(Number(maxVariants) || 20));
  const rows = await runSweepBatch(buildDeepSweepSettings(baseSettings), snapshots);
  const ranked = normalizeSweepRows(rows)
    .sort((a, b) => b.net - a.net || a.maxDrawdown - b.maxDrawdown || b.winRate - a.winRate);
  return uniqueSweepOutcomes(ranked).slice(0, limit);
}

async function readSnapshotsForDay(day) {
  const file = Backtest.getDailySnapshotFile(day);
  return Backtest.readSnapshots(fs.existsSync(file) ? file : null, day);
}

async function runReplay(day, mode) {
  const settings = Backtest.loadSettings({ day });
  if (mode === 'autotune') {
    const all = await Backtest.readSnapshots(null, null);
    const days = [...new Set(all.map(s => Backtest.istDateKey(s.at)).filter(Boolean))].sort().slice(-5);
    const recent = all.filter(s => days.includes(Backtest.istDateKey(s.at)));
    return {
      ok:true,
      date:day,
      days,
      count:recent.length,
      autoTuneRows:await runQuickReplaySweep(recent, settings, 3),
    };
  }
  if (mode === 'deep_sweep') {
    const snapshots = await readSnapshotsForDay(day);
    const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
    return {
      ok:true,
      date:day,
      count:snapshots.length,
      result,
      sweepRows:await runDeepReplaySweep(snapshots, settings, 20),
      deepSweep:true,
    };
  }
  const snapshots = await readSnapshotsForDay(day);
  const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
  const response = {
    ok:true,
    date:day,
    count:snapshots.length,
    result,
  };
  if (mode === 'sweep') {
    response.sweepRows = await runQuickReplaySweep(snapshots, settings, 5);
  }
  return response;
}

if (!isMainThread && parentPort) {
  try {
    const { batch, snapshots } = workerData;
    const rows = batch.map(settings => {
      const result = Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings);
      return buildSweepRow(settings, result);
    });
    parentPort.postMessage(rows);
  } catch (e) {
    parentPort.postMessage({ ok:false, error:e.message || String(e) });
  }
} else {
  process.on('error', e => {
    if (isClosedIpcError(e)) return;
    throw e;
  });
  process.on('message', async message => {
    try {
      const day = String(message?.day || '').trim();
      const mode = ['report', 'sweep', 'autotune', 'deep_sweep'].includes(message?.mode) ? message.mode : 'report';
      if (!day) throw new Error('day is required');
      sendToParent({ ok:true, payload:await runReplay(day, mode) });
    } catch (e) {
      sendToParent({ ok:false, error:e.stack || e.message || String(e) });
    }
  });
}
