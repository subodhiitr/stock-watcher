#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const TradeRules = require('./trade_rules');
const SimulationEngine = require('./simulation_engine');

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const DEFAULT_SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'simulation_snapshots.json');
const LEGACY_SNAPSHOT_FILE = path.join(ROOT, 'simulation_snapshots.json');
const DAILY_SNAPSHOT_PREFIX = 'simulation_snapshots';
const PAPER_TRADES_FILE = path.join(ROOT, 'paper_trades.json');
const TRADE_SETTINGS_FILE = path.join(ROOT, 'trade_settings.json');

const DEFAULTS = TradeRules.DEFAULT_SETTINGS;

function usage() {
  return `
Usage:
  node backtest_simulation.js [options]

Options:
  --file <path>              Snapshot file. Default: dated files, or dated file for --day.
  --day <YYYY-MM-DD>         Backtest only one IST trading date.
  --first-hour-cap <n>       Override first-hour entry cap.
  --max-active-open <n>      Override max active simulation open trades.
  --max-new-per-cycle <n>    Override max new entries per refresh cycle.
  --nifty-regime-pct <n>     Override Nifty market-regime threshold. Use 999 to effectively disable direct Nifty guard.
  --rs-regime-pct <n>        Override RS (relative strength vs Nifty) threshold. Default 0.2. Use 999 to disable RS guard.
  --auto-shorts              Allow simulation replay to enter short/sell trades.
  --long-only                Replay only long/buy entries.
  --short-only               Replay only short/sell entries.
  --short-min-score <n>      Override short-side minimum absolute score.
  --capital <amount>         Override starting/available capital for replay.
  --default-capital          Use dashboard default capital instead of saved portfolio cash.
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
  const args = { file: DEFAULT_SNAPSHOT_FILE, fileExplicit: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--file') {
      args.file = path.resolve(ROOT, next());
      args.fileExplicit = true;
    }
    else if (arg === '--day') args.day = next();
    else if (arg === '--first-hour-cap') args.firstHourCap = Number(next());
    else if (arg === '--max-active-open') args.maxActiveOpen = Number(next());
    else if (arg === '--max-new-per-cycle') args.maxNewPerCycle = Number(next());
    else if (arg === '--nifty-regime-pct') args.niftyRegimePct = Number(next());
    else if (arg === '--rs-regime-pct') args.rsRegimePct = Number(next());
    else if (arg === '--auto-shorts') args.autoShorts = true;
    else if (arg === '--long-only') args.longOnly = true;
    else if (arg === '--short-only') args.shortOnly = true;
    else if (arg === '--short-min-score') args.shortMinScore = Number(next());
    else if (arg === '--capital') args.capital = Number(next());
    else if (arg === '--default-capital') args.defaultCapital = true;
    else if (arg === '--sweep') args.sweep = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.day && !args.fileExplicit) {
    const dailyFile = getDailySnapshotFile(args.day);
    args.file = fs.existsSync(dailyFile) ? dailyFile : null;
  } else if (!args.fileExplicit) {
    args.file = null;
  }
  return args;
}

function getDailySnapshotFile(day) {
  return path.join(SNAPSHOT_DIR, `${DAILY_SNAPSHOT_PREFIX}_${day}.json`);
}

function listDailySnapshotFiles() {
  try {
    return fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR)
      .filter(name => /^simulation_snapshots_\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map(name => path.join(SNAPSHOT_DIR, name))
      .sort() : [];
  } catch (_) {
    return [];
  }
}

function loadSettings(overrides) {
  const settings = TradeRules.withDefaults(DEFAULTS);
  const saved = loadTradeSettingOverrides(TRADE_SETTINGS_FILE);
  Object.assign(settings, saved);
  if (Number.isFinite(overrides.firstHourCap)) settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES = overrides.firstHourCap;
  if (Number.isFinite(overrides.maxActiveOpen)) settings.SIMULATION_MAX_ACTIVE_OPEN = overrides.maxActiveOpen;
  if (Number.isFinite(overrides.maxNewPerCycle)) settings.SIMULATION_MAX_NEW_PER_CYCLE = overrides.maxNewPerCycle;
  if (Number.isFinite(overrides.niftyRegimePct)) settings.SIMULATION_MARKET_REGIME_NIFTY_PCT = overrides.niftyRegimePct;
  if (Number.isFinite(overrides.rsRegimePct)) settings.SIMULATION_MARKET_REGIME_RS_PCT = overrides.rsRegimePct;
  if (Number.isFinite(overrides.shortMinScore)) settings.SIMULATION_SHORT_MIN_SCORE = overrides.shortMinScore;
  if (overrides.autoShorts) settings.SIMULATION_AUTO_SHORTS = true;
  if (overrides.shortOnly) settings.SIMULATION_AUTO_SHORTS = true;
  settings.REPLAY_LONG_ONLY = !!overrides.longOnly;
  settings.REPLAY_SHORT_ONLY = !!overrides.shortOnly;
  const portfolioCash = overrides.defaultCapital ? null : loadPortfolioAvailableCash(PAPER_TRADES_FILE);
  if (Number.isFinite(overrides.capital) && overrides.capital > 0) {
    settings.PORTFOLIO_INITIAL_CAPITAL = +overrides.capital.toFixed(2);
    settings.PORTFOLIO_CAPITAL_SOURCE = 'command-line';
  } else if (portfolioCash && Number.isFinite(portfolioCash.capital) && portfolioCash.capital > 0) {
    settings.PORTFOLIO_INITIAL_CAPITAL = portfolioCash.capital;
    settings.PORTFOLIO_AVAILABLE_CASH = portfolioCash.cashAvailable;
    settings.PORTFOLIO_CAPITAL_SOURCE = 'paper_trades.json portfolio capital';
    settings.PORTFOLIO_CAPITAL_DETAIL = portfolioCash;
  } else {
    settings.PORTFOLIO_CAPITAL_SOURCE = overrides.defaultCapital ? 'dashboard default' : 'dashboard default; saved portfolio unavailable';
  }
  return settings;
}

function loadTradeSettingOverrides(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const overrides = raw && typeof raw === 'object' && raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
    const clean = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!(key in DEFAULTS)) continue;
      if (typeof value === 'boolean') clean[key] = value;
      else {
        const n = Number(value);
        if (Number.isFinite(n)) clean[key] = n;
      }
    }
    return clean;
  } catch (_) {
    return {};
  }
}

function loadPortfolioAvailableCash(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const portfolio = raw && typeof raw === 'object' ? raw.portfolio || {} : {};
    const trades = Array.isArray(raw?.trades) ? raw.trades : [];
    const initial = Number(portfolio.initialCapital);
    const base = Number.isFinite(initial) && initial > 0 ? initial : DEFAULTS.PORTFOLIO_INITIAL_CAPITAL;
    const addedCapital = Array.isArray(portfolio.capitalAdds)
      ? portfolio.capitalAdds.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0)
      : 0;
    let realized = 0;
    let openExposure = 0;
    for (const trade of trades) {
      const status = String(trade?.status || '').toLowerCase();
      if (status === 'closed') {
        const pnl = Number(trade.pnl);
        if (Number.isFinite(pnl)) realized += pnl;
      } else if (status === 'open') {
        const entry = Number(trade.entryPrice);
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
      tradeCount: trades.length,
    };
  } catch (e) {
    return null;
  }
}

function readSnapshots(file, day) {
  const dailyFiles = listDailySnapshotFiles();
  const files = file
    ? [file]
    : (dailyFiles.length
      ? dailyFiles
      : [DEFAULT_SNAPSHOT_FILE, LEGACY_SNAPSHOT_FILE].filter(snapshotFile => fs.existsSync(snapshotFile)));
  let snapshots = [];
  for (const snapshotFile of files) {
    const payload = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    if (Array.isArray(payload.snapshots)) snapshots.push(...payload.snapshots);
  }
  snapshots = snapshots
    .filter(s => s && s.at && Array.isArray(s.candidates))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (day) {
    snapshots = snapshots.filter(s => istDateKey(s.at) === day);
  }
  return snapshots;
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

function isEntryWindow(value) {
  const day = istWeekday(value);
  const mins = istMinutes(value);
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 14 * 60 + 45;
}

function isEodSettlement(value) {
  const day = istWeekday(value);
  const mins = istMinutes(value);
  return day === 0 || day === 6 || mins >= 15 * 60 + 20;
}

function runBacktest(snapshots, settings) {
  const trades = [];
  let nextId = 1;
  let currentBySymbol = new Map();
  const lastKnownBySymbol = new Map();
  const previousCandidateBySymbol = new Map();

  const openTrades = () => trades.filter(t => t.status === 'open');
  const simOpenTrades = () => openTrades().filter(t => t.source === 'simulation');
  const realizedPnl = () => trades.filter(t => t.status === 'closed').reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const openExposure = () => openTrades().reduce((sum, t) => sum + (Number(t.entryPrice) * Number(t.qty) || 0), 0);
  const startingCash = Number.isFinite(Number(settings.PORTFOLIO_AVAILABLE_CASH))
    ? Math.max(0, Number(settings.PORTFOLIO_AVAILABLE_CASH))
    : settings.PORTFOLIO_INITIAL_CAPITAL;
  const cashAvailable = () => startingCash + realizedPnl() - openExposure();

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
    const pnl = SimulationEngine.getPaperTradePnl(trade, exitPrice);
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

  function partialCloseTrade(trade, exitPrice, reason, at, qty, runner = false) {
    const closeQty = Math.floor(Number(qty));
    const openQty = Math.floor(Number(trade.qty));
    if (!Number.isFinite(closeQty) || closeQty <= 0 || closeQty >= openQty) return false;
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
    Object.assign(partial, {
      pnl: pnl.pnl,
      grossPnl: pnl.grossPnl,
      charges: pnl.charges,
      pnlPct: pnl.pnlPct,
    });
    trade.qty = openQty - closeQty;
    trade.reservedCapital = round2(Number(trade.entryPrice) * Number(trade.qty));
    trade.partialExits = Array.isArray(trade.partialExits) ? trade.partialExits : [];
    trade.partialExits.push({ id: partial.id, qty: closeQty, exitPrice: round2(exitPrice), closedAt: at, reason, pnl: pnl.pnl });
    trade._partialTargetBooked = true;
    trade._runnerArmed = true;
    trade._runnerWideTrail = !!runner;
    trade.target = null;
    trades.push(partial);
    return true;
  }

  for (const snapshot of snapshots) {
    currentBySymbol = new Map();
    for (const candidate of snapshot.candidates || []) {
      candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || null;
      candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings);
      currentBySymbol.set(candidate.symbol, candidate);
      lastKnownBySymbol.set(candidate.symbol, candidate);
      previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
    }
    for (const open of snapshot.openSimulationTrades || []) {
      if (!currentBySymbol.has(open.symbol)) {
        const fallback = {
          symbol: open.symbol,
          price: open.priceAtSnapshot,
          priceAtSnapshot: open.priceAtSnapshot,
          score: 0,
          indicators: { ohlc: open.ohlc || null },
        };
        fallback.derivedSetupType = SimulationEngine.deriveSetupType(fallback, settings);
        currentBySymbol.set(open.symbol, fallback);
      }
    }

    for (const trade of simOpenTrades().slice()) {
      const candidate = currentBySymbol.get(trade.symbol) || lastKnownBySymbol.get(trade.symbol);
      const price = Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const exit = SimulationEngine.getSimulationExit(trade, price, candidate, snapshot.at, settings, { isEodSettlement: isEodSettlement(snapshot.at) });
      if (exit?.action === 'partial') {
        const qty = Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100));
        partialCloseTrade(trade, exit.exitPrice, exit.reason, snapshot.at, qty, exit.runner);
      } else if (exit) {
        closeTrade(trade, exit.exitPrice, exit.reason, snapshot.at);
      }
    }

    if (!isEntryWindow(snapshot.at) || isEodSettlement(snapshot.at)) continue;

    let slots = Math.max(0, Math.min(
      settings.SIMULATION_MAX_OPEN - openTrades().length,
      settings.SIMULATION_MAX_ACTIVE_OPEN - simOpenTrades().length,
    ));
    if (slots <= 0 || cashAvailable() <= 0) continue;

    const candidates = SimulationEngine.selectSimulationEntryCandidates(
      snapshot.candidates || [],
      snapshot.at,
      settings,
      {
        openSymbols: new Set(openTrades().map(t => t.symbol)),
        entryBlockReason: (symbol, setupType) => entryBlockReason(symbol, setupType, snapshot.at),
        market: snapshot.market,
      }
    );

    let openedThisCycle = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (slots <= 0 || openedThisCycle >= settings.SIMULATION_MAX_NEW_PER_CYCLE) break;
      const candidate = candidates[i];
      const setupType = candidate.derivedSetupType || candidate.setupType || '';
      const block = entryBlockReason(candidate.symbol, setupType, snapshot.at);
      if (block) {
        if (/daily/i.test(block)) break;
        continue;
      }
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const remainingCandidates = Math.max(1, candidates.length - i);
      const remainingSlots = Math.max(1, Math.min(slots, remainingCandidates));
      const allocation = Math.min(settings.MAX_POSITION_EXPOSURE, cashAvailable() / remainingSlots);
      const side = candidate.side || candidate.signal || 'buy';
      const suggestion = SimulationEngine.getSuggestedQty(candidate, side, price, cashAvailable(), allocation, settings);
      if (suggestion.qty <= 0) continue;
      trades.push({
        id: nextId++,
        symbol: candidate.symbol,
        name: candidate.name || candidate.symbol,
        side,
        qty: suggestion.qty,
        entryPrice: round2(price),
        target: suggestion.plan.target,
        stop: suggestion.plan.stop,
        signal: side,
        score: Math.abs(Number(candidate.score) || 0),
        rr: candidate.indicators?.rr,
        source: 'simulation',
        assetType: 'stock',
        reservedCapital: round2(suggestion.qty * price),
        setupType,
        setup: ['Simulation', setupType, candidate.indicators?.entryStatus, candidate.indicators?.entryTrigger]
          .filter(Boolean).join(' | '),
        entryContext: {
          selectedRank:i + 1,
          score:Number(candidate.score) || 0,
          side,
          setupType,
          reason:`selected rank ${i + 1}`,
          blockReason:candidate.blockReason || '',
          decision:candidate.decision || null,
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

  return summarize(trades, snapshots, settings, startingCash);
}

function summarize(trades, snapshots, settings, startingCash = settings.PORTFOLIO_INITIAL_CAPITAL) {
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
  const opportunityReport = buildOpportunityReport(snapshots, closed, settings);
  const risk = computeRiskStats(closed, settings.PORTFOLIO_INITIAL_CAPITAL);
  const quality = SimulationEngine.summarizeTradeQuality(closed, settings);
  const all = closed.map(formatTrade);
  return {
    snapshots: snapshots.length,
    first: snapshots[0]?.at || null,
    last: snapshots.at(-1)?.at || null,
    settings: {
      capital: settings.PORTFOLIO_INITIAL_CAPITAL,
      availableCash: round2(startingCash),
      capitalSource: settings.PORTFOLIO_CAPITAL_SOURCE || 'dashboard default',
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
    },
    byDay: cleanBuckets(byDay),
    bySetup: cleanBuckets(bySetup),
    byReason: cleanBuckets(byReason),
    bySide: cleanBuckets(bySide),
    quality,
    missed: opportunityReport.missed,
    dataQuality: opportunityReport.dataQuality,
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
  const bySymbolSide = new Map();
  const previousCandidateBySymbol = new Map();
  for (const snapshot of snapshots) {
    const candidates = snapshot.candidates || [];
    for (const candidate of candidates) {
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (Number.isFinite(price) && price > 0) {
        lastPrice.set(candidate.symbol, price);
        lastAt.set(candidate.symbol, snapshot.at);
      }
      if (!candidate || candidate.assetType === 'etf') continue;
      candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || candidate.previousCandidate || null;
      candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings);
      previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
      const side = candidate.side || candidate.signal;
      if (!['buy', 'sell'].includes(side)) continue;
      const explanation = SimulationEngine.explainCandidateEligibility(candidate, snapshot.at, settings, {
        previousCandidate: candidate.previousCandidate,
        market: snapshot.market,
      });
      for (const issue of SimulationEngine.getDataQualityIssues(candidate, settings)) {
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
        });
      }
    }
  }
  const opportunities = [];
  for (const item of bySymbolSide.values()) {
    const exit = lastPrice.get(item.symbol);
    if (!Number.isFinite(item.entry) || item.entry <= 0 || !Number.isFinite(exit) || exit <= 0) continue;
    const qty = Math.max(1, Math.floor(settings.MAX_POSITION_EXPOSURE / item.entry));
    const pnl = SimulationEngine.getPaperTradePnl({ side:item.side, qty, entryPrice:item.entry }, exit);
    const movePct = item.side === 'sell'
      ? ((item.entry - exit) / item.entry) * 100
      : ((exit - item.entry) / item.entry) * 100;
    opportunities.push({
      ...item,
      exit,
      exitAt:lastAt.get(item.symbol) || null,
      qty,
      movePct:round2(movePct),
      net:pnl?.pnl ?? 0,
      charges:pnl?.charges ?? 0,
      reason:item.reasons.slice(0, 3).join(' | '),
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
  console.log(`Settings  : ${result.settings.replayMode}, active ${result.settings.maxActiveOpen}, total ${result.settings.maxOpen}, per-cycle ${result.settings.maxNewPerCycle}, first-hour ${result.settings.firstHourMaxEntries}, shortScore ${result.settings.shortMinScore}`);
  console.log('');
  console.log(`Trades    : ${result.summary.trades} (${result.summary.wins} wins / ${result.summary.losses} losses, ${result.summary.winRate}% win rate)`);
  console.log(`Gross P/L : ${money(result.summary.gross)}`);
  console.log(`Costs     : ${money(result.summary.fees)}`);
  console.log(`Net P/L   : ${money(result.summary.net)} (${result.summary.returnPct}%)`);
  console.log(`Drawdown  : ${money(result.summary.maxDrawdown)} (${result.summary.maxDrawdownPct}%)`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const settings = loadSettings(args);
  const snapshots = readSnapshots(args.file, args.day);
  if (!snapshots.length) {
    throw new Error(`No snapshots found${args.day ? ` for ${args.day}` : ''}${args.file ? ` in ${args.file}` : ''}`);
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
    main();
  } catch (e) {
    console.error('Backtest failed:', e.stack || e.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULTS,
  buildSweepSettings,
  cloneSnapshots,
  getDailySnapshotFile,
  istDateKey,
  loadPortfolioAvailableCash,
  loadSettings,
  readSnapshots,
  runBacktest,
  runSweep,
};
