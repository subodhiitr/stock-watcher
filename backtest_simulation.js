#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const TradeRules = require('./trade_rules');
const SimulationEngine = require('./simulation_engine');

// Dynamic import for ES module snapshot-store
let snapshotStore = null;
async function getSnapshotStore() {
  if (!snapshotStore) {
    snapshotStore = await import('./server/snapshot-store.js');
  }
  return snapshotStore;
}

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const DB_FILE = path.resolve(ROOT, process.env.STOCK_WATCHER_DB_PATH || 'stock-watcher.db');
const PAPER_TRADES_FILE = path.join(ROOT, 'paper_trades.json');
const TRADE_SETTINGS_FILE = path.join(ROOT, 'trade_settings.json');
const DECISION_JOURNAL_DIR = path.join(ROOT, 'cache', 'simulation_decisions');

// Try to load trade setting overrides from DB (if available), else fall back to JSON file
function loadTradeSettingOverrides(file) {
  const normalizeSetting = (key, value) => {
    if (!(key in DEFAULTS)) return undefined;
    if (typeof DEFAULTS[key] === 'boolean') return value === true || value === 1 || value === '1' || value === 'true';
    if (typeof DEFAULTS[key] === 'string') return String(value);
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  // Try DB directly via better-sqlite3
  try {
    const Database = require('better-sqlite3');
    const dbPath = DB_FILE;
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare("SELECT value FROM kv_store WHERE key = 'trade_settings'").get();
      db.close();
      if (row?.value) {
        const val = JSON.parse(row.value);
        if (val?.overrides && typeof val.overrides === 'object') {
          const clean = {};
          for (const [key, value] of Object.entries(val.overrides)) {
            const normalized = normalizeSetting(key, value);
            if (normalized !== undefined) clean[key] = normalized;
          }
          return clean;
        }
      }
    }
  } catch (_) {}
  // Fall back to JSON file
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const overrides = raw && typeof raw === 'object' && raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
    const clean = {};
    for (const [key, value] of Object.entries(overrides)) {
      const normalized = normalizeSetting(key, value);
      if (normalized !== undefined) clean[key] = normalized;
    }
    return clean;
  } catch (_) {
    return {};
  }
}

const DEFAULTS = TradeRules.DEFAULT_SETTINGS;

function usage() {
  return `
Usage:
  node backtest_simulation.js [options]

Options:
  --day <YYYY-MM-DD>         Backtest only one IST trading date.
  --first-hour-cap <n>       Override first-hour entry cap.
  --max-active-open <n>      Override max active simulation open trades.
  --max-new-per-cycle <n>    Override max new entries per refresh cycle.
  --nifty-regime-pct <n>     Override Nifty market-regime threshold. Use 999 to effectively disable direct Nifty guard.
  --rs-regime-pct <n>        Override RS (relative strength vs Nifty) threshold. Default 0.2. Use 999 to disable RS guard.
  --auto-shorts              Allow simulation replay to enter short/sell trades.
  --long-only                Replay only long/buy entries.
  --short-only               Replay only short/sell entries.
  --min-score <n>            Override long-side minimum absolute score (alias: --min_score).
  --short-min-score <n>      Override short-side minimum absolute score.
  --enable-etf               Allow replay to include long/buy ETF entries.
  --capital <amount>         Override starting/available capital for replay.
  --default-capital          Use dashboard default capital instead of saved portfolio cash.
  --recompute-scores         Re-score buy-side snapshot candidates before replay.
  --recorded-decisions       Use persisted live candidate selection/ranking when available.
  --skip-opportunities       Skip expensive hypothetical missed-opportunity analysis.
  --sweep                    Run a small parameter sweep and rank by net P/L.
  --json                     Print full JSON result.
  --help                     Show this help.

Examples:
  node backtest_simulation.js
  node backtest_simulation.js --day 2026-06-17
  node backtest_simulation.js --day 2026-06-17 --first-hour-cap 4
`.trim();
}

function parseArgs(argv) {
  const args = { json:false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--day') args.day = next();
    else if (arg === '--first-hour-cap') args.firstHourCap = Number(next());
    else if (arg === '--max-active-open') args.maxActiveOpen = Number(next());
    else if (arg === '--max-new-per-cycle') args.maxNewPerCycle = Number(next());
    else if (arg === '--nifty-regime-pct') args.niftyRegimePct = Number(next());
    else if (arg === '--rs-regime-pct') args.rsRegimePct = Number(next());
    else if (arg === '--auto-shorts') args.autoShorts = true;
    else if (arg === '--long-only') args.longOnly = true;
    else if (arg === '--short-only') args.shortOnly = true;
    else if (arg === '--enable-etf') args.enableEtf = true;
    else if (arg === '--min-score' || arg === '--min_score') args.minScore = Number(next());
    else if (arg === '--short-min-score') args.shortMinScore = Number(next());
    else if (arg === '--capital') args.capital = Number(next());
    else if (arg === '--default-capital') args.defaultCapital = true;
    else if (arg === '--recompute-scores') args.recomputeScores = true;
    else if (arg === '--recorded-decisions') args.recordedDecisions = true;
    else if (arg === '--skip-opportunities') args.skipOpportunities = true;
    else if (arg === '--sweep') args.sweep = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function loadSettings(overrides) {
  const snapshots = Array.isArray(overrides?.snapshots) ? overrides.snapshots : [];
  const historicalContext = getHistoricalReplayContext(snapshots);
  const settings = TradeRules.withDefaults(historicalContext.settings || DEFAULTS);
  if (!historicalContext.settings) {
    const saved = loadTradeSettingOverrides(TRADE_SETTINGS_FILE);
    Object.assign(settings, saved);
  }
  if (Number.isFinite(overrides.firstHourCap)) settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES = overrides.firstHourCap;
  if (Number.isFinite(overrides.maxActiveOpen)) settings.SIMULATION_MAX_ACTIVE_OPEN = overrides.maxActiveOpen;
  if (Number.isFinite(overrides.maxNewPerCycle)) settings.SIMULATION_MAX_NEW_PER_CYCLE = overrides.maxNewPerCycle;
  if (Number.isFinite(overrides.niftyRegimePct)) settings.SIMULATION_MARKET_REGIME_NIFTY_PCT = overrides.niftyRegimePct;
  if (Number.isFinite(overrides.rsRegimePct)) settings.SIMULATION_MARKET_REGIME_RS_PCT = overrides.rsRegimePct;
  const minScoreOverride = Number.isFinite(overrides.minScore) ? overrides.minScore : overrides.min_score;
  if (Number.isFinite(minScoreOverride)) settings.SIMULATION_MIN_SCORE = minScoreOverride;
  if (Number.isFinite(overrides.shortMinScore)) settings.SIMULATION_SHORT_MIN_SCORE = overrides.shortMinScore;
  if (overrides.autoShorts) settings.SIMULATION_AUTO_SHORTS = true;
  if (overrides.shortOnly) settings.SIMULATION_AUTO_SHORTS = true;
  if (overrides.enableEtf) settings.SIMULATION_ENABLE_ETF = true;
  settings.REPLAY_SKIP_OPPORTUNITIES = !!overrides.skipOpportunities;
  settings.REPLAY_LONG_ONLY = !!overrides.longOnly;
  settings.REPLAY_SHORT_ONLY = !!overrides.shortOnly;
  const historicalPortfolio = historicalContext.portfolio;
  const dbPortfolioCash = (overrides.defaultCapital || historicalPortfolio) ? null : loadPortfolioAvailableCashFromDb(DB_FILE);
  const filePortfolioCash = (!overrides.defaultCapital && !historicalPortfolio && !dbPortfolioCash) ? loadPortfolioAvailableCash(PAPER_TRADES_FILE) : null;
  const portfolioCash = dbPortfolioCash || filePortfolioCash;
  const portfolioSource = dbPortfolioCash ? 'SQLite portfolio state' : 'paper_trades.json portfolio capital';
  if (Number.isFinite(overrides.capital) && overrides.capital > 0) {
    settings.PORTFOLIO_INITIAL_CAPITAL = +overrides.capital.toFixed(2);
    settings.PORTFOLIO_CAPITAL_SOURCE = 'command-line';
  } else if (historicalPortfolio) {
    settings.PORTFOLIO_INITIAL_CAPITAL = historicalPortfolio.capital;
    settings.PORTFOLIO_AVAILABLE_CASH = historicalPortfolio.cashAvailable;
    settings.PORTFOLIO_CAPITAL_SOURCE = 'historical-snapshot';
    settings.PORTFOLIO_CAPITAL_DETAIL = historicalPortfolio;
  } else if (portfolioCash && Number.isFinite(portfolioCash.capital) && portfolioCash.capital > 0) {
    settings.PORTFOLIO_INITIAL_CAPITAL = portfolioCash.capital;
    settings.PORTFOLIO_AVAILABLE_CASH = portfolioCash.cashAvailable;
    settings.PORTFOLIO_CAPITAL_SOURCE = portfolioSource;
    settings.PORTFOLIO_CAPITAL_DETAIL = portfolioCash;
  } else {
    settings.PORTFOLIO_CAPITAL_SOURCE = overrides.defaultCapital ? 'dashboard default' : 'dashboard default; saved portfolio unavailable';
  }
  settings.REPLAY_RECOMPUTE_SCORES = !!(overrides.recomputeScores || overrides.REPLAY_RECOMPUTE_SCORES);
  settings.REPLAY_SETTINGS_SOURCE = historicalContext.settings ? 'historical-snapshot' : 'current-settings-fallback';
  settings.REPLAY_SETTINGS_VARIANTS = historicalContext.settingsVariants;
  settings.REPLAY_HISTORICAL_CAPITAL_AVAILABLE = !!historicalPortfolio;
  return settings;
}

function stableObjectKey(value) {
  const source = value && typeof value === 'object' ? value : {};
  return JSON.stringify(Object.fromEntries(Object.keys(source).sort().map(key => [key, source[key]])));
}

function getHistoricalReplayContext(snapshots = []) {
  const rows = Array.isArray(snapshots) ? snapshots : [];
  const variants = new Map();
  for (const snapshot of rows) {
    const caps = snapshot?.caps && typeof snapshot.caps === 'object' ? snapshot.caps : null;
    if (!caps || !Object.keys(caps).length) continue;
    const key = stableObjectKey(caps);
    const current = variants.get(key) || { count:0, settings:caps, firstAt:snapshot.at || '' };
    current.count += 1;
    variants.set(key, current);
  }
  const selected = [...variants.values()].sort((left, right) => right.count - left.count || String(left.firstAt).localeCompare(String(right.firstAt)))[0] || null;
  const portfolioSnapshot = rows.find(snapshot => {
    const portfolio = snapshot?.portfolio;
    return Number(portfolio?.capital) > 0 && Number.isFinite(Number(portfolio?.cashAvailable));
  })?.portfolio;
  const portfolio = portfolioSnapshot ? {
    capital:Number(portfolioSnapshot.capital),
    cashAvailable:Number(portfolioSnapshot.cashAvailable),
    equity:Number(portfolioSnapshot.equity ?? portfolioSnapshot.capital),
    openExposure:Number(portfolioSnapshot.openExposure || 0),
    realizedPnl:Number(portfolioSnapshot.realizedPnl || 0),
    at:portfolioSnapshot.at || null,
  } : null;
  return { settings:selected?.settings || null, settingsVariants:variants.size, portfolio };
}

function assessReplayReliability(snapshots = [], settings = {}) {
  const rows = (Array.isArray(snapshots) ? snapshots : []).filter(snapshot => snapshot?.at);
  const marketRows = rows.filter(snapshot => {
    const minutes = istMinutes(snapshot.at);
    return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
  });
  let maxGapMin = 0;
  for (let index = 1; index < marketRows.length; index += 1) {
    maxGapMin = Math.max(maxGapMin, (new Date(marketRows[index].at) - new Date(marketRows[index - 1].at)) / 60000);
  }
  const firstMinute = marketRows.length ? istMinutes(marketRows[0].at) : null;
  const lastMinute = marketRows.length ? istMinutes(marketRows.at(-1).at) : null;
  const context = getHistoricalReplayContext(rows);
  const issues = [];
  if (marketRows.length < 120) issues.push(`only ${marketRows.length} market-hour snapshots`);
  if (maxGapMin > 5) issues.push(`maximum market-hour gap ${round1(maxGapMin)} minutes`);
  if (firstMinute == null || firstMinute > 9 * 60 + 25) issues.push('opening coverage starts after 09:25 IST');
  if (lastMinute == null || lastMinute < 15 * 60 + 20) issues.push('closing coverage ends before 15:20 IST');
  if (!context.settings) issues.push('historical settings are unavailable');
  if (context.settingsVariants > 1) issues.push(`${context.settingsVariants} settings variants occurred intraday`);
  if (!context.portfolio) issues.push('historical opening capital is unavailable');
  const unusable = marketRows.length < 60 || maxGapMin > 20 || firstMinute == null;
  const reliable = !issues.length;
  return {
    status:unusable ? 'unreliable' : reliable ? 'reliable' : 'degraded',
    mode:settings.__recordedDecisionCycles instanceof Map ? 'recorded' : 'hypothetical',
    marketSnapshots:marketRows.length,
    totalSnapshots:rows.length,
    firstMarketAt:marketRows[0]?.at || null,
    lastMarketAt:marketRows.at(-1)?.at || null,
    maxGapMin:round1(maxGapMin),
    historicalSettingsAvailable:!!context.settings,
    settingsVariants:context.settingsVariants,
    historicalCapitalAvailable:!!context.portfolio,
    issues,
  };
}

function computePortfolioAvailableCash(portfolio, trades) {
  const initial = Number(portfolio?.initialCapital);
  const base = Number.isFinite(initial) && initial > 0 ? initial : DEFAULTS.PORTFOLIO_INITIAL_CAPITAL;
  const addedCapital = Array.isArray(portfolio?.capitalAdds)
    ? portfolio.capitalAdds.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0)
    : 0;
  let realized = 0;
  let openExposure = 0;
  for (const trade of Array.isArray(trades) ? trades : []) {
    const status = String(trade?.status || '').toLowerCase();
    if (status === 'closed') {
      const pnl = Number(trade.pnl);
      if (Number.isFinite(pnl)) realized += pnl;
    } else if (status === 'open') {
      const entry = Number(trade.entryPrice ?? trade.entry_price);
      const qty = Number(trade.qty);
      if (Number.isFinite(entry) && Number.isFinite(qty)) openExposure += entry * qty;
    }
  }
  const capital = base + addedCapital;
  const cashAvailable = capital + realized - openExposure;
  return {
    initial: round2(base),
    addedCapital: round2(addedCapital),
    capital: round2(capital),
    realized: round2(realized),
    openExposure: round2(openExposure),
    cashAvailable: round2(cashAvailable),
    tradeCount: Array.isArray(trades) ? trades.length : 0,
  };
}

function loadPortfolioAvailableCashFromDb(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT data FROM portfolio_state WHERE key = 'default'").get();
      if (!row?.data) return null;
      const portfolio = JSON.parse(row.data);
      const trades = db.prepare('SELECT data FROM trade_txns').all()
        .map(tradeRow => JSON.parse(tradeRow.data))
        .filter(Boolean);
      return computePortfolioAvailableCash(portfolio, trades);
    } finally {
      db.close();
    }
  } catch (e) {
    return null;
  }
}

