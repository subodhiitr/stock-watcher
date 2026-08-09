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
const { Worker } = require('worker_threads');
const { mapWithConcurrency } = require('./server/concurrency');
const Backtest = require('./backtest_simulation');
const SimulationEngine = require('./simulation_engine');
const TradeRules = require('./trade_rules');
const { runSimulationDomainCycle } = require('./server/simulation-domain');
const {
  loadRuntimeState,
  saveRuntimeState,
  transitionRuntimeState,
  RuntimeStateTransitionError,
} = require('./server/simulation-runtime-store');
const { loadCredentials, saveCredentialsTokens } = require('./zerodha-credentials');
const { loadSharekhanCredentials, saveSharekhanAccessToken, saveSharekhanTokens } = require('./sharekhan-credentials');
const { KiteConnect } = require('kiteconnect');
const KiteClient = require('./zerodha-kite-client');
const SharekhanClient = require('./sharekhan-client');
const { buildYahooShapeFromCandles, fetchSharekhanIntraday } = require('./sharekhan-intraday');
const { SharekhanTickerPool, normalizeSharekhanMarketDepth } = require('./sharekhan-ticker');
const ConfirmationPoller = require('./zerodha-confirmation-poller');
const {
  applyLocalCors,
  jsonBodyErrorStatus,
  readJsonBody,
  rejectUnsafeNonLocalRequest,
} = require('./server/http-safety');
const { dispatchRoute } = require('./server/routes/registry');
const { handleDashboardRoute } = require('./server/routes/dashboard');
const { handleTradeSettingsRoute } = require('./server/routes/trade-settings');
const { handlePreferenceRoute } = require('./server/routes/preferences');
const { handleBrokerRoute } = require('./server/routes/broker');
const { handleReplayRoute } = require('./server/routes/replay');
const { handleSimulationRuntimeRoute } = require('./server/routes/simulation-runtime');
const { handleTradeExecutionRoute } = require('./server/routes/trade-execution');
const { handleSetupEfficiencyRoute } = require('./server/routes/setup-efficiency');
const { handleExitQualityRoute } = require('./server/routes/exit-quality');
const { handleStrategyAdvisorRoute } = require('./server/routes/strategy-advisor');
const { createResultCalendarService } = require('./server/result-calendar');
const { createIntradayCandlesService } = require('./server/intraday-candles');
const { createFreshNewsService } = require('./server/fresh-news');
const { createSetupEfficiencyService } = require('./server/setup-efficiency');
const { createExitQualityService } = require('./server/exit-quality');
const { createStrategyAdvisorFileService } = require('./server/strategy-advisor');
const { createSnapshotDatabase } = require('./server/snapshot-db');
const {
  initDb,
  saveTrade,
  listTrades,
  deleteTrade,
  getTradesUpdatedAt,
  computeAllTimeRealizedPnl,
  getDayPnl,
  rebuildDayPnl,
  rememberSymbols: dbRememberSymbols,
  getSavedStockSymbols,
  getSimulationSymbols,
  saveSimulationSymbols: dbSaveSimulationSymbols,
  upsertScripCodes,
  getFreshNews,
  saveFreshNews: dbSaveFreshNews,
  loadPortfolioState,
  savePortfolioState,
  listAllEtfs,
  getEtfSavedSymbols,
  getEtfFavoriteSymbols,
  setEtfSavedBulk,
  setEtfFavoriteBulk,
  upsertEtfMaster,
  getStockFavoriteSymbols,
  setStockFavoriteBulk,
  kvGet,
  kvSet,
  jsonCacheGet,
  jsonCacheSet,
} = require('./server/db');
const setupEfficiencyDb = require('./server/db');
const setupEfficiencyService = createSetupEfficiencyService({
  db:setupEfficiencyDb,
  intervalMs:60 * 60 * 1000,
});
const exitQualityService = createExitQualityService({
  db:setupEfficiencyDb,
  intervalMs:60 * 60 * 1000,
  resolveDayClose:resolveSimulationDayClosePrice,
});
let strategyAdvisorService = null;

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

const PORT  = process.env.PROXY_PORT ? Number.parseInt(process.env.PROXY_PORT, 10) : 3001;
const USER_OPENAI_PROPERTIES = path.join(os.homedir(), 'openai.properties');
const APP_CACHE_DIR        = path.join(__dirname, 'cache');
const DASHBOARD_APP_PATH   = path.join(__dirname, 'dashboard-app.js');
const ETF_LIST_CACHE_TTL   = 24 * 60 * 60 * 1000;        // 24 hours (NSE price/nav batch)
const ETF_META_TTL         = 30 * 24 * 60 * 60 * 1000;   // 30 days (static: TER, family, 1Y/3Y/5Y)
const FUND_CACHE_TTL       = 30 * 24 * 60 * 60 * 1000;   // 30 days (mostly static fundamentals)
const ETF_1M_RETURN_TTL    = 24 * 60 * 60 * 1000;        // 24 hours (1M return — base shifts daily)
const ETF_SUM_CACHE_VERSION = 3;                          // v3: 1M-return-only cache
const NSE_IDX_CACHE_TTL    = 24 * 60 * 60 * 1000;        // 24 hours
const REPLAY_CACHE_TTL     = 7 * 24 * 60 * 60 * 1000;    // 7 days (replay results
const PAPER_TRADES_FILE    = process.env.PAPER_TRADES_FILE || path.join(__dirname, 'paper_trades.json');
const TRADE_EXECUTION_PATH = '/trade-execution';
const PAPER_TRADES_ALIAS_PATH = '/paper-trades';
const TRADE_EXECUTION_STREAM_PATH = `${TRADE_EXECUTION_PATH}/stream`;
const PAPER_TRADES_ALIAS_STREAM_PATH = `${PAPER_TRADES_ALIAS_PATH}/stream`;
const PAPER_TRADES_DEPRECATION_WARNING = '/paper-trades will be removed next minor release';
const SIMULATION_RUNTIME_FILE = process.env.SIMULATION_RUNTIME_FILE || path.join(__dirname, 'simulation_runtime.json');
const REPLAY_WORKER_FILE   = path.join(__dirname, 'replay_worker.js');
// JSON files kept for one-time migration only (read on first DB init if kv_store is empty)
const BROKER_PREFS_FILE    = path.join(__dirname, 'broker_preferences.json');
const TRADE_SETTINGS_FILE  = process.env.TRADE_SETTINGS_FILE || path.join(__dirname, 'trade_settings.json');
const SIMULATION_UNIVERSE_FILE = process.env.SIMULATION_UNIVERSE_FILE || path.join(__dirname, 'simulation_universe.json');
// Snapshot and fresh-news files (large binary archives — legitimately file-based)
const SIM_SNAPSHOT_DIR     = path.join(__dirname, 'snapshots');
const SIM_SNAPSHOT_DB_FILE = process.env.SIM_SNAPSHOT_DB_FILE || path.join(SIM_SNAPSHOT_DIR, 'simulation_snapshots.db');
const SIM_DECISION_JOURNAL_DIR = path.join(APP_CACHE_DIR, 'simulation_decisions');
const SIM_SNAPSHOT_RETENTION_DAYS = 30;
const SIM_SNAPSHOT_TTL     = SIM_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const FRESH_NEWS_CACHE_FILE = path.join(APP_CACHE_DIR, 'fresh_stock_news.json'); // legacy combined cache
const FRESH_NEWS_CACHE_DIR  = path.join(APP_CACHE_DIR, 'fresh_news');
const FRESH_NEWS_CACHE_INDEX_FILE = path.join(FRESH_NEWS_CACHE_DIR, 'index.json');
const INTRADAY_LIVE_REFRESH_MARKET_SEC = 60;
const INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC = 15 * 60;
const SIMULATION_MARKET_CACHE_TTL_MS = 60 * 1000;
const SIMULATION_SYMBOL_META_CACHE_TTL_MS = 5 * 60 * 1000;
const STOCK_NEWS_TTL       = 30 * 60 * 1000;             // 30 minutes
const INTRADAY_SIGNAL_TTL  = 2 * 60 * 1000;              // 2 minutes
const LIVE_CACHE_STALE_AGE_MS = 5 * 60 * 1000;           // 5 min: beyond this age, live cache entry is stale
const SHAREKHAN_DAILY_CONTEXT_TTL_MS = 10 * 60 * 1000;   // 10 minutes: avoid daily Yahoo refetch on every WS tick
const REPLAY_CACHE_MAX     = 30;
const REPLAY_DEEP_SWEEP_TIME_IST = '15:50';
const REPLAY_DEEP_SWEEP_SCHEDULE_ENABLED = process.env.REPLAY_DEEP_SWEEP_SCHEDULE === '1';
const REPLAY_DEEP_SWEEP_STARTUP_ENABLED = process.env.REPLAY_DEEP_SWEEP_STARTUP === '1';
const replayResultCache    = new Map();
const replayJobs           = new Map();
const activeReplayJobs     = new Map();
const paperTradeStreamClients = new Set();
const intradayLiveStreamClients = new Set();
const marketOverviewStreamClients = new Set();
let intradayBroadcastTimer = null;
let intradayBroadcastReason = 'update';
let intradayBroadcastAllSymbols = false;
const intradayBroadcastChangedSymbols = new Set();
let replayDeepSweepTimer   = null;
const DEFAULT_SIMULATION_TICK_INTERVAL_SEC = 15;
const DEFAULT_SIMULATION_STOP_TIMEOUT_SEC = 900;
const SIMULATION_ACTIVE_TICK_MIN_INTERVAL_MS = 2000;
const SIMULATION_IDLE_TICK_MIN_INTERVAL_MS = 5000;
const SIMULATION_DECISION_HEARTBEAT_MS = 15 * 1000;
let simulationTickIntervalSec = DEFAULT_SIMULATION_TICK_INTERVAL_SEC;
let simulationStopTimeoutSec = DEFAULT_SIMULATION_STOP_TIMEOUT_SEC;
let simulationSchedulerTimer = null;
let simulationSettlingStartedAt = 0;
let simulationRuntimeInitialized = false;
let simulationRuntimeAutoResumeArmed = false;
let simulationTickInFlight = false;
let simulationImmediateTickTimer = null;
let simulationImmediateTickPending = false;
let simulationLastTickStartedAt = 0;
let simulationLastTickCompletedAt = 0;
let simulationLastCycleDecisionJournalAt = 0;
let simulationOpenManagedTradeCount = 0;
let simulationLastCycleDecisionSignature = '';
let simulationLatestDecisionCycle = null;
const simulationImmediateTickReasons = new Set();
const simulationImmediateTickChangedSymbols = new Set();
let simulationDecisionJournalQueue = Promise.resolve();
let mutationLockActive = false;
let mutationLockQueue = Promise.resolve();
let simulationSchedulerTestInputs = null;
let simulationSnapshotsForTests = null;
let simulationUniverseSymbols = null;
const intradayLiveCache = new Map();
const sharekhanDailyContextCache = new Map();
const sharekhanMarketDepthCache = new Map();
let intradayLiveRefreshTimer = null;
let intradayLiveRefreshInFlight = false;
let intradayLiveRefreshActive = false;
let simulationMarketCache = { fetchedAt: 0, indices: {} };
let simulationIndexPreviousCloseAnchors = { day:'', values:{} };
const schedulerMarketHistory = [];
let simulationMarketRefreshPromise = null;
let simulationMarketRefreshAttemptAt = 0;
let schedulerTickInputLogState = { signature:'', loggedAt:0 };
const schedulerPreviousCandidateBySymbol = new Map();
let sectorMetadataCache = { builtAt:0, bySymbol:new Map() };
let mobileSetupSnapshotCache = { loadedAt: 0, candidates: [] };
let mobileSetupPersistedAt = 0;
let simulationSymbolMetaCache = { builtAt: 0, bySymbol: new Map() };
let intradayDataSourceSettingsCache = { loadedAt: 0, value: null };

function appendSimulationDecisionJournal(event, payload = {}, at = new Date().toISOString()) {
  try {
    const day = getIstDateKey(at);
    const file = path.join(SIM_DECISION_JOURNAL_DIR, `simulation_decisions_${day}.jsonl`);
    const row = { schemaVersion:1, at, event:String(event || 'decision'), ...payload };
    const line = `${JSON.stringify(row)}\n`;
    simulationDecisionJournalQueue = simulationDecisionJournalQueue
      .then(async () => {
        await fs.promises.mkdir(SIM_DECISION_JOURNAL_DIR, { recursive: true });
        await fs.promises.appendFile(file, line, 'utf8');
      })
      .catch(e => {
        console.warn('[simulation-journal] Append failed:', e.message);
      });
  } catch (e) {
    console.warn('[simulation-journal] Append failed:', e.message);
  }
}

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
strategyAdvisorService = createStrategyAdvisorFileService({
  db:setupEfficiencyDb,
  setupEfficiencyService,
  exitQualityService,
  loadSnapshots:day => getSimulationSnapshotDatabase().loadDay(day),
  loadSettings:day => Backtest.loadSettings({ day }),
  loadSettingOverrides:() => loadTradeSettingsFile().overrides || {},
});

const VALID_BROKER_MODES = new Set(['zerodha_dry_run', 'zerodha_live', 'sharekhan_live']);

function loadBrokerModePreference() {
  try {
    const mode = String(kvGet('broker_mode') || '').toLowerCase();
    return VALID_BROKER_MODES.has(mode) ? mode : 'zerodha_dry_run';
  } catch (e) {
    console.warn('[broker-prefs] Could not load broker preferences:', e.message);
    return 'zerodha_dry_run';
  }
}

function saveBrokerModePreference(mode) {
  try {
    if (!VALID_BROKER_MODES.has(mode)) return false;
    kvSet('broker_mode', mode);
    return true;
  } catch (e) {
    console.warn('[broker-prefs] Could not save broker preferences:', e.message);
    return false;
  }
}

function setBrokerMode(mode) {
  const next = String(mode || '').toLowerCase();
  if (!VALID_BROKER_MODES.has(next)) return false;
  brokerMode = next;
  if (next === 'zerodha_live') zerodhaLiveFailureCount = 0;
  if (next === 'sharekhan_live') sharekhanLiveFailureCount = 0;
  saveBrokerModePreference(next);
  return true;
}

// Broker integrations
let brokerMode = 'zerodha_dry_run'; // initialized from DB after initDb() in initializeProxy()
let zerodhaCredentials = null;
let kiteClientLive = null;
let kiteClientDry = null;
let zerodhaConfirmationPoller = null;
let zerodhaLiveFailureCount = 0;
let zerodhaInitializeInFlight = null;
let sharekhanCredentials = null;
let sharekhanClientLive = null;
let sharekhanConfirmationPoller = null;
let sharekhanTicker = null;
let sharekhanIndexCodeMap = new Map();
let sharekhanLiveFailureCount = 0;
let sharekhanInitializeInFlight = null;

async function ensureZerodhaInitialized({ force = false } = {}) {
  if (!force && zerodhaCredentials && kiteClientLive && kiteClientDry) return true;
  if (zerodhaInitializeInFlight) return zerodhaInitializeInFlight;

  zerodhaInitializeInFlight = (async () => {
    console.log(`[zerodha] ${force ? 'Forced' : 'On-demand'} initialization requested.`);
    if (zerodhaConfirmationPoller) {
      try { zerodhaConfirmationPoller.stop(); } catch (_) {}
      zerodhaConfirmationPoller = null;
    }
    zerodhaCredentials = null;
    kiteClientLive = null;
    kiteClientDry = null;
    const initialized = await initializeZerodha();
    return !!initialized && !!zerodhaCredentials && !!kiteClientLive && !!kiteClientDry;
  })().finally(() => {
    zerodhaInitializeInFlight = null;
  });

  return zerodhaInitializeInFlight;
}

function isSharekhanAuthReloadError(err) {
  return /AUTH_FAILED_REFRESH_NEEDED|token|permission/i.test(String(err?.message || err || ''));
}

/** Returns true for permanent Zerodha IP-block errors that should not count toward the auto-fallback threshold. */
function isZerodhaIpBlockError(err) {
  return /is not allowed to place orders/i.test(String(err?.message || err || ''));
}

async function ensureSharekhanInitialized({ force = false } = {}) {
  if (!force && sharekhanCredentials && sharekhanClientLive) return true;
  if (sharekhanInitializeInFlight) return sharekhanInitializeInFlight;

  sharekhanInitializeInFlight = (async () => {
    console.log(`[sharekhan] ${force ? 'Forced' : 'On-demand'} initialization requested.`);
    if (sharekhanConfirmationPoller) {
      try { sharekhanConfirmationPoller.stop(); } catch (_) {}
      sharekhanConfirmationPoller = null;
    }
    if (sharekhanTicker) {
      try { if (sharekhanTicker._heartbeatTimer) clearInterval(sharekhanTicker._heartbeatTimer); sharekhanTicker.stop(); } catch (_) {}
      sharekhanTicker = null;
      sharekhanIndexCodeMap = new Map();
    }
    sharekhanCredentials = null;
    sharekhanClientLive = null;
    const initialized = await initializeSharekhan();
    return !!initialized && !!sharekhanCredentials && !!sharekhanClientLive;
  })().finally(() => {
    sharekhanInitializeInFlight = null;
  });

  return sharekhanInitializeInFlight;
}

async function withSharekhanCredentialReload(task) {
  try {
    if (!sharekhanCredentials || !sharekhanClientLive) {
      await ensureSharekhanInitialized({ force: true });
    }
    return await task();
  } catch (err) {
    if (!isSharekhanAuthReloadError(err)) throw err;
    console.warn('[sharekhan] Auth failed. Reloading credentials from file and retrying once.');
    const reloaded = await ensureSharekhanInitialized({ force: true });
    if (!reloaded) throw err;
    return task();
  }
}

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
  try { return getEtfSavedSymbols(); } catch (e) { return []; }
}
function saveSavedETFsFile(symbols) {
  try { setEtfSavedBulk(symbols); } catch (e) { console.warn('[proxy] Could not save ETF prefs:', e.message); }
}

function loadSavedStocksFile() {
  try { return getSavedStockSymbols(); } catch (e) { return []; }
}

let resultCalendarDashboardSymbolsCache = null;
function loadDashboardStockUniverse() {
  if (resultCalendarDashboardSymbolsCache) return resultCalendarDashboardSymbolsCache;
  try {
    const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
    const marker = 'let MIDCAP_STOCKS = [';
    const start = source.indexOf(marker);
    if (start < 0) return [];
    const arrayStart = source.indexOf('[', start);
    let depth = 0;
    let arrayEnd = -1;
    for (let i = arrayStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          arrayEnd = i + 1;
          break;
        }
      }
    }
    if (arrayStart < 0 || arrayEnd < 0) return [];
    const rows = Function(`"use strict"; return (${source.slice(arrayStart, arrayEnd)});`)();
    resultCalendarDashboardSymbolsCache = (Array.isArray(rows) ? rows : [])
      .map(row => ({
        sym:String(row?.sym || row?.symbol || '').trim().toUpperCase(),
        name:row?.name || row?.sym || row?.symbol || '',
        sector:row?.sector || null,
        cap:row?.cap || null,
      }))
      .filter(row => row.sym && String(row.cap || '').toLowerCase() !== 'etf');
    return resultCalendarDashboardSymbolsCache;
  } catch(e) {
    console.warn('[result-calendar] Could not load dashboard stock universe:', e.message);
    resultCalendarDashboardSymbolsCache = [];
    return resultCalendarDashboardSymbolsCache;
  }
}

function loadResultCalendarSymbols() {
  const bySymbol = new Map();
  for (const row of loadDashboardStockUniverse()) bySymbol.set(row.sym, row);
  for (const row of loadSavedStocksFile()) {
    const sym = String(row?.sym || row?.symbol || '').trim().toUpperCase();
    if (sym) bySymbol.set(sym, { ...row, sym });
  }
  return [...bySymbol.values()];
}

function saveSavedStocksFile(symbols) {
  try {
    if (!Array.isArray(symbols)) return;
    const rows = symbols.map(s => typeof s === 'string'
      ? { symbol: s, source: 'saved' }
      : { symbol: s.sym || s.symbol, name: s.name || null, sector: s.sector || null, cap: s.cap || null, source: 'saved' }
    ).filter(r => r.symbol);
    dbRememberSymbols(rows);
  } catch (e) { console.warn('[proxy] Could not save stock prefs:', e.message); }
}

// ── Fundamentals cache (per-symbol, 30d TTL) ────────────────────────────────
let fundCache = {};
function loadFundCache() {
  try {
    fundCache = jsonCacheGet('fund_cache') || {};
    const count = Object.keys(fundCache).length;
    if (count) console.log(`[fund-cache] Loaded ${count} cached fundamentals`);
  } catch(e) { console.warn('[fund-cache] Load error:', e.message); fundCache = {}; }
}
function saveFundCache() {
  try { jsonCacheSet('fund_cache', fundCache, FUND_CACHE_TTL); }
  catch(e) { console.warn('[fund-cache] Save error:', e.message); }
}

// ── ETF summary cache (1M return only, 24h TTL) ─────────────────────────────
let etfSumCache = {};
let etfCachesLoaded = false;
function loadEtfSumCache() {
  try {
    const raw = jsonCacheGet('etf_sum_cache') || {};
    const count = Object.keys(raw).length;
    const isCurrent = count === 0 || Object.values(raw).some(e => e.version === ETF_SUM_CACHE_VERSION);
    if (!isCurrent) {
      console.log('[etf-sum-cache] Old cache format detected — clearing');
      etfSumCache = {};
    } else {
      etfSumCache = raw;
      if (count) console.log(`[etf-sum-cache] Loaded ${count} cached 1M returns`);
    }
  } catch(e) { console.warn('[etf-sum-cache] Load error:', e.message); etfSumCache = {}; }
}
function saveEtfSumCache() {
  try { jsonCacheSet('etf_sum_cache', etfSumCache, ETF_1M_RETURN_TTL); }
  catch(e) { console.warn('[etf-sum-cache] Save error:', e.message); }
}

// ── ETF meta cache (static fields: TER, category, fundFamily, 1Y/3Y/5Y — 30d TTL) ──
let etfMetaCache = {};
function loadEtfMetaCache() {
  try {
    etfMetaCache = jsonCacheGet('etf_meta_cache') || {};
    const count = Object.keys(etfMetaCache).length;
    if (count) console.log(`[etf-meta-cache] Loaded ${count} static ETF records`);
  } catch(e) { console.warn('[etf-meta-cache] Load error:', e.message); etfMetaCache = {}; }
}
function ensureEtfCachesLoaded() {
  if (etfCachesLoaded) return;
  loadEtfSumCache();
  loadEtfMetaCache();
  etfCachesLoaded = true;
}
function saveEtfMetaCache() {
  try { jsonCacheSet('etf_meta_cache', etfMetaCache, ETF_META_TTL); }
  catch(e) { console.warn('[etf-meta-cache] Save error:', e.message); }
}

function getETFExpenseRatio(sym) {
  ensureEtfCachesLoaded();
  const key = String(sym || '').toUpperCase();
  return etfMetaCache[key]?.expenseRatio ?? STATIC_TER[key] ?? null;
}

// Returns a {sym → etfObject} map from DB
function loadEtfListDataMap() {
  const map = {};
  try { for (const e of listAllEtfs()) map[e.sym || e.symbol] = e; }
  catch(e) { console.warn('[etf-list-map] Load error:', e.message); }
  return map;
}

// ── NSE index membership cache (per-index, 24h TTL) ─────────────────────────
let nseIdxCache = {};
function loadNseIdxCache() {
  try {
    nseIdxCache = jsonCacheGet('nse_idx_cache') || {};
    const count = Object.keys(nseIdxCache).length;
    if (count) console.log(`[nse-idx-cache] Loaded ${count} cached index lists`);
  } catch(e) { console.warn('[nse-idx-cache] Load error:', e.message); nseIdxCache = {}; }
}
function saveNseIdxCache() {
  try { jsonCacheSet('nse_idx_cache', nseIdxCache, NSE_IDX_CACHE_TTL); }
  catch(e) { console.warn('[nse-idx-cache] Save error:', e.message); }
}

function loadSavedETFFavsFile() {
  try { return getEtfFavoriteSymbols(); } catch (e) { return []; }
}
function saveSavedETFFavsFile(symbols) {
  try { setEtfFavoriteBulk(symbols); }
  catch (e) { console.warn('[proxy] Could not save ETF favorites:', e.message); }
}

function loadSavedStockFavsFile() {
  try { return getStockFavoriteSymbols(); } catch (e) { return []; }
}
function saveSavedStockFavsFile(symbols) {
  try { setStockFavoriteBulk(Array.isArray(symbols) ? symbols : []); }
  catch (e) { console.warn('[proxy] Could not save stock favorites:', e.message); }
}

// ══════════════════════════════════════════════════════════
//  SHARED HELPER — HTTPS GET with auto-decompression
// ══════════════════════════════════════════════════
function defaultPaperPortfolio() {
  return { initialCapital: 500000, capitalAdds: [] };
}

const TRADE_ENTRY_OWNERS = new Set(['manual', 'simulation']);
const TRADE_EXIT_OWNERS = new Set(['manual', 'simulation']);
const TRADE_MANAGEMENT_STATES = new Set(['manual_only', 'simulation_managed', 'settling_managed']);

function getTradeOwnershipContext(runtimeState = null, settingsOverride = null) {
  const runtime = runtimeState || loadSimulationRuntime().state || 'off';
  const settings = settingsOverride && typeof settingsOverride === 'object'
    ? settingsOverride
    : (loadTradeSettingsFile().overrides || {});
  const manualAutoExits = !!settings.SIMULATION_AUTO_MANUAL_EXITS;
  return {
    runtimeState: runtime,
    manualAutoExits,
    runtimeActive: runtime === 'running' || runtime === 'settling',
  };
}

function normalizeTradeOwnership(trade, context = {}, options = {}) {
  if (!trade || typeof trade !== 'object') return trade;
  const applyTransitions = options.applyTransitions !== false;
  const status = String(trade.status || '').toLowerCase();
  const source = String(trade.source || '').toLowerCase();
  const inferredEntryOwner = source === 'simulation' ? 'simulation' : 'manual';
  const normalized = {
    ...trade,
    entryOwner: TRADE_ENTRY_OWNERS.has(trade.entryOwner) ? trade.entryOwner : inferredEntryOwner,
    exitOwner: TRADE_EXIT_OWNERS.has(trade.exitOwner) ? trade.exitOwner : inferredEntryOwner,
    managedBySimulation: typeof trade.managedBySimulation === 'boolean' ? trade.managedBySimulation : inferredEntryOwner === 'simulation',
    managementState: TRADE_MANAGEMENT_STATES.has(trade.managementState)
      ? trade.managementState
      : (inferredEntryOwner === 'simulation' ? 'simulation_managed' : 'manual_only'),
  };

  if (!applyTransitions || status !== 'open') return normalized;

  const runtimeState = context.runtimeState || 'off';
  const runtimeActive = context.runtimeActive === true || runtimeState === 'running' || runtimeState === 'settling';
  const manualAutoExits = !!context.manualAutoExits;
  const isManualOrigin = normalized.entryOwner === 'manual';

  if (isManualOrigin) {
    if (manualAutoExits && runtimeActive) {
      normalized.exitOwner = 'simulation';
      normalized.managedBySimulation = true;
      normalized.managementState = runtimeState === 'settling' ? 'settling_managed' : 'simulation_managed';
    } else {
      normalized.exitOwner = 'manual';
      normalized.managedBySimulation = false;
      normalized.managementState = 'manual_only';
    }
    return normalized;
  }

  normalized.exitOwner = 'simulation';
  normalized.managedBySimulation = true;
  normalized.managementState = runtimeState === 'settling' ? 'settling_managed' : 'simulation_managed';
  return normalized;
}

function normalizeTradeCollectionOwnership(trades, context = {}, options = {}) {
  const source = Array.isArray(trades) ? trades : [];
  return source.map(trade => normalizeTradeOwnership(trade, context, options));
}

function normalizePaperState(raw) {
  const sourceTrades = Array.isArray(raw) ? raw : (Array.isArray(raw?.trades) ? raw.trades : []);
  const ownershipContext = getTradeOwnershipContext();
  const trades = normalizeTradeCollectionOwnership(sourceTrades, ownershipContext);
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

function loadPaperStateFile({ asOf = null, includeAll = false, date = null } = {}) {
  try {
    if (proxyDbReady) {
      const allTrades = listTrades();
      const dbPortfolio = loadPortfolioState() || defaultPaperPortfolio();

      // Load open trades + same-day closed trades (keeps SSE payload small).
      // asOf allows the scheduler to pass its tick time for accurate day-stats.
      // All-time realized P&L is pre-aggregated separately via computeAllTimeRealizedPnl()
      const dayKey = date || (asOf ? toIstDayKey(asOf) : getIstDateKey());
      const filteredTrades = includeAll
        ? allTrades
        : allTrades.filter(t => {
            if (!date && String(t.status || '').toLowerCase() === 'open') return true;
            if (date) {
              const openedDate = toIstDayKey(t.openedAt || '');
              const closedDate = toIstDayKey(t.closedAt || '');
              return openedDate === dayKey || closedDate === dayKey;
            }
            const tradeDate = toIstDayKey(t.closedAt || t.openedAt || '');
            return tradeDate === dayKey;
          });
      const ownershipContext = getTradeOwnershipContext();
      const normalized = normalizeTradeCollectionOwnership(filteredTrades, ownershipContext);

      // Check if any ownership normalization changes need flushing back to DB
      for (let i = 0; i < filteredTrades.length; i++) {
        if (JSON.stringify(filteredTrades[i]) !== JSON.stringify(normalized[i])) {
          try { saveTrade(normalized[i]); } catch (e) { console.warn('[paper-trades] Ownership flush failed:', e.message); }
        }
      }

      // Portfolio includes pre-aggregated all-time realized P&L
      const realizedPnl = computeAllTimeRealizedPnl();
      return {
        savedAt: Date.now(),
        portfolio: { ...dbPortfolio, realizedPnl },
        trades: normalized,
      };
    }

    // Fallback: JSON file for tests (proxyDbReady=false, PAPER_TRADES_FILE set via env)
    const testFile = process.env.PAPER_TRADES_FILE;
    if (!testFile) {
      return { savedAt: Date.now(), portfolio: defaultPaperPortfolio(), trades: [] };
    }
    if (!fs.existsSync(testFile)) {
      fs.writeFileSync(testFile, JSON.stringify({ savedAt: Date.now(), portfolio: defaultPaperPortfolio(), trades: [] }, null, 2), 'utf8');
    }
    const raw = JSON.parse(fs.readFileSync(testFile, 'utf8') || '{}');
    const sourceTrades = Array.isArray(raw) ? raw : (Array.isArray(raw?.trades) ? raw.trades : []);
    const normalized2 = normalizePaperState(raw);
    if (JSON.stringify(sourceTrades) !== JSON.stringify(normalized2.trades)) {
      fs.writeFileSync(testFile, JSON.stringify({ savedAt: Date.now(), portfolio: normalized2.portfolio, trades: normalized2.trades }, null, 2), 'utf8');
    }
    return normalized2;
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
    if (proxyDbReady) {
      for (const trade of next.trades) {
        try { saveTrade(trade); } catch (e) { console.warn('[paper-trades] Save trade failed:', trade?.id, e.message); }
      }
      try {
        const realizedPnl = computeAllTimeRealizedPnl();
        savePortfolioState({ ...next.portfolio, realizedPnl });
      } catch (e) { console.warn('[paper-trades] Save portfolio state failed:', e.message); }
      return;
    }
    // JSON fallback for tests (proxyDbReady=false, PAPER_TRADES_FILE set via env)
    if (process.env.PAPER_TRADES_FILE) {
      fs.writeFileSync(process.env.PAPER_TRADES_FILE, JSON.stringify({ savedAt: Date.now(), portfolio: next.portfolio, trades: next.trades }, null, 2), 'utf8');
    }
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

// ─────────────────────────────────────────────────────────────────
// SQLite Persistence Functions for ticker_proxy
// ─────────────────────────────────────────────────────────────────

/**
 * Remember a trade by persisting it to SQLite.
 * @param {Object} trade - Trade object with id, symbol, qty, status, etc.
 */
function rememberTrade(trade) {
  if (!trade || typeof trade !== 'object') {
    return;
  }
  try {
    saveTrade(trade);
  } catch (e) {
    console.warn('[ticker-proxy] Error saving trade to sqlite:', e.message);
  }
}

/**
 * Remember symbols by persisting them to SQLite along with script codes.
 * @param {Array} symbols - Array of symbol objects with symbol, name, sector, cap, etc.
 */
function rememberSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    return;
  }
  try {
    // Persist symbols to the symbols table
    dbRememberSymbols(symbols);

    // Extract sharekhan codes if present and upsert them
    const scripCodes = symbols
      .filter(s => s && s.symbol && s.sharekhan_code !== undefined)
      .map(s => ({ symbol: s.symbol, sharekhan_code: s.sharekhan_code }));

    if (scripCodes.length > 0) {
      upsertScripCodes(scripCodes, 'sharekhan');
    }

    // Handle other broker codes if present
    const nseCodesArray = symbols
      .filter(s => s && s.symbol && s.nse_code !== undefined)
      .map(s => ({ symbol: s.symbol, nse_code: s.nse_code }));

    if (nseCodesArray.length > 0) {
      upsertScripCodes(nseCodesArray, 'nse');
    }

    const zerodhaCodesArray = symbols
      .filter(s => s && s.symbol && s.zerodha_token !== undefined)
      .map(s => ({ symbol: s.symbol, zerodha_token: s.zerodha_token }));

    if (zerodhaCodesArray.length > 0) {
      upsertScripCodes(zerodhaCodesArray, 'zerodha');
    }

    const yahooCodesArray = symbols
      .filter(s => s && s.symbol && s.yahoo_symbol !== undefined)
      .map(s => ({ symbol: s.symbol, yahoo_symbol: s.yahoo_symbol }));

    if (yahooCodesArray.length > 0) {
      upsertScripCodes(yahooCodesArray, 'yahoo');
    }
  } catch (e) {
    console.warn('[ticker-proxy] Error saving symbols to sqlite:', e.message);
  }
}

/**
 * Load cached news from SQLite by symbol and date.
 * @param {string} symbol - Stock symbol
 * @param {string} date - Date string (e.g., '2024-01-15')
 * @returns {Array|null} Array of news articles or null if not found/expired
 */
function loadCachedNews(symbol, date) {
  if (!symbol || !date) {
    return null;
  }
  try {
    return getFreshNews(symbol, date);
  } catch (e) {
    console.warn('[ticker-proxy] Error loading cached news from sqlite:', e.message);
    return null;
  }
}

function writeSseEvent(res, data) {
  try {
    if (!res || res.writableEnded || res.destroyed) return false;
    return res.write(`data: ${JSON.stringify(data)}\n\n`) !== false;
  } catch (_) {
    return false;
  }
}

function buildPaperTradeStreamPayload(reason = 'update') {
  const state = loadPaperStateFile();
  return {
    ok: true,
    reason,
    ...state,
    dayPnl: proxyDbReady ? getDayPnl() : {},
    simulationRuntime: getSimulationRuntimeStatus(),
    sentAt: Date.now(),
  };
}

function broadcastPaperTradeState(reason = 'update') {
  if (!paperTradeStreamClients.size) return;
  const payload = buildPaperTradeStreamPayload(reason);
  for (const client of [...paperTradeStreamClients]) {
    const ok = writeSseEvent(client.res, payload);
    if (!ok) {
      if (client.keepAlive) clearInterval(client.keepAlive);
      paperTradeStreamClients.delete(client);
    }
  }
}

function runWithMutationLock(work) {
  const execution = mutationLockQueue.then(async () => {
    mutationLockActive = true;
    try {
      return await work();
    } finally {
      mutationLockActive = false;
    }
  });
  mutationLockQueue = execution.catch(() => {});
  return execution;
}

function loadSimulationRuntime() {
  return loadRuntimeState(SIMULATION_RUNTIME_FILE);
}

function saveSimulationRuntime(update) {
  return saveRuntimeState(SIMULATION_RUNTIME_FILE, update);
}

function transitionAndSaveSimulationRuntime(action, extras = {}) {
  const current = loadSimulationRuntime();
  const transitioned = transitionRuntimeState(current, action);
  return saveSimulationRuntime({ ...transitioned, ...extras });
}

function countOpenTradeOwnership(trades) {
  const openTrades = (Array.isArray(trades) ? trades : []).filter(trade => trade?.status === 'open');
  const openSimulationManagedCount = openTrades.filter(trade => trade?.managedBySimulation === true).length;
  return {
    openSimulationManagedCount,
    openManualManagedCount: Math.max(0, openTrades.length - openSimulationManagedCount),
  };
}

function isLikelyUnconfirmedLiveOrderError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('econnaborted') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('no response from server') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset');
}

