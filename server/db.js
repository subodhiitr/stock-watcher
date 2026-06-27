import Database from 'better-sqlite3';

const INITIAL_SCHEMA_VERSION = 1;
const SOURCE_SAVED = 'saved';
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

export function initDb(path = 'stock-watcher.db') {
  const db = new Database(path);

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
  `);

  activeDb = db;
  return db;
}

export function getSchemaVersion(db = requireDb()) {
  const row = getPrepared(db).getSchemaVersion.get();
  return row?.version ?? 0;
}

export function rememberSymbols(rows) {
  const db = requireDb();
  const prepared = getPrepared(db);
  prepared.rememberSymbolsTx(Array.isArray(rows) ? rows : []);
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