function loadPortfolioAvailableCash(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const portfolio = raw && typeof raw === 'object' ? raw.portfolio || {} : {};
    const trades = Array.isArray(raw?.trades) ? raw.trades : [];
    return computePortfolioAvailableCash(portfolio, trades);
  } catch (e) {
    return null;
  }
}

async function readSnapshots(file, day) {
  if (file) throw new Error('Snapshot file fallback has been removed; migrate snapshots to SQLite first');
  const snapshotStoreModule = await getSnapshotStore();
  const dates = day ? [day] : await snapshotStoreModule.listSnapshotDays(SNAPSHOT_DIR);
  const snapshots = [];
  for (const date of dates) {
    try {
      const data = await snapshotStoreModule.loadSnapshotDay(date, SNAPSHOT_DIR);
      if (Array.isArray(data?.snapshots)) snapshots.push(...data.snapshots);
    } catch (error) {
      if (!error.message.includes('Snapshot not found')) throw error;
    }
  }
  return snapshots
    .filter(snapshot => snapshot?.at && Array.isArray(snapshot?.candidates))
    .filter(snapshot => !day || istDateKey(snapshot.at) === day)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
}

function istDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const pick = type => parts.find(p => p.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function istDisplayDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function istMinutes(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  return hour * 60 + minute;
}

function istWeekday(value) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date(value));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

function isEntryWindow(value, settings = {}) {
  return TradeRules.isSimulationEntryWindow(value, settings);
}

function forEachJsonLineSync(file, callback, chunkSize = 4 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(chunkSize);
  const decoder = new StringDecoder('utf8');
  let carry = '';
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      const text = carry + decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) callback(line);
    } while (bytesRead > 0);
    carry += decoder.end();
    if (carry) callback(carry);
  } finally {
    fs.closeSync(fd);
  }
}

function loadRecordedDecisionCycles(day, fileOverride = '') {
  if (!day) return new Map();
  const file = fileOverride || path.join(DECISION_JOURNAL_DIR, `simulation_decisions_${day}.jsonl`);
  if (!fs.existsSync(file)) return new Map();
  const cycles = new Map();
  const recordedOpenSymbols = new Set();
  forEachJsonLineSync(file, line => {
    if (!line.trim()) return;
    try {
      const row = JSON.parse(line);
      if (row.event !== 'cycle_decisions' || !row.snapshotAt) return;
      for (const exit of Array.isArray(row.exitIntents) ? row.exitIntents : []) {
        if (String(exit?.action || 'close').toLowerCase() !== 'partial' && exit?.symbol) {
          recordedOpenSymbols.delete(String(exit.symbol).toUpperCase());
        }
      }
      const acceptedEntryIntents = [];
      for (const entry of Array.isArray(row.entryIntents) ? row.entryIntents : []) {
        const symbol = String(entry?.symbol || '').toUpperCase();
        if (!symbol || recordedOpenSymbols.has(symbol)) continue;
        recordedOpenSymbols.add(symbol);
        acceptedEntryIntents.push(entry);
      }
      const rankedCandidates = Array.isArray(row.rankedCandidates)
        ? row.rankedCandidates.filter(candidate => candidate?.selected)
        : [];
      if (acceptedEntryIntents.length || rankedCandidates.length) {
        cycles.set(row.snapshotAt, {
          snapshotAt:row.snapshotAt,
          at:row.at,
          entryIntents:acceptedEntryIntents,
          rankedCandidates,
        });
      }
    } catch (_) {}
  });
  return cycles;
}

function loadRecordedDecisionCyclesFromSnapshots(snapshots = []) {
  const cycles = new Map();
  const rows = Array.isArray(snapshots) ? snapshots : [];
  const snapshotTimes = new Set(rows.map(snapshot => String(snapshot?.at || '')).filter(Boolean));
  for (const snapshot of rows) {
    const cycle = snapshot?.decisionCycle;
    const snapshotAt = String(cycle?.snapshotAt || '');
    if (!snapshotTimes.has(snapshotAt) || (!Array.isArray(cycle?.entryIntents) && !Array.isArray(cycle?.rankedCandidates))) continue;
    cycles.set(snapshotAt, {
      ...cycle,
      snapshotAt,
      at:cycle.recordedAt || cycle.at || snapshot.at,
    });
  }
  return cycles;
}