function getEntrySnapshotContext(candidate, tickInput, atIso, settings = {}) {
  const snapshotAt = candidate?.__snapshotAt || candidate?.entryContext?.snapshotAt || tickInput?.snapshotAt || tickInput?.at || atIso;
  const snapshotId = candidate?.__snapshotId || candidate?.entryContext?.snapshotId || tickInput?.snapshotId || '';
  const snapshotSource = candidate?.__snapshotSource || candidate?.entryContext?.snapshotSource || tickInput?.snapshotSource || '';
  const atMs = new Date(atIso || Date.now()).getTime();
  const snapMs = new Date(snapshotAt || 0).getTime();
  const ageMin = Number.isFinite(atMs) && Number.isFinite(snapMs) && snapMs > 0
    ? +Math.max(0, (atMs - snapMs) / 60000).toFixed(2)
    : null;
  const maxAgeMin = Math.max(0, Number(settings.SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN) || 0);
  return { snapshotId, snapshotAt, snapshotSource, ageMin, maxAgeMin };
}

async function closeTradeFromExitIntent(trade, intent, atIso) {
  const exitPrice = Number(intent?.exitPrice);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return false;

  // For live broker trades, place an exit order before mutating local state.
  if (trade.broker?.mode === 'live' && trade.broker?.status === 'confirmed' && trade.broker?.orderId) {
    try {
      if (trade.broker.name === 'zerodha' && kiteClientLive) {
        const exitOrder = buildZerodhaDryRunOrder({ ...trade, exitPrice }, trade, 'exit');
        const exitOrderId = await kiteClientLive.placeOrder(exitOrder);
        trade.broker.exitOrderId = exitOrderId;
        trade.broker.status = 'exit_placed';
        trade.broker.exitPlacedAt = atIso;
        trade.pendingExit = { reason:intent?.reason || 'Simulation exit', requestedPrice:exitPrice, qty:Number(trade.qty), placedAt:atIso };
        trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
        trade.broker.audit.push({ at: atIso, event: 'simulation_exit_placed', exitOrderId, reason: intent?.reason });
        console.log(`[sim-exit] Zerodha exit order placed: ${exitOrderId} for ${trade.symbol}`);
      } else if (trade.broker.name === 'sharekhan' && sharekhanClientLive) {
        const exitOrder = buildSharekhanLiveOrder({ ...trade, exitPrice }, trade, 'exit', trade.broker.scripCode);
        if (exitOrder) {
          const exitOrderId = await withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(exitOrder));
          trade.broker.exitOrderId = exitOrderId;
          trade.broker.status = 'exit_placed';
          trade.broker.exitPlacedAt = atIso;
          trade.pendingExit = { reason:intent?.reason || 'Simulation exit', requestedPrice:exitPrice, qty:Number(trade.qty), placedAt:atIso };
          trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
          trade.broker.audit.push({ at: atIso, event: 'simulation_exit_placed', exitOrderId, reason: intent?.reason });
          console.log(`[sim-exit] Sharekhan exit order placed: ${exitOrderId} for ${trade.symbol}`);
        }
      }
    } catch (e) {
      console.error(`[sim-exit] Broker exit order failed for ${trade.symbol}:`, e.message);
      trade.broker.status = 'exit_failed';
      trade.broker.error = e.message;
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: atIso, event: 'simulation_exit_failed', error: e.message, reason: intent?.reason });
      // Leave the trade open — broker order failed, manual reconciliation needed.
      return false;
    }
  }

  if (trade.broker?.mode === 'live' && trade.broker?.status === 'exit_placed') {
    appendSimulationDecisionJournal('exit_order_placed', { tradeId:trade.id, symbol:trade.symbol, intent, orderId:trade.broker.exitOrderId }, atIso);
    return true;
  }

  const effectiveExitPrice = SimulationEngine.applyAdverseSlippage(exitPrice, trade.side, 'exit', loadTradeSettingsFile().overrides || {});
  const pnl = computePaperTradePnl(trade, effectiveExitPrice);
  Object.assign(trade, {
    status: 'closed',
    exitPrice: +effectiveExitPrice.toFixed(2),
    closedAt: atIso,
    closeReason: intent?.reason || 'Simulation exit',
    pnl: pnl.pnl,
    pnlPct: pnl.pnlPct,
    grossPnl: pnl.grossPnl,
    charges: pnl.charges,
    chargeBreakup: pnl.chargeBreakup,
    exitState: {
      exitPrice:+effectiveExitPrice.toFixed(2),
      closedAt:atIso,
      reason:intent?.reason || 'Simulation exit',
      dayClosePrice:null,
      benchmarkStatus:'pending',
    },
    exitOwner: 'simulation',
    managedBySimulation: true,
    managementState: trade?.managementState === 'settling_managed' ? 'settling_managed' : 'simulation_managed',
  });
  return true;
}

async function partialCloseTradeFromExitIntent(trades, trade, intent, atIso) {
  const requestedQty = Math.max(1, Math.floor(Number(trade.qty) * Number(intent?.qtyPct || 50) / 100));
  if (requestedQty >= Number(trade.qty)) return closeTradeFromExitIntent(trade, { ...intent, action:'close' }, atIso);
  const requestedPrice = Number(intent?.exitPrice);
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) return false;
  const isLive = trade.broker?.mode === 'live' && trade.broker?.status === 'confirmed' && trade.broker?.orderId;
  if (isLive) {
    try {
      let exitOrderId = null;
      if (trade.broker.name === 'zerodha' && kiteClientLive) {
        exitOrderId = await kiteClientLive.placeOrder(buildZerodhaDryRunOrder({ ...trade, qty:requestedQty, exitPrice:requestedPrice }, trade, 'exit'));
      } else if (trade.broker.name === 'sharekhan' && sharekhanClientLive) {
        const order = buildSharekhanLiveOrder({ ...trade, qty:requestedQty, exitPrice:requestedPrice }, trade, 'exit', trade.broker.scripCode);
        if (order) exitOrderId = await withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(order));
      }
      if (!exitOrderId) return false;
      trade.broker.exitOrderId = exitOrderId;
      trade.broker.exitPlacedAt = atIso;
      trade.broker.status = 'exit_placed';
      trade.pendingPartialExit = { qty:requestedQty, reason:intent.reason, requestedPrice, runner:!!intent.runner, newTarget:intent.newTarget, protectRemainder:!!intent.protectRemainder, placedAt:atIso };
      appendSimulationDecisionJournal('partial_exit_order_placed', { tradeId:trade.id, symbol:trade.symbol, intent, orderId:exitOrderId }, atIso);
      return true;
    } catch (e) {
      console.error(`[sim-exit] Partial exit order failed for ${trade.symbol}:`, e.message);
      return false;
    }
  }
  const fill = SimulationEngine.applyAdverseSlippage(requestedPrice, trade.side, 'exit', loadTradeSettingsFile().overrides || {});
  const partial = {
    ...trade,
    id:`${trade.id}-partial-${Date.now()}`,
    parentId:trade.id,
    status:'closed',
    qty:requestedQty,
    exitPrice:fill,
    closedAt:atIso,
    closeReason:intent.reason,
    exitState:{
      exitPrice:+Number(fill).toFixed(2),
      closedAt:atIso,
      reason:intent.reason || 'Simulation partial exit',
      dayClosePrice:null,
      benchmarkStatus:'pending',
    },
  };
  const pnl = computePaperTradePnl(partial, fill);
  Object.assign(partial, { pnl:pnl.pnl, pnlPct:pnl.pnlPct, grossPnl:pnl.grossPnl, charges:pnl.charges, chargeBreakup:pnl.chargeBreakup });
  trade.qty -= requestedQty;
  trade.reservedCapital = +(Number(trade.entryPrice) * trade.qty).toFixed(2);
  trade._partialTargetBooked = true;
  trade._runnerArmed = true;
  trade._runnerWideTrail = !!intent.runner;
  if (Number.isFinite(Number(intent.newTarget))) trade.target = +Number(intent.newTarget).toFixed(2);
  if (intent.protectRemainder) {
    if (String(trade.side || '').toLowerCase() === 'sell') trade._shortProfitLockArmed = true;
    else trade._longProfitLockArmed = true;
  }
  trade.partialExits = [...(trade.partialExits || []), { id:partial.id, qty:requestedQty, exitPrice:fill, closedAt:atIso, reason:intent.reason, pnl:pnl.pnl }];
  trades.unshift(partial);
  appendSimulationDecisionJournal('partial_exit_filled', { tradeId:trade.id, partialId:partial.id, symbol:trade.symbol, qty:requestedQty, fillPrice:fill }, atIso);
  return true;
}

async function openTradeFromEntryIntent(trades, intent, atIso) {
  const symbol = String(intent?.symbol || '').trim().toUpperCase();
  const side = String(intent?.side || 'buy').toLowerCase();
  const qty = Math.floor(Number(intent?.qty || 1));
  const observedEntryPrice = Number(intent?.price ?? intent?.entryPrice);
  const liveEntry = brokerMode === 'zerodha_live' || brokerMode === 'sharekhan_live';
  const entryPrice = liveEntry ? observedEntryPrice : SimulationEngine.applyAdverseSlippage(observedEntryPrice, side, 'entry', loadTradeSettingsFile().overrides || {});
  if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) return false;
  if (trades.some(trade => trade?.status === 'open' && String(trade?.symbol || '').toUpperCase() === symbol)) return false;

  const trade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'open',
    symbol,
    name: String(intent?.name || symbol),
    side,
    qty,
    entryPrice: +entryPrice.toFixed(2),
    target: Number.isFinite(Number(intent?.target)) ? +Number(intent.target).toFixed(2) : null,
    stop: Number.isFinite(Number(intent?.stop)) ? +Number(intent.stop).toFixed(2) : null,
    signal: intent?.signal || null,
    score: Number.isFinite(Number(intent?.score)) ? Number(intent.score) : null,
    decisionScore: Number.isFinite(Number(intent?.decisionScore)) ? Number(intent.decisionScore) : null,
    rr: Number.isFinite(Number(intent?.rr)) ? Number(intent.rr) : null,
    reservedCapital: +(entryPrice * qty).toFixed(2),
    portfolioInitial: null,
    source: 'simulation',
    entryOwner: 'simulation',
    exitOwner: 'simulation',
    managedBySimulation: true,
    managementState: 'simulation_managed',
    assetType: intent?.assetType === 'etf' ? 'etf' : 'stock',
    setupType: intent?.setupType || null,
    setup: intent?.setup || null,
    entryContext: intent?.entryContext && typeof intent.entryContext === 'object' ? intent.entryContext : null,
    entrySnapshotId: intent?.entryContext?.snapshotId || intent?.snapshotId || null,
    entrySnapshotAt: intent?.entryContext?.snapshotAt || intent?.snapshotAt || null,
    entrySnapshotAgeMin: Number.isFinite(Number(intent?.entryContext?.snapshotAgeMin ?? intent?.snapshotAgeMin))
      ? Number(intent?.entryContext?.snapshotAgeMin ?? intent?.snapshotAgeMin)
      : null,
    notes: intent?.notes || '',
    openedAt: atIso,
    executionMode: brokerMode,
    costProfile:brokerMode.startsWith('sharekhan') ? 'sharekhan_intraday' : 'zerodha_intraday',
    sector:intent?.sector || '',
    _momentumRunnerFullQty:String(intent?.setupType || '').toUpperCase() === 'MOMENTUM_RUNNER'
      ? Math.max(qty, Math.floor(Number(intent?.entryContext?.plannedFullQty) || qty))
      : undefined,
    _momentumRunnerInitialQty:String(intent?.setupType || '').toUpperCase() === 'MOMENTUM_RUNNER' ? qty : undefined,
  };

  // Place live broker order if active
  if (brokerMode === 'zerodha_live' && (kiteClientLive || await ensureZerodhaInitialized({ force: false }))) {
    try {
      const liveOrder = buildZerodhaDryRunOrder({ ...intent, symbol, side, qty, entryPrice, assetType: trade.assetType }, null, 'entry');
      const orderId = await kiteClientLive.placeOrder(liveOrder);
      trade.broker = {
        name: 'zerodha',
        mode: 'live',
        orderId,
        status: 'pending',
        createdAt: atIso,
        confirmedAt: null,
        confirmationAttempts: 0,
        confirmationError: null,
        exitPlan: { target: trade.target, stop: trade.stop, squareOff: 'intraday simulation managed exit' },
        audit: [{ at: atIso, event: 'live_order_placed', orderId, elapsed: 0, attempts: 1 }],
      };
      zerodhaLiveFailureCount = 0;
      console.log(`[sim-entry] Zerodha live order placed: ${orderId} for ${symbol}`);
    } catch (e) {
      if (!isZerodhaIpBlockError(e)) zerodhaLiveFailureCount++;
      console.error(`[sim-entry] Zerodha live order failed (${zerodhaLiveFailureCount}):`, e.message);
      if (zerodhaLiveFailureCount >= 3) {
        console.warn('[sim-entry] Too many failures. Falling back to Zerodha dry-run mode.');
        setBrokerMode('zerodha_dry_run');
      }
      // Fall through — record as dry-run so trade is tracked locally
      if (isLikelyUnconfirmedLiveOrderError(e)) {
        console.warn(`[sim-entry] Zerodha entry for ${symbol} not recorded locally because broker response was inconclusive. Check broker order book before retrying.`);
        return false;
      }
      const dryOrder = buildZerodhaDryRunOrder({ ...intent, symbol, side, qty, entryPrice, assetType: trade.assetType }, null, 'entry');
      trade.broker = { name: 'zerodha', mode: 'dry-run', status: 'entry_dry_run', entryOrder: dryOrder, audit: [{ at: atIso, event: 'live_order_failed', error: e.message }] };
      trade.executionMode = 'zerodha_dry_run';
    }
  } else if (brokerMode === 'sharekhan_live' && (sharekhanClientLive || await ensureSharekhanInitialized({ force: false }))) {
    try {
      const scripCode = await sharekhanClientLive.getScripCode(symbol);
      const liveOrder = buildSharekhanLiveOrder({ ...intent, symbol, side, qty, entryPrice, assetType: trade.assetType }, null, 'entry', scripCode);
      if (!liveOrder) throw new Error('Unable to build Sharekhan entry order');
      const orderId = await withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(liveOrder));
      trade.broker = {
        name: 'sharekhan',
        mode: 'live',
        orderId,
        scripCode,
        status: 'pending',
        createdAt: atIso,
        confirmedAt: null,
        confirmationAttempts: 0,
        confirmationError: null,
        exitPlan: { target: trade.target, stop: trade.stop, squareOff: 'intraday simulation managed exit' },
        audit: [{ at: atIso, event: 'live_order_placed', orderId, elapsed: 0, attempts: 1 }],
      };
      sharekhanLiveFailureCount = 0;
      console.log(`[sim-entry] Sharekhan live order placed: ${orderId} for ${symbol}`);
    } catch (e) {
      sharekhanLiveFailureCount++;
      console.error(`[sim-entry] Sharekhan live order failed (${sharekhanLiveFailureCount}):`, e.message);
      if (sharekhanLiveFailureCount >= 3) {
        console.warn('[sim-entry] Too many failures. Falling back to Zerodha dry-run mode.');
        setBrokerMode('zerodha_dry_run');
      }
      if (isLikelyUnconfirmedLiveOrderError(e)) {
        console.warn(`[sim-entry] Sharekhan entry for ${symbol} not recorded locally because broker response was inconclusive. Check broker order book before retrying.`);
        return false;
      }
      trade.executionMode = 'zerodha_dry_run';
    }
  } else if (brokerMode === 'zerodha_dry_run') {
    const dryOrder = buildZerodhaDryRunOrder({ ...intent, symbol, side, qty, entryPrice, assetType: trade.assetType }, null, 'entry');
    trade.broker = { name: 'zerodha', mode: 'dry-run', status: 'entry_dry_run', entryOrder: dryOrder, audit: [{ at: atIso, event: 'entry_dry_run_created' }] };
  }

  trades.unshift(trade);
  return true;
}

function readSchedulerTickInput() {
  throw new Error('readSchedulerTickInput has been replaced by async readSchedulerTickInputAsync');
}

function loadSimulationUniverseState() {
  try { return getSimulationSymbols(); }
  catch (error) { console.warn('[simulation-universe] Load error:', error.message); return []; }
}

function saveSimulationUniverseState(symbols) {
  try {
    const normalized = [...new Set((Array.isArray(symbols) ? symbols : [])
      .map(sym => String(sym || '').trim().toUpperCase())
      .filter(sym => /^[A-Z0-9_.-]+$/.test(sym)))];
    dbSaveSimulationSymbols(normalized);
    return normalized;
  } catch (error) {
    console.warn('[simulation-universe] Save error:', error.message);
    return [];
  }
}

function getSimulationUniverseSymbols() {
  if (!simulationUniverseSymbols) {
    simulationUniverseSymbols = new Set(loadSimulationUniverseState());
  }
  return simulationUniverseSymbols;
}

function getSavedEtfSymbolsForSimulation() {
  return loadSavedETFsFile()
    .map(item => String(typeof item === 'string' ? item : (item?.sym || item?.symbol || '')).trim().toUpperCase())
    .filter(sym => /^[A-Z0-9_.-]+$/.test(sym));
}

function getIntradayLiveUniverseSymbols() {
  return new Set([...getSimulationUniverseSymbols(), ...getSavedEtfSymbolsForSimulation()]);
}

async function scaleInMomentumRunnerFromIntent(trade, intent, atIso) {
  if (!trade || !intent || trade.status !== 'open' || trade._momentumRunnerScaledIn) return false;
  if (trade.broker?.mode === 'live') {
    if (!trade._momentumRunnerScaleInLiveBlocked) {
      trade._momentumRunnerScaleInLiveBlocked = true;
      appendSimulationDecisionJournal('scale_in_blocked_live_order_safety', {
        tradeId:trade.id,
        symbol:trade.symbol,
        requestedQty:intent.qty,
      }, atIso);
    }
    return false;
  }
  const addQty = Math.max(0, Math.floor(Number(intent.qty) || 0));
  const observedPrice = Number(intent.price);
  if (addQty <= 0 || !Number.isFinite(observedPrice) || observedPrice <= 0) return false;
  const settings = loadTradeSettingsFile().overrides || {};
  const fill = SimulationEngine.applyAdverseSlippage(observedPrice, trade.side, 'entry', settings);
  const oldQty = Math.max(0, Math.floor(Number(trade.qty) || 0));
  const oldEntry = Number(trade.entryPrice);
  if (oldQty <= 0 || !Number.isFinite(oldEntry) || oldEntry <= 0) return false;
  const newQty = oldQty + addQty;
  const weightedEntry = ((oldEntry * oldQty) + (fill * addQty)) / newQty;
  const stopPct = Math.max(0.1, Number(TradeRules.withDefaults(settings).SIMULATION_RUNNER_INITIAL_STOP_PCT) || 0.8);

  trade.qty = newQty;
  trade.entryPrice = +weightedEntry.toFixed(2);
  trade.reservedCapital = +(trade.entryPrice * newQty).toFixed(2);
  trade.stop = +(String(trade.side || 'buy').toLowerCase() === 'sell'
    ? trade.entryPrice * (1 + stopPct / 100)
    : trade.entryPrice * (1 - stopPct / 100)).toFixed(2);
  trade._momentumRunnerScaledIn = true;
  trade._momentumRunnerFullQty = Math.max(newQty, Math.floor(Number(intent.plannedFullQty) || newQty));
  trade.scaleIns = [...(trade.scaleIns || []), {
    qty:addQty,
    price:+fill.toFixed(2),
    at:atIso,
    reason:intent.reason,
    maxFavorablePct:intent.maxFavorablePct,
    vwap:intent.vwap,
    trigger:intent.trigger,
  }];
  appendSimulationDecisionJournal('momentum_runner_scale_in_filled', {
    tradeId:trade.id,
    symbol:trade.symbol,
    qty:addQty,
    fillPrice:+fill.toFixed(2),
    weightedEntry:trade.entryPrice,
    stop:trade.stop,
    maxFavorablePct:intent.maxFavorablePct,
  }, atIso);
  return true;
}

function isEtfSimulationSymbol(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return false;
  const meta = getSimulationSymbolMetaIndex().get(sym) || {};
  return String(meta.assetType || '').toLowerCase() === 'etf'
    || String(meta.cap || '').toLowerCase() === 'etf';
}

const SHAREKHAN_EXTRA_TICKER_SYMBOLS = Object.freeze(['63MOONS']);

function getSharekhanStockUniverseSymbols() {
  return [...new Set([
    ...getSimulationUniverseSymbols(),
    ...SHAREKHAN_EXTRA_TICKER_SYMBOLS,
  ])].filter(sym => !isEtfSimulationSymbol(sym));
}

function rememberSimulationUniverse(symbols = []) {
  const universe = getSimulationUniverseSymbols();
  let changed = false;
  for (const raw of symbols) {
    const sym = String(raw || '').trim().toUpperCase();
    if (!sym || !/^[A-Z0-9_.-]+$/.test(sym)) continue;
    if (!universe.has(sym)) {
      universe.add(sym);
      changed = true;
    }
  }
  if (changed) {
    saveSimulationUniverseState([...universe]);
    startIntradayLiveRefresh('universe-update');
    refreshIntradayLiveCache('universe-update').catch(() => {});
    // Subscribe newly added symbols to the Sharekhan ticker
    if (sharekhanTicker && sharekhanClientLive) {
      const addedSyms = symbols
        .map(s => String(s || '').trim().toUpperCase())
        .filter(sym => sym && universe.has(sym) && !isEtfSimulationSymbol(sym));
      if (addedSyms.length) {
        Promise.all(addedSyms.map(sym =>
          sharekhanClientLive.getScripCode(sym).then(code => ({ sym, code })).catch(() => null)
        )).then(results => {
          const valid = results.filter(r => r && r.code > 0);
          const codes = valid.map(r => r.code);
          if (codes.length) sharekhanTicker.subscribe(codes, new Map(valid.map(r => [r.code, r.sym])));
        }).catch(() => {});
      }
    }
  }
}

function buildDefaultIntradaySignal(sym, reason = 'Signal unavailable') {
  return {
    symbol: sym,
    signal: 'hold',
    score: 0,
    target: null,
    stop: null,
    entryStatus: 'Wait',
    entryTrigger: 'Signal unavailable',
    setupType: 'NO_SIGNAL',
    setup: 'Signal unavailable',
    reasons: ['Signal unavailable'],
    stale: true,
    fetchFailed: true,
    staleReason: reason,
  };
}

function normalizeIntradayLiveSignal(sym, payload) {
  if (payload && typeof payload === 'object') {
    if (!payload._updatedAt) payload._updatedAt = Date.now();
    return payload;
  }
  return buildDefaultIntradaySignal(sym);
}

function buildIntradaySignalMaterialSignature(signal) {
  if (!signal || typeof signal !== 'object') return '';
  return JSON.stringify({
    signal: signal.signal || '',
    score: Number(signal.score) || 0,
    price: Number(signal.price) || 0,
    entryStatus: signal.entryStatus || '',
    entryPrice: Number(signal.entryPrice) || 0,
    target: Number(signal.target) || 0,
    stop: Number(signal.stop) || 0,
    dayChange: Number(signal.dayChange) || 0,
    stale: !!signal.stale || !!signal.fetchFailed || !!signal.freshness?.stale,
    staleReason: signal.staleReason || signal.freshness?.reason || '',
    priceTimeMs: Number(signal.priceTimeMs) || 0,
    dataSource: signal.dataSource || signal.freshness?.dataSource || '',
    depthSpreadPct: Number.isFinite(Number(signal.marketDepth?.spreadPct)) ? +Number(signal.marketDepth.spreadPct).toFixed(4) : null,
    depthImbalance: Number.isFinite(Number(signal.marketDepth?.imbalance)) ? +Number(signal.marketDepth.imbalance).toFixed(4) : null,
    depthCapturedAtMs: Number(signal.marketDepth?.capturedAtMs) || 0,
  });
}

function hasIntradaySignalMaterialChange(prev, next) {
  if (!prev || !next) return true;
  return buildIntradaySignalMaterialSignature(prev) !== buildIntradaySignalMaterialSignature(next);
}

function isIstWeekend(now = Date.now()) {
  const d = new Date(new Date(now).getTime() + 5.5 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function getIntradayLiveRefreshIntervalSec(now = Date.now()) {
  const d = new Date(new Date(now).getTime() + 5.5 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC;
  if (isIstWeekend(now)) return INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC;
  const hhmm = d.getUTCHours() * 100 + d.getUTCMinutes();
  const marketOpen = hhmm >= 915 && hhmm < 1530;
  return marketOpen ? INTRADAY_LIVE_REFRESH_MARKET_SEC : INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC;
}

function buildIntradayLiveData(symbolList = null) {
  const symbols = Array.isArray(symbolList)
    ? new Set(symbolList.map(sym => String(sym || '').trim().toUpperCase()).filter(Boolean))
    : null;
  const overrides = loadTradeSettingsFile().overrides || {};
  const settings = SimulationEngine.withDefaults ? SimulationEngine.withDefaults(overrides) : overrides;
  const data = {};
  for (const [sym, setup] of intradayLiveCache.entries()) {
    if (symbols && !symbols.has(sym)) continue;
    const setupType = deriveLiveSetupType(sym, setup, settings);
    data[sym] = { ...setup, setupType, derivedSetupType:setupType };
  }
  return data;
}

function deriveLiveSetupType(sym, setup = {}, settings = null) {
  const existing = String(setup?.derivedSetupType || setup?.setupType || '').trim().toUpperCase();
  if (existing && existing !== 'NO_SIGNAL') return existing;
  // Match the browser setup cards: setup direction is derived from strategy
  // score, not the looser quote-level watch/hold label.
  const score = Number(setup?.score) || 0;
  const signal = SimulationEngine.adjustedTradeSignal(score);
  const candidate = {
    symbol:String(sym || '').toUpperCase(),
    price:Number(setup?.price) || 0,
    score,
    signal,
    side:signal,
    indicators:{ ...setup },
    quote:{ price:Number(setup?.price) || 0, change:Number(setup?.dayChange) || 0 },
  };
  try {
    return SimulationEngine.deriveSetupType(candidate, settings || {}, setup?.priceTime || setup?.savedAt || Date.now()) || 'NO_SIGNAL';
  } catch (_) {
    return 'NO_SIGNAL';
  }
}

function buildStoredAppPriceMap(symbols = []) {
  const requested = new Set((Array.isArray(symbols) ? symbols : [])
    .map(symbol => String(symbol || '').trim().toUpperCase())
    .filter(Boolean));
  const prices = new Map();
  const assignPrice = (sym, value, source) => {
    if (!sym || prices.has(sym)) return;
    const price = Number(value?.price ?? value?.lastPrice ?? value?.ltp ?? value?.LTP ?? value?.priceAtSnapshot ?? value?.quote?.price ?? value?.quote?.lastPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const close = Number(value?.prevClose ?? value?.previousClose ?? value?.close ?? value?.closePrice ?? value?.quote?.prevClose ?? value?.quote?.previousClose ?? value?.quote?.close);
    prices.set(sym, {
      price,
      prevClose: Number.isFinite(close) && close > 0 ? close : null,
      source,
    });
  };

  for (const sym of requested) {
    assignPrice(sym, intradayLiveCache.get(sym), 'intraday-live-cache');
  }
  if (requested.size && [...requested].every(sym => prices.has(sym))) return prices;

  const snapshots = loadLatestSimulationSnapshots();
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const candidates = Array.isArray(snapshots[i]?.candidates) ? snapshots[i].candidates : [];
    for (const candidate of candidates) {
      const sym = String(candidate?.symbol || '').trim().toUpperCase();
      if (!sym || (requested.size && !requested.has(sym))) continue;
      assignPrice(sym, candidate, 'simulation-snapshot');
      if (requested.size && [...requested].every(symbol => prices.has(symbol))) return prices;
    }
  }
  return prices;
}

function loadLatestSimulationSnapshots() {
  if (Array.isArray(simulationSnapshotsForTests)) {
    return pruneSimulationSnapshots(simulationSnapshotsForTests).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  }
  try {
    const store = getSimulationSnapshotDatabase();
    const latestDay = store.latestDay();
    if (latestDay) {
      const snapshots = store.loadDay(latestDay);
      if (snapshots.length) return pruneSimulationSnapshots(snapshots);
    }
  } catch (e) {
    console.warn('[simulation-snapshots] Latest database load error:', e.message);
  }
  return [];
}

function markSseBackpressure(client) {
  if (!client || client.backpressured || client.res?.writableEnded || client.res?.destroyed) return;
  client.backpressured = true;
  client.res.once('drain', () => { client.backpressured = false; });
}

function flushIntradayLiveBroadcast() {
  intradayBroadcastTimer = null;
  const reason = intradayBroadcastReason;
  const changedSymbols = intradayBroadcastAllSymbols ? null : [...intradayBroadcastChangedSymbols];
  intradayBroadcastReason = 'update';
  intradayBroadcastAllSymbols = false;
  intradayBroadcastChangedSymbols.clear();

  const overview = { ok:true, reason, at:Date.now(), sectorTrend:buildSectorTrendFromCache(), indices:simulationMarketCache.indices || {} };
  for (const client of [...marketOverviewStreamClients]) {
    if (client.res?.writableEnded || client.res?.destroyed) {
      if (client.keepAlive) clearInterval(client.keepAlive);
      marketOverviewStreamClients.delete(client);
      continue;
    }
    if (client.backpressured) continue;
    if (!writeSseEvent(client.res, overview)) markSseBackpressure(client);
  }
  if (!intradayLiveStreamClients.size) return;
  for (const client of [...intradayLiveStreamClients]) {
    if (client.res?.writableEnded || client.res?.destroyed) {
      if (client.keepAlive) clearInterval(client.keepAlive);
      intradayLiveStreamClients.delete(client);
      continue;
    }
    if (client.backpressured) continue;
    const symbolFilter = client.symbols ? [...client.symbols] : null;
    const payload = {
      ok: true,
      reason,
      at: Date.now(),
      data: buildIntradayLiveData(symbolFilter),
      changedSymbols: Array.isArray(changedSymbols) ? changedSymbols : undefined,
      sectorTrend: buildSectorTrendFromCache(),
    };
    const ok = writeSseEvent(client.res, payload);
    if (!ok) markSseBackpressure(client);
  }
}

function broadcastIntradayLive(reason = 'update', changedSymbols = null) {
  intradayBroadcastReason = reason || intradayBroadcastReason;
  if (Array.isArray(changedSymbols)) {
    for (const symbol of changedSymbols) {
      const normalized = String(symbol || '').trim().toUpperCase();
      if (normalized) intradayBroadcastChangedSymbols.add(normalized);
    }
  } else {
    intradayBroadcastAllSymbols = true;
  }
  if (intradayBroadcastTimer) return;
  // Coalesce tick bursts so a 300-symbol Sharekhan update produces one current
  // stream payload instead of hundreds of obsolete payloads queued in memory.
  intradayBroadcastTimer = setTimeout(flushIntradayLiveBroadcast, 250);
  if (typeof intradayBroadcastTimer.unref === 'function') intradayBroadcastTimer.unref();
}

function schedulePendingSimulationTick() {
  if (!simulationImmediateTickPending || simulationImmediateTickTimer || simulationTickInFlight) return;
  const lastTickBoundary = simulationLastTickCompletedAt || simulationLastTickStartedAt;
  const elapsedMs = lastTickBoundary > 0 ? Date.now() - lastTickBoundary : Number.POSITIVE_INFINITY;
  const minimumIntervalMs = simulationOpenManagedTradeCount > 0
    ? SIMULATION_ACTIVE_TICK_MIN_INTERVAL_MS
    : SIMULATION_IDLE_TICK_MIN_INTERVAL_MS;
  const delayMs = Math.max(0, minimumIntervalMs - elapsedMs);
  simulationImmediateTickTimer = setTimeout(async () => {
    simulationImmediateTickTimer = null;
    if (!simulationImmediateTickPending || simulationTickInFlight) return;
    simulationImmediateTickPending = false;
    const reasons = [...simulationImmediateTickReasons];
    const changedSymbols = [...simulationImmediateTickChangedSymbols];
    simulationImmediateTickReasons.clear();
    simulationImmediateTickChangedSymbols.clear();
    try {
      await runSimulationSchedulerTick();
    } catch (e) {
      console.warn(`[simulation-runtime] Coalesced tick after ${reasons.join(',') || 'score-update'} failed:`, e.message);
    } finally {
      // Updates received while the tick was in flight remain pending and get one
      // follow-up cycle after the same minimum interval.
      schedulePendingSimulationTick();
    }
  }, delayMs);
  if (typeof simulationImmediateTickTimer.unref === 'function') simulationImmediateTickTimer.unref();
}

function triggerSimulationTickAfterScoreUpdate(reason = 'score-update', changedSymbols = []) {
  if (isIstWeekend()) return;
  const runtime = loadSimulationRuntime();
  if (runtime.state !== 'running' && runtime.state !== 'settling') return;
  simulationImmediateTickPending = true;
  if (reason) simulationImmediateTickReasons.add(String(reason));
  for (const symbol of Array.isArray(changedSymbols) ? changedSymbols : []) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (normalized) simulationImmediateTickChangedSymbols.add(normalized);
  }
  schedulePendingSimulationTick();
}

function scheduleIntradayLiveRefresh(reason = 'interval') {
  if (!intradayLiveRefreshActive) return;
  if (!getIntradayLiveUniverseSymbols().size) return;
  if (intradayLiveRefreshTimer) clearTimeout(intradayLiveRefreshTimer);
  const delaySec = getIntradayLiveRefreshIntervalSec();
  intradayLiveRefreshTimer = setTimeout(async () => {
    intradayLiveRefreshTimer = null;
    await refreshIntradayLiveCache(reason).catch(() => {});
    scheduleIntradayLiveRefresh('interval');
  }, Math.max(1, delaySec) * 1000);
  if (typeof intradayLiveRefreshTimer.unref === 'function') intradayLiveRefreshTimer.unref();
}

async function refreshIntradayLiveCache(reason = 'interval') {
  const allowOffHoursWarmup = reason === 'market-overview-client' || reason === 'universe-update';
  if (isIstWeekend() && !allowOffHoursWarmup) {
    return { ok: true, skipped: true, reason: 'weekend-cache-only' };
  }
  if (intradayLiveRefreshInFlight) return;
  const sources = getIntradayDataSourceSettings();
  const symbols = [...getIntradayLiveUniverseSymbols()];
  if (!symbols.length) return;
  intradayLiveRefreshInFlight = true;
  try {
    const allChanged = [];
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const chunk = symbols.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(sym => fetchIntradaySignal(sym, {
        sources,
      })));
      const chunkChanged = [];
      for (let idx = 0; idx < settled.length; idx += 1) {
        const sym = chunk[idx];
        const nextValue = settled[idx].status === 'fulfilled'
          ? normalizeIntradayLiveSignal(sym, settled[idx].value)
          : buildDefaultIntradaySignal(sym, settled[idx].reason?.message || 'Intraday fetch failed');
        const prev = intradayLiveCache.get(sym);
        intradayLiveCache.set(sym, nextValue);
        if (hasIntradaySignalMaterialChange(prev, nextValue)) {
          chunkChanged.push(sym);
        }
      }
      if (chunkChanged.length) {
        allChanged.push(...chunkChanged);
        broadcastIntradayLive(reason, chunkChanged); // broadcast each chunk immediately
        triggerSimulationTickAfterScoreUpdate(reason, chunkChanged);
      }
    }
    const marketHeartbeat = getIntradayLiveRefreshIntervalSec() === INTRADAY_LIVE_REFRESH_MARKET_SEC;
    if (allChanged.length || marketHeartbeat) {
      persistServerSimulationSnapshot(allChanged.length ? reason : 'market-heartbeat', allChanged).catch(e => {
        console.warn('[simulation-snapshots] Server snapshot persist failed:', e.message);
      }); // persist once after all chunks
    }
    return { ok: true, changedCount: allChanged.length };
  } finally {
    intradayLiveRefreshInFlight = false;
  }
}

