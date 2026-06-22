#!/usr/bin/env node
/**
 * NSE + Yahoo Finance Local Proxy Server
 * ─────────────────────────────────────────────────────────────────
 * Run:  node ticker_proxy.js          (self-applies --max-http-header-size)
 * Port: 3001
 *
 * Routes:
 *   GET /health                 → status check
 *   GET /nse?path=/api/...      → NSE India API (handles session)
 *   GET /yahoo?symbols=A,B,C    → Yahoo Finance v7 quotes
 *   GET /yahoo/indices          → Nifty index quotes
 * ─────────────────────────────────────────────────────────────────
 */

// ── SELF-RESPAWN ──────────────────────────────────────────────────
// Yahoo Finance responses contain huge Set-Cookie headers that exceed
// Node's default 8 KB HTTP parser limit.  The ONLY reliable fix is the
// --max-http-header-size CLI flag (agent-level options don't work).
// If we weren't started with it, re-exec ourselves with it right now.
const HEADER_FLAG = '--max-http-header-size=65536';
if (require.main === module && !process.execArgv.includes(HEADER_FLAG)) {
  const { spawnSync } = require('child_process');
  console.log('[proxy] Re-starting with', HEADER_FLAG, '…');
  const result = spawnSync(
    process.execPath,
    [HEADER_FLAG, ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 0);
}
// ─────────────────────────────────────────────────────────────────

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const { fork } = require('child_process');
const Backtest = require('./backtest_simulation');
const SimulationEngine = require('./simulation_engine');
const PORT  = 3001;
const USER_OPENAI_PROPERTIES = path.join(os.homedir(), 'openai.properties');
const SAVED_ETF_FILE = path.join(__dirname, 'saved_etfs.json');
const SAVED_STOCK_FILE = path.join(__dirname, 'saved_stocks.json');
const SAVED_ETF_FAV_FILE  = path.join(__dirname, 'saved_etf_favs.json');
const ETF_LIST_CACHE_FILE  = path.join(__dirname, 'etf_list_cache.json');
const ETF_LIST_CACHE_TTL   = 24 * 60 * 60 * 1000;        // 24 hours (NSE price/nav batch)
const ETF_META_TTL         = 30 * 24 * 60 * 60 * 1000;   // 30 days (static: TER, family, 1Y/3Y/5Y — stored in etf_list_cache.json under "meta" key)
const FUND_CACHE_FILE      = path.join(__dirname, 'fundamentals_cache.json');
const FUND_CACHE_TTL       = 30 * 24 * 60 * 60 * 1000;   // 30 days (mostly static fundamentals)
const ETF_SUM_CACHE_FILE   = path.join(__dirname, 'etf_summary_cache.json');
const ETF_1M_RETURN_TTL    = 24 * 60 * 60 * 1000;        // 24 hours (1M return — base shifts daily)
const ETF_SUM_CACHE_VERSION = 3;                          // v3: 1M-return-only cache (static fields moved to etf_list_cache meta)
const NSE_IDX_CACHE_FILE   = path.join(__dirname, 'nse_index_cache.json');
const NSE_IDX_CACHE_TTL    = 24 * 60 * 60 * 1000;        // 24 hours
const SAVED_STOCK_FAV_FILE = path.join(__dirname, 'saved_stock_favs.json');
const PAPER_TRADES_FILE    = path.join(__dirname, 'paper_trades.json');
const REPLAY_WORKER_FILE   = path.join(__dirname, 'replay_worker.js');
const APP_CACHE_DIR        = path.join(__dirname, 'cache');
const REPLAY_CACHE_FILE    = path.join(APP_CACHE_DIR, 'replay_results.json');
const FRESH_NEWS_CACHE_FILE = path.join(APP_CACHE_DIR, 'fresh_stock_news.json'); // legacy combined cache
const FRESH_NEWS_CACHE_DIR  = path.join(APP_CACHE_DIR, 'fresh_news');
const FRESH_NEWS_CACHE_INDEX_FILE = path.join(FRESH_NEWS_CACHE_DIR, 'index.json');
const TRADE_SETTINGS_FILE  = path.join(__dirname, 'trade_settings.json');
const SIM_SNAPSHOT_DIR     = path.join(__dirname, 'snapshots');
const SIM_SNAPSHOT_FILE    = path.join(SIM_SNAPSHOT_DIR, 'simulation_snapshots.json');
const SIM_SNAPSHOT_LEGACY_FILE = path.join(__dirname, 'simulation_snapshots.json');
const SIM_SNAPSHOT_PREFIX  = 'simulation_snapshots';
const SIM_SNAPSHOT_RETENTION_DAYS = 30;
const SIM_SNAPSHOT_TTL     = SIM_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000; // keep strategy replay data
const STOCK_NEWS_TTL       = 30 * 60 * 1000;             // 30 minutes
const INTRADAY_SIGNAL_TTL  = 2 * 60 * 1000;              // 2 minutes
const REPLAY_CACHE_MAX     = 30;
const FRESH_NEWS_CACHE_VERSION = 4;
const FRESH_NEWS_CACHE_MAX_DAYS = 30;
const FRESH_NEWS_CRON_TIMES_IST = ['10:30', '15:45'];   // twice daily server-side refresh
const FRESH_NEWS_STARTUP_STALE_MS = 6 * 60 * 60 * 1000;
const replayResultCache    = new Map();
const replayJobs           = new Map();
const activeReplayJobs     = new Map();
let freshNewsDayCache      = null;
const freshNewsBuildJobs   = new Map();
let freshNewsCronTimer     = null;

function loadPropertiesFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const props = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      props[key] = value;
    }
    return props;
  } catch(e) {
    console.warn('[openai] Could not read openai.properties:', e.message);
    return {};
  }
}

const openaiProps = loadPropertiesFile(USER_OPENAI_PROPERTIES);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || openaiProps.OPENAI_API_KEY || openaiProps.api_key || openaiProps.apiKey || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || openaiProps.OPENAI_MODEL || openaiProps.model || 'gpt-4.1-mini';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || openaiProps.OLLAMA_BASE_URL || openaiProps.ollama_base_url || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || openaiProps.OLLAMA_MODEL || openaiProps.ollama_model || '';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || openaiProps.OLLAMA_TIMEOUT_MS || openaiProps.ollama_timeout_ms || 180000);

function parseVolumeField(item) {
  const raw = item.totalTradedVolume ?? item.tradedVolume ?? item.volume ?? item.totalTradedQty ?? item.quantityTraded ?? item.qtyTraded ?? 0;
  if (typeof raw === 'number') return raw || null;
  const parsed = parseFloat(String(raw).replace(/,/g, ''));
  return parsed || null;
}

function parseExplicitINav(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.iNavValue ?? item.iNAV ?? item.inav ?? item.indicativeNAV ?? item.indicativeNav ?? item.indicativeValue;
  const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function loadSavedETFsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FILE)) fs.writeFileSync(SAVED_ETF_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF prefs:', e.message);
  }
}

function loadSavedStocksFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FILE)) fs.writeFileSync(SAVED_STOCK_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStocksFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock prefs:', e.message);
  }
}

// ── Fundamentals cache (per-symbol, 7-day TTL) ──────────────────────────────
// Structure: { [SYM]: { data: {...}, savedAt: timestamp } }
let fundCache = {};
function loadFundCache() {
  try {
    if (fs.existsSync(FUND_CACHE_FILE)) {
      fundCache = JSON.parse(fs.readFileSync(FUND_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(fundCache).length;
      if (count) console.log(`[fund-cache] Loaded ${count} cached fundamentals from file`);
    }
  } catch(e) { console.warn('[fund-cache] Load error:', e.message); fundCache = {}; }
}
function saveFundCache() {
  try {
    fs.writeFileSync(FUND_CACHE_FILE, JSON.stringify(fundCache, null, 2), 'utf8');
  } catch(e) { console.warn('[fund-cache] Save error:', e.message); }
}
loadFundCache();

// ── ETF summary cache (1M return only, 24h TTL) ─────────────────────────────
// Static fields (TER, category, fundFamily, 1Y/3Y/5Y) now live in etf_list_cache.json under "meta".
// Structure: { [SYM]: { oneMonthReturn: number, savedAt: timestamp, version: 3 } }
let etfSumCache = {};
function loadEtfSumCache() {
  try {
    if (fs.existsSync(ETF_SUM_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ETF_SUM_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(raw).length;
      // Version 3 = 1M-only format. Any older cache (v2 mixed format) is cleared.
      const isCurrent = count === 0 || Object.values(raw).some(e => e.version === ETF_SUM_CACHE_VERSION);
      if (!isCurrent) {
        console.log('[etf-sum-cache] Old mixed-format cache detected (pre-v3) — clearing');
        fs.unlinkSync(ETF_SUM_CACHE_FILE);
        etfSumCache = {};
      } else {
        etfSumCache = raw;
        if (count) console.log(`[etf-sum-cache] Loaded ${count} cached 1M returns`);
      }
    }
  } catch(e) { console.warn('[etf-sum-cache] Load error:', e.message); etfSumCache = {}; }
}
function saveEtfSumCache() {
  try { fs.writeFileSync(ETF_SUM_CACHE_FILE, JSON.stringify(etfSumCache, null, 2), 'utf8'); }
  catch(e) { console.warn('[etf-sum-cache] Save error:', e.message); }
}
loadEtfSumCache();

// ── ETF meta cache (static fields: TER, category, fundFamily, 1Y/3Y/5Y — 30d TTL) ──
// Stored inside etf_list_cache.json as a top-level "meta" dict so we don't need
// a separate file.  Loaded on startup and written back whenever a symbol is fetched.
// Structure: { [SYM]: { expenseRatio, category, fundFamily, ytdReturn, oneYearReturn,
//                        threeYearReturn, fiveYearReturn, savedAt } }
let etfMetaCache = {};
function loadEtfMetaCache() {
  try {
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8')) || {};
      etfMetaCache = raw.meta || {};
      const count = Object.keys(etfMetaCache).length;
      if (count) console.log(`[etf-meta-cache] Loaded ${count} static ETF records from etf_list_cache.json`);
    }
  } catch(e) { console.warn('[etf-meta-cache] Load error:', e.message); etfMetaCache = {}; }
}
function saveEtfMetaCache() {
  try {
    // Merge into existing etf_list_cache.json without overwriting the etfs array
    let existing = {};
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      existing = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8')) || {};
    }
    existing.meta = etfMetaCache;
    fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify(existing, null, 2), 'utf8');
  } catch(e) { console.warn('[etf-meta-cache] Save error:', e.message); }
}
loadEtfMetaCache();

function getETFExpenseRatio(sym) {
  const key = String(sym || '').toUpperCase();
  return etfMetaCache[key]?.expenseRatio ?? STATIC_TER[key] ?? null;
}


// ── NSE index membership cache (per-index, 24h TTL) ─────────────────────────
let nseIdxCache = {};
function loadNseIdxCache() {
  try {
    if (fs.existsSync(NSE_IDX_CACHE_FILE)) {
      nseIdxCache = JSON.parse(fs.readFileSync(NSE_IDX_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(nseIdxCache).length;
      if (count) console.log(`[nse-idx-cache] Loaded ${count} cached index lists`);
    }
  } catch(e) { console.warn('[nse-idx-cache] Load error:', e.message); nseIdxCache = {}; }
}
function saveNseIdxCache() {
  try { fs.writeFileSync(NSE_IDX_CACHE_FILE, JSON.stringify(nseIdxCache, null, 2), 'utf8'); }
  catch(e) { console.warn('[nse-idx-cache] Save error:', e.message); }
}
loadNseIdxCache();

function loadSavedETFFavsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FAV_FILE)) fs.writeFileSync(SAVED_ETF_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF favorites:', e.message);
  }
}

function loadSavedStockFavsFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FAV_FILE)) fs.writeFileSync(SAVED_STOCK_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStockFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock favorites:', e.message);
  }
}

// ══════════════════════════════════════════════════════════
//  SHARED HELPER — HTTPS GET with auto-decompression
// ══════════════════════════════════════════════════
function defaultPaperPortfolio() {
  return { initialCapital: 500000, capitalAdds: [] };
}

function normalizePaperState(raw) {
  const trades = Array.isArray(raw) ? raw : (Array.isArray(raw?.trades) ? raw.trades : []);
  const portfolioRaw = raw && !Array.isArray(raw) && raw.portfolio && typeof raw.portfolio === 'object' ? raw.portfolio : {};
  const initialCapital = Number.isFinite(Number(portfolioRaw.initialCapital)) && Number(portfolioRaw.initialCapital) > 0
    ? +Number(portfolioRaw.initialCapital).toFixed(2)
    : 500000;
  const capitalAdds = Array.isArray(portfolioRaw.capitalAdds)
    ? portfolioRaw.capitalAdds.map(item => ({
        amount: +Number(item?.amount || 0).toFixed(2),
        at: item?.at || new Date().toISOString(),
        note: String(item?.note || ''),
      })).filter(item => Number.isFinite(item.amount) && item.amount > 0)
    : [];
  return { savedAt: raw?.savedAt || Date.now(), portfolio: { initialCapital, capitalAdds }, trades };
}

function loadPaperStateFile() {
  try {
    if (!fs.existsSync(PAPER_TRADES_FILE)) {
      fs.writeFileSync(PAPER_TRADES_FILE, JSON.stringify({ savedAt: Date.now(), portfolio: defaultPaperPortfolio(), trades: [] }, null, 2), 'utf8');
    }
    const raw = JSON.parse(fs.readFileSync(PAPER_TRADES_FILE, 'utf8') || '{}');
    return normalizePaperState(raw);
  } catch (e) {
    console.warn('[paper-trades] Load error:', e.message);
    return { savedAt: Date.now(), portfolio: defaultPaperPortfolio(), trades: [] };
  }
}

function loadPaperTradesFile() {
  return loadPaperStateFile().trades;
}

function savePaperStateFile(state) {
  try {
    const next = normalizePaperState(state || {});
    fs.writeFileSync(PAPER_TRADES_FILE, JSON.stringify({ savedAt: Date.now(), portfolio: next.portfolio, trades: next.trades }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[paper-trades] Save error:', e.message);
  }
}

function savePaperTradesFile(trades) {
  try {
    const state = loadPaperStateFile();
    state.trades = Array.isArray(trades) ? trades : [];
    savePaperStateFile(state);
  } catch (e) {
    console.warn('[paper-trades] Save error:', e.message);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
}

function loadTradeSettingsFile() {
  try {
    if (!fs.existsSync(TRADE_SETTINGS_FILE)) {
      fs.writeFileSync(TRADE_SETTINGS_FILE, JSON.stringify({ savedAt:Date.now(), overrides:{} }, null, 2), 'utf8');
    }
    const raw = JSON.parse(fs.readFileSync(TRADE_SETTINGS_FILE, 'utf8') || '{}');
    return raw && typeof raw === 'object' && raw.overrides && typeof raw.overrides === 'object'
      ? { savedAt:raw.savedAt || Date.now(), overrides:raw.overrides }
      : { savedAt:Date.now(), overrides:{} };
  } catch (e) {
    console.warn('[trade-settings] Load error:', e.message);
    return { savedAt:Date.now(), overrides:{} };
  }
}

function saveTradeSettingsFile(overrides) {
  const clean = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    const n = Number(value);
    if (Number.isFinite(n)) clean[key] = n;
    else if (typeof value === 'boolean') clean[key] = value;
  }
  fs.writeFileSync(TRADE_SETTINGS_FILE, JSON.stringify({ savedAt:Date.now(), overrides:clean }, null, 2), 'utf8');
  return clean;
}

function readEtfListCacheSummary() {
  try {
    if (!fs.existsSync(ETF_LIST_CACHE_FILE)) return { savedAt:null, count:0, etfs:[] };
    const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8') || '{}');
    const etfs = Array.isArray(cached.etfs) ? cached.etfs : [];
    return {
      savedAt: cached.savedAt || null,
      count: etfs.length,
      etfs,
    };
  } catch (e) {
    console.warn('[bootstrap] ETF cache read failed:', e.message);
    return { savedAt:null, count:0, etfs:[] };
  }
}

function buildDashboardBootstrap() {
  const paper = loadPaperStateFile();
  const tradeSettings = loadTradeSettingsFile();
  const etfCache = readEtfListCacheSummary();

  return {
    ok:true,
    savedAt:Date.now(),
    prefs:{
      etfs:loadSavedETFsFile(),
      stocks:loadSavedStocksFile(),
      etfFavorites:loadSavedETFFavsFile(),
      stockFavorites:loadSavedStockFavsFile(),
    },
    portfolio:paper.portfolio,
    trades:paper.trades,
    tradeSettings,
    etfListCache:{
      savedAt:etfCache.savedAt,
      count:etfCache.count,
      etfs:etfCache.etfs,
    },
    proxy:{
      openai:{ configured:!!OPENAI_API_KEY, model:OPENAI_MODEL },
      ollama:{ baseUrl:OLLAMA_BASE_URL, model:OLLAMA_MODEL || 'auto', timeoutMs:OLLAMA_TIMEOUT_MS },
    },
  };
}

function getIstDateKey(value = Date.now()) {
  const d = new Date(new Date(value).getTime() + 5.5 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return getIstDateKey(Date.now());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getSimulationSnapshotFile(dateKey = getIstDateKey()) {
  return path.join(SIM_SNAPSHOT_DIR, `${SIM_SNAPSHOT_PREFIX}_${dateKey}.json`);
}

function isSimulationSnapshotFileName(name) {
  return /^simulation_snapshots_\d{4}-\d{2}-\d{2}\.json$/.test(String(name || ''));
}

function listSimulationSnapshotFiles() {
  try {
    const dated = fs.existsSync(SIM_SNAPSHOT_DIR) ? fs.readdirSync(SIM_SNAPSHOT_DIR)
      .filter(isSimulationSnapshotFileName)
      .map(name => path.join(SIM_SNAPSHOT_DIR, name)) : [];
    if (fs.existsSync(SIM_SNAPSHOT_FILE)) dated.push(SIM_SNAPSHOT_FILE);
    if (fs.existsSync(SIM_SNAPSHOT_LEGACY_FILE)) dated.push(SIM_SNAPSHOT_LEGACY_FILE);
    return dated;
  } catch (e) {
    console.warn('[simulation-snapshots] List error:', e.message);
    return [SIM_SNAPSHOT_FILE, SIM_SNAPSHOT_LEGACY_FILE].filter(file => fs.existsSync(file));
  }
}

function loadSimulationSnapshotsFile(dateKey = null) {
  const file = dateKey ? getSimulationSnapshotFile(dateKey) : SIM_SNAPSHOT_FILE;
  try {
    if (!fs.existsSync(file)) {
      return { savedAt: Date.now(), retentionDays: SIM_SNAPSHOT_RETENTION_DAYS, date: dateKey || null, snapshots: [] };
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    return {
      savedAt: Number(raw.savedAt) || Date.now(),
      retentionDays: SIM_SNAPSHOT_RETENTION_DAYS,
      date: raw.date || dateKey || null,
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    };
  } catch (e) {
    console.warn('[simulation-snapshots] Load error:', e.message);
    return { savedAt: Date.now(), retentionDays: SIM_SNAPSHOT_RETENTION_DAYS, date: dateKey || null, snapshots: [] };
  }
}

function loadAllSimulationSnapshots() {
  const all = [];
  for (const file of listSimulationSnapshotFiles()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
      if (Array.isArray(raw.snapshots)) all.push(...raw.snapshots);
    } catch (e) {
      console.warn('[simulation-snapshots] Load file error:', path.basename(file), e.message);
    }
  }
  return pruneSimulationSnapshots(all).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function pruneSimulationSnapshots(snapshots) {
  const cutoff = Date.now() - SIM_SNAPSHOT_TTL;
  return (Array.isArray(snapshots) ? snapshots : []).filter(s => {
    const t = new Date(s?.at || s?.savedAt || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function pruneSimulationSnapshotFiles() {
  const cutoff = Date.now() - SIM_SNAPSHOT_TTL;
  for (const file of listSimulationSnapshotFiles()) {
    const name = path.basename(file);
    if (!isSimulationSnapshotFileName(name)) continue;
    const match = name.match(/(\d{4}-\d{2}-\d{2})/);
    const t = match ? new Date(`${match[1]}T23:59:59+05:30`).getTime() : NaN;
    if (Number.isFinite(t) && t < cutoff) {
      try { fs.unlinkSync(file); } catch (e) { console.warn('[simulation-snapshots] Prune file error:', name, e.message); }
    }
  }
}

function saveSimulationSnapshotsFile(state, dateKey = getIstDateKey()) {
  try {
    const snapshots = pruneSimulationSnapshots(state?.snapshots || []);
    if (!fs.existsSync(SIM_SNAPSHOT_DIR)) fs.mkdirSync(SIM_SNAPSHOT_DIR, { recursive: true });
    const file = getSimulationSnapshotFile(dateKey);
    fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), retentionDays: SIM_SNAPSHOT_RETENTION_DAYS, date: dateKey, snapshots }, null, 2), 'utf8');
    pruneSimulationSnapshotFiles();
    return snapshots;
  } catch (e) {
    console.warn('[simulation-snapshots] Save error:', e.message);
    return [];
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

function stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

function fileMtime(file) {
  try {
    return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  } catch (_) {
    return 0;
  }
}

function replaySnapshotVersion(day, mode) {
  const files = mode === 'autotune' ? listSimulationSnapshotFiles() : [getSimulationSnapshotFile(day)];
  const versionParts = files.map(file => `${path.basename(file)}:${fileMtime(file)}`);
  versionParts.push(`paper:${fileMtime(PAPER_TRADES_FILE)}`);
  return stableHash(versionParts);
}

function replayCacheKey(day, mode, settings) {
  return [day || getIstDateKey(), mode || 'report', replaySnapshotVersion(day, mode), stableHash(settings)].join('|');
}

function getCachedReplay(key) {
  const cached = replayResultCache.get(key);
  if (!cached) return null;
  cached.hitAt = Date.now();
  return cached.payload;
}

function persistReplayCacheFile() {
  try {
    ensureDir(APP_CACHE_DIR);
    const entries = [...replayResultCache.entries()].map(([key, value]) => ({ key, ...value }));
    fs.writeFileSync(REPLAY_CACHE_FILE, JSON.stringify({ savedAt:Date.now(), entries }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[replay-cache] Save error:', e.message);
  }
}

function loadReplayCacheFile() {
  try {
    if (!fs.existsSync(REPLAY_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(REPLAY_CACHE_FILE, 'utf8') || '{}');
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    for (const entry of entries) {
      if (!entry?.key || !entry.payload) continue;
      replayResultCache.set(entry.key, {
        savedAt:Number(entry.savedAt) || Date.now(),
        hitAt:Number(entry.hitAt) || Number(entry.savedAt) || Date.now(),
        payload:entry.payload,
      });
    }
  } catch (e) {
    console.warn('[replay-cache] Load error:', e.message);
  }
}

function setCachedReplay(key, payload) {
  replayResultCache.set(key, { savedAt:Date.now(), hitAt:Date.now(), payload });
  if (replayResultCache.size > REPLAY_CACHE_MAX) {
    const oldest = [...replayResultCache.entries()].sort((a, b) => (a[1].hitAt || a[1].savedAt) - (b[1].hitAt || b[1].savedAt))[0]?.[0];
    if (oldest) replayResultCache.delete(oldest);
  }
  persistReplayCacheFile();
  return payload;
}

loadReplayCacheFile();

function readReplaySnapshotsForDay(day) {
  const state = loadSimulationSnapshotsFile(day);
  return pruneSimulationSnapshots(state.snapshots || [])
    .filter(s => !day || getIstDateKey(s.at) === day)
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function buildReplayResponse(day, options = {}) {
  const settings = Backtest.loadSettings({ day });
  const mode = options.sweep ? 'sweep' : 'report';
  const cacheKey = replayCacheKey(day, mode, settings);
  const cached = getCachedReplay(cacheKey);
  if (cached) return { ...cached, cached:true };
  const snapshots = readReplaySnapshotsForDay(day);
  const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
  const response = {
    ok:true,
    date:day,
    count:snapshots.length,
    result,
  };
  if (options.sweep) {
    response.sweepRows = runQuickReplaySweep(snapshots, settings, 5);
  }
  return setCachedReplay(cacheKey, response);
}

function buildReplayAutoTuneResponse(day) {
  const settings = Backtest.loadSettings({ day });
  const cacheKey = replayCacheKey(day, 'autotune', settings);
  const cached = getCachedReplay(cacheKey);
  if (cached) return { ...cached, cached:true };
  const all = loadAllSimulationSnapshots();
  const days = [...new Set(all.map(s => getIstDateKey(s.at)).filter(Boolean))].sort().slice(-5);
  const recent = all.filter(s => days.includes(getIstDateKey(s.at)));
  return setCachedReplay(cacheKey, {
    ok:true,
    date:day,
    days,
    count:recent.length,
    autoTuneRows:runQuickReplaySweep(recent, settings, 3),
  });
}

function replayModeFromParams(params) {
  const mode = String(params?.mode || 'report').toLowerCase();
  return ['report', 'sweep', 'autotune'].includes(mode) ? mode : 'report';
}

function getReplayCacheForMode(day, mode) {
  const settings = Backtest.loadSettings({ day });
  const cacheKey = replayCacheKey(day, mode, settings);
  return { settings, cacheKey, cached:getCachedReplay(cacheKey) };
}

function createReplayJob(day, mode) {
  const { cacheKey, cached } = getReplayCacheForMode(day, mode);
  const active = activeReplayJobs.get(cacheKey);
  if (active && ['queued', 'running'].includes(active.status)) {
    active.reused = true;
    return active;
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, day, mode, cacheKey, status:'queued', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), result:null, error:null, reused:false };
  replayJobs.set(id, job);
  if (cached) {
    job.status = 'done';
    job.result = { ...cached, cached:true };
    job.updatedAt = new Date().toISOString();
    return job;
  }
  activeReplayJobs.set(cacheKey, job);
  const child = fork(REPLAY_WORKER_FILE, [], { stdio:['ignore', 'ignore', 'pipe', 'ipc'] });
  job.status = 'running';
  job.workerPid = child.pid;
  job.updatedAt = new Date().toISOString();
  child.stderr?.on('data', chunk => {
    const line = String(chunk || '').trim();
    if (line) console.warn('[replay-worker]', line);
  });
  child.on('message', message => {
    if (job.status === 'done' || job.status === 'error') return;
    if (message?.ok) {
      job.result = setCachedReplay(cacheKey, message.payload);
      job.status = 'done';
    } else {
      job.status = 'error';
      job.error = message?.error || 'Replay worker failed';
    }
    job.updatedAt = new Date().toISOString();
    if (activeReplayJobs.get(cacheKey)?.id === job.id) activeReplayJobs.delete(cacheKey);
    child.disconnect?.();
  });
  child.on('error', e => {
    if (job.status === 'done') return;
    job.status = 'error';
    job.error = e.message || String(e);
    job.updatedAt = new Date().toISOString();
    if (activeReplayJobs.get(cacheKey)?.id === job.id) activeReplayJobs.delete(cacheKey);
  });
  child.on('exit', (code, signal) => {
    if (job.status === 'done' || job.status === 'error') return;
    job.status = 'error';
    job.error = `Replay worker exited (${signal || code})`;
    job.updatedAt = new Date().toISOString();
    if (activeReplayJobs.get(cacheKey)?.id === job.id) activeReplayJobs.delete(cacheKey);
  });
  child.send({ day, mode });
  return job;
}

function compactReplayJob(job) {
  if (!job) return null;
  return {
    id:job.id,
    day:job.day,
    mode:job.mode,
    status:job.status,
    createdAt:job.createdAt,
    updatedAt:job.updatedAt,
    workerPid:job.workerPid || null,
    reused:!!job.reused,
    cached:!!job.result?.cached,
    error:job.error,
    result:job.status === 'done' ? job.result : null,
  };
}

function compactReplayJobHistory() {
  return [...replayJobs.values()]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 10)
    .map(compactReplayJob);
}

function buildWhyMissedResponse(day, symbol) {
  const report = buildReplayResponse(day);
  const sym = String(symbol || '').toUpperCase();
  const settings = Backtest.loadSettings({ day });
  const snapshots = readReplaySnapshotsForDay(day);
  const timeline = [];
  let previousCandidate = null;
  for (const snapshot of snapshots) {
    const candidate = (snapshot.candidates || []).find(c => String(c?.symbol || '').toUpperCase() === sym);
    if (!candidate) continue;
    candidate.previousCandidate = previousCandidate || candidate.previousCandidate || null;
    candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings);
    const explanation = SimulationEngine.explainCandidateEligibility(candidate, snapshot.at, settings, {
      previousCandidate,
      market:snapshot.market,
    });
    previousCandidate = SimulationEngine.toConfirmationCandidate(candidate);
    const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
    timeline.push({
      at:snapshot.at,
      price:Number.isFinite(price) ? price : null,
      side:explanation.side || candidate.side || candidate.signal || null,
      setupType:explanation.setupType || candidate.derivedSetupType || candidate.setupType || null,
      score:Number(candidate.score) || 0,
      eligible:!!explanation.eligible,
      reasons:(explanation.reasons || []).slice(0, 8),
      entryStatus:candidate.indicators?.entryStatus || null,
      entryTrigger:candidate.indicators?.entryTrigger || null,
      relVolume:candidate.indicators?.relVolumeTimeAdjusted ?? candidate.indicators?.relVolume ?? null,
      netPct:candidate.cost?.netPct ?? null,
      guard:candidate.guard?.label || candidate.guard?.level || null,
    });
  }
  const traded = (report.result?.trades || []).filter(t => String(t.symbol || '').toUpperCase() === sym);
  const rejected = (report.result?.rejected || []).filter(t => String(t.symbol || '').toUpperCase() === sym);
  const firstEligible = timeline.find(row => row.eligible) || null;
  const best = timeline.slice().sort((a, b) => Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0))[0] || null;
  const reasonCounts = {};
  timeline.forEach(row => (row.reasons || []).forEach(reason => { reasonCounts[reason] = (reasonCounts[reason] || 0) + 1; }));
  const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count }));
  return {
    ok:true,
    date:day,
    symbol:sym,
    traded,
    rejected,
    timeline:timeline.slice(-120),
    considered:timeline.length,
    firstEligible,
    best,
    topReasons,
    message:traded.length
      ? `${sym} was traded in replay.`
      : firstEligible
        ? `${sym} became eligible at ${firstEligible.at}, but was not selected due to rank, slot, cash, cooldown, or top-N pressure.`
        : best
          ? `${sym} was not eligible. Best snapshot reason: ${(best.reasons || [])[0] || '--'}`
          : `${sym} was not found in replay snapshots for ${day}.`,
  };
}

function sanitizeSimulationSnapshot(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates.slice(0, 100) : [];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: String(payload.source || 'intraday-refresh'),
    dataSource: String(payload.dataSource || ''),
    currentView: String(payload.currentView || ''),
    simulationState: String(payload.simulationState || ''),
    caps: payload.caps && typeof payload.caps === 'object' ? payload.caps : {},
    dayStats: payload.dayStats && typeof payload.dayStats === 'object' ? payload.dayStats : {},
    market: payload.market && typeof payload.market === 'object' ? payload.market : {},
    openSimulationTrades: Array.isArray(payload.openSimulationTrades) ? payload.openSimulationTrades.slice(0, 20) : [],
    outcomeSummary: payload.outcomeSummary && typeof payload.outcomeSummary === 'object' ? payload.outcomeSummary : {},
    candidates,
    candidateCount: Number.isFinite(Number(payload.candidateCount)) ? Number(payload.candidateCount) : candidates.length,
  };
}

function computePaperTradePnl(trade, exitPrice) {
  const entry = Number(trade?.entryPrice);
  const exit = Number(exitPrice);
  const qty = Number(trade?.qty);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) {
    return { pnl: null, pnlPct: null };
  }
  const side = String(trade.side || 'buy').toLowerCase();
  const grossPnl = side === 'sell' ? (entry - exit) * qty : (exit - entry) * qty;
  const charges = estimateZerodhaIntradayCharges(entry, exit, qty, side);
  const pnl = grossPnl - charges.total;
  const pnlPct = (pnl / (entry * qty)) * 100;
  return { pnl:+pnl.toFixed(2), pnlPct:+pnlPct.toFixed(2), grossPnl:+grossPnl.toFixed(2), charges:charges.total, chargeBreakup:charges };
}

function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy') {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const quantity = Number(qty);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(quantity) || entry <= 0 || exit <= 0 || quantity <= 0) {
    return { total:0, totalPct:0, brokerage:0, stt:0, transaction:0, gst:0, sebi:0, stamp:0, turnover:0 };
  }
  const isShort = String(side || '').toLowerCase() === 'sell';
  const buyValue = (isShort ? exit : entry) * quantity;
  const sellValue = (isShort ? entry : exit) * quantity;
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
  const stt = sellValue * 0.00025;
  const transaction = turnover * 0.0000307;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = (brokerage + transaction + sebi) * 0.18;
  const total = brokerage + stt + transaction + sebi + stamp + gst;
  return {
    total:+total.toFixed(2),
    totalPct: buyValue > 0 ? +((total / buyValue) * 100).toFixed(3) : 0,
    brokerage:+brokerage.toFixed(2),
    stt:+stt.toFixed(2),
    transaction:+transaction.toFixed(2),
    gst:+gst.toFixed(2),
    sebi:+sebi.toFixed(2),
    stamp:+stamp.toFixed(2),
    turnover:+turnover.toFixed(2),
  };
}

function cleanTradingSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.NS$/i, '');
}

function buildZerodhaDryRunOrder(payload, trade, phase = 'entry') {
  const side = String(payload?.side || trade?.side || 'buy').toLowerCase();
  const isExit = phase === 'exit';
  const assetType = payload?.assetType || trade?.assetType || 'stock';
  const qty = Math.floor(Number(payload?.qty ?? trade?.qty));
  const price = Number(isExit ? payload?.exitPrice : payload?.entryPrice ?? trade?.entryPrice);
  const symbol = cleanTradingSymbol(payload?.symbol || trade?.symbol);
  if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const transactionType = isExit
    ? (side === 'sell' ? 'BUY' : 'SELL')
    : (side === 'sell' ? 'SELL' : 'BUY');
  const product = assetType === 'etf' && side !== 'sell' ? 'CNC' : 'MIS';
  return {
    exchange: 'NSE',
    tradingsymbol: symbol,
    transaction_type: transactionType,
    quantity: qty,
    product,
    order_type: 'LIMIT',
    price:+price.toFixed(2),
    validity: 'DAY',
    variety: 'regular',
    tag: 'stockdash-dry',
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function httpsGet(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      const enc    = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data',  c  => chunks.push(c));
      stream.on('end',   () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);
    req.end();
  });
}

function httpsJsonRequest(opts, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = https.request({
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      const enc    = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data',  c  => chunks.push(c));
      stream.on('end',   () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function jsonRequest(opts, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : JSON.stringify(payload || {});
    const transport = opts.protocol === 'https:' ? https : http;
    const headers = {
      ...(opts.headers || {}),
      ...(body != null ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      } : {}),
    };
    const req = transport.request({ ...opts, headers }, (res) => {
      const chunks = [];
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data',  c => chunks.push(c));
      stream.on('end',   () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function ollamaUrl(pathname) {
  return new URL(pathname, OLLAMA_BASE_URL);
}

async function ollamaRequest(pathname, method = 'GET', payload = null, timeout = 60000) {
  const url = ollamaUrl(pathname);
  const r = await jsonRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    timeout,
  }, payload);
  const data = JSON.parse(r.body || '{}');
  if (r.status < 200 || r.status >= 300) {
    const err = new Error(data.error || `Ollama HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function getOllamaModel(preferred) {
  const requested = String(preferred || OLLAMA_MODEL || '').trim();
  if (requested) return requested;
  try {
    const tags = await ollamaRequest('/api/tags', 'GET', null, 5000);
    const first = Array.isArray(tags.models) ? tags.models[0] : null;
    if (first?.name) return first.name;
  } catch (_) {}
  return 'llama3.1';
}

async function callOllamaChat({ prompt, model, maxOutputTokens = 800, timeoutMs }) {
  const selectedModel = await getOllamaModel(model);
  const data = await ollamaRequest('/api/chat', 'POST', {
    model: selectedModel,
    stream: false,
    keep_alive: '10m',
    messages: [
      {
        role: 'system',
        content: [
          'You are an Indian equity dashboard assistant.',
          'Use only the dashboard data supplied by the user.',
          'Never invent industry averages, market cap, price targets, ratios, or any metric that is not present in the supplied JSON.',
          'If a field is missing, omit it or say it is missing.',
          'Treat any local pre-filtered dashboard answer in the prompt as authoritative context.',
          'Return concise HTML fragments only, without markdown fences, html, head, title, or body tags.',
          'Use Rs for all prices and never use USD unless the user explicitly asks for USD.',
          'For rankings or comparisons, include a compact table with the most relevant metrics and at most 8 rows.',
          'Mention when a metric is missing instead of guessing.',
          'Do not provide investment guarantees.',
        ].join(' '),
      },
      { role: 'user', content: String(prompt || '') },
    ],
    options: {
      temperature: 0.2,
      num_predict: Math.max(160, Math.min(Number(maxOutputTokens) || 800, 1600)),
    },
  }, Math.max(30000, Number(timeoutMs) || OLLAMA_TIMEOUT_MS || 180000));
  const text = data.message?.content || data.response || '';
  return { ok: true, model: data.model || selectedModel, output_text: text, content: [{ type: 'text', text }] };
}

function extractOpenAIText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

async function callOpenAIResponse({ prompt, mode = 'json', maxOutputTokens = 2000, webSearch = true }) {
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error(`OPENAI_API_KEY is not set in environment or ${USER_OPENAI_PROPERTIES}`);
    err.status = 400;
    throw err;
  }
  const instructions = mode === 'html'
    ? 'Return plain HTML only. Do not use markdown fences.'
    : 'Return ONLY raw JSON with no markdown, no preamble, no backticks.';
  const payload = {
    model: OPENAI_MODEL,
    instructions,
    input: String(prompt || ''),
    max_output_tokens: Math.max(200, Math.min(Number(maxOutputTokens) || 2000, 4000)),
  };
  if (webSearch) {
    payload.tools = [{ type: 'web_search' }];
    payload.tool_choice = 'auto';
  }
  const r = await httpsJsonRequest({
    hostname: 'api.openai.com',
    path: '/v1/responses',
    method: 'POST',
    timeout: 45000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }, payload);
  const data = JSON.parse(r.body || '{}');
  if (r.status < 200 || r.status >= 300) {
    const err = new Error(data.error?.message || `OpenAI HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const text = extractOpenAIText(data);
  return { ok: true, model: data.model || OPENAI_MODEL, output_text: text, content: [{ type: 'text', text }] };
}

// ══════════════════════════════════════════════════════════
//  STOCK NEWS / EVENTS
// ══════════════════════════════════════════════════════════
const stockNewsCache = {};

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(str) {
  return decodeXmlEntities(str).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyNewsItem(text) {
  const s = String(text || '').toLowerCase();
  if (/quarter|q[1-4]\b|financial result|earnings|profit|net profit|revenue|sales|ebitda/.test(s)) return 'Results';
  if (/dividend/.test(s)) return 'Dividend';
  if (/large deal|bulk deal|block deal|stake sale|acquisition|merger|joint venture|mou|contract|order win|wins order|bags order/.test(s)) return 'Deal';
  if (/board meeting|record date|dividend|bonus|split|buyback|agm|egm|conference call|investor meet/.test(s)) return 'Event';
  if (/announcement|press release|exchange filing|clarification|disclosure|intimation/.test(s)) return 'Announcement';
  return 'News';
}

function classifyNewsTradeImpact(item) {
  const text = `${item?.type || ''} ${item?.title || ''} ${item?.subject || ''} ${item?.purpose || ''}`.toLowerCase();
  const verdict = String(item?.resultVerdict || '').toLowerCase();
  let score = 0;
  let label = 'Neutral';
  let reason = 'Routine disclosure; no clear directional trade impact';

  if (verdict === 'positive') {
    score = 90; label = 'Positive'; reason = item.resultVerdictReason || 'Positive quarterly result trend';
  } else if (verdict === 'negative') {
    score = -90; label = 'Negative'; reason = item.resultVerdictReason || 'Weak quarterly result trend';
  } else if (verdict === 'mixed') {
    score = 35; label = 'Neutral'; reason = item.resultVerdictReason || 'Mixed quarterly result trend';
  } else if (/disclosure under sebi takeover|substantial acquisition of shares and takeovers|regulation 31\(4\)|regulation 29\(2\)|regulation 30\(1\)|shareholding pattern|encumbrance of shares/.test(text)) {
    score = 20; label = 'Neutral'; reason = 'Shareholding or regulatory disclosure; monitor but not directional by itself';
  } else if (/profit warning|loss|default|insolvency|bankruptcy|fraud|forensic|penalty|fine|show cause|tax demand|raid|seizure|litigation|adverse|downgrade|suspension|resignation of auditor|auditor resignation|pledge|fire|accident|shutdown|strike|delay in payment|non[- ]?compliance/.test(text)) {
    score = -85; label = 'Negative'; reason = 'Potential adverse event or compliance risk';
  } else if (/order win|wins order|bags order|contract|agreement|mou|letter of award|loa|large deal|bulk deal|block deal|acquisition|merger|capacity expansion|commissioning|approval|patent|product launch|licen[cs]e|partnership/.test(text)) {
    score = 80; label = 'Positive'; reason = 'Business momentum, deal, approval, or expansion news';
  } else if (/buyback|bonus|stock split|split|dividend|record date/.test(text)) {
    score = /dividend/.test(text) ? 55 : 65;
    label = 'Positive';
    reason = 'Shareholder return or corporate action';
  } else if (/fund raising|qip|preferential issue|rights issue|issue of securities|qualified institutions placement/.test(text)) {
    score = 30; label = 'Neutral'; reason = 'Capital raise event; watch pricing and dilution';
  } else if (/board meeting.*result|financial result|quarterly result|earnings|result filing/.test(text)) {
    score = 60; label = 'Neutral'; reason = 'Result-related event; directional impact depends on numbers';
  } else if (/board meeting|investor meet|conference call|analyst meet|newspaper publication|closure of trading window|scrutinizer|agm|egm/.test(text)) {
    score = 15; label = 'Neutral'; reason = 'Scheduled or administrative event';
  } else if (/clarification|disclosure|intimation|announcement|press release|updates/.test(text)) {
    score = 20; label = 'Neutral'; reason = 'General company update';
  }

  return {
    newsSentiment:label,
    tradeImpactScore:score,
    tradeImpactAbs:Math.abs(score),
    tradeImpactReason:reason,
  };
}

function parseNSEDate(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const mo = months[m[2]];
    if (mo != null) return new Date(Number(m[3]), mo, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODateOrNull(value) {
  if (!value) return null;
  const d = parseNSEDate(value);
  return d ? d.toISOString() : null;
}

function pickLatestByDate(rows, fields) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const ad = fields.map(f => parseNSEDate(a?.[f])).find(Boolean);
    const bd = fields.map(f => parseNSEDate(b?.[f])).find(Boolean);
    return (bd?.getTime() || 0) - (ad?.getTime() || 0);
  })[0] || null;
}

function getXbrlFact(xml, tag) {
  const re = new RegExp(`<(?:[A-Za-z0-9_\\-.]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_\\-.]+:)?${tag}>`, 'gi');
  let fallback = null;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const context = (attrs.match(/\bcontextRef=["']([^"']+)["']/i) || [])[1] || '';
    const value = Number(stripHtml(m[2]).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const fact = { context, value };
    if (!fallback) fallback = fact;
    if (/^(OneD|CurrentYearDuration|CurrentPeriodDuration|D_)/i.test(context)) return fact;
  }
  return fallback;
}

function getFirstXbrlFact(xml, tags) {
  for (const tag of tags) {
    const fact = getXbrlFact(xml, tag);
    if (fact) return fact;
  }
  return null;
}

function inrToCrore(value) {
  return Number.isFinite(value) ? +(value / 10000000).toFixed(2) : null;
}

function pctChange(newVal, oldVal) {
  if (!Number.isFinite(newVal) || !Number.isFinite(oldVal) || oldVal === 0) return null;
  return +(((newVal - oldVal) / Math.abs(oldVal)) * 100).toFixed(1);
}

async function fetchResultMetricsFromXbrl(url) {
  if (!url) return {};
  const u = new URL(url);
  const xr = await httpsGet({
    hostname: u.hostname,
    path: u.pathname + (u.search || ''),
    method: 'GET',
    timeout: 15000,
    headers: { ...NSE_HEADERS, Referer: 'https://www.nseindia.com/' },
  });
  if (xr.status !== 200) return {};
  const revenue = getFirstXbrlFact(xr.body, [
    'RevenueFromOperations',
    'RevenueFromOperationsNet',
    'InterestEarned',
    'TotalIncome',
    'Income',
  ]);
  const pbt = getFirstXbrlFact(xr.body, [
    'ProfitBeforeTax',
    'ProfitLossBeforeTax',
    'ProfitBeforeExceptionalItemsAndTax',
  ]);
  const pat = getFirstXbrlFact(xr.body, [
    'ProfitLossForPeriod',
    'ProfitAfterTax',
    'NetProfitLossForThePeriod',
    'ProfitLoss',
    'ProfitLossAttributableToOwnersOfParent',
  ]);
  const eps = getFirstXbrlFact(xr.body, [
    'BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations',
    'BasicEarningsLossPerShareFromContinuingOperations',
    'BasicEarningsLossPerShare',
    'BasicEarningsPerShare',
  ]);
  return {
    revenueCr: inrToCrore(revenue?.value),
    profitBeforeTaxCr: inrToCrore(pbt?.value),
    profitAfterTaxCr: inrToCrore(pat?.value),
    eps: eps?.value ?? null,
  };
}

function classifyResultVerdict(cur, prev) {
  const revGrowth = pctChange(cur?.revenueCr, prev?.revenueCr);
  const patGrowth = pctChange(cur?.profitAfterTaxCr, prev?.profitAfterTaxCr);
  const epsGrowth = pctChange(cur?.eps, prev?.eps);
  const checks = [revGrowth, patGrowth, epsGrowth].filter(v => v != null);
  if (!checks.length) return { verdict: null, revenueGrowthPct: revGrowth, patGrowthPct: patGrowth, epsGrowthPct: epsGrowth, reason: null };
  let score = 0;
  if (revGrowth != null) score += revGrowth >= 5 ? 1 : revGrowth <= -5 ? -1 : 0;
  if (patGrowth != null) score += patGrowth >= 5 ? 2 : patGrowth <= -5 ? -2 : 0;
  if (epsGrowth != null) score += epsGrowth >= 5 ? 1 : epsGrowth <= -5 ? -1 : 0;
  const verdict = score >= 2 ? 'Positive' : score <= -2 ? 'Negative' : 'Mixed';
  const parts = [];
  if (revGrowth != null) parts.push(`Revenue ${revGrowth >= 0 ? '+' : ''}${revGrowth}%`);
  if (patGrowth != null) parts.push(`PAT ${patGrowth >= 0 ? '+' : ''}${patGrowth}%`);
  if (epsGrowth != null) parts.push(`EPS ${epsGrowth >= 0 ? '+' : ''}${epsGrowth}%`);
  return { verdict, revenueGrowthPct: revGrowth, patGrowthPct: patGrowth, epsGrowthPct: epsGrowth, reason: parts.join(', ') };
}

function conciseAnnouncementTitle(item) {
  const desc = stripHtml(item?.desc || item?.subject || '');
  const text = stripHtml(item?.attchmntText || '');
  if (!text) return desc || 'Corporate announcement';
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  if (/^(updates|press release|outcome of board meeting|copy of newspaper publication|record date)$/i.test(desc)) {
    return sentence.slice(0, 260);
  }
  return `${desc}: ${sentence}`.slice(0, 280);
}

function parseRssItems(xml, sourceLabel) {
  const items = [];
  const matches = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const raw of matches) {
    const get = tag => {
      const m = raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? stripHtml(m[1]) : '';
    };
    const title = get('title');
    const link = get('link');
    const pubDate = get('pubDate');
    const source = get('source') || sourceLabel;
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      source,
      publishedAt: toISODateOrNull(pubDate),
      type: classifyNewsItem(title),
    });
  }
  return items;
}

async function fetchGoogleNews(query) {
  const path = `/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await httpsGet({
    hostname: 'news.google.com',
    path,
    method: 'GET',
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  if (r.status !== 200) throw new Error(`Google News RSS ${r.status}`);
  return parseRssItems(r.body, 'Google News');
}

async function nseJsonWithRetry(path, label, retries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (Date.now() - nse.lastRefresh > nse.TTL || attempt > 1) await warmNSESession();
      let r = await nseGet(path);
      if (r.status === 401 || r.status === 403) {
        await warmNSESession();
        r = await nseGet(path);
      }
      if (r.status !== 200) throw new Error(`${label} HTTP ${r.status}`);
      return JSON.parse(r.body);
    } catch(e) {
      lastErr = e;
      const retryable = e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' ||
                        /socket hang up|timed out|ECONNRESET/i.test(e.message || '');
      if (!retryable || attempt === retries) break;
      await new Promise(r => setTimeout(r, attempt * 750));
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

async function fetchNSEStockAnnouncements(symbol) {
  try {
    const payload = await nseJsonWithRetry(`/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`, 'announcements');
    const rows = payload?.data || payload || [];
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 40).map(item => {
      const title = conciseAnnouncementTitle(item);
      const dateRaw = item.an_dt || item.sort_date || item.dissemDT || item.dt || null;
      const attachment = item.attchmntFile || item.attchmntFileName || item.fileURL || '';
      const url = attachment
        ? (String(attachment).startsWith('http') ? attachment : `https://www.nseindia.com${attachment}`)
        : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;
      const kind = classifyNewsItem(`${title} ${item.subject || ''} ${item.attchmntText || ''}`);
      return {
        title,
        url,
        source: 'NSE',
        publishedAt: toISODateOrNull(dateRaw),
        type: kind === 'Results' ? 'Result Filing' : kind,
      };
    }).filter(x => x.title);
  } catch(e) {
    console.warn(`[stock-news] NSE announcements failed for ${symbol}:`, e.message);
    return [];
  }
}

async function fetchNSELatestResult(symbol) {
  try {
    const rows = await nseJsonWithRetry(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}&period=Quarterly`, 'results');
    const latest = pickLatestByDate(rows, ['filingDate', 'broadCastDate', 'toDate']);
    if (!latest) return null;
    const result = {
      type: 'Results',
      source: 'NSE',
      symbol,
      title: `${latest.relatingTo || latest.period || 'Quarterly'} result (${latest.consolidated || 'reported'})`,
      period: latest.relatingTo || latest.period || null,
      toDate: toISODateOrNull(latest.toDate),
      filingDate: toISODateOrNull(latest.filingDate || latest.broadCastDate),
      publishedAt: toISODateOrNull(latest.filingDate || latest.broadCastDate || latest.toDate),
      consolidated: latest.consolidated || null,
      audited: latest.audited || null,
      url: latest.xbrl || latest.resultDetailedDataLink || `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      revenueCr: null,
      profitBeforeTaxCr: null,
      profitAfterTaxCr: null,
      eps: null,
      resultVerdict: null,
      resultVerdictReason: null,
      revenueGrowthPct: null,
      patGrowthPct: null,
      epsGrowthPct: null,
    };
    if (latest.xbrl) {
      try {
        const metrics = await fetchResultMetricsFromXbrl(latest.xbrl);
        Object.assign(result, metrics);
        const candidates = [...(Array.isArray(rows) ? rows : [])]
          .filter(r => r && r !== latest && r.xbrl)
          .filter(r => !latest.consolidated || !r.consolidated || r.consolidated === latest.consolidated)
          .sort((a, b) => {
            const ad = ['filingDate', 'broadCastDate', 'toDate'].map(f => parseNSEDate(a?.[f])).find(Boolean);
            const bd = ['filingDate', 'broadCastDate', 'toDate'].map(f => parseNSEDate(b?.[f])).find(Boolean);
            return (bd?.getTime() || 0) - (ad?.getTime() || 0);
          });
        const previous = candidates[0] ? await fetchResultMetricsFromXbrl(candidates[0].xbrl).catch(() => ({})) : {};
        const verdict = classifyResultVerdict(metrics, previous);
        result.resultVerdict = verdict.verdict;
        result.resultVerdictReason = verdict.reason;
        result.revenueGrowthPct = verdict.revenueGrowthPct;
        result.patGrowthPct = verdict.patGrowthPct;
        result.epsGrowthPct = verdict.epsGrowthPct;
      } catch(e) {
        console.warn(`[stock-news] result XBRL parse failed for ${symbol}:`, e.message);
      }
    }
    return result;
  } catch(e) {
    console.warn(`[stock-news] NSE results failed for ${symbol}:`, e.message);
    return null;
  }
}