function alignRecordedDecisionCycles(snapshots, cycles, maxDistanceMin = 6) {
  const source = Array.isArray(snapshots) ? snapshots : [];
  const rows = cycles instanceof Map ? [...cycles.values()] : [];
  if (!source.length || !rows.length) return new Map();
  const snapshotTimes = source.map(snapshot => new Date(snapshot.at).getTime());
  const maxDistanceMs = Math.max(0, Number(maxDistanceMin) || 0) * 60000;
  const aligned = new Map();

  const closestSnapshotIndex = target => {
    let low = 0;
    let high = snapshotTimes.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (snapshotTimes[mid] < target) low = mid + 1;
      else high = mid;
    }
    const candidates = [low, low - 1].filter(index => index >= 0 && index < snapshotTimes.length);
    return candidates.sort((a, b) => Math.abs(snapshotTimes[a] - target) - Math.abs(snapshotTimes[b] - target))[0];
  };

  for (const row of rows) {
    const target = new Date(row.snapshotAt || row.at).getTime();
    if (!Number.isFinite(target)) continue;
    const index = closestSnapshotIndex(target);
    if (!Number.isInteger(index) || Math.abs(snapshotTimes[index] - target) > maxDistanceMs) continue;
    const key = source[index].at;
    const current = aligned.get(key) || { snapshotAt:key, entryIntents:[], rankedCandidates:[] };
    const seenEntries = new Set(current.entryIntents.map(entry => String(entry?.symbol || '').toUpperCase()));
    for (const entry of Array.isArray(row.entryIntents) ? row.entryIntents : []) {
      const symbol = String(entry?.symbol || '').toUpperCase();
      if (symbol && !seenEntries.has(symbol)) {
        current.entryIntents.push(entry);
        seenEntries.add(symbol);
      }
    }
    current.rankedCandidates.push(...(Array.isArray(row.rankedCandidates) ? row.rankedCandidates : []));
    aligned.set(key, current);
  }
  return aligned;
}

function isEodSettlement(value, settings = {}) {
  return TradeRules.isSimulationEodSettlement(value, settings);
}

function isReplayEntryTimeBlocked(value, settings = {}) {
  const mins = istMinutes(value);
  return (Array.isArray(settings.REPLAY_ENTRY_BLOCK_RANGES) ? settings.REPLAY_ENTRY_BLOCK_RANGES : [])
    .some(range => mins >= Number(range?.startMin) && mins < Number(range?.endMin));
}

