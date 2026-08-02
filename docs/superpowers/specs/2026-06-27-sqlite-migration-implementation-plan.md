# SQLite Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON-backed trade/symbol/news/script/ETF persistence with SQLite and move snapshots to `.json.gz` with compatibility during cutover.

**Architecture:** Introduce a synchronous DB service (`server/db.js`) using `better-sqlite3`, plus a snapshot compression service (`server/snapshot-store.js`). Migrate existing JSON files with `server/db-migrate.js`, then cut over consumers in `ticker_proxy.js`, `sharekhan-client.js`, `sharekhan-intraday.js`, and `backtest_simulation.js` one surface at a time with tests before each switch.

**Tech Stack:** Node.js, `better-sqlite3`, Node test runner (`node --test`), `zlib`, existing proxy/server modules.

---

## File Structure (planned)

### New files
- `server/db.js` — SQLite connection, schema init, prepared statements, typed data access APIs.
- `server/snapshot-store.js` — read/write compressed snapshot files with backward-compatible fallback.
- `server/db-migrate.js` — idempotent JSON → SQLite migration and snapshot compression command.
- `tests/db.schema-and-core.test.js` — schema/init/versioning and core symbol/script APIs.
- `tests/db.trade-news-etf.test.js` — trade/news/ETF read-write + TTL behavior.
- `tests/snapshot-store.test.js` — `.json.gz` read/write/fallback/prune behavior.
- `tests/db-migrate.test.js` — migration fixture test verifying row counts and merge behavior.

### Modified files
- `ticker_proxy.js` — replace JSON file I/O with `db.js` APIs in phased cutover.
- `sharekhan-client.js` — replace file scrip cache load/save with DB-backed script lookup/upsert.
- `sharekhan-intraday.js` — remove file cache usage; route script-code flows through DB-enabled client.
- `backtest_simulation.js` — load snapshots via `snapshot-store`.
- `package.json` — add `better-sqlite3` dependency.

---

### Task 1: Add SQLite dependency and DB module scaffold

**Files:**
- Modify: `package.json`
- Create: `server/db.js`
- Test: `tests/db.schema-and-core.test.js`

- [ ] **Step 1: Write the failing schema test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getSchemaVersion } from '../server/db.js';

