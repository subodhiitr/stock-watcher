#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const Backtest = require('./backtest_simulation');
const Frozen = require('./strategy_versions/frozen-2026-07-25');

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const DECISION_DIR = path.join(ROOT, 'cache', 'simulation_decisions');
const DEFAULT_OUT_DIR = path.join(ROOT, 'reports', 'backtest', Frozen.STRATEGY_ID);
const CAPITAL = 1000000;

const VARIANTS = Object.freeze([
  { id:'baseline', label:'Frozen baseline', overrides:{} },
  {
    id:'fresh_confirmation_5m',
    label:'Momentum confirmation age <= 5m',
    overrides:{ SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:5 },
  },
  {
    id:'late_cutoff_1345',
    label:'No new entries after 13:45 IST',
    overrides:{ SIMULATION_ENTRY_END_MIN:13 * 60 + 45 },
  },
  {
    id:'block_1030_1200_proxy',
    label:'Diagnostic: block 10:30-12:00 IST',
    overrides:{ REPLAY_ENTRY_BLOCK_RANGES:[{ startMin:10 * 60 + 30, endMin:12 * 60 }] },
  },
  {
    id:'disable_breakdown',
    label:'Disable BREAKDOWN entries',
    overrides:{ REPLAY_BLOCKED_SETUPS:['BREAKDOWN'] },
  },
  {
    id:'restore_stop_guard',
    label:'Restore daily and clustered stop guards',
    overrides:{ SIMULATION_OVERRIDE_STOP_GUARD:false },
  },
  {
    id:'daily_trade_cap_6',
    label:'Cap daily entries at 6',
    overrides:{ SIMULATION_DAILY_MAX_TRADES:6 },
  },
  {
    id:'higher_min_net_1_25',
    label:'Require modeled net opportunity >= 1.25%',
    overrides:{ SIMULATION_MIN_NET_PROFIT_PCT:1.25 },
  },
  {
    id:'combined_candidate',
    label:'Combined diagnostic candidate',
    diagnostic:true,
    overrides:{
      SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN:5,
      SIMULATION_ENTRY_END_MIN:13 * 60 + 45,
      SIMULATION_OVERRIDE_STOP_GUARD:false,
      SIMULATION_DAILY_MAX_TRADES:6,
      SIMULATION_MIN_NET_PROFIT_PCT:1.25,
      REPLAY_ENTRY_BLOCK_RANGES:[{ startMin:10 * 60 + 30, endMin:12 * 60 }],
      REPLAY_BLOCKED_SETUPS:['BREAKDOWN'],
    },
  },
]);

function parseArgs(argv) {
  const args = { minSessions:20, allowInsufficient:false, outDir:DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--min-sessions') args.minSessions = Number(next());
    else if (arg === '--allow-insufficient') args.allowInsufficient = true;
    else if (arg === '--out-dir') args.outDir = path.resolve(ROOT, next());
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node run_backtest_experiments.js [options]',
    '',
    'Options:',
    '  --min-sessions <n>       Required complete recorded sessions (default 20).',
    '  --allow-insufficient     Run available complete sessions but fail the readiness gate.',
    '  --out-dir <path>         Report output directory.',
  ].join('\n');
}

function getIstMinutes(value) {
  const epochMs = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(epochMs)) return NaN;
  return ((Math.floor(epochMs / 60000) + 330) % 1440 + 1440) % 1440;
}

