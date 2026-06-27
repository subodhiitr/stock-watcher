# SQLite Migration Design

**Date:** 2026-06-27  
**Status:** Approved  

---

## Goal

Replace JSON file storage for trade_txns, symbol universe, Sharekhan script codes, and fresh news with SQLite (`better-sqlite3`). Keep simulation snapshots as compressed `.json.gz` files. Result: atomic writes, queryable history, 15-day TTL for news, ~90% reduction in snapshot disk usage.

---

## Scope

**Migrated to SQLite:**
- `paper_trades.json` → `trade_txns` table
- `simulation_universe.json` + `saved_stocks.json` → `symbols` table
- `cache/sharekhan_scrip_codes.json` → `sharekhan_scripts` table
- `cache/fresh_news/*.json` + `cache/fresh_stock_news.json` → `fresh_news` table

**Migrated to compressed files:**
- `snapshots/simulation_snapshots_YYYY-MM-DD.json` → `snapshots/simulation_snapshots_YYYY-MM-DD.json.gz`

**Not changed:**
- `trade_settings.json` — tiny config, keep as-is
- `broker_preferences.json` — tiny config, keep as-is
- `simulation_runtime.json` — tiny operational state, keep as-is
- `fundamentals_cache.json`, `etf_*.json` — out of scope
- `saved_etfs.json`, `saved_etf_favs.json`, `saved_stock_favs.json` — out of scope

---

## Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `server/db.js` | SQLite connection, schema init, all typed DB functions |
| `server/snapshot-store.js` | Gzip compress/decompress for snapshot files |
| `server/db-migrate.js` | One-time migration script (JSON → SQLite, JSON → gz) |

### Modified Files

| File | Change |
|------|--------|
| `ticker_proxy.js` | Replace `fs.read/write` for trade_txns, symbols, news, scrip codes with `db.*` calls |
| `sharekhan-client.js` | Replace `loadScripCache`/`saveScripCache` (file) with `db.getScripCode`/`db.upsertScripCodes` |
| `sharekhan-intraday.js` | Remove file cache functions (`loadScripCache`, `saveScripCache`, `SCRIP_CACHE_FILE`); delegate to DB via client |
| `backtest_simulation.js` | Replace snapshot file loading with `snapshotStore.loadSnapshotDay(date)` |

---

## Database Schema

**File:** `stock_watcher.db` in project root.

```sql
-- Symbol universe (simulation + saved stocks)
CREATE TABLE IF NOT EXISTS symbols (
  symbol    TEXT PRIMARY KEY,
  name      TEXT,
  sector    TEXT,
  cap       TEXT,       -- 'large', 'mid', 'small', 'custom'
  source    TEXT,       -- 'simulation', 'saved', 'both'
  added_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Sharekhan master scripts (scrip code lookup)
CREATE TABLE IF NOT EXISTS sharekhan_scripts (
  symbol       TEXT PRIMARY KEY,
  scrip_code   INTEGER NOT NULL,
  company_name TEXT,
  isin         TEXT,
  industry     TEXT,
  inst_type    TEXT,
  lot_size     INTEGER,
  tick_size    REAL,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Trade records
CREATE TABLE IF NOT EXISTS trade_txns (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  name           TEXT,
  side           TEXT NOT NULL,     -- 'buy' | 'sell'
  qty            INTEGER,
  entry_price    REAL,
  exit_price     REAL,
  pnl            REAL,
  pnl_pct        REAL,
  setup_type     TEXT,
  setup          TEXT,
  source         TEXT,              -- 'simulation' | 'manual'
  execution_mode TEXT,              -- 'paper' | 'zerodha_live' | 'sharekhan_live' | 'zerodha_dry_run'
  opened_at      INTEGER,           -- unix ms
  closed_at      INTEGER,
  broker_json    TEXT,              -- JSON: broker order metadata
  notes          TEXT,
  raw_json       TEXT NOT NULL      -- full original trade object (safety net during migration)
);
CREATE INDEX IF NOT EXISTS idx_trade_txns_symbol    ON trade_txns (symbol);
CREATE INDEX IF NOT EXISTS idx_trade_txns_opened_at ON trade_txns (opened_at);
CREATE INDEX IF NOT EXISTS idx_trade_txns_status    ON trade_txns (status);

-- Fresh news with 15-day TTL
CREATE TABLE IF NOT EXISTS fresh_news (
  id          TEXT PRIMARY KEY,   -- '{symbol}:{date}'
  symbol      TEXT NOT NULL,
  date        TEXT NOT NULL,      -- 'YYYY-MM-DD'
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,   -- fetched_at + 15 * 24 * 60 * 60 * 1000
  news_json   TEXT NOT NULL       -- full news array as JSON string
);
CREATE INDEX IF NOT EXISTS idx_fresh_news_symbol_date ON fresh_news (symbol, date);
CREATE INDEX IF NOT EXISTS idx_fresh_news_expires     ON fresh_news (expires_at);
```