function getIntradayDataSourceSettings() {
  const now = Date.now();
  if (intradayDataSourceSettingsCache.value && now - intradayDataSourceSettingsCache.loadedAt < 1000) {
    return intradayDataSourceSettingsCache.value;
  }
  const overrides = loadTradeSettingsFile().overrides || {};
  const yahoo = overrides.INTRADAY_SOURCE_YAHOO !== false;
  const sharekhan = overrides.INTRADAY_SOURCE_SHAREKHAN !== false;
  // Invalid persisted state is treated as Yahoo-only so intraday data never goes dark.
  const value = yahoo || sharekhan ? { yahoo, sharekhan } : { yahoo: true, sharekhan: false };
  intradayDataSourceSettingsCache = { loadedAt: now, value };
  return value;
}

function startIntradayLiveRefresh(reason = 'manual-start') {
  if (intradayLiveRefreshActive) return;
  if (!getSimulationUniverseSymbols().size) return;
  intradayLiveRefreshActive = true;
  scheduleIntradayLiveRefresh('interval');
  console.log(`[intraday-live] Refresh started (${reason}); cadence=${INTRADAY_LIVE_REFRESH_MARKET_SEC}s market / ${INTRADAY_LIVE_REFRESH_OFF_HOURS_SEC}s off-hours`);
}

function stopIntradayLiveRefresh(reason = 'manual-stop') {
  intradayLiveRefreshActive = false;
  if (intradayLiveRefreshTimer) {
    clearTimeout(intradayLiveRefreshTimer);
    intradayLiveRefreshTimer = null;
  }
  console.log(`[intraday-live] Refresh stopped (${reason})`);
}

function getSimulationSymbolMetaIndex() {
  const now = Date.now();
  if (simulationSymbolMetaCache.bySymbol instanceof Map && now - simulationSymbolMetaCache.builtAt < SIMULATION_SYMBOL_META_CACHE_TTL_MS) {
    return simulationSymbolMetaCache.bySymbol;
  }
  const bySymbol = new Map();
  const assignMeta = (symbol, name, sector, cap, assetType = null) => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    const existing = bySymbol.get(sym) || {};
    bySymbol.set(sym, {
      name: existing.name || (name ? String(name) : sym),
      sector: existing.sector || (sector ? String(sector) : ''),
      cap: existing.cap || (cap ? String(cap) : ''),
      assetType: existing.assetType || (assetType ? String(assetType) : ''),
    });
  };

  for (const item of loadSavedStocksFile()) {
    if (item && typeof item === 'object') assignMeta(item.sym || item.symbol, item.name, item.sector, item.cap);
  }
  for (const item of loadDashboardStockUniverse()) {
    if (item && typeof item === 'object') assignMeta(item.sym || item.symbol, item.name, item.sector, item.cap, 'stock');
  }
  for (const item of loadSavedETFsFile()) {
    if (typeof item === 'string') assignMeta(item, item, 'ETF', 'etf', 'etf');
    else if (item && typeof item === 'object') assignMeta(item.sym || item.symbol, item.name, item.sector || 'ETF', item.cap || 'etf', 'etf');
  }
  // Also include all ETFs from the master DB — not just user-saved ones
  try {
    for (const item of listAllEtfs()) {
      if (item && typeof item === 'object') assignMeta(item.sym || item.symbol, item.name, item.sector || 'ETF', item.cap || 'etf', 'etf');
    }
  } catch (_) {}

  // Do not scan retained replay snapshots here. Candle-rich archives expand to
  // gigabytes and this function runs on the live startup path before Sharekhan
  // subscriptions are built. DB/dashboard metadata covers the active universe;
  // unknown custom symbols safely use the caller's stock defaults.

  simulationSymbolMetaCache = { builtAt: now, bySymbol };
  return bySymbol;
}