function runBacktest(snapshots, settings) {
  settings = TradeRules.withDefaults(settings);
  const replayControls = Object.fromEntries(Object.entries(settings).filter(([key]) =>
    key.startsWith('REPLAY_') || key.startsWith('PORTFOLIO_') || key.startsWith('__')
  ));
  
  // Clear memoization cache for fresh backtest
  SimulationEngine.clearFeeCache?.();
  
  const trades = [];
  let nextId = 1;
  let currentBySymbol = new Map();
  const lastKnownBySymbol = new Map();
  const previousCandidateBySymbol = new Map();
  const marketHistory = [];

  const startingCash = Number.isFinite(Number(settings.PORTFOLIO_AVAILABLE_CASH))
    ? Math.max(0, Number(settings.PORTFOLIO_AVAILABLE_CASH))
    : settings.PORTFOLIO_INITIAL_CAPITAL;

  const portfolio = {
    cash: startingCash,
    reservedCapital: 0,
  };

  const validatePortfolio = () => {
    if (portfolio.cash < 0) {
      console.warn('ERROR: Negative cash after trade', {
        cash: portfolio.cash,
        reserved: portfolio.reservedCapital,
        openTrades: trades.filter(t => t.status === 'open').length,
      });
    }
    if (portfolio.reservedCapital < 0) {
      console.warn('ERROR: Negative reserved capital', {
        reserved: portfolio.reservedCapital,
        cash: portfolio.cash,
      });
    }
  };

  const openTrades = () => trades.filter(t => t.status === 'open');
  const simOpenTrades = () => openTrades().filter(t => t.source === 'simulation');
  const openPositionCounts = () => {
    const counts = new Map();
    for (const trade of openTrades()) counts.set(trade.symbol, (counts.get(trade.symbol) || 0) + 1);
    return counts;
  };
  const openSideCounts = () => {
    const counts = new Map();
    for (const trade of openTrades()) {
      const side = String(trade.side || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
      counts.set(side, (counts.get(side) || 0) + 1);
    }
    return counts;
  };
  const realizedPnl = () => {
    const result = trades.filter(t => t.status === 'closed').reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    if (process.env.DEBUG_CASH && !Number.isFinite(result)) console.error(`DEBUG_CASH: realizedPnl=${result}`);
    return result;
  };
  const openExposure = () => {
    const result = openTrades().reduce((sum, t) => sum + (Number(t.entryPrice) * Number(t.qty) || 0), 0);
    if (process.env.DEBUG_CASH && !Number.isFinite(result)) console.error(`DEBUG_CASH: openExposure=${result}`);
    return result;
  };
  const cashAvailable = () => {
    const result = Math.max(0, portfolio.cash);
    if (process.env.DEBUG_CASH && !Number.isFinite(result)) {
      console.error(`DEBUG_CASH: cash=${portfolio.cash}, reserved=${portfolio.reservedCapital}, result=${result}`);
    }
    return result;
  };

  function dayStats(at) {
    return TradeRules.buildDayStats(trades, at, settings, {
      sameDay: (a, b) => !!a && !!b && istDisplayDate(a) === istDisplayDate(b),
    });
  }

  function entryBlockReason(sym, setupType, at) {
    const stats = dayStats(at);
    return TradeRules.getEntryBlockReason(sym, setupType, at, stats, settings);
  }

  function closeTrade(trade, exitPrice, reason, at, mark = false) {
    exitPrice = SimulationEngine.applyAdverseSlippage(exitPrice, trade.side, 'exit', settings);
    const reservedAmount = trade.entryPrice * trade.qty;
    portfolio.reservedCapital = Math.max(0, portfolio.reservedCapital - reservedAmount);

    const pnl = SimulationEngine.getPaperTradePnl(trade, exitPrice);
    const closingCash = reservedAmount + (pnl ? pnl.pnl : 0);
    portfolio.cash += closingCash;
    validatePortfolio();

    if (!pnl) {
      console.warn(`Warning: Could not calculate PnL for trade ${trade.id} at exit price ${exitPrice}`);
      Object.assign(trade, {
        status: 'closed',
        exitPrice: round2(exitPrice),
        closedAt: at,
        closeReason: reason,
        pnl: 0,
        grossPnl: 0,
        charges: 0,
        pnlPct: 0,
        mark,
      });
    } else {
      Object.assign(trade, {
        status: 'closed',
        exitPrice: round2(exitPrice),
        closedAt: at,
        closeReason: reason,
        pnl: pnl.pnl,
        grossPnl: pnl.grossPnl,
        charges: pnl.charges,
        pnlPct: pnl.pnlPct,
        mark,
      });
    }
  }

  function partialCloseTrade(trade, exitPrice, reason, at, qty, runner = false, newTarget = null, protectRemainder = false) {
    exitPrice = SimulationEngine.applyAdverseSlippage(exitPrice, trade.side, 'exit', settings);
    const closeQty = Math.floor(Number(qty));
    const openQty = Math.floor(Number(trade.qty));
    if (!Number.isFinite(closeQty) || closeQty <= 0 || closeQty >= openQty) return false;

    const releasedAmount = trade.entryPrice * closeQty;
    portfolio.reservedCapital = Math.max(0, portfolio.reservedCapital - releasedAmount);

    const partial = {
      ...trade,
      id: nextId++,
      parentId: trade.id,
      status: 'closed',
      qty: closeQty,
      reservedCapital: round2(closeQty * Number(trade.entryPrice)),
      exitPrice: round2(exitPrice),
      closedAt: at,
      closeReason: reason,
    };
    const pnl = SimulationEngine.getPaperTradePnl(partial, exitPrice);
    const closingCash = releasedAmount + (pnl ? pnl.pnl : 0);
    portfolio.cash += closingCash;
    validatePortfolio();

    if (pnl) {
      Object.assign(partial, {
        pnl: pnl.pnl,
        grossPnl: pnl.grossPnl,
        charges: pnl.charges,
        pnlPct: pnl.pnlPct,
      });
    } else {
      Object.assign(partial, {
        pnl: 0,
        grossPnl: 0,
        charges: 0,
        pnlPct: 0,
      });
    }
    trade.qty = openQty - closeQty;
    trade.reservedCapital = round2(Number(trade.entryPrice) * Number(trade.qty));
    trade.partialExits = Array.isArray(trade.partialExits) ? trade.partialExits : [];
    trade.partialExits.push({ id: partial.id, qty: closeQty, exitPrice: round2(exitPrice), closedAt: at, reason, pnl: pnl.pnl });
    trade._partialTargetBooked = true;
    trade._runnerArmed = true;
    trade._runnerWideTrail = !!runner;
    trade.target = Number.isFinite(Number(newTarget)) ? round2(newTarget) : null;
    if (protectRemainder) {
      if (String(trade.side || '').toLowerCase() === 'sell') trade._shortProfitLockArmed = true;
      else trade._longProfitLockArmed = true;
    }
    trades.push(partial);
    return true;
  }

  function scaleInMomentumRunner(trade, intent, at) {
    const addQty = Math.max(0, Math.floor(Number(intent?.qty) || 0));
    const observedPrice = Number(intent?.price);
    if (!trade || addQty <= 0 || !Number.isFinite(observedPrice) || observedPrice <= 0) return false;
    const fill = SimulationEngine.applyAdverseSlippage(observedPrice, trade.side, 'entry', settings);
    const oldQty = Math.max(0, Math.floor(Number(trade.qty) || 0));
    const oldEntry = Number(trade.entryPrice);
    const requiredCash = fill * addQty;
    if (oldQty <= 0 || !Number.isFinite(oldEntry) || requiredCash > cashAvailable() + 0.01) return false;
    const newQty = oldQty + addQty;
    const weightedEntry = ((oldEntry * oldQty) + (fill * addQty)) / newQty;
    const stopPct = Math.max(0.1, Number(settings.SIMULATION_RUNNER_INITIAL_STOP_PCT) || 0.8);
    trade.qty = newQty;
    trade.entryPrice = round2(weightedEntry);
    trade.stop = round2(String(trade.side || 'buy').toLowerCase() === 'sell'
      ? trade.entryPrice * (1 + stopPct / 100)
      : trade.entryPrice * (1 - stopPct / 100));
    trade.reservedCapital = round2(trade.entryPrice * newQty);
    trade._momentumRunnerScaledIn = true;
    trade._momentumRunnerFullQty = Math.max(newQty, Math.floor(Number(intent.plannedFullQty) || newQty));
    trade.scaleIns = [...(trade.scaleIns || []), {
      qty:addQty,
      price:round2(fill),
      at,
      reason:intent.reason,
      maxFavorablePct:intent.maxFavorablePct,
      vwap:intent.vwap,
      trigger:intent.trigger,
    }];
    portfolio.cash -= requiredCash;
    portfolio.reservedCapital += requiredCash;
    validatePortfolio();
    return true;
  }

  const recordedMode = settings.__recordedDecisionCycles instanceof Map;
  const recordedDecisionSymbols = recordedMode
    ? new Set([...settings.__recordedDecisionCycles.values()].flatMap(cycle => [
        ...(Array.isArray(cycle?.entryIntents) ? cycle.entryIntents : []),
        ...(Array.isArray(cycle?.rankedCandidates) ? cycle.rankedCandidates.filter(row => row?.selected) : []),
      ]).map(row => String(row?.symbol || '').toUpperCase()).filter(Boolean))
    : null;

  for (const snapshot of snapshots) {
    if (settings.REPLAY_USE_SNAPSHOT_SETTINGS !== false && snapshot?.caps && Object.keys(snapshot.caps).length) {
      settings = TradeRules.withDefaults({ ...snapshot.caps, ...replayControls });
    }
    marketHistory.push({ at:snapshot.at, market:snapshot.market || {}, sectorTrend:snapshot.sectorTrend || {} });
    while (marketHistory.length > 120) marketHistory.shift();
    currentBySymbol = new Map();
    const recordedCycle = recordedMode ? settings.__recordedDecisionCycles.get(snapshot.at) : null;
    const recordedEntryIntents = Array.isArray(recordedCycle?.entryIntents) ? recordedCycle.entryIntents : [];
    const recordedRows = Array.isArray(recordedCycle?.rankedCandidates) ? recordedCycle.rankedCandidates : [];
    const recordedSelectedRows = recordedRows.filter(row => row?.selected);
    const recordedSelectionRows = recordedSelectedRows.length ? recordedSelectedRows : recordedEntryIntents;
    const recordedRank = recordedMode
      ? new Map(recordedSelectionRows.map((row, index) => [
          String(row?.symbol || '').toUpperCase(),
          { ...row, selected:true, selectionRank:row?.selectionRank ?? index + 1 },
        ]))
      : null;
    const openSymbolSet = new Set(simOpenTrades().map(trade => String(trade.symbol || '').toUpperCase()));
    const candidatePool = recordedMode
      ? (snapshot.candidates || []).filter(candidate => {
          const symbol = String(candidate?.symbol || '').toUpperCase();
          return openSymbolSet.has(symbol) || recordedDecisionSymbols.has(symbol);
        })
      : (snapshot.candidates || []);
    for (const candidate of candidatePool) {
      if (settings.REPLAY_RECOMPUTE_SCORES) {
        rescoreReplayCandidate(candidate);
      }
      candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || null;
      SimulationEngine.applyFrozenEntryTrigger(candidate, candidate.previousCandidate, snapshot.at, settings);
      candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings, snapshot.at);
      
      // Pre-calculate risk metrics on each candidate
      const stop = candidate.indicators?.stop;
      const price = candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price;
      if (Number.isFinite(stop) && Number.isFinite(price) && price > 0) {
        candidate.preCalcStopPct = Math.abs(100 * (price - stop) / price);
        candidate.preCalcIsValidStop = candidate.preCalcStopPct <= 0.75; // MAX_STOP_PCT
      } else {
        candidate.preCalcStopPct = null;
        candidate.preCalcIsValidStop = false;
      }
      
      currentBySymbol.set(candidate.symbol, candidate);
      lastKnownBySymbol.set(candidate.symbol, candidate);
      previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
    }
    for (const open of snapshot.openSimulationTrades || []) {
      if (!currentBySymbol.has(open.symbol)) {
        const storedManagement = open.managementCandidate && typeof open.managementCandidate === 'object'
          ? open.managementCandidate
          : {};
        const storedIndicators = storedManagement.indicators && typeof storedManagement.indicators === 'object'
          ? storedManagement.indicators
          : {};
        const fallback = {
          ...storedManagement,
          symbol: open.symbol,
          price: open.priceAtSnapshot,
          priceAtSnapshot: open.priceAtSnapshot,
          score:Number.isFinite(Number(storedManagement.score)) ? Number(storedManagement.score) : 0,
          candles:Array.isArray(storedManagement.candles) ? storedManagement.candles : [],
          sectorPriority:storedManagement.sectorPriority || open.sectorPriority || null,
          indicators: {
            ...storedIndicators,
            price:open.priceAtSnapshot,
            ohlc: open.ohlc || storedIndicators.ohlc || null,
          },
        };
        fallback.derivedSetupType = SimulationEngine.deriveSetupType(fallback, settings, snapshot.at);
        currentBySymbol.set(open.symbol, fallback);
      }
    }

    for (const trade of simOpenTrades().slice()) {
      const candidate = currentBySymbol.get(trade.symbol);
      const price = Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      
      // Reconstruct the most adverse observed price for emergency-stop parity.
      // Normal stops are still confirmed by completed candle closes inside the
      // shared simulation engine, so an intrabar wick cannot bypass grace or
      // confirmation settings.
      const stop = Number(trade.stop);
      const entry = Number(trade.entryPrice);
      const side = String(trade.side || 'buy').toLowerCase();
      let exit = null;
      const favorablePct = side === 'sell' ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
      trade._maxFavorablePct = Math.max(Number(trade._maxFavorablePct) || 0, favorablePct);
      trade._maxAdversePct = Math.max(Number(trade._maxAdversePct) || 0, -favorablePct);
      
      const candle = SimulationEngine.getLatestCandidateCandle?.(candidate);
      const candleAt = candle ? new Date(candle.time).getTime() : NaN;
      const openedAt = new Date(trade.openedAt).getTime();
      const usableCandle = candle && Number.isFinite(candleAt) && Number.isFinite(openedAt) && candleAt > openedAt;
      if (Number.isFinite(stop) && stop > 0 && Number.isFinite(entry) && entry > 0) {
        const adverseObservedPrice = usableCandle
          ? (side === 'buy' ? Number(candle.low) : Number(candle.high))
          : price;
        const stopBreached = side === 'buy' ? adverseObservedPrice <= stop : adverseObservedPrice >= stop;
        if (stopBreached) {
          exit = SimulationEngine.getSimulationStopExit(
            trade,
            adverseObservedPrice,
            candidate,
            snapshot.at,
            settings
          );
        }
      }

      // Replay completed candle ranges conservatively. A same-bar stop wins over
      // a target because tick ordering is unavailable; live simulation continues
      // to use its observed streaming price.
      const target = Number(trade.target);
      if (!exit && usableCandle && Number.isFinite(target) && target > 0) {
        const targetReached = side === 'buy' ? candle.high >= target : candle.low <= target;
        if (targetReached) {
          const targetCandidate = {
            ...candidate,
            price: target,
            priceAtSnapshot: target,
            quote: { ...(candidate.quote || {}), price: target },
            indicators: { ...(candidate.indicators || {}), price: target },
          };
          exit = SimulationEngine.getSimulationExit(trade, target, targetCandidate, snapshot.at, settings, { isEodSettlement: false, market:snapshot.market || {} });
        }
      }
      
      // If no stop loss exit, use normal simulation exit logic
      if (!exit) {
        exit = SimulationEngine.getSimulationExit(trade, price, candidate, snapshot.at, settings, { isEodSettlement: isEodSettlement(snapshot.at, settings), market:snapshot.market || {} });
      }
      
      if (exit?.action === 'partial') {
        const qty = Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100));
        partialCloseTrade(trade, exit.exitPrice, exit.reason, snapshot.at, qty, exit.runner, exit.newTarget, exit.protectRemainder);
      } else if (exit) {
        closeTrade(trade, exit.exitPrice, exit.reason, snapshot.at);
      } else if (isEntryWindow(snapshot.at, settings) && !isEodSettlement(snapshot.at, settings)) {
        const equity = startingCash + realizedPnl();
        const heat = TradeRules.computePortfolioHeat(trades, equity);
        const maxHeatRisk = equity * (Number(settings.SIMULATION_MAX_PORTFOLIO_HEAT_PCT || 5) / 100);
        const maxSectorRisk = equity * (Number(settings.SIMULATION_MAX_SECTOR_HEAT_PCT || 2) / 100);
        const sectorRisk = Number(heat.bySector[String(trade.sector || candidate?.sector || 'UNKNOWN')] || 0);
        const grossLimit = equity * (Number(settings.SIMULATION_MAX_GROSS_EXPOSURE_PCT || 80) / 100);
        const scaleIn = SimulationEngine.getMomentumRunnerScaleInIntent(trade, candidate, price, settings, {
          cashAvailable:cashAvailable(),
          remainingGrossCapacity:Math.max(0, grossLimit - openExposure()),
          remainingHeatRisk:Math.max(0, maxHeatRisk - heat.risk),
          sectorHeatRemaining:Math.max(0, maxSectorRisk - sectorRisk),
        });
        if (scaleIn) scaleInMomentumRunner(trade, scaleIn, snapshot.at);
      }
    }

    if (!isEntryWindow(snapshot.at, settings) || isEodSettlement(snapshot.at, settings) ||
        isReplayEntryTimeBlocked(snapshot.at, settings)) continue;

    let slots = Math.max(0, Math.min(
      settings.SIMULATION_MAX_OPEN - openTrades().length,
      settings.SIMULATION_MAX_ACTIVE_OPEN - simOpenTrades().length,
    ));
    if (slots <= 0 || cashAvailable() <= 0) continue;

    const blockedSetups = new Set(
      (Array.isArray(settings.REPLAY_BLOCKED_SETUPS) ? settings.REPLAY_BLOCKED_SETUPS : [])
        .map(setup => String(setup || '').toUpperCase())
    );
    const replayCandidates = (recordedMode
      ? candidatePool
          .filter(candidate => recordedRank.get(String(candidate?.symbol || '').toUpperCase())?.selected)
          .sort((a, b) => Number(recordedRank.get(String(a?.symbol || '').toUpperCase())?.selectionRank ?? Number.MAX_SAFE_INTEGER) -
            Number(recordedRank.get(String(b?.symbol || '').toUpperCase())?.selectionRank ?? Number.MAX_SAFE_INTEGER))
      : candidatePool)
      .filter(candidate => !blockedSetups.has(String(candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase()));
    const candidates = SimulationEngine.selectSimulationEntryCandidates(
      replayCandidates,
      snapshot.at,
      settings,
      {
        openSymbols: new Set(openTrades().map(t => t.symbol)),
        openPositionCounts: openPositionCounts(),
        openSideCounts: openSideCounts(),
        openTrades: openTrades(),
        closedTrades: trades.filter(t => t?.status === 'closed'),
        entryBlockReason: (symbol, setupType) => entryBlockReason(symbol, setupType, snapshot.at),
        market: snapshot.market,
        sectorTrend: snapshot.sectorTrend,
        marketHistory,
        indices: snapshot.market?.indices,
        dayStats: dayStats(snapshot.at),
      }
    );

    let openedThisCycle = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (slots <= 0 || openedThisCycle >= settings.SIMULATION_MAX_NEW_PER_CYCLE) break;
      const candidate = candidates[i];
      const currentOpenTrades = openTrades();
      if (currentOpenTrades.length >= Number(settings.SIMULATION_MAX_OPEN || 10) ||
          simOpenTrades().length >= Number(settings.SIMULATION_MAX_ACTIVE_OPEN || 8)) break;
      const setupType = candidate.derivedSetupType || candidate.setupType || '';
      const block = entryBlockReason(candidate.symbol, setupType, snapshot.at);
      if (block) {
        if (/daily/i.test(block)) break;
        continue;
      }
      const observedPrice = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (!Number.isFinite(observedPrice) || observedPrice <= 0) continue;
      const side = candidate.side || candidate.signal || 'buy';
      if (side === 'sell' && currentOpenTrades.filter(trade => String(trade.side).toLowerCase() === 'sell').length >=
          Number(settings.SIMULATION_MAX_CONCURRENT_SHORTS || 4)) continue;
      const price = SimulationEngine.applyAdverseSlippage(observedPrice, side, 'entry', settings);
      const remainingCandidates = Math.max(1, candidates.length - i);
      const remainingSlots = Math.max(1, Math.min(slots, remainingCandidates));
      const entryCash = cashAvailable();
      if (entryCash <= 0) continue;
      const equityBeforeEntry = startingCash + realizedPnl();
      const maxGrossExposure = equityBeforeEntry * Number(settings.SIMULATION_MAX_GROSS_EXPOSURE_PCT || 80) / 100;
      const remainingGrossCapacity = Math.max(0, maxGrossExposure - openExposure());
      if (remainingGrossCapacity < price) continue;
      const allocation = Math.min(settings.MAX_POSITION_EXPOSURE, entryCash / remainingSlots, remainingGrossCapacity);
      // Use shared function for position sizing
      const closedTrades = trades.filter(t => t.status === 'closed');
      const positionSizingMultiplier = TradeRules.computePositionSizeMultiplier(closedTrades);
      const runnerInitialMultiplier = Math.max(
        0.1,
        Math.min(1, Number(settings.SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER) || 0.5)
      );
      const setupPositionMultiplier = setupType === 'TOP_GAINER_PULLBACK_RECLAIM'
        ? Math.max(0.1, Math.min(1, Number(settings.SIMULATION_TOP_GAINER_PULLBACK_POSITION_MULTIPLIER) || 0.5))
        : (setupType === 'TOP_LOSER_BEAR_FLAG'
          ? Math.max(0.1, Math.min(1, Number(settings.SIMULATION_TOP_LOSER_POSITION_MULTIPLIER) || 0.5))
          : (setupType === 'RANGEBOUND'
            ? Math.max(0.1, Math.min(1, Number(settings.SIMULATION_RANGEBOUND_POSITION_MULTIPLIER) || 0.5))
            : (setupType === 'MOMENTUM_RUNNER' ? runnerInitialMultiplier : 1)));
      const fullSuggestion = setupType === 'MOMENTUM_RUNNER'
        ? SimulationEngine.getSuggestedQty(candidate, side, price, entryCash, allocation, settings, positionSizingMultiplier)
        : null;
      const suggestion = SimulationEngine.getSuggestedQty(candidate, side, price, entryCash, allocation, settings, positionSizingMultiplier * setupPositionMultiplier);
      if (suggestion.qty <= 0) continue;
      
      // qty is already applied inside getSuggestedQty with the multiplier
      let adjustedQty = Math.max(1, suggestion.qty);
      const equity = startingCash + realizedPnl();
      const heat = TradeRules.computePortfolioHeat(trades, equity);
      const maxHeatRisk = equity * (Number(settings.SIMULATION_MAX_PORTFOLIO_HEAT_PCT || 5) / 100);
      const sectorRisk = Number(heat.bySector[String(candidate.sector || 'UNKNOWN')] || 0);
      const maxSectorRisk = equity * (Number(settings.SIMULATION_MAX_SECTOR_HEAT_PCT || 2) / 100);
      const riskPerShare = Number(suggestion.riskPerShare) || 0;
      if (riskPerShare > 0) adjustedQty = Math.min(adjustedQty, Math.floor(Math.max(0, maxHeatRisk - heat.risk) / riskPerShare), Math.floor(Math.max(0, maxSectorRisk - sectorRisk) / riskPerShare));
      adjustedQty = Math.min(adjustedQty, Math.floor(remainingGrossCapacity / price));
      if (adjustedQty <= 0) continue;
      
      if (process.env.DEBUG_QTY && (trades.length < 2 || !Number.isFinite(suggestion.qty))) {
        console.error(`DEBUG: suggestion.qty=${suggestion.qty}, cashAvail=${cashAvailable()}, allocation=${allocation}, byCash=${suggestion.cashLimit}`);
      }
      const plannedFullQty = setupType === 'MOMENTUM_RUNNER'
        ? Math.max(adjustedQty, Math.min(
            Math.floor(Number(fullSuggestion?.qty) || adjustedQty),
            riskPerShare > 0 ? Math.floor(Math.max(0, maxHeatRisk - heat.risk) / riskPerShare) : Number.MAX_SAFE_INTEGER,
            riskPerShare > 0 ? Math.floor(Math.max(0, maxSectorRisk - sectorRisk) / riskPerShare) : Number.MAX_SAFE_INTEGER,
            Math.floor(remainingGrossCapacity / price)
          ))
        : adjustedQty;
      trades.push({
        id: nextId++,
        symbol: candidate.symbol,
        name: candidate.name || candidate.symbol,
        side,
        qty: adjustedQty,
        entryPrice: round2(price),
        target: suggestion.plan.target,
        stop: suggestion.plan.stop,
        signal: side,
        score: Math.abs(Number(candidate.score) || 0),
        decisionScore: SimulationEngine.getCandidateDecisionScore(candidate),
        rr: candidate.indicators?.rr,
        source: 'simulation',
        assetType: 'stock',
        sector:candidate.sector || '',
        costProfile:settings.SIMULATION_COST_PROFILE || 'zerodha_intraday',
        reservedCapital: round2(adjustedQty * price),
        setupType,
        _momentumRunnerFullQty:setupType === 'MOMENTUM_RUNNER' ? plannedFullQty : undefined,
        _momentumRunnerInitialQty:setupType === 'MOMENTUM_RUNNER' ? adjustedQty : undefined,
        setup: ['Simulation', setupType, candidate.indicators?.entryStatus, candidate.indicators?.entryTrigger]
          .filter(Boolean).join(' | '),
        entryContext: {
          selectedRank:i + 1,
          score:Number(candidate.score) || 0,
          decisionScore:SimulationEngine.getCandidateDecisionScore(candidate),
          scoreAudit:candidate.scoreAudit || null,
          side,
          setupType,
          plannedFullQty:setupType === 'MOMENTUM_RUNNER' ? plannedFullQty : undefined,
          initialPositionMultiplier:setupType === 'MOMENTUM_RUNNER' ? runnerInitialMultiplier : undefined,
          sectorAligned:!!candidate.sectorPriority?.aligned,
          sectorPriority:candidate.sectorPriority || null,
          reason:`selected rank ${i + 1}`,
          blockReason:candidate.blockReason || '',
          decision:candidate.decision || null,
          snapshotId:candidate.__snapshotId || snapshot.id || null,
          snapshotAt:candidate.__snapshotAt || snapshot.at,
          candleTime:SimulationEngine.getLatestCandidateCandle?.(candidate)?.time || null,
          dataAgeMin:candidate.freshness?.ageMin ?? null,
          indicatorSnapshot:SimulationEngine.buildIndicatorAuditSnapshot(candidate),
          settingsSnapshot:SimulationEngine.buildSettingsAuditSnapshot(settings),
          settingsFingerprint:SimulationEngine.stableAuditFingerprint(SimulationEngine.buildSettingsAuditSnapshot(settings)),
          confirmation:SimulationEngine.getEntryConfirmation(candidate, candidate.previousCandidate, side, snapshot.at, settings),
          indicators:{
            entryStatus:candidate.indicators?.entryStatus || '',
            entryTrigger:candidate.indicators?.entryTrigger || '',
            vwap:candidate.indicators?.vwap ?? null,
            vwapBandPosition:candidate.indicators?.vwapBandPosition ?? null,
            ema9:candidate.indicators?.ema9 ?? candidate.indicators?.emaShort ?? null,
            ema20:candidate.indicators?.ema20 ?? candidate.indicators?.emaLong ?? null,
            rsi:candidate.indicators?.rsi ?? null,
            superTrendDirection:candidate.indicators?.superTrendDirection ?? null,
            relVolume:candidate.indicators?.relVolumeTimeAdjusted ?? candidate.indicators?.relVolume ?? null,
          },
        },
        openedAt: snapshot.at,
        status: 'open',
      });
      const reservedAmount = round2(adjustedQty * price);
      portfolio.reservedCapital += reservedAmount;
      portfolio.cash -= reservedAmount;
      validatePortfolio();
      slots -= 1;
      openedThisCycle += 1;
    }
  }

  const lastPrice = new Map();
  const lastAt = new Map();
  for (const snapshot of snapshots) {
    for (const candidate of snapshot.candidates || []) {
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (Number.isFinite(price) && price > 0) {
        lastPrice.set(candidate.symbol, price);
        lastAt.set(candidate.symbol, snapshot.at);
      }
    }
  }
  for (const trade of simOpenTrades().slice()) {
    const price = lastPrice.get(trade.symbol);
    if (Number.isFinite(price)) closeTrade(trade, price, 'Backtest mark at last snapshot', lastAt.get(trade.symbol) || snapshots.at(-1)?.at, true);
  }

  return summarize(trades, snapshots, settings, startingCash, portfolio);
}