---

## `server/db.js` — Public API

```js
// Lifecycle
initDb()                          // create tables, run migrations — call on server start

// Symbols
getSymbols()                      // → [{ symbol, name, sector, cap, source }]
upsertSymbol(sym, name, sector, cap, source)
rememberSymbols(symbolsArray)     // bulk upsert from simulation universe or saved stocks

// Sharekhan scripts
getScripCode(symbol)              // → number (0 if not found)
upsertScripCodes(masterDataArray) // bulk upsert from Sharekhan master API response
scripCodesUpdatedAt()             // → unix ms of last update (0 if never)

// trade_txns
getTrade(id)                      // → trade object | null
saveTrade(tradeObj)               // insert or replace
updateTrade(id, fields)           // partial update
listTrades(filters?)              // → [trade] — filters: { status, symbol, since, until, source }
countTrades()                     // → number

// Fresh news
getFreshNews(symbol, date)        // → news array | null (null if missing or expired)
saveFreshNews(symbol, date, newsArray) // upsert with 15-day TTL
pruneFreshNews()                  // delete rows where expires_at < now
```

---

## `server/snapshot-store.js` — Public API

```js
loadSnapshotDay(date)             // → parsed JSON object | null (decompresses .json.gz)
saveSnapshotDay(date, dataObj)    // compresses and writes .json.gz
listSnapshotDays()                // → ['YYYY-MM-DD', ...] sorted descending
pruneOldSnapshots(retentionDays)  // delete .json.gz files older than retentionDays
```

Snapshot files: `snapshots/simulation_snapshots_YYYY-MM-DD.json.gz`  
Backward compatible: if `.json` exists and `.json.gz` doesn't, load uncompressed (migration period).

---

## `server/db-migrate.js` — Migration Script

One-time script, run manually: `node server/db-migrate.js`

1. **trade_txns**: Read `paper_trades.json`. Store full original object in `raw_json` column.
2. **Symbols**: Read `simulation_universe.json` (source='simulation') + `saved_stocks.json` (source='saved') → upsert into `symbols`.
3. **Sharekhan scripts**: Read `cache/sharekhan_scrip_codes.json` → upsert into `sharekhan_scripts`.
4. **Fresh news**: Read all `cache/fresh_news/*.json` + `cache/fresh_stock_news.json` → insert into `fresh_news` with 15-day TTL from file mtime. Skip expired entries.
5. **Snapshots**: For each `.json` in `snapshots/`, compress to `.json.gz`. Keep originals until verified.

Script is idempotent — safe to run multiple times.

---

## Snapshot Compression

Use Node.js built-in `zlib.gzip` / `zlib.gunzip` (no extra dependency).

```js
// write
const gz = zlib.gzipSync(JSON.stringify(data));
fs.writeFileSync(filePath + '.gz', gz);

// read
const buf = fs.readFileSync(filePath + '.gz');
return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
```

Expected compression ratio: ~95% (JSON text compresses extremely well).  
38MB → ~2-4MB per day file.

---

## Dependency

**`better-sqlite3`** — synchronous SQLite for Node.js.  
- Install: `npm install better-sqlite3`
- Synchronous API matches existing `fs.readFileSync` patterns — minimal refactor
- No async/await needed for DB calls

---

## Migration Strategy

1. Install `better-sqlite3`
2. Create `server/db.js`, `server/snapshot-store.js`
3. Run `server/db-migrate.js` — populates DB from existing JSON files
4. Update `ticker_proxy.js` one data type at a time (trade_txns first, then symbols, then news)
5. Update `sharekhan-client.js` + `sharekhan-intraday.js` for scrip codes
6. Update `backtest_simulation.js` for snapshot loading
7. Verify all tests pass after each step
8. After stability period (1 week): delete original JSON files

---

## Testing

- Unit tests for `db.js`: each public function with in-memory SQLite (`:memory:`)
- Unit tests for `snapshot-store.js`: compress/decompress round-trip
- Migration test: run `db-migrate.js` against test fixtures, verify row counts match source files
- Integration: existing test suite must pass with zero changes to test files

---

## Non-Goals

- No ORM — raw SQL via `better-sqlite3`
- No migrations framework — schema versioning via a `schema_version` table with simple integer comparison
- No ETF/fundamentals migration — out of scope
- No real-time sync between DB and legacy JSON files after migration