function availableRecordedDays() {
  const snapshotDays = new Set(
    fs.readdirSync(SNAPSHOT_DIR)
      .map(name => name.match(/(?:snapshot-|simulation_snapshots_)(\d{4}-\d{2}-\d{2})\.json(?:\.gz)?$/)?.[1])
      .filter(Boolean)
  );
  return fs.readdirSync(DECISION_DIR)
    .map(name => name.match(/^simulation_decisions_(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1])
    .filter(day => day && snapshotDays.has(day))
    .sort();
}

async function inspectDecisionCoverage(day) {
  const file = path.join(DECISION_DIR, `simulation_decisions_${day}.jsonl`);
  const input = fs.createReadStream(file);
  const lines = readline.createInterface({ input, crlfDelay:Infinity });
  let first = null;
  let last = null;
  let previous = null;
  let maxGapMin = 0;
  let rows = 0;
  let acceptedEntryIntentRows = 0;
  const marketMinutes = new Set();
  for await (const line of lines) {
    if (!line.trim()) continue;
    const timestamp = line.match(/"snapshotAt":"([^"]+)"/)?.[1] || line.match(/"at":"([^"]+)"/)?.[1];
    const at = new Date(timestamp || 0);
    if (!Number.isFinite(at.getTime())) continue;
    rows += 1;
    if (!first) first = at;
    last = at;
    if (line.includes('"entryIntents":[{')) acceptedEntryIntentRows += 1;
    const mins = getIstMinutes(at);
    if (mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30) marketMinutes.add(mins);
    if (previous) maxGapMin = Math.max(maxGapMin, (at - previous) / 60000);
    previous = at;
  }
  const firstMin = first ? getIstMinutes(first) : null;
  const lastMin = last ? getIstMinutes(last) : null;
  const marketMinuteCoveragePct = +(marketMinutes.size / 376 * 100).toFixed(1);
  const complete = rows > 0 &&
    firstMin <= 9 * 60 + 30 &&
    lastMin >= 15 * 60 + 15 &&
    marketMinuteCoveragePct >= 95 &&
    maxGapMin <= 15;
  return {
    day,
    rows,
    first:first?.toISOString() || null,
    last:last?.toISOString() || null,
    marketMinuteCoveragePct,
    maxGapMin:+maxGapMin.toFixed(1),
    entryIntentRows:acceptedEntryIntentRows,
    complete,
  };
}

function pruneSnapshotsForRecordedReplay(snapshots, alignedCycles) {
  const symbols = new Set([...alignedCycles.values()]
    .flatMap(cycle => cycle.entryIntents || [])
    .map(intent => String(intent?.symbol || '').toUpperCase())
    .filter(Boolean));
  return snapshots.map(snapshot => ({
    ...snapshot,
    candidates:(snapshot.candidates || []).filter(candidate => symbols.has(String(candidate?.symbol || '').toUpperCase())),
  }));
}

function timeWindow(value) {
  const mins = getIstMinutes(value);
  if (mins < 10 * 60 + 30) return '09:15-10:29';
  if (mins < 12 * 60) return '10:30-11:59';
  if (mins < 13 * 60 + 45) return '12:00-13:44';
  return '13:45+';
}

function addBucket(buckets, key, trade) {
  const bucket = buckets[key] ||= { trades:0, wins:0, gross:0, fees:0, net:0 };
  bucket.trades += 1;
  if (Number(trade.net) > 0) bucket.wins += 1;
  bucket.gross += Number(trade.gross) || 0;
  bucket.fees += Number(trade.fees) || 0;
  bucket.net += Number(trade.net) || 0;
}

function finishBuckets(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, {
    trades:bucket.trades,
    wins:bucket.wins,
    losses:bucket.trades - bucket.wins,
    winRate:+(bucket.wins / Math.max(1, bucket.trades) * 100).toFixed(1),
    gross:+bucket.gross.toFixed(2),
    fees:+bucket.fees.toFixed(2),
    net:+bucket.net.toFixed(2),
  }]));
}