function summarize(trades, snapshots, settings, startingCash = settings.PORTFOLIO_INITIAL_CAPITAL, portfolio = null) {
  const closed = trades.filter(t => t.status === 'closed');
  const wins = closed.filter(t => t.pnl > 0).length;
  const gross = closed.reduce((sum, t) => sum + (Number(t.grossPnl) || 0), 0);
  const fees = closed.reduce((sum, t) => sum + (Number(t.charges) || 0), 0);
  const net = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);

  const byDay = {};
  const bySetup = {};
  const byReason = {};
  const bySide = {};
  for (const trade of closed) {
    addBucket(byDay, istDisplayDate(trade.openedAt), trade);
    addBucket(bySetup, trade.setupType || 'UNKNOWN', trade);
    addBucket(byReason, trade.closeReason || 'Unknown', trade);
    addBucket(bySide, String(trade.side || 'buy').toUpperCase(), trade);
  }

  const cleanBuckets = buckets => Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, finishBucket(value)]));
  const opportunityReport = settings.REPLAY_SKIP_OPPORTUNITIES
    ? {
        missed:{ longProfit:[], shortProfit:[], longRisk:[], shortRisk:[] },
        dataQuality:[],
        dataQualitySummary:{ skipped:true, reason:'opportunity analysis disabled for faster replay' },
      }
    : buildOpportunityReport(snapshots, closed, settings);
  const candleCoveragePct = Number(opportunityReport.dataQualitySummary?.candleCoveragePct) || 0;
  const replayConfidence = {
    grade:candleCoveragePct >= 99 ? 'A' : candleCoveragePct >= 95 ? 'B' : candleCoveragePct >= 80 ? 'C' : 'D',
    candleCoveragePct,
    note:candleCoveragePct >= 95 ? 'High candle coverage' : 'Results include material price-only replay observations',
  };
  const risk = computeRiskStats(closed, settings.PORTFOLIO_INITIAL_CAPITAL);
  const quality = SimulationEngine.summarizeTradeQuality(closed, settings);
  const replayReliability = assessReplayReliability(snapshots, settings);
  if (process.env.DEBUG_QTY && closed.length > 0) {
    console.error(`DEBUG: First closed trade qty=${closed[0].qty}, keys=${Object.keys(closed[0]).slice(0,10).join(',')}`);
  }
  const all = closed.map(formatTrade);
  return {
    snapshots: snapshots.length,
    first: snapshots[0]?.at || null,
    last: snapshots.at(-1)?.at || null,
    settings: {
      capital: settings.PORTFOLIO_INITIAL_CAPITAL,
      availableCash: round2(startingCash),
      capitalSource: settings.PORTFOLIO_CAPITAL_SOURCE || 'dashboard default',
      settingsSource:settings.REPLAY_SETTINGS_SOURCE || 'current-settings-fallback',
      capitalDetail: settings.PORTFOLIO_CAPITAL_DETAIL || null,
      maxOpen: settings.SIMULATION_MAX_OPEN,
      maxActiveOpen: settings.SIMULATION_MAX_ACTIVE_OPEN,
      maxNewPerCycle: settings.SIMULATION_MAX_NEW_PER_CYCLE,
      firstHourMaxEntries: settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES,
      dailyMaxTrades: settings.SIMULATION_DAILY_MAX_TRADES,
      dailyMaxStops: settings.SIMULATION_DAILY_MAX_STOPS,
      dailyMaxStopsWhenProfitBuffer: settings.SIMULATION_DAILY_MAX_STOPS * (settings.SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER || 1),
      dailyStopProfitBufferPct: settings.SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT,
      maxPositionExposure: settings.MAX_POSITION_EXPOSURE,
      replayMode: settings.REPLAY_SHORT_ONLY ? 'short-only' : settings.REPLAY_LONG_ONLY ? 'long-only' : 'long+short',
      minScore: settings.SIMULATION_MIN_SCORE,
      shortMinScore: settings.SIMULATION_SHORT_MIN_SCORE,
    },
    summary: {
      trades: closed.length,
      wins,
      losses: closed.length - wins,
      winRate: round1((wins / Math.max(1, closed.length)) * 100),
      gross: round2(gross),
      fees: round2(fees),
      net: round2(net),
      returnPct: round3((net / settings.PORTFOLIO_INITIAL_CAPITAL) * 100),
      maxDrawdown: risk.maxDrawdown,
      maxDrawdownPct: risk.maxDrawdownPct,
      maxLossStreak: risk.maxLossStreak,
      currentLossStreak: risk.currentLossStreak,
      endingCash: round2(portfolio?.cash ?? (startingCash + net)),
      reservedCapital: round2(portfolio?.reservedCapital || 0),
      reconciliationDifference: round2((portfolio?.cash ?? (startingCash + net)) + (portfolio?.reservedCapital || 0) - (startingCash + net)),
    },
    byDay: cleanBuckets(byDay),
    bySetup: cleanBuckets(bySetup),
    byReason: cleanBuckets(byReason),
    bySide: cleanBuckets(bySide),
    quality,
    missed: opportunityReport.missed,
    dataQuality: opportunityReport.dataQuality,
    dataQualitySummary: opportunityReport.dataQualitySummary,
    replayConfidence,
    replayReliability,
    top: closed.slice().sort((a, b) => b.pnl - a.pnl).slice(0, 8).map(formatTrade),
    bottom: closed.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 8).map(formatTrade),
    trades: all,
  };
}