function getIstClockParts(value = Date.now()) {
  const d = new Date(new Date(value).getTime() + 5.5 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return { day: null, mins: null };
  return { day: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function isSimulationEntryWindowTime(value = Date.now()) {
  return TradeRules.isSimulationEntryWindow(value, loadTradeSettingsFile().overrides || {});
}

function isSimulationEodSettlementTime(value = Date.now()) {
  return TradeRules.isSimulationEodSettlement(value, loadTradeSettingsFile().overrides || {});
}

function shouldAutoStopSimulation(value = Date.now()) {
  return TradeRules.shouldAutoStopSimulation(value, loadTradeSettingsFile().overrides || {});
}

function toIstDayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

function sameIstDay(a, b) {
  const left = toIstDayKey(a);
  const right = toIstDayKey(b);
  return !!left && !!right && left === right;
}

function buildSectorTrendFromCandidates(candidates = []) {
  const changesBySector = {};
  let anonymousIndex = 0;
  for (const candidate of candidates) {
    const sector = String(candidate?.sector || '').trim();
    if (!sector) continue;
    if (candidate?.freshness?.stale || candidate?.stale || candidate?.fetchFailed) continue;
    const rawPrice = candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price ?? candidate?.indicators?.price;
    if (rawPrice != null && !(Number.isFinite(Number(rawPrice)) && Number(rawPrice) > 0)) continue;
    const change = Number(candidate?.quote?.change ?? candidate?.change ?? candidate?.indicators?.dayChange);
    if (!Number.isFinite(change)) continue;
    if (!changesBySector[sector]) changesBySector[sector] = new Map();
    const symbol = String(candidate?.symbol || '').trim().toUpperCase();
    changesBySector[sector].set(symbol || `__anonymous_${anonymousIndex++}`, change);
  }
  const sectorTrend = {};
  for (const [sector, changeMap] of Object.entries(changesBySector)) {
    const changes = [...changeMap.values()];
    if (!changes.length) continue;
    sectorTrend[sector] = +(changes.reduce((sum, value) => sum + value, 0) / changes.length).toFixed(3);
  }
  return sectorTrend;
}

function buildSectorTrendFromCache() {
  const now = Date.now();
  if (!(sectorMetadataCache.bySymbol instanceof Map) || now - sectorMetadataCache.builtAt > 5 * 60 * 1000) {
    const bySymbol = new Map();
    for (const item of [...loadDashboardStockUniverse(), ...loadSavedStocksFile()]) {
      const symbol = String(item?.sym || item?.symbol || '').toUpperCase();
      if (symbol) bySymbol.set(symbol, item);
    }
    sectorMetadataCache = { builtAt:now, bySymbol };
  }
  const enriched = [...intradayLiveCache.entries()].map(([symbol, value]) => ({
    ...value,
    sector:value?.sector || sectorMetadataCache.bySymbol.get(symbol)?.sector || '',
    quote:{ change:value?.dayChange ?? value?.quote?.change },
  }));
  let trend = buildSectorTrendFromCandidates(enriched);
  if (!Object.keys(trend).length) {
    try {
      const persisted = kvGet('mobile_setup_cache');
      trend = buildSectorTrendFromCandidates(Array.isArray(persisted?.candidates) ? persisted.candidates : []);
    } catch (_) {}
  }
  return trend;
}

function hasUsableMarketIndices(indices) {
  if (!indices || typeof indices !== 'object') return false;
  const nifty = Number(indices?.nifty50?.change ?? indices?.nifty?.change);
  return Number.isFinite(nifty);
}

function getSharekhanConfiguredNiftyCode() {
  const raw = process.env.SHAREKHAN_NIFTY_SCRIP_CODE ||
    process.env.SHAREKHAN_NIFTY50_SCRIP_CODE ||
    process.env.NIFTY_SHAREKHAN_SCRIP_CODE ||
    sharekhanCredentials?.niftyScripCode ||
    '';
  const code = Number(String(raw).trim());
  return Number.isFinite(code) && code > 0 ? code : 0;
}

function getSharekhanConfiguredMidcap150Code() {
  const raw = process.env.SHAREKHAN_MIDCAP150_SCRIP_CODE ||
    process.env.SHAREKHAN_NIFTY_MIDCAP150_SCRIP_CODE ||
    process.env.MIDCAP150_SHAREKHAN_SCRIP_CODE ||
    sharekhanCredentials?.midcap150ScripCode ||
    '';
  const code = Number(String(raw).trim());
  return Number.isFinite(code) && code > 0 ? code : 0;
}

function getSharekhanConfiguredSmallcap100Code() {
  const raw = process.env.SHAREKHAN_SMALLCAP100_SCRIP_CODE ||
    process.env.SHAREKHAN_NIFTY_SMALLCAP100_SCRIP_CODE ||
    process.env.SMALLCAP100_SHAREKHAN_SCRIP_CODE ||
    sharekhanCredentials?.smallcap100ScripCode || '';
  const code = Number(String(raw).trim());
  return Number.isFinite(code) && code > 0 ? code : 0;
}

function getSharekhanConfiguredBankNiftyCode() {
  const raw = process.env.SHAREKHAN_BANKNIFTY_SCRIP_CODE ||
    process.env.SHAREKHAN_NIFTY_BANK_SCRIP_CODE ||
    process.env.BANKNIFTY_SHAREKHAN_SCRIP_CODE ||
    sharekhanCredentials?.bankNiftyScripCode || '';
  const code = Number(String(raw).trim());
  return Number.isFinite(code) && code > 0 ? code : 0;
}

async function getSharekhanIndexSubscriptions(client) {
  if (!client) return new Map();
  const indexMap = new Map();
  const definitions = [
    {
      key:'nifty50',
      configuredCode:getSharekhanConfiguredNiftyCode(),
      candidates:['NIFTY', 'NIFTY50', 'NIFTY 50'],
    },
    {
      key:'midcap',
      configuredCode:getSharekhanConfiguredMidcap150Code(),
      candidates:['NIFTY MIDCAP 150', 'NIFTYMIDCAP150', 'MIDCAP150', 'NIFTY MIDCAP150'],
    },
    {
      key:'smallcap',
      configuredCode:getSharekhanConfiguredSmallcap100Code(),
      candidates:['NIFTYSML100FREE', 'NIFTY SMALLCAP 100', 'NIFTY SMLCAP 100', 'NIFTYSMALLCAP100', 'SMALLCAP100'],
    },
    {
      key:'banknifty',
      configuredCode:getSharekhanConfiguredBankNiftyCode(),
      candidates:['NIFTYBANK', 'NIFTY BANK', 'BANKNIFTY', 'BANK NIFTY'],
    },
  ];
  for (const definition of definitions) {
    if (definition.configuredCode) {
      indexMap.set(definition.configuredCode, definition.key);
      continue;
    }
    for (const symbol of definition.candidates) {
      const resolver = client.resolveStreamingScripCode || client.resolveScripCode;
      const code = await resolver?.call(client, symbol, 'NC').catch(() => 0);
      if (Number(code) > 0) {
        indexMap.set(Number(code), definition.key);
        break;
      }
    }
  }
  return indexMap;
}

function pickTickNumber(tick, keys) {
  for (const key of keys) {
    const value = Number(tick?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function resolveValidatedSharekhanIndexChange(indexKey, tick, price, existing = {}, peerIndices = {}) {
  const direct = pickTickNumber(tick, ['changePercent', 'percentChange', 'pChange', 'perChange']);
  const tickPrevClose = pickTickNumber(tick, ['previousClose', 'prevClose', 'closePrice', 'closedPrice']);
  const cachedPrevClose = Number(existing.previousClose);
  const prevClose = Number.isFinite(tickPrevClose) && tickPrevClose > 0 ? tickPrevClose : cachedPrevClose;
  const derived = Number.isFinite(prevClose) && prevClose > 0
    ? ((price - prevClose) / prevClose) * 100
    : null;
  let candidate = Number.isFinite(derived) ? derived : direct;
  let reason = '';
  if (Number.isFinite(direct) && Number.isFinite(derived) && Math.abs(direct - derived) > 0.75) {
    candidate = derived;
    reason = 'direct percentage disagrees with price/previous-close change';
  }
  const existingPrice = Number(existing.price);
  const existingChange = Number(existing.change);
  if (!Number.isFinite(derived) && Number.isFinite(existingPrice) && existingPrice > 0 && Number.isFinite(existingChange)) {
    const anchorPrevClose = existingPrice / (1 + existingChange / 100);
    const anchoredChange = anchorPrevClose > 0 ? ((price - anchorPrevClose) / anchorPrevClose) * 100 : null;
    if (Number.isFinite(anchoredChange)) {
      if (!Number.isFinite(direct)) {
        // Sharekhan index ticks commonly contain only LTP. The previous cached
        // price/change pair gives us a stable previous-close anchor, so keep the
        // percentage current instead of freezing it and warning on every tick.
        candidate = anchoredChange;
      } else if (Math.abs(direct - anchoredChange) > 0.75) {
        candidate = anchoredChange;
        reason = 'direct percentage disagrees with cached price/change anchor';
      }
    }
  }
  if (!Number.isFinite(candidate) && Number.isFinite(existingChange)) {
    candidate = existingChange;
    reason = 'tick omitted a trustworthy percentage change; retained cached change';
  }
  const peerChanges = Object.entries(peerIndices || {})
    .filter(([key]) => key !== indexKey)
    .map(([, value]) => Number(value?.change))
    .filter(Number.isFinite);
  const peerAverage = peerChanges.length ? peerChanges.reduce((sum, value) => sum + value, 0) / peerChanges.length : null;
  if (Number.isFinite(candidate) && Number.isFinite(peerAverage) && Math.abs(candidate) >= 1.25 && Math.abs(peerAverage) >= 0.3 && Math.sign(candidate) !== Math.sign(peerAverage)) {
    if (Number.isFinite(existingChange)) {
      candidate = existingChange;
      reason = 'index percentage conflicts with cached peer-index direction';
    } else {
      candidate = null;
      reason = 'index percentage conflicts with peer-index direction';
    }
  }
  if (Number.isFinite(candidate) && Math.abs(candidate) > 10) {
    candidate = Number.isFinite(existingChange) ? existingChange : null;
    reason = 'implausible index percentage move';
  }
  return { change: Number.isFinite(candidate) ? +candidate.toFixed(3) : null, reason };
}

function reanchorSharekhanIndices(freshIndices = {}, cachedIndices = {}) {
  const merged = { ...freshIndices };
  for (const [indexKey, fresh] of Object.entries(freshIndices || {})) {
    const cached = cachedIndices?.[indexKey];
    if (!cached || cached.source !== 'sharekhan-ws') continue;
    const freshPrice = Number(fresh?.price);
    const freshChange = Number(fresh?.change);
    const cachedPrice = Number(cached?.price);
    const explicitPreviousClose = Number(fresh?.previousClose);
    const previousClose = Number.isFinite(explicitPreviousClose) && explicitPreviousClose > 0
      ? explicitPreviousClose
      : (Number.isFinite(freshPrice) && freshPrice > 0 && Number.isFinite(freshChange)
        ? freshPrice / (1 + freshChange / 100)
        : null);
    const reanchoredChange = Number.isFinite(previousClose) && previousClose > 0
      && Number.isFinite(cachedPrice) && cachedPrice > 0
      ? ((cachedPrice - previousClose) / previousClose) * 100
      : freshChange;
    merged[indexKey] = {
      ...fresh,
      ...cached,
      price:Number.isFinite(cachedPrice) && cachedPrice > 0 ? +cachedPrice.toFixed(2) : fresh.price,
      change:Number.isFinite(reanchoredChange) ? +reanchoredChange.toFixed(3) : fresh.change,
      previousClose:Number.isFinite(previousClose) ? +previousClose.toFixed(2) : fresh.previousClose,
      source:'sharekhan-ws',
      changeValidation:null,
    };
  }
  return merged;
}

function applyFrozenIndexPreviousCloses(indices = {}, at = Date.now()) {
  const day = getIstDateKey(at);
  if (simulationIndexPreviousCloseAnchors.day !== day) {
    simulationIndexPreviousCloseAnchors = { day, values:{} };
  }
  const out = {};
  for (const [indexKey, value] of Object.entries(indices || {})) {
    const proposed = Number(value?.previousClose);
    const existingAnchor = Number(simulationIndexPreviousCloseAnchors.values[indexKey]);
    if (!Number.isFinite(existingAnchor) && Number.isFinite(proposed) && proposed > 0) {
      simulationIndexPreviousCloseAnchors.values[indexKey] = proposed;
    }
    const anchor = Number(simulationIndexPreviousCloseAnchors.values[indexKey]);
    const rejected = Number.isFinite(anchor) && Number.isFinite(proposed) && proposed > 0 &&
      Math.abs(proposed - anchor) / anchor * 100 > 0.01;
    const price = Number(value?.price);
    const change = Number.isFinite(anchor) && anchor > 0 && Number.isFinite(price) && price > 0
      ? ((price - anchor) / anchor) * 100
      : Number(value?.change);
    out[indexKey] = {
      ...value,
      previousClose:Number.isFinite(anchor) && anchor > 0 ? +anchor.toFixed(2) : value?.previousClose,
      previousCloseSessionDate:day,
      change:Number.isFinite(change) ? +change.toFixed(3) : value?.change,
      changeValidation:rejected
        ? `rejected mid-session previous close ${proposed}; frozen at ${anchor}`
        : (value?.changeValidation || null),
    };
  }
  return out;
}

function updateSimulationIndexFromSharekhanTick(indexKey, tick) {
  const price = pickTickNumber(tick, ['ltp', 'lastPrice', 'price']);
  if (!Number.isFinite(price) || price <= 0) return false;
  const previous = simulationMarketCache.indices || {};
  const existing = previous[indexKey] || {};
  const proposedPreviousClose = pickTickNumber(tick, ['previousClose', 'prevClose', 'closePrice', 'closedPrice']);
  const frozen = applyFrozenIndexPreviousCloses({
    [indexKey]:{
      ...existing,
      price,
      previousClose:Number.isFinite(proposedPreviousClose) && proposedPreviousClose > 0
        ? proposedPreviousClose
        : existing.previousClose,
    },
  });
  const anchored = frozen[indexKey] || existing;
  const validated = resolveValidatedSharekhanIndexChange(
    indexKey,
    { ...tick, previousClose:anchored.previousClose },
    price,
    anchored,
    { ...previous, [indexKey]:anchored }
  );
  const change = Number.isFinite(Number(anchored.change)) ? Number(anchored.change) : validated.change;
  const anchorRejected = String(anchored.changeValidation || '').startsWith('rejected mid-session previous close');
  if (validated.reason) {
    console.warn(`[market-cache] ${indexKey} Sharekhan change corrected: ${validated.reason}`);
  }
  simulationMarketCache = {
    // fetchedAt tracks when the previous-close anchor was refreshed, not when
    // an LTP arrived. Advancing it on every tick prevents the Yahoo anchor from
    // ever refreshing after a pre-market server start.
    fetchedAt: simulationMarketCache.fetchedAt,
    indices: {
      ...previous,
      [indexKey]: {
        ...existing,
        price:+price.toFixed(2),
        change:Number.isFinite(change) ? +Number(change).toFixed(3) : existing.change,
        previousClose:anchored.previousClose,
        previousCloseSessionDate:anchored.previousCloseSessionDate,
        source:'sharekhan-ws',
        changeValidation:anchorRejected ? anchored.changeValidation : (validated.reason || null),
        updatedAt:new Date().toISOString(),
      },
    },
  };
  return true;
}

function refreshSimulationMarketContextIfStale() {
  const now = Date.now();
  if (hasUsableMarketIndices(simulationMarketCache.indices)
      && now - simulationMarketCache.fetchedAt < SIMULATION_MARKET_CACHE_TTL_MS) {
    return simulationMarketRefreshPromise || Promise.resolve({ indices:simulationMarketCache.indices });
  }
  if (simulationMarketRefreshPromise) return simulationMarketRefreshPromise;
  if (now - simulationMarketRefreshAttemptAt < SIMULATION_MARKET_CACHE_TTL_MS) {
    return Promise.resolve({ indices:simulationMarketCache.indices || {} });
  }
  simulationMarketRefreshAttemptAt = now;
  simulationMarketRefreshPromise = getSimulationMarketContext()
    .then(market => {
      broadcastIntradayLive('index-anchor-refresh', []);
      return market;
    })
    .catch(e => {
      console.warn('[market-cache] Background anchor refresh failed:', e.message);
      return { indices:simulationMarketCache.indices || {} };
    })
    .finally(() => { simulationMarketRefreshPromise = null; });
  return simulationMarketRefreshPromise;
}

function handleSharekhanTickerTick(tick) {
  const code = Number(tick?.scripCode);
  const symbol = sharekhanTicker?.getSymbol(code);
  if (symbol) {
    const marketDepth = normalizeSharekhanMarketDepth(tick);
    if (marketDepth) sharekhanMarketDepthCache.set(symbol, marketDepth);
  }
  const indexKey = sharekhanIndexCodeMap.get(code);
  if (!indexKey) return;
  if (updateSimulationIndexFromSharekhanTick(indexKey, tick)) {
    // Index ticks do not pass through the stock-candle update path. Publish the
    // refreshed cache explicitly so mobile/desktop index percentages move live.
    broadcastIntradayLive(`sharekhan-${indexKey}-tick`, []);
    refreshSimulationMarketContextIfStale();
  }
}

async function getSimulationMarketContext() {
  const now = Date.now();
  if (hasUsableMarketIndices(simulationMarketCache.indices) && now - simulationMarketCache.fetchedAt < SIMULATION_MARKET_CACHE_TTL_MS) {
    return { indices: simulationMarketCache.indices };
  }
  try {
    const indices = await yahooIndices();
    if (hasUsableMarketIndices(indices)) {
      const reanchored = reanchorSharekhanIndices(indices, simulationMarketCache.indices);
      const anchored = applyFrozenIndexPreviousCloses(reanchored, now);
      simulationMarketCache = { fetchedAt: now, indices:anchored };
      return { indices:anchored };
    }
    console.warn('[market-cache] Ignoring empty index context for simulation regime checks');
  } catch (e) { console.warn('[market-cache] Context fetch failed:', e.message); }
  return { indices: hasUsableMarketIndices(simulationMarketCache.indices) ? simulationMarketCache.indices : {} };
}

function buildServerCandidateFromIntraday(sym, setup, settings, meta = null, asOf = null) {
  if (!setup || typeof setup !== 'object') return null;
  const signal = String(setup.signal || '').toLowerCase();
  const defaultSide = signal === 'buy' || signal === 'sell' ? signal : null;
  const asOfTime = asOf || setup?.savedAt || setup?.priceTime || Date.now();
  const dayChangePct = Number(setup.dayChangePercent ?? setup.dayChangePct ?? setup.dayChange);
  const highProfitShortTrigger = !defaultSide && TradeRules.checkHighProfitShortTrigger(dayChangePct, asOfTime, settings);
  const side = highProfitShortTrigger ? 'sell' : defaultSide;
  const price = Number(setup.price);
  const target = Number(setup.target);
  const stop = Number(setup.stop);
  const targetPct = Number.isFinite(price) && Number.isFinite(target) && price > 0 ? Math.abs(target - price) / price * 100 : 0;
  const charges = SimulationEngine.estimateZerodhaIntradayCharges(price, target, 1, side || 'buy');
  const slippagePct = 0.06;
  const netPct = targetPct - (Number(charges.totalPct) || 0) - slippagePct;
  const stopPct = Number.isFinite(price) && Number.isFinite(stop) && price > 0
    ? Math.abs(stop - price) / price * 100
    : Number(setup.stopPct);
  const minShortScore = Number(settings.SIMULATION_SHORT_MIN_SCORE) || Number(settings.SIMULATION_MIN_SCORE) || 0;
  const rawScore = Number(setup.score) || 0;
  const score = highProfitShortTrigger && Math.abs(rawScore) < minShortScore
    ? -minShortScore
    : rawScore;
  // Persist the latest and preceding validated bars so live and replay entry
  // confirmation can distinguish a completed breakout candle from the open bar.
  const compactCandidateBar = bar => bar && bar.time != null && bar.time !== ''
    && Number.isFinite(new Date(bar.time).getTime())
    && ['open', 'high', 'low', 'close'].every(key => Number.isFinite(Number(bar[key])) && Number(bar[key]) > 0)
    && Number(bar.high) >= Math.max(Number(bar.open), Number(bar.close))
    && Number(bar.low) <= Math.min(Number(bar.open), Number(bar.close))
    ? {
        time: new Date(bar.time).toISOString(),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number.isFinite(Number(bar.volume)) ? Math.max(0, Number(bar.volume)) : null,
      }
    : null;
  const compactPreviousCandle = compactCandidateBar(setup?.ohlc?.previousBar);
  const compactCandle = compactCandidateBar(setup?.ohlc?.latestBar);
  const compactCandles = (Array.isArray(setup?.ohlc?.recentBars) && setup.ohlc.recentBars.length
    ? setup.ohlc.recentBars
    : [compactPreviousCandle, compactCandle])
    .map(compactCandidateBar)
    .filter(Boolean)
    .sort((left, right) => new Date(left.time) - new Date(right.time));

  // Compute cache age and data source for freshness tracking
  const asOfMs = asOf ? new Date(asOf).getTime() : Date.now();
  const updatedAtMs = Number(setup._updatedAt) || 0;
  const cacheAgeMs = updatedAtMs > 0 ? Math.max(0, asOfMs - updatedAtMs) : null;
  const cacheAgeMin = cacheAgeMs != null ? +(cacheAgeMs / 60000).toFixed(1) : null;
  const dataSource = String(setup.dataSource || 'unknown');
  const ageStale = cacheAgeMin != null && cacheAgeMin > (LIVE_CACHE_STALE_AGE_MS / 60000);

  const candidate = {
    symbol: sym,
    __snapshotId: `live-cache:${asOf || new Date().toISOString()}`,
    __snapshotAt: asOf || new Date().toISOString(),
    __snapshotSource: 'intraday-live-cache',
    name: meta?.name || sym,
    assetType: meta?.assetType === 'etf' || meta?.cap === 'etf' ? 'etf' : 'stock',
    sector: meta?.sector || '',
    cap: meta?.cap || '',
    dataSource,
    price,
    priceAtSnapshot: price,
    candles: compactCandles,
    candleCapture: {
      interval: '5m',
      mode: 'latest-bar-delta',
      available: !!compactCandle,
      reason: compactCandle ? '' : (setup.staleReason || 'latest intraday bar unavailable'),
    },
    score,
    rawScore,
    signal: side || signal,
    side,
    freshness: {
      stale: !!setup.stale || !!setup.fetchFailed || ageStale,
      reason: ageStale
        ? `cache-age-${cacheAgeMin}min`
        : (setup.staleReason || (setup.fetchFailed ? 'fetch-failed' : '')),
      ageMin: cacheAgeMin,
      dataSource,
    },
    indicators: {
      ...setup,
      price,
      setupType: setup.setupType || (highProfitShortTrigger ? 'HIGH_PROFIT_SHORT_TRIGGER' : setup.setupType),
      setup: setup.setup || (highProfitShortTrigger ? 'High Profit Short Trigger' : setup.setup),
      entryStatus: setup.entryStatus || (highProfitShortTrigger ? 'Triggered' : setup.entryStatus),
      stopPct: Number.isFinite(stopPct) ? +stopPct.toFixed(3) : null,
      reasons: Array.isArray(setup.reasons)
        ? (highProfitShortTrigger ? [...setup.reasons, 'High-profit short trigger active'] : setup.reasons)
        : (highProfitShortTrigger ? ['High-profit short trigger active'] : []),
    },
    quote: { price, change: Number(setup.dayChange) || null },
    cost: {
      side: side || 'buy',
      targetPct: Number.isFinite(targetPct) ? +targetPct.toFixed(3) : 0,
      costPct: Number(charges.totalPct) || 0,
      charges,
      slippagePct,
      netPct: Number.isFinite(netPct) ? +netPct.toFixed(3) : 0,
      requiredPct: Number(settings.SIMULATION_MIN_NET_PROFIT_PCT) || 0,
      ok: Number.isFinite(netPct) ? netPct >= (Number(settings.SIMULATION_MIN_NET_PROFIT_PCT) || 0) : false,
      minNetPct: Number(settings.SIMULATION_MIN_NET_PROFIT_PCT) || 0,
    },
  };
  candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings, asOfTime);
  if (!candidate.setupType && highProfitShortTrigger) candidate.setupType = 'HIGH_PROFIT_SHORT_TRIGGER';
  if (highProfitShortTrigger) candidate.highProfitShortTrigger = true;
  return candidate;
}

function buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol = null, asOf = null) {
  const universe = getIntradayLiveUniverseSymbols();
  const symbols = [...universe];
  const metaBySymbol = symbolMetaBySymbol instanceof Map ? symbolMetaBySymbol : getSimulationSymbolMetaIndex();
  const candidates = [];
  if (!symbols.length) return candidates;
  for (const sym of symbols) {
    const meta = metaBySymbol.get(sym) || null;
    if (String(meta?.assetType || '').toLowerCase() === 'etf' && settings?.SIMULATION_ENABLE_ETF !== true) continue;
    const setup = intradayLiveCache.get(sym);
    if (!setup || typeof setup !== 'object') continue;
    const candidate = buildServerCandidateFromIntraday(sym, setup, settings, meta, asOf);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function attachSchedulerConfirmationHistory(candidates = [], settings = {}, at = null) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const symbol = String(candidate?.symbol || '').toUpperCase();
    if (!symbol) continue;
    candidate.previousCandidate = candidate.previousCandidate || schedulerPreviousCandidateBySymbol.get(symbol) || null;
    SimulationEngine.applyFrozenEntryTrigger(candidate, candidate.previousCandidate, at || candidate.__snapshotAt, settings);
    schedulerPreviousCandidateBySymbol.set(symbol, SimulationEngine.toConfirmationCandidate(candidate));
  }
  if (schedulerPreviousCandidateBySymbol.size > 1000) {
    const active = new Set((Array.isArray(candidates) ? candidates : []).map(candidate => String(candidate?.symbol || '').toUpperCase()));
    for (const symbol of schedulerPreviousCandidateBySymbol.keys()) {
      if (!active.has(symbol)) schedulerPreviousCandidateBySymbol.delete(symbol);
    }
  }
  return candidates;
}

function selectServerSnapshotCandidates(candidates, baseLimit = 150, etfLimit = 50) {
  const source = Array.isArray(candidates) ? candidates : [];
  const stockSource = source.filter(candidate => String(candidate?.assetType || '').toLowerCase() !== 'etf');
  const etfSource = source
    .filter(candidate => String(candidate?.assetType || '').toLowerCase() === 'etf')
    .filter(candidate => (candidate?.side || candidate?.signal) === 'buy')
    .filter(candidate => Number(candidate?.score) > 0);
  const selected = [];
  const seen = new Set();
  const keyFor = candidate => `${String(candidate?.symbol || '').toUpperCase()}|${String(candidate?.side || candidate?.signal || '').toLowerCase()}`;
  const add = candidate => {
    const key = keyFor(candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    selected.push(candidate);
  };
  const byAbsScore = (a, b) => Math.abs(Number(b?.score) || 0) - Math.abs(Number(a?.score) || 0);
  const byPositiveScore = (a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0);
  stockSource.slice().sort(byAbsScore).slice(0, Math.max(0, Number(baseLimit) || 0)).forEach(add);
  etfSource
    .slice()
    .sort(byPositiveScore)
    .slice(0, Math.max(0, Number(etfLimit) || 0))
    .forEach(add);
  return selected;
}

async function readSchedulerTickInputAsync(settings) {
  if (simulationSchedulerTestInputs && typeof simulationSchedulerTestInputs === 'object') {
    return simulationSchedulerTestInputs;
  }
  const symbolMetaBySymbol = getSimulationSymbolMetaIndex();
  const asOf = new Date().toISOString();
  const serverCandidates = buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol, asOf);
  if (serverCandidates.length) {
    attachSchedulerConfirmationHistory(serverCandidates, settings, asOf);
    // Log data source distribution so stale/fallback data is clearly visible
    const bySource = serverCandidates.reduce((acc, c) => {
      const src = c.dataSource || 'unknown';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {});
    const staleCount = serverCandidates.filter(c => c.freshness?.stale).length;
    const srcSummary = Object.entries(bySource).map(([k, v]) => `${k}:${v}`).join(', ');
    const logSignature = `${serverCandidates.length}|${srcSummary}|${staleCount}`;
    const shouldLogQuality = logSignature !== schedulerTickInputLogState.signature
      || Date.now() - schedulerTickInputLogState.loggedAt >= 5 * 60 * 1000;
    if (shouldLogQuality) {
      schedulerTickInputLogState = { signature:logSignature, loggedAt:Date.now() };
      if (staleCount > 0) {
      console.warn(`[tick-input] ${serverCandidates.length} candidates (${srcSummary}) — STALE: ${staleCount}`);
      } else {
      console.log(`[tick-input] ${serverCandidates.length} candidates (${srcSummary})`);
      }
    }
    const market = await getSimulationMarketContext();
    return {
      at: asOf,
      snapshotId: `live-cache:${asOf}`,
      snapshotAt: asOf,
      snapshotSource: 'intraday-live-cache',
      candidates: serverCandidates,
      market,
      sectorTrend: buildSectorTrendFromCandidates(serverCandidates),
    };
  }
  const snapshots = loadAllSimulationSnapshots();
  const latest = snapshots.slice().sort((a, b) => new Date(b?.at || 0) - new Date(a?.at || 0))[0] || null;
  const snapshotAgeMin = latest?.at
    ? +((Date.now() - new Date(latest.at).getTime()) / 60000).toFixed(1)
    : null;
  console.warn(
    `[tick-input] Live cache empty — falling back to snapshot ${latest?.id || '(none)'}` +
    (snapshotAgeMin != null ? ` (${snapshotAgeMin}min old)` : '')
  );
  const fallbackCandidates = Array.isArray(latest?.candidates)
    ? latest.candidates.map(candidate => ({
        ...candidate,
        __snapshotId: latest.id || '',
        __snapshotAt: latest.at || '',
        __snapshotSource: latest.source || 'simulation-snapshot',
      }))
    : [];
  attachSchedulerConfirmationHistory(fallbackCandidates, settings, latest?.at);
  const market = (latest?.market && typeof latest.market === 'object' && Object.keys(latest.market).length)
    ? latest.market
    : await getSimulationMarketContext();
  return {
    at: latest?.at || new Date().toISOString(),
    snapshotId: latest?.id || '',
    snapshotAt: latest?.at || '',
    snapshotSource: latest?.source || 'simulation-snapshot',
    candidates: fallbackCandidates,
    market,
    sectorTrend: latest?.sectorTrend && typeof latest.sectorTrend === 'object'
      ? latest.sectorTrend
      : buildSectorTrendFromCandidates(fallbackCandidates),
  };
}

function buildSimulationDataQualitySummary(candidates = []) {
  const source = Array.isArray(candidates) ? candidates : [];
  const bySource = {};
  const staleReasonCounts = {};
  let staleCount = 0;
  let freshCount = 0;

  for (const candidate of source) {
    const dataSource = String(candidate?.dataSource || candidate?.freshness?.dataSource || 'unknown');
    if (!bySource[dataSource]) bySource[dataSource] = { total: 0, fresh: 0, stale: 0 };
    bySource[dataSource].total += 1;

    const stale = !!candidate?.freshness?.stale;
    if (stale) {
      staleCount += 1;
      bySource[dataSource].stale += 1;
      const reason = String(candidate?.freshness?.reason || 'stale signal');
      staleReasonCounts[reason] = (staleReasonCounts[reason] || 0) + 1;
    } else {
      freshCount += 1;
      bySource[dataSource].fresh += 1;
    }
  }

  return {
    total: source.length,
    freshCount,
    staleCount,
    stalePct: source.length > 0 ? +((staleCount / source.length) * 100).toFixed(2) : 0,
    bySource,
    staleReasons: staleReasonCounts,
  };
}

async function buildServerSimulationAnalysisPayload(source = 'server-analysis') {
  const runtime = loadSimulationRuntime();
  const overrideSettings = loadTradeSettingsFile().overrides || {};
  const settings = SimulationEngine.withDefaults ? SimulationEngine.withDefaults(overrideSettings) : overrideSettings;
  const tickInput = await readSchedulerTickInputAsync(settings);
  const at = String(tickInput?.at || new Date().toISOString());
  const candidates = Array.isArray(tickInput?.candidates) ? tickInput.candidates : [];
  const market = tickInput?.market || {};
  const sectorTrend = tickInput?.sectorTrend || {};
  const trades = loadPaperStateFile({ asOf: at }).trades || [];
  const openTrades = trades.filter(trade => trade?.status === 'open');
  const openSymbols = new Set(openTrades.map(trade => String(trade?.symbol || '').toUpperCase()).filter(Boolean));
  const dayStats = TradeRules.buildDayStats(trades, at, settings, { sameDay: sameIstDay });
  const maxSnapshotAgeMin = Math.max(0, Number(settings.SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN) || 0);
  const entryBlockReason = (sym, setupType = '', time = at, candidate = null) => {
    const snapshotContext = getEntrySnapshotContext(candidate, tickInput, time, settings);
    if (candidate && snapshotContext.ageMin != null) candidate.__snapshotAgeMin = snapshotContext.ageMin;
    if (candidate && maxSnapshotAgeMin > 0 && snapshotContext.ageMin != null && snapshotContext.ageMin > maxSnapshotAgeMin) {
      return `stale entry snapshot ${snapshotContext.ageMin}m > ${maxSnapshotAgeMin}m`;
    }
    return TradeRules.getEntryBlockReason(sym, setupType, time, dayStats, settings);
  };
  const topN = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_N) || 10));
  const selectedCandidates = SimulationEngine.selectSimulationEntryCandidates(candidates, at, settings, {
    openSymbols,
    openTrades,
    closedTrades:trades.filter(trade => trade?.status === 'closed'),
    entryBlockReason,
    market,
    sectorTrend,
    marketHistory:schedulerMarketHistory,
    indices: market.indices || {},
    dayStats,
    topN,
  });
  const selectedKeys = new Set(selectedCandidates.map(candidate => `${String(candidate?.symbol || '').toUpperCase()}|${String(candidate?.side || candidate?.signal || '').toLowerCase()}`));
  const rankedCandidates = (Array.isArray(candidates) ? candidates : [])
    .slice()
    .sort(SimulationEngine.compareCandidates);
  const analyzedCandidates = rankedCandidates.map((candidate, index) => {
    const symbol = String(candidate?.symbol || '').toUpperCase();
    const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
    const setupType = candidate?.derivedSetupType || candidate?.setupType || SimulationEngine.deriveSetupType(candidate, settings, at);
    const explanation = SimulationEngine.explainCandidateEligibility(candidate, at, settings, {
      market,
      sectorTrend,
      marketHistory:schedulerMarketHistory,
      indices: market.indices || {},
    });
    let block = entryBlockReason(symbol, setupType, at, candidate);
    if (/profit re-entry cooldown/i.test(String(block || '')) && SimulationEngine.isCandidateContinuationReentryAllowed(candidate, settings)) {
      block = '';
    }
    const selected = selectedKeys.has(`${symbol}|${side}`);
    const decisionScore = SimulationEngine.getCandidateDecisionScore(candidate);
    const trigger = candidate?.indicators?.entryTrigger || candidate?.indicators?.entryStatus || '';
    const selectionDetails = [
      String(setupType || '').replace(/_/g, ' '),
      Number.isFinite(Number(decisionScore)) ? `decision score ${Number(decisionScore).toFixed(2)}` : '',
      trigger,
      candidate?.sectorPriority?.aligned ? 'sector aligned' : '',
    ].filter(Boolean);
    const rejectionReasons = [
      candidate?.entryBlockReason,
      block,
      ...(Array.isArray(candidate?.eligibilityAudit?.reasons) ? candidate.eligibilityAudit.reasons : []),
      ...(Array.isArray(explanation?.reasons) ? explanation.reasons : []),
    ].map(value => String(value || '').trim()).filter(Boolean);
    const selectionReason = selected
      ? `Selected: ${selectionDetails.join(' | ')}`
      : `Not selected: ${rejectionReasons[0] || `rank ${index + 1} outside selected top ${topN} or available capacity`}`;
    return {
      ...candidate,
      setupType,
      derivedSetupType: setupType,
      serverRank: index + 1,
      selected,
      selectionRank: selected ? index + 1 : null,
      selectionReason,
      wouldEnter: selected,
      blockReason: block || '',
      eligibilityReasons: Array.isArray(explanation?.reasons) ? explanation.reasons : [],
    };
  });
  const combinedCandidates = SimulationEngine.selectTopCandidatesBySetup(
    analyzedCandidates.filter(candidate => {
      const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
      return ['buy', 'sell'].includes(side) &&
        !String(candidate?.blockReason || '').trim() &&
        (!Array.isArray(candidate?.eligibilityReasons) || candidate.eligibilityReasons.length === 0);
    })
  ).map((candidate, index) => {
    const profitability = SimulationEngine.getCandidateProfitabilityMetrics(candidate);
    const profitabilityReason = profitability.winRate != null
      ? `Historical win chance ${Number(profitability.winRate).toFixed(1)}% over ${profitability.sample} trades | expected net ${Number(profitability.expectedNetPct || 0).toFixed(3)}% | decision ${Number(profitability.decisionScore).toFixed(2)}`
      : `Decision-based profitability score ${Number(profitability.decisionScore).toFixed(2)}; historical setup sample unavailable`;
    return {
      ...candidate,
      combinedRank:index + 1,
      profitability,
      profitabilityReason,
    };
  });
  const dataQuality = buildSimulationDataQualitySummary(analyzedCandidates);
  return {
    ok: true,
    source,
    dataSource: 'server',
    at,
    simulationState: runtime.state || 'off',
    settings,
    settingsFingerprint:SimulationEngine.stableAuditFingerprint(SimulationEngine.buildSettingsAuditSnapshot(settings)),
    dayStats,
    market,
    sectorTrend,
    entryWindowOpen: isSimulationEntryWindowTime(at),
    eodSettlement: isSimulationEodSettlementTime(at),
    candidateCount: analyzedCandidates.length,
    selectedCount: analyzedCandidates.filter(candidate => candidate.selected).length,
    dataQuality,
    combinedCandidates,
    candidates: analyzedCandidates,
  };
}

async function prepareManualTradeEntryPayload(payload = {}, trades = []) {
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const side = String(payload.side || 'buy').toLowerCase();
  const settings = SimulationEngine.withDefaults(loadTradeSettingsFile().overrides || {});
  const tickInput = await readSchedulerTickInputAsync(settings);
  const at = String(tickInput?.at || new Date().toISOString());
  const candidates = Array.isArray(tickInput?.candidates) ? tickInput.candidates : [];
  const candidate = candidates.find(row => String(row?.symbol || '').toUpperCase() === symbol);
  if (!candidate) return { ok:false, error:`${symbol} has no current simulation candidate` };
  const candidateSide = String(candidate.side || candidate.signal || '').toLowerCase();
  if (candidateSide !== side) {
    return { ok:false, error:`${symbol} current validated side is ${candidateSide || 'watch'}, not ${side}` };
  }
  const livePrice = SimulationEngine.getCandidatePrice(candidate);
  const requestedPrice = Number(payload.entryPrice);
  const deviationPct = Number.isFinite(livePrice) && livePrice > 0
    ? Math.abs(requestedPrice - livePrice) / livePrice * 100
    : Infinity;
  const maxDeviationPct = Math.max(0, Number(settings.SIMULATION_MANUAL_ENTRY_MAX_LIVE_DEVIATION_PCT) || 0.25);
  if (!Number.isFinite(deviationPct) || deviationPct > maxDeviationPct) {
    return { ok:false, error:`manual price differs from live price by ${Number.isFinite(deviationPct) ? deviationPct.toFixed(3) : '--'}% (max ${maxDeviationPct}%)` };
  }

  const market = tickInput?.market || {};
  const sectorTrend = tickInput?.sectorTrend || buildSectorTrendFromCandidates(candidates);
  const dayStats = TradeRules.buildDayStats(trades, at, settings, { sameDay:sameIstDay });
  const openTrades = trades.filter(trade => trade?.status === 'open');
  SimulationEngine.selectSimulationEntryCandidates(candidates, at, settings, {
    openSymbols:new Set(),
    openTrades:[],
    closedTrades:trades.filter(trade => trade?.status === 'closed'),
    market,
    sectorTrend,
    indices:market.indices || {},
    dayStats:{ ...dayStats, rollingEntries:0, rollingOrdinaryEntries:0, rollingSectorEntries:0 },
    topN:Math.max(candidates.length, 1),
    entryBlockReason:() => '',
  });
  const setupType = candidate.derivedSetupType || candidate.setupType ||
    SimulationEngine.deriveSetupType(candidate, settings, at, { market, sectorTrend });
  const explanation = candidate.eligibilityAudit?.eligible === false
    ? candidate.eligibilityAudit
    : SimulationEngine.explainCandidateEligibility(candidate, at, settings, {
        previousCandidate:candidate.previousCandidate,
        market,
        sectorTrend,
        indices:market.indices || {},
      });
  if (!explanation?.eligible) {
    return { ok:false, error:`manual entry rejected: ${(explanation?.reasons || ['entry quality validation failed']).join(' | ')}` };
  }
  const block = TradeRules.getEntryBlockReason(symbol, setupType, at, dayStats, settings);
  if (block) return { ok:false, error:`manual entry rejected: ${block}` };

  const plan = SimulationEngine.getPaperPlanForCandidate(candidate, side, livePrice, settings);
  const settingsSnapshot = SimulationEngine.buildSettingsAuditSnapshot(settings);
  const confirmation = SimulationEngine.getEntryConfirmation(
    candidate,
    candidate.previousCandidate,
    side,
    candidate.__snapshotAt || tickInput?.snapshotAt || at,
    settings
  );
  const entryContext = {
    ...(payload.entryContext && typeof payload.entryContext === 'object' ? payload.entryContext : {}),
    manualValidated:true,
    snapshotId:candidate.__snapshotId || tickInput?.snapshotId || '',
    snapshotAt:candidate.__snapshotAt || tickInput?.snapshotAt || at,
    snapshotSource:candidate.__snapshotSource || tickInput?.snapshotSource || '',
    candidateScore:Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
    decisionScore:SimulationEngine.getCandidateDecisionScore(candidate),
    scoreAudit:candidate.scoreAudit || null,
    indicatorSnapshot:SimulationEngine.buildIndicatorAuditSnapshot(candidate),
    settingsSnapshot,
    settingsFingerprint:SimulationEngine.stableAuditFingerprint(settingsSnapshot),
    confirmation,
    candidateSetupType:setupType,
    sectorAligned:!!candidate.sectorPriority?.aligned,
    sectorPriority:candidate.sectorPriority || null,
    validatedLivePrice:+Number(livePrice).toFixed(2),
    requestedPrice:+requestedPrice.toFixed(2),
    priceDeviationPct:+deviationPct.toFixed(3),
  };
  return {
    ok:true,
    payload:{
      ...payload,
      symbol,
      side,
      signal:candidate.signal || side,
      score:Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
      decisionScore:SimulationEngine.getCandidateDecisionScore(candidate),
      rr:Number.isFinite(Number(candidate.rr)) ? Number(candidate.rr) : null,
      sector:candidate.sector || candidate.sectorPriority?.sector || '',
      setupType,
      setup:candidate.setup || candidate.indicators?.setup || null,
      target:Number.isFinite(Number(payload.target)) ? Number(payload.target) : plan.target,
      stop:Number.isFinite(Number(payload.stop)) ? Number(payload.stop) : plan.stop,
      entryContext,
    },
  };
}

async function runSimulationSchedulerTick() {
  if (simulationTickInFlight) return { ok: false, skipped: true, reason: 'tick-in-flight' };
  simulationTickInFlight = true;
  simulationLastTickStartedAt = Date.now();
  try {
    return await runWithMutationLock(async () => {
      const runtime = loadSimulationRuntime();
      if (runtime.state !== 'running' && runtime.state !== 'settling') {
        return { ok: true, skipped: true, state: runtime.state };
      }

      const settingsRaw = loadTradeSettingsFile().overrides || {};
      const settings = settingsRaw;
      const tickInput = await readSchedulerTickInputAsync(settings);
      const inputAtIso = String(tickInput?.at || new Date().toISOString());
      const useInputClock = !!(simulationSchedulerTestInputs && typeof simulationSchedulerTestInputs === 'object');
      const schedulerAtIso = useInputClock ? inputAtIso : new Date().toISOString();
      schedulerMarketHistory.push({
        at:schedulerAtIso,
        market:tickInput?.market || {},
        sectorTrend:tickInput?.sectorTrend || {},
      });
      while (schedulerMarketHistory.length > 120) schedulerMarketHistory.shift();
      const state = loadPaperStateFile({ asOf: schedulerAtIso });
      const autoStopAfterMarket = runtime.state === 'running' && shouldAutoStopSimulation(schedulerAtIso);
      const eodSettlement = isSimulationEodSettlementTime(schedulerAtIso);
      const ownershipContext = getTradeOwnershipContext(runtime.state, settings);
      const normalizedTrades = normalizeTradeCollectionOwnership(state.trades, ownershipContext);
      let changed = JSON.stringify(state.trades) !== JSON.stringify(normalizedTrades);
      state.trades = normalizedTrades;
      const trades = state.trades;
      const openTrades = trades.filter(trade =>
        trade?.status === 'open' &&
        String(trade?.broker?.status || '').toLowerCase() !== 'exit_placed' &&
        (
          eodSettlement ||
          trade?.managedBySimulation === true ||
          String(trade?.source || '').toLowerCase() === 'simulation'
        )
      );
      simulationOpenManagedTradeCount = openTrades.length;
      const milestoneStateBefore = new Map(openTrades.map(trade => [
        String(trade?.id || ''),
        JSON.stringify({
          floorPct:trade?.gainMilestoneFloorPct ?? trade?._gainMilestoneFloorPct ?? null,
          armedAt:trade?._gainMilestoneArmedAt || null,
          history:Array.isArray(trade?.gainMilestones) ? trade.gainMilestones : [],
        }),
      ]));
      const candidateBySymbol = new Map((Array.isArray(tickInput?.candidates) ? tickInput.candidates : [])
        .map(candidate => [String(candidate?.symbol || '').toUpperCase(), candidate]));
      {
        const openBySymbol = new Map(openTrades.map(trade => [String(trade?.symbol || '').toUpperCase(), trade]));
        const missingSymbols = [...openBySymbol.keys()].filter(sym => sym && !candidateBySymbol.has(sym));
        if (missingSymbols.length) {
          let quotes = {};
          try {
            quotes = (await yahooQuote(missingSymbols))?.quotes || {};
          } catch (e) { console.warn('[scheduler] Yahoo quote fallback failed:', e.message); }
          for (const sym of missingSymbols) {
            const trade = openBySymbol.get(sym);
            if (!trade) continue;
            const quote = quotes[sym] || {};
            const quotedPrice = Number(quote?.price);
            const price = Number.isFinite(quotedPrice) && quotedPrice > 0 ? quotedPrice : null;
            if (!Number.isFinite(price) || price <= 0) continue;
            const storedManagement = trade?.managementCandidate && typeof trade.managementCandidate === 'object'
              ? trade.managementCandidate
              : {};
            const side = String(trade?.side || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
            const score = Number.isFinite(Number(storedManagement?.score))
              ? Number(storedManagement.score)
              : (Number.isFinite(Number(trade?.score))
                ? Number(trade.score)
                : (side === 'sell' ? -55 : 55));
            candidateBySymbol.set(sym, {
              ...storedManagement,
              symbol: sym,
              side,
              signal: side,
              price,
              priceAtSnapshot: price,
              score,
              quote: {
                price,
                change: Number.isFinite(Number(quote?.change)) ? Number(quote.change) : null,
              },
              freshness: { stale: false, reason: eodSettlement ? 'eod-fallback-quote' : 'runtime-fallback-quote' },
              indicators: {
                ...(storedManagement.indicators || {}),
                price,
                entryStatus: 'Triggered',
                target: Number.isFinite(Number(trade?.target)) ? Number(trade.target) : null,
                stop: Number.isFinite(Number(trade?.stop)) ? Number(trade.stop) : null,
              },
            });
          }
        }
      }
      for (const trade of openTrades) {
        const sym = String(trade?.symbol || '').toUpperCase();
        if (!sym) continue;
        const candidate = candidateBySymbol.get(sym);
        if (!candidate) continue;
        const managementCandidate = SimulationEngine.buildManagementCandidateSnapshot(candidate);
        if (managementCandidate && JSON.stringify(trade.managementCandidate || null) !== JSON.stringify(managementCandidate)) {
          trade.managementCandidate = managementCandidate;
          changed = true;
        }
        const side = String(trade?.side || candidate?.side || candidate?.signal || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
        const candidatePrice = Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price ?? candidate?.indicators?.price);
        const basePrice = Number.isFinite(candidatePrice) && candidatePrice > 0 ? candidatePrice : Number(trade?.entryPrice);
        // Always track peak price every tick so trailing stop never misses a high water mark
        const entry = Number(trade.entryPrice);
        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(basePrice) && basePrice > 0) {
          const favorablePct = side === 'sell' ? ((entry - basePrice) / entry) * 100 : ((basePrice - entry) / entry) * 100;
          trade._maxFavorablePct = Math.max(Number(trade._maxFavorablePct) || 0, favorablePct);
          trade._bestPrice = side === 'sell'
            ? Math.min(Number(trade._bestPrice) || entry, basePrice)
            : Math.max(Number(trade._bestPrice) || entry, basePrice);
        }
        const plan = SimulationEngine.getPaperPlanForCandidate?.(candidate, side, basePrice);
        const hasTarget = trade?.target != null && Number.isFinite(Number(trade.target));
        const hasStop = trade?.stop != null && Number.isFinite(Number(trade.stop));
        if (!hasTarget && Number.isFinite(Number(plan?.target))) {
          trade.target = +Number(plan.target).toFixed(2);
          changed = true;
        }
        if (!hasStop && Number.isFinite(Number(plan?.stop))) {
          trade.stop = +Number(plan.stop).toFixed(2);
          changed = true;
        }
        if (!trade.setupType && (candidate?.derivedSetupType || candidate?.setupType)) {
          trade.setupType = candidate.derivedSetupType || candidate.setupType;
          changed = true;
        }
        if (!trade.signal && candidate?.signal) {
          trade.signal = candidate.signal;
          changed = true;
        }
        if (!Number.isFinite(Number(trade?.score)) && Number.isFinite(Number(candidate?.score))) {
          trade.score = Number(candidate.score);
          changed = true;
        }
        if (!Number.isFinite(Number(trade?.rr))) {
          const entry = Number(trade?.entryPrice);
          const target = Number(trade?.target);
          const stop = Number(trade?.stop);
          const risk = Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) : null;
          const reward = Number.isFinite(entry) && Number.isFinite(target) ? Math.abs(target - entry) : null;
          if (Number.isFinite(risk) && risk > 0 && Number.isFinite(reward)) {
            trade.rr = +Number(reward / risk).toFixed(2);
            changed = true;
          }
        }
      }
      const dayStats = TradeRules.buildDayStats(trades, schedulerAtIso, settings, {
        sameDay: sameIstDay,
      });
      const maxSnapshotAgeMin = Math.max(0, Number(settings.SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN) || 0);
      const entryBlockReason = (sym, setupType = '', at = schedulerAtIso, candidate = null) => {
        const snapshotContext = getEntrySnapshotContext(candidate, tickInput, at, settings);
        if (candidate && snapshotContext.ageMin != null) candidate.__snapshotAgeMin = snapshotContext.ageMin;
        if (candidate && maxSnapshotAgeMin > 0 && snapshotContext.ageMin != null && snapshotContext.ageMin > maxSnapshotAgeMin) {
          return `stale entry snapshot ${snapshotContext.ageMin}m > ${maxSnapshotAgeMin}m`;
        }
        return TradeRules.getEntryBlockReason(
          sym,
          setupType,
          at,
          dayStats,
          settings
        );
      };

      // Compute cash and position sizing BEFORE runtimeEngine so both paths can use them
      const portfolioMetrics = TradeRules.computePortfolioEquity(state.portfolio, trades, 500000);
      const portfolioInitialCapital = portfolioMetrics.equity;
      const serverCashAvailable = portfolioMetrics.cashAvailable;
      const closedTrades = trades.filter(t => t.status === 'closed');
      const serverPositionMultiplier = TradeRules.computePositionSizeMultiplier(closedTrades);
      const portfolioHeat = TradeRules.computePortfolioHeat(trades, portfolioMetrics.equity);
      const maxHeatRisk = portfolioMetrics.equity * (Number(settings.SIMULATION_MAX_PORTFOLIO_HEAT_PCT || 5) / 100);
      const maxSectorRisk = portfolioMetrics.equity * (Number(settings.SIMULATION_MAX_SECTOR_HEAT_PCT || 2) / 100);
      const sectorHeatRemaining = {};
      for (const candidate of candidateBySymbol.values()) {
        const sector = String(candidate?.sector || 'UNKNOWN');
        sectorHeatRemaining[sector] = Math.max(0, maxSectorRisk - Number(portfolioHeat.bySector[sector] || 0));
      }

      const runtimeEngine = tickInput?.exitBySymbol
        ? {
            getSimulationExitIntent(trade) {
              return tickInput?.exitBySymbol?.[String(trade?.symbol || '').toUpperCase()] || null;
            },
            getSimulationEntryIntents(candidates) {
              let remainingCash = serverCashAvailable;
              return candidates.map(candidate => {
                const side = candidate.side || 'buy';
                const price = Number(candidate.price);
                const setupType = candidate.derivedSetupType || candidate.setupType || null;
                const runnerInitialMultiplier = setupType === 'MOMENTUM_RUNNER'
                  ? Math.max(0.1, Math.min(1, Number(settings.SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER) || 0.5))
                  : 1;
                const setupPositionMultiplier = setupType === 'RANGEBOUND'
                  ? Math.max(0.1, Math.min(1, Number(settings.SIMULATION_RANGEBOUND_POSITION_MULTIPLIER) || 0.5))
                  : runnerInitialMultiplier;
                const fullSizing = setupType === 'MOMENTUM_RUNNER' && Number.isFinite(price) && price > 0
                  ? SimulationEngine.getSuggestedQty(
                      candidate,
                      side,
                      price,
                      remainingCash,
                      Number(settingsRaw.MAX_POSITION_EXPOSURE) || null,
                      { ...settingsRaw, PORTFOLIO_INITIAL_CAPITAL: portfolioInitialCapital },
                      serverPositionMultiplier
                    )
                  : null;
                const sizing = Number.isFinite(price) && price > 0
                  ? SimulationEngine.getSuggestedQty(
                      candidate,
                      side,
                      price,
                      remainingCash,
                      Number(settingsRaw.MAX_POSITION_EXPOSURE) || null,
                      { ...settingsRaw, PORTFOLIO_INITIAL_CAPITAL: portfolioInitialCapital },
                      serverPositionMultiplier * setupPositionMultiplier
                    )
                  : null;
                const qty = Math.max(0, Math.floor(Number(sizing?.qty) || 0));
                if (!qty) return null;
                remainingCash = Math.max(0, remainingCash - (price * qty));
                return {
                  symbol: candidate.symbol,
                  side,
                  qty,
                  price,
                  entryPrice: price,
                  target: candidate.target,
                  stop: candidate.stop,
                  signal: candidate.signal,
                  score: candidate.score,
                  decisionScore: SimulationEngine.getCandidateDecisionScore(candidate),
                  rr: candidate.rr,
                  sector:candidate.sector || candidate.sectorPriority?.sector || '',
                  setupType,
                  setup: candidate.setup,
                  entryContext: {
                    ...(candidate.entryContext && typeof candidate.entryContext === 'object' ? candidate.entryContext : {}),
                    plannedFullQty:setupType === 'MOMENTUM_RUNNER'
                      ? Math.max(qty, Math.floor(Number(fullSizing?.qty) || 0))
                      : undefined,
                    initialPositionMultiplier:setupType === 'MOMENTUM_RUNNER' ? runnerInitialMultiplier : undefined,
                    snapshotId: candidate.__snapshotId || tickInput?.snapshotId || '',
                    snapshotAt: candidate.__snapshotAt || tickInput?.snapshotAt || tickInput?.at || schedulerAtIso,
                    snapshotSource: candidate.__snapshotSource || tickInput?.snapshotSource || '',
                    snapshotAgeMin: candidate.__snapshotAgeMin ?? null,
                    decisionScore:SimulationEngine.getCandidateDecisionScore(candidate),
                    scoreAudit:candidate.scoreAudit || null,
                    indicatorSnapshot:SimulationEngine.buildIndicatorAuditSnapshot(candidate),
                    settingsSnapshot:SimulationEngine.buildSettingsAuditSnapshot(settings),
                    settingsFingerprint:SimulationEngine.stableAuditFingerprint(SimulationEngine.buildSettingsAuditSnapshot(settings)),
                    confirmation:SimulationEngine.getEntryConfirmation(
                      candidate,
                      candidate.previousCandidate,
                      side,
                      candidate.__snapshotAt || tickInput?.snapshotAt || tickInput?.at || schedulerAtIso,
                      settings
                    ),
                    sectorAligned:!!candidate.sectorPriority?.aligned,
                    sectorPriority:candidate.sectorPriority || null,
                  },
                  notes: candidate.notes,
                  assetType: candidate.assetType,
                };
              }).filter(Boolean);
            },
          }
        : SimulationEngine;

      const { exitIntents, scaleInIntents, entryIntents } = runSimulationDomainCycle(
        {
          openTrades,
          candidates: Array.isArray(tickInput?.candidates) ? tickInput.candidates : [],
          at: schedulerAtIso,
          settings,
          isEodSettlement: eodSettlement,
          context: {
            candidateBySymbol,
            openTrades,
            closedTrades,
            market: tickInput?.market || {},
            sectorTrend: tickInput?.sectorTrend || {},
            marketHistory:schedulerMarketHistory,
            indices: tickInput?.market?.indices || {},
            dayStats,
            entryBlockReason,
            lastKnownBySymbol: new Map(),
            cashAvailable: serverCashAvailable,
            portfolioEquity: portfolioMetrics.equity,
            openExposure: portfolioMetrics.openExposure,
            positionMultiplier: serverPositionMultiplier,
            remainingHeatRisk: Math.max(0, maxHeatRisk - portfolioHeat.risk),
            sectorHeatRemaining,
          },
        },
        { engine: runtimeEngine }
      );
      const milestoneChanged = openTrades.some(trade => milestoneStateBefore.get(String(trade?.id || '')) !== JSON.stringify({
          floorPct:trade?.gainMilestoneFloorPct ?? trade?._gainMilestoneFloorPct ?? null,
          armedAt:trade?._gainMilestoneArmedAt || null,
          history:Array.isArray(trade?.gainMilestones) ? trade.gainMilestones : [],
        }));
      if (milestoneChanged) changed = true;

      const fallbackExitIntents = (!Array.isArray(exitIntents) || exitIntents.length === 0) && tickInput?.exitBySymbol
        ? openTrades
            .map(trade => tickInput.exitBySymbol[String(trade?.symbol || '').toUpperCase()] || null)
            .filter(Boolean)
        : [];
      const effectiveExitIntents = Array.isArray(exitIntents) && exitIntents.length ? exitIntents : fallbackExitIntents;
      const hasDecisionIntent = effectiveExitIntents.length > 0
        || (scaleInIntents || []).length > 0
        || (entryIntents || []).length > 0;
      const decisionSignature = JSON.stringify({
        exits:effectiveExitIntents.map(intent => [
          String(intent?.symbol || '').toUpperCase(),
          String(intent?.action || 'close').toLowerCase(),
          String(intent?.reason || ''),
        ]),
        scaleIns:(scaleInIntents || []).map(intent => [
          String(intent?.symbol || '').toUpperCase(),
          String(intent?.reason || ''),
        ]),
        entries:(entryIntents || []).map(intent => [
          String(intent?.symbol || '').toUpperCase(),
          String(intent?.side || '').toLowerCase(),
          String(intent?.setupType || ''),
        ]),
      });
      const decisionChanged = decisionSignature !== simulationLastCycleDecisionSignature;
      simulationLastCycleDecisionSignature = decisionSignature;
      const journalNow = Date.now();
      const shouldJournalCycle = decisionChanged
        || milestoneChanged
        || simulationSchedulerTestInputs != null
        || journalNow - simulationLastCycleDecisionJournalAt >= SIMULATION_DECISION_HEARTBEAT_MS;
      const decisionCycle = {
        journalReason:decisionChanged
          ? (hasDecisionIntent ? 'decision-change' : 'decision-cleared')
          : (milestoneChanged ? 'milestone' : 'heartbeat'),
        runtimeState:runtime.state,
        snapshotAt:tickInput?.snapshotAt || tickInput?.at || schedulerAtIso,
        portfolioCapacity:{
          cashAvailable:serverCashAvailable,
          equity:portfolioMetrics.equity,
          openExposure:portfolioMetrics.openExposure,
          remainingHeatRisk:Math.max(0, maxHeatRisk - portfolioHeat.risk),
          openPositions:openTrades.length,
          maxOpen:Number(settings.SIMULATION_MAX_OPEN),
          maxActive:Number(settings.SIMULATION_MAX_ACTIVE_OPEN),
          maxNewPerCycle:Number(settings.SIMULATION_MAX_NEW_PER_CYCLE),
        },
        rankedCandidates:(Array.isArray(tickInput?.candidates) ? tickInput.candidates : [])
          .map(candidate => ({
            symbol:candidate?.symbol,
            side:candidate?.side || candidate?.signal,
            score:candidate?.score,
            decisionScore:candidate?.decisionScore ?? candidate?.entryContext?.decisionScore ?? null,
            setupType:candidate?.derivedSetupType || candidate?.setupType || null,
            selectionRank:candidate?.selectionRank ?? null,
            topGainerRank:candidate?.topGainerRank ?? null,
            topLoserRank:candidate?.topLoserRank ?? null,
            selected:(entryIntents || []).some(intent => intent.symbol === candidate?.symbol),
            rejectionReasons:candidate?.eligibilityAudit?.reasons || (candidate?.entryBlockReason ? [candidate.entryBlockReason] : []),
          }))
          .sort((a, b) => (a.selectionRank ?? Number.MAX_SAFE_INTEGER) - (b.selectionRank ?? Number.MAX_SAFE_INTEGER) || Math.abs(Number(b.decisionScore ?? b.score) || 0) - Math.abs(Number(a.decisionScore ?? a.score) || 0)),
        exitIntents:effectiveExitIntents.map(intent => ({ symbol:intent.symbol, action:intent.action || 'close', reason:intent.reason, exitPrice:intent.exitPrice, qtyPct:intent.qtyPct })),
        scaleInIntents:(scaleInIntents || []).map(intent => ({
          symbol:intent.symbol,
          qty:intent.qty,
          price:intent.price,
          reason:intent.reason,
          maxFavorablePct:intent.maxFavorablePct,
        })),
        entryIntents:(entryIntents || []).map(intent => ({
          symbol:intent.symbol,
          side:intent.side,
          qty:intent.qty,
          price:intent.price,
          setupType:intent.setupType,
          score:intent.score,
          decisionScore:intent.decisionScore ?? intent.entryContext?.decisionScore ?? null,
          rangeboundAdmission:intent.entryContext?.rangeboundAdmission || null,
          scoreAudit:intent.entryContext?.scoreAudit || null,
          settingsFingerprint:intent.entryContext?.settingsFingerprint || null,
        })),
      };
      simulationLatestDecisionCycle = { ...decisionCycle, recordedAt:schedulerAtIso };
      if (shouldJournalCycle) {
        simulationLastCycleDecisionJournalAt = journalNow;
        appendSimulationDecisionJournal('cycle_decisions', decisionCycle, schedulerAtIso);
      }

      const exitBySymbol = new Map();
      for (const intent of effectiveExitIntents) {
        exitBySymbol.set(String(intent?.symbol || '').toUpperCase(), intent);
      }

      for (const trade of openTrades) {
        const key = String(trade?.symbol || '').toUpperCase();
        const intent = exitBySymbol.get(key);
        if (!intent) continue;
        if (String(intent?.action || 'close').toLowerCase() === 'partial') {
          changed = await partialCloseTradeFromExitIntent(trades, trade, intent, schedulerAtIso) || changed;
        } else {
          changed = await closeTradeFromExitIntent(trade, intent, schedulerAtIso) || changed;
        }
      }

      const allowNewEntries = runtime.state !== 'settling' && isSimulationEntryWindowTime(schedulerAtIso);
      if (allowNewEntries) {
        for (const intent of scaleInIntents || []) {
          const trade = trades.find(row => row?.status === 'open' && row?.id === intent?.trade?.id);
          if (!trade) continue;
          const currentMetrics = TradeRules.computePortfolioEquity(state.portfolio, trades, 500000);
          const intentExposure = Number(intent?.price) * Number(intent?.qty);
          const grossLimit = currentMetrics.equity * (Math.max(0, Number(settings.SIMULATION_MAX_GROSS_EXPOSURE_PCT) || 80) / 100);
          if (!Number.isFinite(intentExposure) || intentExposure <= 0 ||
              intentExposure > currentMetrics.cashAvailable + 0.01 ||
              currentMetrics.openExposure + intentExposure > grossLimit + 0.01) {
            appendSimulationDecisionJournal('scale_in_blocked_atomic_limit', {
              tradeId:trade.id,
              symbol:trade.symbol,
              requestedExposure:intentExposure,
            }, schedulerAtIso);
            continue;
          }
          changed = await scaleInMomentumRunnerFromIntent(trade, intent, schedulerAtIso) || changed;
        }
        for (const intent of entryIntents || []) {
          const currentOpen = trades.filter(trade => trade?.status === 'open');
          const currentSimulationOpen = currentOpen.filter(trade => String(trade?.source || '').toLowerCase() === 'simulation');
          const currentShorts = currentSimulationOpen.filter(trade => String(trade?.side || '').toLowerCase() === 'sell');
          const maxOpen = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_OPEN) || 0));
          const maxActive = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_ACTIVE_OPEN) || 0));
          const maxShorts = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_CONCURRENT_SHORTS) || 4));
          const currentMetrics = TradeRules.computePortfolioEquity(state.portfolio, trades, 500000);
          const intentExposure = Number(intent?.price ?? intent?.entryPrice) * Number(intent?.qty);
          const grossLimit = currentMetrics.equity * (Math.max(0, Number(settings.SIMULATION_MAX_GROSS_EXPOSURE_PCT) || 80) / 100);
          let atomicBlock = '';
          if (maxOpen > 0 && currentOpen.length >= maxOpen) atomicBlock = `atomic max-open limit ${currentOpen.length}/${maxOpen}`;
          else if (maxActive > 0 && currentSimulationOpen.length >= maxActive) atomicBlock = `atomic active-position limit ${currentSimulationOpen.length}/${maxActive}`;
          else if (String(intent?.side || '').toLowerCase() === 'sell' && maxShorts > 0 && currentShorts.length >= maxShorts) atomicBlock = `atomic concurrent-short limit ${currentShorts.length}/${maxShorts}`;
          else if (!Number.isFinite(intentExposure) || intentExposure <= 0) atomicBlock = 'atomic exposure validation failed';
          else if (currentMetrics.openExposure + intentExposure > grossLimit + 0.01) atomicBlock = `atomic gross-exposure limit ${Math.round(currentMetrics.openExposure + intentExposure)}/${Math.round(grossLimit)}`;
          if (atomicBlock) {
            appendSimulationDecisionJournal('entry_blocked_atomic_limit', { symbol:intent?.symbol, side:intent?.side, reason:atomicBlock }, schedulerAtIso);
            continue;
          }
          changed = await openTradeFromEntryIntent(trades, intent, schedulerAtIso) || changed;
        }
      }

      if (changed) {
        savePaperStateFile(state);
        broadcastPaperTradeState('simulation-tick');
      }

      const counts = countOpenTradeOwnership(trades);
      const nextRuntimeUpdate = { lastTickAt: Date.now(), lastError: '' };

      if (runtime.state === 'settling') {
        if (!simulationSettlingStartedAt) simulationSettlingStartedAt = Date.now();
        const elapsedMs = Date.now() - simulationSettlingStartedAt;
        if (counts.openSimulationManagedCount === 0) {
          const next = transitionAndSaveSimulationRuntime({ type: 'settled' }, nextRuntimeUpdate);
          stopSimulationScheduler('settled');
          return { ok: true, state: next.state, settled: true };
        }
        if (elapsedMs >= simulationStopTimeoutSec * 1000) {
          const forced = saveSimulationRuntime({
            state: 'off',
            lastTickAt: Date.now(),
            lastError: `Settling timeout after ${simulationStopTimeoutSec}s`,
          });
          stopSimulationScheduler('settle-timeout');
          return { ok: true, state: forced.state, timedOut: true };
        }
      }

      if (autoStopAfterMarket) {
        // If no open trades remain, stop immediately; otherwise enter settling so
        // subsequent ticks can close remaining trades before fully stopping.
        if (counts.openSimulationManagedCount === 0) {
          const next = transitionAndSaveSimulationRuntime({ type: 'stop', mode: 'immediate' }, {
            lastTickAt: Date.now(),
            lastError: '',
          });
          stopSimulationScheduler('auto-stop-after-market');
          return { ok: true, state: next.state, autoStopped: true };
        }
        // Open trades exist — enter settling mode so ticks keep running until they close.
        const next = transitionAndSaveSimulationRuntime({ type: 'stop', mode: 'settle' }, {
          lastTickAt: Date.now(),
          lastError: '',
        });
        return { ok: true, state: next.state, autoStopped: true };
      }

      const updated = saveSimulationRuntime(nextRuntimeUpdate);
      return { ok: true, state: updated.state };
    });
  } catch (error) {
    saveSimulationRuntime({ lastError: error?.message || String(error) });
    return { ok: false, error: error?.message || String(error) };
  } finally {
    simulationTickInFlight = false;
    simulationLastTickCompletedAt = Date.now();
    schedulePendingSimulationTick();
  }
}

