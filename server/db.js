import Database from 'better-sqlite3';

const INITIAL_SCHEMA_VERSION = 1;
const SOURCE_SAVED = 'saved';
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
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
    upsertTrade: db.prepare(`
      INSERT INTO trade_txns (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
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

export function initDb(path = 'stock-watcher.db') {
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
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

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

  activeDb = db;
  return db;
}

export function getSchemaVersion(db = requireDb()) {
  const row = getPrepared(db).getSchemaVersion.get();
  return row?.version ?? 0;
}

export function getSymbols() {
  const db = requireDb();
  return db.prepare('SELECT symbol, name, sector, cap, source FROM symbols ORDER BY symbol ASC').all();
}

export function rememberSymbols(rows) {
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.rememberSymbolsTx(Array.isArray(rows) ? rows : []);
}

export function savePortfolioState(portfolio) {
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

export function loadPortfolioState() {
  const db = requireDb();
  const row = db.prepare("SELECT data FROM portfolio_state WHERE key = 'default'").get();
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

export function upsertSymbol(symbol, name, sector, cap, source) {
  if (!symbol) {
    return;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.upsertSymbolTx(symbol, name, sector, cap, source);
}

export function upsertScripCodes(rows, broker = 'sharekhan') {
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.upsertScripCodesTxByBroker[broker](Array.isArray(rows) ? rows : []);
}

export function getScripCode(symbol, broker = 'sharekhan') {
  if (!symbol) {
    return null;
  }
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.getScripCodeStmtByBroker[broker].get(symbol);
  return row?.code ?? null;
}

export function scripCodesUpdatedAt(broker = 'sharekhan') {
  assertSupportedBroker(broker);
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.scripCodesUpdatedAtByBroker[broker].get();
  return row?.updated_at ?? 0;
}

export function saveTrade(trade) {
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
  prepared.upsertTrade.run(patch.id, JSON.stringify(merged), now, now);
  return merged;
}

export function updateTrade(id, fields) {
  if (!id) {
    return null;
  }
  const patch = normalizeTradePatch(fields);
  delete patch.id;
  return saveTrade({ id, ...patch });
}

export function getTrade(id) {
  if (!id) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  return parseTradeRow(prepared.getTradeRow.get(id));
}

export function listTrades(filters = {}) {
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

export function countTrades() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const row = prepared.countTrades.get();
  return row?.count ?? 0;
}

export function deleteTrade(id) {
  if (!id) return 0;
  const db = requireDb();
  const result = db.prepare('DELETE FROM trade_txns WHERE id = ?').run(String(id));
  return result.changes ?? 0;
}

export function getTradesUpdatedAt() {
  const db = requireDb();
  const row = db.prepare('SELECT COALESCE(MAX(updated_at), 0) AS ts FROM trade_txns').get();
  return row?.ts ?? 0;
}

export function computeAllTimeRealizedPnl() {
  const db = requireDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CAST(json_extract(data, '$.pnl') AS REAL)), 0) AS total
    FROM trade_txns
    WHERE json_extract(data, '$.status') = 'closed'
  `).get();
  return +(row?.total ?? 0);
}

export function saveFreshNews(symbol, date, newsArray, ttlMs = FIFTEEN_DAYS_MS) {
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

export function getFreshNews(symbol, date) {
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

export function pruneFreshNews() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneFreshNewsRows.run(Date.now());
  return result.changes ?? 0;
}

export function upsertEtfMaster(rows) {
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

export function getEtfMaster(symbol) {
  if (!symbol) {
    return null;
  }
  const db = requireDb();
  const prepared = getPrepared(db);
  return readEtfMasterRow(prepared.getEtfMasterRow.get(String(symbol)));
}

export function saveEtfNavDaily(rows) {
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

export function getEtfNavHistory(symbol, from, to) {
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

export function saveEtfQuoteCache(symbol, payload, ttlMs) {
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

export function getEtfQuoteCache(symbol) {
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

export function pruneEtfQuoteCache() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneEtfQuoteCacheRows.run(Date.now());
  return result.changes ?? 0;
}

export function saveEtfHoldingsCache(symbol, payload, ttlMs) {
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

export function getEtfHoldingsCache(symbol) {
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

export function pruneEtfHoldingsCache() {
  const db = requireDb();
  const prepared = getPrepared(db);
  const result = prepared.pruneEtfHoldingsCacheRows.run(Date.now());
  return result.changes ?? 0;
}

export function setEtfSaved(symbol, isSaved) {
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

export function setEtfFavorite(symbol, isFavorite) {
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

export function listSavedEtfs() {
  const db = requireDb();
  const prepared = getPrepared(db);
  return prepared.listSavedEtfRows.all().map((row) => readEtfMasterRow(row)).filter(Boolean);
}

export function listEtfFavorites() {
  const db = requireDb();
  const prepared = getPrepared(db);
  return prepared.listFavoriteEtfRows.all().map((row) => readEtfMasterRow(row)).filter(Boolean);
}