function computeRiskStats(closedTrades, capital) {
  const closed = (Array.isArray(closedTrades) ? closedTrades : [])
    .slice()
    .sort((a, b) => new Date(a.closedAt || a.openedAt || 0) - new Date(b.closedAt || b.openedAt || 0));
  let equity = Number(capital) || 0;
  let peak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;
  let currentLossStreak = 0;
  for (const trade of closed) {
    const pnl = Number(trade.pnl) || 0;
    equity += pnl;
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
    if (pnl < 0) {
      lossStreak += 1;
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
      currentLossStreak = 0;
    }
  }
  return {
    maxDrawdown:round2(maxDrawdown),
    maxDrawdownPct:round3(maxDrawdownPct),
    maxLossStreak,
    currentLossStreak,
  };
}

function buildOpportunityReport(snapshots, closedTrades, settings) {
  const lastPrice = new Map();
  const lastAt = new Map();
  const traded = new Set(closedTrades.map(t => `${t.symbol}|${String(t.side || '').toLowerCase()}`));
  const qualityCounts = {};
  const qualitySymbols = new Set();
  const affectedSnapshotIds = new Set();
  let candidateObservations = 0;
  let affectedObservations = 0;
  let marketSnapshots = 0;
  let afterHoursSnapshots = 0;
  let candleObservations = 0;
  let missingCandleObservations = 0;
  const bySymbolSide = new Map();
  const previousCandidateBySymbol = new Map();
  const marketHistory = [];
  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const candidates = snapshot.candidates || [];
    SimulationEngine.annotateTopGainerRanks(candidates, settings);
    marketHistory.push({ at:snapshot.at, market:snapshot.market || {}, sectorTrend:snapshot.sectorTrend || {} });
    while (marketHistory.length > 120) marketHistory.shift();
    const duringMarket = isEntryWindow(snapshot.at, settings) || isEodSettlement(snapshot.at, settings);
    if (duringMarket) marketSnapshots += 1;
    else afterHoursSnapshots += 1;
    for (const candidate of candidates) {
      candidateObservations += 1;
      const latestCandle = SimulationEngine.getLatestCandidateCandle?.(candidate);
      if (latestCandle) candleObservations += 1;
      else missingCandleObservations += 1;
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (Number.isFinite(price) && price > 0) {
        lastPrice.set(candidate.symbol, price);
        lastAt.set(candidate.symbol, snapshot.at);
      }
      if (!candidate || candidate.assetType === 'etf') continue;
      candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || candidate.previousCandidate || null;
      SimulationEngine.applyFrozenEntryTrigger(candidate, candidate.previousCandidate, snapshot.at, settings);
      candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings, snapshot.at);
       
      // Pre-calculate risk metrics on each candidate
      const stop = candidate.indicators?.stop;
      if (Number.isFinite(stop) && Number.isFinite(price) && price > 0) {
        candidate.preCalcStopPct = Math.abs(100 * (price - stop) / price);
        candidate.preCalcIsValidStop = candidate.preCalcStopPct <= 0.75; // MAX_STOP_PCT
      } else {
        candidate.preCalcStopPct = null;
        candidate.preCalcIsValidStop = false;
      }
       
      previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
      const side = candidate.side || candidate.signal;
      if (!['buy', 'sell'].includes(side)) continue;
      const explanation = SimulationEngine.explainCandidateEligibility(candidate, snapshot.at, settings, {
        previousCandidate: candidate.previousCandidate,
        market: snapshot.market,
        sectorTrend: snapshot.sectorTrend,
        indices: snapshot.market?.indices,
        marketHistory,
      });
      const candidateIssues = SimulationEngine.getDataQualityIssues(candidate, settings);
      if (!latestCandle) candidateIssues.push('missing replay candle');
      if (candidateIssues.length) {
        affectedObservations += 1;
        qualitySymbols.add(String(candidate.symbol || '').toUpperCase());
        affectedSnapshotIds.add(String(snapshot.id || snapshot.at || 'unknown'));
      }
      for (const issue of candidateIssues) {
        qualityCounts[issue] = (qualityCounts[issue] || 0) + 1;
      }
      if (traded.has(`${candidate.symbol}|${side}`)) continue;
      const key = `${candidate.symbol}|${side}`;
      const existing = bySymbolSide.get(key);
      const score = Math.abs(Number(candidate.score) || 0);
      if (!existing || score > existing.absScore) {
        bySymbolSide.set(key, {
          symbol: candidate.symbol,
          side,
          setup: explanation.setupType || candidate.derivedSetupType || candidate.setupType || '',
          score: Number(candidate.score) || 0,
          absScore: score,
          entry: price,
          at: snapshot.at,
          reasons: explanation.eligible ? ['eligible but not selected: rank, slot, cash, cooldown, or top-N limit'] : explanation.reasons,
          snapshotIndex,
          candidate:JSON.parse(JSON.stringify(candidate)),
        });
      }
    }
  }
  const opportunities = [];
  for (const item of bySymbolSide.values()) {
    if (!Number.isFinite(item.entry) || item.entry <= 0) continue;
    const qty = Math.max(1, Math.floor(settings.MAX_POSITION_EXPOSURE / item.entry));
    const entry = SimulationEngine.applyAdverseSlippage(item.entry, item.side, 'entry', settings);
    const plan = SimulationEngine.getPaperPlanForCandidate(item.candidate, item.side, entry, settings);
    const hypothetical = { symbol:item.symbol, side:item.side, qty, entryPrice:entry, target:plan.target, stop:plan.stop, openedAt:item.at, setupType:item.setup, costProfile:settings.SIMULATION_COST_PROFILE || 'zerodha_intraday' };
    let exit = null;
    let exitAt = null;
    let exitReason = 'Hypothetical market-hours mark';
    for (let i = Number(item.snapshotIndex) + 1; i < snapshots.length; i += 1) {
      const snap = snapshots[i];
      const candidate = (snap.candidates || []).find(row => row.symbol === item.symbol);
      if (!candidate) continue;
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!isEntryWindow(snap.at, settings) && !isEodSettlement(snap.at, settings) && istMinutes(snap.at) > Number(settings.SIMULATION_EOD_SETTLEMENT_MIN || 915)) continue;
      const decision = SimulationEngine.getSimulationExit(hypothetical, price, candidate, snap.at, settings, { isEodSettlement:isEodSettlement(snap.at, settings) });
      exit = price;
      exitAt = snap.at;
      if (decision) {
        exit = Number(decision.exitPrice) || price;
        exitReason = decision.reason;
        break;
      }
    }
    if (!Number.isFinite(exit) || exit <= 0) continue;
    exit = SimulationEngine.applyAdverseSlippage(exit, item.side, 'exit', settings);
    const pnl = SimulationEngine.getPaperTradePnl(hypothetical, exit);
    const movePct = item.side === 'sell'
      ? ((entry - exit) / entry) * 100
      : ((exit - entry) / entry) * 100;
    opportunities.push({
      ...item,
      candidate:undefined,
      snapshotIndex:undefined,
      entry,
      exit,
      exitAt,
      qty,
      movePct:round2(movePct),
      net:pnl?.pnl ?? 0,
      charges:pnl?.charges ?? 0,
      reason:`${item.reasons.slice(0, 3).join(' | ')} | hypothetical: ${exitReason}`,
    });
  }
  const profitable = side => opportunities
    .filter(o => o.side === side && o.net > 0)
    .sort((a, b) => b.net - a.net)
    .slice(0, 10)
    .map(formatOpportunity);
  const harmful = side => opportunities
    .filter(o => o.side === side)
    .sort((a, b) => a.net - b.net)
    .slice(0, 6)
    .map(formatOpportunity);
  return {
    missed: {
      longProfit: profitable('buy'),
      shortProfit: profitable('sell'),
      longRisk: harmful('buy'),
      shortRisk: harmful('sell'),
    },
    dataQuality: Object.entries(qualityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([issue, count]) => ({ issue, count })),
    dataQualitySummary: {
      snapshots: snapshots.length,
      marketSnapshots,
      afterHoursSnapshots,
      affectedSnapshots: affectedSnapshotIds.size,
      candidateObservations,
      affectedObservations,
      affectedSymbols: qualitySymbols.size,
      candleObservations,
      missingCandleObservations,
      candleCoveragePct: round1(candleObservations / Math.max(1, candidateObservations) * 100),
    },
  };
}

