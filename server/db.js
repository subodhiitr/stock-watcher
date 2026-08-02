'use strict';
const Database = require('better-sqlite3');
const nodePath = require('node:path');

// __dirname is available natively in CommonJS
const DEFAULT_DB_PATH = nodePath.join(__dirname, '..', 'stock-watcher.db');

const INITIAL_SCHEMA_VERSION = 1;
const SOURCE_SAVED = 'saved';
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

function toIstDayKeyFromIso(iso) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(iso));
    const pick = type => parts.find(p => p.type === type)?.value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
  } catch { return null; }
}
const BROKER_COLUMN_MAP = {
  sharekhan: 'sharekhan_code',
  nse: 'nse_code',
  zerodha: 'zerodha_token',
  yahoo: 'yahoo_symbol'
};
const BROKER_UPDATED_AT_COLUMN_MAP = {
  sharekhan: 'sharekhan_updated_at',
  nse: 'nse_updated_at',
  zerodha: 'zerodha_updated_at',
  yahoo: 'yahoo_updated_at'
};
const TRADE_FILTERS = {
  id: 'id',
  symbol: "json_extract(data, '$.symbol')",
  status: "json_extract(data, '$.status')",
  source: "json_extract(data, '$.source')",
  strategy: "json_extract(data, '$.strategy')",
  side: "json_extract(data, '$.side')"
};
const TRADE_RANGE_FILTERS = {
  since: { column: "CAST(json_extract(data, '$.opened_at') AS REAL)", operator: '>=' },
  until: { column: "CAST(json_extract(data, '$.opened_at') AS REAL)", operator: '<=' }
};

let activeDb = null;
const preparedByDb = new WeakMap();

function requireDb() {
  if (!activeDb) {
    throw new Error('Database is not initialized. Call initDb() first.');
  }
  return activeDb;
}

function normalizeSource(source) {
  if (source === 'simulation' || source === 'saved' || source === 'both') {
    return source;
  }
  return SOURCE_SAVED;
}