function startSimulationScheduler(reason = 'manual-start') {
  if (simulationSchedulerTimer) return;
  startIntradayLiveRefresh('scheduler-start');
  refreshIntradayLiveCache('scheduler-start')
    .then(result => {
      if (Number(result?.changedCount) > 0) triggerSimulationTickAfterScoreUpdate('scheduler-start', []);
    })
    .catch(() => {});
  simulationSchedulerTimer = setInterval(() => {
    triggerSimulationTickAfterScoreUpdate('scheduler-interval', []);
  }, Math.max(1, simulationTickIntervalSec) * 1000);
  console.log(`[simulation-runtime] Scheduler started (${reason}) at ${simulationTickIntervalSec}s cadence`);
}

function stopSimulationScheduler(reason = 'manual-stop') {
  if (simulationSchedulerTimer) {
    clearInterval(simulationSchedulerTimer);
    simulationSchedulerTimer = null;
  }
  if (simulationImmediateTickTimer) {
    clearTimeout(simulationImmediateTickTimer);
    simulationImmediateTickTimer = null;
  }
  simulationImmediateTickPending = false;
  simulationImmediateTickReasons.clear();
  simulationImmediateTickChangedSymbols.clear();
  simulationOpenManagedTradeCount = 0;
  simulationLastCycleDecisionSignature = '';
  simulationSettlingStartedAt = 0;
  console.log(`[simulation-runtime] Scheduler stopped (${reason})`);
}

function getSimulationRuntimeStatus() {
  const runtime = loadSimulationRuntime();
  const settings = SimulationEngine.withDefaults(loadTradeSettingsFile().overrides || {});
  const settingsAudit = SimulationEngine.buildSettingsAuditSnapshot(settings);
  const asOf = new Date().toISOString();
  const now = Date.now();
  const symbolMetaBySymbol = getSimulationSymbolMetaIndex();
  const candidates = buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol, asOf);
  const dataQuality = buildSimulationDataQualitySummary(candidates);
  const tradeState = loadPaperStateFile();
  const counts = countOpenTradeOwnership(tradeState.trades);
  const sharekhanLastTickAt = Number(sharekhanTicker?._lastTickAt) || 0;
  const sharekhanHealth = {
    connected: !!sharekhanTicker?._connected,
    connections: sharekhanTicker?.connectionCount || 0,
    connectedConnections: sharekhanTicker?.connectedCount || 0,
    subscribedSymbols: sharekhanTicker ? sharekhanTicker._subscribedCodes.size : 0,
    indexSymbols: sharekhanIndexCodeMap.size,
    lastTickAt: sharekhanLastTickAt,
    lastTickAgeSec: sharekhanLastTickAt > 0 ? +(((now - sharekhanLastTickAt) / 1000).toFixed(1)) : null,
    reconnectPending: !!sharekhanTicker?._reconnectTimer,
    authBlocked: !!sharekhanTicker?._authBlocked,
    idleTimeoutSec: sharekhanTicker?._idleTimeoutMs ? Math.round(Number(sharekhanTicker._idleTimeoutMs) / 1000) : null,
    accessTokenLoaded: !!sharekhanCredentials?.accessToken,
  };
  return {
    ok: true,
    state: runtime.state,
    autoResume: runtime.autoResume,
    tickIntervalSec: simulationTickIntervalSec,
    lastTickAt: runtime.lastTickAt,
    updatedAt: runtime.updatedAt,
    lastError: runtime.lastError || '',
    lockActive: mutationLockActive || simulationTickInFlight,
    schedulerActive: !!simulationSchedulerTimer,
    schedulerDiagnostics: {
      tickInFlight:simulationTickInFlight,
      immediateTickPending:simulationImmediateTickPending,
      queuedSymbolCount:simulationImmediateTickChangedSymbols.size,
      openManagedTradeCount:simulationOpenManagedTradeCount,
      activeMinIntervalMs:SIMULATION_ACTIVE_TICK_MIN_INTERVAL_MS,
      idleMinIntervalMs:SIMULATION_IDLE_TICK_MIN_INTERVAL_MS,
      lastTickStartedAt:simulationLastTickStartedAt || null,
      lastTickCompletedAt:simulationLastTickCompletedAt || null,
      lastCycleDecisionJournalAt:simulationLastCycleDecisionJournalAt || null,
    },
    sharekhanHealth,
    dataQuality,
    settings,
    settingsFingerprint:SimulationEngine.stableAuditFingerprint(settingsAudit),
    ...counts,
  };
}

async function initializeSimulationRuntime() {
  if (simulationRuntimeInitialized) return getSimulationRuntimeStatus();
  simulationRuntimeInitialized = true;
  const runtime = loadSimulationRuntime();
  if (getSimulationUniverseSymbols().size) {
    startIntradayLiveRefresh('runtime-init');
    refreshIntradayLiveCache('runtime-init').catch(() => {});
  }
  simulationRuntimeAutoResumeArmed = runtime.state === 'running' && runtime.autoResume === true;
  if (simulationRuntimeAutoResumeArmed || runtime.state === 'settling') {
    startSimulationScheduler('auto-resume');
  }
  return getSimulationRuntimeStatus();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
}

function loadTradeSettingsFile() {
  try {
    const val = kvGet('trade_settings');
    if (val && typeof val === 'object' && val.overrides) return val;
    return { savedAt: Date.now(), overrides: {} };
  } catch (e) {
    console.warn('[trade-settings] Load error:', e.message);
    return { savedAt: Date.now(), overrides: {} };
  }
}

function saveTradeSettingsFile(overrides) {
  const clean = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    if (typeof value === 'boolean') clean[key] = value;
    else if (key === 'SIMULATION_COST_PROFILE' && ['zerodha_intraday', 'sharekhan_intraday'].includes(String(value))) clean[key] = String(value);
    else {
      const n = Number(value);
      if (Number.isFinite(n)) clean[key] = n;
    }
  }
  try { kvSet('trade_settings', { savedAt: Date.now(), overrides: clean }); }
  catch(e) { console.warn('[trade-settings] Save error:', e.message); }
  intradayDataSourceSettingsCache = { loadedAt: 0, value: null };
  return clean;
}

function buildDashboardBootstrap() {
  const paper = loadPaperStateFile();
  const tradeSettings = loadTradeSettingsFile();

  return {
    ok:true,
    savedAt:Date.now(),
    prefs:{
      stocks:loadSavedStocksFile(),
      stockFavorites:loadSavedStockFavsFile(),
    },
    portfolio:paper.portfolio,
    trades:paper.trades,
    dayPnl: proxyDbReady ? getDayPnl() : {},
    tradeSettings,
    proxy:{
      openai:{ configured:!!OPENAI_API_KEY, model:OPENAI_MODEL },
      ollama:{ baseUrl:OLLAMA_BASE_URL, model:OLLAMA_MODEL || 'auto', timeoutMs:OLLAMA_TIMEOUT_MS },
    },
  };
}

function hasUsableMobileCandidates(candidates = []) {
  return Array.isArray(candidates) && candidates.some(candidate =>
    Number(candidate?.price || candidate?.quote?.price || candidate?.indicators?.price) > 0
  );
}

function buildMobileSetupsPayload(filter = 'tradeable') {
  const overrides = loadTradeSettingsFile().overrides || {};
  const settings = SimulationEngine.withDefaults ? SimulationEngine.withDefaults(overrides) : overrides;
  const etfEnabled = settings.SIMULATION_ENABLE_ETF === true;
  const dashboardStocks = loadDashboardStockUniverse();
  const stockSymbols = new Set(dashboardStocks.map(item => String(item.sym || '').toUpperCase()).filter(Boolean));
  // Mobile setups are stock-only and must be evaluated over the same complete
  // 300-stock universe regardless of favourites or the currently selected setup.
  rememberSimulationUniverse([...stockSymbols]);
  const isAllowedMobileSetup = (symbol, candidate = {}) => {
    const normalized = String(symbol || candidate?.symbol || '').toUpperCase();
    if (stockSymbols.has(normalized)) return true;
    if (!etfEnabled) return false;
    return String(candidate?.assetType || candidate?.cap || '').toLowerCase() === 'etf'
      || isEtfSimulationSymbol(normalized);
  };
  const mobileMeta = new Map();
  for (const item of [...dashboardStocks, ...loadSavedStocksFile()]) {
    const symbol = String(item?.sym || item?.symbol || item || '').trim().toUpperCase();
    if (!symbol || !stockSymbols.has(symbol)) continue;
    mobileMeta.set(symbol, typeof item === 'object'
      ? { name:item.name || symbol, sector:item.sector || '', cap:item.cap || '', assetType:'stock' }
      : { name:symbol, sector:'', cap:'', assetType:'stock' });
  }
  let payloadSource = 'intraday-live-cache';
  let candidates = [...intradayLiveCache.entries()].filter(([symbol, setup]) => isAllowedMobileSetup(symbol, setup)).map(([symbol, setup]) => {
    const meta = mobileMeta.get(symbol) || getSimulationSymbolMetaIndex().get(symbol) || {};
    const assetType = isEtfSimulationSymbol(symbol) ? 'etf' : 'stock';
    const signal = String(setup?.side || setup?.signal || '').toLowerCase();
    const side = ['buy', 'sell'].includes(signal) ? signal : signal;
    const price = Number(setup?.price) || 0;
    const candidate = {
      symbol,
      name:meta.name || symbol,
      sector:meta.sector || setup?.sector || '',
      cap:meta.cap || '',
      assetType:meta.assetType || assetType,
      price,
      score:Number(setup?.score) || 0,
      rawScore:Number(setup?.score) || 0,
      signal,
      side,
      setupType:'',
      derivedSetupType:'',
      indicators:{ ...setup, price },
      quote:{ price, change:Number(setup?.dayChange) || 0 },
    };
    const setupType = deriveLiveSetupType(symbol, setup, settings);
    candidate.setupType = setupType;
    candidate.derivedSetupType = setupType;
    candidate.indicators.setupType = setupType;
    return candidate;
  });
  if (hasUsableMobileCandidates(candidates) && Date.now() - mobileSetupPersistedAt > 30000) {
    try {
      kvSet('mobile_setup_cache', { savedAt:Date.now(), candidates });
      mobileSetupPersistedAt = Date.now();
    } catch (_) {}
  }
  if (!hasUsableMobileCandidates(candidates)) {
    payloadSource = 'snapshot-cache';
    const now = Date.now();
    if (!hasUsableMobileCandidates(mobileSetupSnapshotCache.candidates) || now - mobileSetupSnapshotCache.loadedAt > 60000) {
      const persisted = kvGet('mobile_setup_cache');
      if (hasUsableMobileCandidates(persisted?.candidates)) {
        mobileSetupSnapshotCache = { loadedAt:now, candidates:persisted.candidates };
      } else {
        const snapshots = loadLatestSimulationSnapshots();
        const latest = [...snapshots].reverse().find(snapshot => {
          const rows = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
          return rows.some(candidate => Number(candidate?.price || candidate?.quote?.price || candidate?.indicators?.price) > 0)
            && rows.some(candidate => {
              const change = candidate?.quote?.change ?? candidate?.indicators?.dayChange;
              return change != null && Number.isFinite(Number(change));
            });
        }) || snapshots[snapshots.length - 1];
        mobileSetupSnapshotCache = { loadedAt:now, candidates:Array.isArray(latest?.candidates) ? latest.candidates : [] };
        if (mobileSetupSnapshotCache.candidates.length) {
          try { kvSet('mobile_setup_cache', { savedAt:now, candidates:mobileSetupSnapshotCache.candidates }); } catch (_) {}
        }
      }
    }
    candidates = mobileSetupSnapshotCache.candidates.map(candidate => {
      const symbol = String(candidate?.symbol || '').toUpperCase();
      const side = candidate?.side || candidate?.signal || '';
      const normalized = { ...candidate, symbol, side };
      const setupType = deriveLiveSetupType(symbol, {
        ...(candidate?.indicators || {}),
        ...candidate,
        side,
        setupType:candidate?.setupType,
        derivedSetupType:candidate?.derivedSetupType,
      }, settings);
      return {
        ...normalized,
        setupType,
        derivedSetupType:setupType,
        indicators:{ ...(candidate?.indicators || {}), setupType },
      };
    }).filter(candidate => isAllowedMobileSetup(candidate.symbol, candidate));
  }
  candidates.sort(SimulationEngine.compareCandidates);
  return {
    schemaVersion: 2,
    ok: true,
    source: payloadSource,
    filter,
    at: new Date().toISOString(),
    settings,
    candidates,
    sectorTrend: buildSectorTrendFromCandidates(candidates),
    market: { indices: simulationMarketCache.indices || {} },
  };
}

function buildMobileStockUniverse() {
  const bySymbol = new Map();
  const add = item => {
    const symbol = String(item?.sym || item?.symbol || item || '').trim().toUpperCase();
    if (!symbol || bySymbol.has(symbol)) return;
    bySymbol.set(symbol, typeof item === 'object'
      ? { symbol, name:item.name || symbol, sector:item.sector || '', cap:item.cap || '', source:item.source || 'dashboard' }
      : { symbol, name:symbol, sector:'', cap:'', source:'simulation' });
  };
  loadDashboardStockUniverse().forEach(add);
  loadSavedStocksFile().forEach(add);
  [...getSimulationUniverseSymbols()].forEach(add);
  return { ok:true, count:Math.min(300, bySymbol.size), totalAvailable:bySymbol.size, stocks:[...bySymbol.values()].slice(0, 300) };
}

function buildHealthPayload() {
  return {
    ok: true,
    nse: { cookies: nse.cookies.length, lastRefresh: nse.lastRefresh },
    yahoo: { mode: 'v8/chart (crumb-free)', ok: true },
    openai: { configured: !!OPENAI_API_KEY, model: OPENAI_MODEL, propertiesFile: USER_OPENAI_PROPERTIES },
    ollama: { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL || 'auto', timeoutMs: OLLAMA_TIMEOUT_MS },
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

function isTransientFileWriteError(e) {
  return ['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'].includes(e?.code);
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function writeFileAtomicSync(file, data, options) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tempFile = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  const delays = [25, 75, 150, 300, 600];
  let lastError = null;
  try {
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        fs.writeFileSync(tempFile, data, options);
        fs.renameSync(tempFile, file);
        return;
      } catch (e) {
        lastError = e;
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
        if (!isTransientFileWriteError(e) || attempt === delays.length) throw e;
        sleepSync(delays[attempt]);
      }
    }
  } catch (e) {
    throw e;
  } finally {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
  }
  throw lastError;
}

let simulationSnapshotDatabase = null;

function getSimulationSnapshotDatabase() {
  if (!simulationSnapshotDatabase) {
    simulationSnapshotDatabase = createSnapshotDatabase({ dbPath:SIM_SNAPSHOT_DB_FILE });
  }
  return simulationSnapshotDatabase;
}

function loadSimulationSnapshotsFile(dateKey = null) {
  try {
    const store = getSimulationSnapshotDatabase();
    const selectedDay = dateKey || store.latestDay();
    if (selectedDay) {
      const snapshots = store.loadDay(selectedDay);
      if (snapshots.length) {
        return {
          savedAt:Date.now(),
          retentionDays:SIM_SNAPSHOT_RETENTION_DAYS,
          date:selectedDay,
          snapshots,
          storage:'sqlite',
        };
      }
    }
  } catch (e) {
    console.warn('[simulation-snapshots] Database load error:', e.message);
  }
  return { savedAt:Date.now(), retentionDays:SIM_SNAPSHOT_RETENTION_DAYS, date:dateKey || null, snapshots:[], storage:'sqlite' };
}

const simulationDayCloseCache = new Map();

async function resolveSimulationDayClosePrice(symbol, tradeDay) {
  const normalized = String(symbol || '').trim().toUpperCase();
  const day = String(tradeDay || '');
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const today = getIstDateKey();
  const cached = simulationDayCloseCache.get(day);
  const cacheFresh = cached && (day !== today || Date.now() - cached.loadedAt < 60000);
  let dayState = cacheFresh ? cached : null;
  if (!dayState) {
    const snapshots = loadSimulationSnapshotsFile(day).snapshots
      .filter(snapshot => getIstDateKey(snapshot?.at || snapshot?.savedAt) === day)
      .sort((a, b) => new Date(a?.at || 0) - new Date(b?.at || 0));
    const bySymbol = new Map();
    for (const snapshot of snapshots) {
      const rows = [
        ...(Array.isArray(snapshot?.candidates) ? snapshot.candidates : []),
        ...(Array.isArray(snapshot?.openSimulationTrades) ? snapshot.openSimulationTrades : []),
      ];
      for (const row of rows) {
        const rowSymbol = String(row?.symbol || row?.sym || '').toUpperCase();
        const price = Number(
          row?.priceAtSnapshot
          ?? row?.price
          ?? row?.indicators?.price
          ?? row?.quote?.regularMarketPrice
          ?? row?.ohlc?.close
        );
        if (rowSymbol && price > 0) bySymbol.set(rowSymbol, { price, source:'simulation-closing-snapshot', at:snapshot.at || '' });
      }
    }
    dayState = { loadedAt:Date.now(), latestAt:snapshots.at(-1)?.at || '', bySymbol };
    simulationDayCloseCache.set(day, dayState);
  }
  if (!dayState.latestAt) return null;
  const latestAt = dayState.latestAt;
  if (day === getIstDateKey()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone:'Asia/Kolkata',
      hour:'2-digit',
      minute:'2-digit',
      hourCycle:'h23',
    }).formatToParts(new Date(latestAt));
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    if (!Number.isFinite(hour) || hour * 60 + minute < 15 * 60 + 29) return null;
  }
  return dayState.bySymbol.get(normalized) || null;
}

function loadAllSimulationSnapshots() {
  if (Array.isArray(simulationSnapshotsForTests)) {
    return pruneSimulationSnapshots(simulationSnapshotsForTests).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  }
  try {
    return pruneSimulationSnapshots(getSimulationSnapshotDatabase().loadAll())
      .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  } catch (e) {
    console.warn('[simulation-snapshots] Database load-all error:', e.message);
    return [];
  }
}