function formatOpportunity(item) {
  return {
    symbol:item.symbol,
    side:item.side,
    setup:item.setup,
    score:item.score,
    entry:round2(item.entry),
    exit:round2(item.exit),
    net:round2(item.net),
    movePct:item.movePct,
    at:item.at,
    exitAt:item.exitAt,
    reason:item.reason,
  };
}

function addBucket(buckets, key, trade) {
  buckets[key] ||= { trades: 0, wins: 0, gross: 0, fees: 0, net: 0 };
  buckets[key].trades += 1;
  if (trade.pnl > 0) buckets[key].wins += 1;
  buckets[key].gross += Number(trade.grossPnl) || 0;
  buckets[key].fees += Number(trade.charges) || 0;
  buckets[key].net += Number(trade.pnl) || 0;
}

function finishBucket(bucket) {
  return {
    trades: bucket.trades,
    wins: bucket.wins,
    losses: bucket.trades - bucket.wins,
    winRate: round1((bucket.wins / Math.max(1, bucket.trades)) * 100),
    gross: round2(bucket.gross),
    fees: round2(bucket.fees),
    net: round2(bucket.net),
  };
}

function formatTrade(trade) {
  return {
    symbol: trade.symbol,
    setup: trade.setupType || 'UNKNOWN',
    side: trade.side,
    qty: trade.qty,
    entry: trade.entryPrice,
    exit: trade.exitPrice,
    gross: trade.grossPnl,
    fees: trade.charges,
    net: trade.pnl,
    netPct: trade.pnlPct,
    reason: trade.closeReason,
    entryReason: trade.entryContext?.reason || trade.setup || '--',
    opened: trade.openedAt,
    closed: trade.closedAt,
    mark: !!trade.mark,
    maxFavorablePct: round2(trade._maxFavorablePct),
    maxAdversePct: round2(trade._maxAdversePct),
  };
}