function aggregateRuns(runs, sessionDays) {
  const selected = runs.filter(run => sessionDays.includes(run.day));
  const trades = selected.flatMap(run => run.result.trades.map(trade => ({ ...trade, replayDay:run.day })));
  const gross = trades.reduce((sum, trade) => sum + (Number(trade.gross) || 0), 0);
  const fees = trades.reduce((sum, trade) => sum + (Number(trade.fees) || 0), 0);
  const net = trades.reduce((sum, trade) => sum + (Number(trade.net) || 0), 0);
  const wins = trades.filter(trade => Number(trade.net) > 0);
  const losses = trades.filter(trade => Number(trade.net) < 0);
  const grossWins = wins.reduce((sum, trade) => sum + Number(trade.net), 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.net), 0));
  const daily = Object.fromEntries(selected.map(run => [run.day, +run.result.summary.net.toFixed(2)]));
  const profitableDays = Object.values(daily).filter(value => value > 0).length;
  const bySetup = {};
  const byTimeWindow = {};
  for (const trade of trades) {
    addBucket(bySetup, trade.setup || 'UNKNOWN', trade);
    addBucket(byTimeWindow, timeWindow(trade.opened), trade);
  }
  let equity = CAPITAL;
  let peak = equity;
  let maxDrawdown = 0;
  for (const trade of trades.slice().sort((a, b) => new Date(a.closed) - new Date(b.closed))) {
    equity += Number(trade.net) || 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    sessions:sessionDays.length,
    trades:trades.length,
    wins:wins.length,
    losses:losses.length,
    winRate:+(wins.length / Math.max(1, trades.length) * 100).toFixed(1),
    gross:+gross.toFixed(2),
    fees:+fees.toFixed(2),
    net:+net.toFixed(2),
    profitFactor:grossLosses > 0 ? +(grossWins / grossLosses).toFixed(2) : (grossWins > 0 ? null : 0),
    maxDrawdown:+maxDrawdown.toFixed(2),
    maxDrawdownPct:+(maxDrawdown / CAPITAL * 100).toFixed(3),
    profitableDays,
    profitableDayPct:+(profitableDays / Math.max(1, sessionDays.length) * 100).toFixed(1),
    daily,
    bySetup:finishBuckets(bySetup),
    byTimeWindow:finishBuckets(byTimeWindow),
  };
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits:2 })}`;
}

function renderHtml(report) {
  const rows = report.variants.map(variant => {
    const oos = variant.oos;
    const delta = oos.net - report.variants[0].oos.net;
    return `<tr><td>${htmlEscape(variant.label)}</td><td>${oos.trades}</td><td>${oos.winRate}%</td><td>${htmlEscape(oos.profitFactor)}</td><td class="${oos.net >= 0 ? 'pos' : 'neg'}">${money(oos.net)}</td><td>${money(delta)}</td><td>${money(oos.maxDrawdown)}</td><td>${oos.profitableDayPct}%</td></tr>`;
  }).join('');
  const coverageRows = report.coverage.map(row =>
    `<tr><td>${row.day}</td><td>${row.marketMinuteCoveragePct}%</td><td>${row.maxGapMin}m</td><td>${row.entryIntentRows}</td><td><span class="pill ${row.complete ? 'ok' : 'bad'}">${row.complete ? 'Complete' : 'Excluded'}</span></td></tr>`
  ).join('');
  const baseline = report.variants[0];
  const setupRows = Object.entries(baseline.all.bySetup).map(([key, value]) =>
    `<tr><td>${htmlEscape(key)}</td><td>${value.trades}</td><td>${value.winRate}%</td><td>${money(value.gross)}</td><td>${money(value.fees)}</td><td class="${value.net >= 0 ? 'pos' : 'neg'}">${money(value.net)}</td></tr>`
  ).join('');
  const timeRows = Object.entries(baseline.all.byTimeWindow).map(([key, value]) =>
    `<tr><td>${htmlEscape(key)}</td><td>${value.trades}</td><td>${value.winRate}%</td><td>${money(value.gross)}</td><td>${money(value.fees)}</td><td class="${value.net >= 0 ? 'pos' : 'neg'}">${money(value.net)}</td></tr>`
  ).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulation Strategy Replay Audit</title>
<style>
:root{--ink:#172033;--muted:#61708a;--line:#dfe5ee;--bg:#f5f7fa;--card:#fff;--red:#b42318;--green:#067647;--amber:#b54708}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,Segoe UI,Arial,sans-serif}
main{max-width:1180px;margin:auto;padding:32px 24px 64px}h1{font-size:30px;margin:0 0 8px}h2{margin:34px 0 12px;font-size:20px}
.lede{color:var(--muted);font-size:16px;max-width:900px}.verdict{margin:24px 0;padding:20px 22px;border-left:5px solid var(--red);background:#fff1f0;border-radius:8px}
.verdict strong{font-size:18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.v{font-size:23px;font-weight:700;margin-top:4px}.neg{color:var(--red);font-weight:650}.pos{color:var(--green);font-weight:650}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eef2f7;color:#48566d;font-size:12px;text-transform:uppercase}.pill{padding:3px 8px;border-radius:99px;font-weight:650}.pill.ok{background:#dcfae6;color:#067647}.pill.bad{background:#fee4e2;color:#b42318}
.note{padding:14px 16px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12}.footer{margin-top:32px;color:var(--muted);font-size:12px}
@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}table{display:block;overflow-x:auto}}@media print{body{background:#fff}main{max-width:none;padding:20px}.card,table{break-inside:avoid}}
</style></head><body><main>
<h1>Simulation Strategy Replay Audit</h1>
<p class="lede">Frozen strategy ${htmlEscape(report.strategy.id)}. Recorded entry decisions were aligned to stored snapshots, then replayed with adverse slippage, Zerodha intraday charges, partial exits, and the current shared exit engine.</p>
<div class="verdict"><strong>${report.readiness.gatePassed ? 'Ready with caveats' : 'Not assessable for profit readiness'}</strong><br>${htmlEscape(report.readiness.reason)}</div>
<div class="grid">
<div class="card"><div class="k">Complete recorded sessions</div><div class="v">${report.readiness.completeSessions}/${report.readiness.requiredSessions}</div></div>
<div class="card"><div class="k">Baseline net — all usable</div><div class="v ${baseline.all.net >= 0 ? 'pos' : 'neg'}">${money(baseline.all.net)}</div></div>
<div class="card"><div class="k">Baseline profit factor</div><div class="v">${htmlEscape(baseline.all.profitFactor)}</div></div>
<div class="card"><div class="k">Baseline profitable days</div><div class="v">${baseline.all.profitableDayPct}%</div></div>
</div>
<h2>Out-of-sample variant comparison</h2>
<p class="note">These comparisons are diagnostic because the required 20 complete recorded sessions are unavailable. A positive delta is not evidence of a production-ready edge.</p>
<table><thead><tr><th>Variant</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Net</th><th>Δ vs baseline</th><th>Max DD</th><th>Profitable days</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Recorded-session coverage</h2>
<table><thead><tr><th>Date</th><th>Market-minute coverage</th><th>Maximum gap</th><th>Entry-intent rows</th><th>Status</th></tr></thead><tbody>${coverageRows}</tbody></table>
<h2>Frozen baseline by setup</h2>
<table><thead><tr><th>Setup</th><th>Trades</th><th>Win rate</th><th>Gross</th><th>Fees</th><th>Net</th></tr></thead><tbody>${setupRows}</tbody></table>
<h2>Frozen baseline by entry window</h2>
<table><thead><tr><th>IST window</th><th>Trades</th><th>Win rate</th><th>Gross</th><th>Fees</th><th>Net</th></tr></thead><tbody>${timeRows}</tbody></table>
<h2>Method and limitations</h2>
<p>Training sessions: ${report.split.training.join(', ') || 'none'}. Later out-of-sample sessions: ${report.split.oos.join(', ') || 'none'}. Snapshot and decision-journal coverage gates require start by 09:30 IST, end after 15:15 IST, at least 95% observed market minutes, and no gap above 15 minutes.</p>
<p>Recorded-decision replay limits the candidate universe to journaled entry intents. It can test whether a frozen rule set would accept and manage those recorded opportunities; it cannot reconstruct candidates that were never journaled. Results are model outputs, not a profit guarantee.</p>
<div class="footer">Generated ${htmlEscape(report.generatedAt)} · settings SHA-256 ${htmlEscape(report.strategy.settingsSha256)} · source commit ${htmlEscape(report.strategy.sourceCommit)}</div>
</main></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const recordedDays = availableRecordedDays();
  const coverage = [];
  for (const day of recordedDays) coverage.push(await inspectDecisionCoverage(day));
  const completeDays = coverage.filter(row => row.complete).map(row => row.day);
  const gatePassed = completeDays.length >= args.minSessions;
  if (!gatePassed && !args.allowInsufficient) {
    throw new Error(
      `Only ${completeDays.length} complete recorded sessions are available; ${args.minSessions} required. Re-run with --allow-insufficient for a diagnostic report.`
    );
  }
  const oosCount = Math.min(Math.max(2, Math.ceil(completeDays.length * 0.3)), Math.max(0, completeDays.length - 1));
  const trainingDays = completeDays.slice(0, Math.max(0, completeDays.length - oosCount));
  const oosDays = completeDays.slice(Math.max(0, completeDays.length - oosCount));
  const snapshotsByDay = new Map();
  const alignedByDay = new Map();
  for (const day of completeDays) {
    const snapshots = await Backtest.readSnapshots(null, day);
    const aligned = Backtest.alignRecordedDecisionCycles(
      snapshots,
      Backtest.loadRecordedDecisionCycles(day),
      6
    );
    alignedByDay.set(day, aligned);
    snapshotsByDay.set(day, pruneSnapshotsForRecordedReplay(snapshots, aligned));
  }
  const variantReports = [];
  for (const variant of VARIANTS) {
    const runs = [];
    for (const day of completeDays) {
      const settings = { ...Frozen.loadFrozenSettings({ capital:CAPITAL }), ...variant.overrides };
      settings.__recordedDecisionCycles = alignedByDay.get(day);
      const snapshots = structuredClone(snapshotsByDay.get(day));
      runs.push({ day, result:Backtest.runBacktest(snapshots, settings) });
    }
    variantReports.push({
      id:variant.id,
      label:variant.label,
      diagnostic:!!variant.diagnostic,
      overrides:variant.overrides,
      training:aggregateRuns(runs, trainingDays),
      oos:aggregateRuns(runs, oosDays),
      all:aggregateRuns(runs, completeDays),
    });
    console.log(`${variant.id}: ${variantReports.at(-1).all.trades} trades, net ${variantReports.at(-1).all.net}, PF ${variantReports.at(-1).all.profitFactor}`);
  }
  const report = {
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    strategy:{
      id:Frozen.STRATEGY_ID,
      sourceCommit:Frozen.SOURCE_COMMIT,
      settingsSha256:Frozen.EXPECTED_SETTINGS_SHA256,
      capital:CAPITAL,
      costProfile:'zerodha_intraday',
      slippagePct:Frozen.loadFrozenSettings({ capital:CAPITAL }).SIMULATION_SLIPPAGE_PCT,
      partialExits:true,
    },
    readiness:{
      gatePassed,
      requiredSessions:args.minSessions,
      completeSessions:completeDays.length,
      reason:gatePassed
        ? 'The minimum recorded-session coverage gate passed; profitability gates still require review.'
        : `Only ${completeDays.length} complete recorded sessions exist, below the required ${args.minSessions}. Results are diagnostic and cannot establish profit readiness.`,
    },
    split:{ training:trainingDays, oos:oosDays },
    coverage,
    variants:variantReports,
  };
  fs.mkdirSync(args.outDir, { recursive:true });
  const jsonPath = path.join(args.outDir, 'results.json');
  const htmlPath = path.join(args.outDir, 'model_audit_report.html');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(report));
  console.log(`JSON: ${jsonPath}`);
  console.log(`HTML: ${htmlPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  VARIANTS,
  aggregateRuns,
  availableRecordedDays,
  inspectDecisionCoverage,
  parseArgs,
  pruneSnapshotsForRecordedReplay,
  renderHtml,
  timeWindow,
};