async function fetchNSECorporateActions(symbol) {
  try {
    const rows = await nseJsonWithRetry(`/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`, 'corporate actions');
    return rows.slice(0, 20).map(item => ({
      type: /dividend/i.test(item.subject || '') ? 'Dividend' : 'Corporate Action',
      title: stripHtml(item.subject || 'Corporate action'),
      source: 'NSE',
      exDate: toISODateOrNull(item.exDate),
      recordDate: toISODateOrNull(item.recDate),
      publishedAt: toISODateOrNull(item.exDate || item.recDate),
      url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    })).filter(x => x.title);
  } catch(e) {
    console.warn(`[stock-news] NSE corporate actions failed for ${symbol}:`, e.message);
    return [];
  }
}

async function fetchNSEBoardMeetings(symbol) {
  try {
    const rows = await nseJsonWithRetry(`/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`, 'board meetings');
    return rows.slice(0, 20).map(item => ({
      type: /result/i.test(`${item.bm_purpose || ''} ${item.bm_desc || ''}`) ? 'Result Date' : 'Board Meeting',
      title: stripHtml(item.bm_desc || item.bm_purpose || 'Board meeting'),
      source: 'NSE',
      eventDate: toISODateOrNull(item.bm_date),
      publishedAt: toISODateOrNull(item.bm_date || item.bm_timestamp),
      url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    })).filter(x => x.title);
  } catch(e) {
    console.warn(`[stock-news] NSE board meetings failed for ${symbol}:`, e.message);
    return [];
  }
}

function nseRowSymbol(item) {
  return String(item?.symbol || item?.Symbol || item?.sm_symbol || item?.bm_symbol || item?.compSymbol || item?.companySymbol || item?.securitySymbol || '').trim().toUpperCase();
}

async function fetchNSEAllAnnouncements() {
  try {
    const payload = await nseJsonWithRetry('/api/corporate-announcements?index=equities', 'all announcements');
    const rows = payload?.data || payload || [];
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 500).map(item => {
      const symbol = nseRowSymbol(item);
      const title = conciseAnnouncementTitle(item);
      const dateRaw = item.an_dt || item.sort_date || item.dissemDT || item.dt || null;
      const attachment = item.attchmntFile || item.attchmntFileName || item.fileURL || '';
      const url = attachment
        ? (String(attachment).startsWith('http') ? attachment : `https://www.nseindia.com${attachment}`)
        : (symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : 'https://www.nseindia.com/companies-listing/corporate-filings-announcements');
      const kind = classifyNewsItem(`${title} ${item.subject || ''} ${item.attchmntText || ''}`);
      return { symbol, title, url, source:'NSE', publishedAt:toISODateOrNull(dateRaw), type:kind === 'Results' ? 'Result Filing' : kind };
    }).filter(x => x.symbol && x.title);
  } catch(e) {
    console.warn('[fresh-news] NSE all announcements failed:', e.message);
    return [];
  }
}

async function fetchNSEAllResults() {
  try {
    const rows = await nseJsonWithRetry('/api/corporates-financial-results?index=equities&period=Quarterly', 'all results');
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 300).map(item => {
      const symbol = nseRowSymbol(item);
      return {
        symbol,
        type:'Results',
        source:'NSE',
        title:`${item.relatingTo || item.period || 'Quarterly'} result (${item.consolidated || 'reported'})`,
        period:item.relatingTo || item.period || null,
        toDate:toISODateOrNull(item.toDate),
        filingDate:toISODateOrNull(item.filingDate || item.broadCastDate),
        publishedAt:toISODateOrNull(item.filingDate || item.broadCastDate || item.toDate),
        url:item.xbrl || item.resultDetailedDataLink || (symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : ''),
      };
    }).filter(x => x.symbol);
  } catch(e) {
    console.warn('[fresh-news] NSE all results failed:', e.message);
    return [];
  }
}

async function fetchNSEAllCorporateActions() {
  try {
    const rows = await nseJsonWithRetry('/api/corporates-corporateActions?index=equities', 'all corporate actions');
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 300).map(item => {
      const symbol = nseRowSymbol(item);
      return {
        symbol,
        type:/dividend/i.test(item.subject || '') ? 'Dividend' : 'Corporate Action',
        title:stripHtml(item.subject || 'Corporate action'),
        source:'NSE',
        exDate:toISODateOrNull(item.exDate),
        recordDate:toISODateOrNull(item.recDate),
        publishedAt:toISODateOrNull(item.exDate || item.recDate),
        url:symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : '',
      };
    }).filter(x => x.symbol && x.title);
  } catch(e) {
    console.warn('[fresh-news] NSE all corporate actions failed:', e.message);
    return [];
  }
}

async function fetchNSEAllBoardMeetings() {
  try {
    const rows = await nseJsonWithRetry('/api/corporate-board-meetings?index=equities', 'all board meetings');
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 300).map(item => {
      const symbol = nseRowSymbol(item);
      return {
        symbol,
        type:/result/i.test(`${item.bm_purpose || ''} ${item.bm_desc || ''}`) ? 'Result Date' : 'Board Meeting',
        title:stripHtml(item.bm_desc || item.bm_purpose || 'Board meeting'),
        source:'NSE',
        eventDate:toISODateOrNull(item.bm_date),
        publishedAt:toISODateOrNull(item.bm_date || item.bm_timestamp),
        url:symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : '',
      };
    }).filter(x => x.symbol && x.title);
  } catch(e) {
    console.warn('[fresh-news] NSE all board meetings failed:', e.message);
    return [];
  }
}

function dedupeNews(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
}

function sortEvents(items) {
  const priority = { Results: 0, 'Result Filing': 1, Dividend: 2, 'Corporate Action': 3, 'Result Date': 4, 'Board Meeting': 5 };
  return dedupeNews(items).sort((a, b) => {
    const ap = priority[a.type] ?? 9;
    const bp = priority[b.type] ?? 9;
    if (ap !== bp) return ap - bp;
    return (Date.parse(b.publishedAt || b.filingDate || b.exDate || b.eventDate || 0) || 0)
      - (Date.parse(a.publishedAt || a.filingDate || a.exDate || a.eventDate || 0) || 0);
  });
}

function eventHighlights(items, max = 10) {
  const sorted = sortEvents(items);
  const preferred = ['Results', 'Result Filing', 'Dividend', 'Corporate Action', 'Result Date', 'Board Meeting'];
  const out = [];
  for (const type of preferred) {
    const found = type === 'Results'
      ? sorted.find(item => item.type === type && !/transcript|audio recording|analyst|institutional investor|conference call|con\. call/i.test(item.title || '') && !out.includes(item))
        || sorted.find(item => item.type === type && !out.includes(item))
      : sorted.find(item => item.type === type && !out.includes(item));
    if (found) out.push(found);
  }
  for (const item of sorted) {
    if (out.length >= max) break;
    if (!out.includes(item)) out.push(item);
  }
  return out.slice(0, max);
}

async function fetchStockNews(symbol, name, assetType = 'stock') {
  const sym = String(symbol || '').trim().toUpperCase();
  const company = String(name || '').trim();
  const isETF = String(assetType || '').toLowerCase() === 'etf';
  const cacheKey = `${sym}|${isETF ? 'etf' : 'stock'}|${company}`;
  const cached = stockNewsCache[cacheKey];
  if (cached && (Date.now() - cached.savedAt) < STOCK_NEWS_TTL) return { ...cached.data, fromCache: true };

  const base = company && company.toUpperCase() !== sym
    ? `"${company}" ${sym} NSE ${isETF ? 'ETF' : 'stock'}`
    : `${sym} NSE ${isETF ? 'ETF' : 'stock'}`;
  const queries = isETF
    ? [
        `${base} announcement NAV expense ratio tracking error`,
        `${base} dividend distribution record date`,
        `${base} index change rebalancing fund update`,
      ]
    : [
        `${base} NSE quarterly results earnings`,
        `${base} NSE announcement board meeting dividend`,
        `${base} "large deal" OR "bulk deal" OR "order win" OR contract`,
      ];
  const sources = isETF
    ? [fetchNSEStockAnnouncements(sym), ...queries.map(fetchGoogleNews)]
    : [fetchNSELatestResult(sym), fetchNSECorporateActions(sym), fetchNSEBoardMeetings(sym), fetchNSEStockAnnouncements(sym), ...queries.map(fetchGoogleNews)];
  const settled = await Promise.allSettled(sources);
  const items = [];
  const events = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const item of r.value) {
        if (item?.source === 'NSE' && ['Results', 'Dividend', 'Corporate Action', 'Board Meeting', 'Result Date'].includes(item?.type)) events.push(item);
        else items.push(item);
      }
    }
    else if (r.status === 'fulfilled' && r.value && r.value.type === 'Results') events.unshift(r.value);
    else if (r.status === 'rejected') console.warn('[stock-news] source failed:', r.reason?.message || r.reason);
  }
  const data = {
    ok: true,
    symbol: sym,
    name: company || sym,
    assetType: isETF ? 'etf' : 'stock',
    savedAt: Date.now(),
    events: eventHighlights(events, 10),
    news: dedupeNews(items).slice(0, 24),
  };
  stockNewsCache[cacheKey] = { savedAt: Date.now(), data };
  return data;
}

function istDateKeyFromValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function lastBusinessDateKey(base = new Date()) {
  const ist = new Date(base.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setUTCHours(0, 0, 0, 0);
  do {
    ist.setUTCDate(ist.getUTCDate() - 1);
  } while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6);
  return ist.toISOString().slice(0, 10);
}

function freshNewsDateKey() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  return (day === 0 || day === 6) ? lastBusinessDateKey(now) : ist.toISOString().slice(0, 10);
}

function itemNewsDateKey(item) {
  return istDateKeyFromValue(item?.publishedAt || item?.filingDate || item?.exDate || item?.recordDate || item?.eventDate || item?.toDate);
}

function isFreshNewsImportant(item) {
  const text = `${item?.type || ''} ${item?.title || ''} ${item?.subject || ''} ${item?.purpose || ''}`;
  return /result|financial|earnings|dividend|board|bonus|split|buyback|large deal|bulk deal|block deal|acquisition|merger|mou|contract|order win|bags order|corporate action|announcement/i.test(text);
}

function normalizeFreshNewsUniverse(symbols, maxSymbols = 300) {
  return (Array.isArray(symbols) ? symbols : [])
    .map(item => typeof item === 'string' ? { symbol:item } : item)
    .map(item => ({
      symbol:String(item?.symbol || item?.sym || '').trim().toUpperCase(),
      name:String(item?.name || '').trim(),
      assetType:String(item?.assetType || item?.type || 'stock').trim().toLowerCase(),
    }))
    .filter(item => item.symbol)
    .slice(0, maxSymbols);
}

function loadDashboardStockUniverse() {
  const rows = [];
  try {
    const jsFile = path.join(__dirname, 'dashboard-app.js');
    const source = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, 'utf8') : '';
    const block = source.match(/const\s+MIDCAP_STOCKS\s*=\s*\[([\s\S]*?)\];/);
    const text = block ? block[1] : source;
    const re = /\{\s*sym:'([^']+)'\s*,\s*name:'([^']*)'[\s\S]*?sector:'([^']*)'[\s\S]*?cap:'([^']*)'/g;
    let m;
    while ((m = re.exec(text))) {
      rows.push({ symbol:m[1].trim().toUpperCase(), name:m[2].trim(), assetType:'stock', sector:m[3], cap:m[4] });
    }
  } catch(e) {
    console.warn('[fresh-news-cache] dashboard universe load failed:', e.message);
  }
  try {
    for (const item of loadSavedStocksFile()) {
      const symbol = String(item?.sym || item?.symbol || item || '').trim().toUpperCase();
      if (symbol) rows.push({
        symbol,
        name:String(item?.name || symbol),
        assetType:'stock',
        sector:item?.sector || 'Custom',
        cap:item?.cap || 'custom'
      });
    }
  } catch(e) {
    console.warn('[fresh-news-cache] saved stock universe load failed:', e.message);
  }
  const seen = new Set();
  return rows.filter(row => {
    if (!row.symbol || seen.has(row.symbol)) return false;
    seen.add(row.symbol);
    return true;
  });
}

function freshNewsBuildUniverse(requestedUniverse) {
  const rows = [...loadDashboardStockUniverse(), ...(Array.isArray(requestedUniverse) ? requestedUniverse : [])];
  const seen = new Set();
  return rows.filter(row => {
    const symbol = String(row?.symbol || row?.sym || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    row.symbol = symbol;
    row.name = String(row.name || symbol);
    row.assetType = String(row.assetType || row.type || 'stock').toLowerCase();
    return true;
  }).slice(0, 320);
}

function freshNewsDayFile(targetDate) {
  const dateKey = String(targetDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`Invalid fresh news date: ${targetDate}`);
  return path.join(FRESH_NEWS_CACHE_DIR, `fresh_stock_news_${dateKey}.json`);
}

function freshNewsDayMeta(entry) {
  return {
    date:entry.date,
    savedAt:entry.savedAt || Date.now(),
    builtInMs:entry.builtInMs || 0,
    source:entry.source || 'nse-market-wide',
    scanned:entry.scanned || 0,
    count:entry.count || 0,
    symbolCount:entry.symbolCount || 0,
  };
}

function emptyFreshNewsIndex() {
  return { version:FRESH_NEWS_CACHE_VERSION, savedAt:0, partitioned:true, days:{} };
}

function loadFreshNewsIndex() {
  if (freshNewsDayCache) return freshNewsDayCache;
  freshNewsDayCache = emptyFreshNewsIndex();
  try {
    ensureDir(FRESH_NEWS_CACHE_DIR);
    if (fs.existsSync(FRESH_NEWS_CACHE_INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FRESH_NEWS_CACHE_INDEX_FILE, 'utf8') || '{}');
      if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
        freshNewsDayCache = {
          version:raw.version || 1,
          savedAt:raw.savedAt || 0,
          partitioned:true,
          days:raw.days,
        };
        if (freshNewsDayCache.version !== FRESH_NEWS_CACHE_VERSION) {
          console.log(`[fresh-news-cache] index v${freshNewsDayCache.version} is old; rebuilding as v${FRESH_NEWS_CACHE_VERSION}`);
          freshNewsDayCache = emptyFreshNewsIndex();
        }
      }
    } else {
      migrateFreshNewsCombinedCache();
    }
    const count = Object.keys(freshNewsDayCache.days || {}).length;
    if (count) console.log(`[fresh-news-cache] Loaded ${count} partitioned day entries`);
  } catch(e) {
    console.warn('[fresh-news-cache] Index load error:', e.message);
    freshNewsDayCache = emptyFreshNewsIndex();
  }
  return freshNewsDayCache;
}