function pruneSimulationSnapshots(snapshots) {
  const cutoff = Date.now() - SIM_SNAPSHOT_TTL;
  return (Array.isArray(snapshots) ? snapshots : []).filter(s => {
    const t = new Date(s?.at || s?.savedAt || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
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
    dataQualitySummary:result?.dataQualitySummary || null,
    replayConfidence:result?.replayConfidence || null,
    replayReliability:result?.replayReliability || null,
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

function runQuickReplaySweep(snapshots, baseSettings, maxVariants = 5) {
  const limit = Math.max(1, Math.floor(Number(maxVariants) || 5));
  const ranked = normalizeSweepRows(buildQuickSweepSettings(baseSettings).map(settings => {
    const result = Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings);
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
  }))
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

function runDeepReplaySweep(snapshots, baseSettings, maxVariants = 20) {
  const limit = Math.max(1, Math.floor(Number(maxVariants) || 20));
  const ranked = normalizeSweepRows(buildDeepSweepSettings(baseSettings).map(settings => {
    const result = Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings);
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
  }))
    .sort((a, b) => b.net - a.net || a.maxDrawdown - b.maxDrawdown || b.winRate - a.winRate);
  return uniqueSweepOutcomes(ranked).slice(0, limit);
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
  const versionParts = [];
  try {
    const selectedDay = mode === 'autotune' ? null : day;
    versionParts.push(`snapshot-db:${getSimulationSnapshotDatabase().version(selectedDay)}`);
  } catch (e) {
    versionParts.push(`snapshot-db-error:${e.message}`);
  }
  const paperVersion = proxyDbReady ? String(getTradesUpdatedAt()) : String(fileMtime(PAPER_TRADES_FILE));
  versionParts.push(`paper:${paperVersion}`);
  if (mode === 'report' && day) {
    versionParts.push(`decisions:${fileMtime(path.join(SIM_DECISION_JOURNAL_DIR, `simulation_decisions_${day}.jsonl`))}`);
  }
  return stableHash(versionParts);
}

let replayEngineVersionCache = '';

function replayEngineVersion() {
  if (replayEngineVersionCache) return replayEngineVersionCache;
  const files = [REPLAY_WORKER_FILE, path.join(__dirname, 'backtest_simulation.js'), path.join(__dirname, 'simulation_engine.js'), path.join(__dirname, 'trade_rules.js')];
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(fs.readFileSync(file));
  replayEngineVersionCache = hash.digest('hex').slice(0, 16);
  return replayEngineVersionCache;
}

const REPLAY_CACHE_SCHEMA_VERSION = 'v6';

function replayCacheKey(day, mode, settings) {
  return [
    day || getIstDateKey(),
    mode || 'report',
    REPLAY_CACHE_SCHEMA_VERSION,
    replayEngineVersion(),
    replaySnapshotVersion(day, mode),
    stableHash(settings),
  ].join('|');
}

function replayActiveJobKey(day, mode, settings) {
  return [
    day || getIstDateKey(),
    mode || 'report',
    REPLAY_CACHE_SCHEMA_VERSION,
    replayEngineVersion(),
    stableHash(settings),
  ].join('|');
}

function getCachedReplay(key) {
  const cached = replayResultCache.get(key);
  if (!cached) return null;
  cached.hitAt = Date.now();
  return cached.payload;
}

function persistReplayCacheFile() {
  try {
    const entries = [...replayResultCache.entries()].map(([key, value]) => ({ key, ...value }));
    jsonCacheSet('replay_results', { savedAt: Date.now(), entries }, REPLAY_CACHE_TTL);
  } catch (e) {
    console.warn('[replay-cache] Save error:', e.message);
  }
}

function loadReplayCacheFile() {
  try {
    const raw = jsonCacheGet('replay_results');
    if (!raw) return;
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    for (const entry of entries) {
      if (!entry?.key || !entry.payload) continue;
      replayResultCache.set(entry.key, {
        savedAt: Number(entry.savedAt) || Date.now(),
        hitAt: Number(entry.hitAt) || Number(entry.savedAt) || Date.now(),
        payload: entry.payload,
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

function readReplaySnapshotsForDay(day) {
  const state = loadSimulationSnapshotsFile(day);
  return pruneSimulationSnapshots(state.snapshots || [])
    .filter(s => !day || getIstDateKey(s.at) === day)
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function loadActualTradesForDay(day) {
  if (!day) return [];
  try {
    if (proxyDbReady) {
      return listTrades({ source: 'simulation', status: 'closed' }).filter(t => {
        return toIstDayKey(t.closedAt || t.openedAt || '') === day;
      });
    }
    return loadPaperStateFile().trades.filter(t =>
      t.source === 'simulation' &&
      String(t.status || '').toLowerCase() === 'closed' &&
      toIstDayKey(t.closedAt || t.openedAt || '') === day
    );
  } catch (e) {
    console.warn('[replay] loadActualTradesForDay error:', e.message);
    return [];
  }
}

function buildReplayResponse(day, options = {}) {
  const mode = options.sweep ? 'sweep' : 'report';
  const snapshots = readReplaySnapshotsForDay(day);
  const settings = Backtest.loadSettings({ day, snapshots });
  if (mode === 'report') {
    const exact = Backtest.loadRecordedDecisionCyclesFromSnapshots(snapshots);
    const recorded = exact.size ? exact : Backtest.alignRecordedDecisionCycles(
      snapshots,
      Backtest.loadRecordedDecisionCycles(day),
      settings.REPLAY_RECORDED_MAX_ALIGNMENT_MIN || 6
    );
    if (recorded.size) settings.__recordedDecisionCycles = recorded;
    settings.REPLAY_RECORDED_SOURCE = exact.size ? 'snapshot-keyed' : 'journal-aligned';
  }
  const cacheKey = replayCacheKey(day, mode, settings);
  const cached = getCachedReplay(cacheKey);
  if (cached) return { ...cached, cached:true };
  const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
  const response = {
    ok:true,
    date:day,
    count:snapshots.length,
    result,
    actualTrades:loadActualTradesForDay(day),
  };
  if (options.sweep) {
    response.sweepRows = runQuickReplaySweep(snapshots, settings, 5);
  }
  return setCachedReplay(cacheKey, response);
}

function buildReplayAutoTuneResponse(day) {
  const all = loadAllSimulationSnapshots();
  const days = [...new Set(all.map(s => getIstDateKey(s.at)).filter(Boolean))].sort().slice(-5);
  const recent = all.filter(s => days.includes(getIstDateKey(s.at)));
  const settings = Backtest.loadSettings({ day, snapshots:recent });
  const cacheKey = replayCacheKey(day, 'autotune', settings);
  const cached = getCachedReplay(cacheKey);
  if (cached) return { ...cached, cached:true };
  return setCachedReplay(cacheKey, {
    ok:true,
    date:day,
    days,
    count:recent.length,
    autoTuneRows:runQuickReplaySweep(recent, settings, 3),
  });
}

function buildReplayDeepSweepResponse(day, options = {}) {
  const snapshots = readReplaySnapshotsForDay(day);
  const settings = Backtest.loadSettings({ day, snapshots });
  const cacheKey = replayCacheKey(day, 'deep_sweep', settings);
  const cached = getCachedReplay(cacheKey);
  if (cached) return { ...cached, cached:true };
  if (options.cachedOnly) {
    return {
      ok:true,
      date:day,
      count:0,
      sweepRows:[],
      cached:false,
      pending:true,
      message:'Post-market deep sweep cache not ready yet.',
    };
  }
  const result = compactReplayResult(Backtest.runBacktest(Backtest.cloneSnapshots(snapshots), settings));
  const response = {
    ok:true,
    date:day,
    count:snapshots.length,
    result,
    actualTrades:loadActualTradesForDay(day),
    sweepRows:runDeepReplaySweep(snapshots, settings, 20),
    deepSweep:true,
  };
  return setCachedReplay(cacheKey, response);
}

function replayModeFromParams(params) {
  const mode = String(params?.mode || 'report').toLowerCase();
  return ['report', 'sweep', 'autotune', 'deep_sweep'].includes(mode) ? mode : 'report';
}

function getReplayCacheForMode(day, mode) {
  const snapshots = mode === 'autotune' ? loadAllSimulationSnapshots() : readReplaySnapshotsForDay(day);
  const settings = Backtest.loadSettings({ day, snapshots });
  if (mode === 'report') {
    const exact = Backtest.loadRecordedDecisionCyclesFromSnapshots(snapshots);
    const recorded = exact.size ? exact : Backtest.alignRecordedDecisionCycles(
      snapshots,
      Backtest.loadRecordedDecisionCycles(day),
      settings.REPLAY_RECORDED_MAX_ALIGNMENT_MIN || 6
    );
    if (recorded.size) settings.__recordedDecisionCycles = recorded;
    settings.REPLAY_RECORDED_SOURCE = exact.size ? 'snapshot-keyed' : 'journal-aligned';
  }
  const cacheKey = replayCacheKey(day, mode, settings);
  const activeKey = replayActiveJobKey(day, mode, settings);
  return { settings, cacheKey, activeKey, cached:getCachedReplay(cacheKey) };
}

function releaseReplayJobLock(lockFile) {
  if (!lockFile) return;
  try { fs.unlinkSync(lockFile); } catch (_) {}
}

function createReplayJob(day, mode, options = {}) {
  const { cacheKey, activeKey, cached } = getReplayCacheForMode(day, mode);
  const active = activeReplayJobs.get(activeKey);
  if (active && ['queued', 'running'].includes(active.status)) {
    active.reused = true;
    releaseReplayJobLock(options.lockFile);
    return active;
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, day, mode, cacheKey, activeKey, lockFile:options.lockFile || null, status:'queued', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), result:null, error:null, reused:false };
  replayJobs.set(id, job);
  if (cached) {
    job.status = 'done';
    job.result = { ...cached, cached:true };
    job.updatedAt = new Date().toISOString();
    releaseReplayJobLock(job.lockFile);
    job.lockFile = null;
    return job;
  }
  activeReplayJobs.set(activeKey, job);
  const child = fork(REPLAY_WORKER_FILE, [], { stdio:['ignore', 'ignore', 'pipe', 'ipc'] });
  const workerErrors = [];
  const maxRunMs = mode === 'deep_sweep' ? 1800000 : mode === 'sweep' ? 600000 : mode === 'autotune' ? 720000 : 120000;
  let watchdog = null;
  const finalizeActiveJob = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (activeReplayJobs.get(activeKey)?.id === job.id) activeReplayJobs.delete(activeKey);
    releaseReplayJobLock(job.lockFile);
    job.lockFile = null;
    job.updatedAt = new Date().toISOString();
  };
  const disconnectReplayChild = () => {
    if (!child.connected) return;
    try {
      child.disconnect();
    } catch (e) {
      if (e?.code !== 'ERR_IPC_CHANNEL_CLOSED') workerErrors.push(e?.message || String(e));
    }
  };
  const finishWithInlineFallback = (reason) => {
    // Sweep modes are intentionally worker-only. Re-running a failed sweep in
    // the live proxy can consume gigabytes and starve health/SSE requests.
    if (mode !== 'report') {
      job.status = 'error';
      const details = workerErrors.join(' | ');
      job.error = [reason || 'Replay worker failed', details].filter(Boolean).join(' | ');
      job.fallback = false;
      finalizeActiveJob();
      return;
    }
    try {
      const payload = buildReplayResponse(day, { sweep:false });
      job.result = setCachedReplay(cacheKey, payload);
      job.status = 'done';
      job.fallback = true;
      job.fallbackReason = reason || 'worker-fallback';
    } catch (e) {
      job.status = 'error';
      const details = workerErrors.join(' | ');
      job.error = [reason, e?.stack || e?.message || String(e), details].filter(Boolean).join(' | ');
    }
    finalizeActiveJob();
  };
  job.status = 'running';
  job.workerPid = child.pid;
  job.updatedAt = new Date().toISOString();
  child.stderr?.on('data', chunk => {
    const line = String(chunk || '').trim();
    if (!line) return;
    workerErrors.push(line);
    if (workerErrors.length > 12) workerErrors.shift();
    console.warn('[replay-worker]', line);
  });
  child.on('message', message => {
    if (job.status === 'done' || job.status === 'error') return;
    if (message && typeof message === 'object' && message.ok === true) {
      job.result = setCachedReplay(cacheKey, message.payload);
      job.status = 'done';
      finalizeActiveJob();
      disconnectReplayChild();
      return;
    }
    if (message && typeof message === 'object' && message.ok === false) {
      const reason = message.error || workerErrors.join(' | ') || 'Replay worker failed';
      finishWithInlineFallback(reason);
      disconnectReplayChild();
      return;
    } else {
      // Ignore unexpected IPC messages; wait for success/error/exit.
      return;
    }
  });
  child.on('error', e => {
    if (job.status === 'done' || job.status === 'error') return;
    finishWithInlineFallback(e?.stack || e?.message || String(e));
  });
  child.on('exit', (code, signal) => {
    if (job.status === 'done' || job.status === 'error') return;
    finishWithInlineFallback(`Replay worker exited (${signal || code})`);
  });
  watchdog = setTimeout(() => {
    if (job.status !== 'running') return;
    job.status = 'error';
    job.error = `Replay worker timed out after ${Math.round(maxRunMs / 1000)}s`;
    try { process.kill(child.pid, 'SIGTERM'); } catch (_) {}
    finalizeActiveJob();
  }, maxRunMs);
  if (child.connected) {
    child.send({ day, mode }, e => {
      if (e && job.status !== 'done' && job.status !== 'error') {
        finishWithInlineFallback(e?.stack || e?.message || String(e));
      }
    });
  } else {
    finishWithInlineFallback('Replay worker IPC channel was not available');
  }
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
    candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings, snapshot.at);
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
  const raw = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidates = raw
    .sort((a, b) => Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0))
    .slice(0, 200);
  const at = new Date().toISOString();
  const decisionCycle = payload.decisionCycle && typeof payload.decisionCycle === 'object'
    ? { ...payload.decisionCycle, sourceSnapshotAt:payload.decisionCycle.snapshotAt || null, snapshotAt:at }
    : null;
  return {
    schemaVersion: 2,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    source: String(payload.source || 'intraday-refresh'),
    dataSource: String(payload.dataSource || ''),
    currentView: String(payload.currentView || ''),
    simulationState: String(payload.simulationState || ''),
    caps: payload.caps && typeof payload.caps === 'object' ? payload.caps : {},
    settingsFingerprint:String(payload.settingsFingerprint || ''),
    dayStats: payload.dayStats && typeof payload.dayStats === 'object' ? payload.dayStats : {},
    portfolio:payload.portfolio && typeof payload.portfolio === 'object' ? payload.portfolio : {},
    market: payload.market && typeof payload.market === 'object' ? payload.market : {},
    sectorTrend: payload.sectorTrend && typeof payload.sectorTrend === 'object' ? payload.sectorTrend : {},
    openSimulationTrades: Array.isArray(payload.openSimulationTrades) ? payload.openSimulationTrades.slice(0, 20) : [],
    outcomeSummary: payload.outcomeSummary && typeof payload.outcomeSummary === 'object' ? payload.outcomeSummary : {},
    rankedCandidates:Array.isArray(payload.rankedCandidates) ? payload.rankedCandidates.slice(0, 1000) : [],
    decisionCycle,
    candidates,
    candidateCount: Number.isFinite(Number(payload.candidateCount)) ? Number(payload.candidateCount) : candidates.length,
  };
}

function appendSimulationSnapshot(payload) {
  const snapshot = sanitizeSimulationSnapshot(payload || {});
  const day = getIstDateKey(snapshot.at || Date.now());
  const store = getSimulationSnapshotDatabase();
  const result = store.appendSnapshot(day, snapshot, SIM_SNAPSHOT_BUCKET_MS);
  store.prune(SIM_SNAPSHOT_RETENTION_DAYS);
  if (!result.changed) throw new Error('Snapshot database write was not applied');
  return { day, count:result.count, snapshot, storage:'sqlite' };
}

const SIM_SNAPSHOT_BUCKET_MS = 2 * 60 * 1000;
let simulationSnapshotWriterBusy = false;
let simulationSnapshotPendingWrite = null;

function startQueuedSimulationSnapshotWrite() {
  if (simulationSnapshotWriterBusy || !simulationSnapshotPendingWrite) return;
  const pending = simulationSnapshotPendingWrite;
  simulationSnapshotPendingWrite = null;
  simulationSnapshotWriterBusy = true;
  const worker = new Worker(path.join(__dirname, 'server', 'snapshot-writer-worker.js'), {
    workerData: {
      dbFile:SIM_SNAPSHOT_DB_FILE,
      date:pending.day,
      snapshot:pending.snapshot,
      retentionDays:SIM_SNAPSHOT_RETENTION_DAYS,
      bucketMs:SIM_SNAPSHOT_BUCKET_MS,
    },
  });
  let settled = false;
  const finish = result => {
    if (settled) return;
    settled = true;
    simulationSnapshotWriterBusy = false;
    if (result?.ok) {
      console.log(`[simulation-snapshots] Database write complete: ${result.count} snapshots, ${result.bytes} compressed bytes, ${result.durationMs}ms`);
    } else {
      console.warn('[simulation-snapshots] Background write failed:', result?.error || 'worker exited');
    }
    startQueuedSimulationSnapshotWrite();
  };
  worker.once('message', finish);
  worker.once('error', error => finish({ ok:false, error:error.message }));
  worker.once('exit', code => {
    if (code !== 0) finish({ ok:false, error:`worker exited with code ${code}` });
  });
}

function queueSimulationSnapshotWrite(payload) {
  const snapshot = sanitizeSimulationSnapshot(payload || {});
  const day = getIstDateKey(snapshot.at || Date.now());
  // Snapshot history is point-in-time evidence. If a write is already running,
  // retain only the newest pending point instead of allowing an unbounded queue.
  simulationSnapshotPendingWrite = { day, snapshot };
  startQueuedSimulationSnapshotWrite();
}

async function persistServerSimulationSnapshot(source = 'intraday-live-refresh', changedSymbols = []) {
  try {
    const runtime = loadSimulationRuntime();
    const overrideSettings = loadTradeSettingsFile().overrides || {};
     const settings = SimulationEngine.withDefaults ? SimulationEngine.withDefaults(overrideSettings) : overrideSettings;
    const symbolMetaBySymbol = getSimulationSymbolMetaIndex();
    const allCandidates = buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol);
    const sectorTrend = buildSectorTrendFromCandidates(allCandidates);
    const sectorStats = SimulationEngine.buildSectorPriorityStats(allCandidates);
    for (const candidate of allCandidates) {
      SimulationEngine.applySectorPriority(candidate, sectorStats, { sectorTrend }, settings);
    }
    const candidates = selectServerSnapshotCandidates(allCandidates);
    const selectedKeys = new Set(candidates.map(candidate => `${String(candidate?.symbol || '').toUpperCase()}|${String(candidate?.side || candidate?.signal || '').toLowerCase()}`));
    const rankedCandidates = allCandidates
      .slice()
      .sort((left, right) => Math.abs(Number(right?.score) || 0) - Math.abs(Number(left?.score) || 0))
      .map((candidate, index) => ({
        symbol:String(candidate?.symbol || '').toUpperCase(),
        side:String(candidate?.side || candidate?.signal || '').toLowerCase(),
        assetType:String(candidate?.assetType || 'stock').toLowerCase(),
        setupType:candidate?.derivedSetupType || candidate?.setupType || candidate?.indicators?.setupType || null,
        score:Number(candidate?.score) || 0,
        rank:index + 1,
        selected:selectedKeys.has(`${String(candidate?.symbol || '').toUpperCase()}|${String(candidate?.side || candidate?.signal || '').toLowerCase()}`),
        blockReason:candidate?.blockReason || candidate?.entryBlockReason || candidate?.indicators?.blockReason || '',
      }));
    const managementCandidateBySymbol = new Map(allCandidates.map(candidate => [
      String(candidate?.symbol || '').toUpperCase(),
      candidate,
    ]));
    const market = await getSimulationMarketContext();
    const paperState = loadPaperStateFile();
    const trades = paperState.trades || [];
    const snapshotAt = new Date().toISOString();
    const dayStats = TradeRules.buildDayStats(trades, snapshotAt, settings, { sameDay:sameIstDay });
    const portfolioMetrics = TradeRules.computePortfolioEquity(paperState.portfolio, trades, 500000);
    const allTimeRealizedPnl = Number.isFinite(Number(paperState.portfolio?.realizedPnl))
      ? Number(paperState.portfolio.realizedPnl)
      : portfolioMetrics.realized;
    const snapshotEquity = portfolioMetrics.capital + allTimeRealizedPnl;
    const snapshotCashAvailable = Math.max(0, snapshotEquity - portfolioMetrics.openExposure);
    const openSimulationTrades = trades
      .filter(trade => trade?.status === 'open' && String(trade?.source || '').toLowerCase() === 'simulation')
      .slice(0, 20)
      .map(trade => {
        const symbol = String(trade?.symbol || '').toUpperCase();
        const setup = intradayLiveCache.get(symbol) || {};
        const managementCandidate = managementCandidateBySymbol.get(symbol) || trade?.managementCandidate || null;
        return {
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.qty,
          entryPrice: trade.entryPrice,
          priceAtSnapshot: Number(setup?.price) || null,
          ohlc: setup?.ohlc || null,
          setupType: trade.setupType || null,
          target: trade.target,
          stop: trade.stop,
          openedAt: trade.openedAt,
          managementCandidate:SimulationEngine.buildManagementCandidateSnapshot(managementCandidate),
        };
      });
    queueSimulationSnapshotWrite({
      source: `server-${source || 'intraday-live-refresh'}`,
      dataSource: 'server',
      currentView: 'server',
      simulationState: runtime.state,
      caps: settings,
      settingsFingerprint:SimulationEngine.stableAuditFingerprint(SimulationEngine.buildSettingsAuditSnapshot(settings)),
      dayStats,
      portfolio:{
        at:snapshotAt,
        capital:portfolioMetrics.capital,
        equity:snapshotEquity,
        cashAvailable:snapshotCashAvailable,
        openExposure:portfolioMetrics.openExposure,
        realizedPnl:allTimeRealizedPnl,
      },
      market,
      sectorTrend,
      openSimulationTrades,
      outcomeSummary: {
        changedSymbols: Array.isArray(changedSymbols) ? changedSymbols.slice(0, 100) : [],
      },
      candidates,
      rankedCandidates,
      decisionCycle:simulationLatestDecisionCycle,
      candidateCount: candidates.length,
    });
  } catch (e) {
    console.warn('[simulation-snapshots] Server snapshot persist failed:', e.message);
  }
}

function computePaperTradePnl(trade, exitPrice) {
  return SimulationEngine.getPaperTradePnl(trade, exitPrice) || { pnl:null, pnlPct:null };
}

function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy') {
  return SimulationEngine.estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side);
  /* legacy formula retained below for source compatibility */
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

const NSE_SYMBOL_ALIASES = {
  WOCKPHARM: 'WOCKPHARMA',
};

function resolveNseSymbol(symbol) {
  const clean = cleanTradingSymbol(symbol);
  return NSE_SYMBOL_ALIASES[clean] || clean;
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

function getActiveLiveBrokerKey() {
  if (brokerMode === 'sharekhan_live') return 'sharekhan';
  if (brokerMode === 'zerodha_live') return 'zerodha';
  return null;
}

function brokerNameFromParam(value) {
  const name = String(value || '').trim().toLowerCase();
  if (name === 'sharekhan') return 'sharekhan';
  if (name === 'zerodha' || name === 'kite') return 'zerodha';
  return '';
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBrokerAuthPage({ ok, broker, title, message }) {
  const payload = JSON.stringify({ type:'broker-auth', ok:!!ok, broker, message:String(message || '') });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>
    body{margin:0;background:#0c1114;color:#f4f7f8;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}
    main{width:min(420px,calc(100vw - 28px));border:1px solid #2d3941;border-radius:12px;background:#151c21;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
    h1{font-size:18px;margin:0 0 8px}.msg{color:#94a2aa;line-height:1.45}.ok{color:#2fd17c}.bad{color:#ff626f}button{margin-top:16px;padding:9px 14px;border-radius:8px;border:1px solid #2d3941;background:#1d262c;color:#f4f7f8;font-weight:800}
  </style></head><body><main><h1 class="${ok ? 'ok' : 'bad'}">${htmlEscape(title)}</h1><div class="msg">${htmlEscape(message)}</div><button onclick="window.close()">Close</button></main><script>
    try { if (window.opener) window.opener.postMessage(${payload}, '*'); } catch (_) {}
    if (${ok ? 'true' : 'false'}) setTimeout(() => window.close(), 1400);
  </script></body></html>`;
}

function sendBrokerAuthHtml(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(renderBrokerAuthPage(payload));
}

function getBrokerRefreshPath(req, broker) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}/broker/refresh/${encodeURIComponent(broker)}`;
}

function readBrokerAuthParams(searchParams) {
  let rawName = String(searchParams.get('name') || '');
  let requestToken = String(
    searchParams.get('request_token') ||
    searchParams.get('requestToken') ||
    searchParams.get('token') ||
    searchParams.get('enctoken') ||
    ''
  );

  const commaMatch = rawName.match(/^([^,]+),\s*(?:request_token|requestToken|token|enctoken)=(.+)$/i);
  if (commaMatch) {
    rawName = commaMatch[1];
    if (!requestToken) requestToken = commaMatch[2];
  }

  return {
    broker: brokerNameFromParam(rawName),
    // URLSearchParams decodes '+' as space; restore it for base64 tokens
    requestToken: requestToken.trim().replace(/ /g, '+'),
  };
}

function buildBrokerLoginUrl(req, broker) {
  if (broker === 'zerodha') {
    const creds = loadCredentials();
    if (!creds?.apiKey) throw new Error('ZERODHA_API_KEY is not configured');
    return new KiteConnect({ api_key:creds.apiKey }).getLoginURL();
  }
  if (broker === 'sharekhan') {
    const creds = loadSharekhanCredentials({ requireSession:false });
    if (!creds?.apiKey) throw new Error('SHAREKHAN_API_KEY is not configured');
    const callback = getBrokerRefreshPath(req, 'sharekhan');
    const params = new URLSearchParams({ api_key:creds.apiKey, state:'stock-watcher' });
    if (creds.vendorKey) params.set('vender_key', creds.vendorKey);
    params.set('redirect_url', callback);
    return `https://api.sharekhan.com/skapi/auth/login.html?${params.toString()}`;
  }
  throw new Error('Unsupported broker');
}

async function exchangeZerodhaRequestToken(requestToken) {
  const creds = loadCredentials();
  if (!creds?.apiKey || !creds?.apiSecret) throw new Error('Zerodha API key/secret are not configured');
  const kite = new KiteConnect({ api_key:creds.apiKey });
  const session = await kite.generateSession(requestToken, creds.apiSecret);
  const accessToken = session?.access_token || '';
  const refreshToken = session?.refresh_token || '';
  if (!accessToken) throw new Error('Zerodha did not return an access token');
  saveCredentialsTokens({ requestToken, accessToken, refreshToken });
  await ensureZerodhaInitialized({ force:true });
  return { accessToken, refreshToken };
}

async function exchangeSharekhanRequestToken(requestToken) {
  const creds = loadSharekhanCredentials({ requireSession:false });
  if (!creds?.apiKey || !creds?.customerId || !creds?.secretKey) throw new Error('Sharekhan API key, customer id, or secret key is not configured');
  const client = new SharekhanClient({ ...creds, requestToken });
  const ok = await client.refreshAccessToken();
  if (!ok || !client.accessToken) throw new Error('Sharekhan did not return an access token');
  saveSharekhanTokens({ requestToken, accessToken:client.accessToken });
  await ensureSharekhanInitialized({ force:true });
  return { accessToken:client.accessToken };
}

function buildSharekhanLiveOrder(payload, trade, phase = 'entry', scripCode = 0) {
  const side = String(payload?.side || trade?.side || 'buy').toLowerCase();
  const isExit = phase === 'exit';
  const qty = Math.floor(Number(payload?.qty ?? trade?.qty));
  const price = Number(isExit ? payload?.exitPrice : payload?.entryPrice ?? trade?.entryPrice);
  const symbol = cleanTradingSymbol(payload?.symbol || trade?.symbol);
  const resolvedScripCode = Number(payload?.scripCode || trade?.broker?.scripCode || scripCode || 0);
  if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(resolvedScripCode) || resolvedScripCode <= 0) return null;
  const transactionType = isExit
    ? (side === 'sell' ? 'B' : 'S')
    : (side === 'sell' ? 'S' : 'B');
  return {
    exchange: 'NC',
    scripCode: resolvedScripCode,
    tradingSymbol: symbol,
    transactionType,
    quantity: qty,
    price:+price.toFixed(2),
    requestType: 'NEW',
    productType: 'INTRADAY',
    validity: 'GFD',
    orderType: 'NORMAL',
  };
}

function hasLiveTradeConfirmation(req, payload = {}) {
  return String(req.headers?.['x-live-trade-confirm'] || payload.liveConfirm || '').trim().toUpperCase() === 'LIVE';
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
  } catch (e) { console.warn('[ollama] Could not detect model:', e.message); }
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
const stockNewsRefreshInFlight = new Map();

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

function resultHeadlineNumber(text, labels, kind = 'amount') {
  const label = `(?:${labels.join('|')})`;
  const source = String(text || '').replace(/\u00a0/g, ' ');
  if (kind === 'amount') {
    const after = source.match(new RegExp(`${label}\\s*(?:(?:rose|rises?|jump(?:s|ed)?|surge(?:s|d)?|soar(?:s|ed)?|grew|grows?|up|down|fell|falls?|drop(?:s|ped)?|decline(?:s|d)?)\\s*(?:by\\s*)?[\\d.]+%\\s*(?:yoy\\s*)?)?(?:(?:to|at|of|was|reaches?|hits?|stood\\s+at)\\s*)?(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:crores?|cr)\\b`, 'i'));
    const before = source.match(new RegExp(`(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:crores?|cr)\\s+${label}\\b`, 'i'));
    const raw = after?.[1] || before?.[1];
    return raw ? Number(raw.replace(/,/g, '')) : null;
  }
  const positive = '(?:up|jump(?:s|ed)?|surge(?:s|d)?|soar(?:s|ed)?|rise(?:s|n)?|rose|grow(?:s|th|n)?|increase(?:s|d)?)';
  const negative = '(?:down|drop(?:s|ped)?|fall(?:s|en)?|fell|decline(?:s|d)?|decrease(?:s|d)?)';
  const after = source.match(new RegExp(`${label}[^%,;|]{0,55}?(${positive}|${negative})\\s*(?:by|of|to)?\\s*([\\d.]+)%`, 'i'));
  if (after) return new RegExp(`^${negative}$`, 'i').test(after[1]) ? -Number(after[2]) : Number(after[2]);
  const before = source.match(new RegExp(`([\\d.]+)%\\s*(?:yoy\\s*)?${label}\\s+growth`, 'i'));
  if (before) return Number(before[1]);
  const growth = source.match(new RegExp(`${label}\\s+(?:yoy\\s+)?growth\\s*(?:of|at|:)?\\s*([+-]?[\\d.]+)%`, 'i'));
  return growth ? Number(growth[1]) : null;
}

function parseResultHeadlineMetrics(title) {
  const text = String(title || '');
  return {
    revenueCr: resultHeadlineNumber(text, ['revenue', 'sales', 'total income']),
    profitBeforeTaxCr: resultHeadlineNumber(text, ['profit before tax', 'pbt']),
    profitAfterTaxCr: resultHeadlineNumber(text, ['net profit', 'profit after tax', 'pat', 'profit']),
    eps: (() => {
      const match = text.match(/\b(?:eps|earnings per share)\b[^₹\d-]{0,20}(?:₹|rs\.?)?\s*(-?[\d.]+)/i);
      return match ? Number(match[1]) : null;
    })(),
    revenueGrowthPct: resultHeadlineNumber(text, ['revenue', 'sales', 'total income'], 'growth'),
    patGrowthPct: resultHeadlineNumber(text, ['net profit', 'profit after tax', 'pat', 'profit'], 'growth'),
    epsGrowthPct: resultHeadlineNumber(text, ['eps', 'earnings per share'], 'growth'),
  };
}

function classifyResultGrowthMetrics(metrics) {
  const revGrowth = Number.isFinite(metrics?.revenueGrowthPct) ? metrics.revenueGrowthPct : null;
  const patGrowth = Number.isFinite(metrics?.patGrowthPct) ? metrics.patGrowthPct : null;
  const epsGrowth = Number.isFinite(metrics?.epsGrowthPct) ? metrics.epsGrowthPct : null;
  const checks = [revGrowth, patGrowth, epsGrowth].filter(value => value != null);
  if (!checks.length) return { verdict:null, reason:null };
  let score = 0;
  if (revGrowth != null) score += revGrowth >= 5 ? 1 : revGrowth <= -5 ? -1 : 0;
  if (patGrowth != null) score += patGrowth >= 5 ? 2 : patGrowth <= -5 ? -2 : 0;
  if (epsGrowth != null) score += epsGrowth >= 5 ? 1 : epsGrowth <= -5 ? -1 : 0;
  const verdict = score >= 1 ? 'Positive' : score <= -1 ? 'Negative' : 'Mixed';
  const parts = [];
  if (revGrowth != null) parts.push(`Revenue ${revGrowth >= 0 ? '+' : ''}${revGrowth}%`);
  if (patGrowth != null) parts.push(`PAT ${patGrowth >= 0 ? '+' : ''}${patGrowth}%`);
  if (epsGrowth != null) parts.push(`EPS ${epsGrowth >= 0 ? '+' : ''}${epsGrowth}%`);
  return { verdict, reason:parts.join(', ') };
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
      return parseNseJsonResponse(r, label);
    } catch(e) {
      lastErr = e;
      const retryable = isNSETransientError(e);
      if (!retryable || attempt === retries) break;
      await new Promise(r => setTimeout(r, attempt * 750));
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

const resultCalendarService = createResultCalendarService({
  cacheDir:path.join(APP_CACHE_DIR, 'result_calendar'),
  nseJsonWithRetry,
  stripHtml,
  toISODateOrNull,
  getResultCalendarSymbols:loadResultCalendarSymbols,
});

const freshNewsService = createFreshNewsService({
  cacheFile:FRESH_NEWS_CACHE_FILE,
  cacheDir:FRESH_NEWS_CACHE_DIR,
  indexFile:FRESH_NEWS_CACHE_INDEX_FILE,
  dashboardAppPath:path.join(__dirname, 'dashboard-app.js'),
  loadSavedStocksFile,
  classifyNewsItem,
  classifyNewsTradeImpact,
  isDbReady:() => proxyDbReady,
  dbSaveFreshNews,
  fetchNSEAllAnnouncements,
  fetchNSEAllResults,
  fetchNSEAllCorporateActions,
  fetchNSEAllBoardMeetings:() => resultCalendarService.fetchNSEAllBoardMeetings(),
  fetchNSEStockAnnouncements,
});

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
      // Ex/record dates are effective dates, not publication timestamps.
      publishedAt: toISODateOrNull(item.an_dt || item.sort_date || item.dissemDT || item.dt),
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
      publishedAt: toISODateOrNull(item.bm_timestamp || item.an_dt || item.sort_date || item.dissemDT),
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
    return rows.slice(0, 1200).map(item => {
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
        publishedAt:toISODateOrNull(item.an_dt || item.sort_date || item.dissemDT || item.dt),
        url:symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : '',
      };
    }).filter(x => x.symbol && x.title);
  } catch(e) {
    console.warn('[fresh-news] NSE all corporate actions failed:', e.message);
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
    const aPinned = a.type === 'Result Filing';
    const bPinned = b.type === 'Result Filing';
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aTime = Date.parse(a.publishedAt || a.filingDate || a.eventDate || a.exDate || a.recordDate || a.toDate || 0) || 0;
    const bTime = Date.parse(b.publishedAt || b.filingDate || b.eventDate || b.exDate || b.recordDate || b.toDate || 0) || 0;
    if (aTime !== bTime) return bTime - aTime;
    const ap = priority[a.type] ?? 9;
    const bp = priority[b.type] ?? 9;
    return ap - bp;
  });
}

function eventHighlights(items, max = 10) {
  return sortEvents(items).slice(0, max);
}

function selectResultNewsFallback(items, events) {
  const filing = sortEvents((events || []).filter(item => item?.type === 'Result Filing'))[0];
  const filingAt = Date.parse(filing?.publishedAt || filing?.filingDate || 0) || 0;
  if (!filingAt) return null;
  const maxDistanceMs = 3 * 24 * 60 * 60 * 1000;
  const hasMatchingDetailedResult = (events || []).some(item => {
    if (item?.type !== 'Results') return false;
    const resultAt = Date.parse(item?.publishedAt || item?.filingDate || item?.eventDate || item?.toDate || 0) || 0;
    return resultAt && Math.abs(resultAt - filingAt) <= maxDistanceMs;
  });
  if (hasMatchingDetailedResult) return null;
  return (items || [])
    .filter(item => item?.type === 'Results')
    .map(item => {
      const publishedAt = Date.parse(item?.publishedAt || 0) || 0;
      const distance = publishedAt ? Math.abs(publishedAt - filingAt) : Infinity;
      const text = String(item?.title || '').toLowerCase();
      const relevance =
        (/financial results?|quarterly results?|q[1-4]\s*(?:fy)?\d* results?/.test(text) ? 3 : 0) +
        (/\bearnings?\b|\bprofit\b|\brevenue\b/.test(text) ? 2 : 0) +
        (Object.values(parseResultHeadlineMetrics(text)).filter(value => value != null).length * 2) +
        (/\bdividend\b/.test(text) ? -1 : 0);
      return { item, distance, relevance };
    })
    .filter(row => row.distance <= maxDistanceMs)
    .sort((a, b) => (b.relevance - a.relevance) || (a.distance - b.distance))[0]?.item || null;
}

function enrichResultNewsFallback(item, items, events) {
  if (!item) return null;
  const filing = sortEvents((events || []).filter(event => event?.type === 'Result Filing'))[0];
  const filingAt = Date.parse(filing?.publishedAt || filing?.filingDate || 0) || 0;
  const maxDistanceMs = 3 * 24 * 60 * 60 * 1000;
  const related = (items || []).filter(candidate => {
    if (candidate?.type !== 'Results') return false;
    const publishedAt = Date.parse(candidate?.publishedAt || 0) || 0;
    return filingAt && publishedAt && Math.abs(publishedAt - filingAt) <= maxDistanceMs;
  });
  const metrics = {};
  for (const candidate of [item, ...related]) {
    const parsed = parseResultHeadlineMetrics(candidate?.title);
    for (const [key, value] of Object.entries(parsed)) {
      if (metrics[key] == null && value != null && Number.isFinite(Number(value))) metrics[key] = Number(value);
    }
  }
  const verdict = classifyResultGrowthMetrics(metrics);
  return {
    ...item,
    ...metrics,
    resultVerdict:verdict.verdict,
    resultVerdictReason:verdict.reason,
  };
}

function attachMetricsToMatchingResultFiling(events, result) {
  if (!result) return null;
  const resultAt = Date.parse(result.publishedAt || result.filingDate || 0) || 0;
  const maxDistanceMs = 3 * 24 * 60 * 60 * 1000;
  const filing = (events || [])
    .filter(item => item?.type === 'Result Filing')
    .map(item => ({
      item,
      distance:Math.abs((Date.parse(item.publishedAt || item.filingDate || 0) || 0) - resultAt),
    }))
    .filter(row => resultAt && row.distance <= maxDistanceMs)
    .sort((a, b) => a.distance - b.distance)[0]?.item;
  if (!filing) return null;
  const metricFields = [
    'revenueCr', 'profitBeforeTaxCr', 'profitAfterTaxCr', 'eps',
    'revenueGrowthPct', 'patGrowthPct', 'epsGrowthPct',
    'resultVerdict', 'resultVerdictReason',
  ];
  for (const field of metricFields) {
    if (filing[field] == null && result[field] != null) filing[field] = result[field];
  }
  filing.resultMetrics = metricFields.some(field => filing[field] != null);
  if (!filing.resultMetricsSource) filing.resultMetricsSource = result.title || null;
  return filing;
}

function stockNewsCacheKey(symbol, name, assetType = 'stock') {
  const sym = String(symbol || '').trim().toUpperCase();
  const company = String(name || '').trim();
  const isETF = String(assetType || '').toLowerCase() === 'etf';
  return `${sym}|${isETF ? 'etf' : 'stock'}|${company}`;
}

async function fetchStockNews(symbol, name, assetType = 'stock') {
  const sym = String(symbol || '').trim().toUpperCase();
  const company = String(name || '').trim();
  const isETF = String(assetType || '').toLowerCase() === 'etf';
  const cacheKey = stockNewsCacheKey(sym, company, assetType);
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
        `${base} quarterly results revenue net profit EPS`,
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
        if (item?.source === 'NSE' && ['Results', 'Result Filing', 'Dividend', 'Corporate Action', 'Board Meeting', 'Result Date'].includes(item?.type)) events.push(item);
        else items.push(item);
      }
    }
    else if (r.status === 'fulfilled' && r.value && r.value.type === 'Results') events.unshift(r.value);
    else if (r.status === 'rejected') console.warn('[stock-news] source failed:', r.reason?.message || r.reason);
  }
  const resultFallbackSource = selectResultNewsFallback(items, events);
  const resultFallback = enrichResultNewsFallback(resultFallbackSource, items, events);
  if (resultFallback) {
    attachMetricsToMatchingResultFiling(events, resultFallback);
    events.push({ ...resultFallback, resultFallback:true });
    const fallbackIndex = items.indexOf(resultFallbackSource);
    if (fallbackIndex >= 0) items.splice(fallbackIndex, 1);
  }
  const data = {
    ok: true,
    symbol: sym,
    name: company || sym,
    assetType: isETF ? 'etf' : 'stock',
    savedAt: Date.now(),
    events: eventHighlights(events, 10).map(item => ({ ...item, ...classifyNewsTradeImpact(item) })),
    news: dedupeNews(items).slice(0, 24).map(item => ({ ...item, ...classifyNewsTradeImpact(item) })),
  };
  stockNewsCache[cacheKey] = { savedAt: Date.now(), data };
  return data;
}

function scheduleStockNewsRefresh(symbol, name, assetType = 'stock') {
  const sym = String(symbol || '').trim().toUpperCase();
  const cacheKey = stockNewsCacheKey(sym, name, assetType);
  const existing = stockNewsRefreshInFlight.get(cacheKey);
  if (existing) return existing;
  const job = new Promise(resolve => setImmediate(resolve))
    .then(() => fetchStockNews(sym, name, assetType))
    .catch(error => {
      console.warn(`[stock-news] background refresh failed for ${sym}:`, error.message);
      return null;
    })
    .finally(() => {
      stockNewsRefreshInFlight.delete(cacheKey);
    });
  stockNewsRefreshInFlight.set(cacheKey, job);
  return job;
}

function istDateKeyFromValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function replayDeepSweepDelayMs(now = new Date()) {
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + offsetMs);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const [slotH, slotM] = REPLAY_DEEP_SWEEP_TIME_IST.split(':').map(Number);
  for (let add = 0; add < 8; add++) {
    const candidateIstMs = Date.UTC(y, m, d + add, slotH, slotM, 0, 0);
    const candidateIst = new Date(candidateIstMs);
    const day = candidateIst.getUTCDay();
    if (day === 0 || day === 6) continue;
    const candidateUtcMs = candidateIstMs - offsetMs;
    if (candidateUtcMs > now.getTime() + 5000) return candidateUtcMs - now.getTime();
  }
  return 12 * 60 * 60 * 1000;
}

function replayDeepSweepLockFile(day) {
  return path.join(APP_CACHE_DIR, `replay_deep_sweep_${day}.lock`);
}

function tryAcquireReplayDeepSweepLock(day, staleMs = 2 * 60 * 60 * 1000) {
  const lockFile = replayDeepSweepLockFile(day);
  try {
    if (!fs.existsSync(APP_CACHE_DIR)) fs.mkdirSync(APP_CACHE_DIR, { recursive: true });
    const fd = fs.openSync(lockFile, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid:process.pid, day, acquiredAt:Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
    return lockFile;
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
  }

  try {
    const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (Number.isFinite(ageMs) && ageMs > staleMs) {
      try { fs.unlinkSync(lockFile); } catch (_) {}
      return tryAcquireReplayDeepSweepLock(day, staleMs);
    }
  } catch (_) {}
  return null;
}

async function ensureDeepSweepForDay(day, reason = 'scheduled') {
  let lockFile = null;
  try {
    const mode = 'deep_sweep';
    const { cached } = getReplayCacheForMode(day, mode);
    if (cached?.sweepRows?.length) {
      console.log(`[replay-deep-sweep] Cache already present for ${day} (${reason})`);
      return;
    }
    lockFile = tryAcquireReplayDeepSweepLock(day);
    if (!lockFile) {
      console.log(`[replay-deep-sweep] Job already locked for ${day} (${reason})`);
      return;
    }
    const job = createReplayJob(day, mode, { lockFile });
    lockFile = null;
    console.log(`[replay-deep-sweep] Job ${job.id} ${job.status} for ${day} (${reason})`);
  } catch (e) {
    releaseReplayJobLock(lockFile);
    console.warn(`[replay-deep-sweep] Failed for ${day}:`, e.message);
  }
}

function scheduleNextDeepSweep() {
  if (replayDeepSweepTimer) clearTimeout(replayDeepSweepTimer);
  const delay = replayDeepSweepDelayMs();
  replayDeepSweepTimer = setTimeout(async () => {
    try {
      await ensureDeepSweepForDay(getIstDateKey(), 'scheduled-close');
    } catch (e) {
      console.warn('[replay-deep-sweep] Scheduled run failed:', e.message);
    } finally {
      scheduleNextDeepSweep();
    }
  }, delay);
  if (replayDeepSweepTimer.unref) replayDeepSweepTimer.unref();
  console.log(`[replay-deep-sweep] Next post-close run in ${Math.round(delay / 60000)}m`);
}

function startReplayDeepSweepScheduler() {
  if (!REPLAY_DEEP_SWEEP_SCHEDULE_ENABLED) {
    console.log('[replay-deep-sweep] Automatic scheduler disabled; set REPLAY_DEEP_SWEEP_SCHEDULE=1 to enable');
    return;
  }
  scheduleNextDeepSweep();
  if (!REPLAY_DEEP_SWEEP_STARTUP_ENABLED) {
    console.log('[replay-deep-sweep] Startup catch-up disabled; set REPLAY_DEEP_SWEEP_STARTUP=1 to enable');
    return;
  }
  const startupTimer = setTimeout(() => {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    const weekday = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (weekday && mins >= 15 * 60 + 35) {
      ensureDeepSweepForDay(getIstDateKey(), 'startup-after-close').catch(e =>
        console.warn('[replay-deep-sweep] Startup run failed:', e.message)
      );
    }
  }, 12000);
  if (startupTimer.unref) startupTimer.unref();
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
    || e?.code === 'NSE_HTML'
    || /read ECONNRESET|socket hang up|timed out|ECONNRESET|returned HTML/i.test(msg);
}

function parseNseJsonResponse(r, label) {
  const body = String(r?.body || '');
  const contentType = String(r?.headers?.['content-type'] || '');
  const trimmed = body.trim();
  if (/text\/html/i.test(contentType) || trimmed.startsWith('<')) {
    const err = new Error(`${label} returned HTML instead of JSON`);
    err.code = 'NSE_HTML';
    throw err;
  }
  return JSON.parse(body || '{}');
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

const intradayCandlesService = createIntradayCandlesService({
  httpsGet,
  yahooHeaders:YAHOO_HEADERS,
  resolveNseSymbol,
  fetchSharekhanCandles:async symbol => {
    const ready = sharekhanClientLive || await ensureSharekhanInitialized({ force:false });
    if (!ready || !sharekhanClientLive) return null;
    return fetchSharekhanIntraday(symbol, sharekhanClientLive);
  },
});

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
      marketState: meta.marketState || '',
    };
  } catch(e) {
    return null;
  }
}

const CONCURRENCY = 8;
const YAHOO_QUOTE_CONCURRENCY = Math.max(1, Math.min(32, Number.parseInt(process.env.YAHOO_QUOTE_CONCURRENCY || '24', 10) || 24));
const MOBILE_STOCK_QUOTE_CONCURRENCY = Math.min(8, YAHOO_QUOTE_CONCURRENCY);
const YAHOO_QUOTE_CACHE_TTL_MS = 15000;
const yahooQuoteCache = new Map();
const yahooQuoteInFlight = new Map();

async function yahooQuoteForSymbol(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;
  const cached = yahooQuoteCache.get(sym);
  if (cached && Date.now() - cached.savedAt < YAHOO_QUOTE_CACHE_TTL_MS) return cached.quote;
  if (yahooQuoteInFlight.has(sym)) return yahooQuoteInFlight.get(sym);
  const request = (async () => {
    const data = await yahooChart(resolveNseSymbol(sym) + '.NS');
    if (!data) return null;
    const quote = chartToQuote(sym, data);
    if (quote) yahooQuoteCache.set(sym, { savedAt:Date.now(), quote });
    return quote;
  })().finally(() => yahooQuoteInFlight.delete(sym));
  yahooQuoteInFlight.set(sym, request);
  return request;
}