test('initDb creates schema and schema_version row', () => {
  const db = initDb(':memory:');
  assert.equal(getSchemaVersion(db) >= 1, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.schema-and-core.test.js`  
Expected: FAIL (`Cannot find module '../server/db.js'` or missing exports)

- [ ] **Step 3: Install dependency and add minimal DB implementation**

```js
// server/db.js
import Database from 'better-sqlite3';
export function initDb(file = 'stock_watcher.db') { /* open db, pragmas, create tables */ }
export function getSchemaVersion(dbHandle) { /* read schema_version */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.schema-and-core.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json server/db.js tests/db.schema-and-core.test.js
git commit -m "feat: scaffold sqlite db module with schema init"
```

### Task 2: Implement symbols and scripts_master APIs with merge semantics

**Files:**
- Modify: `server/db.js`
- Modify: `tests/db.schema-and-core.test.js`

- [ ] **Step 1: Write failing tests for symbol source merge and script-code retrieval**

```js
test('rememberSymbols merges source to both', () => {
  rememberSymbols([{ symbol: 'SBIN', source: 'simulation' }]);
  rememberSymbols([{ symbol: 'SBIN', source: 'saved' }]);
  assert.equal(getSymbols().find(s => s.symbol === 'SBIN').source, 'both');
});

test('upsertSymbol inserts and updates a single symbol row', () => {
  upsertSymbol('RELIANCE', 'Reliance Industries', 'Energy', 'large', 'simulation');
  upsertSymbol('RELIANCE', 'Reliance Industries Ltd', 'Energy', 'large', 'simulation');
  assert.equal(getSymbols().find(s => s.symbol === 'RELIANCE').name, 'Reliance Industries Ltd');
});

test('getScripCode returns broker-mapped values', () => {
  upsertScripCodes([{ symbol: 'SBIN', sharekhan_code: 3045, nse_code: 'SBIN' }]);
  assert.equal(getScripCode('SBIN', 'sharekhan'), 3045);
  assert.equal(getScripCode('SBIN', 'nse'), 'SBIN');
});

test('scripCodesUpdatedAt advances after upsert', () => {
  const before = scripCodesUpdatedAt('sharekhan');
  upsertScripCodes([{ symbol: 'HDFCBANK', sharekhan_code: 1333 }]);
  assert.equal(scripCodesUpdatedAt('sharekhan') >= before, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.schema-and-core.test.js`  
Expected: FAIL on missing functions or wrong merge behavior

- [ ] **Step 3: Implement symbol/script queries with prepared statements**

```js
export function rememberSymbols(rows) { /* upsert and merge source -> both */ }
export function upsertSymbol(symbol, name, sector, cap, source) { /* single-row upsert */ }
export function upsertScripCodes(rows, broker = 'sharekhan') { /* column-specific upsert */ }
export function getScripCode(symbol, broker = 'sharekhan') { /* return number|string|null */ }
export function scripCodesUpdatedAt(broker = 'sharekhan') { /* return last scripts update timestamp */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.schema-and-core.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.js tests/db.schema-and-core.test.js
git commit -m "feat: add symbol and scripts master sqlite APIs"
```

### Task 3: Implement trade_txns upsert/update/list APIs

**Files:**
- Modify: `server/db.js`
- Create: `tests/db.trade-news-etf.test.js`

- [ ] **Step 1: Write failing tests for saveTrade upsert-preserve and partial update**

```js
test('saveTrade preserves existing fields when absent in subsequent payload', () => {
  saveTrade({ id: 't1', status: 'open', raw_json: '{"id":"t1"}', notes: 'first' });
  saveTrade({ id: 't1', status: 'closed', raw_json: '{"id":"t1"}' });
  assert.equal(getTrade('t1').notes, 'first');
});

test('countTrades returns row count', () => {
  saveTrade({ id: 't2', status: 'open', raw_json: '{"id":"t2"}' });
  assert.equal(countTrades() >= 1, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.trade-news-etf.test.js`  
Expected: FAIL on replace semantics or missing APIs

- [ ] **Step 3: Implement ON CONFLICT upsert + filtered listTrades**

```js
export function saveTrade(trade) { /* INSERT ... ON CONFLICT(id) DO UPDATE ... COALESCE(excluded.col, trade_txns.col) */ }
export function updateTrade(id, fields) { /* explicit partial update */ }
export function listTrades(filters = {}) { /* build safe WHERE clauses */ }
export function countTrades() { /* fast count(*) from trade_txns */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.trade-news-etf.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.js tests/db.trade-news-etf.test.js
git commit -m "feat: migrate trade transaction persistence to sqlite api"
```

### Task 4: Implement fresh_news and ETF tables with TTL-safe accessors

**Files:**
- Modify: `server/db.js`
- Modify: `tests/db.trade-news-etf.test.js`

- [ ] **Step 1: Write failing tests for fresh_news and ETF quote/holdings expiry**

```js
test('getFreshNews returns null when expired', () => {
  saveFreshNews('SBIN', '2026-06-27', [{ t: 'x' }], -1);
  assert.equal(getFreshNews('SBIN', '2026-06-27'), null);
});

test('ETF caches return null after expiry and prune removes rows', () => {
  saveEtfQuoteCache('NIFTYBEES', { ltp: 255 }, -1);
  assert.equal(getEtfQuoteCache('NIFTYBEES'), null);
});

test('etf master/list/history APIs return expected rows', () => {
  upsertEtfMaster([{ symbol: 'NIFTYBEES', name: 'Nippon ETF' }]);
  saveEtfNavDaily([{ symbol: 'NIFTYBEES', date: '2026-06-27', nav: 255 }]);
  assert.equal(getEtfMaster('NIFTYBEES').symbol, 'NIFTYBEES');
  assert.equal(getEtfNavHistory('NIFTYBEES', '2026-06-01', '2026-06-30').length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.trade-news-etf.test.js`  
Expected: FAIL on missing ETF/news methods

- [ ] **Step 3: Implement fresh_news + ETF APIs and prune functions**

```js
export function saveFreshNews(symbol, date, newsArray, ttlMs = FIFTEEN_DAYS_MS) { /* upsert */ }
export function getFreshNews(symbol, date) { /* return null if expires_at < now */ }
export function pruneFreshNews() { /* delete expired rows */ }
export function upsertEtfMaster(rows) { /* bulk upsert */ }
export function getEtfMaster(symbol) { /* one symbol or all rows */ }
export function saveEtfNavDaily(rows) { /* upsert nav rows */ }
export function getEtfNavHistory(symbol, from, to) { /* date range query */ }
export function saveEtfQuoteCache(symbol, payload, ttlMs) { /* ttl table */ }
export function pruneEtfQuoteCache() { /* delete expired quote rows */ }
export function saveEtfHoldingsCache(symbol, payload, ttlMs) { /* ttl table */ }
export function getEtfHoldingsCache(symbol) { /* null if expired */ }
export function pruneEtfHoldingsCache() { /* delete expired holdings rows */ }
export function setEtfSaved(symbol, isSaved) { /* etf_user_lists flags */ }
export function setEtfFavorite(symbol, isFavorite) { /* etf_user_lists flags */ }
export function listSavedEtfs() { /* is_saved=1 */ }
export function listEtfFavorites() { /* is_favorite=1 */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.trade-news-etf.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.js tests/db.trade-news-etf.test.js
git commit -m "feat: add sqlite fresh news and etf persistence apis"
```

### Task 5: Build snapshot-store compression module

**Files:**
- Create: `server/snapshot-store.js`
- Create: `tests/snapshot-store.test.js`

- [ ] **Step 1: Write failing tests for gzip write/read and legacy `.json` fallback**

```js
test('saveSnapshotDay writes gz and loadSnapshotDay reads it back', () => { /* round trip */ });
test('loadSnapshotDay falls back to legacy json when gz missing', () => { /* fallback */ });
test('listSnapshotDays returns available snapshot dates in descending order', () => { /* sort check */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/snapshot-store.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement snapshot-store with zlib + fs**

```js
export function saveSnapshotDay(date, obj) { /* gzipSync + write */ }
export function loadSnapshotDay(date) { /* prefer .json.gz, fallback .json */ }
export function listSnapshotDays() { /* enumerate snapshot dates sorted desc */ }
export function pruneOldSnapshots(retentionDays) { /* delete old .json.gz */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/snapshot-store.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/snapshot-store.js tests/snapshot-store.test.js
git commit -m "feat: add gzip snapshot storage module"
```

### Task 6: Implement idempotent migration script with fixtures

**Files:**
- Create: `server/db-migrate.js`
- Create: `tests/db-migrate.test.js`
- Create: `tests/fixtures/sqlite-migrate/*` (small JSON fixture set)
- Modify: `server/db.js` (export helper hooks needed by migrator)

- [ ] **Step 1: Write failing migration fixture test**

```js
test('db-migrate imports fixtures and can be re-run without duplicating rows', async () => {
  await runMigrationOnce();
  await runMigrationOnce();
  assert.equal(countTrades(), EXPECTED_TRADES);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db-migrate.test.js`  
Expected: FAIL (`runMigration` missing)

- [ ] **Step 3: Implement migration phases in order**

```js
// migrate: trade_txns -> symbols(source merge) -> scripts_master -> fresh_news(ttl) ->
// etf_master/etf caches/etf_user_lists -> snapshot .json to .json.gz
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db-migrate.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/db-migrate.js tests/db-migrate.test.js tests/fixtures/sqlite-migrate server/db.js
git commit -m "feat: add idempotent sqlite migration script"
```

### Task 7: Cut over ticker_proxy.js from JSON files to DB APIs

**Files:**
- Modify: `ticker_proxy.js`
- Create: `tests/sqlite-ticker-proxy-persistence.test.js`

- [ ] **Step 1: Write/adjust failing tests for trade/symbol/news/ETF behavior against DB-backed storage**

```js
test('trade lifecycle endpoints persist and read from sqlite store', async () => { /* open/close/list */ });
test('fresh news endpoint respects 15-day ttl from db', async () => { /* expired -> miss */ });
```

- [ ] **Step 2: Run targeted tests to verify failures**

Run: `node --test tests/sqlite-ticker-proxy-persistence.test.js`  
Expected: FAIL where file-backed behavior is still referenced

- [ ] **Step 2.1: Run pre-cutover migration before enabling DB-backed reads**

Run: `node server/db-migrate.js`  
Expected: current local dataset is present in SQLite before any endpoint reads switch from JSON to DB.

- [ ] **Step 3: Replace JSON read/write paths in phased order**

```js
// import db module once
// call initDb() at server boot; fail fast if schema/init fails
// add persistence mode: json (default) | dual | sqlite
// dual mode writes JSON+DB while reads stay JSON until cutover
// trade handlers -> db.saveTrade/updateTrade/listTrades
// universe/saved symbols -> db.rememberSymbols/getSymbols
// scripts/news/etf caches -> corresponding db functions
```

- [ ] **Step 4: Run targeted tests to verify pass**

Run: `node --test tests/sqlite-ticker-proxy-persistence.test.js tests/trade-execution-api-contract.test.js tests/trade-settings-server-sync.test.js tests/broker-portfolio-aggregate.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ticker_proxy.js tests/sqlite-ticker-proxy-persistence.test.js
git commit -m "refactor: switch ticker proxy persistence to sqlite services"
```

### Task 8: Cut over Sharekhan modules to scripts_master in DB

**Files:**
- Modify: `sharekhan-client.js`
- Modify: `sharekhan-intraday.js`
- Create: `tests/sqlite-sharekhan-script-master.test.js`

- [ ] **Step 1: Write failing tests for DB-driven script code flow**

```js
test('getScripCode resolves from db-backed scripts master', async () => { /* no file cache dependency */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sqlite-sharekhan-script-master.test.js`  
Expected: FAIL while file cache constants/functions are still required

- [ ] **Step 3: Implement DB delegation and remove file cache references**

```js
// sharekhan-client: use db.getScripCode/db.upsertScripCodes
// sharekhan-intraday: call client methods only; drop direct cache file access
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sqlite-sharekhan-script-master.test.js tests/sharekhan-intraday.test.js`  
Expected: PASS and existing Sharekhan intraday tests remain unchanged/passing

- [ ] **Step 5: Commit**

```bash
git add sharekhan-client.js sharekhan-intraday.js tests/sqlite-sharekhan-script-master.test.js
git commit -m "refactor: move sharekhan script cache to sqlite master table"
```

### Task 9: Switch backtest snapshot loading to snapshot-store

**Files:**
- Modify: `backtest_simulation.js`
- Create: `tests/sqlite-backtest-snapshot-gzip.test.js`

- [ ] **Step 1: Add failing test for `.json.gz` snapshot read path**

```js
test('backtest loader can read compressed day snapshot', async () => { /* fixture gz */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sqlite-backtest-snapshot-gzip.test.js`  
Expected: FAIL because loader still expects `.json`

- [ ] **Step 3: Replace direct snapshot file reads with snapshot-store API**

```js
import { loadSnapshotDay } from './server/snapshot-store.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sqlite-backtest-snapshot-gzip.test.js tests/simulation-snapshot-server-owned.test.js`  
Expected: PASS and existing snapshot tests remain unchanged/passing

- [ ] **Step 5: Commit**

```bash
git add backtest_simulation.js tests/sqlite-backtest-snapshot-gzip.test.js
git commit -m "refactor: load simulation snapshots through gzip snapshot store"
```

### Task 10: Full verification and cutover cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-06-27-sqlite-migration-design.md` (only if final implementation diverges)
- Modify: `docs/superpowers/specs/2026-06-27-sqlite-migration-implementation-plan.md` (check off completed items during execution)

- [ ] **Step 1: Run migration command on local data**

Run: `node server/db-migrate.js`  
Expected: completes successfully and logs migrated counts for each data class.

- [ ] **Step 1.1: Execute cutover safety procedure**

Run:
1. Restart proxy in `dual` mode (`PERSISTENCE_MODE=dual`) so writes go to JSON + DB.
2. Run `node server/db-migrate.js` once more for final sync.
3. Restart proxy in `sqlite` mode (`PERSISTENCE_MODE=sqlite`) for DB-only reads/writes.
Expected: no write gap between final migration and endpoint cutover.

- [ ] **Step 2: Run full test suite**

Run: `npm test`  
Expected: no new failures introduced by migration work.

- [ ] **Step 3: Run targeted runtime check**

Run: `node --test tests/sharekhan-intraday.test.js tests/trade-execution-api-contract.test.js tests/simulation-snapshot-server-owned.test.js`  
Expected: PASS

- [ ] **Step 4: Remove only migrated legacy JSON files after stability window**

Run: `git rm paper_trades.json simulation_universe.json saved_stocks.json cache/sharekhan_scrip_codes.json` (plus migrated ETF/news cache files when safe)  
Expected: only migrated files removed; non-goal JSON files remain.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: complete sqlite migration cutover and cleanup"
```