function getPrepared(db) {
  if (preparedByDb.has(db)) {
    return preparedByDb.get(db);
  }

  const prepared = {
    getSchemaVersion: db.prepare('SELECT version FROM schema_version WHERE id = 1'),
    listFavoriteStockRows: db.prepare(
      `SELECT symbol, name, sector, cap, source FROM symbols WHERE is_favorite = 1 ORDER BY symbol ASC`
    ),
    setStockFavoriteBulkTx: db.transaction((symbols) => {
      const now = Date.now();
      db.prepare('UPDATE symbols SET is_favorite = 0, updated_at = ? WHERE is_favorite = 1').run(now);
      const stmt = db.prepare(`
        INSERT INTO symbols (symbol, is_favorite, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(symbol) DO UPDATE SET is_favorite = 1, updated_at = excluded.updated_at
      `);
      for (const sym of symbols) {
        if (sym) stmt.run(String(sym).toUpperCase(), now);
      }
    }),
    upsertSymbol: db.prepare(`
      INSERT INTO symbols (symbol, name, sector, cap, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        name = excluded.name,
        sector = excluded.sector,
        cap = excluded.cap,
        source = CASE
          WHEN symbols.source = 'both' OR excluded.source = 'both' THEN 'both'
          WHEN symbols.source = excluded.source THEN symbols.source
          ELSE 'both'
        END,
        updated_at = excluded.updated_at
    `),
    rememberSymbolsTx: db.transaction((rows) => {
      const now = Date.now();
      for (const row of rows) {
        if (!row?.symbol) {
          continue;
        }
        prepared.upsertSymbol.run(
          row.symbol,
          row.name ?? null,
          row.sector ?? null,
          row.cap ?? null,
          normalizeSource(row.source),
          now
        );
      }
    }),
    upsertSymbolTx: db.transaction((symbol, name, sector, cap, source) => {
      prepared.upsertSymbol.run(symbol, name ?? null, sector ?? null, cap ?? null, normalizeSource(source), Date.now());
    }),
    getTradeRow: db.prepare('SELECT data FROM trade_txns WHERE id = ?'),
    getKvRow: db.prepare('SELECT value FROM kv_store WHERE key = ?'),
    setKv: db.prepare(`INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
    getJsonCache: db.prepare('SELECT data, expires_at FROM json_cache WHERE key = ?'),
    setJsonCache: db.prepare(`INSERT INTO json_cache (key, data, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at, updated_at = excluded.updated_at`),
    deleteJsonCache: db.prepare('DELETE FROM json_cache WHERE key = ?'),
    upsertTrade: db.prepare(`
      INSERT INTO trade_txns (id, data, day_close_price, day_close_source, exit_category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        day_close_price = excluded.day_close_price,
        day_close_source = excluded.day_close_source,
        exit_category = excluded.exit_category,
        updated_at = excluded.updated_at
    `),
    getDayPnlRows: db.prepare('SELECT date, pnl FROM day_pnl ORDER BY date DESC'),
    upsertDayPnl: db.prepare(`
      INSERT INTO day_pnl (date, pnl, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET pnl = excluded.pnl, updated_at = excluded.updated_at
    `),
    countTrades: db.prepare('SELECT COUNT(*) AS count FROM trade_txns'),
    upsertFreshNews: db.prepare(`
      INSERT INTO fresh_news (symbol, news_date, news_json, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol, news_date) DO UPDATE SET
        news_json = excluded.news_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `),
    getFreshNewsRow: db.prepare(`
      SELECT symbol, news_date, news_json, expires_at
      FROM fresh_news
      WHERE symbol = ? AND news_date = ?
    `),
    deleteFreshNewsRow: db.prepare(`
      DELETE FROM fresh_news
      WHERE symbol = ? AND news_date = ?
    `),
    pruneFreshNewsRows: db.prepare('DELETE FROM fresh_news WHERE expires_at <= ?'),
    getEtfMasterRow: db.prepare(`
      SELECT symbol, data, is_saved, is_favorite
      FROM etf_master
      WHERE symbol = ?
    `),
    upsertEtfMasterRow: db.prepare(`
      INSERT INTO etf_master (symbol, data, is_saved, is_favorite, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        data = excluded.data,
        is_saved = excluded.is_saved,
        is_favorite = excluded.is_favorite,
        updated_at = excluded.updated_at
    `),
    listSavedEtfRows: db.prepare(`
      SELECT symbol, data, is_saved, is_favorite
      FROM etf_master
      WHERE is_saved = 1
      ORDER BY symbol ASC
    `),
    listFavoriteEtfRows: db.prepare(`
      SELECT symbol, data, is_saved, is_favorite
      FROM etf_master
      WHERE is_favorite = 1
      ORDER BY symbol ASC
    `),
    upsertEtfNavDailyRow: db.prepare(`
      INSERT INTO etf_nav_daily (symbol, nav_date, nav, data, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol, nav_date) DO UPDATE SET
        nav = excluded.nav,
        data = excluded.data,
        updated_at = excluded.updated_at
    `),
    getEtfNavHistoryRows: db.prepare(`
      SELECT symbol, nav_date AS date, nav, data
      FROM etf_nav_daily
      WHERE symbol = ?
        AND (? IS NULL OR nav_date >= ?)
        AND (? IS NULL OR nav_date <= ?)
      ORDER BY nav_date ASC
    `),
    upsertEtfQuoteCache: db.prepare(`
      INSERT INTO etf_quote_cache (symbol, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `),
    getEtfQuoteCacheRow: db.prepare(`
      SELECT symbol, payload, expires_at
      FROM etf_quote_cache
      WHERE symbol = ?
    `),
    deleteEtfQuoteCacheRow: db.prepare('DELETE FROM etf_quote_cache WHERE symbol = ?'),
    pruneEtfQuoteCacheRows: db.prepare('DELETE FROM etf_quote_cache WHERE expires_at <= ?'),
    upsertEtfHoldingsCache: db.prepare(`
      INSERT INTO etf_holdings_cache (symbol, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `),
    getEtfHoldingsCacheRow: db.prepare(`
      SELECT symbol, payload, expires_at
      FROM etf_holdings_cache
      WHERE symbol = ?
    `),
    deleteEtfHoldingsCacheRow: db.prepare('DELETE FROM etf_holdings_cache WHERE symbol = ?'),
    pruneEtfHoldingsCacheRows: db.prepare('DELETE FROM etf_holdings_cache WHERE expires_at <= ?'),
    getScripCodeStmtByBroker: {},
    scripCodesUpdatedAtByBroker: {},
    upsertScripCodesTxByBroker: {}
  };

  for (const [broker, codeColumn] of Object.entries(BROKER_COLUMN_MAP)) {
    const updatedAtColumn = BROKER_UPDATED_AT_COLUMN_MAP[broker];
    prepared.getScripCodeStmtByBroker[broker] = db.prepare(`
      SELECT ${codeColumn} AS code
      FROM scripts_master
      WHERE symbol = ?
    `);
    prepared.scripCodesUpdatedAtByBroker[broker] = db.prepare(`
      SELECT COALESCE(MAX(${updatedAtColumn}), 0) AS updated_at
      FROM scripts_master
    `);
    prepared.upsertScripCodesTxByBroker[broker] = db.transaction((rows) => {
      const upsertStmt = db.prepare(`
        INSERT INTO scripts_master (symbol, ${codeColumn}, ${updatedAtColumn})
        VALUES (?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          ${codeColumn} = excluded.${codeColumn},
          ${updatedAtColumn} = excluded.${updatedAtColumn}
      `);
      const now = Date.now();
      for (const row of rows) {
        if (!row?.symbol || row[codeColumn] === undefined) {
          continue;
        }
        upsertStmt.run(row.symbol, row[codeColumn], now);
      }
    });
  }

  preparedByDb.set(db, prepared);
  return prepared;
}

function assertSupportedBroker(broker) {
  if (!BROKER_COLUMN_MAP[broker]) {
    throw new Error(`Unsupported broker "${broker}"`);
  }
}

function normalizeTradePatch(fields) {
  if (!fields || typeof fields !== 'object') {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function parseTradeRow(row) {
  if (!row?.data) {
    return null;
  }
  return JSON.parse(row.data);
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toSqliteBool(value) {
  return value ? 1 : 0;
}

function readEtfMasterRow(row) {
  if (!row) {
    return null;
  }
  const data = parseJson(row.data, {}) ?? {};
  return {
    ...data,
    symbol: row.symbol ?? data.symbol ?? null,
    isSaved: row.is_saved === 1,
    isFavorite: row.is_favorite === 1
  };
}

function initDb(path = DEFAULT_DB_PATH) {
  const db = new Database(path);

  // Enable WAL mode for concurrent read+write (proxy + backtest running together)
  // and set busy_timeout to avoid "database is locked" errors
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO schema_version (id, version)
    VALUES (1, ${INITIAL_SCHEMA_VERSION});

    CREATE TABLE IF NOT EXISTS symbols (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      sector TEXT,
      cap TEXT,
      source TEXT NOT NULL DEFAULT 'saved' CHECK (source IN ('saved', 'simulation', 'both')),
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scripts_master (
      symbol TEXT PRIMARY KEY,
      sharekhan_code INTEGER,
      zerodha_token INTEGER,
      nse_code TEXT,
      yahoo_symbol TEXT,
      sharekhan_updated_at INTEGER NOT NULL DEFAULT 0,
      zerodha_updated_at INTEGER NOT NULL DEFAULT 0,
      nse_updated_at INTEGER NOT NULL DEFAULT 0,
      yahoo_updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trade_txns (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      day_close_price REAL,
      day_close_source TEXT,
      exit_category TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS setup_efficiency_trade_facts (
      position_id TEXT PRIMARY KEY,
      setup_type TEXT NOT NULL,
      side TEXT,
      closed_at INTEGER NOT NULL DEFAULT 0,
      source_updated_at INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      reconciled_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_setup_efficiency_facts_setup_closed
    ON setup_efficiency_trade_facts(setup_type, closed_at);

    CREATE TABLE IF NOT EXISTS setup_efficiency_summary (
      setup_type TEXT NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL,
      computed_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (setup_type, period)
    );

    CREATE TABLE IF NOT EXISTS setup_efficiency_reconciliation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cursor_updated_at INTEGER NOT NULL DEFAULT 0,
      cursor_trade_id TEXT NOT NULL DEFAULT '',
      last_started_at INTEGER NOT NULL DEFAULT 0,
      last_completed_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      rows_scanned INTEGER NOT NULL DEFAULT 0,
      positions_updated INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );

    INSERT OR IGNORE INTO setup_efficiency_reconciliation (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS exit_quality_trade_facts (
      exit_id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      exit_category TEXT NOT NULL,
      side TEXT,
      closed_at INTEGER NOT NULL DEFAULT 0,
      source_updated_at INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      reconciled_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_exit_quality_facts_category_closed
    ON exit_quality_trade_facts(exit_category, closed_at);

    CREATE TABLE IF NOT EXISTS exit_quality_summary (
      exit_category TEXT NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL,
      computed_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (exit_category, period)
    );

    CREATE TABLE IF NOT EXISTS exit_quality_reconciliation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cursor_updated_at INTEGER NOT NULL DEFAULT 0,
      cursor_trade_id TEXT NOT NULL DEFAULT '',
      last_started_at INTEGER NOT NULL DEFAULT 0,
      last_completed_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      rows_scanned INTEGER NOT NULL DEFAULT 0,
      exits_updated INTEGER NOT NULL DEFAULT 0,
      close_prices_resolved INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );

    INSERT OR IGNORE INTO exit_quality_reconciliation (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS strategy_advisor_runs (
      id TEXT PRIMARY KEY,
      trade_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_advisor_runs_date_updated
    ON strategy_advisor_runs(trade_date, updated_at DESC);

    CREATE TABLE IF NOT EXISTS fresh_news (
      symbol TEXT NOT NULL,
      news_date TEXT NOT NULL,
      news_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, news_date)
    );

    CREATE TABLE IF NOT EXISTS etf_master (
      symbol TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      is_saved INTEGER NOT NULL DEFAULT 0 CHECK (is_saved IN (0, 1)),
      is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS etf_nav_daily (
      symbol TEXT NOT NULL,
      nav_date TEXT NOT NULL,
      nav REAL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, nav_date)
    );

    CREATE TABLE IF NOT EXISTS etf_quote_cache (
      symbol TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS etf_holdings_cache (
      symbol TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS day_pnl (
      date TEXT PRIMARY KEY,
      pnl REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS json_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL DEFAULT 9999999999999,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS portfolio_state (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_trade_txns_symbol
      ON trade_txns (json_extract(data, '$.symbol'));
    CREATE INDEX IF NOT EXISTS idx_trade_txns_status
      ON trade_txns (json_extract(data, '$.status'));
    CREATE INDEX IF NOT EXISTS idx_trade_txns_opened_at
      ON trade_txns (CAST(json_extract(data, '$.openedAt') AS INTEGER));
  `);
  try { db.exec('ALTER TABLE trade_txns ADD COLUMN day_close_price REAL'); } catch (_) {}
  try { db.exec('ALTER TABLE trade_txns ADD COLUMN day_close_source TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE trade_txns ADD COLUMN exit_category TEXT'); } catch (_) {}
  db.exec(`
    UPDATE trade_txns
    SET
      day_close_price = COALESCE(day_close_price, CAST(json_extract(data, '$.exitState.dayClosePrice') AS REAL)),
      day_close_source = COALESCE(day_close_source, json_extract(data, '$.exitState.dayCloseSource')),
      exit_category = COALESCE(exit_category, json_extract(data, '$.exitState.category'))
    WHERE json_extract(data, '$.exitState') IS NOT NULL
  `);

  activeDb = db;

  // Migrate existing DBs: add is_favorite to symbols if missing
  try { db.exec('ALTER TABLE symbols ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1))'); } catch (_) {}
  // Ensure new tables exist (for DBs created before kv_store/json_cache were added)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS json_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 9999999999999, updated_at INTEGER NOT NULL DEFAULT 0);
  `);

  // Seed day_pnl from existing trades if table is empty
  const dayPnlCount = db.prepare('SELECT COUNT(*) AS n FROM day_pnl').get()?.n ?? 0;
  if (dayPnlCount === 0) {
    try { rebuildDayPnl(); } catch (_) {}
  }

  return db;
}

function getSchemaVersion(db = requireDb()) {
  const row = getPrepared(db).getSchemaVersion.get();
  return row?.version ?? 0;
}

function getSymbols() {
  const db = requireDb();
  return db.prepare('SELECT symbol, name, sector, cap, source FROM symbols ORDER BY symbol ASC').all();
}

// Returns only symbols with source 'saved' or 'both', formatted as {sym, name, sector, cap}
// matching the legacy saved_stocks.json array format for backward compatibility
function getSavedStockSymbols() {
  const db = requireDb();
  return db.prepare(
    "SELECT symbol, name, sector, cap FROM symbols WHERE source IN ('saved','both') ORDER BY symbol ASC"
  ).all().map(r => ({ sym: r.symbol, name: r.name || r.symbol, sector: r.sector || null, cap: r.cap || null }));
}

// Returns only symbols with source 'simulation' or 'both' as a plain string array
// matching the legacy simulation_universe.json symbols array format
function getSimulationSymbols() {
  const db = requireDb();
  return db.prepare(
    "SELECT symbol FROM symbols WHERE source IN ('simulation','both') ORDER BY symbol ASC"
  ).all().map(r => r.symbol);
}

// Bulk-set simulation universe: removes old simulation-only rows, upserts new set
function saveSimulationSymbols(symbols) {
  const db = requireDb();
  const normalized = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map(s => String(s || '').trim().toUpperCase()).filter(s => /^[A-Z0-9_.-]+$/.test(s)))];
  const tx = db.transaction(() => {
    // Snapshot metadata for simulation-only rows before deleting them
    const simMeta = new Map(
      db.prepare("SELECT symbol, name, sector, cap FROM symbols WHERE source = 'simulation'").all()
        .map(r => [r.symbol, r])
    );
    // Rows that are 'both' stay but lose simulation source → become 'saved'
    db.prepare("UPDATE symbols SET source = 'saved', updated_at = ? WHERE source = 'both'").run(Date.now());
    // Delete rows that were simulation-only
    db.prepare("DELETE FROM symbols WHERE source = 'simulation'").run();
    // Upsert new simulation symbols, restoring cap/name/sector for re-inserted rows
    const upsert = db.prepare(`
      INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, 'simulation', ?)
      ON CONFLICT(symbol) DO UPDATE SET
        source = CASE WHEN symbols.source = 'saved' THEN 'both' ELSE 'simulation' END,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();
    for (const sym of normalized) {
      const meta = simMeta.get(sym);
      upsert.run(sym, meta?.name ?? null, meta?.sector ?? null, meta?.cap ?? null, now);
    }
  });
  tx();
  return normalized;
}

// Returns list of all ETFs in etf_master formatted as {sym, name, ...data}
function listAllEtfs() {
  const db = requireDb();
  return db.prepare('SELECT symbol, data, is_saved, is_favorite FROM etf_master ORDER BY symbol ASC').all()
    .map(r => {
      const data = parseJson(r.data, {}) ?? {};
      return { ...data, sym: r.symbol, symbol: r.symbol, isSaved: r.is_saved === 1, isFavorite: r.is_favorite === 1 };
    });
}

// Returns saved ETF symbol strings (for /etf-prefs endpoint backward compat)
function getEtfSavedSymbols() {
  const db = requireDb();
  return db.prepare("SELECT symbol FROM etf_master WHERE is_saved = 1 ORDER BY symbol ASC").all().map(r => r.symbol);
}

// Returns favorite ETF symbol strings (for /etf-favs endpoint backward compat)
function getEtfFavoriteSymbols() {
  const db = requireDb();
  return db.prepare("SELECT symbol FROM etf_master WHERE is_favorite = 1 ORDER BY symbol ASC").all().map(r => r.symbol);
}

// Bulk-set ETF saved flags: marks given symbols as saved, clears all others
function setEtfSavedBulk(symbols) {
  const db = requireDb();
  const syms = new Set((Array.isArray(symbols) ? symbols : []).map(s => String(s).trim().toUpperCase()).filter(Boolean));
  const tx = db.transaction(() => {
    db.prepare('UPDATE etf_master SET is_saved = 0, updated_at = ?').run(Date.now());
    const upsert = db.prepare(`
      INSERT INTO etf_master (symbol, data, is_saved, is_favorite, updated_at) VALUES (?, '{}', 1, 0, ?)
      ON CONFLICT(symbol) DO UPDATE SET is_saved = 1, updated_at = excluded.updated_at
    `);
    const now = Date.now();
    for (const sym of syms) upsert.run(sym, now);
  });
  tx();
}

// Bulk-set ETF favorite flags: marks given symbols as favorites, clears all others
function setEtfFavoriteBulk(symbols) {
  const db = requireDb();
  const syms = new Set((Array.isArray(symbols) ? symbols : []).map(s => String(s).trim().toUpperCase()).filter(Boolean));
  const tx = db.transaction(() => {
    db.prepare('UPDATE etf_master SET is_favorite = 0, updated_at = ?').run(Date.now());
    const upsert = db.prepare(`
      INSERT INTO etf_master (symbol, data, is_saved, is_favorite, updated_at) VALUES (?, '{}', 0, 1, ?)
      ON CONFLICT(symbol) DO UPDATE SET is_favorite = 1, updated_at = excluded.updated_at
    `);
    const now = Date.now();
    for (const sym of syms) upsert.run(sym, now);
  });
  tx();
}

function rememberSymbols(rows) {
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.rememberSymbolsTx(Array.isArray(rows) ? rows : []);
}

function savePortfolioState(portfolio) {
  if (!portfolio || typeof portfolio !== 'object') return null;
  const db = requireDb();
  db.prepare(`
    INSERT INTO portfolio_state (key, data, updated_at)
    VALUES ('default', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(portfolio), Date.now());
  return portfolio;
}

function loadPortfolioState() {
  const db = requireDb();
  const row = db.prepare("SELECT data FROM portfolio_state WHERE key = 'default'").get();
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

function upsertSymbol(symbol, name, sector, cap, source) {
  if (!symbol) {
    return;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.upsertSymbolTx(symbol, name, sector, cap, source);
}

function upsertScripCodes(rows, broker = 'sharekhan') {
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.upsertScripCodesTxByBroker[broker](Array.isArray(rows) ? rows : []);
}

function getScripCode(symbol, broker = 'sharekhan') {
  if (!symbol) {
    return null;
  }
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.getScripCodeStmtByBroker[broker].get(symbol);
  return row?.code ?? null;
}

function scripCodesUpdatedAt(broker = 'sharekhan') {
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.scripCodesUpdatedAtByBroker[broker].get();
  return row?.updated_at ?? 0;
}

function saveTrade(trade) {
  const patch = normalizeTradePatch(trade);
  if (!patch.id) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const existing = prepared.getTradeRow.get(patch.id);
  const existingTrade = parseTradeRow(existing) ?? {};
  const merged = { ...existingTrade, ...patch, id: patch.id };
  const now = Date.now();
  const dayClosePrice = Number(merged.exitState?.dayClosePrice ?? merged.dayClosePrice);
  const dayCloseSource = String(merged.exitState?.dayCloseSource || merged.dayCloseSource || '');
  const exitCategory = String(merged.exitState?.category || merged.exitCategory || '');
  prepared.upsertTrade.run(
    patch.id,
    JSON.stringify(merged),
    dayClosePrice > 0 ? dayClosePrice : null,
    dayCloseSource || null,
    exitCategory || null,
    now,
    now
  );

  // Update day_pnl when a closed trade with pnl is saved
  if (String(merged.status || '').toLowerCase() === 'closed' && Number.isFinite(Number(merged.pnl))) {
    const iso = merged.closedAt || merged.openedAt;
    const date = iso ? toIstDayKeyFromIso(iso) : null;
    if (date) recomputeDayPnlForDate(db, prepared, date);
    // If the trade previously had a different close date, recompute that too
    const prevIso = existingTrade.closedAt || existingTrade.openedAt;
    const prevDate = prevIso ? toIstDayKeyFromIso(prevIso) : null;
    if (prevDate && prevDate !== date) recomputeDayPnlForDate(db, prepared, prevDate);
  }

  return merged;
}

function recomputeDayPnlForDate(db, prepared, date) {
  // Sum all closed trades whose IST date matches
  const allClosed = db.prepare(
    `SELECT data FROM trade_txns WHERE json_extract(data, '$.status') = 'closed'`
  ).all();
  let total = 0;
  for (const row of allClosed) {
    const t = parseTradeRow(row);
    if (!t) continue;
    const pnl = Number(t.pnl);
    if (!Number.isFinite(pnl)) continue;
    const iso = t.closedAt || t.openedAt;
    if (iso && toIstDayKeyFromIso(iso) === date) total = +(total + pnl).toFixed(2);
  }
  prepared.upsertDayPnl.run(date, total, Date.now());
}

function updateTrade(id, fields) {
  if (!id) {
    return null;
  }
  const patch = normalizeTradePatch(fields);
  delete patch.id;
  return saveTrade({ id, ...patch });
}

function getTrade(id) {
  if (!id) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  return parseTradeRow(prepared.getTradeRow.get(id));
}

function listTrades(filters = {}) {
  const db = requireDb();
  const clauses = [];
  const params = [];

  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined) {
      continue;
    }
    if (key in TRADE_RANGE_FILTERS) {
      const { column, operator } = TRADE_RANGE_FILTERS[key];
      clauses.push(`${column} ${operator} ?`);
      params.push(value);
      continue;
    }
    if (!(key in TRADE_FILTERS)) {
      continue;
    }
    const column = TRADE_FILTERS[key];
    if (Array.isArray(value)) {
      if (!value.length) {
        continue;
      }
      const placeholders = value.map(() => '?').join(', ');
      clauses.push(`${column} IN (${placeholders})`);
      params.push(...value);
      continue;
    }
    clauses.push(`${column} = ?`);
    params.push(value);
  }

  let sql = 'SELECT data FROM trade_txns';
  if (clauses.length) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  sql += ' ORDER BY updated_at DESC';

  return db.prepare(sql).all(...params).map((row) => parseTradeRow(row)).filter(Boolean);
}

function countTrades() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.countTrades.get();
  return row?.count ?? 0;
}

function deleteTrade(id) {
  if (!id) return 0;
  const db = requireDb();
  const result = db.prepare('DELETE FROM trade_txns WHERE id = ?').run(String(id));
  return result.changes ?? 0;
}

function getTradesUpdatedAt() {
  const db = requireDb();
  const row = db.prepare('SELECT COALESCE(MAX(updated_at), 0) AS ts FROM trade_txns').get();
  return row?.ts ?? 0;
}

function listTradeRowsUpdatedAfter(updatedAt = 0, afterId = '', limit = 5000) {
  const db = requireDb();
  const rows = db.prepare(`
    SELECT id, data, updated_at
    FROM trade_txns
    WHERE (
      updated_at > ?
      OR (updated_at = ? AND id > ?)
    )
    AND LOWER(COALESCE(json_extract(data, '$.source'), '')) = 'simulation'
    ORDER BY updated_at ASC, id ASC
    LIMIT ?
  `).all(Number(updatedAt) || 0, Number(updatedAt) || 0, String(afterId || ''), Math.max(1, Number(limit) || 5000));
  return rows.map(row => ({
    id:row.id,
    updatedAt:Number(row.updated_at) || 0,
    trade:parseTradeRow(row),
  })).filter(row => row.trade);
}

function listSimulationTradesForRoots(rootIds = []) {
  const roots = [...new Set((rootIds || []).map(String).filter(Boolean))];
  if (!roots.length) return [];
  const db = requireDb();
  const placeholders = roots.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, data, updated_at
    FROM trade_txns
    WHERE LOWER(COALESCE(json_extract(data, '$.source'), '')) = 'simulation'
    AND (
      id IN (${placeholders})
      OR CAST(json_extract(data, '$.parentId') AS TEXT) IN (${placeholders})
    )
    ORDER BY updated_at ASC, id ASC
  `).all(...roots, ...roots);
  return rows.map(row => ({
    id:row.id,
    updatedAt:Number(row.updated_at) || 0,
    trade:parseTradeRow(row),
  })).filter(row => row.trade);
}

function upsertSetupEfficiencyFact(fact) {
  if (!fact?.positionId || !fact?.setupType) return null;
  const db = requireDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO setup_efficiency_trade_facts
      (position_id, setup_type, side, closed_at, source_updated_at, data, reconciled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_id) DO UPDATE SET
      setup_type = excluded.setup_type,
      side = excluded.side,
      closed_at = excluded.closed_at,
      source_updated_at = excluded.source_updated_at,
      data = excluded.data,
      reconciled_at = excluded.reconciled_at
  `).run(
    String(fact.positionId),
    String(fact.setupType),
    String(fact.side || ''),
    Number(fact.closedAt) || 0,
    Number(fact.sourceUpdatedAt) || 0,
    JSON.stringify(fact),
    now
  );
  return fact;
}

function deleteSetupEfficiencyFact(positionId) {
  if (!positionId) return 0;
  const db = requireDb();
  return db.prepare('DELETE FROM setup_efficiency_trade_facts WHERE position_id = ?').run(String(positionId)).changes || 0;
}

function listSetupEfficiencyFacts() {
  const db = requireDb();
  return db.prepare('SELECT data FROM setup_efficiency_trade_facts ORDER BY closed_at ASC, position_id ASC')
    .all()
    .map(row => parseJson(row.data, null))
    .filter(Boolean);
}

function replaceSetupEfficiencySummaries(rows = []) {
  const db = requireDb();
  const replace = db.transaction(items => {
    db.prepare('DELETE FROM setup_efficiency_summary').run();
    const insert = db.prepare(`
      INSERT INTO setup_efficiency_summary (setup_type, period, data, computed_at)
      VALUES (?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const row of items) {
      insert.run(String(row.setupType || 'UNKNOWN'), String(row.period || 'all'), JSON.stringify(row), now);
    }
  });
  replace(Array.isArray(rows) ? rows : []);
}

function listSetupEfficiencySummaries(period = 'all') {
  const db = requireDb();
  return db.prepare(`
    SELECT data FROM setup_efficiency_summary
    WHERE period = ?
    ORDER BY CAST(json_extract(data, '$.efficiencyScore') AS REAL) DESC, setup_type ASC
  `).all(String(period || 'all')).map(row => parseJson(row.data, null)).filter(Boolean);
}

function loadSetupEfficiencyReconciliation() {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM setup_efficiency_reconciliation WHERE id = 1').get();
  return row ? {
    cursorUpdatedAt:Number(row.cursor_updated_at) || 0,
    cursorTradeId:String(row.cursor_trade_id || ''),
    lastStartedAt:Number(row.last_started_at) || 0,
    lastCompletedAt:Number(row.last_completed_at) || 0,
    status:String(row.status || 'idle'),
    rowsScanned:Number(row.rows_scanned) || 0,
    positionsUpdated:Number(row.positions_updated) || 0,
    error:String(row.error || ''),
  } : null;
}

function saveSetupEfficiencyReconciliation(state = {}) {
  const current = loadSetupEfficiencyReconciliation() || {};
  const next = { ...current, ...state };
  const db = requireDb();
  db.prepare(`
    INSERT INTO setup_efficiency_reconciliation
      (id, cursor_updated_at, cursor_trade_id, last_started_at, last_completed_at, status, rows_scanned, positions_updated, error)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cursor_updated_at = excluded.cursor_updated_at,
      cursor_trade_id = excluded.cursor_trade_id,
      last_started_at = excluded.last_started_at,
      last_completed_at = excluded.last_completed_at,
      status = excluded.status,
      rows_scanned = excluded.rows_scanned,
      positions_updated = excluded.positions_updated,
      error = excluded.error
  `).run(
    Number(next.cursorUpdatedAt) || 0,
    String(next.cursorTradeId || ''),
    Number(next.lastStartedAt) || 0,
    Number(next.lastCompletedAt) || 0,
    String(next.status || 'idle'),
    Number(next.rowsScanned) || 0,
    Number(next.positionsUpdated) || 0,
    String(next.error || '')
  );
  return next;
}

function upsertExitQualityFact(fact) {
  if (!fact?.exitId || !fact?.exitCategory) return null;
  const db = requireDb();
  db.prepare(`
    INSERT INTO exit_quality_trade_facts
      (exit_id, position_id, exit_category, side, closed_at, source_updated_at, data, reconciled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(exit_id) DO UPDATE SET
      position_id = excluded.position_id,
      exit_category = excluded.exit_category,
      side = excluded.side,
      closed_at = excluded.closed_at,
      source_updated_at = excluded.source_updated_at,
      data = excluded.data,
      reconciled_at = excluded.reconciled_at
  `).run(
    String(fact.exitId),
    String(fact.positionId || fact.exitId),
    String(fact.exitCategory),
    String(fact.side || ''),
    Number(fact.closedAt) || 0,
    Number(fact.sourceUpdatedAt) || 0,
    JSON.stringify(fact),
    Date.now()
  );
  return fact;
}

function deleteExitQualityFact(exitId) {
  if (!exitId) return 0;
  return requireDb().prepare('DELETE FROM exit_quality_trade_facts WHERE exit_id = ?').run(String(exitId)).changes || 0;
}

function listExitQualityFacts() {
  return requireDb().prepare('SELECT data FROM exit_quality_trade_facts ORDER BY closed_at ASC, exit_id ASC')
    .all()
    .map(row => parseJson(row.data, null))
    .filter(Boolean);
}

function replaceExitQualitySummaries(rows = []) {
  const db = requireDb();
  db.transaction(items => {
    db.prepare('DELETE FROM exit_quality_summary').run();
    const insert = db.prepare(`
      INSERT INTO exit_quality_summary (exit_category, period, data, computed_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of items) {
      insert.run(String(row.exitCategory || 'Other'), String(row.period || 'all'), JSON.stringify(row), Date.now());
    }
  })(Array.isArray(rows) ? rows : []);
}

function listExitQualitySummaries(period = 'all') {
  return requireDb().prepare(`
    SELECT data FROM exit_quality_summary
    WHERE period = ?
    ORDER BY CAST(json_extract(data, '$.qualityScore') AS REAL) DESC, exit_category ASC
  `).all(String(period || 'all')).map(row => parseJson(row.data, null)).filter(Boolean);
}

function loadExitQualityReconciliation() {
  const row = requireDb().prepare('SELECT * FROM exit_quality_reconciliation WHERE id = 1').get();
  return row ? {
    cursorUpdatedAt:Number(row.cursor_updated_at) || 0,
    cursorTradeId:String(row.cursor_trade_id || ''),
    lastStartedAt:Number(row.last_started_at) || 0,
    lastCompletedAt:Number(row.last_completed_at) || 0,
    status:String(row.status || 'idle'),
    rowsScanned:Number(row.rows_scanned) || 0,
    exitsUpdated:Number(row.exits_updated) || 0,
    closePricesResolved:Number(row.close_prices_resolved) || 0,
    error:String(row.error || ''),
  } : null;
}

function saveExitQualityReconciliation(state = {}) {
  const current = loadExitQualityReconciliation() || {};
  const next = { ...current, ...state };
  requireDb().prepare(`
    INSERT INTO exit_quality_reconciliation
      (id, cursor_updated_at, cursor_trade_id, last_started_at, last_completed_at, status, rows_scanned, exits_updated, close_prices_resolved, error)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cursor_updated_at = excluded.cursor_updated_at,
      cursor_trade_id = excluded.cursor_trade_id,
      last_started_at = excluded.last_started_at,
      last_completed_at = excluded.last_completed_at,
      status = excluded.status,
      rows_scanned = excluded.rows_scanned,
      exits_updated = excluded.exits_updated,
      close_prices_resolved = excluded.close_prices_resolved,
      error = excluded.error
  `).run(
    Number(next.cursorUpdatedAt) || 0,
    String(next.cursorTradeId || ''),
    Number(next.lastStartedAt) || 0,
    Number(next.lastCompletedAt) || 0,
    String(next.status || 'idle'),
    Number(next.rowsScanned) || 0,
    Number(next.exitsUpdated) || 0,
    Number(next.closePricesResolved) || 0,
    String(next.error || '')
  );
  return next;
}

function saveStrategyAdvisorRun(run = {}) {
  if (!run?.id || !run?.date) return null;
  const now = Date.now();
  const createdAt = Number(run.createdAt) || now;
  const updatedAt = Number(run.updatedAt) || now;
  requireDb().prepare(`
    INSERT INTO strategy_advisor_runs
      (id, trade_date, status, phase, progress, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      trade_date = excluded.trade_date,
      status = excluded.status,
      phase = excluded.phase,
      progress = excluded.progress,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(
    String(run.id),
    String(run.date),
    String(run.status || 'queued'),
    String(run.phase || 'queued'),
    Math.max(0, Math.min(100, Math.round(Number(run.progress) || 0))),
    JSON.stringify({ ...run, createdAt, updatedAt }),
    createdAt,
    updatedAt
  );
  return { ...run, createdAt, updatedAt };
}

function getStrategyAdvisorRun(id) {
  if (!id) return null;
  const row = requireDb().prepare('SELECT data FROM strategy_advisor_runs WHERE id = ?').get(String(id));
  return row ? parseJson(row.data, null) : null;
}

function listStrategyAdvisorRuns({ date = '', limit = 20 } = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const rows = date
    ? requireDb().prepare(`
        SELECT data FROM strategy_advisor_runs
        WHERE trade_date = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(String(date), boundedLimit)
    : requireDb().prepare(`
        SELECT data FROM strategy_advisor_runs
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(boundedLimit);
  return rows.map(row => parseJson(row.data, null)).filter(Boolean);
}

function computeAllTimeRealizedPnl() {
  const db = requireDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CAST(json_extract(data, '$.pnl') AS REAL)), 0) AS total
    FROM trade_txns
    WHERE json_extract(data, '$.status') = 'closed'
  `).get();
  return +(row?.total ?? 0);
}

function getDayPnl(limit = null) {
  const db = requireDb();
  const parsedLimit = Number.parseInt(limit, 10);
  const rows = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? db.prepare('SELECT date, pnl FROM day_pnl ORDER BY date DESC LIMIT ?').all(parsedLimit)
    : getPrepared(db).getDayPnlRows.all();
  const result = {};
  for (const row of rows) result[row.date] = row.pnl;
  return result;
}

function rebuildDayPnl() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const allClosed = db.prepare(
    `SELECT data FROM trade_txns WHERE json_extract(data, '$.status') = 'closed'`
  ).all();
  const byDate = {};
  for (const row of allClosed) {
    const t = parseTradeRow(row);
    if (!t) continue;
    const pnl = Number(t.pnl);
    if (!Number.isFinite(pnl)) continue;
    const iso = t.closedAt || t.openedAt;
    if (!iso) continue;
    const date = toIstDayKeyFromIso(iso);
    if (!date) continue;
    byDate[date] = +((byDate[date] || 0) + pnl).toFixed(2);
  }
  const now = Date.now();
  db.transaction(() => {
    for (const [date, pnl] of Object.entries(byDate)) {
      prepared.upsertDayPnl.run(date, pnl, now);
    }
  })();
  return byDate;
}

function saveFreshNews(symbol, date, newsArray, ttlMs = FIFTEEN_DAYS_MS) {
  if (!symbol || !date) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const now = Date.now();
  const expiresAt = now + (Number.isFinite(ttlMs) ? ttlMs : FIFTEEN_DAYS_MS);
  const payload = Array.isArray(newsArray) ? newsArray : [];
  prepared.upsertFreshNews.run(symbol, String(date), JSON.stringify(payload), expiresAt, now);
  return payload;
}

function getFreshNews(symbol, date) {
  if (!symbol || !date) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.getFreshNewsRow.get(symbol, String(date));
  if (!row) {
    return null;
  }
  if (row.expires_at <= Date.now()) {
    prepared.deleteFreshNewsRow.run(symbol, String(date));
    return null;
  }
  return parseJson(row.news_json, []);
}

function pruneFreshNews() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneFreshNewsRows.run(Date.now());
  return result.changes ?? 0;
}

// upsertEtfCodes ΓÇö bulk upsert per-source ETF broker/exchange codes.
// Delegates to upsertScripCodes since ETF codes use the same scripts_master table structure.
// broker: 'sharekhan' | 'zerodha' | 'nse' | 'yahoo'
function upsertEtfCodes(rows, broker = 'sharekhan') {
  return upsertScripCodes(rows, broker);
}

function upsertEtfMaster(rows) {
  const db = requireDb();
  const prepared = getPrepared(db);
  const list = Array.isArray(rows) ? rows : [];
  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item?.symbol) {
        continue;
      }
      const symbol = String(item.symbol);
      const existing = prepared.getEtfMasterRow.get(symbol);
      const existingData = parseJson(existing?.data, {}) ?? {};
      const mergedData = { ...existingData, ...item, symbol };
      const isSaved = item.isSaved === undefined ? (existing?.is_saved ?? 0) : toSqliteBool(item.isSaved);
      const isFavorite = item.isFavorite === undefined ? (existing?.is_favorite ?? 0) : toSqliteBool(item.isFavorite);
      prepared.upsertEtfMasterRow.run(symbol, JSON.stringify(mergedData), isSaved, isFavorite, Date.now());
    }
  });
  tx(list);
}

function getEtfMaster(symbol) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  return readEtfMasterRow(prepared.getEtfMasterRow.get(String(symbol)));
}

function saveEtfNavDaily(rows) {
  const db = requireDb();
  const prepared = getPrepared(db);
  const list = Array.isArray(rows) ? rows : [];
  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item?.symbol) {
        continue;
      }
      const symbol = String(item.symbol);
      const navDateRaw = item.date ?? item.nav_date ?? item.as_of ?? item.asOf;
      if (!navDateRaw) {
        continue;
      }
      const navDate = String(navDateRaw);
      const nav = item.nav ?? null;
      const payload = { ...item, symbol, date: navDate, nav };
      prepared.upsertEtfNavDailyRow.run(symbol, navDate, nav, JSON.stringify(payload), Date.now());
    }
  });
  tx(list);
}

function getEtfNavHistory(symbol, from, to) {
  if (!symbol) {
    return [];
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const fromValue = from ?? null;
  const toValue = to ?? null;
  return prepared.getEtfNavHistoryRows.all(String(symbol), fromValue, fromValue, toValue, toValue).map((row) => {
    const payload = parseJson(row.data, {}) ?? {};
    return {
      ...payload,
      symbol: row.symbol,
      date: row.date,
      nav: payload.nav ?? row.nav
    };
  });
}

function saveEtfQuoteCache(symbol, payload, ttlMs) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const now = Date.now();
  const ttl = Number.isFinite(ttlMs) ? ttlMs : 0;
  prepared.upsertEtfQuoteCache.run(String(symbol), JSON.stringify(payload ?? null), now + ttl, now);
  return payload ?? null;
}

function getEtfQuoteCache(symbol) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.getEtfQuoteCacheRow.get(String(symbol));
  if (!row) {
    return null;
  }
  if (row.expires_at <= Date.now()) {
    prepared.deleteEtfQuoteCacheRow.run(String(symbol));
    return null;
  }
  return parseJson(row.payload, null);
}

function pruneEtfQuoteCache() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneEtfQuoteCacheRows.run(Date.now());
  return result.changes ?? 0;
}

function saveEtfHoldingsCache(symbol, payload, ttlMs) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const now = Date.now();
  const ttl = Number.isFinite(ttlMs) ? ttlMs : 0;
  prepared.upsertEtfHoldingsCache.run(String(symbol), JSON.stringify(payload ?? null), now + ttl, now);
  return payload ?? null;
}

function getEtfHoldingsCache(symbol) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.getEtfHoldingsCacheRow.get(String(symbol));
  if (!row) {
    return null;
  }
  if (row.expires_at <= Date.now()) {
    prepared.deleteEtfHoldingsCacheRow.run(String(symbol));
    return null;
  }
  return parseJson(row.payload, null);
}

function pruneEtfHoldingsCache() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneEtfHoldingsCacheRows.run(Date.now());
  return result.changes ?? 0;
}

function setEtfSaved(symbol, isSaved) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const target = String(symbol);
  const existing = prepared.getEtfMasterRow.get(target);
  const existingData = parseJson(existing?.data, {}) ?? {};
  const mergedData = { ...existingData, symbol: target };
  prepared.upsertEtfMasterRow.run(
    target,
    JSON.stringify(mergedData),
    toSqliteBool(isSaved),
    existing?.is_favorite ?? 0,
    Date.now()
  );
  return getEtfMaster(target);
}

function setEtfFavorite(symbol, isFavorite) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  const target = String(symbol);
  const existing = prepared.getEtfMasterRow.get(target);
  const existingData = parseJson(existing?.data, {}) ?? {};
  const mergedData = { ...existingData, symbol: target };
  prepared.upsertEtfMasterRow.run(
    target,
    JSON.stringify(mergedData),
    existing?.is_saved ?? 0,
    toSqliteBool(isFavorite),
    Date.now()
  );
  return getEtfMaster(target);
}

function listSavedEtfs() {
  const db = requireDb();
  const prepared = getPrepared(db);
  return prepared.listSavedEtfRows.all().map((row) => readEtfMasterRow(row)).filter(Boolean);
}

function listEtfFavorites() {
  const db = requireDb();
  const prepared = getPrepared(db);
  return prepared.listFavoriteEtfRows.all().map((row) => readEtfMasterRow(row)).filter(Boolean);
}

function getStockFavoriteSymbols() {
  const db = requireDb();
  return getPrepared(db).listFavoriteStockRows.all().map(r => r.symbol);
}

function setStockFavoriteBulk(symbols) {
  const db = requireDb();
  getPrepared(db).setStockFavoriteBulkTx(Array.isArray(symbols) ? symbols : []);
}

// ΓöÇΓöÇ kv_store: simple key-value for broker_preferences, trade_settings, etc. ΓöÇ

function kvGet(key) {
  const db = requireDb();
  const row = getPrepared(db).getKvRow.get(key);
  if (!row) return null;
  return parseJson(row.value, null);
}

function kvSet(key, value) {
  const db = requireDb();
  getPrepared(db).setKv.run(key, JSON.stringify(value), Date.now());
}

// ΓöÇΓöÇ json_cache: generic JSON blob cache with TTL ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function jsonCacheGet(key) {
  const db = requireDb();
  const row = getPrepared(db).getJsonCache.get(key);
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    getPrepared(db).deleteJsonCache.run(key);
    return null;
  }
  return parseJson(row.data, null);
}

function jsonCacheSet(key, data, ttlMs = null) {
  const db = requireDb();
  const expiresAt = ttlMs ? Date.now() + ttlMs : 9999999999999;
  getPrepared(db).setJsonCache.run(key, JSON.stringify(data), expiresAt, Date.now());
}

function jsonCacheDelete(key) {
  const db = requireDb();
  getPrepared(db).deleteJsonCache.run(key);
}
module.exports = {
  initDb,
  getSchemaVersion,
  getSymbols,
  getSavedStockSymbols,
  getSimulationSymbols,
  saveSimulationSymbols,
  listAllEtfs,
  getEtfSavedSymbols,
  getEtfFavoriteSymbols,
  setEtfSavedBulk,
  setEtfFavoriteBulk,
  rememberSymbols,
  savePortfolioState,
  loadPortfolioState,
  upsertSymbol,
  upsertScripCodes,
  getScripCode,
  scripCodesUpdatedAt,
  saveTrade,
  updateTrade,
  getTrade,
  listTrades,
  countTrades,
  deleteTrade,
  getTradesUpdatedAt,
  listTradeRowsUpdatedAfter,
  listSimulationTradesForRoots,
  upsertSetupEfficiencyFact,
  deleteSetupEfficiencyFact,
  listSetupEfficiencyFacts,
  replaceSetupEfficiencySummaries,
  listSetupEfficiencySummaries,
  loadSetupEfficiencyReconciliation,
  saveSetupEfficiencyReconciliation,
  upsertExitQualityFact,
  deleteExitQualityFact,
  listExitQualityFacts,
  replaceExitQualitySummaries,
  listExitQualitySummaries,
  loadExitQualityReconciliation,
  saveExitQualityReconciliation,
  saveStrategyAdvisorRun,
  getStrategyAdvisorRun,
  listStrategyAdvisorRuns,
  computeAllTimeRealizedPnl,
  getDayPnl,
  rebuildDayPnl,
  saveFreshNews,
  getFreshNews,
  pruneFreshNews,
  upsertEtfCodes,
  upsertEtfMaster,
  getEtfMaster,
  saveEtfNavDaily,
  getEtfNavHistory,
  saveEtfQuoteCache,
  getEtfQuoteCache,
  pruneEtfQuoteCache,
  saveEtfHoldingsCache,
  getEtfHoldingsCache,
  pruneEtfHoldingsCache,
  setEtfSaved,
  setEtfFavorite,
  listSavedEtfs,
  listEtfFavorites,
  getStockFavoriteSymbols,
  setStockFavoriteBulk,
  kvGet,
  kvSet,
  jsonCacheGet,
  jsonCacheSet,
  jsonCacheDelete,
};