function printReport(result) {
  const money = n => `Rs ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  console.log('Simulation Backtest');
  console.log('===================');
  console.log(`Snapshots : ${result.snapshots}`);
  console.log(`Range     : ${result.first || '--'} to ${result.last || '--'}`);
  console.log(`Capital   : ${money(result.settings.capital)} (${result.settings.capitalSource})`);
  if (result.settings.capitalDetail) {
    const d = result.settings.capitalDetail;
    console.log(`Portfolio : capital ${money(d.capital)}, realized ${money(d.realized)}, open exposure ${money(d.openExposure)}, trades ${d.tradeCount}`);
  }
  console.log(`Settings  : ${result.settings.replayMode}, score ${result.settings.minScore}, shortScore ${result.settings.shortMinScore}, active ${result.settings.maxActiveOpen}, total ${result.settings.maxOpen}, per-cycle ${result.settings.maxNewPerCycle}, first-hour ${result.settings.firstHourMaxEntries}`);
  console.log('');
  console.log(`Trades    : ${result.summary.trades} (${result.summary.wins} wins / ${result.summary.losses} losses, ${result.summary.winRate}% win rate)`);
  console.log(`Gross P/L : ${money(result.summary.gross)}`);
  console.log(`Costs     : ${money(result.summary.fees)}`);
  console.log(`Net P/L   : ${money(result.summary.net)} (${result.summary.returnPct}%)`);
  console.log(`Drawdown  : ${money(result.summary.maxDrawdown)} (${result.summary.maxDrawdownPct}%)`);
  console.log(`Confidence: ${result.replayConfidence?.grade || '--'} (${result.replayConfidence?.candleCoveragePct || 0}% candle coverage)`);
  console.log(`Loss run  : ${result.summary.currentLossStreak} current / ${result.summary.maxLossStreak} max`);
  console.log('');
  printBucket('By Day', result.byDay, money);
  printBucket('By Side', result.bySide, money);
  printBucket('By Setup', result.bySetup, money);
  printMissed('Missed Long Opportunities', result.missed?.longProfit || [], money);
  printMissed('Missed Short Opportunities', result.missed?.shortProfit || [], money);
  printMissed('Avoided Long Risks', result.missed?.longRisk || [], money);
  printMissed('Avoided Short Risks', result.missed?.shortRisk || [], money);
  printDataQuality(result.dataQuality || []);
  console.log('Top Trades');
  printTrades(result.top, money);
  console.log('');
  console.log('Worst Trades');
  printTrades(result.bottom, money);
  console.log('');
  console.log('All Transactions');
  printTransactions(result.trades, money);
}

function printMissed(title, rows, money) {
  console.log(title);
  if (!rows.length) {
    console.log('  --');
    console.log('');
    return;
  }
  for (const row of rows.slice(0, 8)) {
    console.log(`  ${row.symbol.padEnd(12)} ${String(row.side).toUpperCase().padEnd(4)} ${money(row.net).padStart(12)} | score ${String(row.score).padStart(4)} | ${row.setup || '--'} | ${row.reason || '--'}`);
  }
  console.log('');
}

function printDataQuality(rows) {
  console.log('Data Quality Flags');
  if (!rows.length) {
    console.log('  --');
    console.log('');
    return;
  }
  for (const row of rows.slice(0, 8)) {
    console.log(`  ${String(row.issue).padEnd(42)} ${row.count}`);
  }
  console.log('');
}

function printBucket(title, buckets, money) {
  console.log(title);
  const entries = Object.entries(buckets);
  if (!entries.length) {
    console.log('  --');
    console.log('');
    return;
  }
  for (const [key, value] of entries) {
    console.log(`  ${key}: ${money(value.net)} | ${value.trades} trades | ${value.winRate}% win`);
  }
  console.log('');
}

function printTrades(trades, money) {
  if (!trades.length) {
    console.log('  --');
    return;
  }
  for (const trade of trades) {
    const mark = trade.mark ? ' [mark]' : '';
    console.log(`  ${trade.symbol.padEnd(12)} ${money(trade.net).padStart(14)} | ${trade.setup} | ${trade.reason}${mark}`);
  }
}

function printTransactions(trades, money) {
  if (!trades.length) {
    console.log('  --');
    return;
  }
  const rows = trades.map(trade => ({
    symbol: trade.symbol,
    setup: trade.setup,
    qty: String(trade.qty),
    entry: String(trade.entry),
    exit: String(trade.exit),
    net: money(trade.net),
    entryTime: formatIstDateTime(trade.opened),
    exitTime: formatIstDateTime(trade.closed),
    entryReason: trade.entryReason || '--',
    reason: `${trade.reason || '--'}${trade.mark ? ' [mark]' : ''}`,
  }));
  const widths = {
    symbol: Math.max(6, ...rows.map(r => r.symbol.length)),
    setup: Math.max(5, ...rows.map(r => r.setup.length)),
    qty: Math.max(3, ...rows.map(r => r.qty.length)),
    entry: Math.max(5, ...rows.map(r => r.entry.length)),
    exit: Math.max(4, ...rows.map(r => r.exit.length)),
    net: Math.max(7, ...rows.map(r => r.net.length)),
    entryTime: Math.max(10, ...rows.map(r => r.entryTime.length)),
    exitTime: Math.max(9, ...rows.map(r => r.exitTime.length)),
    entryReason: Math.max(9, ...rows.map(r => Math.min(r.entryReason.length, 28))),
  };
  console.log(`  ${'Symbol'.padEnd(widths.symbol)}  ${'Setup'.padEnd(widths.setup)}  ${'Qty'.padStart(widths.qty)}  ${'Entry'.padStart(widths.entry)}  ${'Exit'.padStart(widths.exit)}  ${'Net P/L'.padStart(widths.net)}  ${'Entry Time'.padEnd(widths.entryTime)}  ${'Exit Time'.padEnd(widths.exitTime)}  ${'Entry Why'.padEnd(widths.entryReason)}  Reason`);
  console.log(`  ${'-'.repeat(widths.symbol)}  ${'-'.repeat(widths.setup)}  ${'-'.repeat(widths.qty)}  ${'-'.repeat(widths.entry)}  ${'-'.repeat(widths.exit)}  ${'-'.repeat(widths.net)}  ${'-'.repeat(widths.entryTime)}  ${'-'.repeat(widths.exitTime)}  ${'-'.repeat(widths.entryReason)}  ${'-'.repeat(24)}`);
  for (const row of rows) {
    const entryReason = row.entryReason.length > 28 ? `${row.entryReason.slice(0, 25)}...` : row.entryReason;
    console.log(`  ${row.symbol.padEnd(widths.symbol)}  ${row.setup.padEnd(widths.setup)}  ${row.qty.padStart(widths.qty)}  ${row.entry.padStart(widths.entry)}  ${row.exit.padStart(widths.exit)}  ${row.net.padStart(widths.net)}  ${row.entryTime.padEnd(widths.entryTime)}  ${row.exitTime.padEnd(widths.exitTime)}  ${entryReason.padEnd(widths.entryReason)}  ${row.reason}`);
  }
}

function formatIstDateTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function round1(n) {
  return Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : 0;
}

function round2(n) {
  return Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : 0;
}

function round3(n) {
  return Number.isFinite(Number(n)) ? Math.round(Number(n) * 1000) / 1000 : 0;
}

function replayAdjustedSignal(score) {
  const numericScore = Number(score) || 0;
  if (numericScore >= 35) return 'buy';
  if (numericScore <= -35) return 'sell';
  return Math.abs(numericScore) >= 18 ? 'watch' : 'hold';
}

function computeReplayGapExhaustionScoreAdjustment(candidate) {
  const indicators = candidate?.indicators || {};
  const baseScore = Number(candidate?.rawScore ?? candidate?.score);
  const currentSide = String(candidate?.side || candidate?.signal || '').toLowerCase();
  if (currentSide !== 'buy' && !(Number.isFinite(baseScore) && baseScore > 0)) {
    return { penalty: 0, reason: '', baseScore: Number.isFinite(baseScore) ? baseScore : 0 };
  }
  const gap = Number(indicators.gapPct);
  if (!Number.isFinite(gap) || gap <= 1) {
    return { penalty: 0, reason: '', baseScore: Number.isFinite(baseScore) ? baseScore : 0 };
  }
  if (indicators.volumeShock?.isShock) {
    return { penalty: 0, reason: '', baseScore: Number.isFinite(baseScore) ? baseScore : 0 };
  }

  let penalty = 12;
  const dayGain = Number(indicators.dayChange ?? candidate?.quote?.change);
  if (Number.isFinite(dayGain) && dayGain >= 2) penalty += 4;
  if (Number.isFinite(dayGain) && dayGain >= 4) penalty += 4;
  if (gap >= 1.5) penalty += 6;
  if (gap >= 2.0) penalty += 6;
  const relVol = Number(indicators.relVolumeTimeAdjusted ?? indicators.relVolume);
  if (Number.isFinite(relVol) && relVol < 2) penalty += 4;

  return {
    penalty,
    reason: 'Stretched gap-up exhaustion risk',
    baseScore: Number.isFinite(baseScore) ? baseScore : 0,
  };
}

function rescoreReplayCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const { penalty, reason, baseScore } = computeReplayGapExhaustionScoreAdjustment(candidate);
  if (penalty <= 0) return candidate;

  const nextScore = baseScore - penalty;
  const nextSignal = replayAdjustedSignal(nextScore);
  const previousSide = String(candidate.side || candidate.signal || '').toLowerCase();

  candidate.rawScore = baseScore;
  candidate.score = nextScore;
  candidate.signal = nextSignal;
  candidate.side = nextSignal === previousSide ? nextSignal : null;
  if (candidate.indicators && typeof candidate.indicators === 'object') {
    candidate.indicators.score = nextScore;
    candidate.indicators.signal = nextSignal;
    const reasons = Array.isArray(candidate.indicators.reasons) ? candidate.indicators.reasons.filter(Boolean) : [];
    if (!reasons.includes(reason)) reasons.push(reason);
    candidate.indicators.reasons = reasons;
  }
  return candidate;
}

function cloneSnapshots(snapshots) {
  return JSON.parse(JSON.stringify(snapshots || []));
}

function buildSweepSettings(baseSettings) {
  const uniq = values => [...new Set(values.filter(v => Number.isFinite(Number(v))))];
  const minScores = uniq([baseSettings.SIMULATION_MIN_SCORE, 50, 55, 60, 65]);
  const topNs = uniq([baseSettings.SIMULATION_TOP_N, 8, 10, 12, 15]);
  const perCycles = uniq([baseSettings.SIMULATION_MAX_NEW_PER_CYCLE, 3, 4, 5]);
  const longTrails = uniq([baseSettings.SIMULATION_LONG_TRAIL_PCT, 0.4, 0.6, 0.8]);
  const variants = [];
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const perCycle of perCycles) {
        for (const longTrail of longTrails) {
          variants.push({
            ...baseSettings,
            SIMULATION_MIN_SCORE:minScore,
            SIMULATION_TOP_N:topN,
            SIMULATION_MAX_NEW_PER_CYCLE:perCycle,
            SIMULATION_LONG_TRAIL_PCT:longTrail,
          });
        }
      }
    }
  }
  return variants;
}

function runSweep(snapshots, baseSettings) {
  return buildSweepSettings(baseSettings)
    .map(settings => {
      const result = runBacktest(cloneSnapshots(snapshots), settings);
      return {
        minScore:settings.SIMULATION_MIN_SCORE,
        topN:settings.SIMULATION_TOP_N,
        perCycle:settings.SIMULATION_MAX_NEW_PER_CYCLE,
        longTrail:settings.SIMULATION_LONG_TRAIL_PCT,
        trades:result.summary.trades,
        winRate:result.summary.winRate,
        net:result.summary.net,
        returnPct:result.summary.returnPct,
        maxDrawdown:result.summary.maxDrawdown,
        maxDrawdownPct:result.summary.maxDrawdownPct,
        maxLossStreak:result.summary.maxLossStreak,
      };
    })
    .sort((a, b) => b.net - a.net || a.maxDrawdown - b.maxDrawdown || b.winRate - a.winRate);
}

function printSweep(rows) {
  const money = n => `Rs ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  console.log('Simulation Parameter Sweep');
  console.log('==========================');
  console.log('Rank  MinScore  TopN  PerCycle  Trail%  Trades  Win%   Net P/L      DD       DD%   LossRun');
  rows.slice(0, 20).forEach((row, index) => {
    console.log(`${String(index + 1).padStart(4)}  ${String(row.minScore).padStart(8)}  ${String(row.topN).padStart(4)}  ${String(row.perCycle).padStart(8)}  ${String(row.longTrail).padStart(6)}  ${String(row.trades).padStart(6)}  ${String(row.winRate).padStart(5)}  ${money(row.net).padStart(11)}  ${money(row.maxDrawdown).padStart(8)}  ${String(row.maxDrawdownPct).padStart(6)}  ${String(row.maxLossStreak).padStart(7)}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const snapshots = await readSnapshots(args.file, args.day);
  if (!snapshots.length) {
    throw new Error(`No snapshots found${args.day ? ` for ${args.day}` : ''}${args.file ? ` in ${args.file}` : ''}`);
  }
  const settings = loadSettings({ ...args, snapshots });
  if (args.recordedDecisions) {
    const exactCycles = loadRecordedDecisionCyclesFromSnapshots(snapshots);
    settings.__recordedDecisionCycles = exactCycles.size ? exactCycles : alignRecordedDecisionCycles(
        snapshots,
        loadRecordedDecisionCycles(args.day),
        settings.REPLAY_RECORDED_MAX_ALIGNMENT_MIN || 6
      );
    settings.REPLAY_RECORDED_SOURCE = exactCycles.size ? 'snapshot-keyed' : 'journal-aligned';
  }
  if (args.sweep) {
    const rows = runSweep(snapshots, settings);
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printSweep(rows);
    return;
  }
  const result = runBacktest(snapshots, settings);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printReport(result);
}

if (require.main === module) {
  try {
    main().catch(err => {
      console.error('Backtest failed:', err.stack || err.message);
      process.exitCode = 1;
    });
  } catch (e) {
    console.error('Backtest failed:', e.stack || e.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULTS,
  buildSweepSettings,
  alignRecordedDecisionCycles,
  assessReplayReliability,
  cloneSnapshots,
  istDateKey,
  isReplayEntryTimeBlocked,
  loadPortfolioAvailableCash,
  getHistoricalReplayContext,
  loadRecordedDecisionCycles,
  loadRecordedDecisionCyclesFromSnapshots,
  loadSettings,
  parseArgs,
  readSnapshots,
  runBacktest,
  runSweep,
};