function saveFreshNewsIndex() {
  try {
    const index = loadFreshNewsIndex();
    index.version = FRESH_NEWS_CACHE_VERSION;
    index.partitioned = true;
    index.savedAt = Date.now();
    ensureDir(FRESH_NEWS_CACHE_DIR);
    fs.writeFileSync(FRESH_NEWS_CACHE_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  } catch(e) {
    console.warn('[fresh-news-cache] Index save error:', e.message);
  }
}

function migrateFreshNewsCombinedCache() {
  try {
    if (!fs.existsSync(FRESH_NEWS_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FRESH_NEWS_CACHE_FILE, 'utf8') || '{}');
    const days = raw && raw.days && typeof raw.days === 'object' ? raw.days : {};
    let moved = 0;
    for (const [day, entry] of Object.entries(days)) {
      if (!entry || !Array.isArray(entry.items)) continue;
      const dayEntry = { ...entry, version:FRESH_NEWS_CACHE_VERSION, date:entry.date || day };
      fs.writeFileSync(freshNewsDayFile(day), JSON.stringify(dayEntry, null, 2), 'utf8');
      freshNewsDayCache.days[day] = freshNewsDayMeta(dayEntry);
      moved++;
    }
    if (moved) {
      freshNewsDayCache.savedAt = Date.now();
      console.log(`[fresh-news-cache] Partitioned ${moved} legacy day entries`);
      saveFreshNewsIndex();
    }
  } catch(e) {
    console.warn('[fresh-news-cache] Legacy partition error:', e.message);
  }
}

function readFreshNewsDayEntry(targetDate) {
  try {
    const file = freshNewsDayFile(targetDate);
    if (!fs.existsSync(file)) return null;
    const entry = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    if (!entry || !Array.isArray(entry.items)) return null;
    const needsUpgrade = (entry.version || 1) !== FRESH_NEWS_CACHE_VERSION ||
      entry.items.some(item => !item.newsSentiment || item.tradeImpactScore == null);
    if (needsUpgrade) {
      entry.version = FRESH_NEWS_CACHE_VERSION;
      entry.items = dedupeFreshNewsItems(entry.items.map(item => ({
        ...item,
        ...classifyNewsTradeImpact(item),
      })));
      entry.count = entry.items.length;
      entry.symbolCount = new Set(entry.items.map(item => item.symbol)).size;
      writeFreshNewsDayEntry(entry);
    }
    return entry;
  } catch(e) {
    console.warn(`[fresh-news-cache] Day read error ${targetDate}:`, e.message);
    return null;
  }
}

function writeFreshNewsDayEntry(entry) {
  try {
    ensureDir(FRESH_NEWS_CACHE_DIR);
    const dayEntry = { ...entry, version:FRESH_NEWS_CACHE_VERSION };
    fs.writeFileSync(freshNewsDayFile(dayEntry.date), JSON.stringify(dayEntry, null, 2), 'utf8');
    const index = loadFreshNewsIndex();
    index.days[dayEntry.date] = freshNewsDayMeta(dayEntry);
    pruneFreshNewsDayCache(index);
    saveFreshNewsIndex();
  } catch(e) {
    console.warn(`[fresh-news-cache] Day save error ${entry?.date || ''}:`, e.message);
  }
}

function pruneFreshNewsDayCache(index) {
  const days = Object.keys(index.days || {}).sort().reverse();
  for (const day of days.slice(FRESH_NEWS_CACHE_MAX_DAYS)) {
    delete index.days[day];
    try {
      const file = freshNewsDayFile(day);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch(e) {
      console.warn(`[fresh-news-cache] Prune error ${day}:`, e.message);
    }
  }
}

function normalizeFreshMarketNewsItem(item, targetDate) {
  const sym = String(item?.symbol || '').trim().toUpperCase();
  if (!sym) return null;
  const dateKey = itemNewsDateKey(item);
  if (dateKey !== targetDate) return null;
  if (!isFreshNewsImportant(item)) return null;
  const normalized = {
    symbol:sym,
    name:String(item?.name || sym),
    assetType:String(item?.assetType || 'stock').toLowerCase(),
    type:item.type || classifyNewsItem(item.title || ''),
    title:item.title || item.type || 'News',
    source:item.source || 'NSE',
    url:item.url || '',
    publishedAt:item.publishedAt || item.filingDate || item.exDate || item.eventDate || null,
    dateKey,
    resultVerdict:item.resultVerdict || null,
    resultVerdictReason:item.resultVerdictReason || null,
  };
  return { ...normalized, ...classifyNewsTradeImpact(normalized) };
}

function dedupeFreshNewsItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items.sort((a, b) =>
    (Number(b.tradeImpactAbs || 0) - Number(a.tradeImpactAbs || 0)) ||
    (Number(b.tradeImpactScore || 0) - Number(a.tradeImpactScore || 0)) ||
    ((Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
  )) {
    const key = `${item.symbol}|${String(item.type || '').toLowerCase()}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function buildFreshNewsDayEntry(targetDate, requestedUniverse = []) {
  if (freshNewsBuildJobs.has(targetDate)) return freshNewsBuildJobs.get(targetDate);
  const job = (async () => {
    const startedAt = Date.now();
    const items = [];
    const errors = [];
    const universe = freshNewsBuildUniverse(requestedUniverse);
    const marketSettled = await Promise.allSettled([
      fetchNSEAllAnnouncements(),
      fetchNSEAllResults(),
      fetchNSEAllCorporateActions(),
      fetchNSEAllBoardMeetings(),
    ]);
    for (const r of marketSettled) {
      if (r.status === 'rejected') {
        errors.push(r.reason?.message || String(r.reason || 'unknown'));
        continue;
      }
      for (const raw of (Array.isArray(r.value) ? r.value : [])) {
        const normalized = normalizeFreshMarketNewsItem(raw, targetDate);
        if (normalized) items.push(normalized);
      }
    }
    const symbolRows = new Map(universe.map(row => [row.symbol, row]));
    const alreadySeenAnnouncement = new Set(items
      .filter(item => item.source === 'NSE')
      .map(item => `${item.symbol}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`));
    const concurrency = 8;
    for (let i = 0; i < universe.length; i += concurrency) {
      const chunk = universe.slice(i, i + concurrency);
      const settled = await Promise.allSettled(chunk.map(row =>
        fetchNSEStockAnnouncements(row.symbol).then(news => ({ row, news }))
      ));
      for (const r of settled) {
        if (r.status !== 'fulfilled') {
          errors.push(r.reason?.message || String(r.reason || 'unknown'));
          continue;
        }
        const { row, news } = r.value;
        for (const raw of (Array.isArray(news) ? news : [])) {
          const item = normalizeFreshMarketNewsItem({ ...raw, symbol:row.symbol, name:row.name, assetType:row.assetType }, targetDate);
          if (!item) continue;
          const titleKey = `${item.symbol}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`;
          if (alreadySeenAnnouncement.has(titleKey)) continue;
          alreadySeenAnnouncement.add(titleKey);
          items.push(item);
        }
      }
      if (i + concurrency < universe.length) await new Promise(r => setTimeout(r, 120));
    }
    for (const item of items) {
      const row = symbolRows.get(item.symbol);
      if (row) {
        item.name = row.name || item.name || item.symbol;
        item.assetType = row.assetType || item.assetType || 'stock';
      }
    }
    const deduped = dedupeFreshNewsItems(items);
    const symbolsWithNews = new Set(deduped.map(item => item.symbol));
    return {
      ok:true,
      date:targetDate,
      savedAt:Date.now(),
      builtInMs:Date.now() - startedAt,
      source:'nse-market-wide+symbol-announcements',
      scanned:universe.length,
      count:deduped.length,
      symbolCount:symbolsWithNews.size,
      items:deduped.slice(0, 500),
      errors:errors.slice(0, 10),
    };
  })().finally(() => freshNewsBuildJobs.delete(targetDate));
  freshNewsBuildJobs.set(targetDate, job);
  return job;
}

async function getFreshNewsDayEntry(targetDate, requestedUniverse = [], opts = {}) {
  loadFreshNewsIndex();
  const cached = !opts.force ? readFreshNewsDayEntry(targetDate) : null;
  if (cached) return { ...cached, fromCache:true };
  const entry = await buildFreshNewsDayEntry(targetDate, requestedUniverse);
  writeFreshNewsDayEntry(entry);
  console.log(`[fresh-news-cache] Saved ${entry.count} items for ${targetDate}`);
  return { ...entry, fromCache:false };
}

async function fetchFreshStockNews(symbols, opts = {}) {
  const targetDate = opts.date || freshNewsDateKey();
  const maxSymbols = Math.max(1, Math.min(Number(opts.maxSymbols) || 220, 300));
  const limit = Math.max(1, Math.min(Number(opts.limit) || 25, 100));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const universe = normalizeFreshNewsUniverse(symbols, maxSymbols);
  const dayEntry = await getFreshNewsDayEntry(targetDate, universe, { force:!!opts.force });
  const symbolMap = new Map(universe.map(row => [row.symbol, row]));
  const requestedSymbols = new Set(universe.map(row => row.symbol));
  const items = [];
  for (const item of (Array.isArray(dayEntry.items) ? dayEntry.items : [])) {
    const sym = String(item.symbol || '').toUpperCase();
    if (requestedSymbols.size && !requestedSymbols.has(sym)) continue;
    const row = symbolMap.get(sym) || {};
    items.push({
      symbol:sym,
      name:row.name || item.name || sym,
      assetType:row.assetType || item.assetType || 'stock',
      type:item.type || classifyNewsItem(item.title || ''),
      title:item.title || item.type || 'News',
      source:item.source || 'NSE',
      url:item.url || '',
      publishedAt:item.publishedAt || item.filingDate || item.exDate || item.eventDate || null,
      dateKey:item.dateKey || targetDate,
      resultVerdict:item.resultVerdict || null,
      resultVerdictReason:item.resultVerdictReason || null,
      newsSentiment:item.newsSentiment || classifyNewsTradeImpact(item).newsSentiment,
      tradeImpactScore:item.tradeImpactScore ?? classifyNewsTradeImpact(item).tradeImpactScore,
      tradeImpactAbs:item.tradeImpactAbs ?? classifyNewsTradeImpact(item).tradeImpactAbs,
      tradeImpactReason:item.tradeImpactReason || classifyNewsTradeImpact(item).tradeImpactReason,
    });
  }
  const deduped = dedupeFreshNewsItems(items);
  const symbolsWithNews = new Set(deduped.map(item => item.symbol));
  const impactBySymbol = {};
  for (const item of deduped) {
    const sym = String(item.symbol || '').toUpperCase();
    if (!sym) continue;
    const current = impactBySymbol[sym];
    const impactAbs = Number(item.tradeImpactAbs || Math.abs(Number(item.tradeImpactScore || 0)));
    const currentAbs = Number(current?.tradeImpactAbs || Math.abs(Number(current?.tradeImpactScore || 0)));
    if (!current || impactAbs > currentAbs) {
      impactBySymbol[sym] = {
        symbol:sym,
        type:item.type || 'News',
        title:item.title || 'News',
        newsSentiment:item.newsSentiment || 'Neutral',
        tradeImpactScore:Number(item.tradeImpactScore || 0),
        tradeImpactAbs:impactAbs,
        tradeImpactReason:item.tradeImpactReason || '',
        publishedAt:item.publishedAt || item.dateKey || null,
      };
    }
  }
  return {
    ok:true,
    date:targetDate,
    scanned:universe.length,
    marketCount:dayEntry.count || 0,
    marketSymbolCount:dayEntry.symbolCount || 0,
    count:deduped.length,
    symbolCount:symbolsWithNews.size,
    symbols:Array.from(symbolsWithNews),
    impactBySymbol,
    limit,
    offset,
    returned:deduped.slice(offset, offset + limit).length,
    hasPrev:offset > 0,
    hasNext:offset + limit < deduped.length,
    items:deduped.slice(offset, offset + limit),
    errors:Array.isArray(dayEntry.errors) ? dayEntry.errors.slice(0, 10) : [],
    fromCache:!!dayEntry.fromCache,
    cachedAt:dayEntry.savedAt || null,
    source:dayEntry.source || 'nse-market-wide',
  };
}

// ══════════════════════════════════════════════════════════
//  NSE SESSION
// ══════════════════════════════════════════════════════════
function freshNewsCronDelayMs(now = new Date()) {
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + offsetMs);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  for (let add = 0; add < 8; add++) {
    for (const slot of FRESH_NEWS_CRON_TIMES_IST) {
      const [hh, mm] = slot.split(':').map(Number);
      const candidateIstMs = Date.UTC(y, m, d + add, hh, mm, 0, 0);
      const candidateIst = new Date(candidateIstMs);
      const day = candidateIst.getUTCDay();
      if (day === 0 || day === 6) continue;
      const candidateUtcMs = candidateIstMs - offsetMs;
      if (candidateUtcMs > now.getTime() + 5000) return candidateUtcMs - now.getTime();
    }
  }
  return 6 * 60 * 60 * 1000;
}

async function refreshFreshNewsCache(reason = 'manual') {
  const targetDate = freshNewsDateKey();
  const universe = freshNewsBuildUniverse([]);
  console.log(`[fresh-news-cron] Refreshing ${targetDate} (${reason}) for ${universe.length} symbols`);
  const entry = await getFreshNewsDayEntry(targetDate, universe, { force:true });
  console.log(`[fresh-news-cron] Done ${targetDate}: ${entry.count} items, ${entry.symbolCount} symbols, cache=${entry.fromCache}`);
  return entry;
}

function scheduleNextFreshNewsRefresh() {
  if (freshNewsCronTimer) clearTimeout(freshNewsCronTimer);
  const delay = freshNewsCronDelayMs();
  freshNewsCronTimer = setTimeout(async () => {
    try {
      await refreshFreshNewsCache('scheduled');
    } catch(e) {
      console.warn('[fresh-news-cron] Refresh failed:', e.message);
    } finally {
      scheduleNextFreshNewsRefresh();
    }
  }, delay);
  if (freshNewsCronTimer.unref) freshNewsCronTimer.unref();
  console.log(`[fresh-news-cron] Next refresh in ${Math.round(delay / 60000)}m`);
}

function startFreshNewsCron() {
  scheduleNextFreshNewsRefresh();
  const targetDate = freshNewsDateKey();
  loadFreshNewsIndex();
  if (!readFreshNewsDayEntry(targetDate)) {
    const startupTimer = setTimeout(() => {
      refreshFreshNewsCache('startup-missing-cache').catch(e => console.warn('[fresh-news-cron] Startup refresh failed:', e.message));
    }, 5000);
    if (startupTimer.unref) startupTimer.unref();
  }
}

const nse = { cookies: '', lastRefresh: 0, refreshing: false, warmPromise: null, TTL: 5 * 60 * 1000 };

const NSE_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer'        : 'https://www.nseindia.com/',
  'Sec-Fetch-Dest' : 'empty',
  'Sec-Fetch-Mode' : 'cors',
  'Sec-Fetch-Site' : 'same-origin',
  'Connection'     : 'keep-alive',
};

function harvestCookies(store, res) {
  const raw = res.headers['set-cookie'];
  if (!raw || !raw.length) return store;
  const map = Object.fromEntries(
    store.split('; ').filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i > -1 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
    })
  );
  for (const c of raw) {
    const pair = c.split(';')[0];
    const i    = pair.indexOf('=');
    if (i > -1) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function nseGet(path) {
  const res = await httpsGet({
    hostname: 'www.nseindia.com', path, method: 'GET', timeout: 15000,
    headers : { ...NSE_HEADERS, ...(nse.cookies ? { Cookie: nse.cookies } : {}) },
  });
  nse.cookies = harvestCookies(nse.cookies, res);
  return res;
}

function isNSETransientError(e) {
  const msg = String(e?.message || '');
  return e?.code === 'ECONNRESET'
    || e?.code === 'ETIMEDOUT'
    || e?.code === 'ECONNREFUSED'
    || /read ECONNRESET|socket hang up|timed out|ECONNRESET/i.test(msg);
}

async function warmNSESession() {
  if (nse.warmPromise) return nse.warmPromise;
  nse.refreshing = true;
  nse.warmPromise = (async () => {
    const warmPaths = ['/', '/market-data/live-equity-market-data', '/market-data/exchange-traded-funds-etf'];
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[NSE] Warming session${attempt > 1 ? ` (retry ${attempt}/3)` : ''}...`);
      if (attempt > 1) nse.cookies = '';
      for (const warmPath of warmPaths) {
        try {
          const r = await nseGet(warmPath);
          if (r.status >= 200 && r.status < 400 && nse.cookies) {
            nse.lastRefresh = Date.now();
            console.log('[NSE] Session ready (' + nse.cookies.length + ' chars)');
            return true;
          }
          lastErr = new Error(`warm ${warmPath} HTTP ${r.status}`);
        } catch(e) {
          lastErr = e;
          const msg = e?.message || String(e);
          if (isNSETransientError(e)) {
            console.log(`[NSE] Warm path ${warmPath} reset by NSE, trying next path...`);
          } else {
            console.warn(`[NSE] Warm path ${warmPath} failed: ${msg}`);
          }
        }
        await new Promise(r => setTimeout(r, 250));
      }
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
    console.warn('[NSE] Warm failed:', lastErr?.message || 'unknown error');
    return false;
  })().finally(() => {
    nse.refreshing = false;
    nse.warmPromise = null;
  });
  return nse.warmPromise;
}

const NSE_ALLOWED = new Set(['/api/allIndices', '/api/marketStatus']);
const NSE_PREFIXES = ['/api/equity-stockIndices', '/api/quote-equity', '/api/chart-databyindex'];
const isNSEAllowed = p => NSE_ALLOWED.has(p) || NSE_PREFIXES.some(pre => p.startsWith(pre));

// ══════════════════════════════════════════════════════════
//  YAHOO FINANCE  —  crumb-free via v8/finance/chart
// ══════════════════════════════════════════════════════════
// Yahoo locked down v7/quote behind a consent-cookie crumb in 2024.
// v8/finance/chart is the replacement: it needs NO crumb, NO session,
// and returns price + 52-week range + volume for any symbol.
// We fetch symbols in parallel (Promise.allSettled) for speed.
// ──────────────────────────────────────────────────────────

const YAHOO_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Referer'        : 'https://finance.yahoo.com/',
};

// Fetch a single symbol via v8/finance/chart (1-day range, 1-day interval).
// Returns the parsed JSON or null on error.
async function yahooChart(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}` +
               `?interval=1d&range=1d&includePrePost=false`;
  try {
    const res = await httpsGet({
      hostname: 'query1.finance.yahoo.com',
      path, method: 'GET', timeout: 10000,
      headers: YAHOO_HEADERS,
    });
    if (res.status !== 200) {
      // Fallback to query2 on any non-200
      const res2 = await httpsGet({
        hostname: 'query2.finance.yahoo.com',
        path, method: 'GET', timeout: 10000,
        headers: YAHOO_HEADERS,
      });
      if (res2.status !== 200) return null;
      return JSON.parse(res2.body);
    }
    return JSON.parse(res.body);
  } catch(e) {
    return null;
  }
}

// Extract a clean quote object from a v8/chart response
function chartToQuote(sym, data) {
  try {
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta || {};
    const prev   = meta.chartPreviousClose || meta.previousClose || 0;
    const price  = meta.regularMarketPrice || 0;
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol     : sym,
      price      : price,
      change     : parseFloat(change.toFixed(2)),
      high52     : meta.fiftyTwoWeekHigh  || 0,
      low52      : meta.fiftyTwoWeekLow   || 0,
      volume     : meta.regularMarketVolume || 0,
      open       : meta.regularMarketDayHigh ? (result.indicators?.quote?.[0]?.open?.[0] || 0) : 0,
      prevClose  : prev,
      marketState: meta.marketState || 'CLOSED',
    };
  } catch(e) {
    return null;
  }
}

// Fetch a batch of NSE symbols concurrently (max CONCURRENCY at a time)
const CONCURRENCY = 8;
async function yahooQuote(nseSymbols) {
  const results = {};
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => yahooChart(sym + '.NS').then(data => ({ sym, data })))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) {
        const q = chartToQuote(r.value.sym, r.value.data);
        if (q) results[r.value.sym] = q;
      }
    }
  }
  // Return in the shape the dashboard expects: { SYMBOL: { price, change, ... } }
  return { ok: true, quotes: results };
}

// ══════════════════════════════════════════════════════════
//  COMPUTED RETURNS  — derive 1M / YTD / 1Y / 3Y / 5Y from chart history
// ══════════════════════════════════════════════════════════
async function computeReturns(sym) {
  // Single fetch: 5Y daily chart gives a real trailing 1M base and covers all periods.
  try {
    const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=5y&includePrePost=false`;
    let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS });
    if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS });
    if (r.status !== 200) return {};
    const result = JSON.parse(r.body)?.chart?.result?.[0];
    if (!result) return {};
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    if (!timestamps.length || !closes.length) return {};

    const msNow = Date.now();

    const findIdx = (targetMs) => {
      const targetSec = targetMs / 1000;
      let best = -1, bestDiff = Infinity;
      for (let i = 0; i < timestamps.length; i++) {
        const diff = Math.abs(timestamps[i] - targetSec);
        if (diff < bestDiff && closes[i] != null) { bestDiff = diff; best = i; }
      }
      return best;
    };

    const lastIdx = closes.reduce((bi, v, i) => v != null ? i : bi, -1);
    if (lastIdx < 0) return {};
    const currentPrice = closes[lastIdx]; // current/partial month — updates intraday

    const oneMonthStart = msNow - 30 * 24 * 3600 * 1000;
    const oneMonthIdx = findIdx(oneMonthStart);
    const oneMonthReturn = (oneMonthIdx >= 0 && closes[oneMonthIdx] > 0)
      ? +((currentPrice - closes[oneMonthIdx]) / closes[oneMonthIdx]).toFixed(4)
      : null;
    console.log(`[computeReturns] ${sym} 1M: current=${currentPrice} base=${closes[oneMonthIdx]} return=${oneMonthReturn}`);

    const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const y1Start  = msNow - 365     * 24 * 3600 * 1000;
    const y3Start  = msNow - 3 * 365 * 24 * 3600 * 1000;
    const y5Start  = msNow - 5 * 365 * 24 * 3600 * 1000;

    const ret = (startMs, years) => {
      const idx = findIdx(startMs);
      if (idx < 0 || closes[idx] == null || closes[idx] === 0) return null;
      const raw = (currentPrice - closes[idx]) / closes[idx];
      if (years <= 1) return +raw.toFixed(4);
      return +(Math.pow(1 + raw, 1 / years) - 1).toFixed(4);
    };

    return {
      oneMonthReturn,
      ytdReturn      : ret(ytdStart, (msNow - ytdStart) / (365 * 24 * 3600 * 1000)),
      oneYearReturn  : ret(y1Start,  1),
      threeYearReturn: ret(y3Start,  3),
      fiveYearReturn : ret(y5Start,  5),
    };
  } catch(e) {
    console.warn(`[computeReturns] ${sym}:`, e.message);
    return {};
  }
}

// ══════════════════════════════════════════════════════════
//  SPARKLINES  — 1-month daily closes, normalised to % change
// ══════════════════════════════════════════════════════════
function normaliseReturnValue(v) {
  const raw = v?.raw ?? v;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const n = Number(raw);
  return Math.abs(n) > 1 ? +(n / 100).toFixed(4) : +n.toFixed(4);
}

function parseDirectReturns(performance) {
  const trailing = performance?.trailingReturns || {};
  return {
    oneMonthReturn  : normaliseReturnValue(trailing.oneMonth ?? trailing.oneMonthReturn ?? trailing.month1),
    ytdReturn       : normaliseReturnValue(trailing.ytd),
    oneYearReturn   : normaliseReturnValue(trailing.oneYear ?? trailing.oneYearReturn ?? trailing.year1),
    threeYearReturn : normaliseReturnValue(trailing.threeYear ?? trailing.threeYearReturn ?? trailing.year3),
    fiveYearReturn  : normaliseReturnValue(trailing.fiveYear ?? trailing.fiveYearReturn ?? trailing.year5),
  };
}

const sparkCache = {};                              // in-memory only, no disk persistence
const SPARK_TTL  = 2 * 60 * 60 * 1000;             // 2 hours