async function yahooQuote(nseSymbols) {
  const results = {};
  await mapWithConcurrency(nseSymbols, YAHOO_QUOTE_CONCURRENCY, async sym => {
    const quote = await yahooQuoteForSymbol(sym);
    if (quote) results[sym] = quote;
  });
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
    // console.log(`[computeReturns] ${sym} 1M: current=${currentPrice} base=${closes[oneMonthIdx]} return=${oneMonthReturn}`);

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

// For price arrays (open/high/low/close), zeros from null Yahoo bars must be excluded.
function compactFinitePositive(values) {
  return (values || []).map(Number).filter(v => Number.isFinite(v) && v > 0);
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

function pickChartPreviousClose(result) {
  const previousClose = Number(result?.meta?.previousClose);
  if (Number.isFinite(previousClose) && previousClose > 0) return previousClose;
  const chartPreviousClose = Number(result?.meta?.chartPreviousClose);
  return Number.isFinite(chartPreviousClose) && chartPreviousClose > 0 ? chartPreviousClose : null;
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
    if ([high, low, close].every(v => Number.isFinite(v) && v > 0)) rows.push({ high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  if (!rows.length) return {};
  const latestRawClose = Number(closes[closes.length - 1]);
  const currentSessionAlreadyInSeries = Number.isFinite(latestRawClose) && latestRawClose > 0;
  const rawPriorClose = Number(closes[closes.length - 2]);
  const previousCloseFromMeta = Number(result?.meta?.previousClose);
  const prev = currentSessionAlreadyInSeries && rows.length >= 2
    ? rows[rows.length - 2]
    : rows[rows.length - 1];
  const prevDayClose = currentSessionAlreadyInSeries &&
    !(Number.isFinite(rawPriorClose) && rawPriorClose > 0) &&
    Number.isFinite(previousCloseFromMeta) &&
    previousCloseFromMeta > 0
      ? previousCloseFromMeta
      : prev.close;
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
    prevDayClose: +prevDayClose.toFixed(2),
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

function computeGapExhaustionScoreAdjustment({
  gapPct = null,
  dayChangePct = null,
  relVolumeTimeAdjusted = null,
  volumeShock = null,
  signal = '',
} = {}) {
  const normalizedSignal = String(signal || '').toLowerCase();
  if (normalizedSignal !== 'buy') return { penalty: 0, reason: '' };
  const gap = Number(gapPct);
  if (!Number.isFinite(gap) || gap <= 1) return { penalty: 0, reason: '' };
  if (volumeShock?.isShock) return { penalty: 0, reason: '' };

  let penalty = 12;
  const dayGain = Number(dayChangePct);
  if (Number.isFinite(dayGain) && dayGain >= 2) penalty += 4;
  if (Number.isFinite(dayGain) && dayGain >= 4) penalty += 4;
  if (gap >= 1.5) penalty += 6;
  if (gap >= 2.0) penalty += 6;
  const relVol = Number(relVolumeTimeAdjusted);
  if (Number.isFinite(relVol) && relVol < 2) penalty += 4;

  return { penalty, reason: 'Stretched gap-up exhaustion risk' };
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
    if (![close, high, low].every(v => Number.isFinite(v) && v > 0)) continue;
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
  const priorImpulseBars = bars.slice(0, -1).slice(-20);
  const recentHighBar = priorImpulseBars.reduce(
    (best, bar) => !best || Number(bar.high) > Number(best.high) ? bar : best,
    null
  );
  const recentHigh = Number(recentHighBar?.high);
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
    recentHighAt: recentHighBar?.time || null,
    breakout,
    vwapExtensionPct: Number.isFinite(vwapExtensionPct) ? +vwapExtensionPct.toFixed(2) : null,
    dayChangePct: Number.isFinite(dayChangePct) ? +dayChangePct.toFixed(2) : null,
    detectedAt: last.time,
  };
}

function computeRangeboundMetrics(rawHighs, rawLows, rawCloses, timestamps, lastBarIdx, livePrice, options = {}) {
  const windowMin = Math.max(5, Number(options.windowMin) || 45);
  const barsNeeded = Math.max(3, Math.ceil(windowMin / 5));
  const minRangePct = Math.max(0, Number(options.minRangePct) || 0.75);
  const maxLowerDistancePct = Math.max(0, Number(options.maxLowerDistancePct) || 0.15);
  const minTouches = Math.max(1, Math.floor(Number(options.minTouches) || 2));
  const minMidpointCrosses = Math.max(1, Math.floor(Number(options.minMidpointCrosses) || 2));
  const touchFraction = 0.2;
  const bars = [];
  for (let i = lastBarIdx; i >= 0 && bars.length < barsNeeded; i--) {
    const high = Number(rawHighs[i]);
    const low = Number(rawLows[i]);
    const close = Number(rawCloses[i]);
    const timeMs = Number(timestamps?.[i]) * 1000;
    if (![high, low, close].every(value => Number.isFinite(value) && value > 0) ||
        high < Math.max(low, close) || !Number.isFinite(timeMs)) continue;
    bars.push({ high, low, close, timeMs });
  }
  bars.reverse();
  if (bars.length < barsNeeded) {
    return {
      detected:false,
      atLower:false,
      windowMin:bars.length * 5,
      bars:bars.length,
      lower:null,
      upper:null,
      rangePct:null,
      lowerDistancePct:null,
      lowerTouches:0,
      upperTouches:0,
      midpointCrosses:0,
    };
  }
  const actualWindowMin = (bars.at(-1).timeMs - bars[0].timeMs) / 60000 + 5;
  const lower = Math.min(...bars.map(bar => bar.low));
  const upper = Math.max(...bars.map(bar => bar.high));
  const width = upper - lower;
  const rangePct = lower > 0 ? width / lower * 100 : null;
  const lowerCeiling = lower + width * touchFraction;
  const upperFloor = upper - width * touchFraction;
  const lowerTouches = bars.filter(bar => bar.low <= lowerCeiling).length;
  const upperTouches = bars.filter(bar => bar.high >= upperFloor).length;
  const midpoint = lower + width / 2;
  let midpointCrosses = 0;
  let priorSide = 0;
  for (const bar of bars) {
    const side = bar.close > midpoint ? 1 : (bar.close < midpoint ? -1 : 0);
    if (!side) continue;
    if (priorSide && side !== priorSide) midpointCrosses += 1;
    priorSide = side;
  }
  const price = Number(livePrice);
  const lowerDistancePct = Number.isFinite(price) && price > 0 && lower > 0
    ? (price - lower) / lower * 100
    : null;
  const contiguousWindow = actualWindowMin >= windowMin && actualWindowMin <= windowMin + 10;
  const detected = contiguousWindow &&
    Number.isFinite(rangePct) && rangePct >= minRangePct &&
    lowerTouches >= minTouches && upperTouches >= minTouches &&
    midpointCrosses >= minMidpointCrosses;
  const atLower = detected && Number.isFinite(lowerDistancePct) &&
    lowerDistancePct >= -0.1 && lowerDistancePct <= maxLowerDistancePct;
  return {
    detected,
    atLower,
    windowMin:+actualWindowMin.toFixed(1),
    bars:bars.length,
    lower:+lower.toFixed(2),
    upper:+upper.toFixed(2),
    midpoint:+midpoint.toFixed(2),
    rangePct:Number.isFinite(rangePct) ? +rangePct.toFixed(3) : null,
    lowerDistancePct:Number.isFinite(lowerDistancePct) ? +lowerDistancePct.toFixed(3) : null,
    lowerTouches,
    upperTouches,
    midpointCrosses,
  };
}

function buildIntradaySignal(sym, result, dailyContext = {}) {
  try {
    const quote = result?.indicators?.quote?.[0] || {};
    const meta = result?.meta || {};
    const rawOpens = quote.open || [];
    const rawHighs = quote.high || [];
    const rawLows = quote.low || [];
    const rawCloses = quote.close || [];
    const rawVolumes = quote.volume || [];
    const timestamps = result?.timestamp || [];
    const closes = compactFinitePositive(quote.close);
    const highs = compactFinitePositive(quote.high);
    const lows = compactFinitePositive(quote.low);
    const volumes = compactFinite(quote.volume);
    
    if (closes.length < 1) {
      // Insufficient data - return stale marker with minimal OHLC/setup context.
      const price = Number(meta.regularMarketPrice) || (closes.length > 0 ? closes[closes.length - 1] : null);
      if (!price) return null;
      let lastBarIdx = -1;
      for (let i = rawCloses.length - 1; i >= 0; i--) {
        if (Number.isFinite(Number(rawCloses[i]))) { lastBarIdx = i; break; }
      }
      let previousBarIdx = -1;
      for (let i = lastBarIdx - 1; i >= 0; i--) {
        if (Number.isFinite(Number(rawCloses[i]))) { previousBarIdx = i; break; }
      }
      const round2 = v => Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null;
      const toBar = index => index >= 0 ? {
        time: Number.isFinite(Number(timestamps[index])) ? new Date(Number(timestamps[index]) * 1000).toISOString() : null,
        open: round2(rawOpens[index]),
        high: round2(rawHighs[index]),
        low: round2(rawLows[index]),
        close: round2(rawCloses[index]),
        volume: Number.isFinite(Number(rawVolumes[index])) ? Number(rawVolumes[index]) : null,
      } : null;
      const latestBar = toBar(lastBarIdx);
      const previousBar = toBar(previousBarIdx);
      const priceTimeMs = lastBarIdx >= 0 && Number.isFinite(Number(timestamps[lastBarIdx]))
        ? Number(timestamps[lastBarIdx]) * 1000
        : null;
      const priceTime = priceTimeMs ? new Date(priceTimeMs).toISOString() : null;
      const sessionVolume = compactFinite(rawVolumes).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
      const ohlc = {
        previousBar,
        latestBar,
        recentBars: rawCloses.map((_, index) => toBar(index)).filter(Boolean).slice(-6),
        session: {
          open: round2(Number(meta.regularMarketOpen) || rawOpens.find(v => Number.isFinite(Number(v))) || price),
          high: rawHighs.some(v => Number.isFinite(Number(v))) ? round2(Math.max(...compactFinite(rawHighs))) : round2(price),
          low: rawLows.some(v => Number.isFinite(Number(v)) && Number(v) > 0) ? round2(Math.min(...compactFinitePositive(rawLows))) : round2(price),
          close: round2(price),
          volume: sessionVolume || null,
        },
        previousClose: round2(Number(meta.previousClose) || null),
      };
      return {
        symbol: sym,
        price: +price.toFixed(2),
        signal: 'hold',
        score: 0,
        target: null,
        stop: null,
        entryStatus: 'Wait',
        entryTrigger: 'Waiting for sufficient intraday candles',
        invalidation: 'Not enough intraday candles yet',
        setupType: 'NO_SIGNAL',
        setup: 'Insufficient intraday candles',
        reasons: ['Insufficient intraday candles'],
        ohlc,
        priceTime,
        priceTimeMs,
        stale: true,
        fetchFailed: true,
        staleReason: `Insufficient intraday data (${closes.length} candles, need 1+)`,
        savedAt: new Date().toISOString(),
      };
    }

    const price = Number(meta.regularMarketPrice) || closes[closes.length - 1];
    // Prefer Yahoo daily prevDayClose over meta.previousClose (which can be today's open for WS data)
    const prevClose = Number(dailyContext.prevDayClose) || Number(meta.previousClose) || closes[0];
    const openPrice = Number(meta.regularMarketOpen) || closes[0];
    const lastClose = closes[closes.length - 1];
    const prevBarClose = closes.length > 1 ? closes[closes.length - 2] : lastClose;
    const ema5 = ema(closes, 5);
    const ema9 = ema(closes, 9);
    const ema20 = ema(closes, 20);
    const rsi7 = rsi(closes, 7);
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
  let previousBarIdx = -1;
  for (let i = lastBarIdx - 1; i >= 0; i--) {
    if (Number.isFinite(Number(rawCloses[i]))) { previousBarIdx = i; break; }
  }
  const volumeShock = computeVolumeShockMetrics(rawHighs, rawLows, rawCloses, rawVolumes, timestamps, lastBarIdx, vwap, prevClose);
  const round2 = v => Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null;
  const toBar = index => index >= 0 ? {
    time: Number.isFinite(Number(timestamps[index])) ? new Date(Number(timestamps[index]) * 1000).toISOString() : null,
    open: round2(rawOpens[index]),
    high: round2(rawHighs[index]),
    low: round2(rawLows[index]),
    close: round2(rawCloses[index]),
    volume: Number.isFinite(Number(rawVolumes[index])) ? Number(rawVolumes[index]) : null,
  } : null;
  const latestBar = toBar(lastBarIdx);
  const previousBar = toBar(previousBarIdx);
  const priceTimeMs = lastBarIdx >= 0 && Number.isFinite(Number(timestamps[lastBarIdx]))
    ? Number(timestamps[lastBarIdx]) * 1000
    : null;
  const priceTime = priceTimeMs ? new Date(priceTimeMs).toISOString() : null;
  const ohlc = {
    previousBar,
    latestBar,
    recentBars: rawCloses.map((_, index) => toBar(index)).filter(Boolean).slice(-6),
    session: {
      open: round2(openPrice),
      high: highs.length ? round2(Math.max(...highs)) : null,
      low: lows.length ? round2(Math.min(...lows)) : null,
      close: round2(price),
      volume: dayVolume || null,
    },
    previousClose: round2(prevClose),
  };
  const rangebound = computeRangeboundMetrics(
    rawHighs,
    rawLows,
    rawCloses,
    timestamps,
    lastBarIdx,
    price,
    {
      windowMin:TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_WINDOW_MIN,
      minRangePct:TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MIN_RANGE_PCT,
      maxLowerDistancePct:TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT,
      minTouches:TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MIN_TOUCHES_PER_SIDE,
      minMidpointCrosses:TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MIN_MIDPOINT_CROSSES,
    }
  );
  const expectedVolumeFraction = expectedIntradayVolumeFraction(latestBar?.time);
  const relVolumeTimeAdjusted = dailyContext.avgVolume20 && expectedVolumeFraction
    ? dayVolume / Math.max(1, dailyContext.avgVolume20 * expectedVolumeFraction)
    : null;
  const gapPct = prevClose ? +(((openPrice - prevClose) / prevClose) * 100).toFixed(2) : null;
  const newsImpact = freshNewsService.getCachedImpactForSymbol(sym);
  const eventImpacts = freshNewsService.getCachedImpactsForSymbol(sym);
  let gapQuality = 'flat';
  if (gapPct != null && Math.abs(gapPct) >= 0.35) {
    if (gapPct > 0) gapQuality = price >= openPrice ? 'gap-up holding' : 'gap-up fading';
    else gapQuality = price <= openPrice ? 'gap-down weak' : 'gap-down recovering';
  }

  // Lower-weight warm-up evidence for the period before EMA20, RSI14 and
  // SuperTrend are all ready. The simulation engine still owns entry safety:
  // completed-candle confirmation, post-confirmation volume, trigger/VWAP hold
  // and the global 0.60%/0.80% extension limits remain mandatory.
  const lastThreeCloses = closes.slice(-3);
  const lastThreeLows = lows.slice(-3);
  const higherCloses = lastThreeCloses.length === 3 &&
    lastThreeCloses[0] < lastThreeCloses[1] && lastThreeCloses[1] < lastThreeCloses[2];
  const higherLows = lastThreeLows.length === 3 &&
    lastThreeLows[0] < lastThreeLows[1] && lastThreeLows[1] < lastThreeLows[2];
  const earlyEmaBullish = ema5 != null && (ema9 != null ? ema5 > ema9 : price > ema5);
  const earlyRsiHealthy = rsi7 == null || (rsi7 >= 52 && rsi7 <= 78);
  const earlyFreshVolume = volumeSpike || !!volumeShock?.isShock ||
    Number(volumeShock?.volumeRatio3m) >= 1 || Number(volumeShock?.volumeRatio5m) >= 1;
  const earlyTrigger = openingHigh;
  const earlyTriggerExtensionPct = Number.isFinite(earlyTrigger) && earlyTrigger > 0
    ? ((price - earlyTrigger) / earlyTrigger) * 100
    : null;
  const earlyVwapExtensionPct = Number.isFinite(vwap) && vwap > 0
    ? ((price - vwap) / vwap) * 100
    : null;
  const earlyWarmup = ema20 == null || rsi14 == null || !st?.direction;
  const earlyMomentumActive = earlyWarmup &&
    Number.isFinite(earlyTriggerExtensionPct) && earlyTriggerExtensionPct >= 0 && earlyTriggerExtensionPct <= 0.6 &&
    Number.isFinite(earlyVwapExtensionPct) && earlyVwapExtensionPct >= 0 && earlyVwapExtensionPct <= 0.8 &&
    price > vwap && price > openingHigh && earlyEmaBullish && higherCloses && higherLows &&
    earlyRsiHealthy && earlyFreshVolume;

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
  if (earlyMomentumActive && ema20 == null) {
    score += 8;
    reasons.push(ema9 != null ? 'Early EMA 5 above EMA 9' : 'Early price above EMA 5');
  }
  if (st?.direction === 'bullish') { score += 14; reasons.push('SuperTrend bullish'); }
  else if (st?.direction === 'bearish') { score -= 14; reasons.push('SuperTrend bearish'); }
  else if (earlyMomentumActive) { score += 7; reasons.push('Early higher-close trend'); }
  if (rsi14 != null) {
    if (rsi14 >= 55 && rsi14 <= 75) { score += 10; reasons.push('RSI bullish'); }
    else if (rsi14 >= 25 && rsi14 <= 45) { score -= 10; reasons.push('RSI weak'); }
    else if (rsi14 > 82) { score -= 15; reasons.push('RSI extremely stretched'); }
    else if (rsi14 > 75) { score -= 8; reasons.push('RSI stretched'); }
    else if (rsi14 < 20) { score += 5; reasons.push('RSI oversold bounce zone'); }
  }
  if (earlyMomentumActive && rsi14 == null && rsi7 != null) {
    score += 5;
    reasons.push('Early RSI 7 bullish');
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
  } else if (volumePace != null && volumePace >= 1.0) {
    // Adequate volume — slight nudge in trend direction
    if (lastClose >= prevBarClose) { score += 5; reasons.push('Adequate volume'); }
  } else if (volumePace != null) {
    // Below 1.0x — tiered penalty that grows the lower the volume
    const penalty = volumePace < 0.4 ? 35
      : volumePace < 0.5 ? 28
      : volumePace < 0.6 ? 20
      : volumePace < 0.7 ? 14
      : 8; // 0.7–1.0x
    score += score >= 0 ? -penalty : penalty;
    const label = volumePace < 0.5 ? 'Very low volume' : volumePace < 0.7 ? 'Low volume' : 'Below-average volume';
    reasons.push(`${label} (${round2(volumePace)}x)`);
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
  const gapExhaustion = computeGapExhaustionScoreAdjustment({
    gapPct,
    dayChangePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
    relVolumeTimeAdjusted,
    volumeShock,
    signal: score >= 0 ? 'buy' : 'sell',
  });
  if (gapExhaustion.penalty > 0) {
    score -= gapExhaustion.penalty;
    reasons.push(gapExhaustion.reason);
  }

  if (rangebound.detected) {
    score = Math.max(score, TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MIN_SCORE);
    reasons.unshift(`Rangebound ${rangebound.lower.toFixed(2)}-${rangebound.upper.toFixed(2)} (${rangebound.rangePct.toFixed(2)}%)`);
  }
  const signal = rangebound.detected
    ? 'buy'
    : (score >= 35 ? 'buy' : score <= -35 ? 'sell' : Math.abs(score) >= 18 ? 'watch' : 'hold');
  const rawTradeRisk = Math.max(atr14 * 1.25, price * (MIN_INTRADAY_REWARD_PCT / 100));
  const tradeRisk = Math.min(rawTradeRisk, price * (MAX_INTRADAY_REWARD_PCT / 100));
  const rawStopRisk = Math.max(atr14 * 0.8, price * (MIN_INTRADAY_STOP_PCT / 100));
  const stopRisk = Math.min(rawStopRisk, price * (MAX_INTRADAY_STOP_PCT / 100));
  const bullish = signal !== 'sell';
  let target = price + (bullish ? tradeRisk : -tradeRisk);
  let stop = price - (bullish ? stopRisk : -stopRisk);
  if (rangebound.detected) {
    target = rangebound.upper;
    stop = rangebound.lower * (1 - 0.25 / 100);
  }
  const reward = Math.abs(target - price);
  const risk = Math.abs(price - stop);
  let entryTrigger = 'Wait for clear VWAP/pivot confirmation';
  let invalidation = stop ? `Invalid below ${stop.toFixed(2)}` : 'Invalid on setup failure';
  let entryPrice = null;
  let entryStatus = 'Wait';
  if (rangebound.detected) {
    entryPrice = rangebound.lower;
    entryTrigger = `Buy near lower range ${rangebound.lower.toFixed(2)}; upper range ${rangebound.upper.toFixed(2)}`;
    invalidation = `Invalid below ${stop.toFixed(2)} or on range breakdown`;
    entryStatus = rangebound.atLower
      ? 'Triggered'
      : (Number(rangebound.lowerDistancePct) <=
        TradeRules.DEFAULT_SETTINGS.SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT + 0.2
          ? 'Near trigger'
          : 'Wait');
  } else if (signal === 'buy') {
    const trigger = earlyMomentumActive
      ? openingHigh
      : Math.max(openingHigh || 0, dailyContext.prevDayHigh || 0, dailyContext.pivot || 0);
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
    ema5: ema5 == null ? null : +ema5.toFixed(2),
    ema9: ema9 == null ? null : +ema9.toFixed(2),
    ema20: ema20 == null ? null : +ema20.toFixed(2),
    rsi7: rsi7 == null ? null : +rsi7.toFixed(1),
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
    rangebound,
    earlyMomentum: {
      active: earlyMomentumActive,
      warmup: earlyWarmup,
      trigger: earlyTrigger == null ? null : +earlyTrigger.toFixed(2),
      triggerExtensionPct: earlyTriggerExtensionPct == null ? null : +earlyTriggerExtensionPct.toFixed(2),
      vwapExtensionPct: earlyVwapExtensionPct == null ? null : +earlyVwapExtensionPct.toFixed(2),
      emaBullish: earlyEmaBullish,
      higherCloses,
      higherLows,
      rsiHealthy: earlyRsiHealthy,
      freshVolume: earlyFreshVolume,
    },
    gapPct,
    gapQuality,
    newsImpact,
    eventImpacts,
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
    priceTime,
    priceTimeMs,
    dayChange: prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null,
    reasons: reasons.slice(0, 6),
    savedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[buildIntradaySignal] ${sym}: ERROR - ${err.message}`);
    const quote = result?.indicators?.quote?.[0] || {};
    const meta = result?.meta || {};
    const closes = compactFinite(quote.close);
    const timestamps = result?.timestamp || [];
    const rawCloses = quote.close || [];
    const price = Number(meta.regularMarketPrice) || (closes.length > 0 ? closes[closes.length - 1] : null);
    let lastBarIdx = -1;
    for (let i = rawCloses.length - 1; i >= 0; i--) {
      if (Number.isFinite(Number(rawCloses[i]))) { lastBarIdx = i; break; }
    }
    const priceTimeMs = lastBarIdx >= 0 && Number.isFinite(Number(timestamps[lastBarIdx]))
      ? Number(timestamps[lastBarIdx]) * 1000
      : null;
    const priceTime = priceTimeMs ? new Date(priceTimeMs).toISOString() : null;
    if (price) {
      return {
        symbol: sym,
        price: +price.toFixed(2),
        signal: 'hold',
        score: 0,
        target: null,
        stop: null,
        entryStatus: 'Wait',
        entryTrigger: 'Signal unavailable',
        invalidation: 'Signal build error',
        setupType: 'NO_SIGNAL',
        setup: 'Signal build error',
        reasons: ['Signal build error'],
        priceTime,
        priceTimeMs,
        stale: true,
        error: true,
        errorReason: err.message,
        savedAt: new Date().toISOString(),
      };
    }
    return null;
  }
}

// Called by SharekhanTicker.onCandleUpdate — pushes real-time candles directly into
// intradayLiveCache, bypassing the 60s Yahoo poll for this symbol.
async function pushSharekhanTickerCandles(sym, candles) {
  try {
    if (!getIntradayDataSourceSettings().sharekhan) return;
    const skResult = buildYahooShapeFromCandles(sym, candles);
    if (!skResult) return; // no candles yet
    const now = Date.now();
    const dayKey = getIstDateKey(now);
    const cacheKey = String(sym || '').toUpperCase();
    let dailyContext = {};
    let previousClose = null;
    const cachedDaily = sharekhanDailyContextCache.get(cacheKey);
    const cacheFresh = cachedDaily
      && cachedDaily.dayKey === dayKey
      && (now - Number(cachedDaily.fetchedAt || 0)) < SHAREKHAN_DAILY_CONTEXT_TTL_MS;

    if (cacheFresh) {
      dailyContext = cachedDaily.dailyContext || {};
      previousClose = Number(cachedDaily.previousClose);
    } else {
      const yahooSym = resolveNseSymbol(sym);
      const dailyPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=1d&range=1mo&includePrePost=false`;
      let daily = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
      if (daily.status !== 200) {
        daily = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
      }
      const dailyResult = daily?.status === 200
        ? (() => { try { return JSON.parse(daily.body)?.chart?.result?.[0] ?? null; } catch (_) { return null; } })()
        : null;
      previousClose = Number(dailyResult?.meta?.previousClose);
      if (!(Number.isFinite(previousClose) && previousClose > 0)) {
        const prevClosePath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=1d&range=1d&includePrePost=false`;
        let prevCloseRes = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: prevClosePath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
        if (prevCloseRes.status !== 200) {
          prevCloseRes = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: prevClosePath, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
        }
        const prevCloseResult = prevCloseRes?.status === 200
          ? (() => { try { return JSON.parse(prevCloseRes.body)?.chart?.result?.[0] ?? null; } catch (_) { return null; } })()
          : null;
        previousClose = Number(pickChartPreviousClose(prevCloseResult));
      }
      const dailyContextInput = dailyResult && Number.isFinite(previousClose) && previousClose > 0
        ? { ...dailyResult, meta: { ...(dailyResult.meta || {}), previousClose } }
        : dailyResult;
      dailyContext = buildDailyTradeContext(dailyContextInput);
      sharekhanDailyContextCache.set(cacheKey, {
        dayKey,
        fetchedAt: now,
        dailyContext,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
      });
    }
    skResult.meta.previousClose = (Number.isFinite(previousClose) ? previousClose : null)
      ?? undefined;
    const signal = buildIntradaySignal(sym, skResult, dailyContext);
    if (!signal) return;
    signal.dataSource = 'sharekhan-ws';
    signal.marketDepth = sharekhanMarketDepthCache.get(cacheKey) || null;
    signal._updatedAt = now;
    intradaySignalCache[sym] = { v: signal, t: now };
    const nextValue = normalizeIntradayLiveSignal(sym, signal);
    const prev = intradayLiveCache.get(sym);
    const lastBroadcastAt = Number(prev?._lastBroadcastAt) || 0;
    nextValue._lastBroadcastAt = lastBroadcastAt;
    intradayLiveCache.set(sym, nextValue);
    // Broadcast if data changed OR if >30s since last broadcast (keeps fetchedAt fresh in browser)
    if (hasIntradaySignalMaterialChange(prev, nextValue) || now - lastBroadcastAt > 30000) {
      nextValue._lastBroadcastAt = now;
      broadcastIntradayLive('sharekhan-ws-tick', [sym]);
      triggerSimulationTickAfterScoreUpdate('sharekhan-ws-tick', [sym]);
    }
  } catch (e) {
    console.warn(`[sharekhan-ticker] pushCandles ${sym}:`, e.message);
  }
}

async function fetchIntradaySignal(sym, options = {}) {
  const now = Date.now();
  const sources = options.sources || getIntradayDataSourceSettings();
  const cachedSignal = intradaySignalCache[sym];
  const cachedSource = String(cachedSignal?.v?.dataSource || '');
  const cacheSourceAllowed = cachedSource.startsWith('sharekhan') ? sources.sharekhan : sources.yahoo;
  if (cachedSignal && cacheSourceAllowed && (now - cachedSignal.t) < INTRADAY_SIGNAL_TTL) {
    return intradaySignalCache[sym].v;
  }

  // Sharekhan WebSocket cache is primary for live signals when enabled.
  // Historical Sharekhan candles are used separately by /intraday-candles
  // for price-click charts and do not enter this signal polling path.
  if (!sources.yahoo) return null;

  try {
    const yahooSym = resolveNseSymbol(sym);
    const intradayPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=5m&range=1d&includePrePost=false`;
    // Use range=3mo with interval=1d to get enough daily bars for pivot/5d/20d context.
    // Kept as a separate request so intraday cache isn't polluted with daily data.
    const dailyPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=1d&range=3mo&includePrePost=false`;

    // Fetch both intraday and daily with increased timeout (20s each)
    let [r, daily] = await Promise.all([
      httpsGet({ hostname: 'query1.finance.yahoo.com', path: intradayPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null })),
      httpsGet({ hostname: 'query1.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null })),
    ]);

    // Retry intraday from query2 if needed
    if (r.status !== 200) {
      r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: intradayPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
    }

    // Retry daily from query2 if needed
    if (daily.status !== 200) {
      daily = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
    }

    // If no intraday data, return null (will be handled as stale by caller)
    if (r.status !== 200) {
      return null;
    }

    const result = JSON.parse(r.body)?.chart?.result?.[0];
    if (!result) {
      return null;
    }

    let dailyResult = daily?.status === 200
      ? (() => { try { return JSON.parse(daily.body)?.chart?.result?.[0] ?? null; } catch (_) { return null; } })()
      : null;

    // If daily fetch failed, extract what we can from the intraday result's meta as a fallback.
    // This gives previousClose at minimum so gap% and entry logic still work.
    if (!dailyResult) {
      const prevClose = result?.meta?.chartPreviousClose ?? result?.meta?.previousClose ?? null;
      if (prevClose) {
        dailyResult = {
          meta: { previousClose: prevClose },
          indicators: { quote: [{ high: [], low: [], close: [], volume: [] }] },
          timestamp: [],
        };
        console.warn(`[intraday] ${sym}: daily fetch failed, using meta.previousClose=${prevClose} as fallback`);
      }
    }

    const dailyContextInput = dailyResult && result?.meta
      ? {
          ...dailyResult,
          meta: {
            ...(dailyResult.meta || {}),
            previousClose: dailyResult.meta?.previousClose ?? result.meta.previousClose ?? result.meta.chartPreviousClose,
          },
        }
      : dailyResult;
    const signal = buildIntradaySignal(sym, result, buildDailyTradeContext(dailyContextInput));
    if (signal) {
      if (!signal.dataSource) signal.dataSource = 'yahoo';
      if (!signal._updatedAt) signal._updatedAt = now;
      intradaySignalCache[sym] = { v: signal, t: now };
    }
    return signal;
  } catch (err) {
    console.warn(`[intraday] ${sym}: error - ${err.message}`);
    return null;
  }
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
  ensureEtfCachesLoaded();
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
  const etfListData = loadEtfListDataMap();

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
const yahooCrumb = {
  value: null,
  cookies: '',
  lastFetch: 0,
  lastErrorAt: 0,
  TTL: 30 * 60 * 1000,
  errorCooldownMs: 5 * 60 * 1000,
  fetching: false,
};

async function refreshYahooCrumb() {
  if (yahooCrumb.fetching) return;
  if (!yahooCrumb.value && Date.now() - yahooCrumb.lastErrorAt < yahooCrumb.errorCooldownMs) return;
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
      yahooCrumb.lastErrorAt = Date.now();
      console.warn('[crumb] Failed to get crumb, status:', r1.status, r1.body.slice(0, 100));
    }
  } catch(e) {
    yahooCrumb.lastErrorAt = Date.now();
    console.warn('[crumb] Error:', e.message, '- using crumb-free Yahoo fallback for now');
  } finally {
    yahooCrumb.fetching = false;
  }
}

async function ensureCrumb() {
  if (yahooCrumb.value && (Date.now() - yahooCrumb.lastFetch) < yahooCrumb.TTL) return true;
  if (!yahooCrumb.value && Date.now() - yahooCrumb.lastErrorAt < yahooCrumb.errorCooldownMs) return false;
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
  'NIFTYMIDCAP150.NS': 'midcap',
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
      if (q && key) out[key] = { price: q.price, change: q.change, previousClose:q.prevClose };
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════
async function proxyRequestHandler(req, res) {
  applyLocalCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (rejectUnsafeNonLocalRequest(req, res)) return;

  const { pathname, searchParams } = new URL(req.url, `http://localhost:${PORT}`);
  if (pathname === PAPER_TRADES_ALIAS_PATH || pathname === PAPER_TRADES_ALIAS_STREAM_PATH) {
    res.setHeader('X-Deprecated-Route', PAPER_TRADES_DEPRECATION_WARNING);
  }
  // Log incoming requests for debugging client 404s
  try { console.log('[proxy] >>', req.method, pathname, req.socket && req.socket.remoteAddress); } catch (e) {}

  if (await dispatchRoute([
    (req, res, pathname, searchParams) => intradayCandlesService.handleRoute(req, res, pathname, searchParams),
    (req, res, pathname, searchParams) => handleDashboardRoute(req, res, pathname, searchParams, {
      buildHealthPayload,
      buildMobileSetupsPayload,
      buildMobileStockUniverse,
      buildDashboardBootstrap,
      rememberSimulationUniverse,
      yahooIndices,
      yahooQuote,
    }),
  ], req, res, pathname, searchParams)) return;

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
      // Fetch fresh through the warmed/retry path. NSE sometimes returns an
      // HTML challenge page on this API; treat that as transient, not JSON.
      const payload = await nseJsonWithRetry(`/api/equity-stockIndices?index=${encodeURIComponent(index)}`, `index symbols ${index}`);
      const items = payload?.data || [];
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
        // Graceful fallback: keep dashboard startup healthy even if NSE blocks this endpoint.
        console.warn(`[nse-idx-cache] empty fallback for "${index}" after error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, index, symbols: [], unavailable: true, error: e.message }));
      }
    }
    return;
  }

  // /etf-list  -- return full NSE ETF list (all ~300+ ETFs) with NAV, price, 52W from NSE batch
  if (pathname === '/etf-list') {
    try {
      // Serve from DB cache if fresh
      const cachedEtfs = listAllEtfs();
      const cacheAge = cachedEtfs.length ? (Date.now() - (cachedEtfs[0]?.updatedAt || 0)) : Infinity;
      if (cachedEtfs.length && cacheAge < ETF_LIST_CACHE_TTL) {
        // Patch any missing fundFamily/expRatio in-memory
        let patched = false;
        for (const etf of cachedEtfs) {
          if (etf?.sym && etf.fundFamily == null) { const f = lookupAMC(etf.sym); if (f) { etf.fundFamily = f; patched = true; } }
          if (etf?.sym && etf.expRatio == null && getETFExpenseRatio(etf.sym) != null) { etf.expRatio = getETFExpenseRatio(etf.sym); patched = true; }
        }
        if (patched) {
          try { upsertEtfMaster(cachedEtfs.map(e => ({ ...e, symbol: e.sym }))); } catch(e) { console.warn('[etf-list] patch upsert failed:', e.message); }
        }
        console.log(`[etf-list] serving ${cachedEtfs.length} ETFs from DB cache (age ${Math.round(cacheAge/60000)}m)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: cachedEtfs.length, etfs: cachedEtfs, fromCache: true }));
        return;
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

      // Persist to DB
      try { upsertEtfMaster(etfs.map(e => ({ ...e, symbol: e.sym }))); } catch (e) { console.warn('[etf-list] Master upsert failed:', e.message); }
      console.log(`[etf-list] fetched ${etfs.length} ETFs from NSE, saved to DB`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: etfs.length, etfs }));
    } catch(e) {
      console.warn('[etf-list] NSE fetch error:', e.message);
      // Serve stale DB cache on error
      try {
        const staleEtfs = listAllEtfs();
        if (staleEtfs && staleEtfs.length) {
          console.warn(`[etf-list] serving stale DB cache (${staleEtfs.length} ETFs) after error`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: staleEtfs.length, etfs: staleEtfs, fromCache: true, stale: true }));
          return;
        }
      } catch(_) {}
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
        // Cold start: trigger NSE refresh in background; send DB/cached nav immediately
        refreshNavMapFromNSE().catch(e => console.warn('[stream/etf-nav] bg NSE refresh failed:', e.message));
        navMap = {};
      }
      const etfListData = loadEtfListDataMap();

      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        if (closed) break;
        const chunk = symbols.slice(i, i + CONCURRENCY);
        await Promise.allSettled(chunk.map(sym => (async () => {
          const nse = navMap[sym] || {};
          const disk = etfListData[sym] || {};
          // Send cached nav immediately so the dashboard can display something
          const cachedNav = nse.nav || disk.nav || null;
          if (cachedNav) {
            send({ sym, data: { nav: cachedNav, high52: nse.high52||disk.high52||null, low52: nse.low52||disk.low52||null, volume: nse.volume||disk.volume||null, navPremium: null, aum: nse.aum||null, expRatio: nse.expRatio||null } });
          }
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
            if (!cachedNav) {
              send({ sym, data: { nav: nse.nav||disk.nav||null, high52: nse.high52||disk.high52||null, low52: nse.low52||disk.low52||null, volume: nse.volume||disk.volume||null, navPremium: null, aum: nse.aum||null, expRatio: nse.expRatio||null } });
            }
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
    ensureEtfCachesLoaded();
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
      const etfListForSum = loadEtfListDataMap();
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
        // Write-back fresh Yahoo data to DB so it survives proxy restart
        if (proxyDbReady) {
          try {
            const rows = stale.map(sym => {
              const meta = etfMetaCache[sym] || {};
              const oneM = etfSumCache[sym];
              return { symbol: sym, sym, ...meta, oneMonthReturn: oneM?.oneMonthReturn ?? null };
            }).filter(r => r.symbol);
            if (rows.length) upsertEtfMaster(rows);
          } catch (e) { console.warn('[etf-cache] ETF master upsert failed:', e.message); }
        }
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
      const cacheKey = stockNewsCacheKey(symbol, name, assetType);
      const cached = stockNewsCache[cacheKey];
      const cacheFresh = !!cached && (Date.now() - cached.savedAt) < STOCK_NEWS_TTL;
      const shouldRefresh = !cacheFresh;
      const data = cached?.data || {
        ok: true,
        symbol,
        name: name || symbol,
        assetType: assetType === 'etf' ? 'etf' : 'stock',
        savedAt: null,
        events: [],
        news: [],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...data,
        fromCache: !!cached,
        refreshing: shouldRefresh || stockNewsRefreshInFlight.has(cacheKey),
      }), () => {
        if (shouldRefresh) scheduleStockNewsRefresh(symbol, name, assetType);
      });
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /result-calendar -- dedicated earnings/result calendar for tracked stocks over the next N days
  if (pathname === '/result-calendar') {
    await resultCalendarService.handleRoute(req, res, { searchParams, readJsonBody });
    return;
  }

  // /fresh-stock-news -- server-side scan for today's / last business day's fresh stock news
  if (pathname === '/fresh-stock-news') {
    await freshNewsService.handleRoute(req, res, { searchParams, readJsonBody });
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
    rememberSimulationUniverse(symbols);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { 
      try { 
        if (!closed && !res.writableEnded) {
          const msg = `data: ${JSON.stringify(obj)}\n\n`;
          res.write(msg);
        }
      } catch (err) {
        closed = true;
      }
    };
    try {
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        if (closed) break;
        const chunk = symbols.slice(i, i + CONCURRENCY);
        await Promise.allSettled(chunk.map(sym =>
          fetchIntradaySignal(sym)
            .then(v => { 
              send({ sym, data: normalizeIntradayLiveSignal(sym, v) });
            })
            .catch(e => {
              console.warn(`[stream/intraday] ${sym}:`, e.message);
              send({ sym, data: buildDefaultIntradaySignal(sym, e.message) });
            })
        ));
      }
    } catch(e) { 
      console.error('[stream/intraday] stream error:', e.message);
      send({ error: e.message }); 
    }
    if (!closed && !res.writableEnded) { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); }
    return;
  }

  // /stream/market-overview -- lightweight indices + sector leaderboard stream
  if (pathname === '/stream/market-overview') {
    // Sector averages require every constituent, not only stocks that happen
    // to be present in a filtered setup response. Warm the full dashboard
    // universe when the mobile overview connects.
    rememberSimulationUniverse(loadDashboardStockUniverse().map(row => row.sym));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = {
      res,
      keepAlive:setInterval(() => {
        try { if (!res.writableEnded) res.write(': keep-alive\n\n'); } catch (_) {}
      }, 15000),
    };
    marketOverviewStreamClients.add(client);
    writeSseEvent(res, { ok:true, reason:'connected', at:Date.now(), sectorTrend:buildSectorTrendFromCache(), indices:simulationMarketCache.indices || {} });
    startIntradayLiveRefresh('market-overview-client');
    refreshIntradayLiveCache('market-overview-client').catch(() => {});
    req.on('close', () => {
      if (client.keepAlive) clearInterval(client.keepAlive);
      marketOverviewStreamClients.delete(client);
    });
    return;
  }

  // /stream/mobile-stock-quotes?symbols=A,B -- stream quote batches as they resolve
  if (pathname === '/stream/mobile-stock-quotes') {
    const symbols = (searchParams.get('symbols') || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 300);
    if (!symbols.length) {
      res.writeHead(400, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:'No symbols' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    let loaded = 0;
    let completedSinceFlush = 0;
    let quoteBatch = {};
    const flushQuotes = () => {
      if (!closed && !res.writableEnded && (completedSinceFlush || loaded >= symbols.length)) {
        res.write(`data: ${JSON.stringify({
          ok:true,
          quotes:quoteBatch,
          loaded,
          total:symbols.length,
          done:loaded >= symbols.length,
        })}\n\n`);
      }
      completedSinceFlush = 0;
      quoteBatch = {};
    };
    await mapWithConcurrency(symbols, MOBILE_STOCK_QUOTE_CONCURRENCY, async symbol => {
      if (closed) return;
      const quote = await yahooQuoteForSymbol(symbol).catch(() => null);
      loaded += 1;
      completedSinceFlush += 1;
      if (quote) quoteBatch[symbol] = quote;
      if (completedSinceFlush >= MOBILE_STOCK_QUOTE_CONCURRENCY || loaded >= symbols.length) flushQuotes();
    });
    if (!closed && !res.writableEnded) res.end();
    return;
  }

  // /stream/intraday-live?symbols=A,B  -- SSE: server-owned intraday cache broadcast stream
  if (pathname === '/stream/intraday-live') {
    const requestedSymbols = (searchParams.get('symbols') || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    if (requestedSymbols.length) {
      rememberSimulationUniverse(requestedSymbols);
    }
    const symbolSet = requestedSymbols.length ? new Set(requestedSymbols) : null;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = {
      res,
      symbols: symbolSet,
      keepAlive: setInterval(() => {
        try {
          if (!res.writableEnded) res.write(': keep-alive\n\n');
        } catch (_) {}
      }, 15000),
    };
    intradayLiveStreamClients.add(client);
    writeSseEvent(res, {
      ok: true,
      reason: 'connected',
      at: Date.now(),
      data: buildIntradayLiveData(symbolSet ? [...symbolSet] : null),
      sectorTrend: buildSectorTrendFromCache(),
    });
    startIntradayLiveRefresh('client-connected');
    refreshIntradayLiveCache('client-connected').catch(() => {});
    req.on('close', () => {
      if (client.keepAlive) clearInterval(client.keepAlive);
      intradayLiveStreamClients.delete(client);
    });
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
    rememberSimulationUniverse(symbols);
    try {
      const results = {};
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const chunk = symbols.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map(sym => 
          fetchIntradaySignal(sym)
            .then(v => ({ sym, v: v || {
              symbol: sym,
              signal: 'hold',
              score: 0,
              target: null,
              stop: null,
              entryStatus: 'Wait',
              entryTrigger: 'Signal unavailable',
              setupType: 'NO_SIGNAL',
              setup: 'Signal unavailable',
              reasons: ['Signal unavailable'],
              stale: true,
              fetchFailed: true,
              staleReason: 'Insufficient intraday data',
            } }))
            .catch(e => ({ sym, v: {
              symbol: sym,
              signal: 'hold',
              score: 0,
              target: null,
              stop: null,
              entryStatus: 'Wait',
              entryTrigger: 'Signal unavailable',
              setupType: 'NO_SIGNAL',
              setup: 'Signal unavailable',
              reasons: ['Signal unavailable'],
              stale: true,
              fetchFailed: true,
              staleReason: e.message,
            } }))
        ));
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
      ensureEtfCachesLoaded();
      const now = Date.now();
      const results = {};

      // Read etf_list_cache once upfront — used as nav fallback for both cached and fresh fetches
      const etfListForSum = loadEtfListDataMap();

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
        // Write-back fresh Yahoo data to DB
        if (proxyDbReady) {
          try {
            const rows = stale.map(sym => {
              const meta = etfMetaCache[sym] || {};
              const oneM = etfSumCache[sym];
              return { symbol: sym, sym, ...meta, oneMonthReturn: oneM?.oneMonthReturn ?? null };
            }).filter(r => r.symbol);
            if (rows.length) upsertEtfMaster(rows);
          } catch (e) { console.warn('[etf-cache] ETF master upsert failed:', e.message); }
        }
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
          // Write-back refreshed 1M returns to DB
          if (proxyDbReady) {
            try {
              const rows = staleOneMOnly
                .map(sym => ({ symbol: sym, sym, oneMonthReturn: etfSumCache[sym]?.oneMonthReturn ?? null }))
                .filter(r => r.symbol && r.oneMonthReturn != null);
              if (rows.length) upsertEtfMaster(rows);
          } catch (e) { console.warn('[etf-cache] ETF master upsert failed:', e.message); }
          }
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

  if (await handleTradeExecutionRoute(req, res, pathname, searchParams, {
    tradeExecutionPath:TRADE_EXECUTION_PATH,
    paperTradesAliasPath:PAPER_TRADES_ALIAS_PATH,
    tradeExecutionStreamPath:TRADE_EXECUTION_STREAM_PATH,
    paperTradesAliasStreamPath:PAPER_TRADES_ALIAS_STREAM_PATH,
    paperTradeStreamClients,
    writeSseEvent,
    buildPaperTradeStreamPayload,
    readJsonBody,
    runWithMutationLock,
    loadPaperStateFile,
    savePaperStateFile,
    savePaperTradesFile,
    defaultPaperPortfolio,
    broadcastPaperTradeState,
    validBrokerModes:VALID_BROKER_MODES,
    hasLiveTradeConfirmation,
    buildZerodhaDryRunOrder,
    prepareManualTradeEntryPayload,
    normalizeTradeOwnership,
    getTradeOwnershipContext,
    loadTradeSettingsFile,
    getKiteClientLive:() => kiteClientLive,
    getZerodhaCredentials:() => zerodhaCredentials,
    getSharekhanClientLive:() => sharekhanClientLive,
    getSharekhanCredentials:() => sharekhanCredentials,
    ensureZerodhaInitialized,
    ensureSharekhanInitialized,
    isZerodhaIpBlockError,
    getZerodhaLiveFailureCount:() => zerodhaLiveFailureCount,
    setZerodhaLiveFailureCount:value => { zerodhaLiveFailureCount = value; },
    getSharekhanLiveFailureCount:() => sharekhanLiveFailureCount,
    setSharekhanLiveFailureCount:value => { sharekhanLiveFailureCount = value; },
    setBrokerMode,
    withSharekhanCredentialReload,
    buildSharekhanLiveOrder,
    computePaperTradePnl,
    isDbReady:() => proxyDbReady,
    deleteTrade,
    jsonBodyErrorStatus,
  })) return;

  if (await handleBrokerRoute(req, res, pathname, searchParams, {
    readJsonBody,
    jsonBodyErrorStatus,
    validBrokerModes:VALID_BROKER_MODES,
    hasLiveTradeConfirmation,
    getBrokerMode:() => brokerMode,
    setBrokerMode,
    getSharekhanTicker:() => sharekhanTicker,
    getSharekhanIndexCodeMap:() => sharekhanIndexCodeMap,
    getSimulationMarketCache:() => simulationMarketCache,
    getActiveLiveBrokerKey,
    getZerodhaCredentials:() => zerodhaCredentials,
    getSharekhanCredentials:() => sharekhanCredentials,
    getKiteClientLive:() => kiteClientLive,
    getKiteClientDry:() => kiteClientDry,
    getSharekhanClientLive:() => sharekhanClientLive,
    getZerodhaConfirmationPoller:() => zerodhaConfirmationPoller,
    getSharekhanConfirmationPoller:() => sharekhanConfirmationPoller,
    getZerodhaLiveFailureCount:() => zerodhaLiveFailureCount,
    getSharekhanLiveFailureCount:() => sharekhanLiveFailureCount,
    readBrokerAuthParams,
    sendBrokerAuthHtml,
    buildBrokerLoginUrl,
    htmlEscape,
    brokerNameFromParam,
    exchangeSharekhanRequestToken,
    exchangeZerodhaRequestToken,
    ensureSharekhanInitialized,
    ensureZerodhaInitialized,
    setSharekhanAccessToken:value => { if (sharekhanCredentials) sharekhanCredentials.accessToken = value; },
    saveSharekhanAccessToken,
    updateZerodhaTokens:tokens => {
      if (tokens.refreshToken) zerodhaCredentials.refreshToken = tokens.refreshToken;
      if (tokens.accessToken) zerodhaCredentials.accessToken = tokens.accessToken;
    },
    isDbReady:() => proxyDbReady,
    rebuildDayPnl,
    getDayPnl,
    withSharekhanCredentialReload,
    buildStoredAppPriceMap,
    isSharekhanAuthReloadError,
  })) return;

  if (await handleSimulationRuntimeRoute(req, res, pathname, searchParams, {
    readJsonBody,
    jsonBodyErrorStatus,
    defaultTickIntervalSec:DEFAULT_SIMULATION_TICK_INTERVAL_SEC,
    defaultStopTimeoutSec:DEFAULT_SIMULATION_STOP_TIMEOUT_SEC,
    RuntimeStateTransitionError,
    runWithMutationLock,
    getSimulationTickIntervalSec:() => simulationTickIntervalSec,
    setSimulationTickIntervalSec:value => { simulationTickIntervalSec = value; },
    getSimulationStopTimeoutSec:() => simulationStopTimeoutSec,
    setSimulationStopTimeoutSec:value => { simulationStopTimeoutSec = value; },
    setSimulationSettlingStartedAt:value => { simulationSettlingStartedAt = value; },
    transitionAndSaveSimulationRuntime,
    startSimulationScheduler,
    stopSimulationScheduler,
    saveSimulationRuntime,
    loadTradeSettingsFile,
    getTradeOwnershipContext,
    loadPaperStateFile,
    savePaperStateFile,
    normalizeTradeCollectionOwnership,
    broadcastPaperTradeState,
    getSimulationRuntimeStatus,
    buildServerSimulationAnalysisPayload,
    writeSseEvent,
    analysisStreamRefreshMs:DEFAULT_SIMULATION_TICK_INTERVAL_SEC * 1000,
    snapshotRetentionDays:SIM_SNAPSHOT_RETENTION_DAYS,
    snapshotDatabaseFile:SIM_SNAPSHOT_DB_FILE,
    loadSimulationSnapshotsFile,
    loadAllSimulationSnapshots,
    appendSimulationSnapshot,
  })) return;
  if (await handleSetupEfficiencyRoute(req, res, pathname, searchParams, {
    setupEfficiencyService,
  })) return;
  if (await handleExitQualityRoute(req, res, pathname, searchParams, {
    exitQualityService,
  })) return;
  if (await handleStrategyAdvisorRoute(req, res, pathname, searchParams, {
    strategyAdvisorService,
  })) return;
  if (await handleReplayRoute(req, res, pathname, searchParams, {
    readJsonBody,
    getIstDateKey,
    buildWhyMissedResponse,
    replayModeFromParams,
    createReplayJob,
    compactReplayJob,
    compactReplayJobHistory,
    replayJobs,
    buildReplayAutoTuneResponse,
    buildReplayDeepSweepResponse,
    buildReplayResponse,
  })) return;

  if (await dispatchRoute([
    (req, res, pathname) => handleTradeSettingsRoute(req, res, pathname, {
      readJsonBody,
      jsonBodyErrorStatus,
      loadTradeSettingsFile,
      saveTradeSettingsFile,
      tradeRules:TradeRules,
    }),
  ], req, res, pathname, searchParams)) return;

  if (await handlePreferenceRoute(req, res, pathname, {
    readJsonBody,
    loadSavedETFsFile,
    saveSavedETFsFile,
    loadSavedETFFavsFile,
    saveSavedETFFavsFile,
    loadSavedStocksFile,
    saveSavedStocksFile,
    loadSavedStockFavsFile,
    saveSavedStockFavsFile,
    resolveNseSymbol,
  })) return;

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
        ? 'no-store, no-cache, must-revalidate'
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
let proxyDbReady = false;

async function initializeProxy() {
  if (proxyInitialized) return;
  proxyInitialized = true;
  try {
    initDb();
    proxyDbReady = true;
    console.log('[db] SQLite initialized');
    setupEfficiencyService.start();
    exitQualityService.start();

    // ── One-time migrations from JSON → DB ───────────────────────────────────
    if (!kvGet('broker_mode') && fs.existsSync(BROKER_PREFS_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(BROKER_PREFS_FILE, 'utf8') || '{}');
        const mode = String(parsed?.mode || '').toLowerCase();
        if (VALID_BROKER_MODES.has(mode)) { kvSet('broker_mode', mode); console.log('[db] Migrated broker_mode from JSON'); }
      } catch (_) {}
    }
    if (!kvGet('trade_settings') && fs.existsSync(TRADE_SETTINGS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(TRADE_SETTINGS_FILE, 'utf8') || '{}');
        if (raw?.overrides) { kvSet('trade_settings', raw); console.log('[db] Migrated trade_settings from JSON'); }
      } catch (_) {}
    }
    // Seed fund_cache from JSON file if DB cache is empty
    if (!jsonCacheGet('fund_cache')) {
      const jsonFile = path.join(APP_CACHE_DIR, 'fundamentals_cache.json');
      if (fs.existsSync(jsonFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8') || '{}');
          if (data && Object.keys(data).length) {
            jsonCacheSet('fund_cache', data, FUND_CACHE_TTL);
            console.log(`[db] Migrated fund_cache from JSON (${Object.keys(data).length} entries)`);
          }
        } catch (_) {}
      }
    }
    // Seed etf_sum_cache from JSON file if DB cache is empty
    if (!jsonCacheGet('etf_sum_cache')) {
      const jsonFile = path.join(APP_CACHE_DIR, 'etf_summary_cache.json');
      if (fs.existsSync(jsonFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8') || '{}');
          if (data && Object.keys(data).length) {
            jsonCacheSet('etf_sum_cache', data, ETF_1M_RETURN_TTL);
            console.log(`[db] Migrated etf_sum_cache from JSON (${Object.keys(data).length} entries)`);
          }
        } catch (_) {}
      }
    }
    // Seed etf_meta_cache from etf_list_cache.json meta section if DB cache is empty
    if (!jsonCacheGet('etf_meta_cache')) {
      const jsonFile = path.join(APP_CACHE_DIR, 'etf_list_cache.json');
      if (fs.existsSync(jsonFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8') || '{}');
          const meta = raw?.meta;
          if (meta && Object.keys(meta).length) {
            jsonCacheSet('etf_meta_cache', meta, ETF_META_TTL);
            console.log(`[db] Migrated etf_meta_cache from JSON (${Object.keys(meta).length} entries)`);
          }
          // Also seed etf_master from the etfs array if DB is empty
          const etfs = raw?.etfs;
          if (Array.isArray(etfs) && etfs.length && listAllEtfs().length === 0) {
            try { upsertEtfMaster(etfs.map(e => ({ ...e, symbol: e.sym || e.symbol }))); console.log(`[db] Migrated ${etfs.length} ETFs from etf_list_cache.json`); } catch (_) {}
          }
        } catch (_) {}
      }
    }

    // ── Load all in-memory caches from DB ────────────────────────────────────
    loadFundCache();
    loadNseIdxCache();
    loadReplayCacheFile();
    brokerMode = loadBrokerModePreference();
    console.log(`[db] Caches loaded: fund=${Object.keys(fundCache).length} nseIdx=${Object.keys(nseIdxCache).length}`);
  } catch (e) {
    console.warn('[db] SQLite initialization failed:', e.message);
  }
  await Promise.all([warmNSESession(), refreshYahooCrumb()]);
  
  // Initialize Zerodha integration
  await Promise.all([initializeZerodha(), initializeSharekhan()]);
  // Broker feeds must be ready before auto-resuming the full-universe refresh.
  // Otherwise startup fills the cache with stale defaults and immediately
  // saturates the simulation scheduler.
  await initializeSimulationRuntime();
  
  freshNewsService.startCron();
  resultCalendarService.startCron();
  startReplayDeepSweepScheduler();
}

async function initializeZerodha() {
  try {
    zerodhaCredentials = loadCredentials();
    if (!zerodhaCredentials) {
      console.log('[zerodha] Credentials not loaded. Zerodha integration disabled.');
      return false;
    }
    
    const { apiKey, apiSecret, accessToken, refreshToken } = zerodhaCredentials;
    console.log(`[zerodha] Credentials loaded. accessToken=${accessToken ? 'yes' : 'no'} refreshToken=${refreshToken ? 'yes' : 'no'}`);
    if (!refreshToken) {
      console.warn('[zerodha] Refresh token not configured. Auto-renew is disabled until ZERODHA_REFRESH_TOKEN is set.');
    }
    
    // Create clients for live and dry modes
    const tokenUpdate = ({ accessToken: nextAccessToken, refreshToken: nextRefreshToken }) => {
      if (nextAccessToken) zerodhaCredentials.accessToken = nextAccessToken;
      if (nextRefreshToken) zerodhaCredentials.refreshToken = nextRefreshToken;
      saveCredentialsTokens({ accessToken: nextAccessToken, refreshToken: nextRefreshToken });
    };
    kiteClientLive = new KiteClient(apiKey, apiSecret, accessToken, false, { refreshToken, onTokenUpdate: tokenUpdate });
    kiteClientDry = new KiteClient(apiKey, apiSecret, accessToken, true, { refreshToken, onTokenUpdate: tokenUpdate });

    // Allow startup when only refresh token is configured by fetching a fresh access token.
    if (!accessToken && refreshToken) {
      console.log('[zerodha] ACCESS_TOKEN missing; attempting refresh-token bootstrap...');
      const bootstrapped = await kiteClientLive.refreshAccessToken();
      if (bootstrapped) {
        kiteClientDry.setTokens({
          accessToken: kiteClientLive.accessToken,
          refreshToken: kiteClientLive.refreshToken,
        });
        if (kiteClientLive.accessToken) zerodhaCredentials.accessToken = kiteClientLive.accessToken;
        if (kiteClientLive.refreshToken) zerodhaCredentials.refreshToken = kiteClientLive.refreshToken;
        console.log('[zerodha] Bootstrap token refresh successful.');
      } else {
        console.warn('[zerodha] Bootstrap token refresh failed. Manual token refresh/login may be required.');
      }
    }
    
    // Initialize confirmation poller with reference to paper trades
    zerodhaConfirmationPoller = new ConfirmationPoller(
      kiteClientLive,
      {
        loadTrades: () => loadPaperTradesFile(),
        saveTrades: (trades) => savePaperTradesFile(trades),
        broadcast: (reason = 'broker-update') => broadcastPaperTradeState(reason),
        computePnl: (trade, exitPrice) => computePaperTradePnl(trade, exitPrice),
        journal: appendSimulationDecisionJournal,
      },
      () => brokerMode,
      {
        brokerName: 'zerodha',
        liveMode: 'zerodha_live',
        dryMode: 'zerodha_dry_run',
        liveTradeMode: 'live',
        dryTradeMode: 'dry-run',
      }
    );
    
    // Start the poller
    zerodhaConfirmationPoller.start();
    console.log('[zerodha] Initialization complete. Confirmation poller started.');
    return true;
  } catch (e) {
    console.error('[zerodha] Initialization failed:', e.message);
    return false;
  }
}

async function initializeSharekhan() {
  try {
    sharekhanCredentials = loadSharekhanCredentials();
    if (!sharekhanCredentials) {
      console.log('[sharekhan] Credentials not loaded. Sharekhan integration disabled.');
      return false;
    }
    const { apiKey, customerId, accessToken, requestToken, secretKey, versionId, vendorKey } = sharekhanCredentials;
    console.log(`[sharekhan] Credentials loaded. accessToken=${accessToken ? 'yes' : 'no'} sessionBootstrap=${requestToken && secretKey ? 'yes' : 'no'}`);
    sharekhanClientLive = new SharekhanClient({
      apiKey,
      customerId,
      accessToken,
      requestToken,
      secretKey,
      versionId,
      vendorKey,
      onTokenUpdate: ({ accessToken: nextAccessToken }) => {
        if (nextAccessToken) {
          sharekhanCredentials.accessToken = nextAccessToken;
          saveSharekhanAccessToken(nextAccessToken);
          if (sharekhanTicker) sharekhanTicker.updateToken(nextAccessToken);
        }
      },
    });

    if (!accessToken && requestToken && secretKey) {
      const bootstrapped = await sharekhanClientLive.refreshAccessToken();
      if (bootstrapped && sharekhanClientLive.accessToken) {
        sharekhanCredentials.accessToken = sharekhanClientLive.accessToken;
        saveSharekhanAccessToken(sharekhanClientLive.accessToken);
        console.log('[sharekhan] Bootstrap session generation successful.');
      } else {
        console.warn('[sharekhan] Bootstrap session generation failed. Manual token refresh may be required.');
      }
    }

    sharekhanConfirmationPoller = new ConfirmationPoller(
      sharekhanClientLive,
      {
        loadTrades: () => loadPaperTradesFile(),
        saveTrades: (trades) => savePaperTradesFile(trades),
        broadcast: (reason = 'broker-update') => broadcastPaperTradeState(reason),
        computePnl: (trade, exitPrice) => computePaperTradePnl(trade, exitPrice),
        journal: appendSimulationDecisionJournal,
      },
      () => brokerMode,
      {
        brokerName: 'sharekhan',
        liveMode: 'sharekhan_live',
        dryMode: null,
        liveTradeMode: 'live',
        classifyOrderStatus: (status) => {
          const normalized = String(status || '').trim().toUpperCase().replace(/\s+/g, '_');
          if (['COMPLETE', 'EXECUTED', 'TRADED', 'SUCCESS'].includes(normalized)) return 'confirmed';
          if (['REJECTED', 'FAILED', 'FAIL'].includes(normalized)) return 'rejected';
          if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'cancelled';
          if (['OPEN', 'PENDING', 'VALIDATION_PENDING', 'TRIGGER_PENDING', 'AMO_REQ_RECEIVED'].includes(normalized)) return 'pending';
          return 'unknown';
        },
      }
    );
    sharekhanConfirmationPoller.start();

    // Build scripCode → symbol map for the current universe and start WebSocket ticker
    if (!sharekhanCredentials.accessToken) {
      if (sharekhanTicker) { try { sharekhanTicker.stop(); } catch (_) {} sharekhanTicker = null; }
      console.warn('[sharekhan-ticker] Not started: missing access token. Using Yahoo intraday fallback until Sharekhan token is refreshed.');
      console.log('[sharekhan] Initialization complete. Confirmation poller started.');
      return true;
    }

    const universeSyms = getSharekhanStockUniverseSymbols();
    const symToCode = new Map();
    await Promise.all(universeSyms.map(async sym => {
      const code = await sharekhanClientLive.getScripCode(sym).catch(() => 0);
      if (code > 0) symToCode.set(sym, code);
    }));
    const scripToSymbol = new Map([...symToCode.entries()].map(([sym, code]) => [code, sym]));
    sharekhanIndexCodeMap = await getSharekhanIndexSubscriptions(sharekhanClientLive);
    if (sharekhanTicker) { try { sharekhanTicker.stop(); } catch (_) {} }
    sharekhanTicker = new SharekhanTickerPool({
      poolSize: 1,
      startStaggerMs: 0,
      accessToken: sharekhanCredentials.accessToken,
      scripToSymbol,
      onCandleUpdate: (sym, candles) => { pushSharekhanTickerCandles(sym, candles).catch(() => {}); },
      onTick: handleSharekhanTickerTick,
    });
    sharekhanTicker.subscribe([...symToCode.values(), ...sharekhanIndexCodeMap.keys()]);
    sharekhanTicker.start();
    for (let connectionIndex = 0; connectionIndex < sharekhanTicker.connectionCount; connectionIndex += 1) {
      const stockCount = [...symToCode.values()]
        .filter(code => sharekhanTicker.getConnectionIndex(code) === connectionIndex).length;
      const indexCount = [...sharekhanIndexCodeMap.keys()]
        .filter(code => sharekhanTicker.getConnectionIndex(code) === connectionIndex).length;
      console.log(`[sharekhan-ticker] Connection ${connectionIndex + 1}/${sharekhanTicker.connectionCount}: subscribed to ${stockCount} stock symbols${indexCount ? ` + ${indexCount} index` : ''}`);
    }
    console.log(`[sharekhan-ticker] Started, subscribed to ${symToCode.size} symbols${sharekhanIndexCodeMap.size ? ` + ${sharekhanIndexCodeMap.size} ${sharekhanIndexCodeMap.size === 1 ? 'index' : 'indices'}` : ''}`);

    // Heartbeat: broadcast all sharekhan-ws cached signals every 60s so browser freshness stays valid
    // even for symbols that aren't actively trading (no incoming ticks)
    if (sharekhanTicker._heartbeatTimer) clearInterval(sharekhanTicker._heartbeatTimer);
    sharekhanTicker._heartbeatTimer = setInterval(() => {
      const symsToRefresh = [...symToCode.keys()];
      if (symsToRefresh.length) broadcastIntradayLive('sharekhan-ws-heartbeat', symsToRefresh);
    }, 60 * 1000);

    console.log('[sharekhan] Initialization complete. Confirmation poller started.');
    return true;
  } catch (e) {
    console.error('[sharekhan] Initialization failed:', e.message);
    return false;
  }
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
║  GET /trade-execution       Paper trade journal  ║
║  GET /paper-trades          Alias (compat)       ║
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
  rememberTrade,
  rememberSymbols,
  loadCachedNews,
  __test__: {
    initializeSimulationRuntime,
    runSchedulerTick: runSimulationSchedulerTick,
    // DB is always initialized at module load. enableDbForTests re-initializes
    // with a different path (e.g. ':memory:') if needed within a test.
    enableDbForTests(dbPath = ':memory:') {
      try {
        initDb(dbPath);
        proxyDbReady = true;
        // Re-seed trade_settings from the JSON file if set (env var may differ per test)
        const settingsFile = process.env.TRADE_SETTINGS_FILE;
        if (settingsFile && fs.existsSync(settingsFile)) {
          try {
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8') || '{}');
            if (raw?.overrides) kvSet('trade_settings', raw);
          } catch (_) {}
        }
      } catch (e) { console.warn('[db] test DB init failed:', e.message); }
    },
    disableDbForTests() {
      proxyDbReady = false;
    },
    setSchedulerTickInputs(inputs) {
      simulationSchedulerTestInputs = inputs && typeof inputs === 'object' ? inputs : null;
    },
    setBrokerModeForTests(mode) {
      brokerMode = mode;
    },
    setZerodhaClientForTests(client) {
      zerodhaCredentials = client ? { apiKey: 'test-api-key', accessToken: 'test-token' } : null;
      kiteClientLive = client || null;
      kiteClientDry = client || null;
    },
    selectServerSnapshotCandidatesForTests: selectServerSnapshotCandidates,
    resolveValidatedSharekhanIndexChangeForTests: resolveValidatedSharekhanIndexChange,
    sortEventsForTests: sortEvents,
    eventHighlightsForTests: eventHighlights,
    selectResultNewsFallbackForTests: selectResultNewsFallback,
    parseResultHeadlineMetricsForTests: parseResultHeadlineMetrics,
    enrichResultNewsFallbackForTests: enrichResultNewsFallback,
    attachMetricsToMatchingResultFilingForTests: attachMetricsToMatchingResultFiling,
    fetchNSELatestResultForTests: fetchNSELatestResult,
    nseJsonWithRetryForTests: nseJsonWithRetry,
    setSharekhanClientForTests(client) {
      sharekhanCredentials = client ? { accessToken: 'test-token' } : null;
      sharekhanClientLive = client || null;
    },
    setSimulationSnapshotsForTests(snapshots) {
      simulationSnapshotsForTests = Array.isArray(snapshots) ? snapshots : null;
    },
    setPaperTradesForRuntime(trades) {
      savePaperStateFile({
        savedAt: Date.now(),
        portfolio: defaultPaperPortfolio(),
        trades: Array.isArray(trades) ? trades : [],
      });
    },
    getPaperTradesForRuntime() {
      if (proxyDbReady) {
        const trades = listTrades();
        const ownershipContext = getTradeOwnershipContext();
        const normalized = normalizeTradeCollectionOwnership(trades, ownershipContext);
        // Flush ownership changes back to DB (same as loadPaperStateFile does)
        for (let i = 0; i < trades.length; i++) {
          if (JSON.stringify(trades[i]) !== JSON.stringify(normalized[i])) {
            try { saveTrade(normalized[i]); } catch (e) { console.warn('[trades] Ownership save failed:', normalized[i]?.id, e.message); }
          }
        }
        return normalized;
      }
      return loadPaperStateFile().trades;
    },
    buildServerCandidateFromIntradayForTests(sym, setup, settings = {}, meta = null, asOf = null) {
      const effective = SimulationEngine.withDefaults ? SimulationEngine.withDefaults(settings || {}) : (settings || {});
      return buildServerCandidateFromIntraday(sym, setup, effective, meta, asOf);
    },
    reanchorSharekhanIndicesForTests: reanchorSharekhanIndices,
    applyFrozenIndexPreviousClosesForTests(indices, at) {
      return applyFrozenIndexPreviousCloses(indices, at);
    },
    resetFrozenIndexPreviousClosesForTests() {
      simulationIndexPreviousCloseAnchors = { day:'', values:{} };
    },
    buildDailyTradeContextForTests: buildDailyTradeContext,
    buildIntradaySignalForTests: buildIntradaySignal,
    pickChartPreviousCloseForTests: pickChartPreviousClose,
    getSimulationRuntimeSnapshot() {
      const runtime = loadSimulationRuntime();
      return {
        ...runtime,
        schedulerActive: !!simulationSchedulerTimer,
        tickIntervalSec: simulationTickIntervalSec,
        lockActive: mutationLockActive || simulationTickInFlight,
      };
    },
    stopSimulationSchedulerForTests() {
      stopSimulationScheduler('test-stop');
    },
    stopIntradayLiveRefreshForTests() {
      stopIntradayLiveRefresh('test-stop');
    },
  },
};