async function fetchSparkline(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1mo&includePrePost=false`;
  let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (r.status !== 200) return null;
  const result = JSON.parse(r.body)?.chart?.result?.[0];
  if (!result) return null;
  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter(v => v != null);
  if (valid.length < 2) return null;
  // Downsample to ≤15 points, normalise to % change from first
  const step = Math.max(1, Math.floor(valid.length / 15));
  const sampled = [];
  for (let i = 0; i < valid.length; i += step) sampled.push(valid[i]);
  if (sampled[sampled.length - 1] !== valid[valid.length - 1]) sampled.push(valid[valid.length - 1]);
  const base = sampled[0];
  return sampled.map(v => +((v - base) / base * 100).toFixed(2));
}

// ══════════════════════════════════════════════════════════
//  STATIC AMC LOOKUP  — fund house name by symbol pattern
//  Yahoo fundProfile.family is often null for Indian ETFs
// ══════════════════════════════════════════════════════════
const intradaySignalCache = {};

function compactFinite(values) {
  return (values || []).map(Number).filter(Number.isFinite);
}

function ema(values, period) {
  const arr = compactFinite(values);
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let out = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) out = (arr[i] * k) + (out * (1 - k));
  return out;
}

function rsi(values, period = 14) {
  const arr = compactFinite(values);
  if (arr.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = arr[i] - arr[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(diff, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function atr(highs, lows, closes, period = 14) {
  const h = compactFinite(highs), l = compactFinite(lows), c = compactFinite(closes);
  const len = Math.min(h.length, l.length, c.length);
  if (len <= period) return null;
  const ranges = [];
  for (let i = 1; i < len; i++) {
    ranges.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  if (ranges.length < period) return null;
  return ranges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function computeVWAP(highs, lows, closes, volumes) {
  let pv = 0, vol = 0;
  for (let i = 0; i < closes.length; i++) {
    const h = Number(highs[i]), l = Number(lows[i]), c = Number(closes[i]), v = Number(volumes[i]);
    if (![h, l, c, v].every(Number.isFinite) || v <= 0) continue;
    pv += ((h + l + c) / 3) * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : null;
}

function computeVWAPBands(highs, lows, closes, volumes, vwap, price, multiplier = 1.5) {
  if (!Number.isFinite(vwap) || !closes.length) return null;
  let weightedVariance = 0, totalWeight = 0;
  let plainVariance = 0, plainCount = 0;
  for (let i = 0; i < closes.length; i++) {
    const h = Number(highs[i]), l = Number(lows[i]), c = Number(closes[i]), v = Number(volumes[i]);
    if (![h, l, c].every(Number.isFinite)) continue;
    const typical = (h + l + c) / 3;
    const diffSq = Math.pow(typical - vwap, 2);
    if (Number.isFinite(v) && v > 0) {
      weightedVariance += diffSq * v;
      totalWeight += v;
    }
    plainVariance += diffSq;
    plainCount++;
  }
  const variance = totalWeight > 0
    ? weightedVariance / totalWeight
    : (plainCount ? plainVariance / plainCount : null);
  if (!Number.isFinite(variance)) return null;
  const stdev = Math.sqrt(Math.max(variance, 0));
  const upper = vwap + (stdev * multiplier);
  const lower = vwap - (stdev * multiplier);
  let position = 'inside';
  if (Number.isFinite(price)) {
    if (price > upper) position = 'above-upper';
    else if (price < lower) position = 'below-lower';
    else if (price >= vwap) position = 'upper-half';
    else position = 'lower-half';
  }
  return {
    upper,
    lower,
    stdev,
    position,
    widthPct: vwap ? ((upper - lower) / vwap) * 100 : null,
  };
}

function superTrend(highs, lows, closes, period = 10, multiplier = 3) {
  const h = compactFinite(highs), l = compactFinite(lows), c = compactFinite(closes);
  const len = Math.min(h.length, l.length, c.length);
  if (len <= period + 1) return null;
  const trueRanges = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) trueRanges.push(h[i] - l[i]);
    else trueRanges.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const atrSeries = Array(len).fill(null);
  let seed = trueRanges.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  atrSeries[period] = seed;
  for (let i = period + 1; i < len; i++) {
    seed = ((seed * (period - 1)) + trueRanges[i]) / period;
    atrSeries[i] = seed;
  }
  let finalUpper = null, finalLower = null, trend = null, value = null;
  for (let i = period; i < len; i++) {
    const atrVal = atrSeries[i];
    if (!Number.isFinite(atrVal)) continue;
    const hl2 = (h[i] + l[i]) / 2;
    const basicUpper = hl2 + (multiplier * atrVal);
    const basicLower = hl2 - (multiplier * atrVal);
    if (finalUpper == null || basicUpper < finalUpper || c[i - 1] > finalUpper) finalUpper = basicUpper;
    if (finalLower == null || basicLower > finalLower || c[i - 1] < finalLower) finalLower = basicLower;
    if (trend == null) trend = c[i] >= hl2 ? 'bullish' : 'bearish';
    else if (trend === 'bearish' && c[i] > finalUpper) trend = 'bullish';
    else if (trend === 'bullish' && c[i] < finalLower) trend = 'bearish';
    value = trend === 'bullish' ? finalLower : finalUpper;
  }
  if (!trend || !Number.isFinite(value)) return null;
  return { direction: trend, value, upper: finalUpper, lower: finalLower };
}

function buildDailyTradeContext(result) {
  const quote = result?.indicators?.quote?.[0] || {};
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const rows = [];
  for (let i = 0; i < closes.length; i++) {
    const high = Number(highs[i]), low = Number(lows[i]), close = Number(closes[i]), volume = Number(volumes[i]);
    if ([high, low, close].every(Number.isFinite)) rows.push({ high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  if (!rows.length) return {};
  const prev = rows.length >= 2 ? rows[rows.length - 2] : rows[0];
  const pivot = (prev.high + prev.low + prev.close) / 3;
  const r1 = (2 * pivot) - prev.low;
  const s1 = (2 * pivot) - prev.high;
  const avgVolRows = rows.slice(0, -1).filter(r => r.volume > 0).slice(-20);
  const avgVolume20 = avgVolRows.length ? avgVolRows.reduce((a, r) => a + r.volume, 0) / avgVolRows.length : null;
  const recent5 = rows.slice(-6, -1);
  const recent20 = rows.slice(-21, -1);
  const rangeHigh = arr => arr.length ? Math.max(...arr.map(r => r.high)) : null;
  const rangeLow = arr => arr.length ? Math.min(...arr.map(r => r.low)) : null;
  const high5 = rangeHigh(recent5);
  const low5 = rangeLow(recent5);
  const high20 = rangeHigh(recent20);
  const low20 = rangeLow(recent20);
  return {
    prevDayHigh: +prev.high.toFixed(2),
    prevDayLow: +prev.low.toFixed(2),
    prevDayClose: +prev.close.toFixed(2),
    pivot: +pivot.toFixed(2),
    r1: +r1.toFixed(2),
    s1: +s1.toFixed(2),
    high5: high5 == null ? null : +high5.toFixed(2),
    low5: low5 == null ? null : +low5.toFixed(2),
    high20: high20 == null ? null : +high20.toFixed(2),
    low20: low20 == null ? null : +low20.toFixed(2),
    avgVolume20: avgVolume20 == null ? null : Math.round(avgVolume20),
  };
}

const MIN_INTRADAY_REWARD_PCT = 1.2; // Allows room for 1% net target after brokerage/slippage.
const MAX_INTRADAY_REWARD_PCT = 1.8;
const MIN_INTRADAY_STOP_PCT = 0.4;
const MAX_INTRADAY_STOP_PCT = 0.75;
const MAX_INTRADAY_TRIGGER_DISTANCE_PCT = 1.2;

function nearestIntradayTrigger(price, levels, side = 'buy') {
  const px = Number(price);
  if (!Number.isFinite(px) || px <= 0) return null;
  const clean = (levels || [])
    .map(Number)
    .filter(level => Number.isFinite(level) && level > 0)
    .map(level => ({
      level,
      distancePct: Math.abs(level - px) / px * 100,
      triggered: side === 'sell' ? px <= level : px >= level,
    }))
    .filter(item => item.distancePct <= MAX_INTRADAY_TRIGGER_DISTANCE_PCT);
  if (!clean.length) return null;
  return clean.sort((a, b) => {
    if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
    return a.distancePct - b.distancePct;
  })[0].level;
}

function expectedIntradayVolumeFraction(isoTime) {
  const d = isoTime ? new Date(new Date(isoTime).getTime() + 5.5 * 3600 * 1000) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const elapsed = Math.max(0, Math.min(375, mins - (9 * 60 + 15)));
  const anchors = [
    [0, 0.01], [15, 0.12], [30, 0.20], [60, 0.32],
    [120, 0.48], [210, 0.62], [300, 0.78], [375, 1.00],
  ];
  for (let i = 1; i < anchors.length; i++) {
    const [m0, f0] = anchors[i - 1], [m1, f1] = anchors[i];
    if (elapsed <= m1) return f0 + ((f1 - f0) * (elapsed - m0)) / (m1 - m0);
  }
  return 1;
}

function computeVolumeShockMetrics(rawHighs, rawLows, rawCloses, rawVolumes, timestamps, lastBarIdx, vwap, prevClose) {
  if (!Number.isFinite(lastBarIdx) || lastBarIdx < 5) return null;
  const bars = [];
  const from = Math.max(0, lastBarIdx - 60);
  for (let i = from; i <= lastBarIdx; i++) {
    const close = Number(rawCloses[i]);
    const high = Number(rawHighs[i]);
    const low = Number(rawLows[i]);
    if (![close, high, low].every(Number.isFinite)) continue;
    bars.push({
      time: Number.isFinite(Number(timestamps?.[i])) ? new Date(Number(timestamps[i]) * 1000).toISOString() : null,
      close,
      high,
      low,
      volume: Number.isFinite(Number(rawVolumes[i])) ? Number(rawVolumes[i]) : 0,
    });
  }
  if (bars.length < 8) return null;
  const last = bars[bars.length - 1];
  const at = n => bars[Math.max(0, bars.length - 1 - n)];
  const pctFrom = n => {
    const base = at(n)?.close;
    return Number.isFinite(base) && base > 0 ? ((last.close - base) / base) * 100 : null;
  };
  const sumVol = arr => arr.reduce((sum, item) => sum + (Number(item.volume) || 0), 0);
  const last3 = bars.slice(-3);
  const prev9 = bars.slice(Math.max(0, bars.length - 12), Math.max(0, bars.length - 3));
  const last5 = bars.slice(-5);
  const prev20 = bars.slice(Math.max(0, bars.length - 25), Math.max(0, bars.length - 5));
  const volume3 = sumVol(last3);
  const volume5 = sumVol(last5);
  const avgPrev3 = prev9.length ? sumVol(prev9) / Math.max(1, prev9.length / 3) : null;
  const avgPrev5 = prev20.length ? sumVol(prev20) / Math.max(1, prev20.length / 5) : null;
  const recentHigh = bars.slice(0, -1).slice(-20).reduce((max, b) => Math.max(max, b.high), -Infinity);
  const breakout = Number.isFinite(recentHigh) && last.close > recentHigh;
  const change3m = pctFrom(3);
  const change5m = pctFrom(5);
  const volumeRatio3m = Number.isFinite(avgPrev3) && avgPrev3 > 0 ? volume3 / avgPrev3 : null;
  const volumeRatio5m = Number.isFinite(avgPrev5) && avgPrev5 > 0 ? volume5 / avgPrev5 : null;
  const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0 ? ((last.close - vwap) / vwap) * 100 : null;
  const dayChangePct = Number.isFinite(prevClose) && prevClose > 0 ? ((last.close - prevClose) / prevClose) * 100 : null;
  const isShock =
    breakout &&
    ((Number.isFinite(change3m) && change3m >= 1.4 && Number.isFinite(volumeRatio3m) && volumeRatio3m >= 5) ||
     (Number.isFinite(change5m) && change5m >= 2.0 && Number.isFinite(volumeRatio5m) && volumeRatio5m >= 5)) &&
    (!Number.isFinite(vwapExtensionPct) || vwapExtensionPct <= 3.2);
  return {
    isShock,
    change3m: Number.isFinite(change3m) ? +change3m.toFixed(2) : null,
    change5m: Number.isFinite(change5m) ? +change5m.toFixed(2) : null,
    volume3m: Math.round(volume3),
    volume5m: Math.round(volume5),
    volumeRatio3m: Number.isFinite(volumeRatio3m) ? +volumeRatio3m.toFixed(2) : null,
    volumeRatio5m: Number.isFinite(volumeRatio5m) ? +volumeRatio5m.toFixed(2) : null,
    recentHigh: Number.isFinite(recentHigh) ? +recentHigh.toFixed(2) : null,
    breakout,
    vwapExtensionPct: Number.isFinite(vwapExtensionPct) ? +vwapExtensionPct.toFixed(2) : null,
    dayChangePct: Number.isFinite(dayChangePct) ? +dayChangePct.toFixed(2) : null,
    detectedAt: last.time,
  };
}

function buildIntradaySignal(sym, result, dailyContext = {}) {
  const quote = result?.indicators?.quote?.[0] || {};
  const meta = result?.meta || {};
  const rawOpens = quote.open || [];
  const rawHighs = quote.high || [];
  const rawLows = quote.low || [];
  const rawCloses = quote.close || [];
  const rawVolumes = quote.volume || [];
  const timestamps = result?.timestamp || [];
  const closes = compactFinite(quote.close);
  const highs = compactFinite(quote.high);
  const lows = compactFinite(quote.low);
  const volumes = compactFinite(quote.volume);
  if (closes.length < 6) return null;

  const price = Number(meta.regularMarketPrice) || closes[closes.length - 1];
  const prevClose = Number(meta.previousClose) || closes[0];
  const openPrice = Number(meta.regularMarketOpen) || closes[0];
  const lastClose = closes[closes.length - 1];
  const prevBarClose = closes.length > 1 ? closes[closes.length - 2] : lastClose;
  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const vwap = computeVWAP(highs, lows, closes, volumes);
  const atr14 = atr(highs, lows, closes, 14) || (price * 0.006);
  const vwapBands = computeVWAPBands(highs, lows, closes, volumes, vwap, price, 1.5);
  const st = superTrend(highs, lows, closes, 10, 3);
  const openingHigh = highs.slice(0, 3).length ? Math.max(...highs.slice(0, 3)) : null;
  const openingLow = lows.slice(0, 3).length ? Math.min(...lows.slice(0, 3)) : null;
  const recentSwingHigh = highs.slice(-6, -1).length ? Math.max(...highs.slice(-6, -1)) : null;
  const recentSwingLow = lows.slice(-6, -1).length ? Math.min(...lows.slice(-6, -1)) : null;
  const recentLow10 = lows.slice(-11, -1).length ? Math.min(...lows.slice(-11, -1)) : null;
  const prevBarLow = lows.length > 1 ? lows[lows.length - 2] : null;
  const recentVol = volumes.slice(-10, -1).filter(v => v > 0);
  const avgRecentVol = recentVol.length ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : 0;
  const lastVolume = volumes[volumes.length - 1] || 0;
  const volumeSpike = avgRecentVol > 0 && lastVolume > avgRecentVol * 1.5;
  const dayVolume = volumes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const relVolume = dailyContext.avgVolume20 ? dayVolume / dailyContext.avgVolume20 : null;
  let lastBarIdx = -1;
  for (let i = rawCloses.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(rawCloses[i]))) { lastBarIdx = i; break; }
  }
  const volumeShock = computeVolumeShockMetrics(rawHighs, rawLows, rawCloses, rawVolumes, timestamps, lastBarIdx, vwap, prevClose);
  const round2 = v => Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null;
  const latestBar = lastBarIdx >= 0 ? {
    time: Number.isFinite(Number(timestamps[lastBarIdx])) ? new Date(Number(timestamps[lastBarIdx]) * 1000).toISOString() : null,
    open: round2(rawOpens[lastBarIdx]),
    high: round2(rawHighs[lastBarIdx]),
    low: round2(rawLows[lastBarIdx]),
    close: round2(rawCloses[lastBarIdx]),
    volume: Number.isFinite(Number(rawVolumes[lastBarIdx])) ? Number(rawVolumes[lastBarIdx]) : null,
  } : null;
  const ohlc = {
    latestBar,
    session: {
      open: round2(openPrice),
      high: highs.length ? round2(Math.max(...highs)) : null,
      low: lows.length ? round2(Math.min(...lows)) : null,
      close: round2(price),
      volume: dayVolume || null,
    },
    previousClose: round2(prevClose),
  };
  const expectedVolumeFraction = expectedIntradayVolumeFraction(latestBar?.time);
  const relVolumeTimeAdjusted = dailyContext.avgVolume20 && expectedVolumeFraction
    ? dayVolume / Math.max(1, dailyContext.avgVolume20 * expectedVolumeFraction)
    : null;
  const gapPct = prevClose ? +(((openPrice - prevClose) / prevClose) * 100).toFixed(2) : null;
  let gapQuality = 'flat';
  if (gapPct != null && Math.abs(gapPct) >= 0.35) {
    if (gapPct > 0) gapQuality = price >= openPrice ? 'gap-up holding' : 'gap-up fading';
    else gapQuality = price <= openPrice ? 'gap-down weak' : 'gap-down recovering';
  }

  let score = 0;
  const reasons = [];
  if (vwap != null) {
    if (price > vwap) { score += 16; reasons.push('Above VWAP'); }
    else { score -= 16; reasons.push('Below VWAP'); }
  }
  if (ema9 != null && ema20 != null) {
    if (ema9 > ema20) { score += 16; reasons.push('EMA 9 above EMA 20'); }
    else { score -= 16; reasons.push('EMA 9 below EMA 20'); }
  }
  if (st?.direction === 'bullish') { score += 14; reasons.push('SuperTrend bullish'); }
  else if (st?.direction === 'bearish') { score -= 14; reasons.push('SuperTrend bearish'); }
  if (rsi14 != null) {
    if (rsi14 >= 55 && rsi14 <= 75) { score += 10; reasons.push('RSI bullish'); }
    else if (rsi14 >= 25 && rsi14 <= 45) { score -= 10; reasons.push('RSI weak'); }
    else if (rsi14 > 82) { score -= 15; reasons.push('RSI extremely stretched'); }
    else if (rsi14 > 75) { score -= 8; reasons.push('RSI stretched'); }
    else if (rsi14 < 20) { score += 5; reasons.push('RSI oversold bounce zone'); }
  }
  if (openingHigh != null && price > openingHigh) { score += 8; reasons.push('Opening range breakout'); }
  if (openingLow != null && price < openingLow) { score -= 8; reasons.push('Opening range breakdown'); }
  if (dailyContext.prevDayHigh != null && price > dailyContext.prevDayHigh) { score += 8; reasons.push('Above previous day high'); }
  if (dailyContext.prevDayLow != null && price < dailyContext.prevDayLow) { score -= 8; reasons.push('Below previous day low'); }
  if (dailyContext.high5 != null && price > dailyContext.high5) { score += 6; reasons.push('5D breakout'); }
  if (dailyContext.low5 != null && price < dailyContext.low5) { score -= 6; reasons.push('5D breakdown'); }
  if (dailyContext.high20 != null && price > dailyContext.high20) { score += 8; reasons.push('20D breakout'); }
  if (dailyContext.low20 != null && price < dailyContext.low20) { score -= 8; reasons.push('20D breakdown'); }
  if (gapQuality === 'gap-up holding') { score += 5; reasons.push('Gap-up holding'); }
  else if (gapQuality === 'gap-up fading') { score -= 5; reasons.push('Gap-up fading'); }
  else if (gapQuality === 'gap-down recovering') { score += 5; reasons.push('Gap-down recovering'); }
  else if (gapQuality === 'gap-down weak') { score -= 5; reasons.push('Gap-down weak'); }
  const volumePace = relVolumeTimeAdjusted ?? relVolume;
  if (volumePace != null && volumePace >= 1.5) {
    if (lastClose >= prevBarClose) { score += 10; reasons.push('High relative volume'); }
    else { score -= 10; reasons.push('High relative volume selloff'); }
  } else if (volumePace != null && volumePace < 0.7) {
    score += score >= 0 ? -8 : 8;
    reasons.push('Weak relative volume');
  }
  if (volumeSpike) {
    if (lastClose >= prevBarClose) { score += 10; reasons.push('Volume spike on uptick'); }
    else { score -= 10; reasons.push('Volume spike on downtick'); }
  }
  if (volumeShock?.isShock) {
    score += 26;
    reasons.push('Volume shock breakout');
  }
  if (vwapBands?.position === 'above-upper') { score -= 15; reasons.push('Above upper VWAP band'); }
  else if (vwapBands?.position === 'below-lower') { score += 15; reasons.push('Below lower VWAP band'); }
  const extensionPct = price && vwap ? (Math.abs(price - vwap) / price) * 100 : null;
  if (extensionPct != null && extensionPct > 1.2) {
    score += score >= 0 ? -20 : 20;
    reasons.push('Too far from VWAP');
  } else if (extensionPct != null && extensionPct > 0.8) {
    score += score >= 0 ? -10 : 10;
    reasons.push('Extended from VWAP');
  }

  const signal = score >= 35 ? 'buy' : score <= -35 ? 'sell' : Math.abs(score) >= 18 ? 'watch' : 'hold';
  const rawTradeRisk = Math.max(atr14 * 1.25, price * (MIN_INTRADAY_REWARD_PCT / 100));
  const tradeRisk = Math.min(rawTradeRisk, price * (MAX_INTRADAY_REWARD_PCT / 100));
  const rawStopRisk = Math.max(atr14 * 0.8, price * (MIN_INTRADAY_STOP_PCT / 100));
  const stopRisk = Math.min(rawStopRisk, price * (MAX_INTRADAY_STOP_PCT / 100));
  const bullish = score >= 0;
  const target = price + (bullish ? tradeRisk : -tradeRisk);
  const stop = price - (bullish ? stopRisk : -stopRisk);
  const reward = Math.abs(target - price);
  const risk = Math.abs(price - stop);
  let entryTrigger = 'Wait for clear VWAP/pivot confirmation';
  let invalidation = stop ? `Invalid below ${stop.toFixed(2)}` : 'Invalid on setup failure';
  let entryPrice = null;
  let entryStatus = 'Wait';
  if (signal === 'buy') {
    const trigger = Math.max(openingHigh || 0, dailyContext.prevDayHigh || 0, dailyContext.pivot || 0);
    entryPrice = trigger || price;
    entryTrigger = `Buy above ${trigger ? trigger.toFixed(2) : price.toFixed(2)} with VWAP hold`;
    invalidation = `Invalid below ${stop.toFixed(2)} or VWAP loss`;
    entryStatus = price >= entryPrice ? 'Triggered' : ((entryPrice - price) / price <= 0.005 ? 'Near trigger' : 'Wait');
  } else if (signal === 'sell') {
    const trigger = nearestIntradayTrigger(price, [
      prevBarLow,
      recentSwingLow,
      recentLow10,
      openingLow,
      vwapBands?.lower,
      dailyContext.pivot,
      dailyContext.prevDayLow,
    ], 'sell');
    entryPrice = Number.isFinite(trigger) ? trigger : null;
    entryTrigger = entryPrice == null
      ? 'Wait for nearby intraday breakdown'
      : `Sell below ${entryPrice.toFixed(2)} with VWAP rejection`;
    invalidation = `Invalid above ${stop.toFixed(2)} or VWAP reclaim`;
    entryStatus = entryPrice == null ? 'Wait' : (price <= entryPrice ? 'Triggered' : ((price - entryPrice) / price <= 0.005 ? 'Near trigger' : 'Wait'));
  } else if (signal === 'watch') {
    entryPrice = bullish
      ? Math.max(openingHigh || 0, recentSwingHigh || 0, dailyContext.prevDayHigh || 0, dailyContext.pivot || 0)
      : nearestIntradayTrigger(price, [prevBarLow, recentSwingLow, recentLow10, openingLow, vwapBands?.lower, dailyContext.pivot, dailyContext.prevDayLow], 'sell');
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) entryPrice = null;
    entryTrigger = bullish ? 'Watch for breakout with volume' : 'Watch for breakdown with volume';
    entryStatus = 'Watch';
  }
  return {
    symbol: sym,
    price: +price.toFixed(2),
    open: +openPrice.toFixed(2),
    ohlc,
    signal,
    score: Math.max(-100, Math.min(100, Math.round(score))),
    target: +target.toFixed(2),
    stop: +stop.toFixed(2),
    targetPct: +((reward / price) * 100).toFixed(2),
    stopPct: +((risk / price) * 100).toFixed(2),
    rr: risk > 0 ? +(reward / risk).toFixed(2) : null,
    vwap: vwap == null ? null : +vwap.toFixed(2),
    vwapUpper: vwapBands?.upper == null ? null : +vwapBands.upper.toFixed(2),
    vwapLower: vwapBands?.lower == null ? null : +vwapBands.lower.toFixed(2),
    vwapBandWidthPct: vwapBands?.widthPct == null ? null : +vwapBands.widthPct.toFixed(2),
    vwapBandPosition: vwapBands?.position || null,
    superTrend: st?.value == null ? null : +st.value.toFixed(2),
    superTrendDirection: st?.direction || null,
    ema9: ema9 == null ? null : +ema9.toFixed(2),
    ema20: ema20 == null ? null : +ema20.toFixed(2),
    rsi: rsi14 == null ? null : +rsi14.toFixed(1),
    atr: atr14 == null ? null : +atr14.toFixed(2),
    openingHigh: openingHigh == null ? null : +openingHigh.toFixed(2),
    openingLow: openingLow == null ? null : +openingLow.toFixed(2),
    volumeSpike,
    dayVolume,
    relVolume: relVolume == null ? null : +relVolume.toFixed(2),
    relVolumeTimeAdjusted: relVolumeTimeAdjusted == null ? null : +relVolumeTimeAdjusted.toFixed(2),
    expectedVolumeFraction: expectedVolumeFraction == null ? null : +expectedVolumeFraction.toFixed(3),
    volumeShock,
    gapPct,
    gapQuality,
    prevDayHigh: dailyContext.prevDayHigh ?? null,
    prevDayLow: dailyContext.prevDayLow ?? null,
    prevDayClose: dailyContext.prevDayClose ?? null,
    pivot: dailyContext.pivot ?? null,
    r1: dailyContext.r1 ?? null,
    s1: dailyContext.s1 ?? null,
    high5: dailyContext.high5 ?? null,
    low5: dailyContext.low5 ?? null,
    high20: dailyContext.high20 ?? null,
    low20: dailyContext.low20 ?? null,
    entryPrice: entryPrice == null ? null : +entryPrice.toFixed(2),
    entryStatus,
    entryTrigger,
    invalidation,
    dayChange: prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null,
    reasons: reasons.slice(0, 6),
    savedAt: new Date().toISOString(),
  };
}

async function fetchIntradaySignal(sym) {
  const now = Date.now();
  if (intradaySignalCache[sym] && (now - intradaySignalCache[sym].t) < INTRADAY_SIGNAL_TTL) {
    return intradaySignalCache[sym].v;
  }
  const intradayPath = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=5m&range=1d&includePrePost=false`;
  const dailyPath = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1mo&includePrePost=false`;
  let [r, daily] = await Promise.all([
    httpsGet({ hostname: 'query1.finance.yahoo.com', path: intradayPath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS }),
    httpsGet({ hostname: 'query1.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS }),
  ]);
  if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: intradayPath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (daily.status !== 200) daily = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (r.status !== 200) return null;
  const result = JSON.parse(r.body)?.chart?.result?.[0];
  const dailyResult = daily.status === 200 ? JSON.parse(daily.body)?.chart?.result?.[0] : null;
  const signal = buildIntradaySignal(sym, result, buildDailyTradeContext(dailyResult));
  if (signal) intradaySignalCache[sym] = { v: signal, t: now };
  return signal;
}

const AMC_RULES = [
  { re: /^(NIFTYBEES|BANKBEES|JUNIORBEES|LIQUIDBEES|MID150BEES|NIF100BEES|PSUBNKBEES|INFRABEES|SETF|NIF|NETF|NIFTY|.*BEES$)/, name: 'Nippon India AMC' },
  { re: /^HDFC/,      name: 'HDFC AMC' },
  { re: /^(ICICI|ICICIB|ICICINN|ICICIPSUBK|ICICIPHARM|ICICIPRB|ICICINIFTY|ICICINXT|ICICISILVER|ICICIGOLD)/, name: 'ICICI Prudential AMC' },
  { re: /^(KOTAK|KOTAKGOLD|KOTAKBANK|KOTAKIT|KOTAKSILV|KOTAKPHARMA|KOTAKNN50|KOTAKPSUBK)/, name: 'Kotak Mahindra AMC' },
  { re: /^(SBI|SBIETF|SBINIFTY|SBINMID|SBISMLETF|SBIETFIT|SBIETFCON|SBIETFPB|SBIGETS|SBIBANK|SBIBPB|SBINEQWETF|LIQUIDSBI)/, name: 'SBI Funds Management' },
  { re: /^AXIS/,      name: 'Axis AMC' },
  { re: /^(MIRAE|MAFANG|MASP)|CASE$/, name: 'Mirae Asset AMC' },
  { re: /^UTINIFTY|^UTISENSX/, name: 'UTI AMC' },
  { re: /^(ABSL|BSL|ABGSEC|GSEC10ABSL)|ADD$/, name: 'Aditya Birla Sun Life AMC' },
  { re: /^(MOSL|MO|MON|MOBANK|MOIPO|MOSMALL|MOMIDCAP|MOSERVICE|MOCAPITAL|MOMNC|MOTOUR)/, name: 'Motilal Oswal AMC' },
  { re: /^GROWW/,     name: 'Groww AMC' },
  { re: /^NIP|^NIPPON/, name: 'Nippon India AMC' },
  { re: /^LIC/,       name: 'LIC Mutual Fund' },
  { re: /^DSP/,       name: 'DSP AMC' },
  { re: /^(TATA|TAT|TNID)/, name: 'Tata AMC' },
  { re: /^PGIM/,      name: 'PGIM India AMC' },
  { re: /^FRANK|^TEMPLETON/, name: 'Franklin Templeton AMC' },
  { re: /^INVESCO|^IVZ/, name: 'Invesco AMC' },
  { re: /^MAHINDRA|^MAH/, name: 'Mahindra Manulife AMC' },
  { re: /^(EDELWEISS|ELM|EBANK|EBBETF|BBETF|E(GOLD|SILVER|NIFTY|NEXT|LIQUID|SENSEX|MULTI)|ECAP)/, name: 'Edelweiss AMC' },
  { re: /^QUANTUM|^QNIFTY|^QGOLD/, name: 'Quantum AMC' },
  { re: /^HSBC/,      name: 'HSBC AMC' },
  { re: /^CPSE|^CPSEETF/, name: 'Bharat Bond / CPSE ETF' },
  { re: /^AONE/, name: 'Angel One AMC' },
  { re: /^ITI/, name: 'ITI Mutual Fund' },
  { re: /^LIQUIDSHRI/, name: 'Shriram AMC' },
  { re: /^UNION/, name: 'Union Mutual Fund' },
  { re: /^BBNPP/, name: 'Baroda BNP Paribas Mutual Fund' },
  { re: /^IDF/, name: 'Bandhan Mutual Fund' },
  { re: /IETF$/, name: 'ICICI Prudential AMC' },
];

function lookupAMC(sym) {
  for (const rule of AMC_RULES) {
    if (rule.re.test(sym)) return rule.name;
  }
  return null;
}


const ETF_SECTOR_RULES = [
  // Broad market / index
  { sector: 'Broad Market',  syms: /NIFTYBEES|UTINIFTY|KOTAKNIFTY|HDFCNIFTY|SETFNIF50|ICICINIFTY|AXISLNIFTY|SBINIFTY|BSLNIFTY/, names: /nifty 50|nifty50|sensex|broad market/i },
  { sector: 'Next 50',       syms: /JUNIORBEES|SETFNN50|ICICINN50|KOTAKNN50|MAFANG/, names: /next 50|nifty next|junior/i },
  { sector: 'Midcap',        syms: /MIDCAPETF|MID150|MIDCAP|NIFMDCP/, names: /midcap|mid cap|mid-cap/i },
  { sector: 'Smallcap',      syms: /SMALLCAP|NIFSMCP/, names: /smallcap|small cap|small-cap/i },

  // Commodities
  { sector: 'Gold',          syms: /GOLDBEES|KOTAKGOLD|SBIGETS|HDFCGOLD|AXISGOLD|BSLGOLDETF|NIPGOLD|SETFGOLD|ICICIGOLD|LICMFGOLD|DSPGOLD|QGOLDHALF/, names: /gold/i },
  { sector: 'Silver',        syms: /SILVERBEES|SILVERETF|SETFSILVER|KOTAKSILV|ICICISILVER|SILVERCASE/, names: /silver/i },

  // Sectoral
  { sector: 'Banking',       syms: /BANKBEES|KOTAKBANK|SETFBANK|HDFCNIFBAN|ICICIB22|AXISNIFBK|SBIBANK/, names: /bank|banking/i },
  { sector: 'Private Bank',  syms: /PVTBANKETF|SETFPVTB|HDFCPVTBAN|ICICIPRB|AXISPVTBNK/, names: /private bank|pvt bank/i },
  { sector: 'IT',            syms: /ITBEES|SETFIT|KOTAKIT|HDFCIT|ICICINXT50|AXISIT/, names: /\bIT\b|information tech|nifty it/i },
  { sector: 'Pharma',        syms: /PHARMABEES|SETFPHARMA|KOTAKPHARMA|HDFCPHARMA|ICICIPHARM|AXISPHARMA/, names: /pharma|healthcare|health care/i },
  { sector: 'PSU',           syms: /CPSE|PSUBNKBEES|SETFPB|KOTAKPSUBK|HDFCPSUBK|ICICIPSUBK|AXISPSUBK/, names: /psu|public sector|cpse/i },
  { sector: 'Infrastructure',syms: /NIFTYINFRA|INFRABEES|SETFINFRA/, names: /infra/i },
  { sector: 'Consumption',   syms: /CONS|FMCG|CONSUMBEES/, names: /consum|fmcg/i },
  { sector: 'Auto',          syms: /AUTOETF|SETFAUTO/, names: /auto(?:mobile)?/i },
  { sector: 'Energy',        syms: /ENERGYBEES|SETFENERGY/, names: /energy/i },
  { sector: 'Realty',        syms: /REIETF|SETFREALTY/, names: /realt|real estate/i },
  { sector: 'Metal',         syms: /METALBEES|SETFMETAL/, names: /metal/i },
  { sector: 'Media',         syms: /MEDIABEES|SETFMEDIA/, names: /media/i },

  // Strategy / factor
  { sector: 'Dividend',      syms: /DIVOPPS|DIVIDEND|DIVBEES/, names: /dividend/i },
  { sector: 'Value',         syms: /VALUEETF|SETFVALUE/, names: /value/i },
  { sector: 'Momentum',      syms: /MOMENTUMETF|SETFMOM/, names: /momentum/i },
  { sector: 'Quality',       syms: /QUALITYETF|SETFQUAL/, names: /quality/i },
  { sector: 'Low Volatility',syms: /LOWVOLETF|SETFLV/, names: /low vol/i },
  { sector: 'Alpha',         syms: /ALPHAETF|SETFALPHA/, names: /alpha/i },

  // International
  { sector: 'International', syms: /NIPPOFFSH|MAFANG|FANG|NASDAQ|WORLD|HANGSENG|US|N100/, names: /nasdaq|s&p|global|world|us equity|hang seng|international|offshore|fang/i },

  // Debt / liquid
  { sector: 'Debt',          syms: /LIQUIDBEES|LIQUIDETF|GSEC|GILT|BOND|SDL|CORP/, names: /liquid|gilt|g-sec|bond|debt|sdl|corporate/i },
];

function categorizeETF(sym, name) {
  const s = sym.toUpperCase();
  const n = (name || '').toLowerCase();
  for (const rule of ETF_SECTOR_RULES) {
    if (rule.syms.test(s) || rule.names.test(n)) return rule.sector;
  }
  return 'Other';
}

// ══════════════════════════════════════════════════════════
//  STATIC TER LOOKUP  — expense ratios for Indian ETFs
//  Values sourced from AMC fact sheets / NSE disclosures (decimal fractions, e.g. 0.05% = 0.0005)
// ══════════════════════════════════════════════════════════
const STATIC_TER = {
  // ── Broad Market / Nifty 50 ──
  NIFTYBEES:0.0004, BSLNIFTY:0.0005, HDFCNIFTY:0.0005, HDFCSENSEX:0.0005,
  AXISNIFTY:0.0005, NETF:0.0004,
  SETFNIF50:0.0007, AXSENSEX:0.0005, ESENSEX:0.0007, SENSEXADD:0.0005,
  SENSEXBETA:0.0010, SENSEXETF:0.0007, SENSEXIETF:0.0013, MONIFTY500:0.0014,
  LICNETFN50:0.0005, LICNETFSEN:0.0005, GROWWNIFTY:0.0005, ENIFTY:0.0005,
  NIFTYBETF:0.0007, NIFTYCASE:0.0007, NIFTYIETF:0.0013, NIFTYETF:0.0007,
  QNIFTY:0.0005, IDFNIFTYET:0.0005, NIFTY1:0.0007, IVZINNIFTY:0.0005,
  AONENIFTY:0.0005, NIFTYADD:0.0005, NIFTYBETA:0.0010,

  // ── Nifty 100 / 200 / 500 ──
  NIF100BEES:0.0015, NIF100IETF:0.0015, MONIFTY100:0.0015, HDFCNIF100:0.0015,
  BSE500IETF:0.0015, HDFCBSE500:0.0015, GROWWN200:0.0015, ELM250:0.0015,
  MSCI360:0.0020, MSCIINDIA:0.0020, MSCIADD:0.0020, ABSLMSCIN:0.0020,

  // ── Next 50 ──
  JUNIORBEES:0.0019, SETFNN50:0.0013, ENEXT50:0.0013,
  NEXT50:0.0013, NEXT50ADD:0.0013, NEXT50BETA:0.0013, NEXT50ETF:0.0013,
  NEXT50IETF:0.0013, MONEXT50:0.0013, ABSLNN50ET:0.0013, GROWWNXT50:0.0013,
  SNXT50BETA:0.0013, HDFCNEXT50:0.0013, SNXT30BEES:0.0013,

  // ── Midcap ──
  MID150BEES:0.0015, HDFCMID150:0.0020, MID150:0.0020, MID150CASE:0.0020,
  MIDCAP:0.0020, MIDCAPADD:0.0020, MIDCAPBETA:0.0020, MIDCAPETF:0.0020,
  MIDCAPIETF:0.0020, SBINMID150:0.0020, GROWWMC150:0.0020, LICNMID100:0.0020,
  MIDSELIETF:0.0020, MIDQ50ADD:0.0020, MIDSMALL:0.0020, MOMIDMTM:0.0035,

  // ── Smallcap ──
  SMALLCAP:0.0030, SMALL250:0.0030, SMALLADD:0.0030, SML100CASE:0.0030,
  MOSMALL250:0.0030, HDFCSML250:0.0030, GROWWSC250:0.0030, SBISMLETF:0.0030,

  // ── Banking ──
  BANKBEES:0.0019, BANKBETF:0.0019, BANKETF:0.0019, BANKIETF:0.0019,
  HDFCNIFBAN:0.0020, ICICIB22:0.0014, EBANKNIFTY:0.0015, PSUBANK:0.0019,
  ABSL10BANK:0.0020, BANK10ADD:0.0019, BANKADD:0.0019, BANKBETA:0.0020,
  BANKNIFTY1:0.0020, BANKPSU:0.0019, MOBANK10:0.0020, PSUBANKADD:0.0020,
  PVTBANKADD:0.0020, SETFNIFBK:0.0015, AXISBNKETF:0.0020, BBNPNBETF:0.0020,

  // ── Private Bank ──
  HDFCPVTBAN:0.0020, SBIBPB:0.0014, SBIETFPB:0.0014, PVTBANIETF:0.0020,
  PVTBKGROWW:0.0020, HDFCPVTBAN:0.0020,

  // ── PSU / CPSE ──
  PSUBNKBEES:0.0035, CPSEETF:0.0015, HDFCPSUBK:0.0020, GROWWPSUBK:0.0020,
  PSUBNKIETF:0.0035, ABSLPSE:0.0015, MOPSE:0.0020, GROWWPSE:0.0020,

  // ── IT / Technology ──
  ITBEES:0.0035, IT:0.0035, ITADD:0.0035, ITBETA:0.0035,
  ITETF:0.0035, ITIETF:0.0035, SBIETFIT:0.0020, MAHKTECH:0.0040,
  AXISTECETF:0.0035, TECH:0.0035, INTERNET:0.0050, GROWWNET:0.0050,
  HDFCNIFIT:0.0020,

  // ── Equal Weight / NQ50 ──
  EQUAL200:0.0030, EQUAL50:0.0030, EQUAL50ADD:0.0030, MON50EQUAL:0.0030,
  SBINEQWETF:0.0030, NIFTY100EW:0.0030, MONQ50:0.0013,

  // ── NV20 / Others ──
  NV20:0.0040, NV20BEES:0.0040, NV20IETF:0.0040,
  SHARIABEES:0.0030, ESG:0.0040, BFSI:0.0035, FINIETF:0.0035,
  SELECTIPO:0.0050, MOIPO:0.0050, MNC:0.0035, MOMNC:0.0035,
  MOTOUR:0.0040, MULTICAP:0.0040, FLEXIADD:0.0040,
  MASPTOP50:0.0025, TOP100CASE:0.0015, TOP20:0.0015, TOP15IETF:0.0015,
  TOP10ADD:0.0020, NEXT30ADD:0.0020, ALPL30IETF:0.0020,
  AONETMMQ50:0.0020, AONETOTAL:0.0015, TNIDETF:0.0020,
  NPBET:0.0020, MOCAPITAL:0.0035, MOSERVICE:0.0035,
  SBIETFCON:0.0035, SBIETFPB:0.0014, BSLSENETFG:0.0005,
  EMULTIMQ:0.0020, GROWWCAPM:0.0040, MANUFGBEES:0.0035,

  // ── International ──
  MAFANG:0.0065, MON100:0.0065, HNGSNGBEES:0.0065,
  ABSLBANETF:0.0060, ABSLNN50ET:0.0013, LIQUIDPLUS:0.0005,
  MSCIINDIA:0.0020,
};

// ══════════════════════════════════════════════════════════
//  ETF DATA  — 52W range + NAV discount/premium via quoteSummary
// ══════════════════════════════════════════════════════════

// In-memory cache for NSE iNAV batch — stale-while-revalidate
// Cached data is served immediately; NSE is refreshed in the background when stale
const navMapCache = { data: {}, savedAt: 0, TTL: 15 * 60 * 1000, refreshing: false };

async function refreshNavMapFromNSE() {
  if (navMapCache.refreshing) return;
  navMapCache.refreshing = true;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const nseRes = await nseGet('/api/etf');
      const items = JSON.parse(nseRes.body)?.data || [];
      const newMap = {};
      for (const item of items) {
        const sym = (item.symbol || item.Symbol || '').trim().toUpperCase();
        if (!sym) continue;
        newMap[sym] = {
          nav     : parseExplicitINav(item),
          high52  : parseFloat(item['52WeekHigh'] || item.yearHigh || 0) || null,
          low52   : parseFloat(item['52WeekLow']  || item.yearLow  || 0) || null,
          volume  : parseVolumeField(item),
          aum     : item.aum || item.AUM || null,
          expRatio: item.expenseRatio || getETFExpenseRatio(sym),
        };
      }
      navMapCache.data    = newMap;
      navMapCache.savedAt = Date.now();
      console.log('[etf-nav] NSE ETF data refreshed, count:', Object.keys(newMap).length);
      break;
    } catch(e) {
      const retryable = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' ||
                        e.code === 'ETIMEDOUT'   || e.message.includes('timed out');
      if (retryable && attempt < MAX_RETRIES) {
        const delay = attempt * 1500;
        console.warn(`[etf-nav] NSE refresh failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message} — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.warn(`[etf-nav] NSE refresh failed after ${attempt} attempt(s): ${e.message}`);
        // Stamp savedAt so the next request doesn't immediately retry NSE again
        if (navMapCache.savedAt === 0) navMapCache.savedAt = Date.now();
      }
    }
  }
  navMapCache.refreshing = false;
}

async function fetchETFData(etfSymbols) {
  const results = {};

  // Stale-while-revalidate: always serve from cache immediately, refresh NSE in background
  let navMap = {};
  const hasData = navMapCache.savedAt > 0;
  const isStale = (Date.now() - navMapCache.savedAt) >= navMapCache.TTL;

  if (hasData) {
    // Serve cached navMap instantly (even if stale)
    navMap = navMapCache.data;
    if (isStale) {
      const ageMin = Math.round((Date.now() - navMapCache.savedAt) / 60000);
      console.log(`[etf-nav] serving stale navMap (age ${ageMin}m), triggering background NSE refresh`);
      refreshNavMapFromNSE().catch(e => console.warn('[etf-nav] background NSE refresh failed:', e.message));
    } else {
      console.log(`[etf-nav] using navMap from memory cache (age ${Math.round((Date.now()-navMapCache.savedAt)/1000)}s)`);
    }
  } else {
    // First run: no cached data yet — must block until NSE responds (or fails)
    await refreshNavMapFromNSE();
    navMap = navMapCache.data;
  }

  // Seed 52W range from etf_list_cache for any symbol navMap doesn't have it
  // (etf_list_cache is 24h; avoids Yahoo chart calls just for range data)
  const etfListData = {};
  try {
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
      for (const e of (cached.etfs || [])) etfListData[e.sym] = e;
    }
  } catch(_) {}

  // For each symbol, merge NSE nav data with Yahoo price data
  for (let i = 0; i < etfSymbols.length; i += CONCURRENCY) {
    const chunk = etfSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => (async () => {
        const nse  = navMap[sym] || {};
        const disk = etfListData[sym] || {};
        // Yahoo chart for live price only (skip if we already have 52W from NSE/disk cache)
        try {
          const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
          let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
          if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
          const meta = r.status === 200 ? JSON.parse(r.body)?.chart?.result?.[0]?.meta : null;

          // Price: live chart first; fall back to cached previousClose from etf-summary
          // (thinly-traded ETFs may have no intraday chart data)
          const price  = meta?.regularMarketPrice ?? etfSumCache[sym]?.data?.price ?? null;
          const volume = meta?.regularMarketVolume ?? nse.volume ?? disk.volume ?? null;
          // 52W: prefer NSE navMap → disk etf_list_cache → Yahoo chart
          const high52 = nse.high52 || disk.high52 || meta?.fiftyTwoWeekHigh || null;
          const low52  = nse.low52  || disk.low52  || meta?.fiftyTwoWeekLow  || null;
          // NAV: NSE iNAV → Yahoo chart navPrice → Yahoo quoteSummary navPrice → etf_list_cache disk.
          // Do not use regularMarketPrice as NAV; that makes premium/discount always 0.
          let nav = nse.nav || meta?.navPrice || null;

          if (!nav) {
            // Try quoteSummary?modules=price — returns navPrice for Indian ETFs
            try {
              await ensureCrumb();
              let qPath, qHeaders;
              if (yahooCrumb.value) {
                qPath    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=price&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                qHeaders = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
              } else {
                qPath    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=price`;
                qHeaders = YAHOO_HEADERS;
              }
              let qr = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: qPath, method: 'GET', timeout: 10000, headers: qHeaders });
              if (qr.status !== 200) qr = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: qPath, method: 'GET', timeout: 10000, headers: qHeaders });
              if (qr.status === 200) {
                const pr = JSON.parse(qr.body)?.quoteSummary?.result?.[0]?.price;
                nav = pr?.navPrice?.raw ?? null;
                if (nav) console.log(`[etf-nav] ${sym} navPrice from quoteSummary/price: ${nav}`);
              }
            } catch(qe) {
              console.warn(`[etf-nav] ${sym} quoteSummary/price fallback error: ${qe.message}`);
            }
          }

          // Final fallback: etf_list_cache disk nav (NSE iNAV from last batch fetch)
          if (!nav) nav = disk.nav || null;
          if (nav && price && disk.nav && Math.abs(nav - price) < 0.0001 && Math.abs(disk.nav - price) > 0.0001) {
            nav = disk.nav;
          }

          const navPremium = (nav && price) ? +((( price - nav) / nav) * 100).toFixed(2) : null;

          console.log(`[etf-nav] ${sym} price:${price} nav:${nav} volume:${volume ?? '–'} (nseNav:${nse.nav??'–'} yahooNav:${meta?.navPrice??'–'}) premium:${navPremium}% 52W:${low52}-${high52}`);
          return { sym, data: { price, nav, navPremium, high52, low52, volume, aum: nse.aum || null, expRatio: nse.expRatio || null } };
        } catch(e) {
          return { sym, data: { nav: nse.nav||disk.nav||null, high52: nse.high52||disk.high52||null, low52: nse.low52||disk.low52||null, volume: nse.volume||disk.volume||null, navPremium: null, aum: nse.aum||null, expRatio: nse.expRatio||null } };
        }
      })())
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results[r.value.sym] = r.value.data;
    }
  }
  return { ok: true, etfs: results };
}

// ══════════════════════════════════════════════════════════
//  YAHOO CRUMB SESSION  (needed for quoteSummary fundamentals)
// ══════════════════════════════════════════════════════════
const yahooCrumb = { value: null, cookies: '', lastFetch: 0, TTL: 30 * 60 * 1000, fetching: false };

async function refreshYahooCrumb() {
  if (yahooCrumb.fetching) return;
  yahooCrumb.fetching = true;
  try {
    console.log('[crumb] Fetching Yahoo session...');
    // Step 1: hit a quote page to get A1/A3 cookies (root '/' doesn't always yield crumb-valid cookies)
    const r0 = await httpsGet({
      hostname: 'finance.yahoo.com', path: '/quote/AAPL',
      method: 'GET', timeout: 10000,
      headers: { ...YAHOO_HEADERS, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br' }
    });
    const rawCookies = r0.headers['set-cookie'] || [];
    const cookieMap = {};
    for (const c of rawCookies) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > -1) cookieMap[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    yahooCrumb.cookies = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join('; ');
    console.log('[crumb] Got cookies, length:', yahooCrumb.cookies.length);

    // Step 2: fetch crumb
    const r1 = await httpsGet({
      hostname: 'query1.finance.yahoo.com', path: '/v1/test/getcrumb',
      method: 'GET', timeout: 10000,
      headers: { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies }
    });
    if (r1.status === 200 && r1.body && !r1.body.includes('<!DOCTYPE')) {
      yahooCrumb.value = r1.body.trim();
      yahooCrumb.lastFetch = Date.now();
      console.log('[crumb] Got crumb:', yahooCrumb.value);
    } else {
      console.warn('[crumb] Failed to get crumb, status:', r1.status, r1.body.slice(0, 100));
    }
  } catch(e) {
    console.warn('[crumb] Error:', e.message);
  } finally {
    yahooCrumb.fetching = false;
  }
}

async function ensureCrumb() {
  if (yahooCrumb.value && (Date.now() - yahooCrumb.lastFetch) < yahooCrumb.TTL) return true;
  await refreshYahooCrumb();
  return !!yahooCrumb.value;
}

// Fetch fundamentals via Yahoo quoteSummary (requires crumb session)
async function yahooSummary(nseSymbols) {
  const results = {};
  const hasCrumb = await ensureCrumb();

  const MODULES = 'financialData,defaultKeyStatistics,summaryDetail,assetProfile';

  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => (async () => {
        try {
          let path, headers;
          if (hasCrumb && yahooCrumb.value) {
            // Use quoteSummary with crumb — returns full fundamentals
            path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
            headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
          } else {
            // Fallback: v8/chart meta (limited fields only)
            path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
            headers = YAHOO_HEADERS;
          }

          let res = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
          // Retry with query2 on failure
          if (res.status !== 200) {
            res = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
          }
          // If crumb expired, refresh and retry once
          if (res.status === 401 || res.status === 403) {
            await refreshYahooCrumb();
            if (yahooCrumb.value) {
              path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
              headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
              res = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
            }
          }
          if (res.status !== 200) {
            console.warn(`[summary] ${sym} HTTP ${res.status}`);
            return { sym, data: null };
          }

          const json = JSON.parse(res.body);

          // Parse quoteSummary response
          const r = json?.quoteSummary?.result?.[0];
          if (r) {
            const fin   = r.financialData || {};
            const stats = r.defaultKeyStatistics || {};
            const detail = r.summaryDetail || {};
            const profile = r.assetProfile || {};

            const trailingEps   = fin.trailingEps?.raw ?? stats.trailingEps?.raw ?? null;
            const trailingPE    = fin.trailingPE?.raw ?? stats.trailingPE?.raw ?? detail.trailingPE?.raw ?? null;
            const forwardPE     = fin.forwardPE?.raw ?? detail.forwardPE?.raw ?? null;
            const marketCap     = detail.marketCap?.raw ?? null;
            const priceToBook   = stats.priceToBook?.raw ?? null;
            const dividendYield = detail.dividendYield?.raw ?? detail.trailingAnnualDividendYield?.raw ?? null;
            const roe           = fin.returnOnEquity?.raw ?? null;
            const totalDebt     = fin.totalDebt?.raw ?? null;
            const totalEquity   = fin.totalStockholdersEquity?.raw ?? null;
            const epsGrowth     = fin.earningsGrowth?.raw ?? null;
            const peg           = stats.pegRatio?.raw ?? null;
            const priceTarget   = fin.targetMeanPrice?.raw ?? fin.targetMedianPrice?.raw ?? null;
            const sharesOut     = stats.sharesOutstanding?.raw ?? null;
            const sector        = profile.sector ?? null;
            const industry      = profile.industry ?? null;
            const fiftyDayAvg   = detail.fiftyDayAverage?.raw ?? null;
            const twoHundredDayAvg = detail.twoHundredDayAverage?.raw ?? null;
            const high52        = detail.fiftyTwoWeekHigh?.raw ?? null;
            const low52         = detail.fiftyTwoWeekLow?.raw ?? null;
            const forwardEps    = stats.forwardEps?.raw ?? null;

            
            return { sym, data: { trailingEps, forwardEps, trailingPE, forwardPE, marketCap, priceToBook,
              dividendYield, fiftyDayAvg, twoHundredDayAvg, high52, low52, roe, totalDebt, totalEquity,
              epsGrowth, peg, priceTarget, sharesOutstanding: sharesOut, sector, industry } };
          }

          // Fallback: parse v8/chart meta
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta) {
            const trailingEps = meta.epsTrailingTwelveMonths ?? null;
            const forwardEps  = meta.epsForward ?? null;
            const trailingPE  = meta.trailingPE ?? null;
            const price       = meta.regularMarketPrice ?? null;
            const forwardPE   = (forwardEps && price) ? +(price / forwardEps).toFixed(2) : null;
            console.log(`[summary] ${sym} chart-meta fallback — PE:${trailingPE} EPS:${trailingEps}`);
            return { sym, data: { trailingEps, forwardEps, trailingPE, forwardPE,
              marketCap: meta.marketCap ?? null, priceToBook: meta.priceToBook ?? null,
              dividendYield: meta.dividendYield ?? null,
              fiftyDayAvg: meta.fiftyDayAverage ?? null, twoHundredDayAvg: meta.twoHundredDayAverage ?? null,
              high52: meta.fiftyTwoWeekHigh ?? null, low52: meta.fiftyTwoWeekLow ?? null,
              roe: null, totalDebt: null, totalEquity: null, epsGrowth: null,
              peg: null, priceTarget: null, sharesOutstanding: null, sector: null, industry: null } };
          }

          console.warn(`[summary] ${sym} no parseable data`);
          return { sym, data: null };
        } catch(e) {
          console.warn(`[summary] ${sym} error:`, e.message);
          return { sym, data: null };
        }
      })())
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) results[r.value.sym] = r.value.data;
    }
  }
  return { ok: true, metas: results };
}

// Indices via v8/chart
const INDEX_MAP = {
  '^NSEI'   : 'nifty50',
  '^NSMIDCP': 'midcap',
  '^NSEBANK': 'banknifty',
  '^CNXSC'  : 'smallcap',
};
async function yahooIndices() {
  const settled = await Promise.allSettled(
    Object.keys(INDEX_MAP).map(sym =>
      yahooChart(sym).then(data => ({ sym, data }))
    )
  );
  const out = {};
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.data) {
      const q   = chartToQuote(r.value.sym, r.value.data);
      const key = INDEX_MAP[r.value.sym];
      if (q && key) out[key] = { price: q.price, change: q.change };
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════
async function proxyRequestHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname, searchParams } = new URL(req.url, `http://localhost:${PORT}`);
  // Log incoming requests for debugging client 404s
  try { console.log('[proxy] >>', req.method, pathname, req.socket && req.socket.remoteAddress); } catch (e) {}

  // /health
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true,
      nse  : { cookies: nse.cookies.length, lastRefresh: nse.lastRefresh },
      yahoo: { mode: 'v8/chart (crumb-free)', ok: true },
      openai: { configured: !!OPENAI_API_KEY, model: OPENAI_MODEL, propertiesFile: USER_OPENAI_PROPERTIES },
      ollama: { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL || 'auto', timeoutMs: OLLAMA_TIMEOUT_MS },
    }));
    return;
  }

  // /dashboard-bootstrap -- one-shot startup payload for the Remix dashboard
  if (pathname === '/dashboard-bootstrap') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(buildDashboardBootstrap()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Bootstrap failed' }));
    }
    return;
  }

  // /dashboard-market?symbols=A,B -- compact initial market payload for Remix dashboard
  if (pathname === '/dashboard-market') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const symbols = (searchParams.get('symbols') || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 300);
      const [indices, quotes] = await Promise.all([
        yahooIndices().catch(e => ({ ok:false, error:e.message })),
        symbols.length ? yahooQuote(symbols).catch(e => ({ ok:false, error:e.message, quotes:{} })) : Promise.resolve({ ok:true, quotes:{} }),
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ok:true, savedAt:Date.now(), indices, quotes:quotes.quotes || {}, quoteError:quotes.error || null }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Market payload failed' }));
    }
    return;
  }

  // /openai/status -- frontend check for AI mode
  if (pathname === '/openai/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, configured: !!OPENAI_API_KEY, model: OPENAI_MODEL, propertiesFile: USER_OPENAI_PROPERTIES }));
    return;
  }

  // /openai -- server-side OpenAI Responses API proxy. Keeps API key out of browser storage.
  if (pathname === '/openai') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const prompt = String(payload.prompt || '').trim();
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prompt is required' }));
        return;
      }
      const data = await callOpenAIResponse(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(e.status || 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /ollama/status -- checks local Ollama and reports installed models
  if (pathname === '/ollama/status') {
    try {
      const tags = await ollamaRequest('/api/tags', 'GET', null, 5000);
      const models = Array.isArray(tags.models) ? tags.models.map(m => m.name).filter(Boolean) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, configured: models.length > 0, baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL || models[0] || 'auto', timeoutMs: OLLAMA_TIMEOUT_MS, models }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, configured: false, baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL || 'auto', timeoutMs: OLLAMA_TIMEOUT_MS, error: e.message }));
    }
    return;
  }

  // /ollama/chat -- local Ollama proxy for fundamentals chat. Keeps browser CORS simple.
  if (pathname === '/ollama/chat') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const prompt = String(payload.prompt || '').trim();
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prompt is required' }));
        return;
      }
      const data = await callOllamaChat(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(e.status || 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL || 'auto', timeoutMs: OLLAMA_TIMEOUT_MS }));
    }
    return;
  }

  // /nse?path=...
  if (pathname === '/nse') {
    const nsePath = searchParams.get('path') || '';
    if (!isNSEAllowed(nsePath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path not allowed' })); return;
    }
    if (Date.now() - nse.lastRefresh > nse.TTL) await warmNSESession();
    try {
      let r = await nseGet(nsePath);
      if (r.status === 401 || r.status === 403) { await warmNSESession(); r = await nseGet(nsePath); }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body);
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /nse/index-symbols?index=NIFTY%20MIDCAP%20150  -- symbol+name list only, cached 24h
  // Used by dashboard on startup to detect quarterly index rebalancing
  if (pathname === '/nse/index-symbols') {
    const index = searchParams.get('index') || '';
    if (!index) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No index' })); return; }
    try {
      const cacheKey = index.toUpperCase();
      const entry = nseIdxCache[cacheKey];
      if (entry && (Date.now() - entry.savedAt) < NSE_IDX_CACHE_TTL) {
        console.log(`[nse-idx-cache] serving ${entry.symbols.length} symbols for "${index}" from cache`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, index, symbols: entry.symbols, fromCache: true }));
        return;
      }
      // Fetch fresh
      const r = await nseGet(`/api/equity-stockIndices?index=${encodeURIComponent(index)}`);
      const items = JSON.parse(r.body)?.data || [];
      const symbols = items
        .map(item => ({ sym: (item.symbol||'').trim().toUpperCase(), name: item.meta?.companyName || item.symbol || '' }))
        .filter(s => s.sym);
      nseIdxCache[cacheKey] = { symbols, savedAt: Date.now() };
      saveNseIdxCache();
      console.log(`[nse-idx-cache] fetched ${symbols.length} symbols for "${index}", saved to cache`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, index, symbols }));
    } catch(e) {
      // Serve stale cache on error
      const cacheKey = index.toUpperCase();
      if (nseIdxCache[cacheKey]) {
        console.warn(`[nse-idx-cache] serving stale cache for "${index}" after error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, index, symbols: nseIdxCache[cacheKey].symbols, stale: true }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  // /etf-list  -- return full NSE ETF list (all ~300+ ETFs) with NAV, price, 52W from NSE batch
  if (pathname === '/etf-list') {
    try {
      // Serve from cache if fresh and has fundFamily (invalidate old cache that predates this field)
      if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
        const hasFundFamily = (cached.etfs || []).some(e => e.fundFamily != null);
        if (!hasFundFamily) {
          console.log('[etf-list] cache predates fundFamily — deleting for re-fetch');
          fs.unlinkSync(ETF_LIST_CACHE_FILE);
        } else if (Date.now() - (cached.savedAt || 0) < ETF_LIST_CACHE_TTL) {
          let patchedFamily = false;
          for (const etf of (cached.etfs || [])) {
            if (etf?.sym && etf.fundFamily == null) {
              const family = lookupAMC(etf.sym);
              if (family) { etf.fundFamily = family; patchedFamily = true; }
            }
            if (etf?.sym && etf.expRatio == null && getETFExpenseRatio(etf.sym) != null) {
              etf.expRatio = getETFExpenseRatio(etf.sym);
              patchedFamily = true;
            }
          }
          if (patchedFamily) {
            try {
              fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify(cached, null, 2), 'utf8');
            } catch(e) {
              console.warn('[etf-list] cache family patch save failed:', e.message);
            }
          }
          console.log(`[etf-list] serving ${cached.etfs.length} ETFs from cache (age ${Math.round((Date.now()-cached.savedAt)/60000)}m)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: cached.etfs.length, etfs: cached.etfs, fromCache: true }));
          return;
        } else {
          console.log('[etf-list] cache stale, refreshing from NSE…');
        }
      }

      // Fetch fresh from NSE — retry up to 3 times on ECONNRESET
      let raw = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const nseRes = await nseGet('/api/etf');
          raw = JSON.parse(nseRes.body)?.data || [];
          break;
        } catch(e) {
          const retryable = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT';
          if (retryable && attempt < 3) {
            console.warn(`[etf-list] NSE attempt ${attempt}/3 failed (${e.message}), retrying in ${attempt*1500}ms…`);
            await new Promise(r => setTimeout(r, attempt * 1500));
          } else { throw e; }
        }
      }
      const etfs = raw.map(item => {
        const sym     = (item.symbol || item.Symbol || '').trim().toUpperCase();
        const name    = item.companyName || item.name || item.schemeName || sym;
        const price   = parseFloat(item.lastPrice  || item.ltp || item.LTP || 0) || null;
        const nav     = parseExplicitINav(item);
        const high52  = parseFloat(item['52WeekHigh'] || item.yearHigh || 0) || null;
        const low52   = parseFloat(item['52WeekLow']  || item.yearLow  || 0) || null;
        const volume  = parseVolumeField(item);
        const aum     = item.aum || item.AUM || null;
        const expRatio= item.expenseRatio || getETFExpenseRatio(sym);
        const chg     = parseFloat(item.change || item.pChange || 0) || null;
        const chgPct  = parseFloat(item.pChange || item.perChange || 0) || null;
        const navPremium = (nav && price) ? +((( price - nav) / nav) * 100).toFixed(2) : null;
        const sector     = categorizeETF(sym, name);
        const fundFamily = lookupAMC(sym);
        return { sym, name, sector, fundFamily, price, nav, navPremium, high52, low52, volume, aum, expRatio, chg, chgPct };
      }).filter(e => e.sym);

      // Persist to cache file
      fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), etfs, meta: etfMetaCache }, null, 2), 'utf8');
      console.log(`[etf-list] fetched ${etfs.length} ETFs from NSE, saved to cache`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: etfs.length, etfs }));
    } catch(e) {
      console.warn('[etf-list] NSE fetch error:', e.message);
      // Try to serve stale cache rather than failing completely
      if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
        try {
          const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          console.warn(`[etf-list] serving stale cache (age ${Math.round((Date.now()-cached.savedAt)/60000)}m) after error`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: cached.etfs.length, etfs: cached.etfs, fromCache: true, stale: true }));
          return;
        } catch(_) {}
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /debug-meta?symbol=X  -- dump raw Yahoo chart meta for debugging
  if (pathname === '/debug-meta') {
    const sym = searchParams.get('symbol') || 'RELIANCE';
    try {
      // Try both 1d and 3mo ranges to see which has more fields
      const path1d  = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
      const path3mo = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=3mo&includePrePost=false`;
      const [r1, r3] = await Promise.all([
        httpsGet({ hostname: 'query1.finance.yahoo.com', path: path1d,  method: 'GET', timeout: 12000, headers: YAHOO_HEADERS }),
        httpsGet({ hostname: 'query1.finance.yahoo.com', path: path3mo, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS }),
      ]);
      const meta1d  = JSON.parse(r1.body)?.chart?.result?.[0]?.meta || {};
      const meta3mo = JSON.parse(r3.body)?.chart?.result?.[0]?.meta || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sym, range_1d: meta1d, range_3mo: meta3mo }, null, 2));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /etf-nav?symbols=A,B  -- fetch ETF-specific data: NAV, 52W range, expense ratio via quoteSummary
  if (pathname === '/etf-nav') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await fetchETFData(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /stream/etf-nav?symbols=A,B  -- SSE: streams live NAV/price/premium per symbol as each resolves
  if (pathname === '/stream/etf-nav') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    try {
      // Prime navMap once upfront (stale-while-revalidate — non-blocking if cached)
      const hasData = navMapCache.savedAt > 0;
      const isStale = (Date.now() - navMapCache.savedAt) >= navMapCache.TTL;
      let navMap = {};
      if (hasData) {
        navMap = navMapCache.data;
        if (isStale) refreshNavMapFromNSE().catch(e => console.warn('[stream/etf-nav] bg NSE refresh failed:', e.message));
      } else {
        await refreshNavMapFromNSE();
        navMap = navMapCache.data;
      }
      const etfListData = {};
      try {
        if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
          const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          for (const e of (cached.etfs || [])) etfListData[e.sym] = e;
        }
      } catch(_) {}

      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        if (closed) break;
        const chunk = symbols.slice(i, i + CONCURRENCY);
        await Promise.allSettled(chunk.map(sym => (async () => {
          const nse = navMap[sym] || {};
          const disk = etfListData[sym] || {};
          try {
            const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
            let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
            if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
            const meta = r.status === 200 ? JSON.parse(r.body)?.chart?.result?.[0]?.meta : null;
            const price  = meta?.regularMarketPrice ?? null;
            const volume = meta?.regularMarketVolume ?? nse.volume ?? disk.volume ?? null;
            const high52 = nse.high52 || disk.high52 || meta?.fiftyTwoWeekHigh || null;
            const low52  = nse.low52  || disk.low52  || meta?.fiftyTwoWeekLow  || null;
            let nav = nse.nav || meta?.navPrice || disk.nav || null;
            if (nav && price && disk.nav && Math.abs(nav - price) < 0.0001 && Math.abs(disk.nav - price) > 0.0001) nav = disk.nav;
            const navPremium = (nav && price) ? +((( price - nav) / nav) * 100).toFixed(2) : null;
            send({ sym, data: { price, nav, navPremium, high52, low52, volume, aum: nse.aum || null, expRatio: nse.expRatio || null } });
          } catch(e) {
            send({ sym, data: { nav: nse.nav||disk.nav||null, high52: nse.high52||disk.high52||null, low52: nse.low52||disk.low52||null, volume: nse.volume||disk.volume||null, navPremium: null, aum: nse.aum||null, expRatio: nse.expRatio||null } });
          }
        })()));
      }
    } catch(e) { send({ error: e.message }); }
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); }
    return;
  }

  // /stream/etf-summary?symbols=A,B  -- SSE: flushes cache hits immediately, streams live fetches as they resolve
  if (pathname === '/stream/etf-summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const now = Date.now();
    try {
      const etfListForSum = {};
      try {
        if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
          const lc = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          for (const e of (lc.etfs || [])) etfListForSum[e.sym] = e;
        }
      } catch(_) {}

      const stale = [];
      for (const sym of symbols) {
        const meta = etfMetaCache[sym];
        const metaFresh = meta && (now - (meta.savedAt || 0)) < ETF_META_TTL;
        const oneMEntry = etfSumCache[sym];
        const oneMFresh = oneMEntry && oneMEntry.version === ETF_SUM_CACHE_VERSION && (now - (oneMEntry.savedAt || 0)) < ETF_1M_RETURN_TTL;
        if (metaFresh) {
          const nav = etfListForSum[sym]?.nav ?? null;
          const price = etfListForSum[sym]?.price ?? null;
          const premium = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
          send({ sym, data: { nav, price, premium, expenseRatio: getETFExpenseRatio(sym),
            category: meta.category ?? null, fundFamily: meta.fundFamily ?? lookupAMC(sym),
            ytdReturn: meta.ytdReturn ?? null, oneMonthReturn: oneMEntry?.oneMonthReturn ?? null,
            oneYearReturn: meta.oneYearReturn ?? null, threeYearReturn: meta.threeYearReturn ?? null,
            fiveYearReturn: meta.fiveYearReturn ?? null,
            high52: etfListForSum[sym]?.high52 ?? null, low52: etfListForSum[sym]?.low52 ?? null,
          }});
          if (!oneMFresh) stale.push(sym); // 1M-only refresh needed
        } else {
          stale.push(sym);
        }
      }

      if (stale.length && !closed) {
        const hasCrumb = await ensureCrumb();
        const MODULES = 'defaultKeyStatistics,summaryDetail,fundProfile,fundPerformance';
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          if (closed) break;
          const chunk = stale.slice(i, i + CONCURRENCY);
          await Promise.allSettled(chunk.map(sym => (async () => {
            try {
              let nav = null, price = null, premium = null, expenseRatio = null,
                  category = null, fundFamily = null, high52 = null, low52 = null, directReturns = {};
              if (hasCrumb && yahooCrumb.value) {
                const path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                const headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
                let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status === 200) {
                  const json = JSON.parse(r.body);
                  const result = json?.quoteSummary?.result?.[0];
                  if (result) {
                    const stats = result.defaultKeyStatistics || {}, detail = result.summaryDetail || {};
                    const profile = result.fundProfile || {}, performance = result.fundPerformance || {};
                    nav = stats.nav?.raw ?? stats.navPrice?.raw ?? null;
                    price = detail.previousClose?.raw ?? null;
                    premium = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
                    expenseRatio = profile.annualReportExpenseRatio?.raw ?? stats.annualReportExpenseRatio?.raw ?? null;
                    category = profile.categoryName ?? null;
                    fundFamily = profile.family ?? null;
                    high52 = detail.fiftyTwoWeekHigh?.raw ?? null;
                    low52 = detail.fiftyTwoWeekLow?.raw ?? null;
                    directReturns = parseDirectReturns(performance);
                  }
                }
              }
              if (expenseRatio == null) expenseRatio = getETFExpenseRatio(sym);
              if (fundFamily == null) fundFamily = lookupAMC(sym);
              if (nav == null) nav = etfListForSum[sym]?.nav ?? null;
              if (nav && price && premium == null) premium = +((price - nav) / nav * 100).toFixed(2);
              const needsComputed = ['oneMonthReturn','ytdReturn','oneYearReturn','threeYearReturn','fiveYearReturn'].some(k => directReturns[k] == null);
              const computed = needsComputed ? await computeReturns(sym) : {};
              const oneMonthReturn  = directReturns.oneMonthReturn  ?? computed.oneMonthReturn  ?? null;
              const ytdReturn       = directReturns.ytdReturn       ?? computed.ytdReturn       ?? null;
              const oneYearReturn   = directReturns.oneYearReturn   ?? computed.oneYearReturn   ?? null;
              const threeYearReturn = directReturns.threeYearReturn ?? computed.threeYearReturn ?? null;
              const fiveYearReturn  = directReturns.fiveYearReturn  ?? computed.fiveYearReturn  ?? null;
              const data = { nav, price, premium, expenseRatio, category, fundFamily, oneMonthReturn, ytdReturn, oneYearReturn, threeYearReturn, fiveYearReturn, high52, low52 };
              // Update caches
              if (expenseRatio != null || fundFamily != null || oneYearReturn != null) {
                etfMetaCache[sym] = { expenseRatio, category, fundFamily, ytdReturn, oneYearReturn, threeYearReturn, fiveYearReturn, savedAt: now };
              }
              if (oneMonthReturn != null) etfSumCache[sym] = { oneMonthReturn, savedAt: now, version: ETF_SUM_CACHE_VERSION };
              send({ sym, data });
            } catch(e) { console.warn(`[stream/etf-summary] ${sym}:`, e.message); }
          })()));
        }
        saveEtfMetaCache();
        saveEtfSumCache();
      }
    } catch(e) { send({ error: e.message }); }
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); }
    return;
  }

  // /yahoo?symbols=...
  if (pathname === '/yahoo') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await yahooQuote(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/indices
  if (pathname === '/yahoo/indices') {
    try {
      const data = await yahooIndices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /stock-news?symbol=RELIANCE&name=Reliance%20Industries
  if (pathname === '/stock-news') {
    const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();
    const name = (searchParams.get('name') || '').trim();
    const assetType = (searchParams.get('assetType') || searchParams.get('type') || 'stock').trim().toLowerCase();
    if (!symbol) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbol' })); return; }
    try {
      const data = await fetchStockNews(symbol, name, assetType);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /fresh-stock-news -- server-side scan for today's / last business day's fresh stock news
  if (pathname === '/fresh-stock-news') {
    try {
      let payload = {};
      if (req.method === 'POST') {
        payload = await readJsonBody(req);
      } else if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      const rawSymbols = req.method === 'GET'
        ? String(searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean)
        : (payload.symbols || payload.stocks || []);
      const data = await fetchFreshStockNews(rawSymbols, {
        date: payload.date || searchParams.get('date') || '',
        maxSymbols: payload.maxSymbols || searchParams.get('maxSymbols'),
        concurrency: payload.concurrency || searchParams.get('concurrency'),
        limit: payload.limit || searchParams.get('limit'),
        offset: payload.offset || searchParams.get('offset'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error: e.message }));
    }
    return;
  }

  // /sparklines?symbols=A,B  -- 1-month daily closes normalised to % (in-memory cache, 2h TTL)
  if (pathname === '/sparklines') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const results = {};
      const stale = [];
      for (const sym of symbols) {
        if (sparkCache[sym] && (now - sparkCache[sym].t) < SPARK_TTL) {
          results[sym] = sparkCache[sym].v;
        } else {
          stale.push(sym);
        }
      }
      if (stale.length) {
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          const chunk = stale.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(chunk.map(sym => fetchSparkline(sym).then(v => ({ sym, v }))));
          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value?.v) {
              const { sym, v } = r.value;
              results[sym] = v;
              sparkCache[sym] = { v, t: now };
            }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: results }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /stream/intraday-signals?symbols=A,B  -- SSE: pushes each symbol as soon as its fetch resolves
  if (pathname === '/stream/intraday-signals') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    try {
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        if (closed) break;
        const chunk = symbols.slice(i, i + CONCURRENCY);
        await Promise.allSettled(chunk.map(sym =>
          fetchIntradaySignal(sym)
            .then(v => { if (v) send({ sym, data: v }); })
            .catch(e => console.warn(`[stream/intraday] ${sym}:`, e.message))
        ));
      }
    } catch(e) { send({ error: e.message }); }
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); }
    return;
  }

  // /stream/yahoo-summary?symbols=A,B  -- SSE: flushes cache hits immediately, streams live fetches as they resolve
  if (pathname === '/stream/yahoo-summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const now = Date.now();
    try {
      // Flush cache hits immediately so browser renders them right away
      const stale = [];
      for (const sym of symbols) {
        const entry = fundCache[sym];
        if (entry && (now - entry.savedAt) < FUND_CACHE_TTL) {
          send({ sym, data: entry.data });
        } else {
          stale.push(sym);
        }
      }
      // Stream live fetches as each one resolves
      if (stale.length && !closed) {
        const MODULES = 'financialData,defaultKeyStatistics,summaryDetail,assetProfile';
        const hasCrumb = await ensureCrumb();
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          if (closed) break;
          const chunk = stale.slice(i, i + CONCURRENCY);
          await Promise.allSettled(chunk.map(sym => (async () => {
            try {
              let path, headers;
              if (hasCrumb && yahooCrumb.value) {
                path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
              } else {
                path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
                headers = YAHOO_HEADERS;
              }
              let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
              if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
              if (r.status === 401 || r.status === 403) {
                await refreshYahooCrumb();
                if (yahooCrumb.value) {
                  path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                  headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
                  r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                }
              }
              if (r.status !== 200) return;
              const json = JSON.parse(r.body);
              const result = json?.quoteSummary?.result?.[0];
              let data = null;
              if (result) {
                const fin = result.financialData || {}, stats = result.defaultKeyStatistics || {};
                const detail = result.summaryDetail || {}, profile = result.assetProfile || {};
                data = {
                  trailingEps: fin.trailingEps?.raw ?? stats.trailingEps?.raw ?? null,
                  forwardEps: stats.forwardEps?.raw ?? null,
                  trailingPE: fin.trailingPE?.raw ?? stats.trailingPE?.raw ?? detail.trailingPE?.raw ?? null,
                  forwardPE: fin.forwardPE?.raw ?? detail.forwardPE?.raw ?? null,
                  marketCap: detail.marketCap?.raw ?? null,
                  priceToBook: stats.priceToBook?.raw ?? null,
                  dividendYield: detail.dividendYield?.raw ?? detail.trailingAnnualDividendYield?.raw ?? null,
                  fiftyDayAvg: detail.fiftyDayAverage?.raw ?? null,
                  twoHundredDayAvg: detail.twoHundredDayAverage?.raw ?? null,
                  high52: detail.fiftyTwoWeekHigh?.raw ?? null,
                  low52: detail.fiftyTwoWeekLow?.raw ?? null,
                  roe: fin.returnOnEquity?.raw ?? null,
                  totalDebt: fin.totalDebt?.raw ?? null,
                  totalEquity: fin.totalStockholdersEquity?.raw ?? null,
                  epsGrowth: fin.earningsGrowth?.raw ?? null,
                  peg: stats.pegRatio?.raw ?? null,
                  priceTarget: fin.targetMeanPrice?.raw ?? fin.targetMedianPrice?.raw ?? null,
                  sharesOutstanding: stats.sharesOutstanding?.raw ?? null,
                  sector: profile.sector ?? null,
                  industry: profile.industry ?? null,
                };
              } else {
                const meta = json?.chart?.result?.[0]?.meta;
                if (meta) {
                  const trailingEps = meta.epsTrailingTwelveMonths ?? null;
                  const forwardEps = meta.epsForward ?? null;
                  const trailingPE = meta.trailingPE ?? null;
                  const price = meta.regularMarketPrice ?? null;
                  data = { trailingEps, forwardEps, trailingPE,
                    forwardPE: (forwardEps && price) ? +(price / forwardEps).toFixed(2) : null,
                    marketCap: meta.marketCap ?? null, priceToBook: null, dividendYield: null,
                    fiftyDayAvg: meta.fiftyDayAverage ?? null, twoHundredDayAvg: meta.twoHundredDayAverage ?? null,
                    high52: meta.fiftyTwoWeekHigh ?? null, low52: meta.fiftyTwoWeekLow ?? null,
                    roe: null, totalDebt: null, totalEquity: null, epsGrowth: null,
                    peg: null, priceTarget: null, sharesOutstanding: null, sector: null, industry: null,
                  };
                }
              }
              if (data) {
                fundCache[sym] = { data, savedAt: now };
                send({ sym, data });
              }
            } catch(e) { console.warn(`[stream/summary] ${sym}:`, e.message); }
          })()));
        }
        saveFundCache();
      }
    } catch(e) { send({ error: e.message }); }
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); }
    return;
  }

  // /intraday-signals?symbols=A,B  -- 5-minute VWAP/EMA/RSI/ATR setup for short-term trades
  if (pathname === '/intraday-signals') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const results = {};
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const chunk = symbols.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map(sym => fetchIntradaySignal(sym).then(v => ({ sym, v }))));
        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value?.v) results[r.value.sym] = r.value.v;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: results }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /etf-summary?symbols=A,B  -- fetch ETF-specific data: NAV, expense ratio, category (slow fields cached 30 days)
  if (pathname === '/etf-summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const results = {};

      // Read etf_list_cache once upfront — used as nav fallback for both cached and fresh fetches
      // (Yahoo quoteSummary rarely returns nav for Indian ETFs like BANKIETF)
      const etfListForSum = {};
      try {
        if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
          const lc = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          for (const e of (lc.etfs || [])) etfListForSum[e.sym] = e;
        }
      } catch(_) {}

      // ── Cache read: two-tier lookup ─────────────────────────────────────────
      // etfMetaCache  → static fields (TER, category, fundFamily, 1Y/3Y/5Y) — 30d TTL
      // etfSumCache   → oneMonthReturn only — 24h TTL
      // etfListForSum → nav fallback (from NSE batch, always fresh from etf_list_cache.json)
      // A symbol goes to stale[] only when its static meta is missing/expired.
      // staleOneMOnly[] = static fields are fresh but 1M return is >24h old.
      const stale = [];
      const staleOneMOnly = [];
      for (const sym of symbols) {
        const meta     = etfMetaCache[sym];
        const metaFresh = meta && (now - (meta.savedAt || 0)) < ETF_META_TTL;
        const oneMEntry = etfSumCache[sym];
        const oneMFresh = oneMEntry && oneMEntry.version === ETF_SUM_CACHE_VERSION
                          && (now - (oneMEntry.savedAt || 0)) < ETF_1M_RETURN_TTL;

        if (metaFresh) {
          // Assemble result from the two caches + live nav from etfListForSum
          const nav    = etfListForSum[sym]?.nav ?? null;
          const price  = etfListForSum[sym]?.price ?? null;
          const premium = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
          results[sym] = {
            nav, price, premium,
            expenseRatio   : getETFExpenseRatio(sym),
            category       : meta.category       ?? null,
            fundFamily     : meta.fundFamily      ?? lookupAMC(sym),
            ytdReturn      : meta.ytdReturn       ?? null,
            oneMonthReturn : oneMEntry?.oneMonthReturn ?? null,
            oneYearReturn  : meta.oneYearReturn   ?? null,
            threeYearReturn: meta.threeYearReturn ?? null,
            fiveYearReturn : meta.fiveYearReturn  ?? null,
            high52         : etfListForSum[sym]?.high52 ?? null,
            low52          : etfListForSum[sym]?.low52  ?? null,
          };
          if (!oneMFresh) staleOneMOnly.push(sym);
        } else {
          stale.push(sym);
        }
      }
      const hits = symbols.length - stale.length - staleOneMOnly.length;
      if (hits || staleOneMOnly.length)
        console.log(`[etf-cache] ${hits} full-hits, ${staleOneMOnly.length} 1M-stale, ${stale.length} full-miss`);

      // Fetch only stale/missing symbols from Yahoo
      if (stale.length) {

        const hasCrumb = await ensureCrumb();
        const MODULES = 'defaultKeyStatistics,summaryDetail,fundProfile,fundPerformance';
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          const chunk = stale.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(chunk.map(sym => (async () => {
            try {
              // Base fields from quoteSummary (or chart meta fallback)
              let nav = null, price = null, premium = null, expenseRatio = null,
                  category = null, fundFamily = null, high52 = null, low52 = null,
                  directReturns = {};

              if (hasCrumb && yahooCrumb.value) {
                const path    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                const headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
                let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status === 200) {
                  const json   = JSON.parse(r.body);
                  const result = json?.quoteSummary?.result?.[0];
                  if (result) {
                    const stats    = result.defaultKeyStatistics || {};
                    const detail   = result.summaryDetail || {};
                    const profile  = result.fundProfile || {};
                    const performance = result.fundPerformance || {};
                    nav          = stats.nav?.raw ?? stats.navPrice?.raw ?? null;
                    price        = detail.previousClose?.raw ?? null;
                    premium      = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
                    expenseRatio = profile.annualReportExpenseRatio?.raw ?? stats.annualReportExpenseRatio?.raw ?? null;
                    category     = profile.categoryName ?? null;
                    fundFamily   = profile.family ?? null;
                    high52       = detail.fiftyTwoWeekHigh?.raw ?? null;
                    low52        = detail.fiftyTwoWeekLow?.raw  ?? null;
                    directReturns = parseDirectReturns(performance);
                  }
                }
              }

              // Fallback: static TER table (Yahoo rarely has this for Indian ETFs)
              if (expenseRatio == null) expenseRatio = getETFExpenseRatio(sym);
              // Fallback: static AMC lookup when Yahoo fundProfile.family is null
              if (fundFamily == null) fundFamily = lookupAMC(sym);

              // Fallback: etf_list_cache nav (NSE iNAV) when Yahoo quoteSummary has none
              // Also recompute premium if we now have nav from fallback
              if (nav == null) nav = etfListForSum[sym]?.nav ?? null;
              if (nav && price && premium == null) premium = +((price - nav) / nav * 100).toFixed(2);

              // Prefer Yahoo's direct trailing returns; fall back to local chart-derived values.
              const needsComputedReturns = ['oneMonthReturn', 'ytdReturn', 'oneYearReturn', 'threeYearReturn', 'fiveYearReturn']
                .some(k => directReturns[k] == null);
              const computed = needsComputedReturns ? await computeReturns(sym) : {};
              const oneMonthReturn  = directReturns.oneMonthReturn  ?? computed.oneMonthReturn  ?? null;
              const ytdReturn       = directReturns.ytdReturn       ?? computed.ytdReturn       ?? null;
              const oneYearReturn   = directReturns.oneYearReturn   ?? computed.oneYearReturn   ?? null;
              const threeYearReturn = directReturns.threeYearReturn ?? computed.threeYearReturn ?? null;
              const fiveYearReturn  = directReturns.fiveYearReturn  ?? computed.fiveYearReturn  ?? null;
              if (ytdReturn != null)
                console.log(`[etf-summary] ${sym} 1M=${oneMonthReturn!=null?(oneMonthReturn*100).toFixed(1)+'%':'–'} YTD=${(ytdReturn*100).toFixed(1)}% 1Y=${oneYearReturn!=null?(oneYearReturn*100).toFixed(1)+'%':'–'} source=${directReturns.oneMonthReturn != null ? 'direct' : 'computed'}`);

              return { sym, data: { nav, price, premium, expenseRatio, category, fundFamily, oneMonthReturn, ytdReturn, oneYearReturn, threeYearReturn, fiveYearReturn, high52, low52 } };
            } catch(e) { console.warn(`[etf-summary] ${sym} error:`, e.message); return { sym, data: null }; }
          })()));
          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value?.data) {
              const { sym, data } = r.value;
              results[sym] = data;
              // Write static fields to etfMetaCache (30d TTL in etf_list_cache.json)
              if (data.expenseRatio != null || data.fundFamily != null || data.oneYearReturn != null) {
                etfMetaCache[sym] = {
                  expenseRatio   : data.expenseRatio    ?? null,
                  category       : data.category        ?? null,
                  fundFamily     : data.fundFamily       ?? null,
                  ytdReturn      : data.ytdReturn        ?? null,
                  oneYearReturn  : data.oneYearReturn    ?? null,
                  threeYearReturn: data.threeYearReturn  ?? null,
                  fiveYearReturn : data.fiveYearReturn   ?? null,
                  savedAt        : now,
                };
              }
              // Write 1M return to etfSumCache (24h TTL in etf_summary_cache.json)
              if (data.oneMonthReturn != null) {
                etfSumCache[sym] = { oneMonthReturn: data.oneMonthReturn, savedAt: now, version: ETF_SUM_CACHE_VERSION };
              }
            }
          }
        }
        saveEtfMetaCache();
        saveEtfSumCache();
      } // end if (stale.length)

      // ── Background 1M return refresh ────────────────────────────────────────
      // For symbols with fresh static fields but a stale 1M return (>24h), recompute
      // oneMonthReturn from chart history and update the cache entry in the background.
      // Results are NOT awaited — response has already been built from cached values;
      // the next request will see the fresh 1M return.
      if (staleOneMOnly.length) {
        console.log(`[etf-cache] refreshing 1M return in background for ${staleOneMOnly.length} symbols`);
        (async () => {
          const refreshNow = Date.now();
          for (let i = 0; i < staleOneMOnly.length; i += CONCURRENCY) {
            const chunk = staleOneMOnly.slice(i, i + CONCURRENCY);
            await Promise.allSettled(chunk.map(async sym => {
              try {
                const computed = await computeReturns(sym);
                if (computed.oneMonthReturn == null) return;
                etfSumCache[sym] = { oneMonthReturn: computed.oneMonthReturn, savedAt: refreshNow, version: ETF_SUM_CACHE_VERSION };
                // Also patch into the already-sent results (in-memory only; next request will see it)
                console.log(`[etf-cache] ${sym} 1M return refreshed: ${(computed.oneMonthReturn * 100).toFixed(2)}%`);
              } catch(e) { console.warn(`[etf-cache] 1M refresh error ${sym}:`, e.message); }
            }));
            if (i + CONCURRENCY < staleOneMOnly.length) await new Promise(r => setTimeout(r, 300));
          }
          saveEtfSumCache();
        })().catch(e => console.warn('[etf-cache] background 1M refresh failed:', e.message));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, etfs: results }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/summary?symbols=A,B  -- fetch assetProfile + marketCap metadata (cached 7 days)
  if (pathname === '/yahoo/summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const metas = {};

      // Serve fresh entries from cache
      const stale = [];
      for (const sym of symbols) {
        const entry = fundCache[sym];
        if (entry && (now - entry.savedAt) < FUND_CACHE_TTL) {
          metas[sym] = entry.data;
        } else {
          stale.push(sym);
        }
      }

      const cacheHits = symbols.length - stale.length;
      if (cacheHits) console.log(`[fund-cache] ${cacheHits} hits, ${stale.length} stale/missing for ${symbols.length} symbols`);

      // Fetch only stale/missing symbols from Yahoo
      if (stale.length) {
        const fetched = await yahooSummary(stale);
        for (const sym of Object.keys(fetched.metas || {})) {
          const data = fetched.metas[sym];
          if (data) {
            metas[sym] = data;
            fundCache[sym] = { data, savedAt: now };
          }
        }
        saveFundCache();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, metas }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Holdings are populated as a side-effect of /etf-summary fetches.
  // This endpoint ONLY serves from cache — no live fetch.
  // /paper-trades -- local paper trading journal for locked intraday entries
  if (pathname === '/paper-trades') {
    if (req.method === 'GET') {
      const state = loadPaperStateFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trades: state.trades, portfolio: state.portfolio }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const action = String(payload.action || '').toLowerCase();
        const state = loadPaperStateFile();
        const trades = state.trades;

        if (action === 'add-capital') {
          const amount = Number(payload.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Positive amount is required' }));
            return;
          }
          state.portfolio = state.portfolio || defaultPaperPortfolio();
          state.portfolio.capitalAdds = Array.isArray(state.portfolio.capitalAdds) ? state.portfolio.capitalAdds : [];
          state.portfolio.capitalAdds.push({
            amount:+amount.toFixed(2),
            at: new Date().toISOString(),
            note: String(payload.note || 'Manual capital add'),
          });
          savePaperStateFile(state);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, portfolio: state.portfolio }));
          return;
        }

        if (action === 'open') {
          const symbol = String(payload.symbol || '').trim().toUpperCase();
          const side = String(payload.side || 'buy').toLowerCase();
          const qty = Number(payload.qty);
          const entryPrice = Number(payload.entryPrice);
          if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'symbol, side, qty and entryPrice are required' }));
            return;
          }
          const existing = trades.find(t => t.symbol === symbol && t.status === 'open');
          if (existing) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Open paper trade already exists for this symbol', trade: existing }));
            return;
          }
          const brokerMode = String(payload.brokerMode || payload.executionMode || '').toLowerCase();
          const dryRunEntryOrder = brokerMode === 'zerodha_dry_run'
            ? buildZerodhaDryRunOrder({ ...payload, symbol, side, qty, entryPrice, assetType: payload.assetType === 'etf' ? 'etf' : 'stock' }, null, 'entry')
            : null;
          const trade = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: 'open',
            symbol,
            name: String(payload.name || symbol),
            side,
            qty: Math.floor(qty),
            entryPrice:+entryPrice.toFixed(2),
            target: Number.isFinite(Number(payload.target)) ? +Number(payload.target).toFixed(2) : null,
            stop: Number.isFinite(Number(payload.stop)) ? +Number(payload.stop).toFixed(2) : null,
            signal: payload.signal || null,
            score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
            rr: Number.isFinite(Number(payload.rr)) ? Number(payload.rr) : null,
            reservedCapital: Number.isFinite(Number(payload.reservedCapital)) ? +Number(payload.reservedCapital).toFixed(2) : +(entryPrice * Math.floor(qty)).toFixed(2),
            portfolioInitial: Number.isFinite(Number(payload.portfolioInitial)) ? +Number(payload.portfolioInitial).toFixed(2) : null,
            source: payload.source === 'simulation' ? 'simulation' : 'manual',
            assetType: payload.assetType === 'etf' ? 'etf' : 'stock',
            setupType: payload.setupType || null,
            setup: payload.setup || null,
            entryContext: payload.entryContext && typeof payload.entryContext === 'object' ? payload.entryContext : null,
            notes: payload.notes || '',
            openedAt: new Date().toISOString(),
          };
          if (dryRunEntryOrder) {
            trade.broker = {
              name: 'zerodha',
              mode: 'dry-run',
              status: 'entry_dry_run',
              entryOrder: dryRunEntryOrder,
              exitPlan: {
                target: trade.target,
                stop: trade.stop,
                squareOff: 'intraday dashboard managed exit',
              },
              audit: [{ at: trade.openedAt, event: 'entry_dry_run_created', order: dryRunEntryOrder }],
            };
          }
          trades.unshift(trade);
          savePaperTradesFile(trades);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, trade }));
          return;
        }

        if (action === 'close') {
          const id = String(payload.id || '');
          const exitPrice = Number(payload.exitPrice);
          const trade = trades.find(t => t.id === id && t.status === 'open');
          if (!trade || !Number.isFinite(exitPrice) || exitPrice <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Open trade id and exitPrice are required' }));
            return;
          }
          const pnl = computePaperTradePnl(trade, exitPrice);
          const closedAt = new Date().toISOString();
          Object.assign(trade, {
            status: 'closed',
            exitPrice:+exitPrice.toFixed(2),
            closedAt,
            closeReason: payload.reason || 'Manual exit',
            pnl: pnl.pnl,
            pnlPct: pnl.pnlPct,
            grossPnl: pnl.grossPnl,
            charges: pnl.charges,
            chargeBreakup: pnl.chargeBreakup,
          });
          if (trade.broker?.name === 'zerodha' && trade.broker?.mode === 'dry-run') {
            const exitOrder = buildZerodhaDryRunOrder({ ...trade, exitPrice }, trade, 'exit');
            trade.broker.status = 'exit_dry_run';
            trade.broker.exitOrder = exitOrder;
            trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
            trade.broker.audit.push({ at: closedAt, event: 'exit_dry_run_created', reason: trade.closeReason, order: exitOrder });
          }
          savePaperTradesFile(trades);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, trade }));
          return;
        }

        if (action === 'partial-close') {
          const id = String(payload.id || '');
          const exitPrice = Number(payload.exitPrice);
          const requestedQty = Math.floor(Number(payload.qty));
          const trade = trades.find(t => t.id === id && t.status === 'open');
          const openQty = Math.floor(Number(trade?.qty || 0));
          if (!trade || !Number.isFinite(exitPrice) || exitPrice <= 0 || !Number.isFinite(requestedQty) || requestedQty <= 0 || requestedQty >= openQty) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Open trade id, partial qty below open qty, and exitPrice are required' }));
            return;
          }
          const closedAt = new Date().toISOString();
          const partialTrade = {
            ...trade,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            parentId: trade.id,
            status: 'closed',
            qty: requestedQty,
            reservedCapital:+(Number(trade.entryPrice) * requestedQty).toFixed(2),
            exitPrice:+exitPrice.toFixed(2),
            closedAt,
            closeReason: payload.reason || 'Partial exit',
          };
          const pnl = computePaperTradePnl(partialTrade, exitPrice);
          Object.assign(partialTrade, {
            pnl: pnl.pnl,
            pnlPct: pnl.pnlPct,
            grossPnl: pnl.grossPnl,
            charges: pnl.charges,
            chargeBreakup: pnl.chargeBreakup,
          });
          trade.qty = openQty - requestedQty;
          trade.reservedCapital = +(Number(trade.entryPrice) * trade.qty).toFixed(2);
          trade.partialExits = Array.isArray(trade.partialExits) ? trade.partialExits : [];
          trade.partialExits.push({
            id: partialTrade.id,
            qty: requestedQty,
            exitPrice:+exitPrice.toFixed(2),
            closedAt,
            reason: partialTrade.closeReason,
            pnl: pnl.pnl,
          });
          trade._partialTargetBooked = true;
          trade._runnerArmed = true;
          trade._runnerWideTrail = !!payload.runner;
          trade.target = null;
          trade.setupType = trade.setupType || 'TARGET_RUNNER';
          if (trade.broker?.name === 'zerodha' && trade.broker?.mode === 'dry-run') {
            const exitOrder = buildZerodhaDryRunOrder({ ...partialTrade, exitPrice, qty: requestedQty }, partialTrade, 'exit');
            partialTrade.broker = partialTrade.broker || {};
            partialTrade.broker.exitOrder = exitOrder;
            trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
            trade.broker.audit.push({ at: closedAt, event: 'partial_exit_dry_run_created', reason: partialTrade.closeReason, order: exitOrder });
          }
          trades.unshift(partialTrade);
          savePaperTradesFile(trades);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, trade, partial: partialTrade }));
          return;
        }

        if (action === 'delete') {
          const id = String(payload.id || '');
          const next = trades.filter(t => t.id !== id);
          savePaperTradesFile(next);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, deleted: trades.length - next.length }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /simulation-replay/why -- compact explanation for one symbol.
  if (pathname === '/simulation-replay/why') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const day = String(searchParams.get('day') || getIstDateKey()).trim();
      const symbol = String(searchParams.get('symbol') || '').trim();
      if (!symbol) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:'symbol is required' }));
        return;
      }
      const payload = buildWhyMissedResponse(day, symbol);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Why missed failed' }));
    }
    return;
  }

  // /simulation-replay/jobs -- async replay/backtest job wrapper for long sweep/autotune runs.
  if (pathname === '/simulation-replay/jobs') {
    if (req.method === 'POST') {
      try {
        let payload = {};
        try { payload = await readJsonBody(req); } catch (_) { payload = {}; }
        const day = String(payload.day || searchParams.get('day') || getIstDateKey()).trim();
        const mode = replayModeFromParams({ mode:payload.mode || searchParams.get('mode') });
        const job = createReplayJob(day, mode);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:true, job:compactReplayJob(job), jobs:compactReplayJobHistory() }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:e.message || 'Could not create replay job' }));
      }
      return;
    }
    if (req.method === 'GET') {
      const id = String(searchParams.get('id') || '').trim();
      if (!id) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:true, jobs:compactReplayJobHistory() }));
        return;
      }
      const job = replayJobs.get(id);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:'Replay job not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, job:compactReplayJob(job), jobs:compactReplayJobHistory() }));
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /trade-settings -- persist dashboard-applied trade rule overrides in workspace
  if (pathname === '/trade-settings') {
    if (req.method === 'GET') {
      const state = loadTradeSettingsFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, ...state }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const overrides = saveTradeSettingsFile(payload?.overrides || payload || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:true, savedAt:Date.now(), overrides }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:e.message || 'Could not save trade settings' }));
      }
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /simulation-replay -- run replay/backtest on the proxy and return compact report rows.
  if (pathname === '/simulation-replay') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      const day = (searchParams.get('day') || searchParams.get('date') || getIstDateKey()).trim();
      const mode = String(searchParams.get('mode') || 'report').toLowerCase();
      let payload;
      if (mode === 'autotune') {
        payload = buildReplayAutoTuneResponse(day);
      } else {
        payload = buildReplayResponse(day, { sweep: mode === 'sweep' || searchParams.get('sweep') === '1' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Replay failed' }));
    }
    return;
  }

  // /simulation-snapshots -- intraday strategy replay snapshots, retained for configured days
  if (pathname === '/simulation-snapshots') {
    if (req.method === 'GET') {
      const day = (searchParams.get('day') || searchParams.get('date') || '').trim();
      const state = day ? loadSimulationSnapshotsFile(day) : { snapshots: loadAllSimulationSnapshots() };
      const snapshots = day ? saveSimulationSnapshotsFile(state, day) : state.snapshots;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, retentionDays: SIM_SNAPSHOT_RETENTION_DAYS, date: day || null, count: snapshots.length, snapshots }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const snapshot = sanitizeSimulationSnapshot(payload || {});
        const day = getIstDateKey(snapshot.at || Date.now());
        const state = loadSimulationSnapshotsFile(day);
        state.snapshots.push(snapshot);
        const snapshots = saveSimulationSnapshotsFile(state, day);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, retentionDays: SIM_SNAPSHOT_RETENTION_DAYS, date: day, file: path.basename(getSimulationSnapshotFile(day)), count: snapshots.length, snapshot }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Invalid snapshot payload' }));
      }
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /etf-prefs  -- persist custom ETF symbols in workspace
  if (pathname === '/etf-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedETFsFile();
      console.log('[proxy] /etf-prefs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /etf-favs  -- persist ETF favorites in workspace
  if (pathname === '/etf-favs') {
    if (req.method === 'GET') {
      const list = loadSavedETFFavsFile();
      console.log('[proxy] /etf-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-prefs  -- persist custom stock symbols in workspace
  if (pathname === '/stock-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedStocksFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          let toSave = [];
          if (Array.isArray(payload)) {
            // Support array of strings or array of objects { sym, sector, cap }
            if (payload.length && typeof payload[0] === 'string') {
              toSave = payload.map(s => String(s).trim().toUpperCase()).filter(Boolean);
            } else {
              toSave = payload.map(item => {
                if (!item || typeof item === 'string') return null;
                const sym = String(item.sym||item.symbol||'').trim().toUpperCase();
                if (!sym) return null;
                return { sym, name: item.name || sym, sector: item.sector||null, cap: item.cap||null };
              }).filter(Boolean);
            }
          }
          console.log('[proxy] saving stock prefs:', JSON.stringify(toSave));
          saveSavedStocksFile(toSave);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: toSave.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-favs  -- persist Stock favorites in workspace
  if (pathname === '/stock-favs') {
    if (req.method === 'GET') {
      const list = loadSavedStockFavsFile();
      console.log('[proxy] /stock-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedStockFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── Static file serving (serve dashboard and assets from repo) ──
  try {
    // Map '/' -> dashboard HTML
    const safePath = pathname === '/' ? '/nse_midcap_dashboard.html' : pathname;
    // Prevent path traversal
    const resolved = path.normalize(path.join(__dirname, safePath));
    if (!resolved.startsWith(path.join(__dirname, path.sep))) throw new Error('Invalid path');
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
      const cacheControl = ext === '.html'
        ? 'no-cache'
        : (ext === '.js' || ext === '.css' ? 'public, max-age=3600' : 'public, max-age=300');
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cacheControl });
      const stream = fs.createReadStream(resolved);
      stream.pipe(res);
      return;
    }
  } catch (e) {
    // fallthrough to 404
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

let proxyInitialized = false;

async function initializeProxy() {
  if (proxyInitialized) return;
  proxyInitialized = true;
  await Promise.all([warmNSESession(), refreshYahooCrumb()]);
  startFreshNewsCron();
}

function startProxyServer(port = PORT) {
  const server = http.createServer(proxyRequestHandler);

  server.listen(port, async () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║  NSE + Yahoo Finance Proxy → http://localhost:${port}  ║
║  Yahoo: v8/finance/chart (crumb-free) ✓          ║
╠══════════════════════════════════════════════════╣
║  GET /health                                     ║
║  GET /nse?path=/api/...     NSE India            ║
║  GET /yahoo?symbols=A,B     Yahoo Finance        ║
║  GET /yahoo/indices         Nifty indices        ║
║  GET /etf-prefs             ETF prefs storage    ║
║  GET /etf-favs              ETF favorites storage ║
║  GET /stock-prefs           Stock prefs storage  ║
║  GET /stock-favs            Stock favorites storage║
║  GET /paper-trades          Paper trade journal  ║
║                                                  ║
║  Press Ctrl+C to stop.                           ║
╚══════════════════════════════════════════════════╝
`);
    await initializeProxy();
  });

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n⚠  Port ${port} already in use. Stop the other process or change PORT.\n`);
      process.exit(1);
    }
  });

  return server;
}

if (require.main === module) {
  startProxyServer(PORT);
}

module.exports = {
  initializeProxy,
  proxyRequestHandler,
  startProxyServer,
};
